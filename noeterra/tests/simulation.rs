use std::collections::BTreeMap;

use noeterra::action::{offered, validate, Action, Decision};
use noeterra::experiment::{self, Arm, Plan, Policy, ScenarioRef};
use noeterra::hash::world_hash;
use noeterra::model::*;
use noeterra::scenario::{builtin, generate};
use noeterra::sim::{offline_brains, run_offline, Intervention, Seat, Simulation};

fn med(seed: u64, seats: Vec<Seat>) -> Simulation {
    Simulation::new(builtin("mediterranean-264bc", seed).unwrap(), seed, seats, Vec::new()).unwrap()
}

/// Properties that must hold after every turn of every history.
fn check_invariants(w: &World) {
    for p in &w.provinces {
        assert!(p.population > 0.0, "{} emptied", p.key);
        assert!(
            (1.0..=10.0).contains(&p.development),
            "{} development {}",
            p.key,
            p.development
        );
        assert!((0.0..=100.0).contains(&p.unrest), "{} unrest {}", p.key, p.unrest);
        assert!(p.fort <= 3);
        if p.owner.is_none() {
            assert!(p.controller.is_none(), "{} is controlled but owned by no one", p.key);
        }
        if let Some(o) = p.owner {
            assert!(w.civs[o].alive, "{} owned by a fallen power", p.key);
        }
        // Peace returns occupations: no power holds another's land without a war.
        if let (Some(o), Some(h)) = (p.owner, p.controller) {
            assert!(
                o == h || w.at_war(o, h),
                "{} held by a power not at war with its owner",
                p.key
            );
        }
    }
    for a in &w.armies {
        assert!(a.strength >= 0.5 && a.strength.is_finite());
        assert!((0.2..=1.0).contains(&a.morale), "morale {}", a.morale);
        assert!(w.civs[a.owner].alive, "a fallen power keeps an army");
    }
    for c in &w.civs {
        assert!((0.0..=100.0).contains(&c.stability));
        assert!(c.treasury >= -50.0 && c.treasury.is_finite());
        assert!(c.manpower >= 0.0);
        if c.alive {
            assert_eq!(
                w.provinces[c.capital].owner,
                Some(c.id),
                "{} lost title to its capital",
                c.key
            );
        }
    }
    for t in &w.treaties {
        assert_ne!(t.a, t.b);
        assert!(!w.at_war(t.a, t.b), "treaty between enemies {} {}", t.a, t.b);
    }
    for war in &w.wars {
        assert!(!war.attackers.is_empty() && !war.defenders.is_empty());
        for a in &war.attackers {
            assert!(!war.defenders.contains(a), "a power fights itself");
        }
    }
    for row in &w.opinion {
        for v in row {
            assert!((-100.0..=100.0).contains(v));
        }
    }
}

#[test]
fn a_long_history_keeps_every_invariant() {
    let mut sim = med(7, Vec::new());
    let brains = offline_brains(&sim.seats);
    let mut none = BTreeMap::new();
    for _ in 0..120 {
        sim.step(&brains, &mut none);
        check_invariants(&sim.world);
    }
    let w = &sim.world;
    let kinds: BTreeMap<&str, usize> = w.events.iter().fold(BTreeMap::new(), |mut m, e| {
        *m.entry(e.kind.as_str()).or_insert(0) += 1;
        m
    });
    println!("after 120 turns ({}): {kinds:?}", w.date());
    for c in &w.civs {
        println!(
            "  {:<24} alive={} provinces={:>2} strength={:>5.1} treasury={:>7.1} stability={:>5.1}",
            c.name,
            c.alive,
            w.provinces_of(c.id).count(),
            w.strength_of(c.id),
            c.treasury,
            c.stability
        );
    }
    for e in w
        .events
        .iter()
        .filter(|e| matches!(e.kind.as_str(), "war" | "peace" | "fall" | "treaty" | "conquest"))
        .take(40)
    {
        println!("  [{}] {}", date_of(w.start_year, e.turn), e.text);
    }
    assert!(
        kinds.get("battle").copied().unwrap_or(0) > 0,
        "a century of rivals fought no battle"
    );
    assert!(
        kinds.get("treaty").copied().unwrap_or(0) > 0,
        "no treaty was ever signed"
    );
}

