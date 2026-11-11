#!/usr/bin/env python3
"""Fixtures for the TypeScript port of Eva's controller (src/bethesda/firstContact/eva/).

Research gardens only, as in deploy/garden/service/study.py: every life in
`vectors`, `runs` and `copies` is born in a temporary directory by her original
service, given a research identity, and run by her patched service (with
eva-embodied-plasticity/v1 off, in shadow or in active mode) in simulated time.
`from-copy` reads a copy of a database and sidecar someone already took (Stage
4 of docs/FIRST_CONTACT.md: the owner's copies of hers), copies it again into a
temporary directory and lives it on only under a research id. Never Eva, never
her VM, no network. Her sources are imported unchanged; this script drives
her clock, records what her code did after every step, and keeps the
plasticity sidecar in memory (`_no_files`: a Windows file-replace fault once
disabled her extension mid-run, which is a host fault, not her behaviour).

Fixtures record, per step, every discrete field (counters as exceptions to her
learner's counting rule, see `derived`), her needs exactly (integers in units
of 1e-5, since she rounds them to five places), position, distance, gains,
body and plasticity means at full precision; and every CHECKPOINT_EVERY steps
her whole state, the sidecar's behavioural fields and her /state snapshot.

  python scripts/eva-parity.py vectors OUT_DIR   # unit-test vectors (random, round, hypot, clock)
  python scripts/eva-parity.py runs OUT_DIR [NAME ...]
  python scripts/eva-parity.py search            # look for runs where active mode swaps
  python scripts/eva-parity.py copies OUT_DIR    # copies of research gardens, lived on (from-copy)
  python scripts/eva-parity.py from-copy DB SIDECAR research-ID TICKS OUT.json.gz
                                                 # a copy of a life, lived on under a research id
                                                 # (Stage 4 of docs/FIRST_CONTACT.md; OUT outside the repository)

Needs the IANA tz database (on Windows: `pip install tzdata` in a venv).
"""

from __future__ import annotations

import gzip
import hashlib
import importlib.util
import json
import math
import os
import platform
import random
import shutil
import sqlite3
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
HERE = ROOT / "deploy" / "garden" / "service"
sys.path.insert(0, str(HERE))

import eva_plasticity  # noqa: E402
import server as patched  # noqa: E402

PRODUCTION = ("/var/lib/bethesda-fly", "/var/lib/bethesda-life", "/opt/bethesda-life")


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


original = _load("eva_original_server", HERE / "original" / "server.py")


def utc(*args) -> float:
    return datetime(*args, tzinfo=timezone.utc).timestamp()


def research_seed(n: int) -> str:
    return hashlib.sha256(f"eva research {n}".encode()).hexdigest()[:32]


# A cold, rainy weather report in the shape her fetcher writes, with sunrise
# and sunset for the days it covers (so daylight() reads `sun`).
COLD_RAIN = {"temperature": 5.5, "code": 63, "wind": 12.0, "rain": 2.0, "source": "eva-parity",
             "sun": {"2026-11-09": [utc(2026, 11, 9, 11, 41), utc(2026, 11, 9, 21, 58)],
                     "2026-11-10": [utc(2026, 11, 10, 11, 42), utc(2026, 11, 10, 21, 57)],
                     "2026-11-11": [utc(2026, 11, 11, 11, 43), utc(2026, 11, 11, 21, 56)]}}

