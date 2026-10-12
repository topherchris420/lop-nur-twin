//! The only code that changes the world. Choosers submit decisions; this module
//! re-validates every part against the world as it stands when that part runs,
//! applies what is legal, records what is not, then runs the turn's mechanics.

use serde::{Deserialize, Serialize};

use crate::action::*;
use crate::memory::MemoryEntry;
use crate::model::*;
use crate::rng::{purpose, Rng};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Submission {
    pub decision: Decision,
    /// Who wrote the decision's words (messages and note).
    pub generation: Generation,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Rejection {
    pub civ: CivId,
    pub what: String,
    pub reason: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct TurnReport {
    pub turn: u32,
    pub applied: usize,
    pub rejected: Vec<Rejection>,
    pub first_event: usize,
}

pub fn province_income(p: &Province) -> f64 {
    let coastal = if p.coastal { 1.1 } else { 1.0 };
    p.population * p.development * 0.0016 * p.terrain.income() * (1.0 - p.unrest / 150.0) * coastal
}

pub fn income(w: &World, c: CivId) -> f64 {
    let civ = &w.civs[c];
    let trades = w
        .treaties
        .iter()
        .filter(|t| t.kind == TreatyKind::Trade && (t.a == c || t.b == c))
        .count()
        .min(5) as f64;
    let mult = (1.0 + 0.08 * trades) * (0.75 + civ.stability / 200.0) * (1.0 + 0.1 * (civ.tech - 1.0));
    let base: f64 = w
        .controlled_by(c)
        .map(|p| province_income(p) * if p.owner == Some(c) { 1.0 } else { 0.4 })
        .sum();
    base * mult
}

pub fn upkeep(w: &World, c: CivId) -> f64 {
    let armies: f64 = w
        .armies
        .iter()
        .filter(|a| a.owner == c)
        .map(|a| a.strength * 0.35)
        .sum();
    let forts: f64 = w.provinces_of(c).map(|p| p.fort as f64 * 0.4).sum();
    armies + forts
}

/// Writes a memory into each witness. Only host code calls this.
fn witness(w: &mut World, who: &[CivId], kind: &str, about: &[CivId], text: &str, salience: f64, valence: f64) {
    let turn = w.turn;
    for &c in who {
        if c >= w.memories.len() || !w.civs[c].alive {
            continue;
        }
        let about: Vec<CivId> = about.iter().copied().filter(|&a| a != c).collect();
        w.memories[c].remember(MemoryEntry {
            turn,
            kind: kind.to_string(),
            about,
            text: text.to_string(),
            salience: clamp(salience, 0.0, 1.0),
            valence: clamp(valence, -1.0, 1.0),
        });
    }
}

fn event(w: &mut World, kind: &str, civs: Vec<CivId>, provinces: Vec<ProvId>, text: String, magnitude: f64) {
    w.events.push(Event {
        turn: w.turn,
        kind: kind.into(),
        civs,
        provinces,
        text,
        magnitude: round2(magnitude),
    });
}

fn shift_opinion(w: &mut World, of: CivId, toward: CivId, by: f64) {
    if of != toward {
        w.opinion[of][toward] = clamp(w.opinion[of][toward] + by, -100.0, 100.0);
    }
}

fn contacts_of_either(w: &World, a: CivId, b: CivId) -> Vec<CivId> {
    (0..w.civs.len())
        .filter(|&x| x != a && x != b && (w.in_contact(x, a) || w.in_contact(x, b)))
        .collect()
}

fn truncate_chars(s: &str, n: usize) -> String {
    s.chars().take(n).collect::<String>().trim().to_string()
}

pub fn resolve_turn(w: &mut World, subs: &[Submission]) -> TurnReport {
    let n = w.civs.len();
    let first_event = w.events.len();
    let mut rejected = Vec::new();
    let mut applied = 0;
    let empty = Submission {
        decision: Decision::default(),
        generation: Generation::Scripted,
    };
    let sub = |c: CivId| subs.get(c).unwrap_or(&empty);

    // 1. Answers to the proposals received last turn.
    let mut pending = std::mem::take(&mut w.proposals);
    pending.sort_by_key(|p| p.id);
    for p in pending {
        if !w.civs[p.to].alive || !w.civs[p.from].alive {
            continue;
        }
        let accept = sub(p.to)
            .decision
            .responses
            .iter()
            .find(|r| r.proposal == p.id)
            .map(|r| r.accept);
        match accept {
            Some(true) => accept_proposal(w, &p),
            _ => refuse_proposal(w, &p),
        }
    }

    // 2. Words: messages and private notes.
    for c in 0..n {
        if !w.civs[c].alive {
            continue;
        }
        let s = sub(c);
        for m in s.decision.messages.iter().take(MAX_MESSAGES) {
            let text = truncate_chars(&m.text, MESSAGE_CHARS);
            if m.to < n && m.to != c && w.civs[m.to].alive && !text.is_empty() {
                w.messages.push(Message {
                    turn: w.turn,
                    from: c,
                    to: m.to,
                    text,
                    generation: s.generation,
                });
            }
        }
        if let Some(note) = &s.decision.note {
            let note = truncate_chars(note, NOTE_CHARS);
            if !note.is_empty() {
                w.memories[c].add_note(w.turn, note);
            }
        }
    }
    w.messages.retain(|m| m.turn + 8 >= w.turn);

    // 3. Deeds, one from each civilization per round, rotating who goes first.
    let order: Vec<CivId> = (0..n).map(|i| (i + w.turn as usize) % n).collect();
    for round in 0..MAX_ACTIONS {
        for &c in &order {
            let Some(a) = sub(c).decision.actions.get(round) else {
                continue;
            };
            match validate(w, c, a) {
                Ok(()) => {
                    apply_action(w, c, a);
                    applied += 1;
                }
                Err(reason) => rejected.push(Rejection {
                    civ: c,
                    what: describe(w, c, a),
                    reason,
                }),
            }
        }
    }
    for c in 0..n {
        for a in sub(c).decision.actions.iter().skip(MAX_ACTIONS) {
            rejected.push(Rejection {
                civ: c,
                what: describe(w, c, a),
                reason: format!("more than {MAX_ACTIONS} actions"),
            });
        }
    }

    // 4-8. The world answers.
    for p in 0..w.provinces.len() {
        battles(w, p);
    }
    sieges(w);
    attrition(w);
    economy(w);
    unrest_and_revolt(w);
    random_events(w);
    upkeep_world(w);

    round_state(w);
    let stats = (0..n).map(|c| w.civ_stats(c)).collect();
    w.stats.push(stats);
    let report = TurnReport {
        turn: w.turn,
        applied,
        rejected,
        first_event,
    };
    w.turn += 1;
    report
}

fn refuse_proposal(w: &mut World, p: &Proposal) {
    let (from, to) = (p.from, p.to);
    let (fname, tname) = (w.civs[from].name.clone(), w.civs[to].name.clone());
    match &p.terms {
        Terms::JoinWar { war } => {
            if !w.wars.iter().any(|x| x.id == *war) {
                return;
            }
            w.treaties
                .retain(|t| !(t.kind == TreatyKind::Alliance && t.involves(from, to)));
            shift_opinion(w, from, to, -25.0);
            w.civs[to].prestige -= 8.0;
            let text = format!("{tname} refused {fname}'s call to arms; the alliance is broken");
            witness(w, &[from], "broken_promise", &[to], &text, 0.9, -0.9);
            witness(w, &[to], "refused_call", &[from], &text, 0.4, -0.2);
            event(w, "alliance_broken", vec![to, from], vec![], text, 4.0);
        }
        Terms::Tribute { .. } => {
            shift_opinion(w, from, to, -6.0);
            let text = format!("{tname} refused {fname}'s demand for tribute");
            witness(w, &[from], "defiance", &[to], &text, 0.4, -0.4);
            witness(w, &[to], "threatened", &[from], &text, 0.5, -0.5);
            event(w, "tribute_refused", vec![to, from], vec![], text, 1.0);
        }
        Terms::Peace { .. } => {
            let text = format!("{tname} rejected {fname}'s peace terms");
            witness(w, &[from], "rebuffed", &[to], &text, 0.3, -0.3);
        }
        _ => {
            shift_opinion(w, from, to, -2.0);
            let text = format!(
                "{tname} declined {}",
                describe_terms(w, &p.terms)
                    .replace("an ", "an offered ")
                    .replace("a ", "a proposed ")
            );
            witness(w, &[from], "rebuffed", &[to], &text, 0.2, -0.2);
        }
    }
}

fn accept_proposal(w: &mut World, p: &Proposal) {
    let (from, to) = (p.from, p.to);
    let (fname, tname) = (w.civs[from].name.clone(), w.civs[to].name.clone());
    match &p.terms {
        Terms::Alliance | Terms::NonAggression | Terms::Trade => {
            let kind = match p.terms {
                Terms::Alliance => TreatyKind::Alliance,
                Terms::NonAggression => TreatyKind::NonAggression,
                _ => TreatyKind::Trade,
            };
            if w.at_war(from, to) || w.has_treaty(from, to, kind) {
                return;
            }
            if kind == TreatyKind::NonAggression {
                w.treaties.retain(|t| !(t.kind == kind && t.involves(from, to)));
            }
            w.treaties.push(Treaty {
                kind,
                a: from,
                b: to,
                since: w.turn,
                expires: None,
            });
            shift_opinion(w, from, to, 10.0);
            shift_opinion(w, to, from, 10.0);
            let text = format!("{fname} and {tname} concluded {}", describe_terms(w, &p.terms));
            witness(w, &[from, to], "treaty", &[from, to], &text, 0.5, 0.5);
            event(w, "treaty", vec![from, to], vec![], text, 2.0);
        }
        Terms::Tribute { amount } => {
            let paid = amount.min(w.civs[to].treasury.max(0.0));
            w.civs[to].treasury -= paid;
            w.civs[from].treasury += paid;
            w.civs[to].stability -= 3.0;
            w.civs[to].prestige -= 5.0;
            w.civs[from].prestige += 5.0;
            shift_opinion(w, to, from, -10.0);
            let text = format!("{tname} paid {paid:.0} gold in tribute to {fname}");
            witness(w, &[to], "humiliation", &[from], &text, 0.6, -0.7);
            witness(w, &[from], "tribute_received", &[to], &text, 0.3, 0.3);
            event(w, "tribute", vec![to, from], vec![], text, 2.0);
        }
        Terms::JoinWar { war } => {
            let Some(ix) = w.wars.iter().position(|x| x.id == *war) else {
                return;
            };
            if w.wars[ix].side_of(to).is_some() || !w.allied(from, to) {
                return;
            }
            let Some(side) = w.wars[ix].side_of(from) else { return };
            if side {
                w.wars[ix].attackers.push(to);
            } else {
                w.wars[ix].defenders.push(to);
            }
            let enemies: Vec<CivId> = if side {
                w.wars[ix].defenders.clone()
            } else {
                w.wars[ix].attackers.clone()
            };
            for &e in &enemies {
                w.treaties.retain(|t| !t.involves(e, to));
                shift_opinion(w, e, to, -30.0);
                shift_opinion(w, to, e, -15.0);
            }
            shift_opinion(w, from, to, 15.0);
            let text = format!("{tname} honoured its alliance and joined {fname}'s war");
            witness(w, &[from], "promise_kept", &[to], &text, 0.7, 0.8);
            witness(w, &enemies, "new_enemy", &[to], &text, 0.6, -0.6);
            let mut civs = vec![to, from];
            civs.extend(enemies);
            event(w, "joined_war", civs, vec![], text, 3.0);
        }
        Terms::Peace {
            war,
            cede,
            concede,
            tribute,
        } => make_peace(w, p, *war, cede, concede, *tribute),
    }
}

fn make_peace(w: &mut World, p: &Proposal, war_id: u32, cede: &[ProvId], concede: &[ProvId], tribute: f64) {
    let (from, to) = (p.from, p.to);
    let Some(ix) = w.wars.iter().position(|x| x.id == war_id) else {
        return;
    };
    if !w.wars[ix].opposes(from, to) {
        return;
    }
    let war = w.wars[ix].clone();
    let both_leaders =
        (war.leader(true) == from || war.leader(false) == from) && (war.leader(true) == to || war.leader(false) == to);
    // Who leaves the war: everyone if the leaders agree, otherwise the parties.
    let leaving: Vec<CivId> = if both_leaders {
        war.attackers.iter().chain(war.defenders.iter()).copied().collect()
    } else {
        vec![from, to]
    };
    let mut moved = Vec::new();
    for &pid in cede {
        let prov = &w.provinces[pid];
        if prov.owner == Some(to) && prov.controller == Some(from) {
            moved.push((pid, to, from));
        }
    }
    for &pid in concede {
        let prov = &w.provinces[pid];
        if prov.owner == Some(from) && prov.controller == Some(to) && pid != w.civs[from].capital {
            moved.push((pid, from, to));
        }
    }
    for &(pid, loser, winner) in &moved {
        let prov = &mut w.provinces[pid];
        prov.owner = Some(winner);
        prov.controller = Some(winner);
        prov.siege_by = None;
        prov.siege = 0.0;
        if !prov.claims.contains(&loser) {
            prov.claims.push(loser);
        }
        prov.claims.retain(|&c| c != winner);
        w.civs[winner].prestige += 5.0;
        w.civs[loser].prestige -= 5.0;
        w.civs[loser].stability -= 4.0;
    }
    if tribute > 0.0 {
        let paid = tribute.min(w.civs[to].treasury.max(0.0));
        w.civs[to].treasury -= paid;
        w.civs[from].treasury += paid;
    }
    // Occupations between those leaving end; armies go home.
    let enemies_of = |c: CivId| -> Vec<CivId> {
        if war.attackers.contains(&c) {
            war.defenders.clone()
        } else {
            war.attackers.clone()
        }
    };
    for pid in 0..w.provinces.len() {
        let (owner, controller) = (w.provinces[pid].owner, w.provinces[pid].controller);
        if let (Some(o), Some(h)) = (owner, controller) {
            if o != h && leaving.contains(&o) && leaving.contains(&h) && enemies_of(o).contains(&h) {
                w.provinces[pid].controller = Some(o);
                w.provinces[pid].siege_by = None;
                w.provinces[pid].siege = 0.0;
            }
        }
    }
    if both_leaders {
        w.wars.remove(ix);
    } else {
        let wr = &mut w.wars[ix];
        let non_leader = if wr.leader(true) != from && wr.leader(false) != from {
            from
        } else {
            to
        };
        wr.attackers.retain(|&c| c != non_leader);
        wr.defenders.retain(|&c| c != non_leader);
        if wr.attackers.is_empty() || wr.defenders.is_empty() {
            w.wars.remove(ix);
        }
    }
    let truce_until = w.turn + 12;
    for &a in &leaving {
        for &b in &leaving {
            if a < b && enemies_of(a).contains(&b) && !w.at_war(a, b) {
                w.treaties
                    .retain(|t| !(t.kind == TreatyKind::NonAggression && t.involves(a, b)));
                w.treaties.push(Treaty {
                    kind: TreatyKind::NonAggression,
                    a,
                    b,
                    since: w.turn,
                    expires: Some(truce_until),
                });
            }
        }
    }
    send_armies_home(w);
    let (fname, tname) = (w.civs[from].name.clone(), w.civs[to].name.clone());
    let names: Vec<String> = moved.iter().map(|(pid, _, _)| w.provinces[*pid].name.clone()).collect();
    let text = if names.is_empty() {
        format!("{fname} and {tname} made peace on the status quo")
    } else {
        format!("{fname} and {tname} made peace; {} changed hands", names.join(", "))
    };
    witness(w, &leaving, "peace", &[from, to], &text, 0.6, 0.3);
    for &(_, loser, winner) in &moved {
        witness(w, &[loser], "lost_province", &[winner], &text, 0.8, -0.8);
    }
    event(
        w,
        "peace",
        leaving,
        moved.iter().map(|m| m.0).collect(),
        text,
        3.0 + moved.len() as f64,
    );
}

/// Armies standing where their owner may not be are walked home to the capital.
fn send_armies_home(w: &mut World) {
    for i in 0..w.armies.len() {
        let (owner, loc) = (w.armies[i].owner, w.armies[i].location);
        let holder = w.provinces[loc].controller;
        let hostile_ok = match holder {
            None => true,
            Some(h) => h == owner || w.allied(owner, h) || w.at_war(owner, h),
        };
        if !hostile_ok {
            let cap = w.civs[owner].capital;
            let home = if w.provinces[cap].controller == Some(owner) {
                Some(cap)
            } else {
                w.controlled_by(owner).map(|p| p.id).next()
            };
            if let Some(p) = home {
                w.armies[i].location = p;
            }
        }
    }
}

fn apply_action(w: &mut World, c: CivId, a: &Action) {
    let pay = cost(w, c, a);
    w.civs[c].treasury -= pay;
    let name = w.civs[c].name.clone();
    match a {
        Action::Move { army, to } => {
            let turn = w.turn;
            if let Some(ar) = w.armies.iter_mut().find(|x| x.id == *army) {
                ar.location = *to;
                ar.moved = turn;
            }
        }
        Action::Recruit { province, amount } => {
            w.civs[c].manpower -= amount;
            w.provinces[*province].population -= amount * 0.5;
            if let Some(ar) = w.armies.iter_mut().find(|x| x.owner == c && x.location == *province) {
                let total = ar.strength + amount;
                ar.morale = (ar.morale * ar.strength + 0.8 * amount) / total;
                ar.strength = total;
            } else {
                let id = w.next_army;
                w.next_army += 1;
                w.armies.push(Army {
                    id,
                    owner: c,
                    location: *province,
                    strength: *amount,
                    morale: 0.8,
                    moved: w.turn,
                });
            }
        }
        Action::Fortify { province } => w.provinces[*province].fort += 1,
        Action::Develop { province } => {
            let p = &mut w.provinces[*province];
            p.development = (p.development + 0.5).min(10.0);
        }
        Action::Research => w.civs[c].tech += 0.08,
        Action::Suppress { province } => {
            let p = &mut w.provinces[*province];
            p.unrest = (p.unrest - 20.0).max(0.0);
            w.civs[c].stability -= 1.0;
        }
        Action::Propose { to, terms } => {
            let id = w.next_proposal;
            w.next_proposal += 1;
            w.proposals.push(Proposal {
                id,
                from: c,
                to: *to,
                turn: w.turn,
                terms: terms.clone(),
            });
        }
        Action::Gift { to, amount } => {
            w.civs[*to].treasury += amount;
            shift_opinion(w, *to, c, amount * 0.5);
            let text = format!("{name} sent {amount:.0} gold to {}", w.civs[*to].name);
            witness(w, &[*to], "gift", &[c], &text, 0.3, 0.6);
            event(w, "gift", vec![c, *to], vec![], text, 0.5);
        }
        Action::CancelTreaty { with, kind } => {
            w.treaties.retain(|t| !(t.kind == *kind && t.involves(c, *with)));
            shift_opinion(w, *with, c, -15.0);
            let text = format!("{name} cancelled its {} with {}", kind.label(), w.civs[*with].name);
            witness(w, &[*with], "treaty_cancelled", &[c], &text, 0.5, -0.5);
            event(w, "treaty_cancelled", vec![c, *with], vec![], text, 1.0);
        }
        Action::DeclareWar { target } => declare_war(w, c, *target),
    }
}

fn declare_war(w: &mut World, c: CivId, target: CivId) {
    let name = w.civs[c].name.clone();
    let tname = w.civs[target].name.clone();
    let broke_pact = w.has_treaty(c, target, TreatyKind::NonAggression);
    let justified = w
        .provinces
        .iter()
        .any(|p| p.claims.contains(&c) && p.owner == Some(target))
        || w.memories[c].belief(target).grievances >= 2;
    w.treaties.retain(|t| !t.involves(c, target));
    let id = w.next_war;
    w.next_war += 1;
    w.wars.push(War {
        id,
        attackers: vec![c],
        defenders: vec![target],
        started: w.turn,
        score: 0.0,
        battles: 0,
    });
    shift_opinion(w, target, c, -40.0);
    shift_opinion(w, c, target, -20.0);
    let others = contacts_of_either(w, c, target);
    let mut text = format!("{name} declared war on {tname}");
    if broke_pact {
        text += ", breaking their non-aggression pact";
        w.civs[c].stability -= 10.0;
        w.civs[c].prestige -= 10.0;
        for &o in &others {
            shift_opinion(w, o, c, -10.0);
        }
        witness(w, &[target], "betrayal", &[c], &text, 1.0, -1.0);
        witness(w, &others, "broken_promise", &[c], &text, 0.5, -0.4);
    } else {
        witness(w, &[target], "attacked", &[c], &text, 0.9, -0.9);
        witness(w, &others, "war_declared", &[c, target], &text, 0.4, -0.1);
    }
    if !justified {
        text += " without a just cause";
        w.civs[c].stability -= 5.0;
        for &o in &others {
            shift_opinion(w, o, c, -5.0);
        }
    }
    witness(w, &[c], "went_to_war", &[target], &text, 0.6, 0.0);
    let mut civs = vec![c, target];
    // Alliance obligations are invoked by the host: each ally of the defender is
    // asked, and its brain answers next turn.
    let allies: Vec<CivId> = w
        .treaties
        .iter()
        .filter(|t| t.kind == TreatyKind::Alliance && (t.a == target || t.b == target))
        .map(|t| if t.a == target { t.b } else { t.a })
        .filter(|&a| a != c && w.civs[a].alive)
        .collect();
    for ally in allies {
        let pid = w.next_proposal;
        w.next_proposal += 1;
        w.proposals.push(Proposal {
            id: pid,
            from: target,
            to: ally,
            turn: w.turn,
            terms: Terms::JoinWar { war: id },
        });
        civs.push(ally);
    }
    event(w, "war", civs, vec![], text, 5.0);
}

fn battles(w: &mut World, p: ProvId) {
    for _ in 0..6 {
        let present: Vec<CivId> = {
            let mut v: Vec<CivId> = w.armies_in(p).map(|a| a.owner).collect();
            v.sort_unstable();
            v.dedup();
            v
        };
        let mut best: Option<(f64, CivId, CivId)> = None;
        for (i, &a) in present.iter().enumerate() {
            for &b in &present[i + 1..] {
                if w.at_war(a, b) {
                    let s: f64 = w
                        .armies_in(p)
                        .filter(|x| x.owner == a || x.owner == b)
                        .map(|x| x.strength)
                        .sum();
                    if best.is_none_or(|(bs, _, _)| s > bs) {
                        best = Some((s, a, b));
                    }
                }
            }
        }
        let Some((_, a, b)) = best else { return };
        let war = w.war_between(a, b).expect("pair is at war").clone();
        let side_a = war.side_of(a).expect("a is in the war");
        let on_a = |x: CivId| war.side_of(x) == Some(side_a);
        let on_b = |x: CivId| war.side_of(x) == Some(!side_a);
        let mut rng = Rng::stream(w.seed, &[w.turn as u64, p as u64, purpose::BATTLE, a as u64, b as u64]);
        let prov = &w.provinces[p];
        let holder = prov.controller;
        let ground = prov.terrain.defense() * (1.0 + 0.25 * prov.fort as f64);
        let power = |w: &World, side: &dyn Fn(CivId) -> bool| -> f64 {
            w.armies_in(p)
                .filter(|x| side(x.owner))
                .map(|x| x.strength * x.morale * (1.0 + 0.15 * (w.civs[x.owner].tech - 1.0)))
                .sum()
        };
        let mut pa = power(w, &on_a) * rng.range(0.8, 1.2);
        let mut pb = power(w, &on_b) * rng.range(0.8, 1.2);
        match holder {
            Some(h) if on_a(h) => pa *= ground,
            Some(h) if on_b(h) => pb *= ground,
            _ => {}
        }
        let a_wins = pa >= pb;
        let (pw, pl) = if a_wins { (pa, pb) } else { (pb, pa) };
        let ratio = pw / pl.max(0.01);
        let loser_frac = clamp(0.15 + 0.17 * (ratio - 1.0), 0.15, 0.6);
        let winner_frac = clamp(0.02 + 0.08 / ratio, 0.03, 0.25);
        let (mut lost_w, mut lost_l) = (0.0, 0.0);
        let mut sw = 0.0;
        let mut sl = 0.0;
        for ar in w.armies.iter_mut().filter(|x| x.location == p) {
            let winner = if a_wins { on_a(ar.owner) } else { on_b(ar.owner) };
            let loser = if a_wins { on_b(ar.owner) } else { on_a(ar.owner) };
            if winner {
                sw += ar.strength;
                lost_w += ar.strength * winner_frac;
                ar.strength *= 1.0 - winner_frac;
                ar.morale = (ar.morale + 0.05).min(1.0);
            } else if loser {
                sl += ar.strength;
                lost_l += ar.strength * loser_frac;
                ar.strength *= 1.0 - loser_frac;
                ar.morale = (ar.morale - 0.25).max(0.2);
            }
        }
        let (winner_civ, loser_civ) = if a_wins { (a, b) } else { (b, a) };
        // The beaten withdraw to friendly ground free of enemies, or are scattered.
        let mut routed = 0.0;
        let losers: Vec<usize> = (0..w.armies.len())
            .filter(|&i| {
                w.armies[i].location == p
                    && if a_wins {
                        on_b(w.armies[i].owner)
                    } else {
                        on_a(w.armies[i].owner)
                    }
            })
            .collect();
        for i in losers {
            let owner = w.armies[i].owner;
            let retreat = w.provinces[p]
                .neighbors()
                .filter(|&n| w.friendly_ground(owner, n))
                .filter(|&n| !w.armies_in(n).any(|x| w.at_war(owner, x.owner)))
                .min();
            match retreat {
                Some(n) => w.armies[i].location = n,
                None => {
                    routed += w.armies[i].strength;
                    w.armies[i].strength = 0.0;
                }
            }
        }
        w.armies.retain(|x| x.strength >= 0.5);
        let winner_side_attacks = war.side_of(winner_civ) == Some(true);
        if let Some(wr) = w.wars.iter_mut().find(|x| x.id == war.id) {
            let swing = 2.0 + lost_l + routed;
            wr.score += if winner_side_attacks { swing } else { -swing };
            wr.battles += 1;
        }
        w.civs[winner_civ].war_weariness += lost_w * 0.5;
        w.civs[loser_civ].war_weariness += (lost_l + routed) * 0.5;
        w.civs[winner_civ].prestige += 1.0;
        w.provinces[p].population *= 0.98;
        let pname = w.provinces[p].name.clone();
        let (wn, ln) = (w.civs[winner_civ].name.clone(), w.civs[loser_civ].name.clone());
        let mut text = format!(
            "Battle of {pname}: {wn} ({sw:.1}k) defeated {ln} ({sl:.1}k); losses {lost_w:.1}k against {lost_l:.1}k"
        );
        if routed > 0.0 {
            text += &format!(", and {routed:.1}k more were cut off and scattered");
        }
        let size = lost_w + lost_l + routed;
        witness(
            w,
            &[winner_civ],
            "battle_won",
            &[loser_civ],
            &text,
            (size / 10.0).min(1.0),
            0.5,
        );
        witness(
            w,
            &[loser_civ],
            "battle_lost",
            &[winner_civ],
            &text,
            (size / 8.0).min(1.0),
            -0.7,
        );
        event(w, "battle", vec![winner_civ, loser_civ], vec![p], text, size);
    }
}

fn sieges(w: &mut World) {
    for p in 0..w.provinces.len() {
        let holder = w.provinces[p].controller;
        // Strength each would-be taker has standing here.
        let mut takers: Vec<(CivId, f64)> = Vec::new();
        for a in w.armies_in(p) {
            let hostile = match holder {
                None => true,
                Some(h) => a.owner != h && w.at_war(a.owner, h),
            };
            if !hostile {
                continue;
            }
            if let Some(t) = takers.iter_mut().find(|t| t.0 == a.owner) {
                t.1 += a.strength;
            } else {
                takers.push((a.owner, a.strength));
            }
        }
        let defended = holder.is_some_and(|h| {
            w.armies_in(p)
                .any(|a| a.owner == h || (w.allied(a.owner, h) && !takers.iter().any(|t| t.0 == a.owner)))
        });
        let Some(&(taker, strength)) = takers.iter().max_by(|x, y| x.1.total_cmp(&y.1).then(y.0.cmp(&x.0))) else {
            w.provinces[p].siege_by = None;
            w.provinces[p].siege = 0.0;
            continue;
        };
        if defended {
            continue;
        }
        if w.provinces[p].siege_by != Some(taker) {
            w.provinces[p].siege_by = Some(taker);
            w.provinces[p].siege = 0.0;
        }
        let prov = &w.provinces[p];
        let resistance = match holder {
            None => prov.natives + prov.fort as f64 * 3.0,
            Some(_) => 2.0 + prov.fort as f64 * 3.0 + prov.development * 0.3,
        };
        let mut rng = Rng::stream(w.seed, &[w.turn as u64, p as u64, purpose::SIEGE]);
        let progress = strength / (resistance.max(0.5) * 2.5) * rng.range(0.8, 1.2);
        w.provinces[p].siege += progress;
        if w.provinces[p].siege < 1.0 {
            continue;
        }
        w.provinces[p].siege = 0.0;
        w.provinces[p].siege_by = None;
        w.provinces[p].population *= 0.97;
        let pname = w.provinces[p].name.clone();
        let tname = w.civs[taker].name.clone();
        match holder {
            None => {
                let prov = &mut w.provinces[p];
                prov.owner = Some(taker);
                prov.controller = Some(taker);
                prov.natives = 0.0;
                prov.unrest = 45.0;
                prov.claims.retain(|&c| c != taker);
                let rivals: Vec<CivId> = prov.claims.clone();
                w.civs[taker].prestige += 3.0;
                let text = format!("{tname} took {pname}");
                witness(w, &[taker], "conquest", &[], &text, 0.5, 0.5);
                witness(w, &rivals, "claim_lost", &[taker], &text, 0.6, -0.6);
                let mut civs = vec![taker];
                civs.extend(rivals);
                event(w, "conquest", civs, vec![p], text, 3.0);
            }
            Some(h) => {
                let owner = w.provinces[p].owner;
                w.provinces[p].controller = Some(taker);
                let liberated = owner == Some(taker);
                w.provinces[p].unrest = if liberated {
                    (w.provinces[p].unrest - 10.0).max(0.0)
                } else {
                    w.provinces[p].unrest + 25.0
                };
                let capital = w.civs[h].capital == p;
                let swing = 3.0 + w.provinces[p].development + if capital { 15.0 } else { 0.0 };
                if let Some(wr) = w.wars.iter_mut().find(|x| x.opposes(taker, h)) {
                    let attacks = wr.side_of(taker) == Some(true);
                    wr.score += if attacks { swing } else { -swing };
                }
                if capital {
                    w.civs[h].stability -= 10.0;
                }
                let hname = w.civs[h].name.clone();
                let text = if liberated {
                    format!("{tname} liberated {pname} from {hname}")
                } else if capital {
                    format!("{tname} captured {pname}, the capital of {hname}")
                } else {
                    format!("{tname} occupied {pname}, taken from {hname}")
                };
                witness(
                    w,
                    &[h],
                    "lost_ground",
                    &[taker],
                    &text,
                    if capital { 1.0 } else { 0.5 },
                    -0.6,
                );
                witness(w, &[taker], "took_ground", &[h], &text, 0.4, 0.4);
                event(
                    w,
                    if liberated { "liberation" } else { "occupation" },
                    vec![taker, h],
                    vec![p],
                    text,
                    swing,
                );
            }
        }
    }
}

fn attrition(w: &mut World) {
    for i in 0..w.armies.len() {
        let (owner, loc) = (w.armies[i].owner, w.armies[i].location);
        let friendly = w.friendly_ground(owner, loc);
        let broke = w.civs[owner].treasury < 0.0;
        let ar = &mut w.armies[i];
        if friendly {
            ar.morale = (ar.morale + 0.1).min(1.0);
        } else {
            ar.strength *= 1.0 - w.provinces[loc].terrain.attrition();
        }
        if broke {
            ar.strength *= 0.95;
            ar.morale = (ar.morale - 0.1).max(0.2);
        }
    }
    w.armies.retain(|x| x.strength >= 0.5);
}

fn economy(w: &mut World) {
    for c in 0..w.civs.len() {
        if !w.civs[c].alive {
            continue;
        }
        let net = income(w, c) - upkeep(w, c);
        let pool: f64 = w
            .controlled_by(c)
            .filter(|p| p.owner == Some(c))
            .map(|p| p.population)
            .sum();
        let civ = &mut w.civs[c];
        civ.treasury += net;
        civ.manpower = (civ.manpower + pool * 0.0035).min(pool * 0.06);
        if civ.treasury < -50.0 {
            civ.treasury = -50.0;
            let name = civ.name.clone();
            for ar in w.armies.iter_mut().filter(|a| a.owner == c) {
                ar.strength *= 0.9;
            }
            let text = format!("Unpaid soldiers of {name} deserted");
            witness(w, &[c], "bankruptcy", &[], &text, 0.6, -0.6);
            event(w, "desertion", vec![c], vec![], text, 2.0);
        }
    }
    for p in w.provinces.iter_mut() {
        let cap = p.terrain.capacity() * p.development;
        p.population = (p.population + p.population * 0.004 * (1.0 - p.population / cap)).max(5.0);
    }
}

fn unrest_and_revolt(w: &mut World) {
    for p in 0..w.provinces.len() {
        let Some(owner) = w.provinces[p].owner else { continue };
        let civ = &w.civs[owner];
        let prov = &w.provinces[p];
        let garrison: f64 = w.armies_in(p).filter(|a| a.owner == owner).map(|a| a.strength).sum();
        let mut target = 8.0 + (50.0 - civ.stability).max(0.0) / 3.0 + civ.war_weariness / 5.0 - prov.fort as f64 * 2.0;
        if prov.controller != Some(owner) {
            target += 30.0;
        }
        if !civ.accepts(&prov.culture) {
            target += 15.0;
        }
        if garrison >= 2.0 {
            target -= 10.0;
        }
        let unrest = prov.unrest + (target.max(0.0) - prov.unrest) * 0.2;
        w.provinces[p].unrest = clamp(unrest, 0.0, 100.0);
        if w.provinces[p].unrest <= 65.0 || w.provinces[p].controller != Some(owner) {
            continue;
        }
        let mut rng = Rng::stream(w.seed, &[w.turn as u64, p as u64, purpose::REVOLT]);
        if !rng.chance((w.provinces[p].unrest - 65.0) / 100.0) {
            continue;
        }
        let pname = w.provinces[p].name.clone();
        let oname = w.civs[owner].name.clone();
        if garrison >= 3.0 || w.civs[owner].capital == p {
            for ar in w.armies.iter_mut().filter(|a| a.owner == owner && a.location == p) {
                ar.strength *= 0.85;
            }
            w.provinces[p].unrest -= 20.0;
            w.civs[owner].stability -= 2.0;
            let text = format!("A revolt in {pname} was put down by {oname}");
            witness(w, &[owner], "revolt_crushed", &[], &text, 0.3, -0.2);
            event(w, "revolt_crushed", vec![owner], vec![p], text, 1.0);
        } else {
            let prov = &mut w.provinces[p];
            prov.owner = None;
            prov.controller = None;
            prov.natives = round2(2.0 + prov.population / 80.0);
            prov.unrest = 20.0;
            if !prov.claims.contains(&owner) {
                prov.claims.push(owner);
            }
            w.civs[owner].stability -= 5.0;
            let text = format!("{pname} rose up and threw off the rule of {oname}");
            witness(w, &[owner], "lost_province", &[], &text, 0.8, -0.8);
            event(w, "revolt", vec![owner], vec![p], text, 3.0);
        }
    }
}

fn random_events(w: &mut World) {
    for c in 0..w.civs.len() {
        if !w.civs[c].alive {
            continue;
        }
        let mut rng = Rng::stream(w.seed, &[w.turn as u64, c as u64, purpose::EVENTS]);
        let owned: Vec<ProvId> = w.provinces_of(c).map(|p| p.id).collect();
        if owned.is_empty() {
            continue;
        }
        let roll = rng.f64();
        let site = owned[rng.below(owned.len())];
        let name = w.civs[c].name.clone();
        let pname = w.provinces[site].name.clone();
        let mercantile = w.civs[c].personality.mercantile;
        // Bands of one roll, so at most one event befalls a power each turn:
        // harvest 2%, plague 1.2%, succession 1.5%, windfall up to 2%,
        // a great general 0.8%, scandal 1.5%.
        if roll < 0.02 {
            w.provinces[site].population *= 1.03;
            let text = format!("A bountiful harvest in {pname} swelled the towns of {name}");
            witness(w, &[c], "harvest", &[], &text, 0.15, 0.3);
            event(w, "harvest", vec![c], vec![site], text, 1.0);
        } else if roll < 0.032 {
            let mut hit = vec![site];
            hit.extend(w.provinces[site].neighbors());
            for &p in &hit {
                w.provinces[p].population *= 0.92;
            }
            w.civs[c].stability -= 3.0;
            let text = format!("Plague broke out in {pname} and spread to its neighbours");
            let victims: Vec<CivId> = {
                let mut v: Vec<CivId> = hit.iter().filter_map(|&p| w.provinces[p].owner).collect();
                v.sort_unstable();
                v.dedup();
                v
            };
            witness(w, &victims, "plague", &[], &text, 0.4, -0.5);
            event(w, "plague", victims, hit, text, 3.0);
        } else if roll < 0.047 {
            let old = w.civs[c].ruler.clone();
            let p = &mut w.civs[c].personality;
            let d1 = rng.range(-0.15, 0.15);
            let d2 = rng.range(-0.15, 0.15);
            p.aggression = round2(clamp(p.aggression + d1, 0.05, 0.95));
            p.caution = round2(clamp(p.caution + d2, 0.05, 0.95));
            let date = w.date();
            w.civs[c].ruler = format!("the {} leadership of {date}", w.civs[c].adjective);
            w.civs[c].stability -= 8.0;
            let text = format!("Power in {name} passed from {old} to new hands");
            witness(w, &[c], "succession", &[], &text, 0.5, -0.2);
            event(w, "succession", vec![c], vec![], text, 2.0);
        } else if roll < 0.047 + 0.02 * mercantile {
            let gain = round2(10.0 + w.provinces[site].development * 2.0);
            w.civs[c].treasury += gain;
            let text = format!("Merchants of {pname} brought {name} a windfall of {gain:.0} gold");
            witness(w, &[c], "windfall", &[], &text, 0.15, 0.3);
            event(w, "windfall", vec![c], vec![site], text, 1.0);
        } else if (0.07..0.078).contains(&roll) {
            let big = (0..w.armies.len())
                .filter(|&i| w.armies[i].owner == c)
                .max_by(|&a, &b| w.armies[a].strength.total_cmp(&w.armies[b].strength).then(b.cmp(&a)));
            if let Some(i) = big {
                w.armies[i].morale = 1.0;
                w.armies[i].strength *= 1.1;
                let text = format!("A gifted general rose to command army #{} of {name}", w.armies[i].id);
                witness(w, &[c], "great_general", &[], &text, 0.3, 0.4);
                event(w, "great_general", vec![c], vec![w.armies[i].location], text, 1.0);
            }
        } else if (0.078..0.093).contains(&roll) {
            w.civs[c].stability -= 6.0;
            let text = format!("Scandal and faction shook the court of {name}");
            witness(w, &[c], "scandal", &[], &text, 0.25, -0.3);
            event(w, "scandal", vec![c], vec![], text, 1.0);
        }
    }
}

fn upkeep_world(w: &mut World) {
    let n = w.civs.len();
    let turn = w.turn;
    w.treaties.retain(|t| t.expires.is_none_or(|e| e > turn));
    // Fallen powers.
    for c in 0..n {
        if w.civs[c].alive && w.provinces_of(c).next().is_none() {
            w.civs[c].alive = false;
            w.armies.retain(|a| a.owner != c);
            w.treaties.retain(|t| t.a != c && t.b != c);
            w.proposals.retain(|p| p.from != c && p.to != c);
            for wr in w.wars.iter_mut() {
                wr.attackers.retain(|&x| x != c);
                wr.defenders.retain(|&x| x != c);
            }
            for p in w.provinces.iter_mut().filter(|p| p.controller == Some(c)) {
                p.controller = p.owner;
            }
            let text = format!("{} has fallen", w.civs[c].name);
            let all: Vec<CivId> = (0..n).filter(|&x| x != c).collect();
            witness(w, &all, "civ_fell", &[c], &text, 0.7, 0.0);
            event(w, "fall", vec![c], vec![], text, 10.0);
        }
    }
    w.wars.retain(|wr| !wr.attackers.is_empty() && !wr.defenders.is_empty());
    // A capital lost by treaty moves to the most populous remaining province.
    for c in 0..n {
        let cap = w.civs[c].capital;
        if w.civs[c].alive && w.provinces[cap].owner != Some(c) {
            if let Some(new) = w
                .provinces_of(c)
                .max_by(|a, b| a.population.total_cmp(&b.population).then(b.id.cmp(&a.id)))
                .map(|p| p.id)
            {
                w.civs[c].capital = new;
                let text = format!("{} moved its capital to {}", w.civs[c].name, w.provinces[new].name);
                event(w, "capital_moved", vec![c], vec![new], text, 2.0);
            }
        }
    }
    for c in 0..n {
        if !w.civs[c].alive {
            continue;
        }
        let wars = w.wars_of(c).count() as f64;
        let civ = &mut w.civs[c];
        civ.war_weariness = clamp(
            if wars > 0.0 {
                civ.war_weariness + 1.5 * wars
            } else {
                civ.war_weariness - 3.0
            },
            0.0,
            100.0,
        );
        let target = 55.0 + civ.prestige / 5.0 - civ.war_weariness / 3.0 - if civ.treasury < 0.0 { 15.0 } else { 0.0 };
        civ.stability = clamp(civ.stability + (target - civ.stability) * 0.08, 0.0, 100.0);
        civ.prestige *= 0.95;
    }
    // Opinions drift toward indifference and are pulled by circumstance.
    let border: Vec<Vec<bool>> = {
        let mut b = vec![vec![false; n]; n];
        for p in &w.provinces {
            if let Some(x) = p.controller {
                for q in p.neighbors() {
                    if let Some(y) = w.provinces[q].controller {
                        if x != y {
                            b[x][y] = true;
                        }
                    }
                }
            }
        }
        b
    };
    for a in 0..n {
        for b in 0..n {
            if a == b || !w.civs[a].alive || !w.civs[b].alive {
                continue;
            }
            let mut d = -w.opinion[a][b] * 0.03;
            for t in w.treaties.iter().filter(|t| t.involves(a, b)) {
                d += match t.kind {
                    TreatyKind::Alliance => 1.2,
                    TreatyKind::Trade => 0.6,
                    TreatyKind::NonAggression => 0.4,
                };
            }
            if w.at_war(a, b) {
                d -= 2.5;
            }
            if (0..n).any(|e| e != a && e != b && w.at_war(a, e) && w.at_war(b, e)) {
                d += 1.0;
            }
            if border[a][b] && !w.treaties.iter().any(|t| t.involves(a, b)) {
                d -= 0.4 * w.civs[b].personality.aggression;
            }
            w.opinion[a][b] = clamp(w.opinion[a][b] + d, -100.0, 100.0);
        }
    }
}

fn round_state(w: &mut World) {
    for p in w.provinces.iter_mut() {
        p.population = round2(p.population);
        p.development = round2(p.development);
        p.unrest = round2(p.unrest);
        p.siege = round2(p.siege);
        p.natives = round2(p.natives);
    }
    for a in w.armies.iter_mut() {
        a.strength = round2(a.strength);
        a.morale = round2(a.morale);
    }
    for c in w.civs.iter_mut() {
        c.treasury = round2(c.treasury);
        c.manpower = round2(c.manpower);
        c.stability = round2(c.stability);
        c.tech = round2(c.tech);
        c.war_weariness = round2(c.war_weariness);
        c.prestige = round2(c.prestige);
    }
    for row in w.opinion.iter_mut() {
        for v in row.iter_mut() {
            *v = round2(*v);
        }
    }
    for wr in w.wars.iter_mut() {
        wr.score = round2(wr.score);
    }
}