#[test]
fn the_tarim_world_keeps_every_invariant() {
    let mut sim = Simulation::new(builtin("tarim-77bc", 2).unwrap(), 2, Vec::new(), Vec::new()).unwrap();
    let brains = offline_brains(&sim.seats);
    let mut none = BTreeMap::new();
    for _ in 0..120 {
        sim.step(&brains, &mut none);
        check_invariants(&sim.world);
    }
    assert_eq!(sim.world.date(), "Spring 47 BC");
    assert!(
        sim.world.events.iter().any(|e| e.kind == "battle"),
        "thirty years without a battle"
    );
}

#[test]
fn same_seed_same_history_different_seed_different_history() {
    let run = |seed| {
        let mut s = med(seed, Vec::new());
        run_offline(&mut s, 40);
        world_hash(&s.world)
    };
    assert_eq!(run(3), run(3));
    assert_ne!(run(3), run(4));
}

#[test]
fn every_offered_action_is_legal_and_the_menu_is_bounded() {
    let mut sim = med(11, Vec::new());
    run_offline(&mut sim, 30);
    for c in 0..sim.world.civs.len() {
        let menu = offered(&sim.world, c);
        assert!(
            menu.len() <= 160,
            "menu of {} for {}",
            menu.len(),
            sim.world.civs[c].key
        );
        for a in &menu {
            assert!(validate(&sim.world, c, a).is_ok(), "offered but illegal: {a:?}");
        }
    }
}

#[test]
fn illegal_choices_are_refused_and_recorded_not_applied() {
    let mut sim = med(1, vec![Seat::Human; 9]);
    let rome = sim.world.civ_by_key("rome").unwrap();
    let carthage = sim.world.civ_by_key("carthage").unwrap();
    let alexandria = sim.world.provinces.iter().position(|p| p.key == "alexandria").unwrap();
    let roman_army = sim.world.armies.iter().find(|a| a.owner == rome).unwrap().id;
    let before = sim.world.clone();
    let mut human = BTreeMap::new();
    human.insert(
        rome,
        Decision {
            actions: vec![
                Action::Move {
                    army: roman_army,
                    to: alexandria,
                },
                Action::Recruit {
                    province: alexandria,
                    amount: 3.0,
                },
                Action::Gift {
                    to: carthage,
                    amount: 1_000_000.0,
                },
                Action::Fortify { province: 9999 },
            ],
            ..Default::default()
        },
    );
    let brains = offline_brains(&sim.seats);
    let rec = sim.step(&brains, &mut human).clone();
    assert_eq!(rec.report.applied, 0);
    assert_eq!(rec.report.rejected.len(), 4);
    assert_eq!(
        sim.world.army(roman_army).unwrap().location,
        before.army(roman_army).unwrap().location
    );
    assert!(sim.world.civs[carthage].treasury < 1_000.0);
}

#[test]
fn a_save_replays_to_identical_hashes_and_tampering_is_caught() {
    let mut seats = vec![Seat::Rules; 9];
    seats[1] = Seat::Random;
    seats[2] = Seat::Amnesic;
    let mut sim = med(5, seats);
    run_offline(&mut sim, 25);
    let save = sim.save();
    let text = serde_json::to_string(&save).unwrap();
    let reloaded: noeterra::sim::Save = serde_json::from_str(&text).unwrap();
    let (report, rebuilt) = Simulation::replay(&reloaded);
    assert!(report.ok, "{report:?}");
    assert_eq!(report.turns_checked, 25);
    assert_eq!(world_hash(&rebuilt.unwrap().world), save.final_hash);

    let mut forged = save.clone();
    if let Some(t) = forged.turns.get_mut(10) {
        t.decisions[0].submission.decision.actions.clear();
        t.decisions[0].submission.decision.actions.push(Action::Research);
    }
    let (report, _) = Simulation::replay(&forged);
    assert!(!report.ok);
    assert!(report.first_divergence.is_some());

    let mut forged = save;
    forged.scenario.provinces[0].pop += 1.0;
    let (report, _) = Simulation::replay(&forged);
    assert!(!report.ok);
    assert!(report.reason.unwrap().contains("digest"));
}