# The parity plan. Seeds 7301+ are this harness's own (study.py uses 7001-7112).
RUNS = [
    # Born by day (10:00 local), plasticity off: her original service.
    {"name": "day-off", "seed": 7301, "born": utc(2026, 11, 7, 15, 0), "plasticity": "off"},
    # Born at night (22:00 local), shadow, with a six-hour outage and a
    # catch-up that ends on a fractional second (motor time 2.5 s).
    {"name": "night-shadow-outage", "seed": 7302, "born": utc(2026, 11, 8, 3, 0), "plasticity": "shadow",
     "outage": [36000, 21600, 2.5]},
    # Born 22:00 EDT on 31 October: crosses the fall-back at 02:00 on 1 November.
    {"name": "dst-active", "seed": 7303, "born": utc(2026, 11, 1, 2, 0), "plasticity": "active"},
    # Cold rain all run (temperature 5.5, rain 2 mm), with fetched sunrise/sunset.
    {"name": "cold-rain-active", "seed": 7304, "born": utc(2026, 11, 9, 13, 0), "plasticity": "active",
     "weather": COLD_RAIN},
    # Winter (January, cold every hour) in shadow mode.
    {"name": "winter-shadow", "seed": 7305, "born": utc(2026, 1, 15, 15, 0), "plasticity": "shadow"},
    # Active mode swaps only with an impairment her own choice is slow to see
    # (found with `search`; study.py's weak-wings 0.35 never swapped): wings at
    # 0.25 and legs at 0.6 heal while she rests, inside one "limited" condition.
    # Seed 7401 is one `search` saw swap; seeds 7306 and 7307 did not.
    {"name": "weak-active", "seed": 7401, "born": utc(2026, 11, 7, 15, 0), "plasticity": "active",
     "body": {"wing_integrity": .25, "leg_integrity": .6}},
    # The same kind of impairment in shadow mode: it counts what it would have swapped.
    {"name": "weak-shadow", "seed": 7401, "born": utc(2026, 11, 7, 15, 0), "plasticity": "shadow",
     "body": {"wing_integrity": .3}},
]
TICKS = 20000
CHECKPOINT_EVERY = 500

# Copies of research gardens (never Eva), the path Stage 4's twins take: a run
# lived by her patched service to tick `at` with its sidecar written to disk as
# her service writes it, then copied, given another research id and lived on
# for `ticks` steps by `from_copy`.
COPIES = [
    # Copied mid-swapping (669 of the run's 1293 swaps made), so the restored memory goes on deciding.
    {"name": "copy-weak-active", "run": "weak-active", "at": 2000, "ticks": 3000},
    # Copied just before shadow mode's first counted swaps (tick 2000 of 7 by tick 2500).
    {"name": "copy-weak-shadow", "run": "weak-shadow", "at": 2000, "ticks": 3000},
]


def _no_files(path, text):
    """Her sidecar write (eva_plasticity._atomic), kept in memory for fixtures.

    On Windows, os.replace of a just-written file can fail transiently (observed
    once here: a run's extension faulted mid-run and disabled itself, as it is
    designed to). That is a host fault, not her behaviour, and the TypeScript
    port has no files; the sidecar's contents never change what she does.
    """


_her_atomic = eva_plasticity._atomic


def _her_atomic_retried(path, text):
    """Her `_atomic`, retried when Windows refuses the replace (another process, such as a
    virus scanner, briefly holding the file just written: the host fault `_no_files` describes).
    The bytes written are hers, unchanged; a fault that persists still reaches her extension."""
    for attempt in range(40):
        try:
            return _her_atomic(path, text)
        except PermissionError:
            if attempt == 39:
                raise
            time.sleep(0.05)


def lived(run: dict, directory: Path, at: int) -> tuple:
    """A research garden lived by her patched service to tick `at`: its database and sidecar, on disk.

    Her extension writes the sidecar with its own `_atomic`. The wall clock it
    stamps its file bookkeeping with (`created_at`, `mode_history[].at`, the
    daily copies' slot) is the simulated clock here, so the copy is the same on
    every run; none of those values changes what she does.
    """
    if run.get("outage") or run.get("weather") or run["plasticity"] not in ("shadow", "active"):
        raise SystemExit(f"{run['name']}: a copy is made of a plain shadow or active run")
    db = birth(directory, run)
    sidecar = directory / ("eva" + eva_plasticity.SIDECAR_SUFFIX)
    clock = [run["born"]]
    wall = eva_plasticity.time
    eva_plasticity._atomic = _her_atomic_retried
    eva_plasticity.time = SimpleNamespace(time=lambda: clock[0])
    try:
        p = eva_plasticity.Plasticity(run["plasticity"], sidecar, db)
        world = make(patched, db, run["born"], p)
        while world.state["ticks"] < at:
            clock[0] += 5
            world.advance(clock[0])
        if p.state is None:
            raise SystemExit(f"{run['name']}: her plasticity extension stopped: {p.problem}")
        world.close()
    finally:
        eva_plasticity._atomic = _no_files
        eva_plasticity.time = wall
    return db, sidecar


def refuse_production_host():
    for p in PRODUCTION:
        if os.path.exists(p):
            raise SystemExit(f"refusing to run: {p} exists, so this is a production host")


