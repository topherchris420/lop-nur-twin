"""Adaptive-life experiments on research subjects: ``experiments/adaptive-life-v783.json``.

A research subject forages among odour-marked sites. It senses each site's
odour (its Kenyon-cell code), chooses one, and tastes food there or not;
nothing else reaches it (no site identities, no food positions). What it
learns, and how fast it relearns when the world changes, is measured on
schedules where food is relocated (A), rewards reverse (D) and a memory has
to outlast other experience (E); the subject's whole state can be
checkpointed and restored at any visit (Phase 7).

The valuation is the connectome model's own mushroom body, reduced to its
plastic layer:

- **Codes** (``build_codes``): each odour's KC and PAM spike counts in
  500 ms trials of the full leaky integrate-and-fire model on FlyWire v783
  (``lif``), under a named representation (``mbcode``): the antennal-lobe
  sweep's selection (``sparse``), the threshold-only one, Shiu et al.'s
  weights (``dense``), and ``random``: the sparse code's per-odour number of
  active KCs on cells drawn at random, which keeps sparseness and removes the
  connectome's structure. Cached under ``.fly-neural/adaptive/`` (derived
  from FlyWire data: never committed).
- **Valuation**: the readout MBONs' drive ``m = sum w_ij E_i`` over the
  connectome's KC -> readout-MBON synapses, ``E_i = min(1, k_i / e_sat)``;
  an odour's value is the fraction of its naive drive that learning removed,
  ``1 - m / m0`` (depression of KC -> MBON synapses is the learned approach),
  scaled by the rule's largest possible depression.
- **Rules**: v2 (``selective``'s rule with dopamine full or absent per visit,
  i.e. reward on a meal) and v1 (``plasticity``'s, with the odour-evoked PAM
  spikes of the code's own trial added to the reward's), or none.

Choice is the same for every neural agent: the best-valued site when its
value exceeds ``approach_threshold`` (ECHO's own ``approachThreshold``, on a
0-1 scale), otherwise a site at random. The comparators are ECHO's
mushroom-body rate model (``EchoMB``, ported from
src/bethesda/fly/mushroomBody/circuit.ts and tested equal to it), ECHO's
two-miss place bookkeeping (``Bookkeeping``, a non-neural heuristic) and a
random forager.
"""

from __future__ import annotations

import copy
import hashlib
import json
import math
import time
import zlib
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from . import RESULT_SCHEMA, lif, stats
from . import connectome as cx
from .mbcode import Groups, Representation, apply
from .record import code_watch, environment, load_sealed, sealed, write_json
from .resources import Meter, machine
from .selective import Synapses

SCHEMA = "fly-neural-adaptive-life/v1"
CHECKPOINT_SCHEMA = "fly-neural-research-subject/v1"
M32 = 0xFFFFFFFF

# --- ECHO's mushroom body (Bennett, Philippides & Nowotny 2021 MV model), ported ---------------

ECHO_MB = {"kenyonCells": 2000, "kcCoding": 0.05, "kcTotalHz": 10.0, "initialWeightMax": 0.1, "kcDanWeight": 1.0, "mbonDanWeight": 1.0, "learningRate": 0.25, "mealReward": 1.0, "approachThreshold": 0.3}


def _imul(a: int, b: int) -> int:
    return (a * b) & M32


def mulberry32(seed: int):
    """src/lib/noise.ts ``mulberry32``, bit for bit."""
    a = seed & M32

    def nxt() -> float:
        nonlocal a
        a = (a + 0x6D2B79F5) & M32
        t = _imul(a ^ (a >> 15), 1 | a)
        t = ((t + _imul(t ^ (t >> 7), 61 | t)) & M32) ^ t
        return ((t ^ (t >> 14)) & M32) / 4294967296

    return nxt


def fnv1a(text: str) -> int:
    h = 0x811C9DC5
    for ch in text:
        h ^= ord(ch)
        h = _imul(h, 0x01000193)
    return h & M32