#[test]
fn memory_changes_behaviour() {
    // The same world with and without remembered grievances diverges.
    let mk = |seat: Seat| {
        let mut s = med(9, vec![seat; 9]);
        run_offline(&mut s, 60);
        world_hash(&s.world)
    };
    assert_ne!(mk(Seat::Rules), mk(Seat::Amnesic));
}

#[test]
fn interventions_apply_and_bad_ones_are_refused() {
    let s = builtin("mediterranean-264bc", 1).unwrap();
    let ok = Simulation::new(
        s.clone(),
        1,
        Vec::new(),
        vec![
            Intervention::SetTrait {
                civ: "rome".into(),
                r#trait: "aggression".into(),
                value: 0.1,
            },
            Intervention::AddTreaty {
                kind: TreatyKind::Alliance,
                a: "rome".into(),
                b: "egypt".into(),
            },
            Intervention::ScaleArmies {
                civ: "carthage".into(),
                factor: 2.0,
            },
        ],
    )
    .unwrap();
    let rome = ok.world.civ_by_key("rome").unwrap();
    assert_eq!(ok.world.civs[rome].personality.aggression, 0.1);
    assert!(ok
        .world
        .has_treaty(rome, ok.world.civ_by_key("egypt").unwrap(), TreatyKind::Alliance));
    for bad in [
        Intervention::SetTrait {
            civ: "rome".into(),
            r#trait: "cunning".into(),
            value: 0.5,
        },
        Intervention::SetTrait {
            civ: "rome".into(),
            r#trait: "honor".into(),
            value: 2.0,
        },
        Intervention::ScaleTreasury {
            civ: "atlantis".into(),
            factor: 1.0,
        },
        Intervention::AddClaim {
            civ: "rome".into(),
            province: "britannia".into(),
        },
    ] {
        assert!(Simulation::new(s.clone(), 1, Vec::new(), vec![bad]).is_err());
    }
}

#[test]
fn an_experiment_is_paired_reproducible_and_verifiable() {
    let plan = Plan {
        schema: experiment::PLAN_SCHEMA.into(),
        scenario: ScenarioRef::Builtin {
            id: "mediterranean-264bc".into(),
        },
        turns: 30,
        seeds: vec![1, 2, 3],
        arms: vec![
            Arm {
                id: "control".into(),
                policy: Policy::Rules,
                interventions: vec![],
            },
            Arm {
                id: "pacifist-rome".into(),
                policy: Policy::Rules,
                interventions: vec![Intervention::SetTrait {
                    civ: "rome".into(),
                    r#trait: "aggression".into(),
                    value: 0.05,
                }],
            },
            Arm {
                id: "amnesic".into(),
                policy: Policy::Amnesic,
                interventions: vec![],
            },
        ],
    };
    let r = experiment::run(&plan).unwrap();
    assert_eq!(r.runs.len(), 9);
    assert_eq!(r.evidence_class, "simulated");
    assert_eq!(r.paired.len(), 2 * experiment::METRICS.len());
    for def in experiment::METRICS {
        assert!(
            r.runs.iter().all(|x| x.metrics.contains_key(def.id)),
            "{} missing",
            def.id
        );
    }
    experiment::verify(&plan, &r).unwrap();
    let mut forged = r.clone();
    forged.runs[4].metrics.insert("battles".into(), 999.0);
    assert!(experiment::verify(&plan, &forged).is_err());
    let text = noeterra::api::handle(&serde_json::json!({ "op": "experiment", "plan": plan }).to_string());
    assert!(text.starts_with(r#"{"ok":true"#));
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&text).unwrap()["result"]["plan_sha256"],
        r.plan_sha256
    );
}

