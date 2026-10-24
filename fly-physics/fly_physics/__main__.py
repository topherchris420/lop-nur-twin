"""The physics backend's command line.

    python -m fly_physics setup  [--cache DIR]   fetch FlyBody by git at the pinned commit and verify it
    python -m fly_physics verify [--cache DIR]   verify the checkout only
    python -m fly_physics run    [--traces DIR] [--out DIR] [--cache DIR] [--only RUN_ID ...]
    python -m fly_physics readme [--out DIR]     rewrite the README from the results
    python -m fly_physics list                   print the run ids

Run from the fly-physics/ directory with MUJOCO_GL=disable (nothing is rendered).
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

from . import source
from .scenarios import runs

DEFAULT_TRACES = source.REPO_ROOT / ".fly-physics" / "traces"
DEFAULT_OUT = source.REPO_ROOT / "docs" / "benchmarks" / "fly-physics"


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="python -m fly_physics")
    p.add_argument("command", choices=["setup", "verify", "run", "readme", "list"])
    p.add_argument("--cache", type=Path, default=source.DEFAULT_CACHE)
    p.add_argument("--traces", type=Path, default=DEFAULT_TRACES)
    p.add_argument("--out", type=Path, default=DEFAULT_OUT)
    p.add_argument("--only", nargs="*", default=None)
    a = p.parse_args(argv)

    if a.command == "list":
        for r in runs():
            print(r["id"])
        return 0
    if a.command == "setup":
        source.fetch(a.cache)
    if a.command in ("setup", "verify"):
        print(json.dumps(source.verify(a.cache), indent=1))
        return 0
    from . import report

    if a.command == "readme":
        (a.out / "README.md").write_text(
            report.readme(report.load_results(a.out)), encoding="utf-8"
        )
        return 0

    flybody = source.import_flybody(a.cache)
    code = report.code_state(source.REPO_ROOT, a.out)
    if code["dirty"] is not False:
        print(
            f"note: this repository is {'uncommitted' if code['dirty'] else 'of unknown state'}; results record it"
        )
    from . import metrics, replay, trace

    chosen = [r for r in runs() if a.only is None or r["id"] in a.only]
    unknown = set(a.only or []) - {r["id"] for r in runs()}
    if unknown:
        print(f"unknown run ids: {sorted(unknown)}", file=sys.stderr)
        return 2
    traces: dict[str, trace.Trace] = {}
    for r in chosen:
        if r["plan"] not in traces:
            path = a.traces / f"{r['plan']}.json"
            if not path.exists():
                print(
                    f"no trace {path}; run node scripts/run-ts.mjs scripts/fly-physics-trace.ts",
                    file=sys.stderr,
                )
                return 2
            traces[r["plan"]] = trace.load(path)
        tr = traces[r["plan"]]
        started = time.monotonic()
        rec = replay.replay(tr, r["options"])
        m = metrics.compare(tr, rec, on_ground=not r["options"].suspended)
        out = report.write(
            a.out, report.result(r, tr, rec, m, metrics.series(tr, rec), flybody, code)
        )
        print(
            f"{r['id']}: speed {m['physical_speed_cms']} of {m['planned_speed_cms']} cm/s, "
            f"heading drift {m['heading_drift_deg']}°, fell {m['fell']} "
            f"({time.monotonic() - started:.1f} s) -> {out.name}"
        )
    (a.out / "README.md").write_text(report.readme(report.load_results(a.out)), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
