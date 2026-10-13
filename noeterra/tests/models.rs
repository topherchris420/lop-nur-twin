//! The model seat against test doubles. No test here reaches a real model.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use noeterra::action::Action;
use noeterra::brain::llm::{interpret_answer, situation_report, LlmBrain};
use noeterra::brain::provider::{is_local_http, LmStudio, Scripted};
use noeterra::brain::{Brain, Label};
use noeterra::model::Generation;
use noeterra::observe::observe;
use noeterra::scenario::builtin;
use noeterra::sim::{offline_brains, Seat, Simulation};
use serde_json::json;

fn sim() -> Simulation {
    Simulation::new(builtin("mediterranean-264bc", 3).unwrap(), 3, Vec::new(), Vec::new()).unwrap()
}

/// An OpenAI-compatible server on a free loopback port that answers each chat
/// request with the next scripted reply (or an HTTP status).
fn fake_server(replies: Vec<(u16, String)>) -> (String, Arc<Mutex<Vec<String>>>) {
    let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
    let port = server.server_addr().to_ip().unwrap().port();
    let seen = Arc::new(Mutex::new(Vec::new()));
    let log = seen.clone();
    std::thread::spawn(move || {
        let mut replies = replies.into_iter();
        for mut req in server.incoming_requests() {
            if req.url().ends_with("/models") {
                let _ = req.respond(tiny_http::Response::from_string(r#"{"data":[{"id":"fake-model"}]}"#));
                continue;
            }
            let mut body = String::new();
            req.as_reader().read_to_string(&mut body).unwrap();
            log.lock().unwrap().push(body);
            let (code, content) = replies.next().unwrap_or((500, String::new()));
            let payload = json!({
                "model": "fake-model",
                "choices": [{ "message": { "content": content }, "finish_reason": if content.is_empty() { "length" } else { "stop" } }],
                "usage": { "prompt_tokens": 1234, "completion_tokens": 56 }
            });
            let _ = req.respond(tiny_http::Response::from_string(payload.to_string()).with_status_code(code));
        }
    });
    (format!("http://127.0.0.1:{port}/v1"), seen)
}

#[test]
fn a_valid_answer_is_live_and_kept_to_the_menu() {
    let s = sim();
    let rome = s.world.civ_by_key("rome").unwrap();
    let obs = observe(&s.world, rome);
    let research = obs.offered.iter().find(|o| o.action == Action::Research).unwrap().index;
    let moves: Vec<usize> = obs
        .offered
        .iter()
        .filter(|o| matches!(o.action, Action::Move { army, .. } if army == obs.armies[0].id))
        .map(|o| o.index)
        .take(2)
        .collect();
    let answer = json!({
        "assessment": "Secure Italy before Sicily.",
        "actions": [research, moves[0], moves[1], 9999, -1, research],
        "responses": [{ "proposal": 4242, "accept": true }],
        "messages": [{ "to": "carthage", "text": "Rome watches Messana closely." }, { "to": "atlantis", "text": "hello" }],
        "memory_note": "Carthage holds western Sicily."
    })
    .to_string();
    let (base, seen) = fake_server(vec![(200, format!("```json\n{answer}\n```"))]);
    let brain = LlmBrain {
        provider: Arc::new(LmStudio::connect(&base, None, Duration::from_secs(5)).unwrap()),
        max_tokens: 2000,
    };
    let out = brain.decide(&obs, &s.world.memories[rome], 3);
    assert_eq!(out.label, Label::Live, "{:?}", out.error);
    assert_eq!(out.generation, Generation::Model);
    assert_eq!(out.decision.actions.len(), 2, "research once and one move for the army");
    assert!(out.decision.actions.contains(&Action::Research));
    assert_eq!(out.decision.messages.len(), 1);
    assert_eq!(out.decision.note.as_deref(), Some("Carthage holds western Sicily."));
    assert!(out.discarded.iter().any(|d| d.contains("9999")));
    assert!(out.discarded.iter().any(|d| d.contains("second time")));
    assert!(out.discarded.iter().any(|d| d.contains("4242")));
    assert!(out.discarded.iter().any(|d| d.contains("atlantis")));
    assert_eq!(out.usage.tokens_in, Some(1234));
    assert!(out.prompt_sha256.is_some());
    let sent = seen.lock().unwrap()[0].clone();
    assert!(sent.contains("json_schema"), "structured output is requested");
    assert!(sent.contains("ACTIONS OFFERED THIS SEASON"));
}

#[test]
fn unusable_answers_fall_back_to_the_rules_and_say_why() {
    let s = sim();
    let c = 0;
    let obs = observe(&s.world, c);
    let (base, _) = fake_server(vec![
        (200, "I think we should attack!".into()),
        (200, String::new()),
        (503, "busy".into()),
    ]);
    let brain = LlmBrain {
        provider: Arc::new(LmStudio::connect(&base, Some("fake-model".into()), Duration::from_secs(5)).unwrap()),
        max_tokens: 2000,
    };
    for expect in ["no JSON", "ran out of tokens", "503"] {
        let out = brain.decide(&obs, &s.world.memories[c], 3);
        assert_eq!(out.label, Label::Fallback);
        assert_eq!(out.generation, Generation::Scripted);
        assert!(
            out.error.as_deref().unwrap_or("").contains(expect),
            "{:?} lacks {expect}",
            out.error
        );
        assert_eq!(
            out.decision,
            noeterra::brain::utility::decide(&obs, false, 3),
            "the fallback is the rules' own choice"
        );
    }
}

#[test]
fn an_unreachable_or_remote_server_is_refused() {
    assert!(LmStudio::connect("http://127.0.0.1:9/v1", None, Duration::from_secs(2)).is_err());
    let e = LmStudio::connect("http://example.com/v1", Some("m".into()), Duration::from_secs(2))
        .err()
        .unwrap();
    assert!(e.contains("local"));
    assert!(!is_local_http("https://api.anthropic.com/v1/messages"));
}

#[test]
fn the_prompt_respects_the_fog_of_war() {
    let s = sim();
    let rome = s.world.civ_by_key("rome").unwrap();
    let obs = observe(&s.world, rome);
    let report = situation_report(&obs, &s.world.memories[rome]);
    // Rome cannot see Babylonia, nor know the Seleucids' exact army.
    assert!(!report.contains("Babylonia"));
    assert!(report.contains("Latium"));
    assert!(report.contains("beyond your contact"));
    let seleucid = s.world.civ_by_key("seleucid").unwrap();
    assert!(!obs.civs[seleucid].in_contact);
}

#[test]
fn a_model_seat_runs_inside_a_full_turn_and_replays_without_the_model() {
    let mut s = Simulation::new(
        builtin("mediterranean-264bc", 4).unwrap(),
        4,
        {
            let mut v = vec![Seat::Rules; 9];
            v[2] = Seat::Model {
                provider: "scripted".into(),
                model: None,
            };
            v
        },
        Vec::new(),
    )
    .unwrap();
    let mut brains = offline_brains(&s.seats);
    let answer = json!({ "assessment": "Hold and build.", "actions": [], "responses": [],
        "messages": [{ "to": "carthage", "text": "Syracuse remains your friend." }], "memory_note": "" })
    .to_string();
    brains[2] = Box::new(LlmBrain {
        provider: Arc::new(Scripted {
            answers: Mutex::new(vec![Ok(answer)]),
        }),
        max_tokens: 1000,
    });
    let mut none = BTreeMap::new();
    for _ in 0..3 {
        let rec = s.step(&brains, &mut none);
        assert_eq!(rec.decisions[2].label, Label::Live);
    }
    let letter = s.world.messages.iter().find(|m| m.from == 2).unwrap();
    assert_eq!(letter.generation, Generation::Model);
    let (report, _) = Simulation::replay(&s.save());
    assert!(report.ok, "replay needs no model: {report:?}");
}

#[test]
fn interpret_answer_rejects_non_json_and_wrong_shapes() {
    let s = sim();
    let obs = observe(&s.world, 0);
    assert!(interpret_answer(&obs, "no braces here", 1).is_err());
    assert!(interpret_answer(&obs, r#"{"actions": "all of them"}"#, 1).is_err());
    let (d, _, _) = interpret_answer(
        &obs,
        r#"{"assessment":"","actions":[],"responses":[],"messages":[],"memory_note":"   "}"#,
        1,
    )
    .unwrap();
    assert!(d.actions.is_empty() && d.note.is_none());
}

#[test]
fn a_model_seat_in_debt_keeps_its_free_actions() {
    let mut s = sim();
    let rome = s.world.civ_by_key("rome").unwrap();
    s.world.civs[rome].treasury = -12.0;
    let obs = observe(&s.world, rome);
    // One free move for each of Rome's armies.
    let mut armies = Vec::new();
    let free: Vec<usize> = obs
        .offered
        .iter()
        .filter(|o| match o.action {
            noeterra::action::Action::Move { army, .. } if !armies.contains(&army) => {
                armies.push(army);
                true
            }
            _ => false,
        })
        .map(|o| o.index)
        .take(3)
        .collect();
    assert!(free.len() >= 2, "Rome has armies to move");
    let answer = format!(r#"{{"assessment":"","actions":{free:?},"responses":[],"messages":[],"memory_note":""}}"#);
    let (d, _, discarded) = interpret_answer(&obs, &answer, 1).unwrap();
    assert_eq!(d.actions.len(), free.len(), "discarded: {discarded:?}");
}

/// The real Anthropic client (curl) against a local stand-in: request shape,
/// key handling and the refusal path, with no credit spent.
#[test]
fn the_anthropic_client_sends_a_well_formed_request_and_handles_refusal() {
    use noeterra::brain::provider::{Anthropic, ChatProvider, ChatRequest};
    let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
    let port = server.server_addr().to_ip().unwrap().port();
    let seen = Arc::new(Mutex::new(Vec::<(String, Vec<String>)>::new()));
    let log = seen.clone();
    std::thread::spawn(move || {
        let replies = [
            json!({ "model": "claude-opus-5-5", "stop_reason": "end_turn",
                "content": [{ "type": "thinking", "thinking": "" }, { "type": "text", "text": "{\"ok\":true}" }],
                "usage": { "input_tokens": 10, "cache_read_input_tokens": 90, "output_tokens": 5 } }),
            json!({ "model": "claude-opus-5-5", "stop_reason": "refusal", "content": [] }),
        ];
        for (i, mut req) in server.incoming_requests().enumerate() {
            let mut body = String::new();
            req.as_reader().read_to_string(&mut body).unwrap();
            let headers = req
                .headers()
                .iter()
                .map(|h| format!("{}: {}", h.field, h.value))
                .collect();
            log.lock().unwrap().push((body, headers));
            let reply = replies.get(i).cloned().unwrap_or(json!({}));
            let _ = req.respond(tiny_http::Response::from_string(reply.to_string()));
        }
    });
    std::env::set_var("ANTHROPIC_API_KEY", "placeholder-test-value");
    std::env::set_var("NOETERRA_ANTHROPIC_URL", format!("http://127.0.0.1:{port}/v1/messages"));
    let client = Anthropic::connect(None, Duration::from_secs(20)).unwrap();
    let req = ChatRequest {
        system: "rules".into(),
        user: "situation".into(),
        schema_name: "x".into(),
        schema: json!({ "type": "object", "additionalProperties": false, "required": ["ok"], "properties": { "ok": { "type": "boolean" } } }),
        max_tokens: 1000,
    };
    let r = client.complete(&req).unwrap();
    assert_eq!(r.text, "{\"ok\":true}");
    assert_eq!(r.tokens_in, Some(100), "cached input counts toward input");
    let refused = client.complete(&req).unwrap_err();
    assert!(refused.contains("declined"));
    std::env::remove_var("NOETERRA_ANTHROPIC_URL");
    std::env::remove_var("ANTHROPIC_API_KEY");
    let (body, headers) = seen.lock().unwrap()[0].clone();
    let v: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(v["model"], "claude-opus-5-5");
    assert_eq!(v["output_config"]["format"]["type"], "json_schema");
    assert_eq!(v["system"][0]["cache_control"]["type"], "ephemeral");
    assert_eq!(v["fallbacks"], "default");
    assert!(
        v.get("temperature").is_none() && v.get("thinking").is_none(),
        "Opus 5.5 rejects sampling and thinking overrides"
    );
    assert!(headers
        .iter()
        .any(|h| h.eq_ignore_ascii_case("x-api-key: placeholder-test-value")));
    assert!(headers
        .iter()
        .any(|h| h.to_lowercase().starts_with("anthropic-version: 2023-06-01")));
    assert!(
        !body.contains("placeholder-test-value"),
        "the key travels only as a header"
    );
}

#[test]
fn a_model_design_proposal_is_bound_to_its_receipt() {
    use noeterra::hash::sha256_hex;
    let answer = json!({
        "question": "Does memory drive war?", "hypothesis": "Without memory, fewer wars.",
        "competing_hypothesis": "Memory changes nothing.", "rationale": "Earlier runs suggest it.",
        "parameters": { "seeds": [1, 2, 3, 4], "turns": 30, "treatment": { "kind": "withhold_memory" } },
        "analysis": { "metric": "wars_declared", "expected_direction": "decrease", "minimum_effect": 1, "minimum_consistent_seeds": 3 }
    })
    .to_string();
    let p = Scripted {
        answers: Mutex::new(vec![Ok(answer)]),
    };
    let (receipt, design) = noeterra::design::propose(&p, "Why do wars recur?", "", "2026-10-12T00:00:00Z").unwrap();
    assert_eq!(design["provenance"]["decision_sha256"], sha256_hex(receipt.as_bytes()));
    assert_eq!(design["provenance"]["generation"], "model");
    assert_eq!(design["budget"]["max_simulated_turns"], 240);
    assert!(design.get("rationale").is_none(), "model prose stays in the receipt");
    let r: serde_json::Value = serde_json::from_str(&receipt).unwrap();
    assert_eq!(r["schema"], "noeterra-design-receipt/v1");
    assert!(r["request"]["user"].as_str().unwrap().contains("Why do wars recur?"));
}

#[test]
fn a_design_answer_with_braces_out_of_order_is_refused_not_a_panic() {
    for text in ["} sorry {", "no json at all", "{ unterminated"] {
        let p = Scripted {
            answers: Mutex::new(vec![Ok(text.to_string())]),
        };
        let out = noeterra::design::propose(&p, "Q?", "", "2026-10-12T00:00:00Z");
        assert!(out.is_err(), "{text}");
    }
}
