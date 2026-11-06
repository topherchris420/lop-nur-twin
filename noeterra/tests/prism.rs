//! The Sarvam-Prism seat against a local stand-in for Sarvam's API. No test
//! here reaches Sarvam or spends credit.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use noeterra::action::{Action, MAX_ACTIONS};
use noeterra::brain::prism::{interpret, questions, request, state, Kind, PrismBrain, SarvamPrism, MAX_OPTIONS};
use noeterra::brain::{Brain, Label};
use noeterra::hash::sha256_hex;
use noeterra::model::CivId;
use noeterra::observe::{observe, Observation};
use noeterra::scenario::builtin;
use noeterra::server::Config;
use noeterra::sim::{offline_brains, Seat, Simulation};
use serde_json::{json, Map, Value};

type Seen = Arc<Mutex<Vec<(String, Vec<String>)>>>;

/// The key curl reads. Every test sets the same placeholder and none removes
/// it, so tests running in parallel cannot disturb one another.
fn placeholder_key() {
    std::env::set_var("SARVAM_API_KEY", "placeholder-test-value");
}

/// A stand-in for Sarvam's decision endpoint on a free loopback port. It
/// records each request's body and headers and answers with `reply`.
fn stand_in(reply: impl Fn(&str) -> (u16, String) + Send + 'static) -> (String, Seen) {
    let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
    let port = server.server_addr().to_ip().unwrap().port();
    let seen: Seen = Arc::new(Mutex::new(Vec::new()));
    let log = seen.clone();
    std::thread::spawn(move || {
        for mut req in server.incoming_requests() {
            let mut body = String::new();
            req.as_reader().read_to_string(&mut body).unwrap();
            let headers = req
                .headers()
                .iter()
                .map(|h| format!("{}: {}", h.field, h.value))
                .collect();
            log.lock().unwrap().push((body.clone(), headers));
            let (code, payload) = reply(&body);
            let _ = req.respond(tiny_http::Response::from_string(payload).with_status_code(code));
        }
    });
    (format!("http://127.0.0.1:{port}/v2/systemone"), seen)
}

/// Answers every question in a request the way Sarvam shapes answers: a choice
/// takes its first option that is not the do-nothing one, at 0.7; a yes/no gets
/// `yes(id, instructions)`.
fn answer_all(body: &str, yes: &dyn Fn(&str, &str) -> f64) -> String {
    let req: Value = serde_json::from_str(body).unwrap();
    let mut answers = Map::new();
    for (id, q) in req["questions"].as_object().unwrap() {
        let a = if q["type"] == "choice" {
            let options: Vec<&String> = q["criteria"].as_object().unwrap().keys().collect();
            let chosen = options.iter().find(|o| !matches!(o.as_str(), "hold" | "none")).unwrap();
            let rest = 0.3 / (options.len() - 1) as f64;
            let probabilities: Map<String, Value> = options
                .iter()
                .map(|o| ((*o).clone(), json!(if o == chosen { 0.7 } else { rest })))
                .collect();
            json!({ "type": "choice", "choice": chosen, "confidence": 0.5, "probabilities": probabilities })
        } else {
            json!({ "type": "noul", "noul": yes(id, q["instructions"].as_str().unwrap()) })
        };
        answers.insert(id.clone(), a);
    }
    json!({ "model": "sarvam-prism", "answers": answers, "usage": { "input_tokens": 2345, "output_tokens": 0 } })
        .to_string()
}

fn sim(seed: u64) -> Simulation {
    Simulation::new(
        builtin("mediterranean-264bc", seed).unwrap(),
        seed,
        Vec::new(),
        Vec::new(),
    )
    .unwrap()
}

/// A rule-played world in which some power has a proposal awaiting its answer
/// and an army it can move.
fn awaiting_a_proposal() -> (Simulation, CivId) {
    let mut s = sim(5);
    let brains = offline_brains(&s.seats);
    let mut none = BTreeMap::new();
    for _ in 0..60 {
        s.step(&brains, &mut none);
        for c in 0..s.world.civs.len() {
            let obs = observe(&s.world, c);
            let movable = obs.offered.iter().any(|o| matches!(o.action, Action::Move { .. }));
            if !obs.proposals.is_empty() && movable {
                return (s, c);
            }
        }
    }
    panic!("no power received a proposal in 60 seasons");
}

