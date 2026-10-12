//! The rule-based policy: scores every offered action from the civilization's
//! personality, goals, intelligence and memory, then takes the best within its
//! budget. Deterministic for a seed. It is a measuring instrument and the
//! fallback for models, so it reads only the observation, like any brain.

use crate::action::*;
use crate::brain::{Brain, BrainOutput, Label};
use crate::memory::Memory;
use crate::model::*;
use crate::observe::{CivView, Observation};
use crate::rng::{purpose, Rng};

pub struct UtilityBrain {
    /// Withhold memory-derived beliefs: every power is trusted at 0.5 and no
    /// grievance is remembered. The control arm for memory experiments.
    pub amnesic: bool,
}

struct View<'a> {
    obs: &'a Observation,
    amnesic: bool,
}

impl<'a> View<'a> {
    fn trust(&self, c: &CivView) -> f64 {
        if self.amnesic {
            0.5
        } else {
            c.trust
        }
    }
    fn grievances(&self, c: &CivView) -> f64 {
        if self.amnesic {
            0.0
        } else {
            c.grievances.min(5) as f64
        }
    }
    fn favors(&self, c: &CivView) -> f64 {
        if self.amnesic {
            0.0
        } else {
            c.favors.min(5) as f64
        }
    }
    fn me(&self) -> f64 {
        self.obs.me.strength.max(1.0)
    }
    fn at_war(&self) -> bool {
        !self.obs.wars.is_empty()
    }
    fn enemies(&self) -> Vec<CivId> {
        let mut v: Vec<CivId> = self
            .obs
            .civs
            .iter()
            .filter(|c| c.at_war_with_us)
            .map(|c| c.id)
            .collect();
        v.sort_unstable();
        v
    }
    fn enemy_strength(&self) -> f64 {
        self.enemies().iter().map(|&e| self.obs.civ(e).strength_est).sum()
    }
    fn ally_strength(&self) -> f64 {
        self.obs
            .civs
            .iter()
            .filter(|c| c.treaties.contains(&TreatyKind::Alliance))
            .map(|c| c.strength_est)
            .sum()
    }
    /// Hostile soldiers in and next to a province, as far as we can see.
    fn danger(&self, p: ProvId) -> f64 {
        let Some(v) = self.obs.province(p) else { return 0.0 };
        v.hostile_armies
            + v.neighbors
                .iter()
                .filter_map(|&n| self.obs.province(n))
                .map(|n| n.hostile_armies * 0.7)
                .sum::<f64>()
    }
    fn hostility(&self, o: &CivView) -> f64 {
        let claims = self
            .obs
            .provinces
            .iter()
            .filter(|p| p.claimed_by_us && p.owner == Some(o.id))
            .count() as f64;
        let goal: f64 = self
            .obs
            .goals
            .iter()
            .filter(|g| g.civ == Some(o.id) && matches!(g.kind.as_str(), "claim" | "avenge" | "reclaim" | "contain"))
            .filter(|g| !(self.amnesic && g.kind == "avenge"))
            .map(|g| g.weight * 0.3)
            .sum();
        (-o.our_opinion / 100.0) + 0.15 * self.grievances(o) + 0.2 * claims.min(3.0) + goal
    }
    fn war_pressure(&self) -> f64 {
        if self.at_war() {
            clamp(
                self.enemy_strength() / (self.me() + self.ally_strength() * 0.5),
                0.0,
                2.0,
            ) / 2.0
        } else {
            let worst = self
                .obs
                .civs
                .iter()
                .filter(|c| c.in_contact && c.id != self.obs.me.id && !c.treaties.contains(&TreatyKind::Alliance))
                .filter(|c| c.our_opinion < -20.0 || self.trust(c) < 0.3)
                .map(|c| c.strength_est / self.me())
                .fold(0.0, f64::max);
            clamp(worst - 0.8, 0.0, 1.0) * 0.5
        }
    }
    fn net_income(&self) -> f64 {
        self.obs.me.income - self.obs.me.upkeep
    }
}