class EchoMB:
    """circuit.ts ``MushroomBody``: random KC codes per cue name, m+ and m-, RPE-driven DANs."""

    kind = "echo-mb"

    def __init__(self, seed: int, P: dict = ECHO_MB, block_omission: bool = False):
        self.P = P
        self.wiring = (seed ^ 0x5BE0CD19) & M32
        self.block_omission = block_omission
        draw = mulberry32((seed ^ 0x9B05688C) & M32)
        n = int(P["kenyonCells"])
        self.w_plus = np.array([P["initialWeightMax"] * draw() for _ in range(n)])
        self.w_minus = np.array([P["initialWeightMax"] * draw() for _ in range(n)])
        self.trials = 0
        self._codes: dict[str, tuple[np.ndarray, float]] = {}

    def code(self, cue: str) -> tuple[np.ndarray, float]:
        if cue not in self._codes:
            u = mulberry32((fnv1a(cue) ^ self.wiring) & M32)
            cells = np.array([j for j in range(int(self.P["kenyonCells"])) if u() < self.P["kcCoding"]], dtype=np.int64)
            self._codes[cue] = (cells, self.P["kcTotalHz"] / cells.size if cells.size else 0.0)
        return self._codes[cue]

    def _out(self, cells, hz) -> tuple[float, float]:
        # Summed in index order, as the TypeScript loop does, so the floats agree exactly.
        plus = minus = 0.0
        for j in cells:
            plus += self.w_plus[j]
            minus += self.w_minus[j]
        return max(0.0, plus * hz), max(0.0, minus * hz)

    def predict(self, cue: str) -> float:
        mp, mm = self._out(*self.code(cue))
        return mp - mm

    def trial(self, cue: str, r: float, event: str) -> None:
        cells, hz = self.code(cue)
        if not cells.size:
            return
        P = self.P
        mp, mm = self._out(cells, hz)
        before = mp - mm
        drive = P["kcDanWeight"] * hz * cells.size
        d_plus = max(0.0, r - P["mbonDanWeight"] * before + drive)
        d_minus = max(0.0, -r + P["mbonDanWeight"] * before + drive)
        if not (self.block_omission and event == "fruitless return"):
            step = (P["learningRate"] / 2) * hz * (d_plus - d_minus)
            for j in cells:
                self.w_plus[j] = max(0.0, self.w_plus[j] + step)
                self.w_minus[j] = max(0.0, self.w_minus[j] - step)
        self.trials += 1

    # Agent interface.
    def values(self, odours: list[str], rng) -> list[float]:
        return [self.predict(f"odour {o}") / self.P["mealReward"] for o in odours]

    def learn(self, odour: str, meal: bool, rng) -> None:
        self.trial(f"odour {odour}", self.P["mealReward"] if meal else 0.0, "meal" if meal else "fruitless return")

    def state(self) -> dict:
        return {"w_plus": self.w_plus.tolist(), "w_minus": self.w_minus.tolist(), "trials": self.trials}

    def load(self, s: dict) -> None:
        self.w_plus, self.w_minus, self.trials = np.array(s["w_plus"]), np.array(s["w_minus"]), int(s["trials"])


# --- the connectome model's plastic layer -----------------------------------------------------


@dataclass
class Codes:
    """Each odour's KC and PAM spike counts in the full model's trials, and the KC -> readout layer."""

    odours: list[str]
    kc: dict[str, np.ndarray]  # rep -> (odour, trial, kc) spike counts
    pam: dict[str, np.ndarray]  # rep -> (odour, trial, pam)
    pre: np.ndarray  # KC index (0..n_kc) of every KC -> readout pair
    post: np.ndarray  # readout index of the pair
    w0: np.ndarray  # its connectome weight (mV, before any representation scaling)
    reach: np.ndarray  # (pam, readout) bool: PAM d reaches readout MBON j
    meta: dict

    def index(self, odour: str) -> int:
        return self.odours.index(odour)

    def save(self, path: Path) -> str:
        path.parent.mkdir(parents=True, exist_ok=True)
        arrays = {f"kc__{r}": v for r, v in self.kc.items()} | {f"pam__{r}": v for r, v in self.pam.items()}
        np.savez_compressed(path, pre=self.pre, post=self.post, w0=self.w0, reach=self.reach, **arrays)
        meta_path = path.with_suffix(".json")
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        write_json(meta_path, {**self.meta, "odours": self.odours, "npz_sha256": digest})
        return digest

    @classmethod
    def load(cls, path: Path) -> "Codes":
        meta = json.loads(path.with_suffix(".json").read_text(encoding="utf-8"))
        if hashlib.sha256(path.read_bytes()).hexdigest() != meta["npz_sha256"]:
            raise RuntimeError(f"{path.name} does not match its manifest")
        z = np.load(path)
        kc = {k[4:]: z[k] for k in z.files if k.startswith("kc__")}
        pam = {k[5:]: z[k] for k in z.files if k.startswith("pam__")}
        return cls(meta["odours"], kc, pam, z["pre"], z["post"], z["w0"], z["reach"], meta)

    def with_random(self, base: str, seed: int) -> "Codes":
        """Adds rep ``random``: each odour-trial's active KCs moved to cells drawn at random (same counts, same number active)."""
        rng = np.random.default_rng(seed)
        src = self.kc[base]
        out = np.zeros_like(src)
        n = src.shape[2]
        for o in range(src.shape[0]):
            perm = rng.permutation(n)  # one relabelling per odour, so its trials stay alike
            out[o] = src[o][:, perm]
        new = copy.copy(self)
        new.kc = {**self.kc, "random": out}
        new.pam = {**self.pam, "random": self.pam[base]}
        return new


