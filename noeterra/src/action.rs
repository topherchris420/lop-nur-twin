//! The closed vocabulary through which every chooser — rules, models and
//! people — acts on the world. A chooser picks from `offered`; the resolver
//! re-checks each pick with `validate` against the world as it is by then.

use serde::{Deserialize, Serialize};

use crate::model::*;

pub const MAX_ACTIONS: usize = 6;
pub const MAX_MESSAGES: usize = 3;
pub const MESSAGE_CHARS: usize = 400;
pub const NOTE_CHARS: usize = 300;
pub const RECRUIT_COST: f64 = 4.0;
pub const SUPPRESS_COST: f64 = 10.0;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Action {
    Move { army: u32, to: ProvId },
    Recruit { province: ProvId, amount: f64 },
    Fortify { province: ProvId },
    Develop { province: ProvId },
    Research,
    Suppress { province: ProvId },
    Propose { to: CivId, terms: Terms },
    DeclareWar { target: CivId },
    Gift { to: CivId, amount: f64 },
    CancelTreaty { with: CivId, kind: TreatyKind },
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Response {
    pub proposal: u32,
    pub accept: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Outgoing {
    pub to: CivId,
    pub text: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct Decision {
    pub actions: Vec<Action>,
    pub responses: Vec<Response>,
    pub messages: Vec<Outgoing>,
    pub note: Option<String>,
}

pub fn fortify_cost(fort: u8) -> f64 {
    25.0 * (fort as f64 + 1.0)
}
pub fn develop_cost(dev: f64) -> f64 {
    round2(12.0 * dev)
}
pub fn research_cost(tech: f64) -> f64 {
    round2(20.0 + 15.0 * tech)
}

/// Gold an action spends. Used to keep a decision within the treasury.
pub fn cost(w: &World, c: CivId, a: &Action) -> f64 {
    match a {
        Action::Recruit { amount, .. } => amount * RECRUIT_COST,
        Action::Fortify { province } => fortify_cost(w.provinces[*province].fort),
        Action::Develop { province } => develop_cost(w.provinces[*province].development),
        Action::Research => research_cost(w.civs[c].tech),
        Action::Suppress { .. } => SUPPRESS_COST,
        Action::Gift { amount, .. } => *amount,
        _ => 0.0,
    }
}

/// Every id an action names exists. Checked before anything indexes by it, so
/// a forged or stale decision is refused rather than crashing the resolver.
pub fn well_formed(w: &World, a: &Action) -> Result<(), String> {
    let prov = |p: ProvId| {
        if p < w.provinces.len() {
            Ok(())
        } else {
            Err(format!("no province #{p}"))
        }
    };
    let civ = |c: CivId| {
        if c < w.civs.len() {
            Ok(())
        } else {
            Err(format!("no civilization #{c}"))
        }
    };
    let num = |x: f64| {
        if x.is_finite() {
            Ok(())
        } else {
            Err("not a number".to_string())
        }
    };
    match a {
        Action::Move { army, to } => {
            prov(*to)?;
            w.army(*army).map(|_| ()).ok_or_else(|| format!("no army #{army}"))
        }
        Action::Recruit { province, amount } => {
            num(*amount)?;
            prov(*province)
        }
        Action::Fortify { province } | Action::Develop { province } | Action::Suppress { province } => prov(*province),
        Action::Research => Ok(()),
        Action::DeclareWar { target } => civ(*target),
        Action::CancelTreaty { with, .. } => civ(*with),
        Action::Gift { to, amount } => {
            num(*amount)?;
            civ(*to)
        }
        Action::Propose { to, terms } => {
            civ(*to)?;
            match terms {
                Terms::Peace {
                    cede, concede, tribute, ..
                } => {
                    num(*tribute)?;
                    if cede.len() > 8 || concede.len() > 8 {
                        return Err("too many provinces in one treaty".into());
                    }
                    cede.iter().chain(concede.iter()).try_for_each(|&p| prov(p))
                }
                Terms::Tribute { amount } => num(*amount),
                _ => Ok(()),
            }
        }
    }
}

fn can_enter(w: &World, c: CivId, p: ProvId) -> bool {
    match w.provinces[p].controller {
        None => true,
        Some(h) => h == c || w.allied(c, h) || w.at_war(c, h),
    }
}

/// Whether `c` may take `a` now. `Err` carries the reason, which is recorded.
pub fn validate(w: &World, c: CivId, a: &Action) -> Result<(), String> {
    let civ = w.civs.get(c).ok_or("no such civilization")?;
    if !civ.alive {
        return Err("civilization has fallen".into());
    }
    well_formed(w, a)?;
    let pay = cost(w, c, a);
    if pay > 0.0 && civ.treasury < pay {
        return Err(format!("needs {pay:.0} gold, has {:.0}", civ.treasury));
    }
    let own = |p: ProvId| -> Result<&Province, String> {
        let prov = w.provinces.get(p).ok_or("no such province")?;
        if prov.owner == Some(c) && prov.controller == Some(c) {
            Ok(prov)
        } else {
            Err(format!("{} is not held by {}", prov.name, civ.name))
        }
    };
    let other = |o: CivId| -> Result<(), String> {
        if o == c || o >= w.civs.len() || !w.civs[o].alive {
            Err("no such civilization".into())
        } else if !w.in_contact(c, o) {
            Err(format!("{} has no contact with {}", civ.name, w.civs[o].name))
        } else {
            Ok(())
        }
    };
    match a {
        Action::Move { army, to } => {
            let ar = w.army(*army).ok_or("no such army")?;
            if ar.owner != c {
                return Err("army belongs to another".into());
            }
            if ar.moved == w.turn {
                return Err("army already moved this turn".into());
            }
            if w.provinces[ar.location].link_to(*to).is_none() {
                return Err("destination is not adjacent".into());
            }
            if !can_enter(w, c, *to) {
                return Err(format!(
                    "{} is held by a power we are not at war with",
                    w.provinces[*to].name
                ));
            }
            Ok(())
        }
        Action::Recruit { province, amount } => {
            let p = own(*province)?;
            if !(*amount == 3.0 || *amount == 6.0) {
                return Err("recruitment comes in levies of 3 or 6 thousand".into());
            }
            if civ.manpower < *amount {
                return Err("not enough manpower".into());
            }
            if p.population < amount * 10.0 {
                return Err("province too sparsely peopled".into());
            }
            Ok(())
        }
        Action::Fortify { province } => {
            if own(*province)?.fort >= 3 {
                Err("already at the strongest fortification".into())
            } else {
                Ok(())
            }
        }
        Action::Develop { province } => {
            if own(*province)?.development >= 10.0 {
                Err("fully developed".into())
            } else {
                Ok(())
            }
        }
        Action::Research => Ok(()),
        Action::Suppress { province } => {
            let p = own(*province)?;
            if p.unrest < 20.0 {
                Err("no unrest to suppress".into())
            } else {
                Ok(())
            }
        }
        Action::Gift { to, amount } => {
            other(*to)?;
            if *amount != 15.0 && *amount != 40.0 {
                return Err("gifts are 15 or 40 gold".into());
            }
            Ok(())
        }
        Action::DeclareWar { target } => {
            other(*target)?;
            if w.at_war(c, *target) {
                return Err("already at war".into());
            }
            if w.allied(c, *target) {
                return Err("cannot declare war on an ally; cancel the alliance first".into());
            }
            Ok(())
        }
        Action::CancelTreaty { with, kind } => {
            if w.has_treaty(c, *with, *kind) {
                Ok(())
            } else {
                Err("no such treaty".into())
            }
        }
        Action::Propose { to, terms } => {
            other(*to)?;
            if w.proposals
                .iter()
                .any(|p| p.from == c && p.to == *to && p.terms == *terms)
            {
                return Err("an identical proposal is already pending".into());
            }
            match terms {
                Terms::Alliance | Terms::NonAggression | Terms::Trade => {
                    let kind = match terms {
                        Terms::Alliance => TreatyKind::Alliance,
                        Terms::NonAggression => TreatyKind::NonAggression,
                        _ => TreatyKind::Trade,
                    };
                    if w.at_war(c, *to) {
                        Err("cannot sign a treaty while at war".into())
                    } else if w.has_treaty(c, *to, kind) {
                        Err("treaty already in force".into())
                    } else {
                        Ok(())
                    }
                }
                Terms::Tribute { amount } => {
                    let recent = w.events.iter().rev().take_while(|e| e.turn + 8 > w.turn).any(|e| {
                        (e.kind == "tribute" || e.kind == "tribute_refused")
                            && e.civs.contains(&c)
                            && e.civs.contains(to)
                    });
                    if *amount != 20.0 && *amount != 50.0 {
                        Err("tribute demands are 20 or 50 gold".into())
                    } else if recent {
                        Err("tribute was demanded between these powers within two years".into())
                    } else {
                        Ok(())
                    }
                }
                Terms::Peace {
                    war,
                    cede,
                    concede,
                    tribute,
                } => {
                    let wr = w.wars.iter().find(|x| x.id == *war).ok_or("no such war")?;
                    if !wr.opposes(c, *to) {
                        return Err("not enemies in that war".into());
                    }
                    if *tribute < 0.0 || *tribute > 100.0 {
                        return Err("tribute out of range".into());
                    }
                    for &p in cede {
                        let prov = w.provinces.get(p).ok_or("no such province")?;
                        if prov.owner != Some(*to) || prov.controller != Some(c) {
                            return Err(format!("{} is not theirs and occupied by us", prov.name));
                        }
                    }
                    for &p in concede {
                        let prov = w.provinces.get(p).ok_or("no such province")?;
                        if prov.owner != Some(c) || prov.controller != Some(*to) {
                            return Err(format!("{} is not ours and occupied by them", prov.name));
                        }
                        if p == civ.capital {
                            return Err("will not concede the capital".into());
                        }
                    }
                    Ok(())
                }
                Terms::JoinWar { war } => {
                    let wr = w.wars.iter().find(|x| x.id == *war).ok_or("no such war")?;
                    if wr.side_of(c).is_none() {
                        return Err("not a party to that war".into());
                    }
                    if wr.side_of(*to).is_some() {
                        return Err("already a party to that war".into());
                    }
                    if !w.allied(c, *to) {
                        return Err("only allies can be called to arms".into());
                    }
                    Ok(())
                }
            }
        }
    }
}

/// Provinces of `c` that border land held by someone else, nearest danger first.
pub fn frontier(w: &World, c: CivId) -> Vec<ProvId> {
    let mut f: Vec<(i32, ProvId)> = w
        .controlled_by(c)
        .filter(|p| p.owner == Some(c))
        .filter_map(|p| {
            let mut danger = 0;
            for n in p.neighbors() {
                match w.provinces[n].controller {
                    Some(h) if h != c && w.at_war(c, h) => danger += 4,
                    Some(h) if h != c && !w.allied(c, h) => danger += 2,
                    None => danger += 1,
                    _ => {}
                }
            }
            (danger > 0).then_some((-danger, p.id))
        })
        .collect();
    f.sort_unstable();
    f.into_iter().map(|(_, p)| p).collect()
}

/// The menu a chooser is offered this turn. Every entry passes `validate`; the
/// menu is bounded so a model's question stays a readable size.
pub fn offered(w: &World, c: CivId) -> Vec<Action> {
    let civ = &w.civs[c];
    let mut out: Vec<Action> = Vec::new();
    if !civ.alive {
        return out;
    }
    let push = |out: &mut Vec<Action>, a: Action| {
        if validate(w, c, &a).is_ok() && !out.contains(&a) {
            out.push(a);
        }
    };
    for ar in w.armies.iter().filter(|a| a.owner == c) {
        for n in w.provinces[ar.location].neighbors() {
            push(&mut out, Action::Move { army: ar.id, to: n });
        }
    }
    let front = frontier(w, c);
    let mut recruit_sites = vec![civ.capital];
    recruit_sites.extend(front.iter().copied().take(2));
    for &p in &recruit_sites {
        push(
            &mut out,
            Action::Recruit {
                province: p,
                amount: 3.0,
            },
        );
        push(
            &mut out,
            Action::Recruit {
                province: p,
                amount: 6.0,
            },
        );
    }
    for &p in front.iter().take(2) {
        push(&mut out, Action::Fortify { province: p });
    }
    if front.is_empty() {
        push(&mut out, Action::Fortify { province: civ.capital });
    }
    let mut rich: Vec<&Province> = w.controlled_by(c).filter(|p| p.owner == Some(c)).collect();
    rich.sort_by(|a, b| b.population.total_cmp(&a.population).then(a.id.cmp(&b.id)));
    for p in rich.iter().take(2) {
        push(&mut out, Action::Develop { province: p.id });
    }
    push(&mut out, Action::Research);
    let mut restless: Vec<&Province> = w
        .controlled_by(c)
        .filter(|p| p.owner == Some(c) && p.unrest >= 20.0)
        .collect();
    restless.sort_by(|a, b| b.unrest.total_cmp(&a.unrest).then(a.id.cmp(&b.id)));
    for p in restless.iter().take(2) {
        push(&mut out, Action::Suppress { province: p.id });
    }
    for o in w.contacts(c) {
        for terms in [Terms::Alliance, Terms::NonAggression, Terms::Trade] {
            push(&mut out, Action::Propose { to: o, terms });
        }
        push(&mut out, Action::DeclareWar { target: o });
        push(&mut out, Action::Gift { to: o, amount: 15.0 });
        push(&mut out, Action::Gift { to: o, amount: 40.0 });
        if w.strength_of(c) > w.strength_of(o) * 1.3 && !w.at_war(c, o) {
            push(
                &mut out,
                Action::Propose {
                    to: o,
                    terms: Terms::Tribute { amount: 20.0 },
                },
            );
            push(
                &mut out,
                Action::Propose {
                    to: o,
                    terms: Terms::Tribute { amount: 50.0 },
                },
            );
        }
        for kind in [TreatyKind::Alliance, TreatyKind::NonAggression, TreatyKind::Trade] {
            push(&mut out, Action::CancelTreaty { with: o, kind });
        }
    }
    for war in w.wars_of(c) {
        let my_side = war.side_of(c).expect("wars_of filters by side");
        let enemies: Vec<CivId> = if my_side {
            war.defenders.clone()
        } else {
            war.attackers.clone()
        };
        for &e in &enemies {
            push(
                &mut out,
                Action::Propose {
                    to: e,
                    terms: Terms::Peace {
                        war: war.id,
                        cede: vec![],
                        concede: vec![],
                        tribute: 0.0,
                    },
                },
            );
            let mut taken: Vec<ProvId> = w
                .provinces
                .iter()
                .filter(|p| p.owner == Some(e) && p.controller == Some(c) && p.id != w.civs[e].capital)
                .map(|p| p.id)
                .collect();
            taken.truncate(3);
            if !taken.is_empty() {
                push(
                    &mut out,
                    Action::Propose {
                        to: e,
                        terms: Terms::Peace {
                            war: war.id,
                            cede: taken,
                            concede: vec![],
                            tribute: 0.0,
                        },
                    },
                );
            }
            let lost: Vec<ProvId> = w
                .provinces
                .iter()
                .filter(|p| p.owner == Some(c) && p.controller == Some(e) && p.id != civ.capital)
                .map(|p| p.id)
                .take(3)
                .collect();
            if !lost.is_empty() {
                push(
                    &mut out,
                    Action::Propose {
                        to: e,
                        terms: Terms::Peace {
                            war: war.id,
                            cede: vec![],
                            concede: lost,
                            tribute: 0.0,
                        },
                    },
                );
            }
        }
        for t in w
            .treaties
            .iter()
            .filter(|t| t.kind == TreatyKind::Alliance && (t.a == c || t.b == c))
        {
            let ally = if t.a == c { t.b } else { t.a };
            push(
                &mut out,
                Action::Propose {
                    to: ally,
                    terms: Terms::JoinWar { war: war.id },
                },
            );
        }
    }
    out
}

pub fn describe_terms(w: &World, t: &Terms) -> String {
    let names = |ps: &[ProvId]| {
        ps.iter()
            .map(|&p| w.provinces[p].name.clone())
            .collect::<Vec<_>>()
            .join(", ")
    };
    match t {
        Terms::Alliance => "an alliance".into(),
        Terms::NonAggression => "a non-aggression pact".into(),
        Terms::Trade => "a trade agreement".into(),
        Terms::Tribute { amount } => format!("tribute of {amount:.0} gold"),
        Terms::JoinWar { war } => format!("joining war #{war} as an ally"),
        Terms::Peace {
            war,
            cede,
            concede,
            tribute,
        } => {
            let mut s = format!("peace in war #{war}");
            if !cede.is_empty() {
                s += &format!(", recipient cedes {}", names(cede));
            }
            if !concede.is_empty() {
                s += &format!(", proposer returns {}", names(concede));
            }
            if *tribute > 0.0 {
                s += &format!(", tribute {tribute:.0}");
            }
            if cede.is_empty() && concede.is_empty() && *tribute == 0.0 {
                s += " on the status quo";
            }
            s
        }
    }
}

pub fn describe(w: &World, c: CivId, a: &Action) -> String {
    if c >= w.civs.len() || well_formed(w, a).is_err() {
        return format!("malformed action {}", serde_json::to_string(a).unwrap_or_default());
    }
    let civ = |o: CivId| w.civs[o].name.as_str();
    let prov = |p: ProvId| w.provinces[p].name.as_str();
    match a {
        Action::Move { army, to } => {
            let ar = w.army(*army);
            let from = ar.map(|a| prov(a.location)).unwrap_or("?");
            let s = ar.map(|a| a.strength).unwrap_or(0.0);
            let target = &w.provinces[*to];
            let note = match target.controller {
                None => " (unclaimed — will besiege)".to_string(),
                Some(h) if h == c => String::new(),
                Some(h) if w.at_war(c, h) => format!(" (held by enemy {})", civ(h)),
                Some(h) => format!(" (allied {})", civ(h)),
            };
            format!("Move army #{army} ({s:.1}k) from {from} to {}{note}", target.name)
        }
        Action::Recruit { province, amount } => format!(
            "Raise {amount:.0}k troops in {} ({:.0} gold)",
            prov(*province),
            amount * RECRUIT_COST
        ),
        Action::Fortify { province } => format!(
            "Fortify {} to level {} ({:.0} gold)",
            prov(*province),
            w.provinces[*province].fort + 1,
            fortify_cost(w.provinces[*province].fort)
        ),
        Action::Develop { province } => format!(
            "Develop {} ({:.0} gold)",
            prov(*province),
            develop_cost(w.provinces[*province].development)
        ),
        Action::Research => format!(
            "Invest in learning and engineering ({:.0} gold)",
            research_cost(w.civs[c].tech)
        ),
        Action::Suppress { province } => format!("Suppress unrest in {} ({SUPPRESS_COST:.0} gold)", prov(*province)),
        Action::Propose {
            to,
            terms: Terms::Tribute { amount },
        } => {
            format!("Demand tribute of {amount:.0} gold from {}", civ(*to))
        }
        Action::Propose {
            to,
            terms: Terms::JoinWar { war },
        } => format!("Call {} to arms in war #{war}", civ(*to)),
        Action::Propose { to, terms } => format!("Propose {} to {}", describe_terms(w, terms), civ(*to)),
        Action::DeclareWar { target } => {
            let breach = if w.has_treaty(c, *target, TreatyKind::NonAggression) {
                " — BREAKS our non-aggression pact"
            } else {
                ""
            };
            format!("Declare war on {}{breach}", civ(*target))
        }
        Action::Gift { to, amount } => format!("Send a gift of {amount:.0} gold to {}", civ(*to)),
        Action::CancelTreaty { with, kind } => format!("Cancel our {} with {}", kind.label(), civ(*with)),
    }
}