fn obs_cost(obs: &Observation, a: &Action) -> f64 {
    match a {
        Action::Recruit { amount, .. } => amount * RECRUIT_COST,
        Action::Fortify { province } => obs.province(*province).map(|p| fortify_cost(p.fort)).unwrap_or(0.0),
        Action::Develop { province } => obs
            .province(*province)
            .map(|p| develop_cost(p.development))
            .unwrap_or(0.0),
        Action::Research => research_cost(obs.me.tech),
        Action::Suppress { .. } => SUPPRESS_COST,
        Action::Gift { amount, .. } => *amount,
        _ => 0.0,
    }
}

fn score(v: &View, a: &Action) -> f64 {
    let obs = v.obs;
    let p = &obs.me.personality;
    let me = v.me();
    let treasury = obs.me.treasury;
    match a {
        Action::Move { army, to } => {
            let Some(ar) = obs.armies.iter().find(|x| x.id == *army) else {
                return -1.0;
            };
            let Some(dest) = obs.province(*to) else { return -1.0 };
            let from = ar.location;
            let hostile_holder = match dest.controller {
                None => true,
                Some(h) => h != obs.me.id && obs.civ(h).at_war_with_us,
            };
            let leaving_capital_bare = from == obs.me.capital
                && v.danger(from) > 0.0
                && obs
                    .armies
                    .iter()
                    .filter(|x| x.location == from && x.id != *army)
                    .map(|x| x.strength)
                    .sum::<f64>()
                    < v.danger(from);
            let mut s = if hostile_holder {
                let mine = ar.strength * ar.morale;
                if dest.controller.is_none() {
                    let resist = dest.natives + dest.fort as f64 * 3.0 + 1.0;
                    if mine < resist * 0.8 || (v.at_war() && v.war_pressure() > 0.4) {
                        return -1.0;
                    }
                    let value =
                        dest.development * 0.08 + dest.population / 600.0 + if dest.claimed_by_us { 0.4 } else { 0.0 };
                    value * p.expansion * clamp(mine / resist, 0.0, 1.5) - 0.15 * p.caution
                } else {
                    let defense = dest.terrain.defense() * (1.0 + 0.25 * dest.fort as f64);
                    let win = mine / (mine + dest.hostile_armies * defense + 0.5);
                    let value = 0.4
                        + dest.development * 0.05
                        + if dest.capital_of.is_some() { 0.6 } else { 0.0 }
                        + if dest.claimed_by_us || dest.owner == Some(obs.me.id) {
                            0.5
                        } else {
                            0.0
                        };
                    value * (win * 2.0 - 0.7 - 0.3 * p.caution) * (0.6 + p.aggression)
                }
            } else if v.at_war() {
                let gain = v.danger(*to) - v.danger(from);
                let front = dest.neighbors.iter().filter_map(|&n| obs.province(n)).any(|n| {
                    n.controller
                        .is_some_and(|h| h != obs.me.id && obs.civ(h).at_war_with_us)
                });
                0.25 * gain / (ar.strength + 1.0) + if front { 0.25 } else { -0.05 }
            } else {
                -0.05
            };
            if leaving_capital_bare {
                s -= 1.0;
            }
            if *to == obs.me.capital && obs.goals.iter().any(|g| g.kind == "defend_capital") {
                s += 0.6;
            }
            s
        }
        Action::Recruit { province, amount } => {
            let after = v.net_income() - amount * 0.35;
            if after < -1.0 && treasury < 150.0 {
                return -1.0;
            }
            let pressure = v.war_pressure();
            let site = if v.danger(*province) > 0.0 || *province == obs.me.capital {
                0.1
            } else {
                0.0
            };
            let size = if *amount >= 6.0 {
                if pressure > 0.5 {
                    0.15
                } else {
                    -0.1
                }
            } else {
                0.0
            };
            0.1 + 0.9 * pressure + 0.15 * p.aggression * p.expansion + site + size - 0.2
        }
        Action::Fortify { province } => {
            if treasury < obs_cost(obs, a) * 2.0 {
                return -1.0;
            }
            0.3 * p.caution + 0.15 * clamp(v.danger(*province) / me, 0.0, 1.0) + 0.1 * v.war_pressure() - 0.12
        }
        Action::Develop { .. } => {
            if treasury < obs_cost(obs, a) * 1.5 || v.net_income() < 0.0 {
                return -1.0;
            }
            (if v.at_war() { 0.05 } else { 0.2 }) + 0.3 * p.mercantile - 0.05
        }
        Action::Research => {
            if treasury < obs_cost(obs, a) * 2.0 {
                return -1.0;
            }
            0.18 + 0.15 * (1.0 - p.aggression) - if v.at_war() { 0.1 } else { 0.0 }
        }
        Action::Suppress { province } => {
            let unrest = obs.province(*province).map(|x| x.unrest).unwrap_or(0.0);
            unrest / 80.0 - 0.15
        }
        Action::DeclareWar { target } => {
            let o = obs.civ(*target);
            let wars = obs.wars.len();
            if wars >= 1 && p.aggression < 0.85 || wars >= 2 {
                return -1.0;
            }
            if obs.me.stability < 35.0 || treasury < 20.0 || obs.me.war_weariness > 30.0 {
                return -1.0;
            }
            let ratio = (me + v.ally_strength() * 0.5) / (o.strength_est * 1.15 + 1.0);
            if ratio < 1.1 {
                return -1.0;
            }
            let pact = if o.treaties.contains(&TreatyKind::NonAggression) {
                0.3 + p.honor * 0.8
            } else {
                0.0
            };
            let trade = if o.treaties.contains(&TreatyKind::Trade) {
                0.2 * p.mercantile
            } else {
                0.0
            };
            let claims = obs.provinces.iter().any(|q| q.claimed_by_us && q.owner == Some(o.id));
            let unjust = if claims || v.grievances(o) >= 2.0 {
                0.0
            } else {
                0.25 * (p.honor + 0.5)
            };
            let drive = p.aggression * p.expansion * (ratio - 1.15).min(1.2) * 0.8;
            drive + v.hostility(o) * 0.8 - pact - trade - unjust - p.caution * 0.3 - 0.45
        }
        Action::Propose { to, terms } => {
            let o = obs.civ(*to);
            match terms {
                Terms::Alliance => {
                    if o.our_opinion <= 0.0 || v.trust(o) < 0.35 {
                        return -1.0;
                    }
                    let alliances = obs
                        .civs
                        .iter()
                        .filter(|c| c.treaties.contains(&TreatyKind::Alliance))
                        .count() as f64;
                    let common = if v.at_war() && !o.at_war_with_us { 0.35 } else { 0.0 };
                    let contain = if obs.goals.iter().any(|g| g.kind == "contain" && g.civ != Some(*to)) {
                        0.3
                    } else {
                        0.0
                    };
                    p.diplomacy * 0.3 + o.our_opinion / 200.0 + v.trust(o) * 0.3 + common + contain + 0.05 * v.favors(o)
                        - 0.3 * alliances
                        - 0.35
                }
                Terms::NonAggression => {
                    if o.our_opinion < -30.0 || v.hostility(o) > 0.5 {
                        return -1.0;
                    }
                    let fear = if o.strength_est > me { 0.3 } else { 0.0 };
                    p.caution * 0.5 + fear + o.our_opinion / 200.0 - 0.45
                }
                Terms::Trade => {
                    if o.our_opinion < -20.0 {
                        return -1.0;
                    }
                    p.mercantile * 0.6 + o.our_opinion / 150.0 - 0.3
                }
                Terms::Tribute { amount } => {
                    let ratio = me / (o.strength_est + 1.0);
                    if ratio < 1.5 {
                        return -1.0;
                    }
                    p.aggression * 0.4 + (ratio.min(4.0) - 1.5) * 0.12
                        - p.honor * 0.2
                        - 0.5
                        - if *amount > 20.0 { 0.1 } else { 0.0 }
                }
                Terms::JoinWar { .. } => {
                    if o.at_war_with_us {
                        return -1.0;
                    }
                    0.35 + if v.enemy_strength() > me { 0.3 } else { 0.0 } - 0.2
                }
                Terms::Peace { war, cede, concede, .. } => {
                    let Some(wv) = obs.wars.iter().find(|x| x.id == *war) else {
                        return -1.0;
                    };
                    let pressure = obs.me.war_weariness / 50.0
                        + if wv.our_score < -10.0 { 0.4 } else { 0.0 }
                        + if obs.me.stability < 30.0 { 0.3 } else { 0.0 }
                        + if treasury < 0.0 { 0.3 } else { 0.0 }
                        + (obs.turn.saturating_sub(wv.started)) as f64 / 40.0;
                    if !cede.is_empty() {
                        if wv.our_score < 5.0 {
                            return -1.0;
                        }
                        wv.our_score / 40.0 + obs.me.war_weariness / 60.0 + 0.1 * cede.len() as f64 - 0.25
                    } else if !concede.is_empty() {
                        pressure - 0.8 + if wv.our_score < -25.0 { 0.5 } else { 0.0 }
                    } else {
                        pressure - 0.45 - p.aggression * 0.2
                    }
                }
            }
        }
        Action::Gift { to, amount } => {
            let o = obs.civ(*to);
            if o.at_war_with_us || o.our_opinion > 40.0 || treasury < amount * 4.0 {
                return -1.0;
            }
            let fear = if o.strength_est > me * 1.3 { 0.25 } else { 0.0 };
            p.diplomacy * 0.25 + p.caution * 0.15 + fear - 0.35 - if *amount > 15.0 { 0.1 } else { 0.0 }
        }
        Action::CancelTreaty { with, kind } => {
            let o = obs.civ(*with);
            match kind {
                TreatyKind::Alliance => {
                    if v.trust(o) < 0.2 || o.our_opinion < -30.0 {
                        0.4
                    } else {
                        -1.0
                    }
                }
                TreatyKind::NonAggression => {
                    let ratio = me / (o.strength_est + 1.0);
                    if v.hostility(o) > 0.6 && ratio > 1.8 {
                        0.2 - p.honor * 0.5
                    } else {
                        -1.0
                    }
                }
                TreatyKind::Trade => {
                    if o.our_opinion < -40.0 {
                        0.2
                    } else {
                        -1.0
                    }
                }
            }
        }
    }
}

