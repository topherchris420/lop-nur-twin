//! Sarvam-Prism in a civilization's seat. Prism is a decision model: it reads a
//! situation and returns a probability for each answer in a fixed set, and it
//! never writes text. The host turns the season's menu into questions, all sent
//! in one request:
//!
//! - one `choice` per army with a move on the menu: `hold`, or one of its moves;
//! - one `choice` per foreign power the menu reaches: `none`, or one of the
//!   offered actions toward it (proposals, gifts, war, cancelling a treaty);
//! - one yes/no (`noul`) per domestic action (troops, forts, development,
//!   learning, suppression);
//! - one yes/no per proposal awaiting an answer.
//!
//! Every offered action appears in exactly one question. The picks are ranked
//! by the probability Prism gave them and then pass the same menu check as a
//! language model's answer (`llm::keep_to_menu`): at most `MAX_ACTIONS`, one
//! move per army, within the treasury. Prism writes no letters and no notes, so
//! it cannot answer a letter or read plain-language orders. Anything unusable
//! falls back to the rules, and the record says why. The probabilities are
//! recorded as returned.
//!
//! The API is reached through the system `curl` (`provider::curl_post`): the
//! key is read from `SARVAM_API_KEY` by curl itself, so it never appears in a
//! command line, a log, a record or the browser.

use std::collections::BTreeMap;
use std::time::Duration;

use serde_json::{json, Map, Value};

use crate::action::{Action, Decision};
use crate::brain::llm::{keep_to_menu, situation_report, system_prompt, Answer, AnswerResponse};
use crate::brain::provider::curl_post;
use crate::brain::utility;
use crate::brain::{Brain, BrainOutput, Label, Score, Usage};
use crate::hash::sha256_hex;
use crate::memory::Memory;
use crate::model::{CivId, Generation};
use crate::observe::Observation;

pub const SARVAM_URL: &str = "https://api.sarvam.ai/v2/systemone";
pub const PRISM_DEFAULT_MODEL: &str = "sarvam-prism";
/// The provider's limit on the options of one `choice` question.
pub const MAX_OPTIONS: usize = 255;
/// The do-nothing option of an army's question.
pub const HOLD: &str = "hold";
/// The do-nothing option of a foreign power's question.
pub const NONE: &str = "none";

