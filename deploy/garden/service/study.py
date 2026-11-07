"""A seeded study of Eva's embodied plasticity on disposable research gardens.

Never Eva, a copy of her database or anything on her VM: every garden here is born
in a temporary directory by her original service and given a research identity.

Arms:
  original     her original service (original/server.py), unchanged
  shadow       the patched service with eva-embodied-plasticity/v1 in shadow mode
  active       the same in active mode
  no-learning  ablation: the original service with her learned gains held at their
               prior after every step, to show what her own learning contributes

Conditions (each two simulated days from the same research birth):
  autumn       7 November, seasonal weather
  rain         7 November, steady rain all run (her wings get wet in flight)
  weak-wings   7 November, wing integrity 0.35 at the start
  weak-legs    7 November, leg integrity 0.4 at the start
  winter       15 January, seasonal weather (cold)
  restart      autumn, with the service stopped and started at hour 24; it must end
               exactly as the arm's uninterrupted autumn run

PLAN holds seeds, metrics, the primary question and the decision rule; it was
fixed before any held-out run.

  python study.py run --split dev|heldout --shard I/N --out FILE
  python study.py collect --split dev|heldout FILE...
  python study.py report --split dev|heldout
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import platform
import random
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import eva_plasticity  # noqa: E402
import learning  # noqa: E402
import server as patched  # noqa: E402


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


original = _load("eva_original_server", HERE / "original" / "server.py")

ARMS = ("original", "shadow", "active", "no-learning")
CONDITIONS = ("autumn", "rain", "weak-wings", "weak-legs", "winter", "restart")
PLAN = {
    "study": "eva-plasticity-study/v1",
    "brain": eva_plasticity.VERSION,
    "params": eva_plasticity.PARAMS,
    "arms": ARMS,
    "conditions": CONDITIONS,
    "hours": 48,
    "restart_hour": 24,
    # Dev seed 7001 was looked at while the code was written: active never swapped there,
    # because her own choice and its evidence agreed (fly beat walk even with limited wings).
    "seeds": {"dev": [7001, 7002, 7003, 7004], "heldout": list(range(7101, 7113))},
    "primary": {
        "question": "With weak wings, does active plasticity change the number of journeys Eva completes, relative to her original service?",
        "metric": "arrivals",
        "condition": "weak-wings",
        "contrast": ["active", "original"],
        "rule": "Claim a benefit only if the 95% bootstrap interval of the paired mean difference (active minus original) lies above zero; a harm only if it lies below; otherwise no difference is established. Every other contrast is secondary and reported the same way, without a claim.",
    },
    "shadow_check": "identical world row and moments to the original, every run",
    "bootstrap": {"resamples": 10000, "seed": 20261108},
}
METRICS = ("arrivals", "departures", "mean_journey_s", "stalls", "distance", "mean_energy",
           "min_fullness", "min_water", "hungry_share", "fly_steps", "walk_steps")
HIGHER_BETTER = {"arrivals", "mean_energy", "min_fullness", "min_water"}
LOWER_BETTER = {"mean_journey_s", "stalls", "hungry_share"}
RAIN = {"temperature": 12.0, "code": 61, "wind": 9.0, "rain": 1.5, "source": "study", "sun": {}}
STALL = "The journey asks too much for now. Pauses to recover."


def start_of(condition: str) -> float:
    if condition == "winter":
        return datetime(2026, 1, 15, 15, 0, tzinfo=timezone.utc).timestamp()
    return datetime(2026, 11, 7, 15, 0, tzinfo=timezone.utc).timestamp()


def make(module, db, now, plasticity=None):
    world = module.World.__new__(module.World)
    if plasticity is not None:
        world.plasticity = plasticity
    world.__init__(str(db), now)
    world.db.execute("PRAGMA synchronous=OFF")  # research speed only
    return world


def birth(directory: Path, seed: int, condition: str) -> Path:
    """A research garden born by her original service, then given its research identity."""
    db = directory / "born.sqlite3"
    now = start_of(condition)
    world = make(original, db, now)
    s = world.state
    s["life_id"] = f"research-{seed}"
    s["seed"] = hashlib.sha256(f"eva research {seed}".encode()).hexdigest()[:32]
    if condition == "weak-wings":
        s["body"]["wing_integrity"] = 0.35
    if condition == "weak-legs":
        s["body"]["leg_integrity"] = 0.4
    world._save()
    world.close()
    return db


def run(split: str, seed: int, arm: str, condition: str) -> dict:
    directory = Path(tempfile.mkdtemp(prefix="eva-study-"))
    try:
        db = birth(directory, seed, condition)
        now = start_of(condition)
        sidecar = directory / ("eva" + eva_plasticity.SIDECAR_SUFFIX)

        def open_world(at):
            if arm in ("shadow", "active"):
                p = eva_plasticity.Plasticity(arm, sidecar, db)
                return make(patched, db, at, p), p
            return make(original, db, at), None

        world, plasticity = open_world(now)
        end = now + PLAN["hours"] * 3600
        restart_at = now + PLAN["restart_hour"] * 3600 if condition == "restart" else None
        energy_sum = steps = hungry = fly = walk = 0
        min_fullness = min_water = 100.0
        journey_start = None
        durations = []
        t = now
        while t + 5 <= end:
            t += 5
            if condition == "rain" and (t - now) % 3600 == 5:
                world.set_weather({**RAIN, "fetched_at": t})
            world.advance(t)
            s = world.state
            if arm == "no-learning":
                for m in s["learning"]["models"].values():
                    m["gain"] = 0.006
            steps += 1
            energy_sum += s["energy"]
            min_fullness, min_water = min(min_fullness, s["fullness"]), min(min_water, s["water"])
            hungry += s["fullness"] < 32
            last = s["learning"].get("last") or {}
            if s["travel"] and last.get("at") == s["updated_at"]:
                fly += last.get("action") == "fly"
                walk += last.get("action") == "walk"
            if s["travel"] and journey_start is None:
                journey_start = s["travel"]["started_at"]
            if not s["travel"] and journey_start is not None:
                durations.append(t - journey_start)
                journey_start = None
            if restart_at is not None and t >= restart_at:
                world.close()
                world, plasticity = open_world(t)
                restart_at = None
        s = world.state
        stalls = world.db.execute("SELECT COUNT(*) FROM moments WHERE words=?", (STALL,)).fetchone()[0]
        row = world.db.execute("SELECT value FROM world WHERE id=1").fetchone()[0]
        moments = world.db.execute("SELECT at, words FROM moments ORDER BY id").fetchall()
        record = {
            "study": PLAN["study"], "split": split, "seed": seed, "arm": arm, "condition": condition,
            "ticks": s["ticks"],
            "arrivals": sum(s["visits"].values()) - 1,
            "departures": s["journeys"],
            "mean_journey_s": sum(durations) / len(durations) if durations else None,
            "stalls": stalls,
            "distance": s["distance"],
            "mean_energy": energy_sum / max(1, steps),
            "min_fullness": min_fullness,
            "min_water": min_water,
            "hungry_share": hungry / max(1, steps),
            "fly_steps": fly,
            "walk_steps": walk,
            "plasticity": plasticity.status() if plasticity else None,
            "row_hash": hashlib.sha256(row.encode()).hexdigest(),
            "moments_hash": hashlib.sha256(json.dumps(moments).encode()).hexdigest(),
        }
        if record["plasticity"]:
            for k in ("saved_at", "last_daily_copy_at"):
                record["plasticity"].pop(k, None)
        world.close()
        return record
    finally:
        shutil.rmtree(directory, ignore_errors=True)


def runs_of(split: str):
    return [(seed, arm, c) for seed in PLAN["seeds"][split] for c in CONDITIONS for arm in ARMS]


def bootstrap(diffs, metric):
    n = len(diffs)
    rng = random.Random(PLAN["bootstrap"]["seed"])
    means = sorted(sum(diffs[rng.randrange(n)] for _ in range(n)) / n for _ in range(PLAN["bootstrap"]["resamples"])) if n else []
    sign = 1 if metric in HIGHER_BETTER else -1 if metric in LOWER_BETTER else 0
    q = lambda p: means[min(len(means) - 1, int(p * len(means)))] if means else None  # noqa: E731
    return {"n": n, "mean": sum(diffs) / n if n else None, "low": q(0.025), "high": q(0.975),
            "better": sum(1 for d in diffs if d * sign > 1e-12) if sign else 0,
            "worse": sum(1 for d in diffs if d * sign < -1e-12) if sign else 0,
            "tied": sum(1 for d in diffs if abs(d) <= 1e-12)}


def summarize(records, split):
    by = {}
    for r in records:
        key = (r["condition"], r["seed"])
        if r["arm"] in by.setdefault(key, {}):
            raise ValueError(f"two records for {key} {r['arm']}")
        by[key][r["arm"]] = r
    contrasts = []
    for condition in CONDITIONS:
        for arm in ARMS[1:]:
            for metric in METRICS:
                diffs, missing = [], 0
                for (c, _), arms in by.items():
                    if c != condition:
                        continue
                    a, o = arms.get(arm, {}).get(metric), arms.get("original", {}).get(metric)
                    if a is None or o is None:
                        missing += 1
                    else:
                        diffs.append(a - o)
                contrasts.append({"condition": condition, "arm": arm, "metric": metric,
                                  "interval": bootstrap(diffs, metric), "missing": missing})
    shadow = {"runs": 0, "identical": 0, "differing": []}
    for (c, seed), arms in by.items():
        if "shadow" in arms and "original" in arms:
            shadow["runs"] += 1
            same = all(arms["shadow"][k] == arms["original"][k] for k in ("row_hash", "moments_hash", *METRICS))
            shadow["identical"] += same
            if not same:
                shadow["differing"].append([c, seed])
    restart = {"runs": 0, "identical": 0}
    for (c, seed), arms in by.items():
        if c != "restart":
            continue
        for arm, r in arms.items():
            straight = by.get(("autumn", seed), {}).get(arm)
            if straight:
                restart["runs"] += 1
                restart["identical"] += r["row_hash"] == straight["row_hash"] and r["moments_hash"] == straight["moments_hash"]
    p = PLAN["primary"]
    primary = next(c for c in contrasts if c["condition"] == p["condition"] and c["arm"] == p["contrast"][0] and c["metric"] == p["metric"])
    i = primary["interval"]
    verdict = ("benefit" if i["low"] is not None and i["low"] > 0 else
               "harm" if i["high"] is not None and i["high"] < 0 else "no difference established")
    means = {c: {a: {m: (lambda v: sum(v) / len(v) if v else None)(
        [r[m] for r in records if r["condition"] == c and r["arm"] == a and r[m] is not None]) for m in METRICS}
        for a in ARMS} for c in CONDITIONS}
    learned = {}
    for c in CONDITIONS:
        for a in ("shadow", "active"):
            rows = [r["plasticity"] for r in records if r["condition"] == c and r["arm"] == a and r["plasticity"]]
            if rows:
                learned[f"{c}|{a}"] = {k: sum(x.get(k) or 0 for x in rows) / len(rows)
                                       for k in ("samples", "discarded", "overrides", "would_override")}
                learned[f"{c}|{a}"]["ok"] = sum(x["status"] == "ok" for x in rows)
    return {"study": PLAN["study"], "split": split, "runs": len(records),
            "seeds": len({r["seed"] for r in records}), "shadow": shadow, "restart": restart,
            "primary": {"contrast": primary, "verdict": verdict}, "contrasts": contrasts,
            "means": means, "plasticity": learned}


def f(x, d=2):
    return "—" if x is None else f"{x:.{d}f}"


def render(s, machine):
    P = s["primary"]["contrast"]["interval"]
    out = [f"# Eva embodied plasticity: {s['split']} results", "",
           "Generated by `deploy/garden/service/study.py report` from the records in this folder. Do not edit by hand.", "",
           f"- Study `{s['study']}`, brain `{PLAN['brain']}`, {s['runs']} runs, {s['seeds']} seeds, {PLAN['hours']} simulated hours each.",
           f"- Code: `{machine['commit']}`{'' if machine['clean'] else ' (sources not clean)'}; machine: {machine['platform']}, Python {machine['python']}.",
           "- Research gardens only, born by her original service; never Eva or a copy of her database.", "",
           "## Primary question (fixed before the held-out run)", "", f"> {PLAN['primary']['question']}", "",
           f"Active minus original, arrivals, weak-wings: mean {f(P['mean'])} (95% CI {f(P['low'])} to {f(P['high'])}), n = {P['n']}; active better on {P['better']}, worse on {P['worse']}, tied on {P['tied']}.", "",
           f"**Verdict: {s['primary']['verdict']}.** {PLAN['primary']['rule']}", "",
           "## Hard checks", "",
           f"- Shadow mode identical to her original service (world row, every moment, every metric): **{s['shadow']['identical']} of {s['shadow']['runs']}** paired runs.",
           f"- A stop and start at hour {PLAN['restart_hour']} ended exactly as the uninterrupted run, every arm: **{s['restart']['identical']} of {s['restart']['runs']}**.", "",
           "## Every contrast against the original (secondary, no claims)", ""]
    for c in CONDITIONS:
        out += [f"### {c}", "", "| metric | arm | mean diff | 95% CI | better / worse / tied | missing |", "| --- | --- | ---: | --- | --- | ---: |"]
        for x in s["contrasts"]:
            if x["condition"] == c and x["arm"] != "shadow":
                i = x["interval"]
                out.append(f"| {x['metric']} | {x['arm']} | {f(i['mean'], 3)} | {f(i['low'], 3)} to {f(i['high'], 3)} | {i['better']} / {i['worse']} / {i['tied']} | {x['missing']} |")
        out.append("")
    out += ["## Means per arm", "", "| condition | arm | arrivals | journey s | stalls | distance | mean energy | min fullness | hungry share | fly steps | walk steps |",
            "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"]
    for c in CONDITIONS:
        for a in ARMS:
            m = s["means"][c][a]
            out.append(f"| {c} | {a} | {f(m['arrivals'], 1)} | {f(m['mean_journey_s'], 0)} | {f(m['stalls'], 2)} | {f(m['distance'], 2)} | {f(m['mean_energy'], 1)} | {f(m['min_fullness'], 1)} | {f(m['hungry_share'], 3)} | {f(m['fly_steps'], 0)} | {f(m['walk_steps'], 0)} |")
    out += ["", "## What the plasticity did (means per run)", "", "| condition | arm | evidence steps | discarded | swaps | would have swapped | runs ok |", "| --- | --- | ---: | ---: | ---: | ---: | ---: |"]
    for k, v in s["plasticity"].items():
        c, a = k.split("|")
        out.append(f"| {c} | {a} | {f(v['samples'], 0)} | {f(v['discarded'], 0)} | {f(v['overrides'], 1)} | {f(v['would_override'], 1)} | {v['ok']} |")
    return "\n".join(out) + "\n"


def main(argv):
    mode = argv[0]
    opt = lambda name: argv[argv.index(f"--{name}") + 1] if f"--{name}" in argv else None  # noqa: E731
    split = opt("split")
    if split not in ("dev", "heldout"):
        raise SystemExit("--split dev|heldout")
    folder = HERE.parents[2] / "docs" / "benchmarks" / "eva-plasticity" / split
    if mode == "run":
        i, n = map(int, (opt("shard") or "0/1").split("/"))
        with open(opt("out"), "a", encoding="utf-8", newline="\n") as out:
            for k, (seed, arm, c) in enumerate(runs_of(split)):
                if k % n == i:
                    out.write(json.dumps(run(split, seed, arm, c), sort_keys=True, separators=(",", ":")) + "\n")
                    out.flush()
    elif mode == "collect":
        files = [a for j, a in enumerate(argv[1:], 1) if not a.startswith("--") and argv[j - 1] != "--split"]
        records = [json.loads(line) for p in files for line in Path(p).read_text(encoding="utf-8").splitlines() if line]
        if len(records) != len(runs_of(split)):
            raise SystemExit(f"expected {len(runs_of(split))} records, have {len(records)}")
        records.sort(key=lambda r: (r["condition"], r["seed"], ARMS.index(r["arm"])))
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "records.jsonl").write_text("".join(json.dumps(r, sort_keys=True, separators=(",", ":")) + "\n" for r in records), encoding="utf-8", newline="\n")
        git = lambda *a: subprocess.run(["git", *a], capture_output=True, text=True, cwd=HERE).stdout.strip()  # noqa: E731
        machine = {"commit": git("rev-parse", "HEAD"), "clean": git("status", "--porcelain", "--", ".") == "",
                   "platform": f"{platform.system()} {platform.machine()}", "python": platform.python_version(), "plan": PLAN}
        (folder / "machine.json").write_text(json.dumps(machine, indent=2) + "\n", encoding="utf-8", newline="\n")
    elif mode == "report":
        records = [json.loads(line) for line in (folder / "records.jsonl").read_text(encoding="utf-8").splitlines() if line]
        machine = json.loads((folder / "machine.json").read_text(encoding="utf-8"))
        s = summarize(records, split)
        (folder / "summary.json").write_text(json.dumps(s, indent=2) + "\n", encoding="utf-8", newline="\n")
        (folder / "README.md").write_text(render(s, machine), encoding="utf-8", newline="\n")
    else:
        raise SystemExit("mode is run, collect or report")


if __name__ == "__main__":
    main(sys.argv[1:])
