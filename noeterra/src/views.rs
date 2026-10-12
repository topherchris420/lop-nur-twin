//! The JSON views both interfaces render: the local workbench (over HTTP) and
//! the browser game (over WebAssembly). One implementation, so the two never
//! disagree about what a season looked like.

use std::collections::BTreeMap;

use serde_json::{json, Value};

use crate::action::Decision;
use crate::model::*;
use crate::observe::observe;
use crate::scenario::{builtin, builtin_ids, Scenario};
use crate::sim::{Seat, TurnRecord};

pub fn summarize(r: &TurnRecord) -> Value {
    json!({
        "turn": r.turn, "date": r.date, "hash": r.hash,
        "applied": r.report.applied, "rejected": r.report.rejected,
        "decisions": r.decisions.iter().map(|d| json!({ "civ": d.civ, "brain": d.brain, "label": d.label,
            "chosen": d.chosen, "rationale": d.rationale, "error": d.error, "usage": d.usage,
            "discarded": d.discarded, "letters": d.submission.decision.messages.len() })).collect::<Vec<_>>()
    })
}

pub struct StateArgs<'a> {
    pub world: &'a World,
    pub scenario: &'a Scenario,
    pub seats: &'a [Seat],
    pub brains: &'a [String],
    pub records: &'a [TurnRecord],
    pub human: &'a BTreeMap<CivId, Decision>,
    pub since: usize,
    pub geometry: Option<Value>,
}

pub fn state(a: StateArgs) -> Value {
    let w = a.world;
    let humans: Vec<Value> = a
        .seats
        .iter()
        .enumerate()
        .filter(|(c, s)| **s == Seat::Human && w.civs[*c].alive)
        .map(|(c, _)| {
            let o = observe(w, c);
            json!({ "civ": c, "offered": o.offered, "proposals": o.proposals, "goals": o.goals,
                "queued": a.human.contains_key(&c) })
        })
        .collect();
    json!({
        "date": w.date(),
        "turn": w.turn,
        "start_year": w.start_year,
        "scenario": { "id": a.scenario.id, "name": a.scenario.name, "description": a.scenario.description,
            "provenance": a.scenario.provenance },
        "seats": a.seats.iter().enumerate().map(|(c, s)| json!({ "civ": c, "seat": s,
            "brain": a.brains.get(c).cloned().unwrap_or_default() })).collect::<Vec<_>>(),
        "civs": w.civs,
        "stats": w.stats,
        "provinces": w.provinces.iter().map(|p| json!({ "id": p.id, "key": p.key, "name": p.name, "terrain": p.terrain,
            "owner": p.owner, "controller": p.controller, "claims": p.claims, "population": p.population,
            "development": p.development, "fort": p.fort, "unrest": p.unrest, "natives": p.natives,
            "siege_by": p.siege_by, "siege": p.siege, "culture": p.culture, "coastal": p.coastal })).collect::<Vec<_>>(),
        "armies": w.armies,
        "opinion": w.opinion,
        "treaties": w.treaties,
        "wars": w.wars,
        "proposals": w.proposals,
        "messages": w.messages,
        "events": w.events.iter().skip(a.since).collect::<Vec<_>>(),
        "event_count": w.events.len(),
        "geometry": a.geometry,
        "humans": humans,
        "last_turn": a.records.last().map(summarize),
    })
}

pub fn mind(w: &World, records: &[TurnRecord], c: CivId) -> Result<Value, String> {
    if c >= w.civs.len() {
        return Err("no such civilization".into());
    }
    let o = observe(w, c);
    let names: BTreeMap<CivId, String> = w.civs.iter().map(|x| (x.id, x.name.clone())).collect();
    let history: Vec<Value> = records
        .iter()
        .rev()
        .take(8)
        .map(|r| {
            json!({ "turn": r.turn, "date": r.date, "decision": r.decisions.get(c),
                "rejected": r.report.rejected.iter().filter(|x| x.civ == c).collect::<Vec<_>>() })
        })
        .collect();
    Ok(json!({
        "civ": c,
        "goals": o.goals,
        "beliefs": o.civs,
        "income": o.me.income,
        "upkeep": o.me.upkeep,
        "memory": w.memories[c],
        "chronicle": w.memories[c].chronicle(&names),
        "recent_decisions": history,
        "offered": o.offered.len(),
    }))
}

/// The scenarios a lobby offers, with enough to draw a card for each.
pub fn scenarios() -> Value {
    let cards: Vec<Value> = builtin_ids()
        .into_iter()
        .filter(|id| *id != "generated")
        .filter_map(|id| builtin(id, 1))
        .map(|s| {
            json!({
                "id": s.id, "name": s.name, "description": s.description, "provenance": s.provenance,
                "date": date_of(s.start_year, 0),
                "provinces": s.provinces.len(),
                "civs": s.civs.iter().map(|c| json!({ "key": c.key, "name": c.name, "color": c.color,
                    "ruler": c.ruler, "government": c.government,
                    "provinces": s.provinces.iter().filter(|p| p.owner.as_deref() == Some(c.key.as_str())).count(),
                    "personality": c.personality })).collect::<Vec<_>>(),
                "points": s.provinces.iter().map(|p| json!([p.lon, p.lat, p.owner.as_ref()
                    .and_then(|o| s.civs.iter().position(|c| &c.key == o))])).collect::<Vec<_>>(),
            })
        })
        .collect();
    json!(cards)
}