def make(module, db, now, plasticity=None):
    world = module.World.__new__(module.World)
    if plasticity is not None:
        world.plasticity = plasticity
    world.__init__(str(db), now)
    world.db.execute("PRAGMA synchronous=OFF")  # harness speed only
    return world


def birth(directory: Path, run: dict) -> Path:
    """A research garden born by her original service, then given its research identity."""
    db = directory / "born.sqlite3"
    world = make(original, db, run["born"])
    s = world.state
    s["life_id"] = f"research-eva-parity-{run['seed']}"
    s["seed"] = research_seed(run["seed"])
    s["body"].update(run.get("body") or {})
    world._save()
    world.close()
    return db


# ------------------------------------------------------------------ records


def memory(p):
    """The plasticity sidecar's fields that behaviour depends on (no wall clock, no file copies)."""
    if p is None or p.state is None:
        return None
    s = json.loads(json.dumps(p.state))
    s.pop("snapshots", None)
    s.pop("created_at", None)
    for h in s["mode_history"]:
        h.pop("at", None)
    return s


def flat(world, p) -> dict:
    """Per-step values: discrete ones (compared exactly) and continuous ones (within tolerance).

    `energy`, `fullness` and `water` are rounded to five places every step, so
    they are recorded exactly as integers in units of 1e-5 (`needs`).
    """
    s = world.state
    L = s["learning"]
    tr = s["travel"]
    last = L["last"]
    out = {
        "place": s["place"], "activity": s["activity"], "journeys": s["journeys"], "was_day": s["was_day"],
        "travel": None if tr is None else [tr["destination"], tr["started_at"], tr["ends_at"], tr.get("paused_until")],
        "visits": s["visits"], "trials": L["trials"], "surprises": L["surprises"],
        "last": None if last is None else [last["action"], last["condition"], last["success"]],
        # continuous
        "x": s["position"][0], "y": s["position"][1], "distance": s["distance"],
        "next_decision": s["next_decision"], "next_moment": s["next_moment"],
        "body": [s["body"]["wing_integrity"], s["body"]["leg_integrity"], s["body"]["wetness"]],
    }
    for k, m in L["models"].items():
        out["m:" + k] = [m["samples"], m["successes"]]
        out["g:" + k] = m["gain"]
    for k, o in L["objects"].items():
        out["o:" + k] = o["samples"]
    if p is not None:
        ps = p.state
        out["p"] = None if ps is None else [ps["samples"], ps["discarded"], ps["duplicates"], ps["overrides"],
                                            ps["would_override"], ps["last_tick"], ps["mode"]]
        out["plo"] = None if ps is None else ps["last_override"]
        for k, st in ({} if ps is None else ps["stats"]).items():
            out["pn:" + k] = st["n"]
            out["pm:" + k] = st["mean"]
    return out


def needs(world) -> list:
    out = []
    for key in ("energy", "fullness", "water"):
        v = world.state[key]
        k = round(v * 1e5)
        if float(f"{k}e-5") != v:
            raise SystemExit(f"{key} {v!r} is not a five-place value")
        out.append(k)
    return out


def derived(prev: dict, cur: dict) -> dict:
    """What her learner's counting rule predicts for this step (the TS test applies the same rule):
    one more trial, one more sample of each tracked object, and one more sample (and a
    success when it succeeded) of the model of the action she executed."""
    out = {}
    if "trials" in prev:
        out["trials"] = prev["trials"] + 1
    for k, v in prev.items():
        if k.startswith("o:"):
            out[k] = v + 1
    last = cur.get("last")
    if last is not None:
        key = "m:" + last[0] + "/" + last[1]
        before = prev.get(key, [0, 0])
        out[key] = [before[0] + 1, before[1] + int(last[2])]
    return out


def snapshot(world, p):
    snap = world.snapshot(world.state["updated_at"])
    snap.pop("server_time")
    for k in ("fetched_at", "sun"):
        snap["weather"].pop(k, None)
    if p is not None:
        snap["adaptive"] = p.status()
        for k in ("saved_at", "last_daily_copy_at"):
            snap["adaptive"].pop(k, None)
    return json.loads(json.dumps(snap))


