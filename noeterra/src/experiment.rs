//! Controlled experiments over simulated histories. A plan names a scenario,
//! seeds, a horizon and arms that differ only by interventions or seat policy;
//! every arm runs on every seed, so arms are compared seed by seed.
//!
//! Every number this module produces is a simulated observation of an
//! illustrative model. None of it is evidence about the historical world.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::hash::sha256_hex;
use crate::model::*;
use crate::scenario::{builtin, generate, Scenario};
use crate::sim::{engine_id, run_offline, Intervention, Seat, Simulation};

pub const PLAN_SCHEMA: &str = "noeterra-experiment/v1";
pub const RESULT_SCHEMA: &str = "noeterra-experiment-result/v1";
pub const MAX_TURNS: u32 = 400;
pub const MAX_SEEDS: usize = 64;
pub const MAX_ARMS: usize = 6;
pub const EVIDENCE_CLASS: &str = "simulated";

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ScenarioRef {
    Builtin { id: String },
    Generated { civs: usize, provinces: usize },
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Policy {
    Rules,
    Amnesic,
    Random,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Arm {
    pub id: String,
    pub policy: Policy,
    #[serde(default)]
    pub interventions: Vec<Intervention>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Plan {
    pub schema: String,
    pub scenario: ScenarioRef,
    pub turns: u32,
    pub seeds: Vec<u64>,
    pub arms: Vec<Arm>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct RunResult {
    pub arm: String,
    pub seed: u64,
    pub initial_hash: String,
    pub final_hash: String,
    pub metrics: BTreeMap<String, f64>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Summary {
    pub mean: f64,
    pub min: f64,
    pub max: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Paired {
    pub arm: String,
    pub baseline: String,
    pub metric: String,
    pub mean_delta: f64,
    pub increased: usize,
    pub decreased: usize,
    pub unchanged: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ExperimentResult {
    pub schema: String,
    pub engine: String,
    pub evidence_class: String,
    pub plan_sha256: String,
    pub scenario_sha256: String,
    pub runs: Vec<RunResult>,
    pub summary: BTreeMap<String, BTreeMap<String, Summary>>,
    pub paired: Vec<Paired>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct MetricDef {
    pub id: &'static str,
    pub unit: &'static str,
    pub description: &'static str,
}

pub const METRICS: &[MetricDef] = &[
    MetricDef {
        id: "wars_declared",
        unit: "count",
        description: "wars declared over the horizon",
    },
    MetricDef {
        id: "pacts_broken",
        unit: "count",
        description: "wars declared in breach of a non-aggression pact",
    },
    MetricDef {
        id: "peace_treaties",
        unit: "count",
        description: "peace settlements concluded",
    },
    MetricDef {
        id: "battles",
        unit: "count",
        description: "battles fought",
    },
    MetricDef {
        id: "battle_losses",
        unit: "thousand soldiers",
        description: "soldiers lost or scattered in battle",
    },
    MetricDef {
        id: "occupations",
        unit: "count",
        description: "provinces occupied by an enemy",
    },
    MetricDef {
        id: "conquests",
        unit: "count",
        description: "unclaimed or rebel provinces annexed",
    },
    MetricDef {
        id: "revolts",
        unit: "count",
        description: "provinces lost to revolt",
    },
    MetricDef {
        id: "treaties_signed",
        unit: "count",
        description: "alliances, pacts and trade agreements concluded",
    },
    MetricDef {
        id: "alliances_broken",
        unit: "count",
        description: "alliances broken by a refused call to arms",
    },
    MetricDef {
        id: "civs_fallen",
        unit: "count",
        description: "civilizations that lost every province",
    },
    MetricDef {
        id: "surviving_civs",
        unit: "count",
        description: "civilizations alive at the end",
    },
    MetricDef {
        id: "province_hhi",
        unit: "index 0..1",
        description: "Herfindahl index of province shares among surviving civilizations",
    },
    MetricDef {
        id: "largest_share",
        unit: "fraction",
        description: "share of owned provinces held by the largest civilization",
    },
    MetricDef {
        id: "peace_fraction",
        unit: "fraction",
        description: "fraction of turns that ended with no war in progress",
    },
    MetricDef {
        id: "mean_stability",
        unit: "points 0..100",
        description: "mean stability of surviving civilizations at the end",
    },
    MetricDef {
        id: "total_population",
        unit: "thousand people",
        description: "population of all provinces at the end",
    },
    MetricDef {
        id: "unowned_provinces",
        unit: "count",
        description: "provinces held by no civilization at the end",
    },
];

pub fn scenario_of(r: &ScenarioRef) -> Result<Scenario, String> {
    match r {
        ScenarioRef::Builtin { id } => builtin(id, 0).ok_or_else(|| format!("unknown scenario `{id}`")),
        ScenarioRef::Generated { civs, provinces } => {
            if !(2..=12).contains(civs) || !(9..=600).contains(provinces) || civs * 2 > *provinces {
                return Err("generated worlds take 2-12 civilizations and 9-600 provinces".into());
            }
            Ok(generate(0x5EED, *civs, *provinces))
        }
    }
}

pub fn validate_plan(p: &Plan) -> Result<Scenario, String> {
    if p.schema != PLAN_SCHEMA {
        return Err(format!("plan schema must be {PLAN_SCHEMA}"));
    }
    if p.turns == 0 || p.turns > MAX_TURNS {
        return Err(format!("turns must be 1..={MAX_TURNS}"));
    }
    if p.seeds.is_empty() || p.seeds.len() > MAX_SEEDS {
        return Err(format!("1..={MAX_SEEDS} seeds"));
    }
    let mut seeds = p.seeds.clone();
    seeds.sort_unstable();
    seeds.dedup();
    if seeds.len() != p.seeds.len() {
        return Err("seeds repeat".into());
    }
    if p.arms.is_empty() || p.arms.len() > MAX_ARMS {
        return Err(format!("1..={MAX_ARMS} arms"));
    }
    let mut ids: Vec<&str> = p.arms.iter().map(|a| a.id.as_str()).collect();
    ids.sort_unstable();
    ids.dedup();
    if ids.len() != p.arms.len() || p.arms.iter().any(|a| a.id.is_empty() || a.id.len() > 40) {
        return Err("arm ids must be unique, non-empty and short".into());
    }
    let scenario = scenario_of(&p.scenario)?;
    for a in &p.arms {
        Simulation::new(scenario.clone(), 0, Vec::new(), a.interventions.clone())
            .map_err(|e| format!("arm `{}`: {e}", a.id))?;
    }
    Ok(scenario)
}

pub fn plan_sha256(p: &Plan) -> String {
    sha256_hex(serde_json::to_string(p).expect("plan serializes").as_bytes())
}

pub fn metrics(sim: &Simulation) -> BTreeMap<String, f64> {
    let w = &sim.world;
    let count = |k: &str| w.events.iter().filter(|e| e.kind == k).count() as f64;
    let mut m = BTreeMap::new();
    m.insert("wars_declared".into(), count("war"));
    m.insert(
        "pacts_broken".into(),
        w.events
            .iter()
            .filter(|e| e.kind == "war" && e.text.contains("breaking"))
            .count() as f64,
    );
    m.insert("peace_treaties".into(), count("peace"));
    m.insert("battles".into(), count("battle"));
    m.insert(
        "battle_losses".into(),
        round2(
            w.events
                .iter()
                .filter(|e| e.kind == "battle")
                .map(|e| e.magnitude)
                .sum(),
        ),
    );
    m.insert("occupations".into(), count("occupation"));
    m.insert("conquests".into(), count("conquest"));
    m.insert("revolts".into(), count("revolt"));
    m.insert("treaties_signed".into(), count("treaty"));
    m.insert("alliances_broken".into(), count("alliance_broken"));
    m.insert("civs_fallen".into(), count("fall"));
    let alive: Vec<&Civ> = w.civs.iter().filter(|c| c.alive).collect();
    m.insert("surviving_civs".into(), alive.len() as f64);
    let owned: Vec<f64> = alive.iter().map(|c| w.provinces_of(c.id).count() as f64).collect();
    let total: f64 = owned.iter().sum();
    let hhi = if total > 0.0 {
        owned.iter().map(|x| (x / total) * (x / total)).sum()
    } else {
        0.0
    };
    m.insert("province_hhi".into(), round4(hhi));
    m.insert(
        "largest_share".into(),
        round4(if total > 0.0 {
            owned.iter().cloned().fold(0.0, f64::max) / total
        } else {
            0.0
        }),
    );
    let turns = sim.turns.len().max(1) as f64;
    let peaceful = sim.turns.iter().filter(|t| t.wars_after == 0).count() as f64;
    m.insert("peace_fraction".into(), round4(peaceful / turns));
    m.insert(
        "mean_stability".into(),
        round2(if alive.is_empty() {
            0.0
        } else {
            alive.iter().map(|c| c.stability).sum::<f64>() / alive.len() as f64
        }),
    );
    m.insert(
        "total_population".into(),
        round2(w.provinces.iter().map(|p| p.population).sum()),
    );
    m.insert(
        "unowned_provinces".into(),
        w.provinces.iter().filter(|p| p.owner.is_none()).count() as f64,
    );
    for c in &w.civs {
        m.insert(format!("provinces.{}", c.key), w.provinces_of(c.id).count() as f64);
        m.insert(format!("alive.{}", c.key), if c.alive { 1.0 } else { 0.0 });
    }
    m
}

fn round4(x: f64) -> f64 {
    (x * 10_000.0).round() / 10_000.0
}

pub fn seats_for(policy: Policy, n: usize) -> Vec<Seat> {
    let s = match policy {
        Policy::Rules => Seat::Rules,
        Policy::Amnesic => Seat::Amnesic,
        Policy::Random => Seat::Random,
    };
    vec![s; n]
}

pub fn run_one(scenario: &Scenario, arm: &Arm, seed: u64, turns: u32) -> Result<RunResult, String> {
    let n = scenario.civs.len();
    let mut sim = Simulation::new(
        scenario.clone(),
        seed,
        seats_for(arm.policy, n),
        arm.interventions.clone(),
    )?;
    run_offline(&mut sim, turns);
    Ok(RunResult {
        arm: arm.id.clone(),
        seed,
        initial_hash: sim.initial_hash.clone(),
        final_hash: sim
            .turns
            .last()
            .map(|t| t.hash.clone())
            .unwrap_or_else(|| sim.initial_hash.clone()),
        metrics: metrics(&sim),
    })
}

pub fn run(plan: &Plan) -> Result<ExperimentResult, String> {
    let scenario = validate_plan(plan)?;
    let mut runs = Vec::new();
    for arm in &plan.arms {
        for &seed in &plan.seeds {
            runs.push(run_one(&scenario, arm, seed, plan.turns)?);
        }
    }
    let mut summary: BTreeMap<String, BTreeMap<String, Summary>> = BTreeMap::new();
    for arm in &plan.arms {
        let mine: Vec<&RunResult> = runs.iter().filter(|r| r.arm == arm.id).collect();
        let mut s = BTreeMap::new();
        for key in mine[0].metrics.keys() {
            let xs: Vec<f64> = mine.iter().map(|r| r.metrics[key]).collect();
            s.insert(
                key.clone(),
                Summary {
                    mean: round4(xs.iter().sum::<f64>() / xs.len() as f64),
                    min: xs.iter().cloned().fold(f64::INFINITY, f64::min),
                    max: xs.iter().cloned().fold(f64::NEG_INFINITY, f64::max),
                },
            );
        }
        summary.insert(arm.id.clone(), s);
    }
    let mut paired = Vec::new();
    let baseline = &plan.arms[0];
    for arm in plan.arms.iter().skip(1) {
        for def in METRICS {
            let mut deltas = Vec::new();
            for &seed in &plan.seeds {
                let b = runs
                    .iter()
                    .find(|r| r.arm == baseline.id && r.seed == seed)
                    .expect("baseline ran");
                let t = runs
                    .iter()
                    .find(|r| r.arm == arm.id && r.seed == seed)
                    .expect("arm ran");
                deltas.push(t.metrics[def.id] - b.metrics[def.id]);
            }
            paired.push(Paired {
                arm: arm.id.clone(),
                baseline: baseline.id.clone(),
                metric: def.id.into(),
                mean_delta: round4(deltas.iter().sum::<f64>() / deltas.len() as f64),
                increased: deltas.iter().filter(|d| **d > 0.0).count(),
                decreased: deltas.iter().filter(|d| **d < 0.0).count(),
                unchanged: deltas.iter().filter(|d| **d == 0.0).count(),
            });
        }
    }
    Ok(ExperimentResult {
        schema: RESULT_SCHEMA.into(),
        engine: engine_id(),
        evidence_class: EVIDENCE_CLASS.into(),
        plan_sha256: plan_sha256(plan),
        scenario_sha256: scenario.sha256(),
        runs,
        summary,
        paired,
    })
}

/// Re-runs a plan and checks every run reaches the hashes the result claims.
pub fn verify(plan: &Plan, result: &ExperimentResult) -> Result<(), String> {
    if result.plan_sha256 != plan_sha256(plan) {
        return Err("the result was produced by a different plan".into());
    }
    let again = run(plan)?;
    if again.runs.len() != result.runs.len() {
        return Err("run count differs".into());
    }
    for (a, b) in again.runs.iter().zip(result.runs.iter()) {
        if a.arm != b.arm || a.seed != b.seed {
            return Err("runs are out of order".into());
        }
        if a.final_hash != b.final_hash {
            return Err(format!(
                "arm `{}` seed {} reached {} not {}",
                a.arm, a.seed, a.final_hash, b.final_hash
            ));
        }
        if a.metrics != b.metrics {
            return Err(format!("arm `{}` seed {} metrics differ", a.arm, a.seed));
        }
    }
    if again.summary != result.summary || again.paired != result.paired {
        return Err("summary differs from the runs".into());
    }
    Ok(())
}
