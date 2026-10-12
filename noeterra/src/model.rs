//! The world's typed state. Everything an agent can change is a field here, and
//! only `resolve.rs` writes it.

use serde::{Deserialize, Serialize};

use crate::memory::Memory;

pub type CivId = usize;
pub type ProvId = usize;

pub const SAVE_SCHEMA: &str = "noeterra-save/v1";
pub const SIM_VERSION: u32 = 1;

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Terrain {
    Plains,
    Hills,
    Mountains,
    Desert,
    Forest,
    Marsh,
    Steppe,
}

impl Terrain {
    pub fn defense(self) -> f64 {
        match self {
            Terrain::Plains | Terrain::Steppe => 1.0,
            Terrain::Desert => 1.1,
            Terrain::Forest | Terrain::Marsh => 1.25,
            Terrain::Hills => 1.3,
            Terrain::Mountains => 1.6,
        }
    }
    pub fn income(self) -> f64 {
        match self {
            Terrain::Plains => 1.15,
            Terrain::Hills | Terrain::Forest => 0.95,
            Terrain::Steppe => 0.8,
            Terrain::Marsh => 0.75,
            Terrain::Mountains => 0.7,
            Terrain::Desert => 0.6,
        }
    }
    /// Thousands of people a province can sustain per point of development.
    pub fn capacity(self) -> f64 {
        match self {
            Terrain::Plains => 140.0,
            Terrain::Hills | Terrain::Forest => 100.0,
            Terrain::Steppe | Terrain::Marsh => 80.0,
            Terrain::Mountains => 60.0,
            Terrain::Desert => 45.0,
        }
    }
    /// Fraction of an army lost per turn spent in hostile ground of this kind.
    pub fn attrition(self) -> f64 {
        match self {
            Terrain::Desert => 0.04,
            Terrain::Mountains => 0.03,
            Terrain::Marsh => 0.025,
            _ => 0.01,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Link {
    pub to: ProvId,
    pub sea: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Province {
    pub id: ProvId,
    pub key: String,
    pub name: String,
    pub lon: f64,
    pub lat: f64,
    pub terrain: Terrain,
    pub coastal: bool,
    pub culture: String,
    pub links: Vec<Link>,
    /// Who holds legal title. Changes only through peace terms, annexation or revolt.
    pub owner: Option<CivId>,
    /// Who holds it on the ground. Differs from `owner` under occupation.
    pub controller: Option<CivId>,
    /// Who believes it ought to be theirs. Claims make wars over it cheaper to justify.
    pub claims: Vec<CivId>,
    /// Thousands of people.
    pub population: f64,
    pub development: f64,
    pub fort: u8,
    pub unrest: f64,
    /// Strength of local resistance in an unowned province, in thousands.
    pub natives: f64,
    pub siege_by: Option<CivId>,
    pub siege: f64,
}

impl Province {
    pub fn neighbors(&self) -> impl Iterator<Item = ProvId> + '_ {
        self.links.iter().map(|l| l.to)
    }
    pub fn link_to(&self, to: ProvId) -> Option<&Link> {
        self.links.iter().find(|l| l.to == to)
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Personality {
    pub aggression: f64,
    pub expansion: f64,
    pub caution: f64,
    pub honor: f64,
    pub mercantile: f64,
    pub diplomacy: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Civ {
    pub id: CivId,
    pub key: String,
    pub name: String,
    pub adjective: String,
    pub color: String,
    pub culture: String,
    pub accepted_cultures: Vec<String>,
    pub government: String,
    pub ruler: String,
    pub capital: ProvId,
    pub personality: Personality,
    pub treasury: f64,
    pub manpower: f64,
    pub stability: f64,
    pub tech: f64,
    pub war_weariness: f64,
    pub prestige: f64,
    pub alive: bool,
}

impl Civ {
    pub fn accepts(&self, culture: &str) -> bool {
        self.culture == culture || self.accepted_cultures.iter().any(|c| c == culture)
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Army {
    pub id: u32,
    pub owner: CivId,
    pub location: ProvId,
    /// Thousands of soldiers.
    pub strength: f64,
    pub morale: f64,
    /// The turn the army last moved, so it cannot move twice in one turn.
    pub moved: u32,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum TreatyKind {
    Alliance,
    NonAggression,
    Trade,
}

impl TreatyKind {
    pub fn label(self) -> &'static str {
        match self {
            TreatyKind::Alliance => "alliance",
            TreatyKind::NonAggression => "non-aggression pact",
            TreatyKind::Trade => "trade agreement",
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Treaty {
    pub kind: TreatyKind,
    pub a: CivId,
    pub b: CivId,
    pub since: u32,
    pub expires: Option<u32>,
}

impl Treaty {
    pub fn involves(&self, x: CivId, y: CivId) -> bool {
        (self.a == x && self.b == y) || (self.a == y && self.b == x)
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct War {
    pub id: u32,
    pub attackers: Vec<CivId>,
    pub defenders: Vec<CivId>,
    pub started: u32,
    /// Positive favours the attackers.
    pub score: f64,
    pub battles: u32,
}

impl War {
    pub fn side_of(&self, c: CivId) -> Option<bool> {
        if self.attackers.contains(&c) {
            Some(true)
        } else if self.defenders.contains(&c) {
            Some(false)
        } else {
            None
        }
    }
    pub fn opposes(&self, x: CivId, y: CivId) -> bool {
        matches!((self.side_of(x), self.side_of(y)), (Some(a), Some(b)) if a != b)
    }
    pub fn leader(&self, attackers: bool) -> CivId {
        if attackers {
            self.attackers[0]
        } else {
            self.defenders[0]
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Terms {
    Alliance,
    NonAggression,
    Trade,
    /// End a war. `cede` lists provinces the recipient hands to the proposer;
    /// `concede` lists provinces the proposer hands to the recipient.
    Peace {
        war: u32,
        cede: Vec<ProvId>,
        concede: Vec<ProvId>,
        tribute: f64,
    },
    /// The proposer demands gold from the recipient.
    Tribute {
        amount: f64,
    },
    /// The proposer asks an ally to join a war on its side.
    JoinWar {
        war: u32,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Proposal {
    pub id: u32,
    pub from: CivId,
    pub to: CivId,
    pub turn: u32,
    pub terms: Terms,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Generation {
    /// Written by host code from a template.
    Scripted,
    /// Written by a language model.
    Model,
    /// Typed by a person.
    Human,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Message {
    pub turn: u32,
    pub from: CivId,
    pub to: CivId,
    pub text: String,
    pub generation: Generation,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Event {
    pub turn: u32,
    pub kind: String,
    pub civs: Vec<CivId>,
    pub provinces: Vec<ProvId>,
    pub text: String,
    pub magnitude: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct CivStats {
    pub provinces: usize,
    pub population: f64,
    pub strength: f64,
    pub treasury: f64,
    pub stability: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct World {
    pub sim_version: u32,
    pub scenario: String,
    pub scenario_name: String,
    pub seed: u64,
    pub turn: u32,
    pub start_year: i32,
    pub provinces: Vec<Province>,
    pub civs: Vec<Civ>,
    pub armies: Vec<Army>,
    pub next_army: u32,
    /// `opinion[a][b]`: how `a` regards `b`, -100..100.
    pub opinion: Vec<Vec<f64>>,
    pub treaties: Vec<Treaty>,
    pub wars: Vec<War>,
    pub next_war: u32,
    pub proposals: Vec<Proposal>,
    pub next_proposal: u32,
    pub messages: Vec<Message>,
    pub events: Vec<Event>,
    pub memories: Vec<Memory>,
    /// `stats[turn][civ]`, recorded at the end of each turn.
    pub stats: Vec<Vec<CivStats>>,
}

pub const SEASONS: [&str; 4] = ["Spring", "Summer", "Autumn", "Winter"];

pub fn format_year(y: i32) -> String {
    if y <= 0 {
        format!("{} BC", 1 - y)
    } else {
        format!("AD {y}")
    }
}

impl World {
    /// Astronomical year: 0 is 1 BC, -263 is 264 BC.
    pub fn year(&self) -> i32 {
        self.start_year + (self.turn / 4) as i32
    }
    pub fn date(&self) -> String {
        date_of(self.start_year, self.turn)
    }
    pub fn civ_by_key(&self, key: &str) -> Option<CivId> {
        self.civs.iter().find(|c| c.key == key).map(|c| c.id)
    }
    pub fn at_war(&self, a: CivId, b: CivId) -> bool {
        self.wars.iter().any(|w| w.opposes(a, b))
    }
    pub fn war_between(&self, a: CivId, b: CivId) -> Option<&War> {
        self.wars.iter().find(|w| w.opposes(a, b))
    }
    pub fn has_treaty(&self, a: CivId, b: CivId, kind: TreatyKind) -> bool {
        self.treaties.iter().any(|t| t.kind == kind && t.involves(a, b))
    }
    pub fn allied(&self, a: CivId, b: CivId) -> bool {
        a == b || self.has_treaty(a, b, TreatyKind::Alliance)
    }
    pub fn wars_of(&self, c: CivId) -> impl Iterator<Item = &War> {
        self.wars.iter().filter(move |w| w.side_of(c).is_some())
    }
    /// Whether `c` may stand in `p` without fighting its holder.
    pub fn friendly_ground(&self, c: CivId, p: ProvId) -> bool {
        match self.provinces[p].controller {
            None => false,
            Some(h) => h == c || self.allied(c, h),
        }
    }
    pub fn strength_of(&self, c: CivId) -> f64 {
        self.armies.iter().filter(|a| a.owner == c).map(|a| a.strength).sum()
    }
    pub fn provinces_of(&self, c: CivId) -> impl Iterator<Item = &Province> {
        self.provinces.iter().filter(move |p| p.owner == Some(c))
    }
    pub fn controlled_by(&self, c: CivId) -> impl Iterator<Item = &Province> {
        self.provinces.iter().filter(move |p| p.controller == Some(c))
    }
    pub fn armies_in(&self, p: ProvId) -> impl Iterator<Item = &Army> {
        self.armies.iter().filter(move |a| a.location == p)
    }
    pub fn army(&self, id: u32) -> Option<&Army> {
        self.armies.iter().find(|a| a.id == id)
    }
    /// Civilizations that know each other: neighbours, treaty partners and enemies.
    pub fn in_contact(&self, a: CivId, b: CivId) -> bool {
        if a == b || !self.civs[b].alive {
            return false;
        }
        if self.treaties.iter().any(|t| t.involves(a, b)) || self.at_war(a, b) {
            return true;
        }
        self.provinces.iter().any(|p| {
            (p.controller == Some(a) || p.owner == Some(a))
                && p.links.iter().any(|l| {
                    let q = &self.provinces[l.to];
                    q.controller == Some(b) || q.owner == Some(b)
                })
        })
    }
    pub fn contacts(&self, a: CivId) -> Vec<CivId> {
        (0..self.civs.len()).filter(|&b| self.in_contact(a, b)).collect()
    }
    pub fn civ_stats(&self, c: CivId) -> CivStats {
        let civ = &self.civs[c];
        CivStats {
            provinces: self.provinces_of(c).count(),
            population: round2(self.provinces_of(c).map(|p| p.population).sum()),
            strength: round2(self.strength_of(c)),
            treasury: round2(civ.treasury),
            stability: round2(civ.stability),
        }
    }
}

pub fn date_of(start_year: i32, turn: u32) -> String {
    let y = start_year + (turn / 4) as i32;
    format!("{} {}", SEASONS[(turn % 4) as usize], format_year(y))
}

/// Rounds to two decimals. State is rounded at the end of each turn so that a
/// saved world reloads to exactly the numbers it was saved with.
pub fn round2(x: f64) -> f64 {
    (x * 100.0).round() / 100.0
}

pub fn clamp(x: f64, lo: f64, hi: f64) -> f64 {
    if x < lo {
        lo
    } else if x > hi {
        hi
    } else {
        x
    }
}