def drive(run: dict, record) -> tuple:
    """Her clock as her service runs it: advance every five seconds (study.py's loop)."""
    directory = Path(tempfile.mkdtemp(prefix="eva-parity-"))
    try:
        db = birth(directory, run)
        born = run["born"]
        p = None
        if run["plasticity"] in ("shadow", "active"):
            p = eva_plasticity.Plasticity(run["plasticity"], directory / ("eva" + eva_plasticity.SIDECAR_SUFFIX), db)
        world = make(patched, db, born, p)
        record(world, p, "born")
        cls_step = type(world)._step

        def step(now, dt):
            cls_step(world, now, dt)
            record(world, p, "step")

        world._step = step  # observe after each of her steps; her code is unchanged
        outage = run.get("outage")
        resumed = False
        t = born
        while world.state["ticks"] < run.get("ticks", TICKS):
            t += 5
            if outage and outage[0] < t - born <= outage[0] + outage[1]:
                continue
            if outage and not resumed and t - born > outage[0] + outage[1]:
                resumed = True
                world.advance(born + outage[0] + outage[1] + outage[2])
            if run.get("weather") and (t - born) % 3600 == 5:
                world.set_weather({**run["weather"], "fetched_at": t})
            world.advance(t)
        record(world, p, "end")
        if p is not None and p.state is None:
            raise SystemExit(f"{run['name']}: her plasticity extension stopped: {p.problem}")
        result = (world.state["ticks"], memory(p))
        world.close()
        return result
    finally:
        shutil.rmtree(directory, ignore_errors=True)


def _recorder(start_tick: int = 0, seen_start: int = 0):
    """What `run_fixture` records after each of her steps (a birth starts at tick 0, no moments)."""
    steps, checkpoints = [], []
    prev = {}
    prev_needs = [None]
    seen = [seen_start]

    def record(world, p, what):
        cur = json.loads(json.dumps(flat(world, p)))
        now_needs = needs(world)
        rows = world.db.execute("SELECT id, at, words FROM moments WHERE id > ? ORDER BY id", (seen[0],)).fetchall()
        if rows:
            seen[0] = rows[-1][0]
        tick = world.state["ticks"]
        if what == "step":
            expect = {**prev, **derived(prev, cur)}
            delta = {k: v for k, v in cur.items() if k not in expect or expect[k] != v or type(expect[k]) is not type(v)}
            entry = {"d": delta}
            dn = [a - b for a, b in zip(now_needs, prev_needs[0])]
            if any(dn):
                entry["n"] = dn
            if rows:
                entry["nm"] = [list(r) for r in rows]
            if tick != start_tick + len(steps) + 1:
                raise SystemExit(f"tick {tick} is not step {len(steps) + 1}")
            steps.append(entry)
        prev.clear()
        prev.update(cur)
        prev_needs[0] = now_needs
        if what in ("born", "end") or (what == "step" and tick % CHECKPOINT_EVERY == 0):
            if what == "end" and checkpoints and checkpoints[-1]["tick"] == tick:
                return
            checkpoints.append({"tick": tick, "state": json.loads(json.dumps(world.state)),
                                "memory": memory(p), "snapshot": snapshot(world, p),
                                "moments": seen[0], "flat": cur, "needs": now_needs,
                                **({"born_moments": [list(r) for r in rows]} if what == "born" else {})})

    return record, steps, checkpoints


def run_fixture(run: dict) -> dict:
    record, steps, checkpoints = _recorder()
    ticks, mem = drive(run, record)
    return {"schema": "eva-parity/v1",
            "run": {**run, "ticks": run.get("ticks", TICKS), "life_id": f"research-eva-parity-{run['seed']}",
                    "seed_string": research_seed(run["seed"]), "checkpoint_every": CHECKPOINT_EVERY},
            "python": {"version": platform.python_version(), "implementation": platform.python_implementation(),
                       "platform": f"{platform.system()} {platform.machine()}"},
            "summary": {"ticks": ticks, "plasticity": mem and {k: mem[k] for k in (
                "samples", "discarded", "duplicates", "overrides", "would_override")}},
            "steps": steps, "checkpoints": checkpoints}


