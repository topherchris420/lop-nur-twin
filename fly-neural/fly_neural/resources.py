"""Resource limits and measurements for long neural runs.

A ``Budget`` caps wall time and resident memory and can be cancelled from
outside (a stop file, or Ctrl-C). Runs check it at fixed intervals and stop
cleanly, keeping a checkpoint, rather than being killed by the operating
system. Measurements are of this process only; unknown values are null.

CPU: the simulator is single-threaded NumPy; parallel trials use separate
processes (``workers``). GPU: no accelerated path is provided or claimed; none
was available to verify one.
"""

from __future__ import annotations

import os
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

try:
    import psutil
except ImportError:  # optional: memory measurements become null
    psutil = None


class BudgetExceeded(RuntimeError):
    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


def rss_mb() -> float | None:
    if psutil is None:
        return None
    return psutil.Process().memory_info().rss / 2**20


def peak_rss_mb() -> float | None:
    """Peak resident memory of this process so far (Windows peak working set, else ru_maxrss)."""
    if psutil is not None and sys.platform == "win32":
        info = psutil.Process().memory_info()
        return getattr(info, "peak_wset", info.rss) / 2**20
    try:
        import resource

        kb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        return kb / 1024 if sys.platform != "darwin" else kb / 2**20
    except (ImportError, AttributeError):
        return rss_mb()


def cpu_seconds() -> float:
    t = os.times()
    return t.user + t.system


@dataclass
class Budget:
    """Caps for one run. ``None`` means no cap."""

    max_wall_s: float | None = None
    max_rss_mb: float | None = None
    stop_file: Path | None = None
    check_every_steps: int = 1000
    started: float = field(default_factory=time.monotonic)

    def check(self) -> None:
        if self.max_wall_s is not None and time.monotonic() - self.started > self.max_wall_s:
            raise BudgetExceeded(f"wall time over {self.max_wall_s} s")
        if self.max_rss_mb is not None:
            rss = rss_mb()
            if rss is not None and rss > self.max_rss_mb:
                raise BudgetExceeded(f"resident memory {rss:.0f} MB over {self.max_rss_mb} MB")
        if self.stop_file is not None and Path(self.stop_file).exists():
            raise BudgetExceeded(f"stop file {self.stop_file} present")

    def describe(self) -> dict:
        return {
            "max_wall_s": self.max_wall_s,
            "max_rss_mb": self.max_rss_mb,
            "stop_file": str(self.stop_file) if self.stop_file else None,
            "check_every_steps": self.check_every_steps,
        }


class Meter:
    """Wall, CPU and memory of a block, for the record."""

    def __enter__(self):
        self.t0 = time.monotonic()
        self.c0 = cpu_seconds()
        self.rss0 = rss_mb()
        return self

    def __exit__(self, *exc):
        self.wall_s = time.monotonic() - self.t0
        self.cpu_s = cpu_seconds() - self.c0
        self.rss_end = rss_mb()
        self.peak = peak_rss_mb()
        return False

    def describe(self) -> dict:
        r = lambda x: None if x is None else round(x, 3)  # noqa: E731
        return {
            "wall_s": r(self.wall_s),
            "cpu_s": r(self.cpu_s),
            "rss_start_mb": r(self.rss0),
            "rss_end_mb": r(self.rss_end),
            "peak_rss_mb_process": r(self.peak),
            "gpu": None,
        }


def machine() -> dict:
    info = {"logical_cpus": os.cpu_count(), "total_ram_mb": None, "available_ram_mb": None}
    if psutil is not None:
        vm = psutil.virtual_memory()
        info["total_ram_mb"] = round(vm.total / 2**20)
        info["available_ram_mb"] = round(vm.available / 2**20)
        info["physical_cpus"] = psutil.cpu_count(logical=False)
    return info
