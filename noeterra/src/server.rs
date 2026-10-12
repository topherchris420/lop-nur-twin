//! The Noeterra workbench: a loopback-only HTTP server with an embedded interface.
//! It holds one history at a time. Long turns (model seats) run on a worker
//! thread; the interface polls a snapshot that is replaced after every turn.

use std::collections::BTreeMap;
use std::io::Read;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Deserialize;
use serde_json::{json, Value};
use tiny_http::{Header, Method, Response, Server};

use crate::action::{describe, Decision, Outgoing, Response as Answer};
use crate::brain::llm::{interpret_orders, reply_in_character, LlmBrain};
use crate::brain::provider::{Anthropic, ChatProvider, LmStudio};
use crate::brain::Brain;
use crate::experiment::{self, Plan, METRICS};
use crate::geometry::geometry;
use crate::model::*;
use crate::observe::observe;
use crate::scenario::{builtin, builtin_ids, generate, Scenario};
use crate::sim::{engine_id, offline_brains, Intervention, Save, Seat, Simulation, TurnRecord};
use crate::views;

const INDEX: &str = include_str!("../ui/index.html");
const APP_JS: &str = include_str!("../ui/app.js");
const STYLE: &str = include_str!("../ui/style.css");
const MAX_BODY: usize = 32 * 1024 * 1024;

#[derive(Clone)]
pub struct Config {
    pub port: u16,
    pub lmstudio_url: String,
    pub lmstudio_model: Option<String>,
    pub anthropic_model: Option<String>,
    pub timeout: Duration,
    pub max_tokens: u32,
}

impl Config {
    pub fn from_env(port: u16) -> Config {
        let var = |k: &str| std::env::var(k).ok().filter(|v| !v.trim().is_empty());
        Config {
            port,
            lmstudio_url: var("NOETERRA_LMSTUDIO_URL").unwrap_or_else(|| "http://127.0.0.1:1234/v1".into()),
            lmstudio_model: var("NOETERRA_LMSTUDIO_MODEL")
                .or_else(|| var("RAIN_MODEL"))
                .or_else(|| var("RAIN_LLM_MODEL")),
            anthropic_model: var("NOETERRA_ANTHROPIC_MODEL"),
            timeout: Duration::from_secs(
                var("NOETERRA_MODEL_TIMEOUT")
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(240)
                    .clamp(10, 1800),
            ),
            max_tokens: var("NOETERRA_MAX_TOKENS")
                .and_then(|v| v.parse().ok())
                .unwrap_or(6000)
                .clamp(500, 32000),
        }
    }

    pub fn provider(&self, name: &str, model: Option<String>) -> Result<Arc<dyn ChatProvider>, String> {
        match name {
            "lmstudio" => Ok(Arc::new(LmStudio::connect(
                &self.lmstudio_url,
                model.or(self.lmstudio_model.clone()),
                self.timeout,
            )?)),
            "anthropic" => Ok(Arc::new(Anthropic::connect(
                model.or(self.anthropic_model.clone()),
                self.timeout,
            )?)),
            other => Err(format!("unknown provider `{other}`")),
        }
    }

    /// Brains for every seat. A model seat whose provider cannot be reached is
    /// an error, never a silent substitution.
    pub fn brains(&self, seats: &[Seat]) -> Result<Vec<Box<dyn Brain>>, String> {
        let mut out = offline_brains(seats);
        for (i, s) in seats.iter().enumerate() {
            if let Seat::Model { provider, model } = s {
                out[i] = Box::new(LlmBrain {
                    provider: self.provider(provider, model.clone())?,
                    max_tokens: self.max_tokens,
                });
            }
        }
        Ok(out)
    }
}

#[derive(Clone, serde::Serialize)]
struct Parley {
    turn: u32,
    from: CivId,
    to: CivId,
    letter: String,
    reply: Option<String>,
    reply_generation: Option<Generation>,
    reply_model: Option<String>,
    error: Option<String>,
}

#[derive(Default, Clone, serde::Serialize)]
struct Job {
    running: bool,
    target: u32,
    done: u32,
    error: Option<String>,
}

struct App {
    cfg: Config,
    sim: Option<Simulation>,
    brains: Vec<Box<dyn Brain>>,
    human: BTreeMap<CivId, Decision>,
    /// The world as of the last completed turn, for reads while a job runs.
    world: Option<World>,
    records: Vec<TurnRecord>,
    seats: Vec<Seat>,
    scenario: Option<Scenario>,
    geometry: Option<Value>,
    parley: Vec<Parley>,
    job: Job,
}