def from_copy(db_src: Path, sidecar_src: Path, life_id: str, ticks: int) -> dict:
    """A copy of a life, renamed to a research id and lived on by her patched service, recorded as `run_fixture`.

    The copy (a snapshot of a database and the plasticity sidecar read just
    before it) is copied again into a temporary directory and given the
    research id there; the copies passed in are only read. Her service then
    lives it on exactly as `drive` lives a born garden: `advance` every five
    seconds from the copy's last step, no weather fetched, no network. The
    fixture names the parent (its id, birth, tick and the copies' SHA-256) and
    holds the stored row and sidecar, so the port can restore the same copy
    itself and be compared step for step (`parity.ts`). The run is a check of
    the port, not anyone's life: Stage 4 makes a twin separately
    (`scripts/first-contact-twins.ts`).
    """
    if not life_id.startswith("research-"):
        raise SystemExit("a twin's id starts with research-")
    directory = Path(tempfile.mkdtemp(prefix="eva-twin-"))
    try:
        db = directory / "twin.sqlite3"
        shutil.copyfile(db_src, db)
        con = sqlite3.connect(str(db))
        state = json.loads(con.execute("SELECT value FROM world WHERE id=1").fetchone()[0])
        parent = {"life_id": state["life_id"], "born_at": state["born_at"], "ticks": state["ticks"],
                  "updated_at": state["updated_at"],
                  "database_sha256": hashlib.sha256(Path(db_src).read_bytes()).hexdigest(),
                  "sidecar_sha256": hashlib.sha256(Path(sidecar_src).read_bytes()).hexdigest()}
        state["life_id"] = life_id
        stored_state = json.loads(json.dumps(state))
        con.execute("UPDATE world SET value=? WHERE id=1", (json.dumps(state, separators=(",", ":")),))
        count, last_id = con.execute("SELECT COUNT(*), MAX(id) FROM moments").fetchone()
        if count != last_id:
            raise SystemExit(f"her moments are numbered with gaps ({count} of them, last id {last_id})")
        kept = [list(r) for r in con.execute(
            "SELECT id, at, words FROM moments ORDER BY id DESC LIMIT 1000").fetchall()[::-1]]
        con.commit()
        con.close()
        side = json.loads(Path(sidecar_src).read_text(encoding="utf-8"))
        if side["life_id"] != parent["life_id"] or side["born_at"] != parent["born_at"]:
            raise SystemExit("the sidecar belongs to a different life")
        mode = side["mode"]
        side["life_id"] = life_id
        sidecar = directory / ("eva" + eva_plasticity.SIDECAR_SUFFIX)
        sidecar.write_text(json.dumps(side, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n",
                           encoding="utf-8", newline="\n")

        start, tick0 = state["updated_at"], state["ticks"]
        record, steps, checkpoints = _recorder(tick0, last_id)
        p = eva_plasticity.Plasticity(mode, sidecar, db)
        world = make(patched, db, start, p)
        if p.state is None:
            raise SystemExit(f"her extension refused the copy: {p.problem}")
        record(world, p, "born")
        cls_step = type(world)._step

        def step(now, dt):
            cls_step(world, now, dt)
            record(world, p, "step")

        world._step = step  # observe after each of her steps; her code is unchanged
        t = start
        while world.state["ticks"] < tick0 + ticks:
            t += 5
            world.advance(t)
        record(world, p, "end")
        if p.state is None:
            raise SystemExit(f"her plasticity extension stopped: {p.problem}")
        mem = memory(p)
        world.close()
    finally:
        shutil.rmtree(directory, ignore_errors=True)
    return {"schema": "eva-parity/v1",
            "run": {"name": f"copy-{tick0}", "seed": None, "seed_string": state["seed"], "life_id": life_id,
                    "born": start, "plasticity": mode, "ticks": ticks, "checkpoint_every": CHECKPOINT_EVERY,
                    "from_copy": {"start_tick": tick0, "stored_state": stored_state, "stored_sidecar": side,
                                  "kept_moments": kept}},
            "parent": parent,
            "python": {"version": platform.python_version(), "implementation": platform.python_implementation(),
                       "platform": f"{platform.system()} {platform.machine()}"},
            "summary": {"ticks": world.state["ticks"], "plasticity": mem and {k: mem[k] for k in (
                "samples", "discarded", "duplicates", "overrides", "would_override")}},
            "steps": steps, "checkpoints": checkpoints}


def write_gz(path: Path, value) -> None:
    data = json.dumps(value, separators=(",", ":"), allow_nan=False).encode("utf-8")
    with open(path, "wb") as raw:
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0, compresslevel=9) as gz:
            gz.write(data)


# ------------------------------------------------------------------ vectors


