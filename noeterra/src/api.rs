//! The JSON request surface shared by the WebAssembly module, the CLI and tests.
//! Every request is a closed `op`; every answer is `{ ok, result | error }`.
//!
//! Stateless ops (experiments, verification, replay) are what the R.A.I.N. Lab
//! uses, with a fresh instance per call. Session ops keep a running history in
//! the instance's memory; the browser game keeps one instance for the page.
//! Sessions hold rule-based, random and human seats only: model seats need a
//! network and live in the local workbench.

use std::cell::{Cell, RefCell};
use std::collections::BTreeMap;

use serde::Deserialize;
use serde_json::{json, Value};

use crate::action::{describe, Decision, Outgoing, Response, MAX_ACTIONS, MAX_MESSAGES, MESSAGE_CHARS};
use crate::experiment::{self, Plan, METRICS};
use crate::geometry::geometry;
use crate::model::CivId;
use crate::observe::observe;
use crate::scenario::builtin;
use crate::sim::{engine_id, offline_brains, Save, Seat, Simulation};
use crate::views;

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum Request {
    Version,
    Metrics,
    Scenarios,
    Validate {
        plan: Plan,
    },
    Experiment {
        plan: Plan,
    },
    Verify {
        plan: Plan,
        result: experiment::ExperimentResult,
    },
    Replay {
        save: Save,
    },
    SessionNew {
        scenario: String,
        seed: u64,
        #[serde(default)]
        seats: BTreeMap<String, String>,
        #[serde(default)]
        default_seat: Option<String>,
    },
    SessionState {
        session: u32,
        #[serde(default)]
        since: usize,
        #[serde(default)]
        geometry: bool,
    },
    SessionOrders {
        session: u32,
        civ: CivId,
        #[serde(default)]
        actions: Vec<usize>,
        #[serde(default)]
        responses: Vec<Response>,
        #[serde(default)]
        messages: Vec<Outgoing>,
    },
    SessionAdvance {
        session: u32,
        turns: u32,
    },
    SessionMind {
        session: u32,
        civ: CivId,
    },
    SessionTurn {
        session: u32,
        turn: u32,
    },
    SessionSave {
        session: u32,
    },
    SessionLoad {
        save: Save,
    },
    SessionVerify {
        session: u32,
    },
    SessionClose {
        session: u32,
    },
}

struct Session {
    sim: Simulation,
    human: BTreeMap<CivId, Decision>,
    geometry: Value,
}

thread_local! {
    static SESSIONS: RefCell<BTreeMap<u32, Session>> = const { RefCell::new(BTreeMap::new()) };
    static NEXT: Cell<u32> = const { Cell::new(1) };
}

pub const MAX_ADVANCE: u32 = 40;
const MAX_SESSIONS: usize = 4;

fn open(sim: Simulation) -> u32 {
    let geometry = serde_json::to_value(geometry(&sim.world)).expect("geometry serializes");
    let id = NEXT.with(|n| {
        let id = n.get();
        n.set(id + 1);
        id
    });
    SESSIONS.with(|s| {
        let mut s = s.borrow_mut();
        while s.len() >= MAX_SESSIONS {
            let oldest = *s.keys().next().expect("non-empty");
            s.remove(&oldest);
        }
        s.insert(
            id,
            Session {
                sim,
                human: BTreeMap::new(),
                geometry,
            },
        );
    });
    id
}

fn with<T>(id: u32, f: impl FnOnce(&mut Session) -> Result<T, String>) -> Result<T, String> {
    SESSIONS.with(|s| match s.borrow_mut().get_mut(&id) {
        Some(session) => f(session),
        None => Err("no such session; start a new world".into()),
    })
}

fn browser_seat(s: &str) -> Result<Seat, String> {
    match Seat::parse(s)? {
        Seat::Model { .. } => Err("model seats run in the local workbench, not in the browser".into()),
        seat => Ok(seat),
    }
}

fn brain_names(seats: &[Seat]) -> Vec<String> {
    seats
        .iter()
        .zip(offline_brains(seats))
        .map(|(s, b)| {
            if *s == Seat::Human {
                "human".into()
            } else {
                b.descriptor()
            }
        })
        .collect()
}

