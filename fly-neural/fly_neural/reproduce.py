"""Baseline reproduction: re-run the sealed connectome results this work starts from, and compare.

Before anything changes, the three limitations the adaptive-intelligence work
addresses are re-derived on the current commit from the same inputs:

- the looms replay (194 giant-fiber false alarms, 3 hits, 2 misses),
- the food replay (feed readout agreement 28%),
- the plasticity comparison's dev subjects (nonselective depression, KC
  overlap 0.955).

Each recording is re-made by ``scripts/echo-neural-shadow.ts`` (deterministic
in its seed) and must have the SHA-256 the sealed result names; each replay
and each plasticity subject must give the sealed numbers exactly, since every
one has fixed seeds. The comparison is written as a sealed result; nothing
here edits or replaces an earlier result.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np

from . import RESULT_SCHEMA, lif, plasticity, shadow
from . import connectome as cx
from .record import code_watch, environment, load_sealed, sealed, write_json
from .resources import Meter, machine

SCHEMA = "fly-neural-reproduction/v1"


def _sha256(p: Path) -> str:
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def replay(results: Path, work: Path, compiled: Path, scenario: str, log=print) -> dict:
    old = load_sealed(results / f"shadow-{scenario}-101-neural-shadow.json", RESULT_SCHEMA)
    rec = work / "shadow" / f"{scenario}-101-neural-shadow.jsonl"
    if not rec.exists():
        return {"scenario": scenario, "ran": False, "note": f"{rec} missing: record it with scripts/echo-neural-shadow.ts first"}
    sha = _sha256(rec)
    if sha != old["recording"]["sha256"]:
        return {"scenario": scenario, "ran": False, "recording_sha256": sha, "sealed_recording_sha256": old["recording"]["sha256"], "identical": False}
    new = shadow.analyse(rec, compiled, work / "reproduce", seed=int(old["seed"]), log=log)
    return {
        "scenario": scenario,
        "ran": True,
        "sealed_result": f"shadow-{scenario}-101-neural-shadow.json",
        "sealed_result_sha256": old["sha256"],
        "recording_sha256": sha,
        "recording_identical": True,
        "comparison": new["comparison"],
        "sealed_comparison": old["comparison"],
        "identical": new["comparison"] == old["comparison"],
        "wall_s": new["resources"]["wall_s"],
    }


def plasticity_subjects(results: Path, cfg_path: Path, compiled: Path, arms: tuple[str, ...], subjects: int, log=print) -> dict:
    old = load_sealed(results / "plasticity-v783-dev-partial.json", RESULT_SCHEMA)
    cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
    c = cx.load(compiled)
    base = lif.Network(c)
    circuit = plasticity.Circuit(c, base, cfg["rule"]["dan_mbon_min_synapses"])
    odours = {k: plasticity._odour_idx(c, v) for k, v in cfg["odours"].items() if k in ("A", "B")}
    base_seed = int(cfg["seeds"]["dev"])
    out = []
    by_name = {a["name"]: a for a in cfg["arms"]}
    for name in arms:
        arm = by_name[name]
        for s in range(subjects):
            ss = np.random.SeedSequence([base_seed, s])
            with Meter() as m:
                new = plasticity.run_subject(c, base, circuit, cfg, arm, ss, odours)
            was = old["arms"][name]["subjects"][s]
            keys = ("before", "after", "li", "kc_overlap_first_trials", "kc_active_per_training_trial", "synapses_depressed_per_update")
            same = {k: new[k] == was[k] for k in keys}
            out.append({"arm": name, "subject": s, "identical": all(same.values()), "fields": same, "li": new["li"], "sealed_li": was["li"], "kc_overlap_first_trials": new["kc_overlap_first_trials"], "wall_s": round(m.wall_s, 2)})
            log(f"  plasticity {name}/{s}: identical {all(same.values())}")
    return {"sealed_result": "plasticity-v783-dev-partial.json", "sealed_result_sha256": old["sha256"], "config_sha256": old["config_sha256"], "subjects": out, "identical": all(x["identical"] for x in out)}


def run(results: Path, work: Path, compiled: Path, out_dir: Path, scenarios: tuple[str, ...], plasticity_arms: tuple[str, ...], plasticity_n: int, log=print) -> dict:
    code = code_watch(out_dir)
    cfg_path = Path(__file__).resolve().parents[1] / "experiments" / "plasticity-v783.json"
    with Meter() as meter:
        replays = [replay(results, work, compiled, s, log) for s in scenarios]
        plast = plasticity_subjects(results, cfg_path, compiled, plasticity_arms, plasticity_n, log) if plasticity_arms else None
    body = {
        "schema": RESULT_SCHEMA,
        "kind": "reproduction",
        "reproduction_schema": SCHEMA,
        "what": "The sealed baseline results re-run on this commit, from the same inputs and seeds; each must match exactly.",
        "replays": replays,
        "plasticity": plast,
        "identical": all(r.get("identical") for r in replays) and (plast is None or plast["identical"]),
        "resources": {**meter.describe(), "machine": machine()},
        "environment": environment(),
        "code": code(),
    }
    data = sealed(body)
    write_json(out_dir / "baseline-reproduction.json", data)
    log(f"wrote {out_dir / 'baseline-reproduction.json'}: identical {data['identical']}")
    return data
