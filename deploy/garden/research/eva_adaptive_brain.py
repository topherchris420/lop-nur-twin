"""Optional, versioned learning extension for Eva's authoritative garden service.

The live server.py and learning.py are on Eva's VM, not in this repository.
This module is a real, testable *sidecar*: it can learn from Eva's public
observations without changing her original brain, memory or database. It never
issues a control command unless an operator explicitly wires `recommend`
into the authoritative server and sets active=True after an audited backup.

No claimed behavioural benefit or claim of consciousness follows from this.
"""

from __future__ import annotations

import json
import math
import os
from pathlib import Path
from typing import Any

VERSION = "eva-contextual-plasticity/v1"
ACTIONS = ("fly", "walk", "rest", "groom")
MAX_RECENT = 48
MAX_EVIDENCE = 1024


def _fresh() -> dict[str, Any]:
    return {
        "schema": VERSION,
        "life_id": None,
        "last_trial_at": None,
        "contexts": {},
        "recent": [],
        "samples": 0,
        "recommendations": 0,
    }


def _context(state: dict[str, Any]) -> str | None:
    """Read only published interoception and weather, never hidden world state."""
    needs = state.get("needs")
    weather = state.get("weather")
    if not isinstance(needs, dict) or not isinstance(weather, dict):
        return None
    energy, water, day = needs.get("energy"), needs.get("water"), weather.get("is_day")
    if not all(isinstance(x, (int, float)) and math.isfinite(x) for x in (energy, water)):
        return None
    if not isinstance(day, bool):
        return None
    if energy < 0.35 or water < 0.25:
        return "depleted"
    return "day" if day else "night"


class EvaAdaptiveBrain:
    """Bounded success models for actions, scoped to Eva's immutable life ID."""

    def __init__(self, state: dict[str, Any] | None = None) -> None:
        value = json.loads(json.dumps(state)) if state is not None else _fresh()
        if value.get("schema") != VERSION:
            raise ValueError("unknown Eva brain version")
        if not isinstance(value.get("contexts"), dict) or not isinstance(value.get("recent"), list):
            raise ValueError("invalid Eva learning state")
        self.state = value

    def ingest_observation(self, state: dict[str, Any]) -> bool:
        """Learn once from a genuine reported trial, never from repeated polls."""
        identity = state.get("life_id")
        if not isinstance(identity, str) or not identity:
            raise ValueError("garden observation has no life identity")
        prior_id = self.state["life_id"]
        if prior_id is not None and prior_id != identity:
            raise ValueError("refused to merge observations from a different fly")
        self.state["life_id"] = identity
        context = _context(state)
        learning = state.get("learning")
        trial = learning.get("last") if isinstance(learning, dict) else None
        if not isinstance(trial, dict) or context is None:
            return False
        action, success, at = trial.get("action"), trial.get("success"), trial.get("at")
        if action not in ACTIONS or not isinstance(success, bool):
            return False
        if not isinstance(at, (float, int)) or isinstance(at, bool) or not math.isfinite(at):
            return False
        last = self.state["last_trial_at"]
        if last is not None and at <= last:
            return False
        self.state["last_trial_at"] = at
        counters = self.state["contexts"].setdefault(
            context, {name: {"yes": 0, "no": 0} for name in ACTIONS}
        )[action]
        counters["yes" if success else "no"] += 1
        if counters["yes"] + counters["no"] >= MAX_EVIDENCE:
            counters["yes"] //= 2
            counters["no"] //= 2
        self.state["samples"] += 1
        self.state["recent"].append(
            {"at": at, "context": context, "action": action, "success": success}
        )
        del self.state["recent"][:-MAX_RECENT]
        return True

    def recommend(
        self,
        state: dict[str, Any],
        baseline: str,
        permitted: tuple[str, ...],
        *,
        active: bool = False,
    ) -> str:
        """Only a cautious walk-vs-fly recommendation; emergencies stay baseline.

        A shadow recommendation *always* returns baseline. An active change
        requires at least 12 observations for BOTH alternatives and a
        posterior advantage > 0.2. It cannot replace rest or grooming, cannot
        act when energy/water are depleted, and cannot add a new motor command.
        The VM's original motor and safety checks must still apply.
        """
        if baseline not in ACTIONS or baseline not in permitted:
            raise ValueError("baseline action was not authorized")
        context = _context(state)
        if not active or context in (None, "depleted") or baseline not in ("walk", "fly"):
            return baseline
        alternate = "walk" if baseline == "fly" else "fly"
        if alternate not in permitted:
            return baseline
        records = self.state["contexts"].get(context, {})
        first, second = records.get(baseline), records.get(alternate)
        if first is None or second is None:
            return baseline
        total1, total2 = first["yes"] + first["no"], second["yes"] + second["no"]
        if min(total1, total2) < 12:
            return baseline
        p1 = (first["yes"] + 1) / (total1 + 2)
        p2 = (second["yes"] + 1) / (total2 + 2)
        if p2 <= p1 + 0.2:
            return baseline
        self.state["recommendations"] += 1
        return alternate

    def to_json(self) -> str:
        return json.dumps(self.state, sort_keys=True, separators=(",", ":"), allow_nan=False)

    @classmethod
    def from_json(cls, text: str) -> EvaAdaptiveBrain:
        value = json.loads(text)
        if not isinstance(value, dict):
            raise ValueError("invalid Eva brain snapshot")
        return cls(value)

    def save_sidecar(self, path: str | Path) -> None:
        """Atomic sidecar persistence; refuses paths that could overwrite her DB."""
        destination = Path(path)
        if not destination.name.endswith(".eva-brain-v1.json"):
            raise ValueError("use a dedicated .eva-brain-v1.json sidecar path")
        destination.parent.mkdir(parents=True, exist_ok=True)
        # If it exists, it must already be a brain sidecar for this fly.
        if destination.exists():
            old = self.from_json(destination.read_text(encoding="utf-8"))
            if old.state["life_id"] != self.state["life_id"]:
                raise ValueError("refused to overwrite another individual's brain")
        tmp = destination.with_name(destination.name + "." + str(os.getpid()) + ".tmp")
        with open(tmp, "x", encoding="utf-8") as file:
            file.write(self.to_json() + "\n")
            file.flush()
            os.fsync(file.fileno())
        try:
            os.replace(tmp, destination)
        finally:
            if tmp.exists():
                tmp.unlink()