fn respond(v: &View, from: CivId, terms: &Terms, against: &[CivId]) -> bool {
    let obs = v.obs;
    let p = &obs.me.personality;
    let o = obs.civ(from);
    let me = v.me();
    let value = match terms {
        Terms::Alliance => {
            let contain = if obs.goals.iter().any(|g| g.kind == "contain" && g.civ != Some(from)) {
                0.3
            } else {
                0.0
            };
            o.our_opinion / 100.0 + v.trust(o) + p.diplomacy * 0.3 + contain - 0.75
        }
        Terms::NonAggression => {
            let fear = if o.strength_est > me * 0.8 { 0.2 } else { 0.0 };
            0.25 + p.caution * 0.3 + fear + o.our_opinion / 200.0 - v.hostility(o) * 0.6
        }
        Terms::Trade => p.mercantile * 0.5 + o.our_opinion / 150.0 + 0.1 * v.trust(o) - 0.2,
        Terms::Tribute { amount } => {
            let afraid = o.strength_est > me * 1.6;
            if afraid && p.caution > 0.4 && *amount <= obs.me.treasury * 0.5 {
                0.1
            } else {
                -1.0
            }
        }
        Terms::JoinWar { .. } => {
            let enemy: f64 = against.iter().map(|&e| obs.civ(e).strength_est).sum();
            let dislike: f64 =
                against.iter().map(|&e| -obs.civ(e).our_opinion / 100.0).sum::<f64>() / (against.len().max(1) as f64);
            let odds = clamp((me + o.strength_est) / (enemy + 1.0) - 1.0, -1.0, 1.0);
            p.honor * 0.9 + o.our_opinion / 200.0 + dislike * 0.5 + odds * 0.4
                - obs.me.war_weariness / 50.0
                - if v.at_war() { 0.4 } else { 0.0 }
                - 0.45
        }
        Terms::Peace { war, cede, concede, .. } => {
            let Some(wv) = obs.wars.iter().find(|x| x.id == *war) else {
                return false;
            };
            let capital_lost = obs
                .province(obs.me.capital)
                .is_some_and(|c| c.controller != Some(obs.me.id));
            let pressure = obs.me.war_weariness / 50.0
                + if obs.me.stability < 30.0 { 0.3 } else { 0.0 }
                + if obs.me.treasury < 0.0 { 0.3 } else { 0.0 }
                + if capital_lost { 0.8 } else { 0.0 }
                + (obs.turn.saturating_sub(wv.started)) as f64 / 40.0;
            pressure + 0.25 * concede.len() as f64 - 0.3 * cede.len() as f64 - wv.our_score / 40.0
                + if cede.is_empty() && wv.our_score < 5.0 {
                    0.2
                } else {
                    0.0
                }
                - 0.3
        }
    };
    value > 0.0
}

