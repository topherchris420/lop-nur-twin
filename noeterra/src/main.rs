use std::collections::BTreeMap;
use std::process::ExitCode;

use noeterra::experiment::{self, Plan};
use noeterra::model::date_of;
use noeterra::scenario::{builtin, generate};
use noeterra::server::{serve, Config};
use noeterra::sim::{Save, Seat, Simulation};

const HELP: &str = "noeterra — autonomous civilizations in a deterministic, replayable world

USAGE
  noeterra serve [--port 7878]
      The interactive workbench at http://127.0.0.1:7878 (loopback only).
  noeterra run [--scenario mediterranean-264bc|generated] [--seed N] [--turns N]
             [--seat KEY=SEAT]... [--default-seat SEAT] [--out save.json] [--live]
      Runs a history and prints its chronicle. SEAT is rules, amnesic, random,
      lmstudio[:model] or anthropic[:model]. Model seats need --live.
  noeterra replay save.json
      Re-simulates a save and checks every turn's state hash.
  noeterra experiment plan.json [--out result.json]
      Runs a noeterra-experiment/v1 plan (rule-based seats only).
  noeterra verify plan.json result.json
      Re-runs a plan and checks a result against it.
  noeterra design --question TEXT [--provider anthropic|lmstudio] [--context prior.txt]
                [--out design.json] [--receipt receipt.json] --live
      A model proposes a rain-civilization-design/v1 for the R.A.I.N. Lab, with a
      receipt of the exact exchange. Nothing runs until the lab compiles it and an
      operator authorizes its digest.
  noeterra prompt [--civ KEY] [--json]
      Prints the exact question a model seat would be asked this season.
  noeterra metrics
      Lists the experiment metrics.

ENVIRONMENT
  NOETERRA_LMSTUDIO_URL     default http://127.0.0.1:1234/v1 (loopback/private only)
  NOETERRA_LMSTUDIO_MODEL   else RAIN_MODEL, else the server's first chat model
  ANTHROPIC_API_KEY       read by curl at call time; never logged or recorded
  NOETERRA_ANTHROPIC_MODEL  default claude-opus-5-5
  NOETERRA_MODEL_TIMEOUT    seconds per model call (default 240)

Every number Noeterra produces is a simulated observation of an illustrative
model. None of it is evidence about the historical world.";

fn flag(args: &[String], name: &str) -> Option<String> {
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1).cloned())
}

fn flags(args: &[String], name: &str) -> Vec<String> {
    args.windows(2).filter(|w| w[0] == name).map(|w| w[1].clone()).collect()
}

fn read(path: &str) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|e| format!("cannot read {path}: {e}"))
}

fn write(path: &str, text: &str) -> Result<(), String> {
    std::fs::write(path, text).map_err(|e| format!("cannot write {path}: {e}"))
}