pub fn handle(text: &str) -> String {
    let answer = match serde_json::from_str::<Request>(text) {
        Err(e) => Err(format!("request is not valid: {e}")),
        Ok(r) => dispatch(r),
    };
    match answer {
        Ok(result) => json!({ "ok": true, "result": result }).to_string(),
        Err(error) => json!({ "ok": false, "error": error }).to_string(),
    }
}

fn dispatch(r: Request) -> Result<Value, String> {
    match r {
        Request::Version => Ok(json!({ "engine": engine_id(), "plan_schema": experiment::PLAN_SCHEMA,
            "result_schema": experiment::RESULT_SCHEMA, "save_schema": crate::model::SAVE_SCHEMA })),
        Request::Metrics => Ok(serde_json::to_value(METRICS).expect("metrics serialize")),
        Request::Scenarios => Ok(views::scenarios()),
        Request::Validate { plan } => {
            let s = experiment::validate_plan(&plan)?;
            Ok(
                json!({ "plan_sha256": experiment::plan_sha256(&plan), "scenario_sha256": s.sha256(),
                "civilizations": s.civs.iter().map(|c| c.key.clone()).collect::<Vec<_>>() }),
            )
        }
        Request::Experiment { plan } => Ok(serde_json::to_value(experiment::run(&plan)?).expect("result serializes")),
        Request::Verify { plan, result } => {
            experiment::verify(&plan, &result)?;
            Ok(json!({ "verified": true }))
        }
        Request::Replay { save } => {
            let (report, _) = Simulation::replay(&save);
            Ok(serde_json::to_value(report).expect("report serializes"))
        }
        Request::SessionNew {
            scenario,
            seed,
            seats,
            default_seat,
        } => {
            let s = builtin(&scenario, seed)
                .filter(|_| scenario != "generated")
                .ok_or_else(|| format!("unknown scenario `{scenario}`"))?;
            let default = browser_seat(default_seat.as_deref().unwrap_or("rules"))?;
            let mut list = vec![default; s.civs.len()];
            for (k, v) in &seats {
                let i = s
                    .civs
                    .iter()
                    .position(|c| &c.key == k)
                    .ok_or_else(|| format!("unknown civilization `{k}`"))?;
                list[i] = browser_seat(v)?;
            }
            let sim = Simulation::new(s, seed, list, Vec::new())?;
            Ok(json!({ "session": open(sim) }))
        }
        Request::SessionState {
            session,
            since,
            geometry,
        } => with(session, |s| {
            Ok(views::state(views::StateArgs {
                world: &s.sim.world,
                scenario: &s.sim.scenario,
                seats: &s.sim.seats,
                brains: &brain_names(&s.sim.seats),
                records: &s.sim.turns,
                human: &s.human,
                since,
                geometry: geometry.then(|| s.geometry.clone()),
            }))
        }),
        Request::SessionOrders {
            session,
            civ,
            actions,
            responses,
            messages,
        } => with(session, |s| {
            if s.sim.seats.get(civ) != Some(&Seat::Human) {
                return Err("that seat is not yours".into());
            }
            let menu = observe(&s.sim.world, civ).offered;
            let mut d = Decision::default();
            for i in actions.iter().take(MAX_ACTIONS) {
                d.actions.push(
                    menu.get(*i)
                        .ok_or_else(|| format!("no offered action [{i}]"))?
                        .action
                        .clone(),
                );
            }
            d.responses = responses;
            d.messages = messages
                .into_iter()
                .take(MAX_MESSAGES)
                .map(|m| Outgoing {
                    to: m.to,
                    text: m.text.chars().take(MESSAGE_CHARS).collect(),
                })
                .collect();
            let chosen: Vec<String> = d.actions.iter().map(|a| describe(&s.sim.world, civ, a)).collect();
            s.human.insert(civ, d);
            Ok(json!({ "queued": chosen }))
        }),
        Request::SessionAdvance { session, turns } => with(session, |s| {
            let brains = offline_brains(&s.sim.seats);
            let first = s.sim.world.events.len();
            for _ in 0..turns.clamp(1, MAX_ADVANCE) {
                let mut human = std::mem::take(&mut s.human);
                s.sim.step(&brains, &mut human);
                if s.sim
                    .world
                    .civs
                    .iter()
                    .enumerate()
                    .any(|(c, civ)| s.sim.seats[c] == Seat::Human && !civ.alive)
                {
                    break;
                }
            }
            Ok(
                json!({ "turn": s.sim.world.turn, "date": s.sim.world.date(), "first_event": first,
                "hash": s.sim.turns.last().map(|t| t.hash.clone()) }),
            )
        }),
        Request::SessionMind { session, civ } => with(session, |s| views::mind(&s.sim.world, &s.sim.turns, civ)),
        Request::SessionTurn { session, turn } => with(session, |s| {
            let r = s.sim.turns.iter().find(|r| r.turn == turn).ok_or("no such season")?;
            Ok(serde_json::to_value(r).expect("record serializes"))
        }),
        Request::SessionSave { session } => with(session, |s| {
            Ok(serde_json::to_value(s.sim.save()).expect("save serializes"))
        }),
        Request::SessionLoad { save } => {
            // A history played by models loads too: replay needs only its records.
            let (report, rebuilt) = Simulation::replay(&save);
            let sim = rebuilt.ok_or_else(|| {
                format!(
                    "refused: the save does not replay ({})",
                    report.reason.clone().unwrap_or_default()
                )
            })?;
            Ok(json!({ "session": open(sim), "replay": report }))
        }
        Request::SessionVerify { session } => with(session, |s| {
            let (report, _) = Simulation::replay(&s.sim.save());
            Ok(serde_json::to_value(report).expect("report serializes"))
        }),
        Request::SessionClose { session } => {
            SESSIONS.with(|s| s.borrow_mut().remove(&session));
            Ok(json!({ "closed": session }))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn call(v: Value) -> Value {
        let out: Value = serde_json::from_str(&handle(&v.to_string())).unwrap();
        assert_eq!(out["ok"], true, "{out}");
        out["result"].clone()
    }

    #[test]
    fn a_browser_session_plays_a_human_seat_and_replays() {
        let cards = call(json!({ "op": "scenarios" }));
        assert!(cards.as_array().unwrap().iter().any(|c| c["id"] == "tarim-77bc"));
        let id =
            call(json!({ "op": "session_new", "scenario": "tarim-77bc", "seed": 3, "seats": { "loulan": "human" } }))
                ["session"]
                .as_u64()
                .unwrap();
        let st = call(json!({ "op": "session_state", "session": id, "geometry": true }));
        assert_eq!(st["date"], "Spring 77 BC");
        assert!(st["geometry"]["shapes"].as_array().unwrap().len() > 20);
        let menu = st["humans"][0]["offered"].as_array().unwrap().clone();
        assert!(!menu.is_empty());
        let queued = call(json!({ "op": "session_orders", "session": id, "civ": 2, "actions": [0] }));
        assert_eq!(queued["queued"].as_array().unwrap().len(), 1);
        call(json!({ "op": "session_advance", "session": id, "turns": 6 }));
        let rec = call(json!({ "op": "session_turn", "session": id, "turn": 0 }));
        assert_eq!(rec["decisions"][2]["label"], "human");
        let verified = call(json!({ "op": "session_verify", "session": id }));
        assert_eq!(verified["ok"], true);
        let save = call(json!({ "op": "session_save", "session": id }));
        let again = call(json!({ "op": "session_load", "save": save }));
        assert_eq!(again["replay"]["turns_checked"], 6);
        let mind = call(json!({ "op": "session_mind", "session": id, "civ": 0 }));
        assert!(mind["goals"].as_array().is_some());
    }

    #[test]
    fn model_seats_and_unknown_sessions_are_refused_in_the_browser() {
        let out: Value = serde_json::from_str(&handle(
            &json!({ "op": "session_new", "scenario": "tarim-77bc", "seed": 1, "seats": { "han": "anthropic" } })
                .to_string(),
        ))
        .unwrap();
        assert_eq!(out["ok"], false);
        assert!(out["error"].as_str().unwrap().contains("workbench"));
        let out: Value = serde_json::from_str(&handle(
            &json!({ "op": "session_state", "session": 999999 }).to_string(),
        ))
        .unwrap();
        assert_eq!(out["ok"], false);
    }
}