type Shared = Arc<(Mutex<App>, AtomicBool)>;

fn json_response(status: u16, v: &Value) -> Response<std::io::Cursor<Vec<u8>>> {
    Response::from_string(v.to_string())
        .with_status_code(status)
        .with_header(Header::from_bytes("Content-Type", "application/json; charset=utf-8").unwrap())
        .with_header(Header::from_bytes("Cache-Control", "no-store").unwrap())
}

fn asset(body: &str, kind: &str) -> Response<std::io::Cursor<Vec<u8>>> {
    Response::from_string(body)
        .with_header(Header::from_bytes("Content-Type", kind).unwrap())
        .with_header(
            Header::from_bytes(
                "Content-Security-Policy",
                "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
            )
            .unwrap(),
        )
        .with_header(Header::from_bytes("X-Content-Type-Options", "nosniff").unwrap())
}

fn err(status: u16, msg: impl Into<String>) -> Result<Value, (u16, String)> {
    Err((status, msg.into()))
}

pub fn serve(cfg: Config) -> Result<(), String> {
    let addr = format!("127.0.0.1:{}", cfg.port);
    let server = Server::http(&addr).map_err(|e| format!("cannot listen on {addr}: {e}"))?;
    println!("Noeterra workbench on http://{addr}  (loopback only; Ctrl+C to stop)");
    let shared: Shared = Arc::new((
        Mutex::new(App {
            cfg: cfg.clone(),
            sim: None,
            brains: Vec::new(),
            human: BTreeMap::new(),
            world: None,
            records: Vec::new(),
            seats: Vec::new(),
            scenario: None,
            geometry: None,
            parley: Vec::new(),
            job: Job::default(),
        }),
        AtomicBool::new(false),
    ));
    {
        let mut app = shared.0.lock().unwrap();
        let s = builtin("mediterranean-264bc", 1).expect("built-in scenario");
        let n = s.civs.len();
        install(&mut app, s, 1, vec![Seat::Rules; n], Vec::new()).expect("default game starts");
    }
    for mut req in server.incoming_requests() {
        let allowed = [format!("127.0.0.1:{}", cfg.port), format!("localhost:{}", cfg.port)];
        let host_ok = req
            .headers()
            .iter()
            .any(|h| h.field.equiv("Host") && allowed.contains(&h.value.as_str().to_string()));
        let origin_ok = req
            .headers()
            .iter()
            .filter(|h| h.field.equiv("Origin"))
            .all(|h| allowed.iter().any(|a| h.value.as_str() == format!("http://{a}")));
        if !host_ok || !origin_ok {
            let _ = req.respond(json_response(
                403,
                &json!({ "error": "the workbench only answers its own page on loopback" }),
            ));
            continue;
        }
        let url = req.url().to_string();
        let path = url.split('?').next().unwrap_or("").to_string();
        let method = req.method().clone();
        let resp = match (&method, path.as_str()) {
            (Method::Get, "/") => asset(INDEX, "text/html; charset=utf-8"),
            (Method::Get, "/app.js") => asset(APP_JS, "text/javascript; charset=utf-8"),
            (Method::Get, "/style.css") => asset(STYLE, "text/css; charset=utf-8"),
            (method, p) if p.starts_with("/api/") => {
                let mut body = String::new();
                if *method == Method::Post {
                    let mut r = req.as_reader().take(MAX_BODY as u64 + 1);
                    if r.read_to_string(&mut body).is_err() || body.len() > MAX_BODY {
                        let _ = req.respond(json_response(
                            413,
                            &json!({ "error": "request too large or not UTF-8" }),
                        ));
                        continue;
                    }
                }
                match api(&shared, method.clone(), p, &url, &body) {
                    Ok(v) => json_response(200, &v),
                    Err((code, msg)) => json_response(code, &json!({ "error": msg })),
                }
            }
            _ => json_response(404, &json!({ "error": "not found" })),
        };
        let _ = req.respond(resp);
    }
    Ok(())
}

fn install(
    app: &mut App,
    scenario: Scenario,
    seed: u64,
    seats: Vec<Seat>,
    interventions: Vec<Intervention>,
) -> Result<(), String> {
    let brains = app.cfg.brains(&seats)?;
    let sim = Simulation::new(scenario.clone(), seed, seats.clone(), interventions)?;
    app.geometry = Some(serde_json::to_value(geometry(&sim.world)).expect("geometry serializes"));
    app.world = Some(sim.world.clone());
    app.records.clear();
    app.seats = seats;
    app.scenario = Some(scenario);
    app.brains = brains;
    app.sim = Some(sim);
    app.human.clear();
    app.parley.clear();
    app.job = Job::default();
    Ok(())
}