/// One question and what its answers mean on the menu.
#[derive(Clone, Debug, PartialEq)]
pub struct Question {
    pub id: String,
    pub kind: Kind,
    /// The question as sent: `type`, `instructions` and, for a choice, `criteria`.
    pub body: Value,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Kind {
    /// Choose one option: `nothing`, or an option id naming a menu index.
    Pick {
        nothing: &'static str,
        options: Vec<(String, usize)>,
    },
    /// Yes or no to one menu index.
    Take(usize),
    /// Yes or no to one proposal.
    Accept(u32),
}

fn pick(
    obs: &Observation,
    id: String,
    instructions: String,
    nothing: (&'static str, String),
    items: &[usize],
    left_out: &mut Vec<String>,
) -> Question {
    let mut criteria = Map::new();
    criteria.insert(nothing.0.into(), Value::String(nothing.1));
    let mut options = Vec::new();
    for &i in items {
        if criteria.len() >= MAX_OPTIONS {
            left_out.push(format!("[{i}] not asked: {id} already has {MAX_OPTIONS} options"));
            continue;
        }
        let option = format!("a{i}");
        criteria.insert(option.clone(), Value::String(obs.offered[i].text.clone()));
        options.push((option, i));
    }
    Question {
        id,
        kind: Kind::Pick {
            nothing: nothing.0,
            options,
        },
        body: json!({ "type": "choice", "instructions": instructions, "criteria": criteria }),
    }
}

/// The season's questions, in a fixed order (armies, powers, domestic actions,
/// proposals), and any offered action left out by the provider's option limit.
pub fn questions(obs: &Observation) -> (Vec<Question>, Vec<String>) {
    let mut armies: BTreeMap<u32, Vec<usize>> = BTreeMap::new();
    let mut powers: BTreeMap<CivId, Vec<usize>> = BTreeMap::new();
    let mut domestic = Vec::new();
    for o in &obs.offered {
        match &o.action {
            Action::Move { army, .. } => armies.entry(*army).or_default().push(o.index),
            Action::Propose { to, .. }
            | Action::Gift { to, .. }
            | Action::CancelTreaty { with: to, .. }
            | Action::DeclareWar { target: to } => powers.entry(*to).or_default().push(o.index),
            Action::Recruit { .. }
            | Action::Fortify { .. }
            | Action::Develop { .. }
            | Action::Research
            | Action::Suppress { .. } => domestic.push(o.index),
        }
    }
    let mut left_out = Vec::new();
    let mut out = Vec::new();
    for (army, items) in &armies {
        let at = obs
            .armies
            .iter()
            .find(|a| a.id == *army)
            .and_then(|a| obs.province(a.location))
            .map(|p| p.name.as_str())
            .unwrap_or("its province");
        out.push(pick(
            obs,
            format!("army-{army}"),
            format!("Where should our army #{army}, now in {at}, go this season?"),
            (HOLD, format!("Army #{army} stays in {at}.")),
            items,
            &mut left_out,
        ));
    }
    for (civ, items) in &powers {
        let them = obs.civ(*civ);
        out.push(pick(
            obs,
            format!("power-{}", them.key),
            format!("What should we do toward {} this season?", them.name),
            (NONE, format!("Take no new action toward {} this season.", them.name)),
            items,
            &mut left_out,
        ));
    }
    for i in domestic {
        out.push(Question {
            id: format!("action-{i}"),
            kind: Kind::Take(i),
            body: json!({
                "type": "noul",
                "instructions": format!("Should we take this action this season? {}", obs.offered[i].text)
            }),
        });
    }
    for p in &obs.proposals {
        out.push(Question {
            id: format!("proposal-{}", p.id),
            kind: Kind::Accept(p.id),
            body: json!({
                "type": "noul",
                "instructions": format!("Should we accept this proposal? {}", p.text)
            }),
        });
    }
    (out, left_out)
}

/// The situation as the civilization sees it: the same brief and report a
/// language model seat gets, without the numbered menu, which the questions
/// replace.
pub fn state(obs: &Observation, memory: &Memory) -> String {
    let system = system_prompt(obs);
    let brief = system.split("\n\nAnswer only").next().unwrap_or("").replace(
        "choosing numbers from the menu of actions the host offers",
        "answering the host's questions about the actions it offers",
    );
    let report = situation_report(obs, memory);
    let report = report.split("\nACTIONS OFFERED").next().unwrap_or("");
    format!("{brief}\n\n{}", report.trim_end())
}

/// The whole request: one per seat per season.
pub fn request(obs: &Observation, memory: &Memory, questions: &[Question], model: &str) -> Value {
    let mut qs = Map::new();
    for q in questions {
        qs.insert(q.id.clone(), q.body.clone());
    }
    json!({ "model": model, "state": state(obs, memory), "questions": qs })
}

fn probability(v: &Value) -> Option<f64> {
    v.as_f64().filter(|p| p.is_finite() && (0.0..=1.0).contains(p))
}

/// Turns Prism's answers into a decision. Returns the decision, every score as
/// returned, and every part left out with its reason. Yes means a probability
/// of yes above one half; picks are taken most probable first.
pub fn interpret(
    obs: &Observation,
    questions: &[Question],
    answer: &Value,
    seed: u64,
) -> Result<(Decision, Vec<Score>, Vec<String>), String> {
    let answers = answer["answers"]
        .as_object()
        .ok_or("the answer has no `answers` object")?;
    let mut picks: Vec<(f64, usize)> = Vec::new();
    let mut responses = Vec::new();
    let mut scores = Vec::new();
    let mut discarded = Vec::new();
    for q in questions {
        let Some(a) = answers.get(&q.id) else {
            discarded.push(format!("{}: not answered", q.id));
            continue;
        };
        match &q.kind {
            Kind::Pick { nothing, options } => {
                let choice = a["choice"].as_str().unwrap_or("");
                let Some(p) = probability(&a["probabilities"][choice]) else {
                    discarded.push(format!("{}: no usable choice", q.id));
                    continue;
                };
                scores.push(Score {
                    question: q.id.clone(),
                    kind: "choice".into(),
                    choice: Some(choice.into()),
                    p,
                });
                if let Some((_, i)) = options.iter().find(|(o, _)| o == choice) {
                    picks.push((p, *i));
                } else if choice != *nothing {
                    discarded.push(format!("{}: `{choice}` is not one of its options", q.id));
                }
            }
            Kind::Take(i) => {
                let Some(p) = probability(&a["noul"]) else {
                    discarded.push(format!("{}: no usable yes or no", q.id));
                    continue;
                };
                scores.push(Score {
                    question: q.id.clone(),
                    kind: "noul".into(),
                    choice: None,
                    p,
                });
                if p > 0.5 {
                    picks.push((p, *i));
                }
            }
            Kind::Accept(id) => {
                let Some(p) = probability(&a["noul"]) else {
                    // Left open: `keep_to_menu` has the rules answer it, and says so.
                    discarded.push(format!("{}: no usable yes or no", q.id));
                    continue;
                };
                scores.push(Score {
                    question: q.id.clone(),
                    kind: "noul".into(),
                    choice: None,
                    p,
                });
                responses.push(AnswerResponse {
                    proposal: i64::from(*id),
                    accept: p > 0.5,
                });
            }
        }
    }
    if scores.is_empty() {
        return Err("no question was answered with a usable probability".into());
    }
    picks.sort_by(|a, b| b.0.total_cmp(&a.0).then(a.1.cmp(&b.1)));
    let a = Answer {
        assessment: String::new(),
        actions: picks.iter().map(|&(_, i)| i as i64).collect(),
        responses,
        messages: Vec::new(),
        memory_note: String::new(),
    };
    let (d, more) = keep_to_menu(obs, &a, seed);
    discarded.extend(more);
    Ok((d, scores, discarded))
}

/// The Sarvam decision API.
pub struct SarvamPrism {
    model: String,
    url: String,
    timeout_s: u64,
}

impl SarvamPrism {
    pub fn key_present() -> bool {
        std::env::var("SARVAM_API_KEY")
            .map(|k| !k.trim().is_empty())
            .unwrap_or(false)
    }

    /// The client for Sarvam's API (or `NOETERRA_SARVAM_URL`, for a stand-in).
    pub fn connect(model: Option<String>, timeout: Duration) -> Result<SarvamPrism, String> {
        if !Self::key_present() {
            return Err("SARVAM_API_KEY is not set in the server's environment".into());
        }
        let url = std::env::var("NOETERRA_SARVAM_URL").unwrap_or_else(|_| SARVAM_URL.into());
        Ok(Self::at(&url, model, timeout))
    }

    /// A client for `url`. Tests point it at a local stand-in.
    pub fn at(url: &str, model: Option<String>, timeout: Duration) -> SarvamPrism {
        SarvamPrism {
            model: model.unwrap_or_else(|| PRISM_DEFAULT_MODEL.into()),
            url: url.into(),
            timeout_s: timeout.as_secs().max(10),
        }
    }

    pub fn model(&self) -> &str {
        &self.model
    }

    /// Sends one request. Returns the answer and the latency in milliseconds.
    pub fn ask(&self, body: &Value) -> Result<(Value, u64), String> {
        let (code, payload, latency_ms) = curl_post(
            &self.url,
            "SARVAM_API_KEY",
            "api-subscription-key",
            &["content-type: application/json"],
            &body.to_string(),
            self.timeout_s,
        )?;
        let v: Value = serde_json::from_str(&payload).map_err(|_| format!("HTTP {code}: unreadable answer"))?;
        if code != "200" {
            let msg: String = v["error"]["message"]
                .as_str()
                .unwrap_or("no detail")
                .chars()
                .take(300)
                .collect();
            return Err(match v["error"]["code"].as_str() {
                Some(kind) => format!("Sarvam answered {code} ({kind}): {msg}"),
                None => format!("Sarvam answered {code}: {msg}"),
            });
        }
        Ok((v, latency_ms))
    }
}

pub struct PrismBrain {
    pub client: SarvamPrism,
}

impl Brain for PrismBrain {
    fn descriptor(&self) -> String {
        format!("prism:{}", self.client.model)
    }
    fn is_remote(&self) -> bool {
        true
    }
    fn decide(&self, obs: &Observation, memory: &Memory, seed: u64) -> BrainOutput {
        let (questions, left_out) = questions(obs);
        let body = request(obs, memory, &questions, &self.client.model);
        let prompt_sha256 = sha256_hex(body.to_string().as_bytes());
        let fallback = |e: String| {
            let mut o = BrainOutput::plain(utility::decide(obs, false, seed), Label::Fallback);
            o.error = Some(e);
            o.usage.model = Some(self.client.model.clone());
            o.prompt_sha256 = Some(prompt_sha256.clone());
            o
        };
        if questions.is_empty() {
            return fallback("nothing to ask: the menu is empty and no proposal awaits an answer".into());
        }
        let result = self
            .client
            .ask(&body)
            .and_then(|(v, ms)| interpret(obs, &questions, &v, seed).map(|parsed| (v, ms, parsed)));
        match result {
            Ok((v, ms, (decision, scores, discarded))) => BrainOutput {
                decision,
                label: Label::Live,
                generation: Generation::Model,
                rationale: None,
                error: None,
                usage: Usage {
                    model: Some(v["model"].as_str().unwrap_or(&self.client.model).to_string()),
                    tokens_in: v["usage"]["input_tokens"].as_u64(),
                    tokens_out: v["usage"]["output_tokens"].as_u64(),
                    latency_ms: Some(ms),
                },
                prompt_sha256: Some(prompt_sha256.clone()),
                discarded: left_out.into_iter().chain(discarded).collect(),
                scores,
            },
            Err(e) => fallback(e),
        }
    }
}
