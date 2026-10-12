//! What a civilization can know. Brains receive an `Observation` and nothing
//! else: no brain reads the world, so no brain sees through the fog.

use serde::{Deserialize, Serialize};

use crate::action::{describe, describe_terms, offered, Action};
use crate::model::*;
use crate::resolve::{income, upkeep};
use crate::rng::{purpose, Rng};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ProvView {
    pub id: ProvId,
    pub name: String,
    pub terrain: Terrain,
    pub owner: Option<CivId>,
    pub controller: Option<CivId>,
    pub population: f64,
    pub development: f64,
    pub fort: u8,
    pub unrest: f64,
    pub natives: f64,
    pub claimed_by_us: bool,
    pub capital_of: Option<CivId>,
    pub our_armies: f64,
    pub friendly_armies: f64,
    /// Soldiers of powers at war with us, as far as our scouts can tell.
    pub hostile_armies: f64,
    pub neighbors: Vec<ProvId>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct CivView {
    pub id: CivId,
    pub key: String,
    pub name: String,
    pub ruler: String,
    pub alive: bool,
    pub in_contact: bool,
    pub our_opinion: f64,
    /// Their regard for us as our envoys read it — rounded and noisy.
    pub their_opinion_est: f64,
    pub strength_est: f64,
    pub provinces: usize,
    pub at_war_with_us: bool,
    pub treaties: Vec<TreatyKind>,
    pub trust: f64,
    pub grievances: u32,
    pub favors: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct WarView {
    pub id: u32,
    pub attackers: Vec<CivId>,
    pub defenders: Vec<CivId>,
    pub we_attack: bool,
    /// Positive means our side is winning.
    pub our_score: f64,
    pub started: u32,
    pub battles: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ProposalView {
    pub id: u32,
    pub from: CivId,
    pub terms: Terms,
    pub text: String,
    /// For a call to arms: the powers we would be fighting.
    pub against: Vec<CivId>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct InboxView {
    pub turn: u32,
    pub from: CivId,
    pub text: String,
    pub generation: Generation,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Goal {
    pub kind: String,
    pub text: String,
    pub civ: Option<CivId>,
    pub province: Option<ProvId>,
    pub weight: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Offer {
    pub index: usize,
    pub action: Action,
    pub text: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct SelfView {
    pub id: CivId,
    pub key: String,
    pub name: String,
    pub ruler: String,
    pub government: String,
    pub personality: Personality,
    pub capital: ProvId,
    pub treasury: f64,
    pub income: f64,
    pub upkeep: f64,
    pub manpower: f64,
    pub stability: f64,
    pub tech: f64,
    pub war_weariness: f64,
    pub strength: f64,
    pub provinces: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ArmyView {
    pub id: u32,
    pub location: ProvId,
    pub strength: f64,
    pub morale: f64,
    pub can_move: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Observation {
    pub turn: u32,
    pub date: String,
    pub me: SelfView,
    pub armies: Vec<ArmyView>,
    pub provinces: Vec<ProvView>,
    pub civs: Vec<CivView>,
    pub wars: Vec<WarView>,
    pub proposals: Vec<ProposalView>,
    pub inbox: Vec<InboxView>,
    pub goals: Vec<Goal>,
    pub recent: Vec<String>,
    pub offered: Vec<Offer>,
}

impl Observation {
    pub fn province(&self, id: ProvId) -> Option<&ProvView> {
        self.provinces.iter().find(|p| p.id == id)
    }
    pub fn civ(&self, id: CivId) -> &CivView {
        &self.civs[id]
    }
}

pub fn visible(w: &World, c: CivId) -> Vec<bool> {
    let mut v = vec![false; w.provinces.len()];
    for p in &w.provinces {
        let ours = p.owner == Some(c) || p.controller == Some(c);
        let allied = p.controller.is_some_and(|h| h != c && w.allied(c, h));
        let garrisoned = w.armies_in(p.id).any(|a| a.owner == c);
        if ours || allied || garrisoned {
            v[p.id] = true;
            for n in p.neighbors() {
                v[n] = true;
            }
        }
    }
    v
}

pub fn observe(w: &World, c: CivId) -> Observation {
    let civ = &w.civs[c];
    let vis = visible(w, c);
    let mut intel = Rng::stream(w.seed, &[w.turn as u64, c as u64, purpose::INTEL]);
    let memory = &w.memories[c];

    let provinces: Vec<ProvView> = w
        .provinces
        .iter()
        .filter(|p| vis[p.id])
        .map(|p| {
            let mut ours = 0.0;
            let mut friendly = 0.0;
            let mut hostile = 0.0;
            for a in w.armies_in(p.id) {
                if a.owner == c {
                    ours += a.strength;
                } else if w.allied(c, a.owner) {
                    friendly += a.strength;
                } else if w.at_war(c, a.owner) {
                    hostile += a.strength;
                }
            }
            ProvView {
                id: p.id,
                name: p.name.clone(),
                terrain: p.terrain,
                owner: p.owner,
                controller: p.controller,
                population: p.population.round(),
                development: p.development,
                fort: p.fort,
                unrest: p.unrest.round(),
                natives: p.natives,
                claimed_by_us: p.claims.contains(&c),
                capital_of: w.civs.iter().find(|x| x.alive && x.capital == p.id).map(|x| x.id),
                our_armies: round2(ours),
                friendly_armies: round2(friendly),
                hostile_armies: round2(hostile),
                neighbors: p.neighbors().collect(),
            }
        })
        .collect();

    let civs: Vec<CivView> = w
        .civs
        .iter()
        .map(|o| {
            let exact = o.id == c || w.allied(c, o.id);
            let noise = intel.range(0.75, 1.25);
            let strength = w.strength_of(o.id);
            let belief = memory.belief(o.id);
            CivView {
                id: o.id,
                key: o.key.clone(),
                name: o.name.clone(),
                ruler: o.ruler.clone(),
                alive: o.alive,
                in_contact: w.in_contact(c, o.id),
                our_opinion: w.opinion[c][o.id].round(),
                their_opinion_est: ((w.opinion[o.id][c] + intel.range(-12.0, 12.0)) / 5.0).round() * 5.0,
                strength_est: if exact {
                    round2(strength)
                } else {
                    (strength * noise).round()
                },
                provinces: w.provinces_of(o.id).count(),
                at_war_with_us: w.at_war(c, o.id),
                treaties: w
                    .treaties
                    .iter()
                    .filter(|t| t.involves(c, o.id) && o.id != c)
                    .map(|t| t.kind)
                    .collect(),
                trust: belief.trust,
                grievances: belief.grievances,
                favors: belief.favors,
            }
        })
        .collect();

    let wars: Vec<WarView> = w
        .wars_of(c)
        .map(|wr| {
            let attack = wr.side_of(c) == Some(true);
            WarView {
                id: wr.id,
                attackers: wr.attackers.clone(),
                defenders: wr.defenders.clone(),
                we_attack: attack,
                our_score: round2(if attack { wr.score } else { -wr.score }),
                started: wr.started,
                battles: wr.battles,
            }
        })
        .collect();

    let proposals = w
        .proposals
        .iter()
        .filter(|p| p.to == c)
        .map(|p| ProposalView {
            id: p.id,
            from: p.from,
            terms: p.terms.clone(),
            text: format!("{} proposes {}", w.civs[p.from].name, describe_terms(w, &p.terms)),
            against: match &p.terms {
                Terms::JoinWar { war } => w
                    .wars
                    .iter()
                    .find(|x| x.id == *war)
                    .map(|x| match x.side_of(p.from) {
                        Some(true) => x.defenders.clone(),
                        Some(false) => x.attackers.clone(),
                        None => Vec::new(),
                    })
                    .unwrap_or_default(),
                _ => Vec::new(),
            },
        })
        .collect();

    let inbox = w
        .messages
        .iter()
        .filter(|m| m.to == c && m.turn + 1 >= w.turn)
        .map(|m| InboxView {
            turn: m.turn,
            from: m.from,
            text: m.text.clone(),
            generation: m.generation,
        })
        .collect();

    let recent = w
        .events
        .iter()
        .filter(|e| e.turn + 1 >= w.turn)
        .filter(|e| e.civs.contains(&c) || e.provinces.iter().any(|&p| vis[p]))
        .map(|e| e.text.clone())
        .collect();

    let offered = offered(w, c)
        .into_iter()
        .enumerate()
        .map(|(index, action)| {
            let text = describe(w, c, &action);
            Offer { index, action, text }
        })
        .collect();

    let goals = goals(w, c, &civs);

    Observation {
        turn: w.turn,
        date: w.date(),
        me: SelfView {
            id: c,
            key: civ.key.clone(),
            name: civ.name.clone(),
            ruler: civ.ruler.clone(),
            government: civ.government.clone(),
            personality: civ.personality.clone(),
            capital: civ.capital,
            treasury: round2(civ.treasury),
            income: round2(income(w, c)),
            upkeep: round2(upkeep(w, c)),
            manpower: round2(civ.manpower),
            stability: round2(civ.stability),
            tech: round2(civ.tech),
            war_weariness: round2(civ.war_weariness),
            strength: round2(w.strength_of(c)),
            provinces: w.provinces_of(c).count(),
        },
        armies: w
            .armies
            .iter()
            .filter(|a| a.owner == c)
            .map(|a| ArmyView {
                id: a.id,
                location: a.location,
                strength: round2(a.strength),
                morale: round2(a.morale),
                can_move: a.moved != w.turn,
            })
            .collect(),
        provinces,
        civs,
        wars,
        proposals,
        inbox,
        goals,
        recent,
        offered,
    }
}

/// Standing aims derived from the civilization's own position and memory. They
/// are shown to every brain identically; rules weigh them, models read them.
fn goals(w: &World, c: CivId, civs: &[CivView]) -> Vec<Goal> {
    let civ = &w.civs[c];
    let mut g = Vec::new();
    let capital = &w.provinces[civ.capital];
    let threat_at_capital: f64 = capital
        .neighbors()
        .chain(std::iter::once(capital.id))
        .flat_map(|p| w.armies_in(p))
        .filter(|a| w.at_war(c, a.owner))
        .map(|a| a.strength)
        .sum();
    if threat_at_capital > 0.0 {
        g.push(Goal {
            kind: "defend_capital".into(),
            text: format!("Enemy armies threaten {}", capital.name),
            civ: None,
            province: Some(capital.id),
            weight: 1.0,
        });
    }
    for p in w
        .provinces
        .iter()
        .filter(|p| p.owner == Some(c) && p.controller != Some(c))
    {
        g.push(Goal {
            kind: "reclaim".into(),
            text: format!("Retake {}", p.name),
            civ: p.controller,
            province: Some(p.id),
            weight: 0.8,
        });
    }
    for p in w
        .provinces
        .iter()
        .filter(|p| p.claims.contains(&c) && p.owner != Some(c))
    {
        g.push(Goal {
            kind: "claim".into(),
            text: format!("Bring {} under our rule", p.name),
            civ: p.owner,
            province: Some(p.id),
            weight: 0.4 + 0.4 * civ.personality.expansion,
        });
    }
    let me = civs[c].strength_est.max(1.0);
    if let Some(rival) = civs
        .iter()
        .filter(|o| o.id != c && o.alive && o.in_contact && !o.treaties.contains(&TreatyKind::Alliance))
        .filter(|o| o.strength_est > me * 1.2 && (o.our_opinion < 0.0 || o.trust < 0.35))
        .max_by(|a, b| a.strength_est.total_cmp(&b.strength_est).then(b.id.cmp(&a.id)))
    {
        g.push(Goal {
            kind: "contain".into(),
            text: format!("Contain {}, stronger than us and not to be trusted", rival.name),
            civ: Some(rival.id),
            province: None,
            weight: 0.6 + 0.3 * civ.personality.caution,
        });
    }
    for o in civs.iter().filter(|o| o.alive && o.grievances >= 3 && o.id != c) {
        g.push(Goal {
            kind: "avenge".into(),
            text: format!("Avenge the wrongs done to us by {}", o.name),
            civ: Some(o.id),
            province: None,
            weight: 0.3 + 0.1 * o.grievances.min(5) as f64,
        });
    }
    g.push(Goal {
        kind: "prosper".into(),
        text: "Grow rich and keep the realm content".into(),
        civ: None,
        province: None,
        weight: 0.3 + 0.4 * civ.personality.mercantile,
    });
    g
}