class ConnectomeMB:
    """The readout MBONs' plastic KC synapses under rule v2, v1 or none."""

    kind = "connectome-mb"

    def __init__(self, codes: Codes, rep: str, rule: str, cfg: dict, *, silenced: bool = False, no_threshold: bool = False, uncoupled: bool = False):
        self.codes, self.rep, self.rule = codes, rep, rule
        self.silenced, self.no_threshold, self.uncoupled = silenced, no_threshold, uncoupled
        self.v2 = cfg["rule_v2"]
        self.v1 = cfg["rule_v1"]
        self.reward_spikes_per_pam = cfg["reward_spikes_per_pam"]
        self.V = np.zeros(codes.pre.size)  # v2 state
        self.w = codes.w0.astype(float).copy()
        self.meals = 0
        self.visits = 0

    def _E(self, odour: str, trial: int) -> np.ndarray:
        k = self.codes.kc[self.rep][self.codes.index(odour), trial].astype(float)
        e_sat = self.v2["e_sat"] if self.rule == "v2" else self.v1["e_sat"]
        return np.minimum(1.0, k / e_sat)

    def _trial(self, rng) -> int:
        return int(rng.integers(self.codes.kc[self.rep].shape[1]))

    def value(self, odour: str, trial: int) -> float:
        E = self._E(odour, trial)[self.codes.pre]
        m0 = float((self.codes.w0 * E).sum())
        if m0 <= 0:
            return 0.0
        m = float((self.w * E).sum())
        top = 1.0 - self.v2["floor"] if self.rule == "v2" else 1.0
        return (1.0 - m / m0) / top

    def values(self, odours: list[str], rng) -> list[float]:
        return [self.value(o, self._trial(rng)) for o in odours]

    def learn(self, odour: str, meal: bool, rng) -> None:
        trial = self._trial(rng)
        self.visits += 1
        self.meals += int(meal)
        if self.rule == "none" or self.silenced:
            return
        E = self._E(odour, trial)
        pam = self.codes.pam[self.rep][self.codes.index(odour), trial].astype(float)
        R = float(meal)
        if self.uncoupled:
            # Dopamine as often as this subject has eaten so far, on visits chosen at random.
            R = float(rng.random() < self.meals / self.visits)
        if self.rule == "v2":
            Rj = np.full(self.codes.reach.shape[1], R)
            if self.no_threshold:
                Rj = np.maximum(Rj, (pam @ self.codes.reach > 0).astype(float))
            Ei, Rp = E[self.codes.pre], Rj[self.codes.post]
            c = self.v2
            self.V = np.clip(self.V + c["eta_dep"] * Ei * Rp * (1 - self.V) - c["eta_ext"] * Ei * (1 - Rp) * self.V, 0.0, 1.0)
            self.w = self.codes.w0 * (1.0 - (1.0 - c["floor"]) * self.V)
        else:
            k = self.codes.kc[self.rep][self.codes.index(odour), trial].astype(float)
            D = (pam + R * self.reward_spikes_per_pam) @ self.codes.reach
            c = self.v1
            f = c["eta"] * np.minimum(1.0, k[self.codes.pre] / c["e_sat"]) * np.minimum(1.0, D[self.codes.post] / c["D_sat"])
            self.w = self.w * (1.0 - f)

    def state(self) -> dict:
        return {"V": self.V.tolist(), "w": self.w.tolist(), "meals": self.meals, "visits": self.visits}

    def load(self, s: dict) -> None:
        self.V, self.w = np.array(s["V"], dtype=float), np.array(s["w"], dtype=float)
        if self.V.shape != self.codes.pre.shape or self.w.shape != self.codes.pre.shape:
            raise ValueError("checkpoint synapses do not match this connectome's KC -> readout layer")
        self.meals, self.visits = int(s["meals"]), int(s["visits"])


