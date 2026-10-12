//! A model proposes a civilization experiment for the R.A.I.N. Lab. It answers
//! in the lab's closed design vocabulary; the receipt keeps the exact question
//! and answer, and the design names the receipt by the SHA-256 of its bytes.
//! The lab's host compiles the design and decides whether it may run — a model
//! never authorizes, executes or evaluates anything.

use serde_json::{json, Value};

use crate::brain::provider::{ChatProvider, ChatRequest};
use crate::experiment::METRICS;
use crate::hash::sha256_hex;
use crate::scenario::builtin;
use crate::sim::TRAITS;

pub const RECEIPT_SCHEMA: &str = "noeterra-design-receipt/v1";
pub const DESIGN_SCHEMA: &str = "rain-civilization-design/v1";

fn answer_schema(civs: &[String]) -> Value {
    let civ = json!({ "type": "string", "enum": civs });
    let treaty = json!({ "type": "string", "enum": ["alliance", "non_aggression", "trade"] });
    let variant = |kind: &str, extra: Value| {
        let mut props = json!({ "kind": { "type": "string", "enum": [kind] } });
        let mut required = vec![json!("kind")];
        if let Value::Object(m) = extra {
            for (k, v) in m {
                required.push(json!(k));
                props[k] = v;
            }
        }
        json!({ "type": "object", "additionalProperties": false, "required": required, "properties": props })
    };
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["question", "hypothesis", "competing_hypothesis", "rationale", "parameters", "analysis"],
        "properties": {
            "question": { "type": "string" },
            "hypothesis": { "type": "string" },
            "competing_hypothesis": { "type": "string" },
            "rationale": { "type": "string" },
            "parameters": {
                "type": "object", "additionalProperties": false,
                "required": ["seeds", "turns", "treatment"],
                "properties": {
                    "seeds": { "type": "array", "items": { "type": "integer" } },
                    "turns": { "type": "integer" },
                    "treatment": { "anyOf": [
                        variant("set_trait", json!({ "civ": civ, "trait": { "type": "string", "enum": TRAITS }, "value": { "type": "number" } })),
                        variant("withhold_memory", json!({})),
                        variant("add_treaty", json!({ "treaty": treaty, "a": civ, "b": civ })),
                        variant("remove_treaty", json!({ "treaty": treaty, "a": civ, "b": civ })),
                        variant("scale_armies", json!({ "civ": civ, "factor": { "type": "number" } })),
                        variant("scale_treasury", json!({ "civ": civ, "factor": { "type": "number" } }))
                    ] }
                }
            },
            "analysis": {
                "type": "object", "additionalProperties": false,
                "required": ["metric", "expected_direction", "minimum_effect", "minimum_consistent_seeds"],
                "properties": {
                    "metric": { "type": "string", "enum": METRICS.iter().map(|m| m.id).collect::<Vec<_>>() },
                    "expected_direction": { "type": "string", "enum": ["increase", "decrease"] },
                    "minimum_effect": { "type": "number" },
                    "minimum_consistent_seeds": { "type": "integer" }
                }
            }
        }
    })
}

