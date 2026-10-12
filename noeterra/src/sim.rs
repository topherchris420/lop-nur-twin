//! A running history: the world, who sits in each seat, and the record of every
//! decision and the state hash after each turn. A save is enough to rebuild the
//! history exactly, without any of the brains that made it.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::action::{describe, Decision};
use crate::brain::utility::UtilityBrain;
use crate::brain::{Brain, BrainOutput, Label, RandomBrain, Usage};
use crate::hash::world_hash;
use crate::model::*;
use crate::observe::observe;
use crate::resolve::{resolve_turn, Submission, TurnReport};
use crate::scenario::{build, Scenario};

/// A change to the starting world, applied after the scenario is built. The
/// closed vocabulary of experimental manipulations.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Intervention {
    SetTrait { civ: String, r#trait: String, value: f64 },
    SetOpinion { a: String, b: String, value: f64 },
    AddTreaty { kind: TreatyKind, a: String, b: String },
    RemoveTreaty { kind: TreatyKind, a: String, b: String },
    ScaleTreasury { civ: String, factor: f64 },
    ScaleArmies { civ: String, factor: f64 },
    AddClaim { civ: String, province: String },
}

pub const TRAITS: [&str; 6] = ["aggression", "expansion", "caution", "honor", "mercantile", "diplomacy"];

pub fn apply_interventions(w: &mut World, list: &[Intervention]) -> Result<(), String> {
    let civ = |w: &World, k: &str| w.civ_by_key(k).ok_or_else(|| format!("unknown civilization `{k}`"));
    for i in list {
        match i {
            Intervention::SetTrait { civ: k, r#trait, value } => {
                let c = civ(w, k)?;
                if !(0.0..=1.0).contains(value) {
                    return Err("trait values lie in 0..1".into());
                }
                let p = &mut w.civs[c].personality;
                let slot = match r#trait.as_str() {
                    "aggression" => &mut p.aggression,
                    "expansion" => &mut p.expansion,
                    "caution" => &mut p.caution,
                    "honor" => &mut p.honor,
                    "mercantile" => &mut p.mercantile,
                    "diplomacy" => &mut p.diplomacy,
                    t => return Err(format!("unknown trait `{t}`")),
                };
                *slot = *value;
            }
            Intervention::SetOpinion { a, b, value } => {
                let (a, b) = (civ(w, a)?, civ(w, b)?);
                if a == b || !(-100.0..=100.0).contains(value) {
                    return Err("opinion needs two powers and a value in -100..100".into());
                }
                w.opinion[a][b] = *value;
                w.opinion[b][a] = *value;
            }
            Intervention::AddTreaty { kind, a, b } => {
                let (a, b) = (civ(w, a)?, civ(w, b)?);
                if a == b {
                    return Err("a treaty needs two powers".into());
                }
                if !w.has_treaty(a, b, *kind) {
                    w.treaties.push(Treaty {
                        kind: *kind,
                        a,
                        b,
                        since: 0,
                        expires: None,
                    });
                }
            }
            Intervention::RemoveTreaty { kind, a, b } => {
                let (a, b) = (civ(w, a)?, civ(w, b)?);
                w.treaties.retain(|t| !(t.kind == *kind && t.involves(a, b)));
            }
            Intervention::ScaleTreasury { civ: k, factor } => {
                let c = civ(w, k)?;
                if !(0.0..=5.0).contains(factor) {
                    return Err("factors lie in 0..5".into());
                }
                w.civs[c].treasury = round2(w.civs[c].treasury * factor);
            }
            Intervention::ScaleArmies { civ: k, factor } => {
                let c = civ(w, k)?;
                if !(0.0..=5.0).contains(factor) {
                    return Err("factors lie in 0..5".into());
                }
                for a in w.armies.iter_mut().filter(|a| a.owner == c) {
                    a.strength = round2(a.strength * factor);
                }
                w.armies.retain(|a| a.strength >= 0.5);
            }
            Intervention::AddClaim { civ: k, province } => {
                let c = civ(w, k)?;
                let p = w
                    .provinces
                    .iter()
                    .position(|p| &p.key == province)
                    .ok_or_else(|| format!("unknown province `{province}`"))?;
                if !w.provinces[p].claims.contains(&c) {
                    w.provinces[p].claims.push(c);
                }
            }
        }
    }
    let stats = (0..w.civs.len()).map(|c| w.civ_stats(c)).collect();
    w.stats[0] = stats;
    Ok(())
}

/// Who sits in a civilization's seat.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Seat {
    Rules,
    Amnesic,
    Random,
    Human,
    /// A language model behind `provider` (`lmstudio` or `anthropic`).
    Model {
        provider: String,
        model: Option<String>,
    },
}