class Bookkeeping:
    """ECHO's place bookkeeping as a non-neural heuristic: go back to where it last ate until two fruitless returns in a row."""

    kind = "bookkeeping"

    def __init__(self, misses: int = 2):
        self.limit = misses
        self.current: str | None = None
        self.misses = 0
        self.abandoned: str | None = None

    def choose(self, odours: list[str], rng) -> str:
        if self.current in odours:
            return self.current
        pool = [o for o in odours if o != self.abandoned] or odours
        return pool[int(rng.integers(len(pool)))]

    def learn(self, odour: str, meal: bool, rng) -> None:
        if meal:
            self.current, self.misses = odour, 0
        elif odour == self.current:
            self.misses += 1
            if self.misses >= self.limit:
                self.abandoned, self.current, self.misses = self.current, None, 0

    def state(self) -> dict:
        return {"current": self.current, "misses": self.misses, "abandoned": self.abandoned}

    def load(self, s: dict) -> None:
        self.current, self.misses, self.abandoned = s["current"], int(s["misses"]), s["abandoned"]


class RandomForager:
    kind = "random"

    def choose(self, odours, rng):
        return odours[int(rng.integers(len(odours)))]

    def learn(self, odour, meal, rng):
        pass

    def state(self) -> dict:
        return {}

    def load(self, s: dict) -> None:
        pass


def choose(agent, odours: list[str], threshold: float, rng) -> str:
    if hasattr(agent, "choose"):
        return agent.choose(odours, rng)
    v = np.array(agent.values(odours, rng))
    best = np.flatnonzero(v == v.max())
    if v.max() > threshold:
        return odours[int(best[rng.integers(best.size)])]
    return odours[int(rng.integers(len(odours)))]


# --- research subjects, their lives and checkpoints ------------------------------------------


def make_agent(arm: dict, codes: Codes | None, cfg: dict, seed: int):
    k = arm["agent"]
    if k == "connectome-mb":
        return ConnectomeMB(codes, arm["representation"], arm["rule"], cfg, silenced=arm.get("silenced", False), no_threshold=arm.get("no_threshold", False), uncoupled=arm.get("uncoupled", False))
    if k == "echo-mb":
        return EchoMB(seed)
    if k == "bookkeeping":
        return Bookkeeping(cfg["bookkeeping_misses"])
    if k == "random":
        return RandomForager()
    raise ValueError(f"unknown agent {k!r}")


class Subject:
    """One research subject: an agent and its own random stream. Never the deployed fly or a copy of it."""

    def __init__(self, name: str, arm: dict, codes: Codes | None, cfg: dict, seed: int):
        self.name, self.arm, self.cfg, self.seed = name, arm, cfg, seed
        self.agent = make_agent(arm, codes, cfg, seed)
        self.rng = np.random.default_rng(seed)
        self.visits = 0
        self.parent: str | None = None

    def visit(self, odours: list[str], food: str | None) -> tuple[str, bool]:
        o = choose(self.agent, odours, self.cfg["approach_threshold"], self.rng)
        meal = o == food
        self.agent.learn(o, meal, self.rng)
        self.visits += 1
        return o, meal

    def checkpoint(self, config_sha256: str) -> dict:
        body = {
            "schema": CHECKPOINT_SCHEMA,
            "subject": self.name,
            "research_subject": True,
            "arm": self.arm,
            "agent": self.agent.kind,
            "seed": self.seed,
            "config_sha256": config_sha256,
            "visits": self.visits,
            "parent_sha256": self.parent,
            "rng": self.rng.bit_generator.state,
            "state": self.agent.state(),
        }
        return sealed(body)

    def restore(self, ck: dict, config_sha256: str) -> None:
        from .record import check_seal

        if ck.get("schema") != CHECKPOINT_SCHEMA or not ck.get("research_subject"):
            raise ValueError("not a research-subject checkpoint")
        if not check_seal(ck):
            raise ValueError("checkpoint checksum does not match")
        if ck["config_sha256"] != config_sha256 or ck["subject"] != self.name or ck["arm"] != self.arm or ck["seed"] != self.seed:
            raise ValueError("checkpoint belongs to another subject, arm, seed or config")
        self.agent.load(ck["state"])
        self.rng.bit_generator.state = ck["rng"]
        self.visits = int(ck["visits"])
        self.parent = ck["sha256"]


