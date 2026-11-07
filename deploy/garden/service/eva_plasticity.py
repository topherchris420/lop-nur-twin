"""Eva's embodied plasticity: an opt-in, in-process extension of her garden service.

Version ``eva-embodied-plasticity/v1``. It learns, from every travel step her own
``learning.execute`` runs, how far each motion actually carries her toward where
she is going, in each of the conditions she senses (``learning.context``). It is
a bounded running estimate per motion and condition, never a replacement for her
own learned gains, which stay exactly as ``learning.py`` keeps them.

What it never does, in any mode:

- draw from the world's random stream, or write anything into her state or her
  database: its own memory lives in a separate sidecar file, written atomically;
- learn from a step twice (each step is keyed by her tick), learn from a step she
  did not execute, or merge evidence from a different life (life ID and birth
  time are both bound);
- raise into her clock: any fault disables the extension and she carries on as
  her original service would.

Modes (``EVA_PLASTICITY``):

- unset: the extension is not constructed; the service is the original.
- ``shadow``: it learns and reports what it would have done; her behaviour is
  byte-for-byte the original's (tests run both side by side).
- ``active``: on a travel step it may swap fly for walk or walk for fly, and only
  when both motions have ``min_evidence`` measured steps in her current
  condition, her own exploration rule is not retesting (fewer than three samples
  of either, or every 37th trial), and the alternative's 95% lower bound on
  progress is above the chosen motion's upper bound. Her physics, her arrival
  rule, her 600 s pause, her boundary and her needs stay authoritative.

A toy sensorimotor model of a simulated fly: no claim about real flies, and no
claim of experience or consciousness follows from anything it counts.
"""

from __future__ import annotations

import copy
import json
import math
import os
import time
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import learning

VERSION = "eva-embodied-plasticity/v1"
MODES = ("shadow", "active")
MOTIONS = ("fly", "walk")
SIDECAR_SUFFIX = ".eva-plasticity-v1.json"
PARAMS = {
    # Steps of evidence each motion needs, in the current condition, before any swap.
    "min_evidence": 30,
    # Two-sided 95% normal bounds on the mean progress rate.
    "z": 1.96,
    # Above this many steps a motion's estimate is rescaled to half: bounded memory, still moving.
    "count_cap": 2000,
    # A step counts only when the command asked for at least this effort (0..1).
    "min_effort": 0.5,
    "recent": 32,
    "mode_history": 64,
}
TZ = ZoneInfo("America/New_York")


def _finite(*values: Any) -> bool:
    return all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in values)


def fresh(life_id: str, born_at: float, tick: int, mode: str, at: float) -> dict[str, Any]:
    return {
        "schema": VERSION,
        "life_id": life_id,
        "born_at": born_at,
        "created_tick": tick,
        "created_at": at,
        "last_tick": None,
        "mode": mode,
        "mode_history": [{"tick": tick, "at": at, "from": None, "to": mode}],
        "stats": {},
        "samples": 0,
        "discarded": 0,
        "duplicates": 0,
        "overrides": 0,
        "would_override": 0,
        "last_override": None,
        "recent": [],
        "snapshots": {},
    }


def bounds(stat: dict[str, float] | None) -> tuple[float, float, float] | None:
    """Mean and its 95% bounds, or None without two steps of evidence."""
    if not stat or stat["n"] < 2:
        return None
    sd = math.sqrt(max(0.0, stat["m2"] / (stat["n"] - 1)))
    half = PARAMS["z"] * sd / math.sqrt(stat["n"])
    return stat["mean"], stat["mean"] - half, stat["mean"] + half


def check(value: Any) -> dict[str, Any]:
    """A sidecar's contents, validated; raises ValueError for anything else."""
    if not isinstance(value, dict) or value.get("schema") != VERSION:
        raise ValueError("not an eva-embodied-plasticity/v1 sidecar")
    if not isinstance(value.get("life_id"), str) or not value["life_id"]:
        raise ValueError("sidecar has no life ID")
    if not _finite(value.get("born_at")):
        raise ValueError("sidecar has no birth time")
    last = value.get("last_tick")
    if last is not None and (not isinstance(last, int) or isinstance(last, bool) or last < 0):
        raise ValueError("sidecar tick is not a count")
    if value.get("mode") not in MODES:
        raise ValueError("sidecar mode is unknown")
    if not isinstance(value.get("stats"), dict):
        raise ValueError("sidecar has no estimates")
    for key, stat in value["stats"].items():
        motion, _, condition = key.partition("/")
        if motion not in MOTIONS or not condition:
            raise ValueError(f"sidecar estimate {key!r} is not motion/condition")
        if not isinstance(stat, dict) or not _finite(stat.get("n"), stat.get("mean"), stat.get("m2")):
            raise ValueError(f"sidecar estimate {key!r} is malformed")
        if stat["n"] < 0 or stat["n"] > PARAMS["count_cap"] or stat["m2"] < 0:
            raise ValueError(f"sidecar estimate {key!r} is out of bounds")
    for name in ("samples", "discarded", "duplicates", "overrides", "would_override"):
        if not isinstance(value.get(name), int) or value[name] < 0:
            raise ValueError(f"sidecar {name} is not a count")
    if not isinstance(value.get("mode_history"), list) or not isinstance(value.get("recent"), list):
        raise ValueError("sidecar history is malformed")
    return value


