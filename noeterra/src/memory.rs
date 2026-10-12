//! Each civilization's memory. Entries are written by the host from what the
//! civilization witnessed; beliefs are derived from them. A model may append a
//! note, which is stored as model-written and never read back as fact.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::model::{clamp, round2, CivId};

pub const MEMORY_CAPACITY: usize = 96;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct MemoryEntry {
    pub turn: u32,
    pub kind: String,
    pub about: Vec<CivId>,
    pub text: String,
    /// How much it mattered, 0..1.
    pub salience: f64,
    /// How it felt, -1 (wronged) .. 1 (helped).
    pub valence: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Belief {
    pub about: CivId,
    /// Expectation that this civilization keeps its word, 0..1.
    pub trust: f64,
    /// Last estimate of its field armies, in thousands, and when it was made.
    pub estimated_strength: f64,
    pub estimated_turn: u32,
    pub grievances: u32,
    pub favors: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ArchiveLine {
    pub kind: String,
    pub about: Vec<CivId>,
    pub count: u32,
    pub first: u32,
    pub last: u32,
    pub valence: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Note {
    pub turn: u32,
    pub text: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Memory {
    pub civ: CivId,
    pub entries: Vec<MemoryEntry>,
    pub beliefs: Vec<Belief>,
    /// Forgotten detail, kept as counts: "fought Rome 14 times, turns 3-40".
    pub archive: Vec<ArchiveLine>,
    /// The agent's own notes to itself. Model-written when a model wrote them.
    pub notes: Vec<Note>,
}

fn age_weight(now: u32, then: u32) -> f64 {
    let age = now.saturating_sub(then) as f64;
    20.0 / (20.0 + age)
}

impl Memory {
    pub fn new(civ: CivId, civ_count: usize) -> Self {
        Memory {
            civ,
            entries: Vec::new(),
            beliefs: (0..civ_count)
                .map(|b| Belief {
                    about: b,
                    trust: 0.5,
                    estimated_strength: 0.0,
                    estimated_turn: 0,
                    grievances: 0,
                    favors: 0,
                })
                .collect(),
            archive: Vec::new(),
            notes: Vec::new(),
        }
    }

    pub fn belief(&self, about: CivId) -> &Belief {
        &self.beliefs[about]
    }

    pub fn remember(&mut self, e: MemoryEntry) {
        for &b in &e.about {
            if b == self.civ || b >= self.beliefs.len() {
                continue;
            }
            let bel = &mut self.beliefs[b];
            if e.valence <= -0.5 {
                bel.grievances += 1;
            } else if e.valence >= 0.5 {
                bel.favors += 1;
            }
            if e.kind == "betrayal" || e.kind == "broken_promise" {
                bel.trust = round2(clamp(bel.trust - 0.35 * e.salience.max(0.5), 0.0, 1.0));
            } else if e.kind == "promise_kept" || e.kind == "treaty" {
                bel.trust = round2(clamp(bel.trust + 0.08, 0.0, 1.0));
            } else if e.valence < 0.0 {
                bel.trust = round2(clamp(bel.trust + 0.03 * e.valence, 0.0, 1.0));
            }
        }
        self.entries.push(e);
        while self.entries.len() > MEMORY_CAPACITY {
            self.consolidate();
        }
    }

    /// Folds the least memorable entry into the archive. Deterministic: ties are
    /// broken by age, then by position.
    fn consolidate(&mut self) {
        let now = self.entries.iter().map(|e| e.turn).max().unwrap_or(0);
        let mut worst = 0;
        let mut worst_score = f64::INFINITY;
        for (i, e) in self.entries.iter().enumerate() {
            let s = e.salience * age_weight(now, e.turn);
            if s < worst_score {
                worst_score = s;
                worst = i;
            }
        }
        let e = self.entries.remove(worst);
        if let Some(line) = self.archive.iter_mut().find(|l| l.kind == e.kind && l.about == e.about) {
            line.count += 1;
            line.first = line.first.min(e.turn);
            line.last = line.last.max(e.turn);
            line.valence = round2(line.valence + e.valence);
        } else {
            self.archive.push(ArchiveLine {
                kind: e.kind,
                about: e.about,
                count: 1,
                first: e.turn,
                last: e.turn,
                valence: round2(e.valence),
            });
        }
    }

    /// The `k` most relevant entries for a decision about `focus` at `now`.
    pub fn recall(&self, now: u32, focus: &[CivId], k: usize) -> Vec<&MemoryEntry> {
        let mut scored: Vec<(f64, usize)> = self
            .entries
            .iter()
            .enumerate()
            .map(|(i, e)| {
                let relevance = if e.about.iter().any(|a| focus.contains(a)) {
                    0.35
                } else {
                    0.0
                };
                ((e.salience + relevance) * age_weight(now, e.turn), i)
            })
            .collect();
        scored.sort_by(|a, b| b.0.total_cmp(&a.0).then(b.1.cmp(&a.1)));
        let mut picked: Vec<usize> = scored.into_iter().take(k).map(|(_, i)| i).collect();
        picked.sort_unstable();
        picked.into_iter().map(|i| &self.entries[i]).collect()
    }

    pub fn add_note(&mut self, turn: u32, text: String) {
        self.notes.push(Note { turn, text });
        if self.notes.len() > 12 {
            self.notes.remove(0);
        }
    }

    /// Long-term memory as sentences, from the archive.
    pub fn chronicle(&self, names: &BTreeMap<CivId, String>) -> Vec<String> {
        self.archive
            .iter()
            .filter(|l| l.count >= 2 || l.valence.abs() >= 0.5)
            .map(|l| {
                let who: Vec<&str> = l
                    .about
                    .iter()
                    .filter_map(|c| names.get(c).map(|s| s.as_str()))
                    .collect();
                format!(
                    "{} x{} involving {} (turns {}-{}, feeling {:+.1})",
                    l.kind.replace('_', " "),
                    l.count,
                    if who.is_empty() {
                        "no one".to_string()
                    } else {
                        who.join(", ")
                    },
                    l.first,
                    l.last,
                    l.valence
                )
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(turn: u32, kind: &str, about: CivId, salience: f64, valence: f64) -> MemoryEntry {
        MemoryEntry {
            turn,
            kind: kind.into(),
            about: vec![about],
            text: format!("{kind} at {turn}"),
            salience,
            valence,
        }
    }

    #[test]
    fn betrayal_destroys_trust_and_is_counted() {
        let mut m = Memory::new(0, 3);
        m.remember(entry(1, "betrayal", 1, 1.0, -1.0));
        assert!(m.belief(1).trust < 0.2);
        assert_eq!(m.belief(1).grievances, 1);
        assert_eq!(m.belief(2).trust, 0.5);
    }

    #[test]
    fn capacity_is_bounded_and_salient_memories_survive() {
        let mut m = Memory::new(0, 3);
        m.remember(entry(0, "betrayal", 1, 1.0, -1.0));
        for t in 1..400 {
            m.remember(entry(t, "border_incident", 2, 0.05, -0.1));
        }
        assert_eq!(m.entries.len(), MEMORY_CAPACITY);
        assert!(m.entries.iter().any(|e| e.kind == "betrayal"));
        let archived: u32 = m.archive.iter().map(|l| l.count).sum();
        assert_eq!(archived as usize + MEMORY_CAPACITY, 400);
    }

    #[test]
    fn recall_prefers_relevant_and_recent() {
        let mut m = Memory::new(0, 3);
        m.remember(entry(1, "trade", 2, 0.3, 0.3));
        m.remember(entry(9, "battle", 1, 0.3, -0.5));
        let r = m.recall(10, &[1], 1);
        assert_eq!(r[0].kind, "battle");
        let r = m.recall(10, &[2], 1);
        assert_eq!(r[0].kind, "trade");
    }
}