fn message_for(obs: &Observation, a: &Action) -> Option<Outgoing> {
    let me = &obs.me;
    let (to, text) = match a {
        Action::DeclareWar { target } => (
            *target,
            format!(
                "{} of {} declares war. Let the field decide what talk could not.",
                cap(&me.ruler),
                me.name
            ),
        ),
        Action::Propose {
            to,
            terms: Terms::Alliance,
        } => (
            *to,
            format!(
                "{} offers {} an alliance against common dangers.",
                me.name,
                obs.civ(*to).name
            ),
        ),
        Action::Propose {
            to,
            terms: Terms::Peace { .. },
        } => (*to, format!("{} has had enough of this war and sends terms.", me.name)),
        Action::Propose {
            to,
            terms: Terms::Tribute { amount },
        } => (
            *to,
            format!("{} expects {amount:.0} gold as a token of your respect.", me.name),
        ),
        _ => return None,
    };
    Some(Outgoing { to, text })
}

fn cap(s: &str) -> String {
    let mut c = s.chars();
    match c.next() {
        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
        None => String::new(),
    }
}

pub fn decide(obs: &Observation, amnesic: bool, seed: u64) -> Decision {
    let v = View { obs, amnesic };
    let mut rng = Rng::stream(seed, &[obs.turn as u64, obs.me.id as u64, purpose::BRAIN]);
    let mut scored: Vec<(f64, usize)> = obs
        .offered
        .iter()
        .map(|o| (score(&v, &o.action) + rng.range(0.0, 0.04), o.index))
        .collect();
    scored.sort_by(|a, b| b.0.total_cmp(&a.0).then(a.1.cmp(&b.1)));
    let reserve = if v.at_war() {
        (obs.me.upkeep * 2.0).max(10.0)
    } else {
        0.0
    };
    let mut budget = obs.me.treasury - reserve;
    let mut d = Decision::default();
    let mut moved = Vec::new();
    let mut touched_civs = Vec::new();
    let mut declared = false;
    for (s, i) in scored {
        if s < 0.15 || d.actions.len() >= MAX_ACTIONS {
            break;
        }
        let a = &obs.offered[i].action;
        let c = obs_cost(obs, a);
        if c > 0.0 && c > budget {
            continue;
        }
        match a {
            Action::Move { army, .. } => {
                if moved.contains(army) {
                    continue;
                }
                moved.push(*army);
            }
            Action::DeclareWar { target } => {
                if declared || touched_civs.contains(target) {
                    continue;
                }
                declared = true;
                touched_civs.push(*target);
            }
            Action::Propose { to, .. } | Action::Gift { to, .. } | Action::CancelTreaty { with: to, .. } => {
                if touched_civs.contains(to) {
                    continue;
                }
                touched_civs.push(*to);
            }
            _ => {}
        }
        budget -= c;
        d.actions.push(a.clone());
    }
    for pv in &obs.proposals {
        d.responses.push(Response {
            proposal: pv.id,
            accept: respond(&v, pv.from, &pv.terms, &pv.against),
        });
    }
    for a in &d.actions {
        if d.messages.len() >= MAX_MESSAGES {
            break;
        }
        if let Some(m) = message_for(obs, a) {
            d.messages.push(m);
        }
    }
    d
}

impl Brain for UtilityBrain {
    fn descriptor(&self) -> String {
        if self.amnesic {
            "rules-amnesic".into()
        } else {
            "rules".into()
        }
    }
    fn decide(&self, obs: &Observation, _memory: &Memory, seed: u64) -> BrainOutput {
        let label = if self.amnesic { Label::Amnesic } else { Label::Rules };
        BrainOutput::plain(decide(obs, self.amnesic, seed), label)
    }
}