class Plasticity:
    """One life's extension. Every hook is safe to call from her clock: none raises."""

    def __init__(self, mode: str, sidecar: str | Path, database: str | Path) -> None:
        if mode not in MODES:
            raise ValueError(f"EVA_PLASTICITY must be one of {MODES}, not {mode!r}")
        path, db = Path(sidecar), Path(database)
        if not path.name.endswith(SIDECAR_SUFFIX):
            raise ValueError(f"the sidecar's name must end with {SIDECAR_SUFFIX}")
        if path.resolve() == db.resolve() or path.resolve().parent == (db.parent / "backups").resolve():
            raise ValueError("the sidecar may not be her database or sit among her backups")
        self.mode = mode
        self.path = path
        self.state: dict[str, Any] | None = None
        self.problem: str | None = None
        self.dirty = False
        self.saved_at: float | None = None

    # ----------------------------------------------------------------- hooks

    def bind(self, life: dict[str, Any]) -> None:
        """Called once, after her state is loaded and before her clock runs."""
        try:
            life_id, born_at, tick = life["life_id"], life["born_at"], life["ticks"]
            now = time.time()
            if self.path.exists():
                kept = check(json.loads(self.path.read_text(encoding="utf-8")))
                if kept["life_id"] != life_id or kept["born_at"] != born_at:
                    raise ValueError("the sidecar belongs to a different life")
                if kept["last_tick"] is not None and kept["last_tick"] > tick:
                    raise ValueError(
                        f"the sidecar has learned up to tick {kept['last_tick']}, past her tick {tick}: "
                        "was her database restored from an older backup?"
                    )
                if kept["mode"] != self.mode:
                    kept["mode_history"].append({"tick": tick, "at": now, "from": kept["mode"], "to": self.mode})
                    del kept["mode_history"][: -PARAMS["mode_history"]]
                    kept["mode"] = self.mode
                    self.dirty = True
                self.state = kept
            else:
                self.state = fresh(life_id, born_at, tick, self.mode, now)
                self.dirty = True
        except Exception as error:  # noqa: BLE001 - any failure leaves her original
            self._refuse(f"refused: {error}")

    def choose(self, life: dict[str, Any], weather: dict[str, Any], baseline: str) -> str:
        """Her motion for this travel step: her own choice unless active mode is confident."""
        if self.state is None or baseline not in MOTIONS:
            return baseline
        try:
            alternative = self._better(life, weather, baseline)
            if alternative is None:
                return baseline
            if self.mode == "shadow":
                self.state["would_override"] += 1
                self.dirty = True
                return baseline
            self.state["overrides"] += 1
            self.state["last_override"] = {
                "tick": life["ticks"],
                "at": life["updated_at"],
                "condition": learning.context(life, weather),
                "from": baseline,
                "to": alternative,
            }
            self.dirty = True
            return alternative
        except Exception as error:  # noqa: BLE001
            self._refuse(f"faulted: {error}")
            return baseline

    def observe(
        self,
        life: dict[str, Any],
        motion: str,
        start: list[float],
        target: list[float],
        command: list[float],
        dt: float,
    ) -> None:
        """One executed travel step, as her learner recorded it in learning['last']."""
        if self.state is None:
            return
        try:
            s = self.state
            tick = life["ticks"]
            if s["last_tick"] is not None and tick <= s["last_tick"]:
                s["duplicates"] += 1
                self.dirty = True
                return
            s["last_tick"] = tick
            self.dirty = True
            last = life["learning"].get("last") or {}
            observed = last.get("observed_position")
            effort = math.hypot(*command) if _finite(*command) else 0.0
            if (
                last.get("action") != motion
                or last.get("at") != life["updated_at"]
                or not isinstance(observed, list)
                or len(observed) != 2
                or not _finite(*observed, *start, *target, dt)
                or dt <= 0
                or effort < PARAMS["min_effort"]
            ):
                s["discarded"] += 1
                return
            rate = (math.dist(start, target) - math.dist(observed, target)) / (effort * dt)
            key = f"{motion}/{last['condition']}"
            stat = s["stats"].setdefault(key, {"n": 0.0, "mean": 0.0, "m2": 0.0})
            stat["n"] += 1
            delta = rate - stat["mean"]
            stat["mean"] += delta / stat["n"]
            stat["m2"] += delta * (rate - stat["mean"])
            if stat["n"] > PARAMS["count_cap"]:
                scale = PARAMS["count_cap"] / 2 / stat["n"]
                stat["n"] *= scale
                stat["m2"] *= scale
            s["samples"] += 1
            s["recent"].append({"tick": tick, "motion": motion, "condition": last["condition"], "rate": rate})
            del s["recent"][: -PARAMS["recent"]]
        except Exception as error:  # noqa: BLE001
            self._refuse(f"faulted: {error}")

    def save(self) -> None:
        """After her own commit: the sidecar, atomically, and one rolling daily copy."""
        if self.state is None or not self.dirty:
            return
        try:
            now = time.time()
            slot = datetime.fromtimestamp(now, TZ)
            day, name = slot.strftime("%Y-%m-%d"), f"day-{slot.weekday()}"
            text = json.dumps(self.state, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n"
            _atomic(self.path, text)
            if self.state["snapshots"].get(name, {}).get("day") != day:
                self.state["snapshots"][name] = {"day": day, "tick": self.state["last_tick"], "at": now}
                text = json.dumps(self.state, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n"
                _atomic(self.path.with_name(f"{self.path.name}.{name}"), text)
                _atomic(self.path, text)
            self.dirty = False
            self.saved_at = now
        except Exception as error:  # noqa: BLE001
            self._refuse(f"faulted: {error}")

    def status(self) -> dict[str, Any]:
        """For /state: read only, plain data."""
        out: dict[str, Any] = {"version": VERSION, "mode": self.mode, "status": self.problem or "ok"}
        s = self.state
        if s is None:
            return out
        contexts: dict[str, Any] = {}
        for key, stat in sorted(s["stats"].items()):
            b = bounds(stat)
            contexts[key] = {
                "n": round(stat["n"], 1),
                "rate": None if b is None else round(b[0], 6),
                "low": None if b is None else round(b[1], 6),
                "high": None if b is None else round(b[2], 6),
            }
        latest = max((v["at"] for v in s["snapshots"].values()), default=None)
        out.update(
            {
                "life_id": s["life_id"],
                "since_tick": s["created_tick"],
                "last_tick": s["last_tick"],
                "samples": s["samples"],
                "discarded": s["discarded"],
                "duplicates": s["duplicates"],
                "overrides": s["overrides"],
                "would_override": s["would_override"],
                "last_override": copy.deepcopy(s["last_override"]),
                "estimates": contexts,
                "saved_at": self.saved_at,
                "last_daily_copy_at": latest,
            }
        )
        return out

    # ------------------------------------------------------------- internals

    def _better(self, life: dict[str, Any], weather: dict[str, Any], baseline: str) -> str | None:
        """The other motion, when the evidence says it is clearly better here; else None."""
        condition = learning.context(life, weather)
        models = life["learning"]["models"]
        own = [models.get(f"{m}/{condition}") for m in MOTIONS]
        # Her exploration rule stays hers: never swap while she is (re)testing.
        if any(m is None or m["samples"] < 3 for m in own) or life["learning"]["trials"] % 37 == 0:
            return None
        alternative = "walk" if baseline == "fly" else "fly"
        stats = self.state["stats"] if self.state else {}
        chosen, other = stats.get(f"{baseline}/{condition}"), stats.get(f"{alternative}/{condition}")
        if not chosen or not other or min(chosen["n"], other["n"]) < PARAMS["min_evidence"]:
            return None
        a, b = bounds(chosen), bounds(other)
        if a is None or b is None or b[1] <= a[2]:
            return None
        return alternative

    def _refuse(self, problem: str) -> None:
        self.problem = problem[:300]
        self.state = None


def _atomic(path: Path, text: str) -> None:
    tmp = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    with open(tmp, "w", encoding="utf-8", newline="\n") as file:
        file.write(text)
        file.flush()
        os.fsync(file.fileno())
    os.replace(tmp, path)
    if hasattr(os, "O_DIRECTORY"):
        fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)


def from_environment(database: str) -> Plasticity | None:
    """The service's extension, from EVA_PLASTICITY and EVA_PLASTICITY_SIDECAR; None when unset.

    With the extension configured, a missing database is refused instead of
    letting the service begin a new life in its place.
    """
    mode = os.environ.get("EVA_PLASTICITY", "")
    if not mode:
        return None
    if not Path(database).exists():
        raise SystemExit(f"EVA_PLASTICITY is set and there is no life at {database}: refusing to begin a new one")
    sidecar = os.environ.get("EVA_PLASTICITY_SIDECAR") or str(Path(database).with_name("eva" + SIDECAR_SUFFIX))
    return Plasticity(mode, sidecar, database)