impl Seat {
    pub fn parse(s: &str) -> Result<Seat, String> {
        match s {
            "rules" | "utility" => Ok(Seat::Rules),
            "amnesic" => Ok(Seat::Amnesic),
            "random" => Ok(Seat::Random),
            "human" => Ok(Seat::Human),
            "lmstudio" | "anthropic" => Ok(Seat::Model {
                provider: s.into(),
                model: None,
            }),
            _ => match s.split_once(':') {
                Some((p @ ("lmstudio" | "anthropic"), m)) if !m.is_empty() => Ok(Seat::Model {
                    provider: p.into(),
                    model: Some(m.into()),
                }),
                _ => Err(format!("unknown seat `{s}`")),
            },
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct DecisionRecord {
    pub civ: CivId,
    pub brain: String,
    pub label: Label,
    pub submission: Submission,
    /// The applied actions in words, for people reading the record.
    pub chosen: Vec<String>,
    pub offered: usize,
    pub rationale: Option<String>,
    pub error: Option<String>,
    pub usage: Usage,
    pub prompt_sha256: Option<String>,
    pub discarded: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct TurnRecord {
    pub turn: u32,
    pub date: String,
    pub decisions: Vec<DecisionRecord>,
    pub report: TurnReport,
    /// Wars in progress when the turn ended.
    pub wars_after: usize,
    pub hash: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Save {
    pub schema: String,
    pub sim_version: u32,
    pub engine: String,
    pub scenario: Scenario,
    pub scenario_sha256: String,
    pub seed: u64,
    pub interventions: Vec<Intervention>,
    pub seats: Vec<Seat>,
    pub initial_hash: String,
    pub turns: Vec<TurnRecord>,
    pub final_hash: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ReplayReport {
    pub ok: bool,
    pub turns_checked: usize,
    pub first_divergence: Option<u32>,
    pub reason: Option<String>,
    pub final_hash: String,
}

pub struct Simulation {
    pub scenario: Scenario,
    pub world: World,
    pub seats: Vec<Seat>,
    pub interventions: Vec<Intervention>,
    pub initial_hash: String,
    pub turns: Vec<TurnRecord>,
}

pub fn engine_id() -> String {
    format!("noeterra {} sim/{}", env!("CARGO_PKG_VERSION"), SIM_VERSION)
}

impl Simulation {
    pub fn new(
        scenario: Scenario,
        seed: u64,
        seats: Vec<Seat>,
        interventions: Vec<Intervention>,
    ) -> Result<Self, String> {
        let mut world = build(&scenario, seed)?;
        apply_interventions(&mut world, &interventions)?;
        let mut seats = seats;
        if seats.is_empty() {
            seats = vec![Seat::Rules; world.civs.len()];
        }
        if seats.len() != world.civs.len() {
            return Err(format!("{} seats for {} civilizations", seats.len(), world.civs.len()));
        }
        let initial_hash = world_hash(&world);
        Ok(Simulation {
            scenario,
            world,
            seats,
            interventions,
            initial_hash,
            turns: Vec::new(),
        })
    }

    /// Runs one turn. `brains[c]` decides for seat `c` unless a human decision
    /// is queued for it; a human seat with nothing queued passes.
    pub fn step(&mut self, brains: &[Box<dyn Brain>], human: &mut BTreeMap<CivId, Decision>) -> &TurnRecord {
        let w = &self.world;
        let n = w.civs.len();
        let observations: Vec<_> = (0..n).map(|c| observe(w, c)).collect();
        let mut outputs: Vec<Option<BrainOutput>> = vec![None; n];
        for c in 0..n {
            if !w.civs[c].alive {
                outputs[c] = Some(BrainOutput::plain(Decision::default(), Label::Rules));
            } else if self.seats[c] == Seat::Human {
                let d = human.remove(&c).unwrap_or_default();
                let mut o = BrainOutput::plain(d, Label::Human);
                o.generation = Generation::Human;
                outputs[c] = Some(o);
            }
        }
        let seed = w.seed;
        let pending: Vec<CivId> = (0..n).filter(|&c| outputs[c].is_none()).collect();
        #[cfg(feature = "native")]
        {
            let (remote, local): (Vec<CivId>, Vec<CivId>) = pending.iter().partition(|&&c| brains[c].is_remote());
            let results: Vec<(CivId, BrainOutput)> = std::thread::scope(|s| {
                let handles: Vec<_> = remote
                    .iter()
                    .map(|&c| {
                        let (b, o, m) = (&brains[c], &observations[c], &w.memories[c]);
                        (c, s.spawn(move || b.decide(o, m, seed)))
                    })
                    .collect();
                let mut out: Vec<(CivId, BrainOutput)> = local
                    .iter()
                    .map(|&c| (c, brains[c].decide(&observations[c], &w.memories[c], seed)))
                    .collect();
                for (c, h) in handles {
                    let r = h.join().unwrap_or_else(|_| {
                        let mut o = UtilityBrain { amnesic: false }.decide(&observations[c], &w.memories[c], seed);
                        o.label = Label::Fallback;
                        o.error = Some("the brain panicked".into());
                        o
                    });
                    out.push((c, r));
                }
                out
            });
            for (c, r) in results {
                outputs[c] = Some(r);
            }
        }
        #[cfg(not(feature = "native"))]
        for c in pending {
            outputs[c] = Some(brains[c].decide(&observations[c], &w.memories[c], seed));
        }
        let outputs: Vec<BrainOutput> = outputs.into_iter().map(|o| o.expect("every seat decided")).collect();
        let decisions: Vec<DecisionRecord> = outputs
            .into_iter()
            .enumerate()
            .map(|(c, o)| DecisionRecord {
                civ: c,
                brain: if self.seats[c] == Seat::Human {
                    "human".into()
                } else {
                    brains[c].descriptor()
                },
                label: o.label,
                chosen: o.decision.actions.iter().map(|a| describe(w, c, a)).collect(),
                offered: observations[c].offered.len(),
                submission: Submission {
                    decision: o.decision,
                    generation: o.generation,
                },
                rationale: o.rationale,
                error: o.error,
                usage: o.usage,
                prompt_sha256: o.prompt_sha256,
                discarded: o.discarded,
            })
            .collect();
        self.apply(decisions)
    }

    fn apply(&mut self, decisions: Vec<DecisionRecord>) -> &TurnRecord {
        let date = self.world.date();
        let subs: Vec<Submission> = decisions.iter().map(|d| d.submission.clone()).collect();
        let report = resolve_turn(&mut self.world, &subs);
        let hash = world_hash(&self.world);
        let wars_after = self.world.wars.len();
        self.turns.push(TurnRecord {
            turn: report.turn,
            date,
            decisions,
            report,
            wars_after,
            hash,
        });
        self.turns.last().expect("just pushed")
    }

    pub fn save(&self) -> Save {
        Save {
            schema: SAVE_SCHEMA.into(),
            sim_version: SIM_VERSION,
            engine: engine_id(),
            scenario_sha256: self.scenario.sha256(),
            scenario: self.scenario.clone(),
            seed: self.world.seed,
            interventions: self.interventions.clone(),
            seats: self.seats.clone(),
            initial_hash: self.initial_hash.clone(),
            turns: self.turns.clone(),
            final_hash: world_hash(&self.world),
        }
    }

    /// Rebuilds a history from its save: the same scenario, seed and recorded
    /// submissions must reach the same hash after every turn.
    pub fn replay(save: &Save) -> (ReplayReport, Option<Simulation>) {
        let fail = |turn: Option<u32>, reason: String, checked: usize| ReplayReport {
            ok: false,
            turns_checked: checked,
            first_divergence: turn,
            reason: Some(reason),
            final_hash: String::new(),
        };
        if save.schema != SAVE_SCHEMA || save.sim_version != SIM_VERSION {
            return (
                fail(
                    None,
                    format!(
                        "recorded under {} sim/{}; this engine is sim/{SIM_VERSION}",
                        save.schema, save.sim_version
                    ),
                    0,
                ),
                None,
            );
        }
        if save.scenario.sha256() != save.scenario_sha256 {
            return (
                fail(None, "the embedded scenario does not match its digest".into(), 0),
                None,
            );
        }
        let mut sim = match Simulation::new(
            save.scenario.clone(),
            save.seed,
            save.seats.clone(),
            save.interventions.clone(),
        ) {
            Ok(s) => s,
            Err(e) => return (fail(None, e, 0), None),
        };
        if sim.initial_hash != save.initial_hash {
            return (fail(Some(0), "the starting world differs".into(), 0), None);
        }
        for (i, t) in save.turns.iter().enumerate() {
            if t.turn != sim.world.turn || t.decisions.len() != sim.world.civs.len() {
                return (fail(Some(t.turn), "turn record is out of sequence".into(), i), None);
            }
            let mut decisions = t.decisions.clone();
            for d in decisions.iter_mut() {
                d.label = Label::Replay;
            }
            let h = sim.apply(decisions).hash.clone();
            if h != t.hash {
                return (
                    fail(
                        Some(t.turn),
                        format!("state hash {h} differs from recorded {}", t.hash),
                        i,
                    ),
                    None,
                );
            }
        }
        let final_hash = world_hash(&sim.world);
        if final_hash != save.final_hash {
            return (fail(None, "final hash differs".into(), save.turns.len()), None);
        }
        (
            ReplayReport {
                ok: true,
                turns_checked: save.turns.len(),
                first_divergence: None,
                reason: None,
                final_hash,
            },
            Some(sim),
        )
    }
}

/// Brains for seats that need no network: rules, amnesic and random. A model or
/// human seat gets the rule-based brain here; callers with providers replace it.
pub fn offline_brains(seats: &[Seat]) -> Vec<Box<dyn Brain>> {
    seats
        .iter()
        .map(|s| -> Box<dyn Brain> {
            match s {
                Seat::Amnesic => Box::new(UtilityBrain { amnesic: true }),
                Seat::Random => Box::new(RandomBrain),
                _ => Box::new(UtilityBrain { amnesic: false }),
            }
        })
        .collect()
}

/// Runs `turns` turns with offline brains. The workhorse of experiments.
pub fn run_offline(sim: &mut Simulation, turns: u32) {
    let brains = offline_brains(&sim.seats);
    let mut none = BTreeMap::new();
    for _ in 0..turns {
        sim.step(&brains, &mut none);
    }
}