fn check_questions(obs: &Observation) {
    let (qs, left_out) = questions(obs);
    assert!(left_out.is_empty(), "{left_out:?}");
    let ids: BTreeSet<&str> = qs.iter().map(|q| q.id.as_str()).collect();
    assert_eq!(ids.len(), qs.len(), "question ids are unique");
    let mut asked = Vec::new();
    let mut proposals = Vec::new();
    for q in &qs {
        let keys: BTreeSet<&str> = q.body.as_object().unwrap().keys().map(String::as_str).collect();
        match &q.kind {
            Kind::Pick { nothing, options } => {
                assert_eq!(keys, BTreeSet::from(["type", "instructions", "criteria"]));
                let criteria = q.body["criteria"].as_object().unwrap();
                assert!((2..=MAX_OPTIONS).contains(&criteria.len()));
                assert_eq!(criteria.len(), options.len() + 1);
                assert!(criteria.contains_key(*nothing));
                // One question per army or per power: never two of its moves at once.
                let mut targets = BTreeSet::new();
                for (o, i) in options {
                    assert!(criteria.contains_key(o));
                    targets.insert(match obs.offered[*i].action {
                        Action::Move { army, .. } => format!("army {army}"),
                        Action::Propose { to, .. }
                        | Action::Gift { to, .. }
                        | Action::CancelTreaty { with: to, .. }
                        | Action::DeclareWar { target: to } => format!("power {to}"),
                        _ => panic!("a domestic action in a choice"),
                    });
                    asked.push(*i);
                }
                assert_eq!(targets.len(), 1, "{}", q.id);
            }
            Kind::Take(i) => {
                assert_eq!(keys, BTreeSet::from(["type", "instructions"]));
                assert_eq!(q.body["type"], "noul");
                asked.push(*i);
            }
            Kind::Accept(id) => {
                assert_eq!(q.body["type"], "noul");
                proposals.push(*id);
            }
        }
    }
    asked.sort_unstable();
    let menu: Vec<usize> = obs.offered.iter().map(|o| o.index).collect();
    assert_eq!(asked, menu, "every offered action is asked exactly once");
    let mut awaiting: Vec<u32> = obs.proposals.iter().map(|p| p.id).collect();
    awaiting.sort_unstable();
    proposals.sort_unstable();
    assert_eq!(proposals, awaiting, "every proposal is asked");
}

#[test]
fn every_offered_action_is_asked_exactly_once() {
    for scenario in ["mediterranean-264bc", "tarim-77bc"] {
        let s = Simulation::new(builtin(scenario, 2).unwrap(), 2, Vec::new(), Vec::new()).unwrap();
        for c in 0..s.world.civs.len() {
            check_questions(&observe(&s.world, c));
        }
    }
    let (s, c) = awaiting_a_proposal();
    check_questions(&observe(&s.world, c));
}

#[test]
fn the_request_carries_the_situation_and_only_fields_the_api_accepts() {
    let s = sim(3);
    let rome = s.world.civ_by_key("rome").unwrap();
    let obs = observe(&s.world, rome);
    let (qs, _) = questions(&obs);
    let body = request(&obs, &s.world.memories[rome], &qs, "sarvam-prism");
    let keys: BTreeSet<&str> = body.as_object().unwrap().keys().map(String::as_str).collect();
    assert_eq!(keys, BTreeSet::from(["model", "state", "questions"]));
    let st = state(&obs, &s.world.memories[rome]);
    assert_eq!(body["state"], st.as_str());
    assert!(st.contains("Roman Republic") && st.contains("YOUR ARMIES"));
    assert!(
        st.contains("answering the host's questions"),
        "the brief describes how a Prism seat acts"
    );
    assert!(
        !st.contains("ACTIONS OFFERED") && !st.contains("Answer only with JSON"),
        "the numbered menu and the JSON instructions are replaced by the questions"
    );
    // Rome cannot see Babylonia: the fog of war holds for Prism too.
    assert!(!st.contains("Babylonia"));
}

