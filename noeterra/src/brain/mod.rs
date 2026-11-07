//! Brains choose. A brain receives an observation and its own memory and returns
//! a decision drawn from the offered menu; the resolver decides what happens.

use serde::{Deserialize, Serialize};

use crate::action::Decision;
use crate::memory::Memory;
use crate::model::Generation;
use crate::observe::Observation;
use crate::rng::{purpose, Rng};

pub mod utility;

#[cfg(feature = "native")]
pub mod llm;
#[cfg(feature = "native")]
pub mod prism;
#[cfg(feature = "native")]
pub mod provider;

/// What produced the decision that was applied. Shown to people as-is.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Label {
    /// The deterministic rule-based policy.
    Rules,
    /// The rule-based policy with its memory withheld.
    Amnesic,
    /// Uniformly random legal choices: a baseline, not a player.
    Random,
    /// A validated model answer.
    Live,
    /// The model failed; the rules decided instead, and the record says why.
    Fallback,
    /// A person.
    Human,
    /// Re-applied from a recording.
    Replay,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct Usage {
    pub model: Option<String>,
    pub tokens_in: Option<u64>,
    pub tokens_out: Option<u64>,
    pub latency_ms: Option<u64>,
}

/// What a decision model returned for one of the host's questions, exactly as
/// it returned it. Never filled in for a brain that states no probabilities.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Score {
    /// The host's question id, e.g. `army-3`, `power-carthage`, `action-12`.
    pub question: String,
    /// `choice` (one of several options) or `noul` (yes or no), as the
    /// provider names its question types.
    #[serde(rename = "type")]
    pub kind: String,
    /// The option the provider chose (`choice` questions only).
    pub choice: Option<String>,
    /// For `choice`, the provider's probability of `choice`; for `noul`, its
    /// probability of yes.
    pub p: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct BrainOutput {
    pub decision: Decision,
    pub label: Label,
    pub generation: Generation,
    /// What a model said about its choice. Model-written; never used as a fact.
    pub rationale: Option<String>,
    pub error: Option<String>,
    pub usage: Usage,
    pub prompt_sha256: Option<String>,
    /// Indices of offered actions the model named that were refused, and why.
    pub discarded: Vec<String>,
    /// Probabilities a decision model returned (Sarvam-Prism); empty otherwise.
    #[serde(default)]
    pub scores: Vec<Score>,
}

impl BrainOutput {
    pub fn plain(decision: Decision, label: Label) -> Self {
        BrainOutput {
            decision,
            label,
            generation: Generation::Scripted,
            rationale: None,
            error: None,
            usage: Usage::default(),
            prompt_sha256: None,
            discarded: Vec::new(),
            scores: Vec::new(),
        }
    }
}

/// Whether a discarded part was left out by the engine's own limits rather than
/// because the answer was wrong. The limits: at most `MAX_ACTIONS` actions, one
/// move per army, the treasury, `MAX_MESSAGES` letters, and Prism's cap on the
/// options in one question. A seat that wants more than they allow is trimmed,
/// most wanted first; that is play, not a fault. Everything else discarded is
/// the answer's fault: an index or option not offered, a proposal or power that
/// does not exist, a question left unanswered.
///
/// Only the engine's own wording counts, and the indexed reasons must start
/// with an offered index, so text a model wrote cannot pass for a limit.
pub fn over_limit(reason: &str) -> bool {
    use crate::action::MAX_ACTIONS;
    if reason == "letter beyond the limit" {
        return true;
    }
    let Some(rest) = reason
        .strip_prefix('[')
        .and_then(|r| r.split_once("] "))
        .filter(|(i, _)| i.parse::<i64>().is_ok())
        .map(|(_, rest)| rest)
    else {
        return false;
    };
    rest == format!("exceeds {MAX_ACTIONS} actions")
        || (rest.starts_with("moves army #") && rest.ends_with(" a second time"))
        || (rest.starts_with("costs ") && rest.contains("; only ") && rest.ends_with(" left"))
        || (rest.starts_with("not asked: ") && rest.ends_with(" options"))
}

pub trait Brain: Send + Sync {
    fn descriptor(&self) -> String;
    fn decide(&self, obs: &Observation, memory: &Memory, seed: u64) -> BrainOutput;
    /// Brains that wait on the network are run in parallel.
    fn is_remote(&self) -> bool {
        false
    }
}

pub struct RandomBrain;

impl Brain for RandomBrain {
    fn descriptor(&self) -> String {
        "random".into()
    }
    fn decide(&self, obs: &Observation, _memory: &Memory, seed: u64) -> BrainOutput {
        let mut rng = Rng::stream(seed, &[obs.turn as u64, obs.me.id as u64, purpose::BRAIN, 99]);
        let mut d = Decision::default();
        let n = rng.below(4);
        let mut used_armies = Vec::new();
        for _ in 0..n {
            if obs.offered.is_empty() {
                break;
            }
            let o = &obs.offered[rng.below(obs.offered.len())];
            if let crate::action::Action::Move { army, .. } = o.action {
                if used_armies.contains(&army) {
                    continue;
                }
                used_armies.push(army);
            }
            if !d.actions.contains(&o.action) {
                d.actions.push(o.action.clone());
            }
        }
        for p in &obs.proposals {
            d.responses.push(crate::action::Response {
                proposal: p.id,
                accept: rng.chance(0.5),
            });
        }
        BrainOutput::plain(d, Label::Random)
    }
}
