"""``python -m fly_neural <command>``: acquire, import, crosscheck, run, experiment, bench, shadow.

Data live in ``$FLY_NEURAL_DATA`` (default ``~/.cache/fly-neural``), outside
the repository. Results are written to ``docs/benchmarks/fly-neural/`` as
sealed ``fly-neural-result/v1`` files; working files to ``.fly-neural/``.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .record import REPO

RESULTS = REPO / "docs" / "benchmarks" / "fly-neural"
WORK = REPO / ".fly-neural"


def compiled_dir(name: str) -> Path:
    from .acquire import data_dir

    return data_dir() / "compiled" / name


def cmd_status(args) -> int:
    from .acquire import data_dir, status

    print(f"data directory: {data_dir()}")
    for row in status():
        print(f"  {row['state']:<10} {row['file']}  [{row['terms']}]")
    return 0


def cmd_acquire(args) -> int:
    from .acquire import acquire

    for row in acquire(args.only or None, set(args.accept or [])):
        print(f"  {row['key']}: {row['action']}")
    return 0


def cmd_import(args) -> int:
    from .importer import import_v783
    from .resources import Budget

    out = compiled_dir(args.name or f"fafb-v783-{args.sign}")
    c = import_v783(out, sign_policy=args.sign, chunk_rows=args.chunk_rows, budget=Budget(max_rss_mb=args.max_rss_mb))
    print(json.dumps({"counts": c.manifest["counts"], "resources": c.manifest["resources"]}, indent=1))
    return 0


def cmd_crosscheck(args) -> int:
    from . import connectome as cx
    from .importer import crosscheck_shiu

    c = cx.load(compiled_dir(args.name))
    print(json.dumps(crosscheck_shiu(c), indent=1))
    return 0


def cmd_experiment(args) -> int:
    from .experiments import run
    from .resources import Budget

    cfg = Path(args.config)
    if not cfg.is_absolute() and not cfg.exists():
        cfg = Path(__file__).resolve().parents[1] / "experiments" / args.config
    budget = Budget(max_wall_s=args.max_wall_s, max_rss_mb=args.max_rss_mb, stop_file=WORK / "STOP")
    data = run(cfg, args.split, compiled_dir(args.connectome), Path(args.out or RESULTS), only=args.only, budget=budget)
    return 0 if not data["failed"] else 3


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="python -m fly_neural", description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("status", help="which pinned sources are present and verified").set_defaults(fn=cmd_status)
    a = sub.add_parser("acquire", help="fetch pinned sources into the data directory")
    a.add_argument("--accept", action="append", help="terms you accept (see `status`); repeatable")
    a.add_argument("--only", action="append", help="source key; repeatable (default: all)")
    a.set_defaults(fn=cmd_acquire)
    i = sub.add_parser("import", help="compile the v783 connection table into a sparse connectome")
    i.add_argument("--sign", default="synapse-weighted", choices=["synapse-weighted", "shiu", "annotation"])
    i.add_argument("--name", help="output name under <data>/compiled/ (default fafb-v783-<sign>)")
    i.add_argument("--chunk-rows", type=int, default=2_000_000)
    i.add_argument("--max-rss-mb", type=float, default=None)
    i.set_defaults(fn=cmd_import)
    x = sub.add_parser("crosscheck", help="compare a compiled connectome with Shiu et al.'s Connectivity_783")
    x.add_argument("--name", default="fafb-v783-synapse-weighted")
    x.set_defaults(fn=cmd_crosscheck)
    e = sub.add_parser("experiment", help="run a pre-registered experiment file and judge its criteria")
    e.add_argument("config", help="path, or a file name under fly-neural/experiments/")
    e.add_argument("--split", required=True, choices=["dev", "heldout"])
    e.add_argument("--connectome", default="fafb-v783-shiu", help="name under <data>/compiled/")
    e.add_argument("--only", action="append", help="condition name; repeatable (the result is marked partial)")
    e.add_argument("--out", help=f"results directory (default {RESULTS})")
    e.add_argument("--max-wall-s", type=float, default=None)
    e.add_argument("--max-rss-mb", type=float, default=None)
    e.set_defaults(fn=cmd_experiment)
    args = p.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