fn run(args: &[String]) -> Result<(), String> {
    let cmd = args.first().map(String::as_str).unwrap_or("help");
    match cmd {
        "serve" => {
            let port = flag(args, "--port").and_then(|p| p.parse().ok()).unwrap_or(7878);
            serve(Config::from_env(port))
        }
        "run" => {
            let seed: u64 = flag(args, "--seed").and_then(|s| s.parse().ok()).unwrap_or(1);
            let turns: u32 = flag(args, "--turns")
                .and_then(|s| s.parse().ok())
                .unwrap_or(40)
                .clamp(1, 2000);
            let scenario = match flag(args, "--scenario").as_deref().unwrap_or("mediterranean-264bc") {
                "generated" => generate(seed, 8, 64),
                id => builtin(id, seed).ok_or_else(|| format!("unknown scenario `{id}`"))?,
            };
            let default = Seat::parse(&flag(args, "--default-seat").unwrap_or_else(|| "rules".into()))?;
            let mut seats = vec![default; scenario.civs.len()];
            for s in flags(args, "--seat") {
                let (k, v) = s.split_once('=').ok_or("--seat takes KEY=SEAT")?;
                let i = scenario
                    .civs
                    .iter()
                    .position(|c| c.key == k)
                    .ok_or_else(|| format!("unknown civilization `{k}`"))?;
                seats[i] = Seat::parse(v)?;
            }
            if seats.iter().any(|s| matches!(s, Seat::Model { .. })) && !args.iter().any(|a| a == "--live") {
                return Err(
                    "model seats call a model server (and Anthropic seats spend credit); pass --live to confirm".into(),
                );
            }
            if seats.contains(&Seat::Human) {
                return Err("human seats are played in the workbench (`noeterra serve`)".into());
            }
            let cfg = Config::from_env(0);
            let brains = cfg.brains(&seats)?;
            let mut sim = Simulation::new(scenario, seed, seats, Vec::new())?;
            let mut none = BTreeMap::new();
            let mut shown = 0;
            for _ in 0..turns {
                let rec = sim.step(&brains, &mut none).clone();
                let w = &sim.world;
                for e in &w.events[shown..] {
                    if !matches!(e.kind.as_str(), "harvest" | "windfall" | "gift" | "tribute_refused") {
                        println!("{:<18} {}", date_of(w.start_year, e.turn), e.text);
                    }
                }
                shown = w.events.len();
                for d in rec
                    .decisions
                    .iter()
                    .filter(|d| d.error.is_some() || d.rationale.is_some())
                {
                    let name = &w.civs[d.civ].name;
                    if let Some(e) = &d.error {
                        println!("{:<18}   [{name}: {:?} — {e}]", "", d.label);
                    } else if let Some(r) = &d.rationale {
                        println!("{:<18}   [{name}, {} (model-written)]: {r}", "", d.brain);
                    }
                }
            }
            let w = &sim.world;
            println!(
                "\n{} — final state hash {}",
                w.date(),
                sim.turns.last().map(|t| t.hash.as_str()).unwrap_or("")
            );
            for c in &w.civs {
                println!(
                    "  {:<26} {:<9} provinces {:>2}  armies {:>5.1}k  treasury {:>7.1}  stability {:>5.1}",
                    c.name,
                    if c.alive { "" } else { "(fallen)" },
                    w.provinces_of(c.id).count(),
                    w.strength_of(c.id),
                    c.treasury,
                    c.stability
                );
            }
            if let Some(out) = flag(args, "--out") {
                write(&out, &serde_json::to_string(&sim.save()).map_err(|e| e.to_string())?)?;
                println!("saved {out}");
            }
            Ok(())
        }
        "replay" => {
            let path = args.get(1).ok_or("replay takes a save file")?;
            let save: Save = serde_json::from_str(&read(path)?).map_err(|e| format!("not a save: {e}"))?;
            let (report, _) = Simulation::replay(&save);
            println!("{}", serde_json::to_string_pretty(&report).map_err(|e| e.to_string())?);
            if report.ok {
                Ok(())
            } else {
                Err("replay diverged".into())
            }
        }
        "experiment" => {
            let path = args.get(1).ok_or("experiment takes a plan file")?;
            let plan: Plan = serde_json::from_str(&read(path)?).map_err(|e| format!("not a plan: {e}"))?;
            let r = experiment::run(&plan)?;
            for p in r.paired.iter().filter(|p| p.mean_delta != 0.0) {
                println!(
                    "{:<16} vs {:<12} {:<18} mean change {:+9.3}  (up {}, down {}, same {})",
                    p.arm, p.baseline, p.metric, p.mean_delta, p.increased, p.decreased, p.unchanged
                );
            }
            let text = serde_json::to_string_pretty(&r).map_err(|e| e.to_string())?;
            match flag(args, "--out") {
                Some(out) => write(&out, &text),
                None => {
                    println!("{text}");
                    Ok(())
                }
            }
        }
        "verify" => {
            let plan: Plan =
                serde_json::from_str(&read(args.get(1).ok_or("verify takes a plan")?)?).map_err(|e| e.to_string())?;
            let result =
                serde_json::from_str(&read(args.get(2).ok_or("verify takes a result")?)?).map_err(|e| e.to_string())?;
            experiment::verify(&plan, &result)?;
            println!("verified: every run reproduces its recorded hash and metrics");
            Ok(())
        }
        "prompt" => {
            let seed: u64 = flag(args, "--seed").and_then(|s| s.parse().ok()).unwrap_or(1);
            let scenario = builtin(
                flag(args, "--scenario").as_deref().unwrap_or("mediterranean-264bc"),
                seed,
            )
            .ok_or("unknown scenario")?;
            let sim = Simulation::new(scenario, seed, Vec::new(), Vec::new())?;
            let key = flag(args, "--civ").unwrap_or_else(|| sim.world.civs[0].key.clone());
            let c = sim
                .world
                .civ_by_key(&key)
                .ok_or_else(|| format!("unknown civilization `{key}`"))?;
            let obs = noeterra::observe::observe(&sim.world, c);
            if args.iter().any(|a| a == "--json") {
                let body = serde_json::json!({
                    "system": noeterra::brain::llm::system_prompt(&obs),
                    "user": noeterra::brain::llm::situation_report(&obs, &sim.world.memories[c]),
                    "schema": noeterra::brain::llm::decision_schema(),
                });
                println!("{body}");
            } else {
                println!(
                    "{}\n\n{}",
                    noeterra::brain::llm::system_prompt(&obs),
                    noeterra::brain::llm::situation_report(&obs, &sim.world.memories[c])
                );
            }
            Ok(())
        }
        "design" => {
            let question = flag(args, "--question").ok_or("design takes --question")?;
            let provider = flag(args, "--provider").unwrap_or_else(|| "anthropic".into());
            if !args.iter().any(|a| a == "--live") {
                return Err("design calls a model (Anthropic spends credit); pass --live to confirm".into());
            }
            let context = match flag(args, "--context") {
                Some(p) => read(&p)?,
                None => String::new(),
            };
            let cfg = Config::from_env(0);
            let p = cfg.provider(&provider, flag(args, "--model"))?;
            let (receipt, design) = noeterra::design::propose(p.as_ref(), &question, &context, &iso_now())?;
            let out = flag(args, "--out").unwrap_or_else(|| "design.json".into());
            let rec = flag(args, "--receipt").unwrap_or_else(|| "design-receipt.json".into());
            write(&rec, &receipt)?;
            write(&out, &serde_json::to_string_pretty(&design).map_err(|e| e.to_string())?)?;
            println!(
                "model-written design proposal -> {out}
receipt -> {rec} (sha256 {})",
                design["provenance"]["decision_sha256"].as_str().unwrap_or("")
            );
            println!("Nothing has run. Compile and review it with: npm run rain:civilization -- --design {out} --receipt {rec}");
            Ok(())
        }
        "metrics" => {
            for m in experiment::METRICS {
                println!("{:<20} {:<18} {}", m.id, m.unit, m.description);
            }
            Ok(())
        }
        _ => {
            println!("{HELP}");
            Ok(())
        }
    }
}

/// UTC now as RFC 3339, without a date library.
fn iso_now() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0) as i64;
    let (days, rem) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
    // Civil-from-days (Howard Hinnant).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z",
        rem / 3600,
        rem % 3600 / 60,
        rem % 60
    )
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match run(&args) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("noeterra: {e}");
            ExitCode::FAILURE
        }
    }
}