#[test]
fn a_prism_seat_is_live_kept_to_the_menu_and_its_key_stays_in_a_header() {
    placeholder_key();
    let learning = |_: &str, text: &str| if text.contains("learning") { 0.9 } else { 0.2 };
    let (url, seen) = stand_in(move |body| (200, answer_all(body, &learning)));
    let brain = PrismBrain {
        client: SarvamPrism::at(&url, None, Duration::from_secs(20)),
    };
    assert_eq!(brain.descriptor(), "prism:sarvam-prism");
    let s = sim(3);
    let rome = s.world.civ_by_key("rome").unwrap();
    let obs = observe(&s.world, rome);
    let out = brain.decide(&obs, &s.world.memories[rome], 3);
    assert_eq!(out.label, Label::Live, "{:?}", out.error);
    assert!(out.rationale.is_none(), "Prism writes nothing");
    assert!(out.decision.messages.is_empty() && out.decision.note.is_none());
    // Learning was the most probable pick, so it is taken first.
    assert_eq!(out.decision.actions.first(), Some(&Action::Research));
    assert!(out.decision.actions.len() <= MAX_ACTIONS);
    let mut armies = BTreeSet::new();
    for a in &out.decision.actions {
        if let Action::Move { army, .. } = a {
            assert!(armies.insert(*army), "one move per army");
        }
        assert!(obs.offered.iter().any(|o| &o.action == a), "only offered actions");
    }
    let (qs, _) = questions(&obs);
    assert_eq!(out.scores.len(), qs.len(), "every answer is recorded as returned");
    let research = out.scores.iter().find(|x| x.p == 0.9).unwrap();
    assert_eq!((research.kind.as_str(), research.choice.as_deref()), ("noul", None));
    assert_eq!(out.usage.model.as_deref(), Some("sarvam-prism"));
    assert_eq!(out.usage.tokens_in, Some(2345));
    assert_eq!(out.usage.tokens_out, Some(0));
    let (body, headers) = seen.lock().unwrap()[0].clone();
    assert_eq!(
        out.prompt_sha256.as_deref(),
        Some(sha256_hex(body.as_bytes()).as_str()),
        "the recorded digest is of the exact request sent"
    );
    let v: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(v["model"], "sarvam-prism");
    for refused in ["temperature", "max_tokens", "stream", "images"] {
        assert!(v.get(refused).is_none(), "Sarvam refuses `{refused}` with a 422");
    }
    assert!(headers
        .iter()
        .any(|h| h.eq_ignore_ascii_case("api-subscription-key: placeholder-test-value")));
    assert!(
        !body.contains("placeholder-test-value"),
        "the key travels only as a header"
    );
}

#[test]
fn sarvam_failures_fall_back_to_the_rules_and_say_why() {
    placeholder_key();
    let replies = Mutex::new(
        vec![
            (
                402,
                json!({ "error": { "message": "Credit balance is empty", "code": "insufficient_quota_error",
                "request_id": "r1" } })
                .to_string(),
            ),
            (200, json!({ "model": "sarvam-prism", "answers": {} }).to_string()),
            (503, "<html>busy</html>".to_string()),
        ]
        .into_iter(),
    );
    let (url, _) = stand_in(move |_| replies.lock().unwrap().next().unwrap_or((500, String::new())));
    let brain = PrismBrain {
        client: SarvamPrism::at(&url, None, Duration::from_secs(20)),
    };
    let s = sim(3);
    let obs = observe(&s.world, 0);
    let expected = [
        "Sarvam answered 402 (insufficient_quota_error): Credit balance is empty",
        "no question was answered with a usable probability",
        "HTTP 503: unreadable answer",
    ];
    for e in expected {
        let out = brain.decide(&obs, &s.world.memories[0], 3);
        assert_eq!(out.label, Label::Fallback);
        assert_eq!(out.error.as_deref(), Some(e));
        assert!(out.scores.is_empty());
        assert_eq!(out.usage.model.as_deref(), Some("sarvam-prism"));
        assert!(out.prompt_sha256.is_some());
    }
}

#[test]
fn answers_outside_the_questions_are_discarded_and_open_proposals_go_to_the_rules() {
    let (s, c) = awaiting_a_proposal();
    let obs = observe(&s.world, c);
    let (qs, _) = questions(&obs);
    let army = qs.iter().find(|q| q.id.starts_with("army-")).expect("an army question");
    let domestic = qs.iter().find(|q| matches!(q.kind, Kind::Take(_)));
    let proposal = qs.iter().find(|q| matches!(q.kind, Kind::Accept(_))).unwrap();
    let mut answers = Map::new();
    for q in &qs {
        let a = if q.id == army.id {
            json!({ "type": "choice", "choice": "a99999", "probabilities": { "a99999": 0.9 } })
        } else if Some(&q.id) == domestic.map(|d| &d.id) {
            json!({ "type": "noul", "noul": 1.5 })
        } else if q.id == proposal.id {
            continue;
        } else if let Kind::Pick { nothing, .. } = &q.kind {
            let mut probabilities = Map::new();
            probabilities.insert(nothing.to_string(), json!(0.6));
            json!({ "type": "choice", "choice": nothing, "probabilities": probabilities })
        } else {
            json!({ "type": "noul", "noul": 0.1 })
        };
        answers.insert(q.id.clone(), a);
    }
    let (d, scores, discarded) = interpret(&obs, &qs, &json!({ "answers": answers }), 5).unwrap();
    assert!(d.actions.is_empty(), "no usable yes was given: {:?}", d.actions);
    assert!(discarded.contains(&format!("{}: `a99999` is not one of its options", army.id)));
    if let Some(dq) = domestic {
        assert!(discarded.contains(&format!("{}: no usable yes or no", dq.id)));
    }
    assert!(discarded.contains(&format!("{}: not answered", proposal.id)));
    assert!(discarded
        .iter()
        .any(|x| x.contains("left unanswered; the rules answered it")));
    assert_eq!(d.responses.len(), obs.proposals.len(), "every proposal is answered");
    assert_eq!(
        scores.len(),
        qs.len() - 1 - usize::from(domestic.is_some()),
        "out-of-range and missing answers leave no score"
    );
    assert!(interpret(&obs, &qs, &json!({ "answers": [] }), 5).is_err());
}