#[derive(Deserialize)]
struct NewGame {
    scenario: String,
    seed: u64,
    #[serde(default)]
    seats: BTreeMap<String, String>,
    #[serde(default)]
    default_seat: Option<String>,
    #[serde(default)]
    civs: Option<usize>,
    #[serde(default)]
    provinces: Option<usize>,
    #[serde(default)]
    interventions: Vec<Intervention>,
}

#[derive(Deserialize)]
struct Orders {
    civ: CivId,
    #[serde(default)]
    actions: Vec<usize>,
    #[serde(default)]
    responses: Vec<Answer>,
    #[serde(default)]
    messages: Vec<Outgoing>,
}

fn query(url: &str, key: &str) -> Option<String> {
    url.split_once('?')?.1.split('&').find_map(|kv| {
        let (k, v) = kv.split_once('=')?;
        (k == key).then(|| v.to_string())
    })
}

fn parse<T: serde::de::DeserializeOwned>(body: &str) -> Result<T, (u16, String)> {
    serde_json::from_str(body).map_err(|e| (400, format!("bad request: {e}")))
}

fn api(shared: &Shared, method: Method, path: &str, url: &str, body: &str) -> Result<Value, (u16, String)> {
    let (lock, stop) = (&shared.0, &shared.1);
    match (method, path) {
        (Method::Get, "/api/meta") => {
            let app = lock.lock().unwrap();
            let lm = LmStudio::list(&app.cfg.lmstudio_url);
            Ok(json!({
                "engine": engine_id(),
                "scenarios": builtin_ids(),
                "metrics": METRICS,
                "providers": {
                    "lmstudio": { "url": app.cfg.lmstudio_url, "available": lm.is_ok(),
                        "models": lm.unwrap_or_default(), "default_model": app.cfg.lmstudio_model },
                    "anthropic": { "key_present": Anthropic::key_present(),
                        "model": app.cfg.anthropic_model.clone().unwrap_or_else(|| crate::brain::provider::ANTHROPIC_DEFAULT_MODEL.into()) }
                }
            }))
        }
        (Method::Get, "/api/state") => {
            let app = lock.lock().unwrap();
            let w = app.world.as_ref().ok_or((404, "no game".to_string()))?;
            let scenario = app.scenario.as_ref().ok_or((404, "no game".to_string()))?;
            let since: usize = query(url, "since").and_then(|s| s.parse().ok()).unwrap_or(0);
            let brains: Vec<String> = app
                .seats
                .iter()
                .zip(app.brains.iter())
                .map(|(s, b)| {
                    if *s == Seat::Human {
                        "human".to_string()
                    } else {
                        b.descriptor()
                    }
                })
                .collect();
            let mut v = views::state(views::StateArgs {
                world: w,
                scenario,
                seats: &app.seats,
                brains: &brains,
                records: &app.records,
                human: &app.human,
                since,
                geometry: if query(url, "geo").is_some() {
                    app.geometry.clone()
                } else {
                    None
                },
            });
            v["job"] = serde_json::to_value(&app.job).expect("job serializes");
            v["parley"] = serde_json::to_value(&app.parley).expect("parley serializes");
            Ok(v)
        }
        (Method::Get, p) if p.starts_with("/api/turn/") => {
            let app = lock.lock().unwrap();
            let n: u32 = p["/api/turn/".len()..]
                .parse()
                .map_err(|_| (400, "bad turn".to_string()))?;
            let r = app
                .records
                .iter()
                .find(|r| r.turn == n)
                .ok_or((404, "no such turn".to_string()))?;
            Ok(serde_json::to_value(r).expect("record serializes"))
        }
        (Method::Get, p) if p.starts_with("/api/mind/") => {
            let app = lock.lock().unwrap();
            let w = app.world.as_ref().ok_or((404, "no game".to_string()))?;
            let c: CivId = p["/api/mind/".len()..]
                .parse()
                .map_err(|_| (400, "bad civ".to_string()))?;
            views::mind(w, &app.records, c).map_err(|e| (404, e))
        }
        (Method::Post, "/api/new") => {
            let mut app = lock.lock().unwrap();
            if app.job.running {
                return err(409, "a turn is running; stop it first");
            }
            let g: NewGame = parse(body)?;
            let scenario = match g.scenario.as_str() {
                "generated" => generate(
                    g.seed,
                    g.civs.unwrap_or(8).clamp(2, 12),
                    g.provinces.unwrap_or(64).clamp(16, 400),
                ),
                id => builtin(id, g.seed).ok_or((400, format!("unknown scenario `{id}`")))?,
            };
            let default = Seat::parse(g.default_seat.as_deref().unwrap_or("rules")).map_err(|e| (400, e))?;
            let mut seats = vec![default; scenario.civs.len()];
            for (k, v) in &g.seats {
                let i = scenario
                    .civs
                    .iter()
                    .position(|c| &c.key == k)
                    .ok_or((400, format!("unknown civilization `{k}`")))?;
                seats[i] = Seat::parse(v).map_err(|e| (400, e))?;
            }
            install(&mut app, scenario, g.seed, seats, g.interventions).map_err(|e| (400, e))?;
            Ok(json!({ "ok": true }))
        }
        (Method::Post, "/api/orders") => {
            let mut app = lock.lock().unwrap();
            let o: Orders = parse(body)?;
            let w = app.world.as_ref().ok_or((404, "no game".to_string()))?;
            if app.seats.get(o.civ) != Some(&Seat::Human) {
                return err(400, "that seat is not yours");
            }
            let menu = observe(w, o.civ).offered;
            let mut d = Decision::default();
            for i in o.actions.iter().take(crate::action::MAX_ACTIONS) {
                d.actions.push(
                    menu.get(*i)
                        .ok_or((400, format!("no offered action [{i}]")))?
                        .action
                        .clone(),
                );
            }
            d.responses = o.responses;
            // Orders sent without letters keep the letters already queued through
            // /api/letter, which the parley panel promised to deliver.
            d.messages = if o.messages.is_empty() {
                app.human.get(&o.civ).map(|q| q.messages.clone()).unwrap_or_default()
            } else {
                o.messages.into_iter().take(crate::action::MAX_MESSAGES).collect()
            };
            let chosen: Vec<String> = d.actions.iter().map(|a| describe(w, o.civ, a)).collect();
            app.human.insert(o.civ, d);
            Ok(json!({ "queued": chosen }))
        }
        (Method::Post, "/api/interpret") => {
            #[derive(Deserialize)]
            struct Ask {
                civ: CivId,
                text: String,
                provider: String,
            }
            let a: Ask = parse(body)?;
            let (obs, cfg) = {
                let app = lock.lock().unwrap();
                let w = app.world.as_ref().ok_or((404, "no game".to_string()))?;
                if a.civ >= w.civs.len() {
                    return err(404, "no such civilization");
                }
                (observe(w, a.civ), app.cfg.clone())
            };
            let provider = cfg.provider(&a.provider, None).map_err(|e| (503, e))?;
            let (picks, understood) = interpret_orders(provider.as_ref(), &obs, &a.text).map_err(|e| (502, e))?;
            Ok(json!({
                "actions": picks.iter().map(|&i| json!({ "index": i, "text": obs.offered[i].text })).collect::<Vec<_>>(),
                "understood": understood,
                "generation": "model",
                "model": provider.model(),
                "note": "Proposed by a model from your words. Nothing is queued until you confirm it."
            }))
        }
        (Method::Post, "/api/letter") => {
            #[derive(Deserialize)]
            struct Letter {
                from: CivId,
                to: CivId,
                text: String,
            }
            let l: Letter = parse(body)?;
            let text: String = l.text.chars().take(crate::action::MESSAGE_CHARS).collect();
            let (obs, memory, seat, cfg, from_name, turn) = {
                let mut app = lock.lock().unwrap();
                let w = app.world.as_ref().ok_or((404, "no game".to_string()))?.clone();
                if app.seats.get(l.from) != Some(&Seat::Human) || l.to >= w.civs.len() || l.to == l.from {
                    return err(400, "letters go from your seat to another power");
                }
                // The letter itself enters the world through the resolver, next turn.
                let d = app.human.entry(l.from).or_default();
                if d.messages.len() >= crate::action::MAX_MESSAGES {
                    return err(400, "at most three letters a season");
                }
                d.messages.push(Outgoing {
                    to: l.to,
                    text: text.clone(),
                });
                (
                    observe(&w, l.to),
                    w.memories[l.to].clone(),
                    app.seats[l.to].clone(),
                    app.cfg.clone(),
                    w.civs[l.from].name.clone(),
                    w.turn,
                )
            };
            let mut p = Parley {
                turn,
                from: l.from,
                to: l.to,
                letter: text.clone(),
                reply: None,
                reply_generation: None,
                reply_model: None,
                error: None,
            };
            if let Seat::Model { provider, model } = seat {
                match cfg.provider(&provider, model).and_then(|pr| {
                    reply_in_character(pr.as_ref(), &obs, &memory, &from_name, &text).map(|r| (r, pr.model()))
                }) {
                    Ok((r, m)) => {
                        p.reply = Some(r);
                        p.reply_generation = Some(Generation::Model);
                        p.reply_model = Some(m);
                    }
                    Err(e) => p.error = Some(e),
                }
            } else {
                p.error = Some("this power's seat is not a model; it will read your letter next season".into());
            }
            let mut app = lock.lock().unwrap();
            app.parley.push(p.clone());
            Ok(serde_json::to_value(p).expect("parley serializes"))
        }
        (Method::Post, "/api/step") => {
            #[derive(Deserialize)]
            struct Step {
                turns: u32,
            }
            let s: Step = parse(body)?;
            let mut app = lock.lock().unwrap();
            if app.job.running {
                return err(409, "a turn is already running");
            }
            if app.sim.is_none() {
                return err(404, "no game");
            }
            app.job = Job {
                running: true,
                target: s.turns.clamp(1, 400),
                done: 0,
                error: None,
            };
            stop.store(false, Ordering::SeqCst);
            let shared = shared.clone();
            std::thread::spawn(move || worker(shared));
            Ok(json!({ "started": true }))
        }
        (Method::Post, "/api/stop") => {
            stop.store(true, Ordering::SeqCst);
            Ok(json!({ "stopping": true }))
        }
        (Method::Get, "/api/save") => {
            let app = lock.lock().unwrap();
            let sim = app.sim.as_ref().ok_or((409, "a turn is running".to_string()))?;
            Ok(serde_json::to_value(sim.save()).expect("save serializes"))
        }
        (Method::Post, "/api/verify") => {
            let app = lock.lock().unwrap();
            let sim = app.sim.as_ref().ok_or((409, "a turn is running".to_string()))?;
            let (report, _) = Simulation::replay(&sim.save());
            Ok(serde_json::to_value(report).expect("report serializes"))
        }
        (Method::Post, "/api/load") => {
            let save: Save = parse(body)?;
            let (report, rebuilt) = Simulation::replay(&save);
            let Some(sim) = rebuilt else {
                return err(
                    422,
                    format!(
                        "refused: the save does not replay ({})",
                        report.reason.unwrap_or_default()
                    ),
                );
            };
            let mut app = lock.lock().unwrap();
            if app.job.running {
                return err(409, "a turn is running; stop it first");
            }
            let seats = save.seats.clone();
            install(
                &mut app,
                save.scenario.clone(),
                save.seed,
                seats.clone(),
                save.interventions.clone(),
            )
            .map_err(|e| (400, e))?;
            app.world = Some(sim.world.clone());
            app.records = sim.turns.clone();
            app.sim = Some(sim);
            Ok(json!({ "loaded": true, "replay": report }))
        }
        (Method::Post, "/api/experiment") => {
            let plan: Plan = parse(body)?;
            let total = plan.turns as u64 * plan.seeds.len() as u64 * plan.arms.len() as u64;
            if total > 20_000 {
                return err(
                    400,
                    "the workbench runs up to 20,000 simulated turns per experiment; use the CLI for more",
                );
            }
            let r = experiment::run(&plan).map_err(|e| (400, e))?;
            Ok(serde_json::to_value(r).expect("result serializes"))
        }
        _ => err(404, "no such endpoint"),
    }
}

fn worker(shared: Shared) {
    let (lock, stop) = (&shared.0, &shared.1);
    loop {
        let (mut sim, brains, mut human) = {
            let mut app = lock.lock().unwrap();
            if stop.load(Ordering::SeqCst) || app.job.done >= app.job.target {
                app.job.running = false;
                return;
            }
            let Some(sim) = app.sim.take() else {
                app.job.running = false;
                return;
            };
            (sim, std::mem::take(&mut app.brains), std::mem::take(&mut app.human))
        };
        let (before, kept) = (sim.world.clone(), sim.turns.len());
        let record = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| sim.step(&brains, &mut human).clone()));
        let mut app = lock.lock().unwrap();
        match record {
            Ok(r) => {
                app.records.push(r);
                app.world = Some(sim.world.clone());
                app.job.done += 1;
            }
            Err(_) => {
                sim.world = before;
                sim.turns.truncate(kept);
                app.job.error = Some("the turn failed and was rolled back; the history is unchanged".into());
                app.job.running = false;
            }
        }
        app.sim = Some(sim);
        app.brains = brains;
        if !app.job.running {
            return;
        }
    }
}
