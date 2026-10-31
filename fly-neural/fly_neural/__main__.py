"""``python -m fly_neural <command>``: status, acquire, import, crosscheck, experiment, reference,
plasticity, shadow, serve, bench, report.

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
# The adaptive-intelligence results (docs/ECHO_ADAPTIVE_INTELLIGENCE.md), kept apart from the sealed originals.
ADAPTIVE = RESULTS / "adaptive"
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

    from . import RESULT_SCHEMA
    from .record import code_watch, environment, sealed, write_json
    from .resources import Meter, machine

    code = code_watch(Path(args.out or RESULTS))
    path = compiled_dir(args.name)
    c = cx.load(path, verify_hashes=True)
    with Meter() as m:
        structure = cx.validate(c)
        cross = crosscheck_shiu(c)
    man = c.manifest
    # The import's own record, re-checked: what was read, what was found, how it compares.
    data = sealed(
        {
            "schema": RESULT_SCHEMA,
            "kind": "import",
            "connectome": args.name,
            "manifest_sha256": man.get("sha256"),
            "dataset": man.get("dataset"),
            "sign_policy": man.get("sign_policy"),
            "transmitter_sign": man.get("transmitter_sign"),
            "inputs": man.get("inputs"),
            "import_checks": man.get("import"),
            "import_resources": man.get("resources"),
            "structure_revalidated": structure,
            "array_hashes_reverified": True,
            "shiu_crosscheck": cross,
            "resources": m.describe(),
            "machine": machine(),
            "environment": environment(),
            "code": code(),
        }
    )
    out = Path(args.out or RESULTS) / f"import-{args.name}.json"
    write_json(out, data)
    print(json.dumps(cross, indent=1))
    print(f"wrote {out}")
    return 0


def cmd_experiment(args) -> int:
    from .experiments import run
    from .resources import Budget

    cfg = Path(args.config)
    if not cfg.is_absolute() and not cfg.exists():
        cfg = Path(__file__).resolve().parents[1] / "experiments" / args.config
    budget = Budget(max_wall_s=args.max_wall_s, max_rss_mb=args.max_rss_mb, stop_file=WORK / "STOP")
    progress = WORK / "progress" / f"{cfg.stem}-{args.split}{'-partial' if args.only else ''}.jsonl"
    data = run(cfg, args.split, compiled_dir(args.connectome), Path(args.out or RESULTS), only=args.only, budget=budget, progress=progress, resume=args.resume)
    return 0 if not data["failed"] else 3


def cmd_shadow(args) -> int:
    from .shadow import analyse

    analyse(Path(args.recording), compiled_dir(args.connectome), Path(args.out or RESULTS), seed=args.seed)
    return 0


def cmd_plasticity(args) -> int:
    from .plasticity import run

    cfg = Path(args.config)
    if not cfg.is_absolute() and not cfg.exists():
        cfg = Path(__file__).resolve().parents[1] / "experiments" / args.config
    progress = WORK / "progress" / f"{cfg.stem}-{args.split}{f'-{args.subjects}-subjects' if args.subjects else ''}.jsonl"
    data = run(
        cfg,
        args.split,
        compiled_dir(args.connectome),
        Path(args.out or RESULTS),
        Path(args.echo_mb) if args.echo_mb else None,
        subjects=args.subjects,
        progress=progress,
        resume=args.resume,
    )
    return 0 if not data["failed"] else 3


def cmd_bench(args) -> int:
    from .bench import run

    run([compiled_dir(n) for n in args.connectome], Path(args.out or RESULTS), trials=args.trials)
    return 0


def cmd_reference(args) -> int:
    from .acquire import data_dir
    from .reference import run

    cfg = Path(__file__).resolve().parents[1] / "experiments" / "brian2-reference.json"
    b2 = [Path(x) for x in args.brian2] if args.brian2 else [data_dir() / "reference-runs" / "brian2-sugar100-30.json"]
    data = run(cfg, b2, compiled_dir(args.connectome), Path(args.out or RESULTS))
    return 0 if not data["failed"] else 3


def cmd_report(args) -> int:
    from .report import write

    print(f"wrote {write(Path(args.out or RESULTS))}")
    return 0


def cmd_reproduce(args) -> int:
    from .reproduce import run

    data = run(
        RESULTS,
        WORK,
        compiled_dir(args.connectome),
        Path(args.out or ADAPTIVE),
        tuple(args.scenario or ("looms", "food")),
        tuple(args.plasticity_arm or ("rule", "fixed")),
        args.plasticity_subjects,
    )
    return 0 if data["identical"] else 3


def _config(name: str) -> Path:
    cfg = Path(name)
    if not cfg.is_absolute() and not cfg.exists():
        cfg = Path(__file__).resolve().parents[1] / "experiments" / name
    return cfg


def cmd_mbcode(args) -> int:
    from .mbcode import sweep

    data = sweep(_config(args.config), compiled_dir(args.connectome), Path(args.out or ADAPTIVE))
    return 0 if data["selected"] else 3


def cmd_threat(args) -> int:
    from . import threat

    cfg = _config(args.config)
    if args.action == "battery":
        print(f"wrote {threat.write_battery(cfg, args.split, WORK)}")
        return 0
    data = threat.run(cfg, args.split, compiled_dir(args.connectome), WORK, Path(args.out or ADAPTIVE), resume=args.resume)
    return 0 if not data.get("failed") else 3


def cmd_selective(args) -> int:
    from . import selective

    cfg = _config(args.config)
    out = Path(args.out or ADAPTIVE)
    if args.action == "calibrate":
        selective.calibrate(cfg, compiled_dir(args.connectome), ADAPTIVE, out)
        return 0
    progress = WORK / "progress" / f"{cfg.stem}-{args.split}{f'-{args.subjects}-subjects' if args.subjects else ''}{'-only-' + '-'.join(args.only) if args.only else ''}.jsonl"
    data = selective.run(cfg, args.split, compiled_dir(args.connectome), ADAPTIVE, out, Path(args.echo_mb) if args.echo_mb else None, subjects=args.subjects, progress=progress, resume=args.resume, only=args.only, merge=[Path(m) for m in args.merge_from or []])
    return 0 if not data["failed"] else 3


def cmd_adaptive(args) -> int:
    from . import adaptive

    cfg = _config(args.config)
    codes = WORK / "adaptive" / f"codes-{cfg.stem}.npz"
    if args.action == "codes":
        adaptive.build_codes(cfg, compiled_dir(args.connectome), ADAPTIVE, codes)
        return 0
    data = adaptive.run(cfg, args.split, codes, Path(args.out or ADAPTIVE))
    return 0 if not data["failed"] else 3


def cmd_closedloop(args) -> int:
    from . import closedloop

    if args.action == "serve":
        return closedloop.serve(compiled_dir(args.connectome), ADAPTIVE)
    data = closedloop.run(_config(args.config), args.split, REPO, ADAPTIVE, Path(args.out or ADAPTIVE), sys.executable)
    return 0 if not data["failed"] else 3


def cmd_serve(args) -> int:
    from .shadow import serve

    return serve(compiled_dir(args.connectome))


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
    x.add_argument("--out", help=f"results directory (default {RESULTS})")
    x.set_defaults(fn=cmd_crosscheck)
    e = sub.add_parser("experiment", help="run a pre-registered experiment file and judge its criteria")
    e.add_argument("config", help="path, or a file name under fly-neural/experiments/")
    e.add_argument("--split", required=True, choices=["dev", "heldout"])
    e.add_argument("--connectome", default="fafb-v783-shiu", help="name under <data>/compiled/")
    e.add_argument("--only", action="append", help="condition name; repeatable (the result is marked partial)")
    e.add_argument("--out", help=f"results directory (default {RESULTS})")
    e.add_argument("--max-wall-s", type=float, default=None)
    e.add_argument("--max-rss-mb", type=float, default=None)
    e.add_argument("--resume", action="store_true", help="reuse the conditions an interrupted run of this same commit, config and connectome finished (.fly-neural/progress/)")
    e.set_defaults(fn=cmd_experiment)
    s = sub.add_parser("shadow", help="replay a research fly's recording into the model (neural-shadow mode)")
    s.add_argument("recording", help="a .jsonl written by scripts/echo-neural-shadow.ts")
    s.add_argument("--connectome", default="fafb-v783-shiu")
    s.add_argument("--seed", type=int, default=0)
    s.add_argument("--out", help=f"results directory (default {RESULTS})")
    s.set_defaults(fn=cmd_shadow)
    q = sub.add_parser("plasticity", help="run the pre-registered plasticity comparison")
    q.add_argument("config", nargs="?", default="plasticity-v783.json")
    q.add_argument("--split", required=True, choices=["dev", "heldout"])
    q.add_argument("--connectome", default="fafb-v783-shiu")
    q.add_argument("--echo-mb", help="result of scripts/echo-neural-plasticity.ts for the same split")
    q.add_argument("--subjects", type=int, help="fewer subjects than the file's (the result is marked partial)")
    q.add_argument("--out", help=f"results directory (default {RESULTS})")
    q.add_argument("--resume", action="store_true", help="reuse the subjects an interrupted run of this same commit, config and connectome finished (.fly-neural/progress/)")
    q.set_defaults(fn=cmd_plasticity)
    b = sub.add_parser("bench", help="measure full-brain trials and synthetic scaling on this machine")
    b.add_argument("--connectome", action="append", default=None, help="name under <data>/compiled/; repeatable")
    b.add_argument("--trials", type=int, default=5)
    b.add_argument("--out", help=f"results directory (default {RESULTS})")
    b.set_defaults(fn=cmd_bench)
    r = sub.add_parser("reference", help="judge this engine against a Brian 2 run of Shiu et al.'s model.py")
    r.add_argument("--brian2", action="append", help="a trials file reference/shiu_brian2.py wrote; repeat to pool runs of the same setup (default <data>/reference-runs/brian2-sugar100-30.json)")
    r.add_argument("--connectome", default="fafb-v783-shiu")
    r.add_argument("--out", help=f"results directory (default {RESULTS})")
    r.set_defaults(fn=cmd_reference)
    w = sub.add_parser("report", help="write the results README and figure from the sealed results")
    w.add_argument("--out", help=f"results directory (default {RESULTS})")
    w.set_defaults(fn=cmd_report)
    rp = sub.add_parser("reproduce", help="re-run the sealed baselines (shadow replays, plasticity dev subjects) and require identical numbers")
    rp.add_argument("--scenario", action="append", choices=["looms", "food", "wind"], help="replay to repeat; repeatable (default looms, food)")
    rp.add_argument("--plasticity-arm", action="append", help="plasticity arm to repeat; repeatable (default rule, fixed)")
    rp.add_argument("--plasticity-subjects", type=int, default=2)
    rp.add_argument("--connectome", default="fafb-v783-shiu")
    rp.add_argument("--out", help=f"results directory (default {ADAPTIVE})")
    rp.set_defaults(fn=cmd_reproduce)
    mb = sub.add_parser("mbcode", help="the Kenyon-cell census and the pre-registered sparse-code sweep (development odours only)")
    mb.add_argument("config", nargs="?", default="mb-representation-v783.json")
    mb.add_argument("--connectome", default="fafb-v783-shiu")
    mb.add_argument("--out", help=f"results directory (default {ADAPTIVE})")
    mb.set_defaults(fn=cmd_mbcode)
    th = sub.add_parser("threat", help="threat discrimination (experiments/threat-v783.json): write a battery for the recorder, or replay and score it")
    th.add_argument("action", choices=["battery", "run"])
    th.add_argument("--split", required=True, choices=["dev", "heldout"])
    th.add_argument("--config", default="threat-v783.json")
    th.add_argument("--connectome", default="fafb-v783-shiu")
    th.add_argument("--out", help=f"results directory (default {ADAPTIVE})")
    th.add_argument("--resume", action="store_true", help="reuse replays an interrupted run of this same commit, config and recording finished (.fly-neural/threat/traces/)")
    th.set_defaults(fn=cmd_threat)
    se = sub.add_parser("selective", help="selective associative learning (experiments/plasticity-v2-v783.json): calibrate the dopamine threshold (dev), or run a split")
    se.add_argument("action", choices=["calibrate", "run"])
    se.add_argument("--split", default="dev", choices=["dev", "heldout"])
    se.add_argument("--config", default="plasticity-v2-v783.json")
    se.add_argument("--connectome", default="fafb-v783-shiu")
    se.add_argument("--echo-mb", help="result of scripts/echo-neural-plasticity.ts --schedule v2 for the same split")
    se.add_argument("--subjects", type=int, help="fewer subjects than the file's (the result is marked partial)")
    se.add_argument("--only", action="append", help="arm name; repeatable (the result is marked partial)")
    se.add_argument("--out", help=f"results directory (default {ADAPTIVE})")
    se.add_argument("--resume", action="store_true")
    se.add_argument("--merge-from", action="append", help="progress file of a parallel worker of this exact run (--only some arms); repeatable")
    se.set_defaults(fn=cmd_selective)
    al = sub.add_parser("adaptive", help="adaptive-life experiments on research subjects (experiments/adaptive-life-v783.json): build the odour codes from the full model, or run a split")
    al.add_argument("action", choices=["codes", "run"])
    al.add_argument("--split", default="dev", choices=["dev", "heldout"])
    al.add_argument("--config", default="adaptive-life-v783.json")
    al.add_argument("--connectome", default="fafb-v783-shiu")
    al.add_argument("--out", help=f"results directory (default {ADAPTIVE})")
    al.set_defaults(fn=cmd_adaptive)
    cl = sub.add_parser("closedloop", help="closed-loop control of research subjects (experiments/closed-loop-v783.json): the readout server, or a pre-registered run")
    cl.add_argument("action", choices=["serve", "run"])
    cl.add_argument("--split", default="dev", choices=["dev", "heldout"])
    cl.add_argument("--config", default="closed-loop-v783.json")
    cl.add_argument("--connectome", default="fafb-v783-shiu")
    cl.add_argument("--out", help=f"results directory (default {ADAPTIVE})")
    cl.set_defaults(fn=cmd_closedloop)
    v = sub.add_parser("serve", help="readouts for a neural-experimental research subject, JSON lines on stdin/stdout")
    v.add_argument("--connectome", default="fafb-v783-shiu")
    v.set_defaults(fn=cmd_serve)
    args = p.parse_args(argv)
    if args.cmd == "bench" and not args.connectome:
        args.connectome = ["fafb-v783-shiu", "fafb-v783-synapse-weighted"]
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
