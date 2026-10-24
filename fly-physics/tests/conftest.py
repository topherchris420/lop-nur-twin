import json
import sys
from pathlib import Path

import numpy as np
import pytest

PACKAGE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PACKAGE))

from fly_physics import TRACE_SCHEMA
from fly_physics.trace import LEGS

ACTUATORS = [
    f"{j}_{leg}"
    for leg in LEGS
    for j in (
        "coxa_abduct",
        "coxa_twist",
        "coxa",
        "femur_twist",
        "femur",
        "tibia",
        "tarsus",
        "tarsus2",
    )
]


def synthetic_trace(path: Path, n: int = 501, speed_cms: float = 2.0) -> Path:
    """A fly-physics-trace/v1 walking straight at `speed_cms`, every leg always in stance."""
    t = [round(k * 0.002, 6) for k in range(n)]
    body = {
        "schema": TRACE_SCHEMA,
        "scenario": {
            "id": "synthetic",
            "description": "a test plan",
            "walkSpeedCmS": speed_cms,
            "yawRate": 0,
            "durationS": t[-1],
            "seed": 1,
        },
        "fly": {
            "version": "test",
            "source_sha256": "0" * 64,
            "controller": "test",
            "physics_step_s": 0.005,
            "standing_height_cm": 0.1,
            "gate_refusals": 0,
        },
        "engine": {"runtime": "test", "version": "0"},
        "frame": "test",
        "sampling": {"dt_s": 0.002, "count": n, "interpolation": "test"},
        "legs": list(LEGS),
        "actuators": ACTUATORS,
        "samples": {
            "t": t,
            "thorax": [[speed_cms * x, 0.0, 0.1, 0.0] for x in t],
            "mode": ["walk"] * n,
            "walk_speed_cms": [speed_cms] * n,
            "yaw_rate": [0.0] * n,
            "gait_clock": [0.0] * n,
            "stance": [[1] * 6] * n,
            "targets": [[0.0] * len(ACTUATORS)] * n,
            "claws": [[0.0] * 18] * n,
        },
        "sha256": "0" * 64,
    }
    path.write_text(json.dumps(body))
    return path


@pytest.fixture
def trace_file(tmp_path: Path) -> Path:
    return synthetic_trace(tmp_path / "synthetic.json")


@pytest.fixture
def rng() -> np.random.Generator:
    return np.random.default_rng(0)