#[test]
fn a_prism_seat_plays_full_turns_and_the_history_replays_without_it() {
    placeholder_key();
    let (url, _) = stand_in(|body| (200, answer_all(body, &|_, _| 0.6)));
    assert_eq!(
        Seat::parse("prism").unwrap(),
        Seat::Model {
            provider: "prism".into(),
            model: None
        }
    );
    assert_eq!(
        Seat::parse("prism:sarvam-prism-next").unwrap(),
        Seat::Model {
            provider: "prism".into(),
            model: Some("sarvam-prism-next".into())
        }
    );
    let mut seats = vec![Seat::Rules; 9];
    seats[2] = Seat::parse("prism").unwrap();
    let mut s = Simulation::new(builtin("mediterranean-264bc", 4).unwrap(), 4, seats, Vec::new()).unwrap();
    let mut brains = offline_brains(&s.seats);
    brains[2] = Box::new(PrismBrain {
        client: SarvamPrism::at(&url, None, Duration::from_secs(20)),
    });
    let mut none = BTreeMap::new();
    for _ in 0..3 {
        let rec = s.step(&brains, &mut none);
        assert_eq!(rec.decisions[2].label, Label::Live, "{:?}", rec.decisions[2].error);
        assert!(!rec.decisions[2].scores.is_empty());
        assert!(rec.decisions[0].scores.is_empty());
    }
    let save = s.save();
    let text = serde_json::to_string(&save).unwrap();
    let back: noeterra::sim::Save = serde_json::from_str(&text).unwrap();
    for (a, b) in back.turns.iter().zip(&save.turns) {
        assert_eq!(
            a.decisions[2].scores.len(),
            b.decisions[2].scores.len(),
            "scores survive a save"
        );
    }
    let v: Value = serde_json::from_str(&text).unwrap();
    assert!(
        v["turns"][0]["decisions"][0].get("scores").is_none(),
        "other seats' records are unchanged"
    );
    let (report, _) = noeterra::sim::Simulation::replay(&save);
    assert!(report.ok, "replay needs no model: {report:?}");

    // The score re-simulates without the model and agrees with the live world.
    let score = noeterra::experiment::score(&save);
    assert_eq!(score["replay"]["ok"], true);
    assert_eq!(score["metrics"], json!(noeterra::experiment::metrics(&s)));
    let third = &s.world.civs[2];
    assert_eq!(
        score["civs"][&third.key]["provinces"],
        s.world.provinces_of(third.id).count()
    );
    let prism = &score["seats"][2];
    assert_eq!(prism["labels"], json!({ "live": 3 }));
    assert_eq!(prism["models_reported"], json!(["sarvam-prism"]));
    assert_eq!(
        prism["tokens_in"],
        3 * 2345,
        "the stand-in reports 2345 input tokens a call"
    );
    assert_eq!(prism["decisions_reporting_tokens"], 3);
    assert!(prism["latency_ms"]["max"].as_u64().is_some());
    assert_eq!(score["seats"][0]["labels"], json!({ "rules": 3 }));
    assert_eq!(score["seats"][0]["tokens_in"], 0);

    // A save whose history was altered scores no world at all, only the reason.
    let mut forged = save.clone();
    forged.turns[1].hash = "0".repeat(64);
    let score = noeterra::experiment::score(&forged);
    assert_eq!(score["replay"]["ok"], false);
    assert!(score["metrics"].is_null() && score["civs"].is_null());
    assert_eq!(
        score["seats"][2]["labels"],
        json!({ "live": 3 }),
        "the record is still counted"
    );
}

#[test]
fn prism_cannot_be_asked_to_write() {
    let e = Config::from_env(0).provider("prism", None).err().unwrap();
    assert!(e.contains("writes no text"), "{e}");
}