def vectors() -> dict:
    out = {"python": platform.python_version(), "platform": f"{platform.system()} {platform.machine()}"}
    # random.Random: a script of draws per seed, crossing several MT twists.
    script = ([["random"], ["uniform", 18, 42], ["uniform", -.00015, .00015], ["uniform", 0, math.tau]]
              + [["choice", n] for n in (1, 2, 3, 6, 7, 2, 3)]
              + [["getrandbits", k] for k in (0, 1, 5, 31, 32, 33, 64, 100)]
              + [["random"]] * 330 + [["choice", 6]] * 20)
    seeds = ["", "a", "eva", "ünïcödé ✓ 🌱", "x" * 300, f"{research_seed(7001)}:0",
             f"{research_seed(7001)}:123456", "0123456789abcdef0123456789abcdef:19999"]
    rand = []
    for seed in seeds + [0, 1, 12345, 2 ** 32, 2 ** 100 + 7, -42]:
        r = random.Random(seed)
        results = []
        for op in script:
            if op[0] == "random":
                results.append(r.random())
            elif op[0] == "uniform":
                results.append(r.uniform(op[1], op[2]))
            elif op[0] == "choice":
                results.append(r.choice(range(op[1])))
            else:
                results.append(str(r.getrandbits(op[1])))
        rand.append({"seed": seed if isinstance(seed, str) else {"int": str(seed)}, "results": results})
    out["random"] = {"script": script, "seeds": rand}

    # round(x, n): random, her needs' actual values, exact ties and their neighbours.
    g = random.Random(20261111)
    cases = []
    for _ in range(1500):
        x = g.uniform(-120, 120) if g.random() < .2 else g.uniform(0, 120)
        n = g.choice([0, 1, 2, 3, 5, 6, 7])
        cases.append([x, n])
    e = 78.
    for i in range(1500):
        e += 5 * (.07 if (i // 300) % 2 else -.055)
        e = max(10., min(100., e))
        cases.append([e, 5])
        e = round(e, 5)
    for n in range(0, 8):
        for k in range(1, 100, 2):
            x = k / 2 ** (n + 1) + g.randrange(0, 100)
            for y in (x, math.nextafter(x, math.inf), math.nextafter(x, -math.inf), -x):
                cases.append([y, n])
    cases += [[0.015625, 5], [2.675, 2], [0.125, 2], [0.375, 2], [2.5, 0], [-2.5, 0], [1e-320, 5],
              [5e-324, 0], [1e22, 3], [123456.789, -2], [-0.0000001, 5], [0.0, 3], [-0.0, 3], [1.5, 400]]
    out["round"] = [[x, n, round(x, n)] for x, n in cases]
    halves = [k / 2 for k in range(-40, 41)] + [g.uniform(-200, 200) for _ in range(500)]
    out["round_int"] = [[x, round(x)] for x in halves]

    # math.hypot and math.dist (vector_norm), across scales.
    hyp, dist = [], []
    for _ in range(2000):
        s1, s2 = 10 ** g.uniform(-20, 2), 10 ** g.uniform(-20, 2)
        a, b = g.uniform(-1, 1) * s1, g.uniform(-1, 1) * s2
        hyp.append([a, b, math.hypot(a, b)])
        p = [g.uniform(0, 1), g.uniform(0, 1)]
        q = [p[0] + g.uniform(-.05, .05) * s1, p[1] + g.uniform(-.05, .05) * s2]
        dist.append([p, q, math.dist(p, q)])
    for a, b in ((0., 0.), (3., 4.), (0., -2.5), (1e-310, 1e-320), (5e-324, 5e-324), (1e300, 1e300),
                 (1e-300, 1e-300), (.012, 0.), (2.2250738585072014e-308, 1e-310), (1.0, 1e-17)):
        hyp.append([a, b, math.hypot(a, b)])
    out["hypot"], out["dist"] = hyp, dist

    # The New York clock and her two weather/daylight functions.
    times = []
    for base in (utc(2026, 3, 8, 6, 0), utc(2026, 3, 8, 7, 0), utc(2026, 11, 1, 5, 0),
                 utc(2026, 11, 1, 6, 0), utc(2026, 11, 1, 7, 0), utc(2026, 12, 31, 4, 59, 59)):
        times += [base + d for d in range(-7200, 7201, 450)] + [base - 1, base + 1]
    times += [g.uniform(utc(2025, 1, 1), utc(2028, 12, 31)) for _ in range(600)]
    times += [utc(2026, 11, 8, 4, 59, 59) + .9999996, utc(2026, 11, 8, 4, 59, 59) + .4999995, utc(2026, 11, 8, 3, 0) + .5]
    clock = []
    sun = {"sun": COLD_RAIN["sun"]}
    for t in times:
        local = datetime.fromtimestamp(t, patched.TZ)
        clock.append([t, local.year, local.month, local.day, local.hour, local.minute, local.second,
                      local.timetuple().tm_yday, local.strftime("%Y-%m-%d"), local.dst().total_seconds(),
                      patched.seasonal_weather(t)["temperature"], patched.daylight(t, patched.seasonal_weather(t)),
                      patched.daylight(t, sun)])
    out["clock"] = clock
    out["weather_name"] = [[c, patched.weather_name(c)] for c in range(-1, 100)]

    # libm: the sin/cos arguments her code uses (reported, not required to be bit-identical).
    trig = []
    for _ in range(500):
        now = g.uniform(utc(2026, 1, 1), utc(2026, 12, 31))
        for x in (now / 23, now / 31, now / 11, now / 17, g.uniform(0, math.tau),
                  2 * math.pi * (g.randrange(1, 367) - 80) / 365.25):
            trig.append([x, math.sin(x), math.cos(x)])
    out["trig"] = trig
    return out


# ------------------------------------------------------------------ search


def search():
    """Count active-mode swaps over a grid of research conditions (fast: sidecar writes stubbed)."""
    seasonal = None
    rain_warm = {"temperature": 12.0, "code": 61, "wind": 9.0, "rain": 1.5, "source": "search", "sun": {}}
    grid = []
    for seed in (7401, 7402, 7403):
        for born in (utc(2026, 11, 7, 15, 0), utc(2026, 7, 7, 13, 0)):
            for weather in (seasonal, rain_warm, COLD_RAIN):
                for body in ({}, {"wing_integrity": .3}, {"wing_integrity": .45}, {"leg_integrity": .4},
                             {"wing_integrity": .25, "leg_integrity": .6}, {"wetness": .9}):
                    grid.append({"name": "search", "seed": seed, "born": born, "plasticity": "active",
                                 "weather": weather, "body": body, "ticks": TICKS})
    for run in grid:
        _, mem = drive(run, lambda *a: None)
        print(json.dumps({"seed": run["seed"], "born": run["born"], "weather": (run["weather"] or {}).get("source", "seasonal"),
                          "body": run["body"], "overrides": mem["overrides"], "samples": mem["samples"],
                          "n": {k: v["n"] for k, v in mem["stats"].items()}}), flush=True)


def main(argv):
    refuse_production_host()
    eva_plasticity._atomic = _no_files
    if not argv:
        raise SystemExit(__doc__)
    mode = argv[0]
    if mode == "vectors":
        out = Path(argv[1])
        out.mkdir(parents=True, exist_ok=True)
        write_gz(out / "vectors.json.gz", vectors())
    elif mode == "runs":
        out = Path(argv[1])
        out.mkdir(parents=True, exist_ok=True)
        names = argv[2:]
        for run in RUNS:
            if names and run["name"] not in names:
                continue
            fixture = run_fixture(run)
            write_gz(out / f"run-{run['name']}.json.gz", fixture)
            print(run["name"], json.dumps(fixture["summary"]), flush=True)
    elif mode == "search":
        search()
    elif mode == "copies":
        out = Path(argv[1])
        out.mkdir(parents=True, exist_ok=True)
        for c in COPIES:
            run = next(r for r in RUNS if r["name"] == c["run"])
            directory = Path(tempfile.mkdtemp(prefix="eva-copy-"))
            try:
                db, sidecar = lived(run, directory, c["at"])
                fixture = from_copy(db, sidecar, f"research-eva-copy-{run['seed']}", c["ticks"])
            finally:
                shutil.rmtree(directory, ignore_errors=True)
            write_gz(out / f"{c['name']}.json.gz", fixture)
            print(c["name"], json.dumps(fixture["summary"]), flush=True)
    elif mode == "from-copy" and len(argv) == 6:
        db, sidecar, life_id, ticks, out = Path(argv[1]), Path(argv[2]), argv[3], int(argv[4]), Path(argv[5])
        fixture = from_copy(db, sidecar, life_id, ticks)
        out.parent.mkdir(parents=True, exist_ok=True)
        write_gz(out, fixture)
        print(json.dumps({"parent": fixture["parent"], "summary": fixture["summary"]}), flush=True)
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
