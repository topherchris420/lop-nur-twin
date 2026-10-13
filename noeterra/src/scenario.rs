//! Scenarios are data. A scenario file names provinces and civilizations by key;
//! `build` validates it and produces the starting world for a seed.

use std::collections::{BTreeMap, VecDeque};

use serde::{Deserialize, Serialize};

use crate::hash::sha256_hex;
use crate::memory::Memory;
use crate::model::*;
use crate::rng::{purpose, Rng};

pub const MEDITERRANEAN: &str = include_str!("../scenarios/mediterranean-264bc.json");
pub const TARIM: &str = include_str!("../scenarios/tarim-77bc.json");

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ArmySpec {
    pub at: String,
    pub strength: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct CivSpec {
    pub key: String,
    pub name: String,
    pub adjective: String,
    pub color: String,
    pub culture: String,
    #[serde(default)]
    pub accepted_cultures: Vec<String>,
    pub government: String,
    pub ruler: String,
    pub capital: String,
    pub personality: Personality,
    pub treasury: f64,
    pub manpower: f64,
    pub stability: f64,
    pub tech: f64,
    #[serde(default)]
    pub armies: Vec<ArmySpec>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ProvinceSpec {
    pub key: String,
    pub name: String,
    pub lon: f64,
    pub lat: f64,
    pub terrain: Terrain,
    pub coastal: bool,
    pub culture: String,
    pub owner: Option<String>,
    pub pop: f64,
    pub dev: f64,
    #[serde(default)]
    pub fort: u8,
    #[serde(default)]
    pub natives: Option<f64>,
    #[serde(default)]
    pub claims: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct TreatySpec {
    pub kind: TreatyKind,
    pub a: String,
    pub b: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Scenario {
    pub id: String,
    pub name: String,
    pub description: String,
    /// What the numbers are. Built-in scenarios say "illustrative".
    pub provenance: String,
    pub start_year: i32,
    pub civs: Vec<CivSpec>,
    pub provinces: Vec<ProvinceSpec>,
    /// `[a, b]` is a land border; `[a, b, "sea"]` a sea lane.
    pub links: Vec<Vec<String>>,
    #[serde(default)]
    pub relations: Vec<(String, String, f64)>,
    #[serde(default)]
    pub treaties: Vec<TreatySpec>,
}

impl Scenario {
    pub fn parse(text: &str) -> Result<Scenario, String> {
        serde_json::from_str(text).map_err(|e| format!("scenario is not valid: {e}"))
    }
    pub fn sha256(&self) -> String {
        sha256_hex(serde_json::to_string(self).expect("scenario serializes").as_bytes())
    }
}

pub fn builtin_ids() -> Vec<&'static str> {
    vec!["mediterranean-264bc", "tarim-77bc", "generated"]
}

pub fn builtin(id: &str, seed: u64) -> Option<Scenario> {
    match id {
        "mediterranean-264bc" => Some(Scenario::parse(MEDITERRANEAN).expect("built-in scenario parses")),
        "tarim-77bc" => Some(Scenario::parse(TARIM).expect("built-in scenario parses")),
        "generated" => Some(generate(seed, 8, 64)),
        _ => None,
    }
}

/// The largest starting population, treasury, manpower or army a scenario may
/// name. Far above any real scenario; it exists so a crafted save cannot start a
/// world whose arithmetic overflows to infinity and then NaN.
const MAX_FIGURE: f64 = 100_000.0;

pub fn build(s: &Scenario, seed: u64) -> Result<World, String> {
    // A save carries its own scenario, so this is reached with untrusted input.
    if s.civs.is_empty() || s.provinces.is_empty() {
        return Err("a scenario needs at least one civilization and one province".into());
    }
    let civ_ix: BTreeMap<&str, CivId> = s.civs.iter().enumerate().map(|(i, c)| (c.key.as_str(), i)).collect();
    let prov_ix: BTreeMap<&str, ProvId> = s
        .provinces
        .iter()
        .enumerate()
        .map(|(i, p)| (p.key.as_str(), i))
        .collect();
    if civ_ix.len() != s.civs.len() {
        return Err("duplicate civilization key".into());
    }
    if prov_ix.len() != s.provinces.len() {
        return Err("duplicate province key".into());
    }
    let civ = |k: &str| {
        civ_ix
            .get(k)
            .copied()
            .ok_or_else(|| format!("unknown civilization `{k}`"))
    };
    let prov = |k: &str| prov_ix.get(k).copied().ok_or_else(|| format!("unknown province `{k}`"));

    let mut provinces = Vec::with_capacity(s.provinces.len());
    for (i, p) in s.provinces.iter().enumerate() {
        let owner = match &p.owner {
            Some(k) => Some(civ(k)?),
            None => None,
        };
        let claims = p.claims.iter().map(|k| civ(k)).collect::<Result<Vec<_>, _>>()?;
        if !(1.0..=10.0).contains(&p.dev)
            || !(p.pop > 0.0 && p.pop <= MAX_FIGURE)
            || p.fort > 3
            || p.natives.is_some_and(|n| !(0.0..=1000.0).contains(&n))
        {
            return Err(format!("province `{}` has out-of-range figures", p.key));
        }
        provinces.push(Province {
            id: i,
            key: p.key.clone(),
            name: p.name.clone(),
            lon: p.lon,
            lat: p.lat,
            terrain: p.terrain,
            coastal: p.coastal,
            culture: p.culture.clone(),
            links: Vec::new(),
            owner,
            controller: owner,
            claims,
            population: p.pop,
            development: p.dev,
            fort: p.fort,
            unrest: 10.0,
            natives: if owner.is_none() {
                p.natives.unwrap_or(round2(1.0 + p.pop / 60.0))
            } else {
                0.0
            },
            siege_by: None,
            siege: 0.0,
        });
    }
    for l in &s.links {
        let (a, b, sea) = match l.as_slice() {
            [a, b] => (prov(a)?, prov(b)?, false),
            [a, b, kind] if kind == "sea" => (prov(a)?, prov(b)?, true),
            _ => return Err(format!("malformed link {l:?}")),
        };
        if a == b || provinces[a].link_to(b).is_some() {
            return Err(format!("duplicate or self link {l:?}"));
        }
        if sea && !(provinces[a].coastal && provinces[b].coastal) {
            return Err(format!("sea lane {l:?} joins an inland province"));
        }
        provinces[a].links.push(Link { to: b, sea });
        provinces[b].links.push(Link { to: a, sea });
    }
    for p in provinces.iter_mut() {
        p.links.sort_by_key(|l| l.to);
    }
    // Every province must be reachable, or some civilization can never be met.
    let mut seen = vec![false; provinces.len()];
    let mut q = VecDeque::from([0usize]);
    seen[0] = true;
    while let Some(p) = q.pop_front() {
        for n in provinces[p].neighbors() {
            if !seen[n] {
                seen[n] = true;
                q.push_back(n);
            }
        }
    }
    if let Some(i) = seen.iter().position(|s| !s) {
        return Err(format!("province `{}` is unreachable", provinces[i].key));
    }

    let mut civs = Vec::new();
    let mut armies = Vec::new();
    let mut next_army = 1;
    for (i, c) in s.civs.iter().enumerate() {
        let capital = prov(&c.capital)?;
        if provinces[capital].owner != Some(i) {
            return Err(format!("`{}` does not own its capital", c.key));
        }
        let t = &c.personality;
        let traits = [t.aggression, t.expansion, t.caution, t.honor, t.mercantile, t.diplomacy];
        if !(0.0..=MAX_FIGURE).contains(&c.treasury)
            || !(0.0..=MAX_FIGURE).contains(&c.manpower)
            || !(0.0..=100.0).contains(&c.stability)
            || !(0.1..=10.0).contains(&c.tech)
            || traits.iter().any(|v| !(0.0..=1.0).contains(v))
        {
            return Err(format!("`{}` has out-of-range figures", c.key));
        }
        civs.push(Civ {
            id: i,
            key: c.key.clone(),
            name: c.name.clone(),
            adjective: c.adjective.clone(),
            color: c.color.clone(),
            culture: c.culture.clone(),
            accepted_cultures: c.accepted_cultures.clone(),
            government: c.government.clone(),
            ruler: c.ruler.clone(),
            capital,
            personality: c.personality.clone(),
            treasury: c.treasury,
            manpower: c.manpower,
            stability: c.stability,
            tech: c.tech,
            war_weariness: 0.0,
            prestige: 0.0,
            alive: true,
        });
        for a in &c.armies {
            let at = prov(&a.at)?;
            if !(0.5..=MAX_FIGURE).contains(&a.strength) {
                return Err(format!("`{}` starts an army of out-of-range strength", c.key));
            }
            if provinces[at].controller != Some(i) {
                return Err(format!("`{}` starts an army outside its land", c.key));
            }
            armies.push(Army {
                id: next_army,
                owner: i,
                location: at,
                strength: a.strength,
                morale: 1.0,
                moved: u32::MAX,
            });
            next_army += 1;
        }
    }
    let n = civs.len();
    let mut opinion = vec![vec![0.0; n]; n];
    for (a, b, v) in &s.relations {
        let (a, b) = (civ(a)?, civ(b)?);
        opinion[a][b] = clamp(*v, -100.0, 100.0);
        opinion[b][a] = clamp(*v, -100.0, 100.0);
    }
    let mut treaties = Vec::new();
    for t in &s.treaties {
        let (a, b) = (civ(&t.a)?, civ(&t.b)?);
        if a == b || treaties.iter().any(|x: &Treaty| x.kind == t.kind && x.involves(a, b)) {
            return Err(format!("self or duplicate treaty between `{}` and `{}`", t.a, t.b));
        }
        treaties.push(Treaty {
            kind: t.kind,
            a,
            b,
            since: 0,
            expires: None,
        });
    }

    let mut w = World {
        sim_version: SIM_VERSION,
        scenario: s.id.clone(),
        scenario_name: s.name.clone(),
        seed,
        turn: 0,
        start_year: s.start_year,
        provinces,
        civs,
        armies,
        next_army,
        opinion,
        treaties,
        wars: Vec::new(),
        next_war: 1,
        proposals: Vec::new(),
        next_proposal: 1,
        messages: Vec::new(),
        events: Vec::new(),
        memories: (0..n).map(|c| Memory::new(c, n)).collect(),
        stats: Vec::new(),
    };
    // A seed varies the opening a little, so two seeds are two histories.
    let mut r = Rng::stream(seed, &[purpose::GENERATE]);
    for c in w.civs.iter_mut() {
        c.treasury = round2(c.treasury * r.range(0.9, 1.1));
        c.stability = round2(clamp(c.stability + r.range(-5.0, 5.0), 0.0, 100.0));
    }
    let stats = (0..n).map(|c| w.civ_stats(c)).collect();
    w.stats.push(stats);
    Ok(w)
}

const SYLLABLES: [&str; 24] = [
    "ar", "bel", "cor", "dan", "el", "fen", "gar", "hal", "is", "jor", "kel", "lun", "mar", "nor", "or", "pel", "quin",
    "ros", "sar", "tor", "ul", "ven", "wyr", "zan",
];

fn name(r: &mut Rng) -> String {
    let n = 2 + r.below(2);
    let s: String = (0..n).map(|_| SYLLABLES[r.below(SYLLABLES.len())]).collect();
    let mut c = s.chars();
    match c.next() {
        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
        None => s,
    }
}

const COLORS: [&str; 12] = [
    "#c0392b", "#2e86c1", "#28b463", "#8e44ad", "#d68910", "#17a589", "#cb4335", "#5d6d7e", "#a04000", "#1f618d",
    "#7d3c98", "#b7950b",
];

/// A procedural continent: a jittered grid of provinces with civilizations grown
/// outward from spread-out capitals. Used for scale tests and quick games.
pub fn generate(seed: u64, civ_count: usize, province_count: usize) -> Scenario {
    let mut r = Rng::stream(seed, &[purpose::GENERATE, 1]);
    let cols = ((province_count as f64).sqrt().ceil() as usize).max(2);
    let rows = province_count.div_ceil(cols);
    let terrains = [
        Terrain::Plains,
        Terrain::Plains,
        Terrain::Plains,
        Terrain::Hills,
        Terrain::Hills,
        Terrain::Forest,
        Terrain::Mountains,
        Terrain::Steppe,
        Terrain::Desert,
        Terrain::Marsh,
    ];
    let mut provinces = Vec::new();
    for i in 0..province_count {
        let (cx, cy) = ((i % cols) as f64, (i / cols) as f64);
        let edge = i % cols == 0 || i % cols == cols - 1 || i / cols == 0 || i / cols == rows - 1;
        let terrain = terrains[r.below(terrains.len())];
        provinces.push(ProvinceSpec {
            key: format!("p{i}"),
            name: name(&mut r),
            lon: cx * 1.6 + r.range(-0.45, 0.45),
            lat: 40.0 - cy * 1.3 + r.range(-0.4, 0.4),
            terrain,
            coastal: edge,
            culture: String::new(),
            owner: None,
            pop: round2(r.range(40.0, 260.0)),
            dev: round2(r.range(1.5, 6.0)),
            fort: if r.chance(0.15) { 1 } else { 0 },
            natives: None,
            claims: Vec::new(),
        });
    }
    let mut links = Vec::new();
    for i in 0..province_count {
        let (x, y) = (i % cols, i / cols);
        let mut add = |j: usize, sea: bool| {
            links.push(if sea {
                vec![format!("p{i}"), format!("p{j}"), "sea".into()]
            } else {
                vec![format!("p{i}"), format!("p{j}")]
            })
        };
        if x + 1 < cols && i + 1 < province_count {
            add(i + 1, false);
        }
        if y + 1 < rows && i + cols < province_count {
            add(i + cols, false);
        }
        if x + 1 < cols && y + 1 < rows && i + cols + 1 < province_count && (x + y) % 2 == 0 {
            add(i + cols + 1, false);
        }
    }
    // Capitals spread out by farthest-point sampling on the grid.
    let civ_count = civ_count.clamp(2, province_count / 2).min(COLORS.len());
    let mut capitals = vec![r.below(province_count)];
    while capitals.len() < civ_count {
        let best = (0..province_count)
            .filter(|i| !capitals.contains(i))
            .max_by(|&a, &b| {
                let d = |i: usize| {
                    capitals
                        .iter()
                        .map(|&c| {
                            let (dx, dy) = (
                                (i % cols) as i64 - (c % cols) as i64,
                                (i / cols) as i64 - (c / cols) as i64,
                            );
                            dx * dx + dy * dy
                        })
                        .min()
                        .unwrap_or(0)
                };
                d(a).cmp(&d(b)).then(b.cmp(&a))
            })
            .expect("there is room for another capital");
        capitals.push(best);
    }
    // Each civilization takes a compact block around its capital; the rest stays free.
    let mut owner: Vec<Option<usize>> = vec![None; province_count];
    let share = (province_count * 3 / 5) / civ_count;
    for (c, &cap) in capitals.iter().enumerate() {
        owner[cap] = Some(c);
    }
    let mut adj: Vec<Vec<usize>> = vec![Vec::new(); province_count];
    for l in &links {
        let (a, b): (usize, usize) = (l[0][1..].parse().unwrap(), l[1][1..].parse().unwrap());
        adj[a].push(b);
        adj[b].push(a);
    }
    for _ in 0..share.saturating_sub(1) {
        for c in 0..civ_count {
            let frontier: Vec<usize> = (0..province_count)
                .filter(|&i| owner[i].is_none() && adj[i].iter().any(|&n| owner[n] == Some(c)))
                .collect();
            if !frontier.is_empty() {
                let pick = frontier[r.below(frontier.len())];
                owner[pick] = Some(c);
            }
        }
    }
    let mut civs = Vec::new();
    for c in 0..civ_count {
        let civ_name = name(&mut r);
        let culture = civ_name.to_lowercase();
        let mut trait_ = || round2(r.range(0.15, 0.9));
        let personality = Personality {
            aggression: trait_(),
            expansion: trait_(),
            caution: trait_(),
            honor: trait_(),
            mercantile: trait_(),
            diplomacy: trait_(),
        };
        let cap_key = format!("p{}", capitals[c]);
        civs.push(CivSpec {
            key: format!("c{c}"),
            name: format!("Realm of {civ_name}"),
            adjective: civ_name.clone(),
            color: COLORS[c].to_string(),
            culture: culture.clone(),
            accepted_cultures: Vec::new(),
            government: "Kingdom".into(),
            ruler: format!(
                "{} the {}",
                name(&mut r),
                ["Bold", "Wise", "Young", "Elder", "Just"][r.below(5)]
            ),
            capital: cap_key.clone(),
            personality,
            treasury: 60.0,
            manpower: 12.0,
            stability: 60.0,
            tech: 1.0,
            armies: vec![ArmySpec {
                at: cap_key,
                strength: 8.0,
            }],
        });
        for (i, p) in provinces.iter_mut().enumerate() {
            if owner[i] == Some(c) {
                p.owner = Some(format!("c{c}"));
                p.culture = culture.clone();
            }
        }
        provinces[capitals[c]].dev = 6.0;
        provinces[capitals[c]].fort = 2;
    }
    for p in provinces.iter_mut().filter(|p| p.owner.is_none()) {
        p.culture = "tribal".into();
    }
    Scenario {
        id: "generated".into(),
        name: format!("Generated continent (seed {seed})"),
        description: "A procedurally generated continent of rival realms and unclaimed tribal lands.".into(),
        provenance: "procedural: every name and number is generated from the seed".into(),
        start_year: 1000,
        civs,
        provinces,
        links,
        relations: Vec::new(),
        treaties: Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mediterranean_builds() {
        let s = builtin("mediterranean-264bc", 1).unwrap();
        let w = build(&s, 1).unwrap();
        assert!(w.civs.len() >= 8);
        assert!(w.provinces.len() >= 60);
        assert_eq!(w.date(), "Spring 264 BC");
        for p in &w.provinces {
            for l in &p.links {
                assert!(
                    w.provinces[l.to].link_to(p.id).is_some(),
                    "asymmetric link at {}",
                    p.key
                );
            }
        }
    }

    #[test]
    fn generated_builds_at_several_sizes() {
        for (c, p) in [(2, 9), (8, 64), (20, 400)] {
            let s = generate(11, c, p);
            let w = build(&s, 11).unwrap();
            assert_eq!(w.provinces.len(), p);
            assert!(w.civs.iter().all(|c| w.provinces[c.capital].owner == Some(c.id)));
        }
    }

    #[test]
    fn rejects_bad_scenarios() {
        let mut s = builtin("mediterranean-264bc", 1).unwrap();
        s.links.push(vec!["roma".into(), "nowhere".into()]);
        assert!(build(&s, 1).unwrap_err().contains("unknown province"));
        let mut s = builtin("mediterranean-264bc", 1).unwrap();
        s.links.push(vec!["samnium".into(), "carthago".into(), "sea".into()]);
        assert!(build(&s, 1).unwrap_err().contains("inland"));
    }
}