def phases_for(experiment: str, env: dict, interference: list[str], rng, cfg: dict) -> list[dict]:
    """The schedule of one life: which odours are offered, where the food is, for how many visits."""
    ex = cfg["experiments"].get(experiment, {})
    sites = [env[k] for k in ("A", "B", "Asim", "C")]
    if experiment == "relocation":
        f1, f2 = rng.choice(len(sites), size=2, replace=False)
        return [{"name": "learn", "odours": sites, "food": sites[f1], "visits": ex["visits"][0]}, {"name": "relocated", "odours": sites, "food": sites[f2], "visits": ex["visits"][1]}]
    if experiment == "reversal":
        pair = [env["A"], env["B"]]
        first = int(rng.integers(2))
        return [{"name": f"phase{k}", "odours": pair, "food": pair[(first + k) % 2], "visits": ex["visits_per_phase"]} for k in range(ex["phases"])]
    if experiment == "retention":
        f1 = int(rng.integers(len(sites)))
        g = int(rng.integers(len(interference)))
        return [
            {"name": "learn", "odours": sites, "food": sites[f1], "visits": ex["learn_visits"]},
            {"name": "interference", "odours": interference, "food": interference[g], "visits": ex["interference_visits"]},
            {"name": "probe", "odours": sites, "food": None, "visits": ex["probe_visits"], "target": sites[f1]},
        ]
    if experiment == "retention-fresh":
        f1 = int(rng.integers(len(sites)))
        return [{"name": "probe", "odours": sites, "food": None, "visits": cfg["experiments"]["retention"]["probe_visits"], "target": sites[f1]}]
    if experiment == "long-life":
        out, last = [], None
        for b in range(ex["blocks"]):
            f = int(rng.choice([i for i in range(len(sites)) if i != last]))
            out.append({"name": f"block{b}", "odours": sites, "food": sites[f], "visits": ex["visits_per_block"]})
            last = f
        return out
    raise ValueError(experiment)


def trials_to_criterion(choices: list[str], target: str, window: int, need: int) -> int:
    """Visits before the first window of ``window`` visits with at least ``need`` to the target; the phase length if never."""
    hits = np.array([c == target for c in choices], dtype=int)
    for i in range(0, len(choices) - window + 1):
        if hits[i : i + window].sum() >= need:
            return i
    return len(choices)


def state_values(x) -> int:
    """How many numbers a state holds: what must not grow over a life."""
    if isinstance(x, dict):
        return sum(state_values(v) for v in x.values())
    if isinstance(x, (list, tuple)):
        return sum(state_values(v) for v in x)
    return 1


def live(subject: Subject, phases: list[dict], cfg: dict, checkpoint_every_phase: bool = False, config_sha256: str = "", codes: Codes | None = None) -> dict:
    """Runs a life; with ``checkpoint_every_phase`` the subject is saved, rebuilt from the file's contents and restored after every phase."""
    crit = cfg["criterion"]
    out = []
    chain = []
    for ph in phases:
        choices, meals = [], []
        for _ in range(ph["visits"]):
            o, m = subject.visit(ph["odours"], ph["food"])
            choices.append(o)
            meals.append(m)
        row = {"name": ph["name"], "visits": ph["visits"], "meals": int(sum(meals)), "choices_sha256": hashlib.sha256("\n".join(choices).encode()).hexdigest()[:16]}
        target = ph.get("target", ph["food"])
        if target is not None:
            row["to_target"] = int(sum(c == target for c in choices))
            row["trials_to_criterion"] = trials_to_criterion(choices, target, crit["window"], crit["need"])
            row["first_choices_to_target"] = float(np.mean([c == target for c in choices[: crit["probe_first"]]]))
        out.append(row)
        if checkpoint_every_phase:
            ck = json.loads(json.dumps(subject.checkpoint(config_sha256)))  # through text, as a file would be
            fresh = Subject(subject.name, subject.arm, codes, cfg, int(ck["seed"]))
            fresh.restore(ck, config_sha256)
            subject.agent, subject.rng, subject.visits, subject.parent = fresh.agent, fresh.rng, fresh.visits, fresh.parent
            chain.append({"after": ph["name"], "sha256": ck["sha256"], "parent": ck["parent_sha256"], "state_values": state_values(ck["state"]), "bytes": len(json.dumps(ck))})
    return {"phases": out, "checkpoints": chain}


