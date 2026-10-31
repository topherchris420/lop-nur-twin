"""From what the digital fly senses to Poisson rates on identified sensory neurons, and back out to motor readouts.

Only sensable observations enter. ``observation()`` takes one decision's
input as ``scripts/echo-neural-shadow.ts`` records it and keeps only the
fields listed in ``SENSABLE``; everything else the simulator knows — the
looming object's id, kind and distance, the giant-fiber proxy ECHO computes
from it, the fly's position, velocity and heading, landing sites, landmark
ids, the kind of food underfoot — is dropped, and ``observation`` refuses a
record that tries to pass any of those in under a sensable name.

Each mapping names the population it drives, the paper that identified that
population's preferred stimulus, and the functional form, whose constants are
model choices (``status: "model"``), not fits. None of them was tuned on the
ECHO comparison.

Two mappings, named in every run that uses them:

- ``v1`` (the default, and the one every sealed shadow result used): five
  channels in, two readouts out (feed, escape), each readout over the window
  of one request.
- ``whole-brain/v2``, for ``neural-experimental`` research subjects only: v1's
  channels plus a small moving object (the other fly) on LC11 and LC10a, and
  more of the brain's descending commands read out (walking, steering,
  stopping, antennal grooming, landing), each rate readout over a trailing
  window rather than one 10 ms step (the window that limited v1's feed
  readout). v1 stays byte for byte what it was.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass

import numpy as np

from .connectome import Connectome
from .populations import CITE, resolve

MAPPINGS = ("v1", "whole-brain/v2")

SENSABLE = {
    "looming": "the strongest looming object, as angular size (deg), expansion rate (deg/s) and bearing (+ left, rad), or null",
    "airflow": "air speed past the antennae (m/s)",
    "airflowFrom": "bearing the air comes from (+ left, rad), or null",
    "odour": "food odour at the antennae (relative units)",
    "onFood": "whether the tarsi touch food (a boolean; what food it is is dropped)",
    "smallObject": "whole-brain/v2 only: the object on the eye, as angular size (deg), angular speed across the eye (deg/s) and bearing (+ left, rad), or null",
}
SMALL_OBJECT_FIELDS = ("sizeDeg", "speedDegS", "bearing")
GROUND_TRUTH = ("id", "kind", "distance", "drive", "p", "v", "yaw", "sites", "landmarks", "target", "home")


class ObservationError(ValueError):
    pass


def observation(rec: dict) -> dict:
    """The sensable part of one recorded decision input. Raises on anything else."""
    unknown = set(rec) - set(SENSABLE)
    if unknown:
        raise ObservationError(f"not sensable here: {sorted(unknown)}")
    loom = rec.get("looming")
    if loom is not None:
        extra = set(loom) - {"sizeDeg", "expansionDegS", "bearing"}
        if extra:
            raise ObservationError(f"looming carries more than the eye sees: {sorted(extra)}")
    if not isinstance(rec.get("onFood", False), bool):
        raise ObservationError("onFood must be a boolean: the kind of food is not passed in")
    small = rec.get("smallObject")
    if small is not None:
        if not isinstance(small, dict):
            raise ObservationError("smallObject must be an object or null")
        if set(small) != set(SMALL_OBJECT_FIELDS):
            raise ObservationError(f"smallObject carries exactly {list(SMALL_OBJECT_FIELDS)}, not {sorted(small)}")
    out = {
        "looming": None if loom is None else {k: float(loom[k]) for k in ("sizeDeg", "expansionDegS", "bearing")},
        "airflow": float(rec.get("airflow", 0.0)),
        "airflowFrom": None if rec.get("airflowFrom") is None else float(rec["airflowFrom"]),
        "odour": float(rec.get("odour", 0.0)),
        "onFood": bool(rec.get("onFood", False)),
    }
    if small is not None:
        out["smallObject"] = {k: float(small[k]) for k in SMALL_OBJECT_FIELDS}
    return out


@dataclass(frozen=True)
class Channel:
    key: str
    populations: tuple[str, ...]
    form: str
    cite: tuple[str, ...]
    status: str
    approximation: str


CHANNELS = (
    Channel(
        "looming size",
        ("lplc2_left", "lplc2_right"),
        "rate = 200 Hz * min(1, sizeDeg / 40) on the side the object is on (bearing > 0: left)",
        ("klapoetke2017", "vonreyn2017", "ache2019"),
        "model",
        "LPLC2 encodes angular size; the 40 deg saturation and 200 Hz ceiling are ours",
    ),
    Channel(
        "looming expansion",
        ("lc4_left", "lc4_right"),
        "rate = 200 Hz * min(1, expansionDegS / 400) on the object's side",
        ("vonreyn2017", "ache2019"),
        "model",
        "LC4 encodes angular velocity; the 400 deg/s saturation is ours",
    ),
    Channel(
        "airflow",
        ("jo_wind_left", "jo_wind_right"),
        "rate = 150 Hz * min(1, airflow / 1 m/s) on both antennae",
        ("yorozu2009", "kamikouchi2009"),
        "model",
        "JO-C/E respond to sustained antennal deflection; direction is not encoded here",
    ),
    Channel(
        "food odour",
        ("orn_vinegar_left", "orn_vinegar_right"),
        "rate = 100 Hz * min(1, odour) on both antennae",
        ("semmelhack2009",),
        "model",
        "exploratory: the world's one food-odour level stands for vinegar-like odour at DM1 and VA2 ORNs",
    ),
    Channel(
        "food contact",
        ("sugar_grn_left", "sugar_grn_right"),
        "rate = 100 Hz while on food, else 0",
        ("tastekin2026", "shiu2024"),
        "model",
        "the fly tastes with its tarsi, whose GRNs project to the ventral nerve cord, outside this brain; labellar sugar GRNs stand in for them",
    ),
)

READOUTS = {
    "feed": {"populations": ("mn9_left", "mn9_right"), "rule": "mean MN9 rate >= 10 Hz over the window", "threshold_hz": 10.0, "cite": ("gordon2009", "shiu2024")},
    "escape": {"populations": ("giant_fiber_left", "giant_fiber_right"), "rule": "any giant-fiber spike in the window", "threshold_hz": None, "cite": ("vonreyn2014",)},
}

SMALL_OBJECT = Channel(
    "small moving object",
    ("lc11_left", "lc11_right", "lc10a_left", "lc10a_right"),
    "rate = 150 Hz * min(1, |speedDegS| / 100) * size weight, on the object's side; size weight 1 up to 15 deg, falling linearly to 0 at 30 deg",
    ("keles2017", "ribeiro2018"),
    "model",
    "LC11 and LC10 prefer small objects moving on the eye and ignore wide-field motion; the 100 deg/s saturation, the size window and the ceiling are ours; "
    "contrast is not modelled (LC11 was shown with dark objects); the angular speed is the bearing's change between samples, which includes the fly's own turning; "
    "LC10's role was shown in males and this brain is a female's",
)
CHANNELS_V2 = CHANNELS + (SMALL_OBJECT,)

# Readouts over a trailing window (``rate_window_ms``). Escape stays one request's window: it is a reflex.
READOUTS_V2 = {
    "feed": {**READOUTS["feed"], "rule": "mean MN9 rate >= 10 Hz over the trailing window"},
    "escape": READOUTS["escape"],
    "walk": {"populations": ("dnp09_left", "dnp09_right"), "rule": "mean DNp09 rate >= 10 Hz over the trailing window", "threshold_hz": 10.0, "cite": ("bidaye2020",)},
    "backward": {"populations": ("mdn_left", "mdn_right"), "rule": "mean MDN rate >= 10 Hz over the trailing window", "threshold_hz": 10.0, "cite": ("bidaye2014",)},
    "groom": {"populations": ("adn_left", "adn_right"), "rule": "mean aDN1/aDN2 rate >= 10 Hz over the trailing window", "threshold_hz": 10.0, "cite": ("hampel2015", "shiu2024")},
    "land": {"populations": ("dn_landing_left", "dn_landing_right"), "rule": "mean DNp07/DNp10 rate >= 10 Hz over the trailing window", "threshold_hz": 10.0, "cite": ("ache2019nn",)},
    "turn": {
        "populations": ("dna02_left", "dna02_right"),
        "rule": "left minus right DNa02 rate over the trailing window; a turn toward the more active side when the difference is >= 10 Hz",
        "threshold_hz": 10.0,
        "cite": ("rayshubskiy2020",),
    },
}
RATE_WINDOW_MS = 100.0
SMALL_SIZE_FULL_DEG, SMALL_SIZE_ZERO_DEG, SMALL_SPEED_SAT_DEG_S, SMALL_CEILING_HZ = 15.0, 30.0, 100.0, 150.0


def channels(mapping: str = "v1") -> tuple[Channel, ...]:
    return CHANNELS if mapping == "v1" else CHANNELS_V2


def readouts(mapping: str = "v1") -> dict:
    return READOUTS if mapping == "v1" else READOUTS_V2


def check_mapping(mapping: str) -> str:
    if mapping not in MAPPINGS:
        raise ObservationError(f"unknown mapping {mapping!r}; one of {list(MAPPINGS)}")
    return mapping


def describe_mapping(mapping: str = "v1") -> dict:
    out = {
        "sensable_fields": SENSABLE if mapping != "v1" else {k: v for k, v in SENSABLE.items() if k != "smallObject"},
        "dropped_ground_truth": list(GROUND_TRUTH),
        "channels": [
            {"key": ch.key, "populations": list(ch.populations), "form": ch.form, "status": ch.status, "approximation": ch.approximation, "cite": [CITE[k] for k in ch.cite]}
            for ch in channels(mapping)
        ],
        "readouts": {k: {**v, "populations": list(v["populations"]), "cite": [CITE[c] for c in v["cite"]]} for k, v in readouts(mapping).items()},
    }
    # v1's description stays exactly what the sealed shadow results recorded.
    if mapping != "v1":
        out = {"mapping": mapping, "rate_window_ms": RATE_WINDOW_MS, **out, "descending_summary": "how many neurons annotated descending fired in the trailing window (reported, decides nothing)"}
    return out


def small_object_rate(obj: dict | None) -> float:
    """The small-object channel's rate (Hz) for one observation's ``smallObject``."""
    if obj is None:
        return 0.0
    size = max(0.0, obj["sizeDeg"])
    if size >= SMALL_SIZE_ZERO_DEG:
        return 0.0
    weight = 1.0 if size <= SMALL_SIZE_FULL_DEG else 1.0 - (size - SMALL_SIZE_FULL_DEG) / (SMALL_SIZE_ZERO_DEG - SMALL_SIZE_FULL_DEG)
    return SMALL_CEILING_HZ * min(1.0, abs(obj["speedDegS"]) / SMALL_SPEED_SAT_DEG_S) * weight


class Mapper:
    """Resolves the populations once, then turns observations into Poisson inputs."""

    def __init__(self, c: Connectome, mapping: str = "v1"):
        self.mapping = check_mapping(mapping)
        keys = {p for ch in channels(mapping) for p in ch.populations} | {p for r in readouts(mapping).values() for p in r["populations"]}
        if mapping != "v1":
            keys.add("descending_all")
        self.idx = {}
        self.report = {}
        for k in sorted(keys):
            self.idx[k], self.report[k] = resolve(k, c)

    def rates(self, obs: dict) -> dict[str, float]:
        if self.mapping == "v1" and obs.get("smallObject") is not None:
            raise ObservationError("smallObject is a whole-brain/v2 input; mapping v1 has no channel for it")
        r = {k: 0.0 for ch in channels(self.mapping) for k in ch.populations}
        if self.mapping != "v1" and obs.get("smallObject") is not None:
            side = "left" if obs["smallObject"]["bearing"] > 0 else "right"
            r[f"lc11_{side}"] = r[f"lc10a_{side}"] = small_object_rate(obs["smallObject"])
        loom = obs["looming"]
        if loom is not None:
            side = "left" if loom["bearing"] > 0 else "right"
            r[f"lplc2_{side}"] = 200.0 * min(1.0, max(0.0, loom["sizeDeg"]) / 40.0)
            r[f"lc4_{side}"] = 200.0 * min(1.0, max(0.0, loom["expansionDegS"]) / 400.0)
        air = 150.0 * min(1.0, max(0.0, obs["airflow"]) / 1.0)
        r["jo_wind_left"] = r["jo_wind_right"] = air
        od = 100.0 * min(1.0, max(0.0, obs["odour"]))
        r["orn_vinegar_left"] = r["orn_vinegar_right"] = od
        if obs["onFood"]:
            r["sugar_grn_left"] = r["sugar_grn_right"] = 100.0
        return r

    def poisson(self, obs: dict):
        """Every channel's population, at its rate for ``obs`` (0 included): the
        sensory neurons are Poisson-input neurons throughout a run, so their
        refractory period is 0 from the start, as Shiu et al.'s ``poi()`` sets it."""
        from .lif import Poisson

        return [Poisson(self.idx[k], rate, label=k) for k, rate in self.rates(obs).items() if self.idx[k].size]

    def decode(self, counts: np.ndarray, window_ms: float) -> dict:
        out = {}
        for key, ro in READOUTS.items():
            idx = np.concatenate([self.idx[p] for p in ro["populations"]])
            spikes = int(counts[idx].sum())
            rate = spikes / max(1, idx.size) / (window_ms / 1000.0)
            fired = rate >= ro["threshold_hz"] if ro["threshold_hz"] is not None else spikes > 0
            out[key] = {"spikes": spikes, "mean_rate_hz": round(rate, 3), "predicted": bool(fired)}
        return out