fn prompts(question: &str, context: &str) -> Result<(String, String, Vec<String>), String> {
    let s = builtin("mediterranean-264bc", 0).ok_or("scenario missing")?;
    let civs: Vec<String> = s.civs.iter().map(|c| c.key.clone()).collect();
    let powers: String = s
        .civs
        .iter()
        .map(|c| {
            let p = &c.personality;
            format!(
                "- {} ({}): aggression {}, expansion {}, caution {}, honor {}, mercantile {}, diplomacy {}\n",
                c.key, c.name, p.aggression, p.expansion, p.caution, p.honor, p.mercantile, p.diplomacy
            )
        })
        .collect();
    let treaties: String = s
        .treaties
        .iter()
        .map(|t| format!("- {:?} between {} and {}\n", t.kind, t.a, t.b))
        .collect();
    let metrics: String = METRICS
        .iter()
        .map(|m| format!("- {} ({}): {}\n", m.id, m.unit, m.description))
        .collect();
    let system = "You design experiments for the R.A.I.N. Lab on Noeterra, an illustrative simulation of rival \
civilizations whose rulers are rule-based autonomous agents with memory. A result describes this model only; it \
is never evidence about real history, so frame questions about the simulated agents and their rules. Design one \
controlled, falsifiable experiment: every seed runs once as a control and once with a single treatment, and the \
lab compares the two seed by seed. Choose a threshold the data could fail to meet, and a competing hypothesis \
that genuinely differs. The host will check and may refuse your design; you cannot run anything. Answer only \
with JSON matching the schema."
        .to_string();
    let user = format!(
        "SCENARIO: mediterranean-264bc — {}\n\nPOWERS (key and temperament, each 0..1):\n{powers}\nTREATIES AT THE START:\n{treaties}\n\
METRICS (one is primary):\n{metrics}\nTREATMENTS: set_trait (one power's trait to a value in 0..1); withhold_memory (all agents \
forget grievances and favours); add_treaty / remove_treaty (between two powers); scale_armies / scale_treasury (one power, \
factor 0..5).\n\nCONSTRAINTS: 3-32 distinct seeds (integers 0..2147483647); 8-200 seasons; 2 x seeds x seasons <= 12800; \
minimum_consistent_seeds between half the seeds and all of them; minimum_effect > 0 in the metric's unit.\n\n\
PRIOR RESULTS FROM THE LAB (host-recorded; may be empty):\n{}\n\nRESEARCH QUESTION FROM THE OPERATOR:\n{}",
        s.description,
        if context.trim().is_empty() { "(none)".to_string() } else { context.chars().take(6000).collect() },
        question.chars().take(1500).collect::<String>()
    );
    Ok((system, user, civs))
}

/// Asks `provider` for a design; returns (receipt text, design JSON).
pub fn propose(
    provider: &dyn ChatProvider,
    question: &str,
    context: &str,
    created_at: &str,
) -> Result<(String, Value), String> {
    let (system, user, civs) = prompts(question, context)?;
    let schema = answer_schema(&civs);
    let req = ChatRequest {
        system,
        user,
        schema_name: "rain_civilization_design".into(),
        schema,
        max_tokens: 8000,
    };
    let resp = provider.complete(&req)?;
    let body = {
        let t = &resp.text;
        let (a, b) = (
            t.find('{').ok_or("no JSON in the answer")?,
            t.rfind('}').ok_or("no JSON in the answer")?,
        );
        &t[a..=b]
    };
    let answer: Value = serde_json::from_str(body).map_err(|e| format!("the answer is not JSON: {e}"))?;
    let receipt = json!({
        "schema": RECEIPT_SCHEMA,
        "generation": "model",
        "provider": provider.name(),
        "model": resp.model,
        "created_at": created_at,
        "request": { "system": req.system, "user": req.user, "schema": req.schema },
        "answer": resp.text,
        "usage": { "tokens_in": resp.tokens_in, "tokens_out": resp.tokens_out, "latency_ms": resp.latency_ms },
        "note": "The answer is a proposal. The R.A.I.N. Lab host validates, compiles and authorizes; the model decides nothing."
    });
    let text = serde_json::to_string_pretty(&receipt).map_err(|e| e.to_string())?;
    let digest = sha256_hex(text.as_bytes());
    let p = &answer["parameters"];
    let a = &answer["analysis"];
    let seeds = p["seeds"].as_array().map(|v| v.len()).unwrap_or(0) as u64;
    let turns = p["turns"].as_u64().unwrap_or(0);
    let design = json!({
        "schema": DESIGN_SCHEMA,
        "question": answer["question"],
        "hypothesis": answer["hypothesis"],
        "competing_hypothesis": answer["competing_hypothesis"],
        "parameters": { "scenario": "mediterranean-264bc", "seeds": p["seeds"], "turns": p["turns"], "treatment": p["treatment"] },
        "analysis": {
            "method": "matched_seed_paired_delta",
            "metric": a["metric"],
            "expected_direction": a["expected_direction"],
            "minimum_effect": a["minimum_effect"],
            "minimum_consistent_seeds": a["minimum_consistent_seeds"]
        },
        // The budget is the host's arithmetic, not the model's.
        "budget": { "max_simulated_turns": 2 * seeds * turns },
        "provenance": { "generation": "model", "decision_sha256": digest, "source_ids": [], "parent_record_sha256": null }
    });
    Ok((text, design))
}