def metrics(experiment: str, life: dict, phases: list[dict]) -> dict:
    p = life["phases"]
    if experiment == "relocation":
        old = phases[0]["food"]
        return {
            "acquisition_ttc": p[0]["trials_to_criterion"],
            "relocation_ttc": p[1]["trials_to_criterion"],
            "meals_per_visit": (p[0]["meals"] + p[1]["meals"]) / (p[0]["visits"] + p[1]["visits"]),
            "perseverative_visits": None,  # filled by run_life, which sees the choices
            "old_site": old,
        }
    if experiment == "reversal":
        t = [x["trials_to_criterion"] for x in p]
        return {"acquisition_ttc": t[0], "reversal_ttc_mean": float(np.mean(t[1:])), "reversals_reached": int(sum(x < y["visits"] for x, y in zip(t[1:], p[1:]))), "meals_per_visit": sum(x["meals"] for x in p) / sum(x["visits"] for x in p)}
    if experiment in ("retention", "retention-fresh"):
        return {"retention_first_choices": p[-1]["first_choices_to_target"], "interference_ttc": p[1]["trials_to_criterion"] if experiment == "retention" else None}
    if experiment == "long-life":
        t = [x["trials_to_criterion"] for x in p]
        n = len(t) // 3
        return {"block_ttc": t, "early_ttc": float(np.mean(t[:n])), "late_ttc": float(np.mean(t[-n:])), "ttc_change": float(np.mean(t[-n:]) - np.mean(t[:n])), "meals_per_visit": sum(x["meals"] for x in p) / sum(x["visits"] for x in p)}
    raise ValueError(experiment)


def run_life(arm: dict, codes: Codes | None, cfg: dict, experiment: str, env: dict, interference: list[str], seed: int, config_sha256: str, restore: bool = False) -> dict:
    """One subject's life, seeded; the schedule draws from its own stream so every arm sees the same world."""
    world = np.random.default_rng(np.random.SeedSequence([seed, zlib.crc32(experiment.encode())]))
    phases = phases_for(experiment, env, interference, world, cfg)
    sub = Subject(f"research-{experiment}-{seed}", arm, codes, cfg, seed)
    # Record every choice for perseveration.
    choices: list[str] = []
    orig = sub.visit

    def visit(odours, food):
        o, m = orig(odours, food)
        choices.append(o)
        return o, m

    sub.visit = visit  # type: ignore[method-assign]
    life = live(sub, phases, cfg, checkpoint_every_phase=restore, config_sha256=config_sha256, codes=codes)
    m = metrics(experiment, life, phases)
    if experiment == "relocation":
        n0 = phases[0]["visits"]
        old = m.pop("old_site")
        m["perseverative_visits"] = int(sum(c == old for c in choices[n0 : n0 + cfg["experiments"]["relocation"]["perseveration_window"]]))
    return {"seed": seed, "metrics": m, "life": life, "choices_sha256": hashlib.sha256("\n".join(choices).encode()).hexdigest()}


def bootstrap_ci(x, rng, n: int = 2000, level: float = 0.95) -> list[float] | None:
    x = np.asarray([v for v in x if v is not None], dtype=float)
    if x.size == 0:
        return None
    means = rng.choice(x, size=(n, x.size), replace=True).mean(axis=1)
    return [float(np.quantile(means, (1 - level) / 2)), float(np.quantile(means, 1 - (1 - level) / 2))]


