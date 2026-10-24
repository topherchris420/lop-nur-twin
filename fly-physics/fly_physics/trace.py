"""Reading a `fly-physics-trace/v1` written by scripts/fly-physics-trace.ts.

The trace is the browser fly's walking plan on FlyBody's 2 ms control clock:
the thorax path, each leg's stance or swing, the joint and tendon targets the
pose solver gives FlyBody's leg actuators, and the claw positions that pose
puts in the thorax frame. It is checked strictly before anything runs on it,
and identified by the SHA-256 of the file's bytes.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from . import TRACE_SCHEMA

LEGS = ("T1_left", "T2_left", "T3_left", "T1_right", "T2_right", "T3_right")
CONTROL_DT_S = 0.002


class TraceError(ValueError):
    """The file is not a usable fly-physics-trace/v1."""


@dataclass(frozen=True)
class Trace:
    path: Path
    file_sha256: str
    body_sha256: str
    scenario: dict
    fly: dict
    engine: dict
    legs: tuple[str, ...]
    actuators: tuple[str, ...]
    t: np.ndarray  # (n,) s
    thorax: np.ndarray  # (n, 4): x, y, z (cm), heading turned since the start (rad)
    stance: np.ndarray  # (n, 6) bool, in `legs` order
    targets: np.ndarray  # (n, len(actuators)) rad
    claws: np.ndarray  # (n, 6, 3) cm, thorax frame
    walk_speed_cms: np.ndarray
    yaw_rate: np.ndarray

    @property
    def id(self) -> str:
        return self.scenario["id"]

    @property
    def duration_s(self) -> float:
        return float(self.t[-1])

    def describe(self) -> dict:
        """What a result records about the plan it ran."""
        return {
            "id": self.id,
            "description": self.scenario["description"],
            "file_sha256": self.file_sha256,
            "sha256": self.body_sha256,
            "fly_version": self.fly["version"],
            "fly_source_sha256": self.fly["source_sha256"],
            "controller": self.fly["controller"],
            "engine": dict(self.engine),
            "samples": int(self.t.shape[0]),
        }


def load(path: Path) -> Trace:
    data = path.read_bytes()
    try:
        raw = json.loads(data)
    except json.JSONDecodeError as e:
        raise TraceError(f"{path} is not JSON: {e}") from e
    if not isinstance(raw, dict) or raw.get("schema") != TRACE_SCHEMA:
        raise TraceError(f"{path} is not a {TRACE_SCHEMA}")
    legs = tuple(raw["legs"])
    if legs != LEGS:
        raise TraceError(f"{path} lists the legs as {legs}, expected {LEGS}")
    if raw["sampling"]["dt_s"] != CONTROL_DT_S:
        raise TraceError(f"{path} is not sampled every {CONTROL_DT_S} s")
    if raw["fly"]["gate_refusals"] != 0:
        raise TraceError(f"{path}: the fly's gate refused commands while the plan ran")
    s = raw["samples"]
    n = int(raw["sampling"]["count"])
    actuators = tuple(raw["actuators"])
    t = np.asarray(s["t"], dtype=float)
    thorax = np.asarray(s["thorax"], dtype=float)
    stance = np.asarray(s["stance"], dtype=int)
    targets = np.asarray(s["targets"], dtype=float)
    claws = np.asarray(s["claws"], dtype=float)
    shapes = {
        "t": (t.shape, (n,)),
        "thorax": (thorax.shape, (n, 4)),
        "stance": (stance.shape, (n, 6)),
        "targets": (targets.shape, (n, len(actuators))),
        "claws": (claws.shape, (n, 18)),
    }
    for name, (got, want) in shapes.items():
        if got != want:
            raise TraceError(f"{path}: {name} has shape {got}, expected {want}")
    if not np.allclose(np.diff(t), CONTROL_DT_S, atol=1e-9) or t[0] != 0:
        raise TraceError(f"{path}: samples are not every {CONTROL_DT_S} s from 0")
    for name, arr in (("thorax", thorax), ("targets", targets), ("claws", claws)):
        if not np.all(np.isfinite(arr)):
            raise TraceError(f"{path}: {name} holds a value that is not finite")
    if not np.isin(stance, (0, 1)).all():
        raise TraceError(f"{path}: stance flags are not 0 or 1")
    return Trace(
        path=path,
        file_sha256=hashlib.sha256(data).hexdigest(),
        body_sha256=raw["sha256"],
        scenario=raw["scenario"],
        fly=raw["fly"],
        engine=raw["engine"],
        legs=legs,
        actuators=actuators,
        t=t,
        thorax=thorax,
        stance=stance.astype(bool),
        targets=targets,
        claws=claws.reshape(n, 6, 3),
        walk_speed_cms=np.asarray(s["walk_speed_cms"], dtype=float),
        yaw_rate=np.asarray(s["yaw_rate"], dtype=float),
    )