class TrailingReadout:
    """whole-brain/v2 readouts over a trailing window, for a run asked every few ms (``serve``).

    ``idx`` maps a population key to its connectome indices (``Mapper.idx``).
    Escape is read from the newest request's window only, as v1 reads it: it is
    a reflex. Every other readout sums the spikes of the requests that fall in
    the last ``window_ms``. ``descending`` counts the distinct neurons
    annotated descending that fired in that window; it is reported and decides
    nothing."""

    def __init__(self, idx: dict[str, np.ndarray], window_ms: float = RATE_WINDOW_MS):
        if not 10.0 <= window_ms <= 1000.0:
            raise ObservationError("rate_window_ms must be between 10 and 1000")
        self.idx = idx
        self.window_ms = float(window_ms)
        self.keys = sorted({p for r in READOUTS_V2.values() for p in r["populations"]})
        self.dn = np.asarray(idx.get("descending_all", np.zeros(0, dtype=np.int64)), dtype=np.int64)
        self.hist: deque[tuple[float, dict[str, int], np.ndarray]] = deque()

    def update(self, counts: np.ndarray, window_ms: float) -> dict:
        spikes = {k: int(counts[self.idx[k]].sum()) for k in self.keys}
        self.hist.append((window_ms, spikes, self.dn[counts[self.dn] > 0] if self.dn.size else self.dn))
        span = sum(w for w, _, _ in self.hist)
        while len(self.hist) > 1 and span - self.hist[0][0] >= self.window_ms:
            span -= self.hist.popleft()[0]
        total = {k: sum(s[k] for _, s, _ in self.hist) for k in self.keys}
        size = {k: int(self.idx[k].size) for k in self.keys}

        def rate(pops):
            n = sum(size[p] for p in pops)
            return sum(total[p] for p in pops) / max(1, n) / (span / 1000.0) if span > 0 else 0.0

        out = {}
        for key, ro in READOUTS_V2.items():
            pops = ro["populations"]
            if key == "escape":
                s, n = sum(spikes[p] for p in pops), sum(size[p] for p in pops)
                hz = s / max(1, n) / (window_ms / 1000.0) if window_ms > 0 else 0.0
                out[key] = {"spikes": s, "mean_rate_hz": round(hz, 3), "predicted": s > 0}
            elif key == "turn":
                left, right = rate(pops[:1]), rate(pops[1:])
                diff = left - right
                out[key] = {
                    "left_hz": round(left, 3),
                    "right_hz": round(right, 3),
                    "predicted": abs(diff) >= ro["threshold_hz"],
                    "direction": "left" if diff > 0 else "right" if diff < 0 else None,
                }
            else:
                r = rate(pops)
                out[key] = {"spikes": sum(total[p] for p in pops), "mean_rate_hz": round(r, 3), "predicted": r >= ro["threshold_hz"]}
        fired_dn = np.unique(np.concatenate([d for _, _, d in self.hist])) if self.hist else self.dn[:0]
        out["descending"] = {"active": int(fired_dn.size), "of": int(self.dn.size)}
        out["window_ms"] = round(span, 3)
        return out