def build_codes(cfg_path: Path, compiled: Path, results: Path, out: Path, log=print) -> dict:
    """The full model's KC and PAM responses to every odour of the config, under each representation."""
    cfg = json.loads(Path(cfg_path).read_text(encoding="utf-8"))
    c = cx.load(compiled)
    base = lif.Network(c)
    g = Groups.from_annotations(c, cfg["dan_mbon_min_synapses"])
    syn = Synapses(base, g)
    reps = {"dense": (Representation(), {"file": None})}
    for name, f in cfg["representations"].items():
        data = load_sealed(results / f, RESULT_SCHEMA)
        reps[name] = (Representation(**data["selected"]["representation"]), {"file": f, "sha256": data["sha256"], "label": data["selected"]["label"]})
    odours = cfg["odours"]
    names = sorted(odours)
    ref = g.odour(cfg["rate_reference"]).size
    proto = cfg["protocol"]
    kc_out, pam_out = {}, {}
    with Meter() as meter:
        for rname, (rep, _) in reps.items():
            net = copy.copy(base)
            net.weight = apply(base, g, rep)
            K = np.zeros((len(names), proto["trials"], g.kc.size), dtype=np.int16)
            D = np.zeros((len(names), proto["trials"], g.pam.size), dtype=np.int16)
            for oi, o in enumerate(names):
                idx = g.odour(odours[o])
                rate = float(min(proto["odour_rate_cap_hz"], proto["odour_rate_hz"] * ref / max(1, idx.size)))
                rng = np.random.default_rng(np.random.SeedSequence([int(cfg["codes_seed"]), zlib.crc32(rname.encode()), zlib.crc32(o.encode())]))
                for t in range(proto["trials"]):
                    tr, _ = lif.run(net, lif.Stimulus(poisson=[lif.Poisson(idx, rate, label=o)]), proto["trial_ms"], rng=rng)
                    K[oi, t] = tr.counts[g.kc]
                    D[oi, t] = tr.counts[g.pam]
                log(f"  {rname} {o}: coding {float((K[oi] > 0).mean()):.3f}, PAM {int(D[oi].sum())}")
            kc_out[rname], pam_out[rname] = K, D
    codes = Codes(names, kc_out, pam_out, syn.row, syn.col, syn.w0, syn.reach > 0, {
        "schema": "fly-neural-adaptive-codes/v1",
        "config_file": Path(cfg_path).name,
        "config_sha256": hashlib.sha256(Path(cfg_path).read_bytes().replace(b"\r\n", b"\n")).hexdigest(),
        "representations": {k: v[1] | {"representation": v[0].__dict__} for k, v in reps.items()},
        "connectome": {"path_name": Path(compiled).name, "manifest_sha256": c.manifest.get("sha256")},
        "resources": {**meter.describe(), "machine": machine()},
        "licence": "Derived from FlyWire v783 (CC BY-NC 4.0); kept under .fly-neural/, never committed.",
    })
    digest = codes.save(out)
    log(f"wrote {out} ({digest[:12]})")
    return codes.meta


def code_summary(codes: Codes) -> dict:
    out = {}
    for rep, K in codes.kc.items():
        act = K[:, 0, :] > 0
        jac = lambda a, b: float((a & b).sum() / max(1, (a | b).sum()))  # noqa: E731
        out[rep] = {"coding_level": {o: float(act[i].mean()) for i, o in enumerate(codes.odours)}, "jaccard": {f"{a}|{b}": jac(act[i], act[j]) for i, a in enumerate(codes.odours) for j, b in enumerate(codes.odours) if i < j}}
    return out


def run(cfg_path: Path, split: str, codes_path: Path, out_dir: Path, log=print) -> dict:
    code = code_watch(out_dir)
    cfg = json.loads(Path(cfg_path).read_text(encoding="utf-8"))
    if cfg.get("schema") != SCHEMA:
        raise ValueError(f"{cfg_path} is not a {SCHEMA} file")
    config_sha256 = hashlib.sha256(Path(cfg_path).read_bytes().replace(b"\r\n", b"\n")).hexdigest()
    codes = Codes.load(codes_path)
    if codes.meta["config_sha256"] != config_sha256:
        raise RuntimeError("the codes were built from another version of the config")
    codes = codes.with_random("sparse", int(cfg["random_code_seed"]))
    envs = cfg["environments"][split]
    seeds = [int(cfg["seeds"][split]) + k for k in range(cfg["subjects"][split])]
    results: dict = {}
    t0 = time.monotonic()
    with Meter() as meter:
        for experiment in cfg["run_experiments"]:
            results[experiment] = {}
            only = cfg["experiments"].get(experiment, {}).get("arms")
            for arm in cfg["arms"]:
                if only and arm["name"] not in only:
                    continue
                rows = []
                for k, s in enumerate(seeds):
                    env = cfg["odour_sets"][envs[k % len(envs)]]
                    rows.append(run_life(arm, codes, cfg, experiment, env, cfg["interference"], s, config_sha256, restore=experiment == "long-life"))
                    if experiment == "long-life":
                        # The same life with no checkpoints: continuation must be exact.
                        straight = run_life(arm, codes, cfg, experiment, env, cfg["interference"], s, config_sha256, restore=False)
                        rows[-1]["restored_equals_uninterrupted"] = straight["choices_sha256"] == rows[-1]["choices_sha256"]
                results[experiment][arm["name"]] = summarise(rows, np.random.default_rng(int(cfg["seeds"][split]) + 99))
                log(f"  {split} {experiment} {arm['name']}: {json.dumps({k: v['mean'] for k, v in results[experiment][arm['name']]['metrics'].items()})}")
    verdicts = [judge(cr, results) for cr in cfg["criteria"] if cr.get("split", split) == split]
    body = {
        "schema": RESULT_SCHEMA,
        "kind": "adaptive-life",
        "experiment": cfg["id"],
        "config_file": Path(cfg_path).name,
        "config_sha256": config_sha256,
        "split": split,
        "subjects": len(seeds),
        "codes": {"npz_sha256": codes.meta["npz_sha256"], "representations": codes.meta["representations"], "connectome": codes.meta["connectome"], "summary": code_summary(codes)},
        "results": results,
        "criteria": verdicts,
        "failed": [v["id"] for v in verdicts if not v["passed"]],
        "resources": {**meter.describe(), "wall_s": round(time.monotonic() - t0, 2), "machine": machine()},
        "environment": environment(),
        "code": code(),
    }
    data = sealed(body)
    write_json(out_dir / f"{cfg['id']}-{split}.json", data)
    log(f"wrote {out_dir / (cfg['id'] + '-' + split + '.json')}; failed {data['failed']}")
    return data


