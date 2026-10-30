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
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .connectome import Connectome
from .populations import CITE, resolve

SENSABLE = {
    "looming": "the strongest looming object, as angular size (deg), expansion rate (deg/s) and bearing (+ left, rad), or null",
    "airflow": "air speed past the antennae (m/s)",
    "airflowFrom": "bearing the air comes from (+ left, rad), or null",
    "odour": "food odour at the antennae (relative units)",
    "onFood": "whether the tarsi touch food (a boolean; what food it is is dropped)",
}
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
    return {
        "looming": None if loom is None else {k: float(loom[k]) for k in ("sizeDeg", "expansionDegS", "bearing")},
        "airflow": float(rec.get("airflow", 0.0)),
        "airflowFrom": None if rec.get("airflowFrom") is None else float(rec["airflowFrom"]),
        "odour": float(rec.get("odour", 0.0)),
        "onFood": bool(rec.get("onFood", False)),
    }


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


def describe_mapping() -> dict:
    return {
        "sensable_fields": SENSABLE,
        "dropped_ground_truth": list(GROUND_TRUTH),
        "channels": [
            {"key": ch.key, "populations": list(ch.populations), "form": ch.form, "status": ch.status, "approximation": ch.approximation, "cite": [CITE[k] for k in ch.cite]}
            for ch in CHANNELS
        ],
        "readouts": {k: {**v, "populations": list(v["populations"]), "cite": [CITE[c] for c in v["cite"]]} for k, v in READOUTS.items()},
    }


class Mapper:
    """Resolves the populations once, then turns observations into Poisson inputs."""

    def __init__(self, c: Connectome):
        keys = {p for ch in CHANNELS for p in ch.populations} | {p for r in READOUTS.values() for p in r["populations"]}
        self.idx = {}
        self.report = {}
        for k in sorted(keys):
            self.idx[k], self.report[k] = resolve(k, c)

    def rates(self, obs: dict) -> dict[str, float]:
        r = {k: 0.0 for ch in CHANNELS for k in ch.populations}
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