#[test]
fn a_treatment_that_changes_nothing_is_refused() {
    let plan = |interventions: Vec<Intervention>| Plan {
        schema: experiment::PLAN_SCHEMA.into(),
        scenario: ScenarioRef::Builtin {
            id: "mediterranean-264bc".into(),
        },
        turns: 5,
        seeds: vec![1, 2, 3],
        arms: vec![
            Arm {
                id: "control".into(),
                policy: Policy::Rules,
                interventions: vec![],
            },
            Arm {
                id: "treatment".into(),
                policy: Policy::Rules,
                interventions,
            },
        ],
    };
    // Macedon and the Gauls have no alliance to remove, and a factor of 1 scales nothing.
    for vacuous in [
        Intervention::RemoveTreaty {
            kind: TreatyKind::Alliance,
            a: "macedon".into(),
            b: "gauls".into(),
        },
        Intervention::ScaleTreasury {
            civ: "rome".into(),
            factor: 1.0,
        },
    ] {
        let err = experiment::validate_plan(&plan(vec![vacuous])).unwrap_err();
        assert!(err.contains("leave the starting world unchanged"), "{err}");
    }
    // A second arm with no interventions is the control again.
    let err = experiment::validate_plan(&plan(vec![])).unwrap_err();
    assert!(err.contains("repeats arm `control`"), "{err}");
    // The alliance the scenario does contain can be removed.
    experiment::validate_plan(&plan(vec![Intervention::RemoveTreaty {
        kind: TreatyKind::Alliance,
        a: "carthage".into(),
        b: "syracuse".into(),
    }]))
    .unwrap();
}

#[test]
fn a_save_with_an_empty_scenario_is_refused_not_a_trap() {
    let mut s = builtin("mediterranean-264bc", 0).unwrap();
    s.civs.clear();
    s.provinces.clear();
    s.links.clear();
    s.relations.clear();
    s.treaties.clear();
    assert!(noeterra::scenario::build(&s, 1).is_err());
    let save = serde_json::json!({
        "schema": "noeterra-save/v1", "sim_version": 1, "engine": "",
        "scenario": s, "scenario_sha256": noeterra::hash::sha256_hex(serde_json::to_string(&s).unwrap().as_bytes()),
        "seed": 0, "interventions": [], "seats": [], "initial_hash": "", "turns": [], "final_hash": ""
    });
    for op in ["replay", "session_load"] {
        let text = noeterra::api::handle(&serde_json::json!({ "op": op, "save": save }).to_string());
        // Refused either as an error or as a failed replay report, never a trap.
        let v: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert!(v["ok"] == false || v["result"]["ok"] == false, "{op}: {text}");
    }
}

#[test]
fn a_large_generated_world_runs() {
    let s = generate(21, 12, 400);
    let mut sim = Simulation::new(s, 21, Vec::new(), Vec::new()).unwrap();
    let t = std::time::Instant::now();
    run_offline(&mut sim, 50);
    check_invariants(&sim.world);
    println!("400 provinces x 12 civs x 50 turns in {:?}", t.elapsed());
}

#[test]
fn a_scenario_with_impossible_figures_is_refused() {
    let base = builtin("mediterranean-264bc", 0).unwrap();
    assert!(noeterra::scenario::build(&base, 1).is_ok());
    type Mutation = Box<dyn Fn(&mut noeterra::scenario::Scenario)>;
    let mutations: Vec<(&str, Mutation)> = vec![
        // A huge tech makes battle odds inf/inf, and NaN then passes every treasury check.
        ("tech", Box::new(|s| s.civs[0].tech = 1e300)),
        ("treasury", Box::new(|s| s.civs[0].treasury = -1.0)),
        ("trait", Box::new(|s| s.civs[0].personality.aggression = 7.0)),
        ("stability", Box::new(|s| s.civs[0].stability = 400.0)),
        ("army", Box::new(|s| s.civs[0].armies[0].strength = 1e300)),
        ("population", Box::new(|s| s.provinces[0].pop = 1e300)),
        (
            "self treaty",
            Box::new(|s| {
                let k = s.civs[0].key.clone();
                s.treaties.push(noeterra::scenario::TreatySpec {
                    kind: TreatyKind::Trade,
                    a: k.clone(),
                    b: k,
                });
            }),
        ),
    ];
    for (what, mutate) in mutations {
        let mut s = base.clone();
        mutate(&mut s);
        assert!(noeterra::scenario::build(&s, 1).is_err(), "{what} accepted");
    }
}