def summarise(rows: list[dict], rng) -> dict:
    keys = [k for k, v in rows[0]["metrics"].items() if isinstance(v, (int, float)) or v is None]
    out = {"metrics": {}, "subjects": [{"seed": r["seed"], "metrics": r["metrics"], "choices_sha256": r["choices_sha256"], **({"checkpoints": r["life"]["checkpoints"], "restored_equals_uninterrupted": r["restored_equals_uninterrupted"]} if "restored_equals_uninterrupted" in r else {})} for r in rows]}
    for k in keys:
        vals = [r["metrics"][k] for r in rows if r["metrics"][k] is not None]
        out["metrics"][k] = {"mean": float(np.mean(vals)) if vals else None, "ci95": bootstrap_ci(vals, rng), "values": vals}
    return out


def judge(cr: dict, results: dict) -> dict:
    v = {"id": cr["id"], "claim": cr["claim"], "test": cr["test"]}
    ex = results.get(cr["experiment"], {})
    vals = lambda arm, e=ex: e[arm]["metrics"][cr["field"]]["values"] if arm in e else []  # noqa: E731
    t = cr["test"]
    if t in ("mw_less", "mw_greater"):
        a, b = vals(cr["a"]), vals(cr["b"], results.get(cr.get("b_experiment", cr["experiment"]), {}))
        mw = stats.mann_whitney(a, b, "less" if t == "mw_less" else "greater") if a and b else {"p": 1.0}
        v.update(mean_a=float(np.mean(a)) if a else None, mean_b=float(np.mean(b)) if b else None, mann_whitney=mw, passed=bool(a and b) and mw["p"] < cr["alpha"])
    elif t in ("mean_at_least", "mean_at_most"):
        a = vals(cr["arm"])
        m = float(np.mean(a)) if a else None
        v.update(mean=m, passed=m is not None and (m >= cr["value"] if t == "mean_at_least" else m <= cr["value"]))
    elif t == "fraction_at_least":
        a = vals(cr["arm"])
        frac = float(np.mean([x >= cr["each_at_least"] for x in a])) if a else None
        v.update(fraction=frac, passed=frac is not None and frac >= cr["fraction"])
    elif t == "all_restored_exact":
        subs = ex[cr["arm"]]["subjects"]
        ok = [s["restored_equals_uninterrupted"] for s in subs]
        sizes = sorted({c["state_values"] for s in subs for c in s["checkpoints"]})
        chained = all(s["checkpoints"][k]["parent"] == (s["checkpoints"][k - 1]["sha256"] if k else None) for s in subs for k in range(len(s["checkpoints"])))
        v.update(exact=int(sum(ok)), of=len(ok), state_values_range=[sizes[0], sizes[-1]], provenance_chained=chained, passed=all(ok) and chained and sizes[-1] == sizes[0])
    elif t == "report_only":
        v.update(passed=True, note="reported, not judged")
    else:
        raise ValueError(t)
    return v
