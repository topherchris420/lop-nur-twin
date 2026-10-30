"""The plasticity comparison of ``experiments/plasticity-v783.json``.

Each subject is a fresh copy of the connectome's weights (``Network.weight``);
the rule changes only KC->MBON weights, only during training trials, and only
downward. The brain's state is reset between trials (a 500 ms trial from rest,
as the reproduction experiments run), so what carries over is the weights
alone.

The repository's mushroom-body rate model is run on the same schedule by
``scripts/echo-neural-plasticity.ts``; its result file is read here and judged
with the rest.
"""

from __future__ import annotations

import hashlib
import json
import math
import zlib
from pathlib import Path

import numpy as np

from . import RESULT_SCHEMA, controls, lif, stats
from . import connectome as cx
from . import populations as P
from .record import code_state, environment, sealed, write_json
from .resources import Meter, machine

SCHEMA = "fly-neural-plasticity/v1"


def _odour_idx(c: cx.Connectome, types: list[str]) -> np.ndarray:
    return np.sort(np.concatenate([P.select_ids_in(c, {"cell_type": [t]}) for t in types]))


class Circuit:
    """The KC->MBON synapses, the PAM DANs and which MBONs each reaches."""

    def __init__(self, c: cx.Connectome, net: lif.Network, min_syn: int):
        kc, _ = P.resolve("kenyon_cells", c)
        mbon, _ = P.resolve("mbons", c)
        pam, _ = P.resolve("pam_dans", c)
        is_mbon = np.zeros(c.n, dtype=bool)
        is_mbon[mbon] = True
        indptr = net.indptr
        # KC->MBON edge positions in the (possibly rewired) network.
        pos, pre = [], []
        for i in kc:
            a, b = int(indptr[i]), int(indptr[i + 1])
            m = np.flatnonzero(is_mbon[net.indices[a:b]]) + a
            pos.append(m)
            pre.append(np.full(m.size, i, dtype=np.int64))
        self.edge = np.concatenate(pos)
        self.edge_pre = np.concatenate(pre)
        self.edge_post = net.indices[self.edge].astype(np.int64)
        # PAM -> MBON reach (from the connectome itself, never the rewired one).
        reach = {}
        for d in pam:
            t, cnt = c.out_edges(int(d))
            for j in t[(cnt >= min_syn) & is_mbon[t]]:
                reach.setdefault(int(j), []).append(int(d))
        self.reach = reach
        self.readout = np.array(sorted(reach), dtype=np.int64)
        self.kc, self.mbon, self.pam = kc, mbon, pam

    def describe(self) -> dict:
        return {
            "kenyon_cells": int(self.kc.size),
            "mbons": int(self.mbon.size),
            "pam_dans": int(self.pam.size),
            "kc_mbon_synapse_pairs": int(self.edge.size),
            "pam_innervated_mbons": int(self.readout.size),
            "pam_mbon_links": int(sum(len(v) for v in self.reach.values())),
        }

    def update(self, weight: np.ndarray, counts: np.ndarray, rule: dict, dan_silenced: bool) -> int:
        e = np.minimum(1.0, counts[self.edge_pre] / rule["e_sat"])
        D = np.zeros(counts.size)
        if not dan_silenced:
            for j, ds in self.reach.items():
                D[j] = counts[ds].sum()
        d = np.minimum(1.0, D[self.edge_post] / rule["D_sat"])
        f = 1.0 - rule["eta"] * e * d
        changed = int((f < 1.0).sum())
        weight[self.edge] *= f
        return changed


def run_subject(c, base_net, circuit, cfg, arm, seed_seq, odours):
    proto = cfg["protocol"]
    if arm["wiring"] == "connectome":
        net = lif.Network(c)
        net.weight = base_net.weight.copy()
        circ = circuit
    else:
        w_seed, seed_seq = seed_seq.spawn(2)
        w, _ = controls.wiring(c, arm["wiring"], int(w_seed.generate_state(1)[0]))
        net = lif.Network(c, wiring=w, label=arm["wiring"])
        circ = Circuit(c, net, cfg["rule"]["dan_mbon_min_synapses"])
    rng = np.random.default_rng(seed_seq)
    silenced = circuit.pam if arm["silence_dans"] else np.zeros(0, dtype=np.int64)

    def trial(odour, reward):
        poi = [lif.Poisson(odours[odour], proto["odour_rate_hz"], label=odour)]
        if reward:
            poi.append(lif.Poisson(circuit.pam, proto["reward_rate_hz"], label="PAM"))
        t, _ = lif.run(net, lif.Stimulus(poisson=poi, silenced=silenced), proto["trial_ms"], rng=rng)
        return t.counts

    def test():
        out = {}
        for o in ("A", "B"):
            out[o] = [int(trial(o, False)[circ.readout].sum()) for _ in range(proto["test_trials_per_odour"])]
        return out

    before = test()
    changed, kc_active = [], []
    for _ in range(proto["training_pairs"]):
        for o, rew in (("A", True), ("B", False)):
            counts = trial(o, rew)
            kc_active.append(int((counts[circuit.kc] > 0).sum()))
            if arm["plastic"]:
                changed.append(circ.update(net.weight, counts, cfg["rule"], arm["silence_dans"]))
    after = test()
    mean = lambda xs: float(np.mean(xs))  # noqa: E731
    ratio = lambda a, b: (a / b) if b > 0 else None  # noqa: E731
    ra, rb = ratio(mean(after["A"]), mean(before["A"])), ratio(mean(after["B"]), mean(before["B"]))
    return {
        "before": before,
        "after": after,
        "li": None if ra is None or rb is None else ra - rb,
        "kc_active_per_training_trial": stats.summary(kc_active),
        "synapses_depressed_per_update": stats.summary(changed) if changed else None,
    }


def sign_test_negative(xs: list[float]) -> float:
    """One-sided sign test: P(at least k of n negative | p = 1/2)."""
    n = len(xs)
    k = sum(x < 0 for x in xs)
    return sum(math.comb(n, i) for i in range(k, n + 1)) / 2**n


def judge(crit, arms, echo_mb):
    out = {"id": crit["id"], "claim": crit["claim"], "test": crit["test"], "threshold_note": crit.get("threshold_note")}
    lis = lambda a: [s["li"] for s in arms[a]["subjects"] if s["li"] is not None]  # noqa: E731
    t = crit["test"]
    if t == "readout_responds":
        m = {o: float(np.mean([np.mean(s["before"][o]) for s in arms[crit["arm"]]["subjects"]])) for o in ("A", "B")}
        out.update(mean_spikes_before=m, passed=all(v >= crit["min_mean_spikes"] for v in m.values()))
    elif t == "li_negative":
        x = lis(crit["arm"])
        p = sign_test_negative(x) if x else 1.0
        out.update(li=x, negative=sum(v < 0 for v in x), n=len(x), sign_test_p=p, passed=bool(x) and p < crit["alpha"])
    elif t == "li_less":
        a, b = lis(crit["a"]), lis(crit["b"])
        mw = stats.mann_whitney(a, b, "less") if a and b else {"p": 1.0}
        out.update(a_li=a, b_li=b, mann_whitney=mw, passed=bool(a and b) and mw["p"] < crit["alpha"])
    elif t == "echo_mb_discriminates":
        if echo_mb is None:
            out.update(passed=False, note="no ECHO mushroom-body result given")
        else:
            d = [s["after"]["A"] - s["after"]["B"] for s in echo_mb["arms"]["as-is"]]
            z = [s["after"]["A"] - s["after"]["B"] for s in echo_mb["arms"]["reward-omitted"]]
            out.update(after_A_minus_B=d, reward_omitted_after_A_minus_B=z, passed=all(v > crit["margin"] for v in d) and not any(v > crit["margin"] for v in z))
    elif t == "report_only":
        x = lis(crit["arm"])
        out.update(li=x, passed=True, note="exploratory: always reported, never failed")
    return out


def run(cfg_path: Path, split: str, compiled: Path, out_dir: Path, echo_mb_path: Path | None, subjects: int | None = None, log=print) -> dict:
    cfg = json.loads(Path(cfg_path).read_text(encoding="utf-8"))
    if cfg.get("schema") != SCHEMA:
        raise ValueError(f"{cfg_path} is not a {SCHEMA} file")
    c = cx.load(compiled)
    base = lif.Network(c)
    circuit = Circuit(c, base, cfg["rule"]["dan_mbon_min_synapses"])
    odours = {k: _odour_idx(c, v) for k, v in cfg["odours"].items() if k in ("A", "B")}
    n_sub = subjects or cfg["subjects_per_split"]
    base_seed = int(cfg["seeds"][split])
    arms = {}
    with Meter() as meter:
        for arm in cfg["arms"]:
            subs = []
            for s in range(n_sub):
                ss = np.random.SeedSequence([base_seed, zlib.crc32(arm["name"].encode()), s])
                # The same subject seed across arms where the wiring is the same, so arms differ only by the arm.
                if arm["wiring"] == "connectome":
                    ss = np.random.SeedSequence([base_seed, s])
                subs.append(run_subject(c, base, circuit, cfg, arm, ss, odours))
                log(f"  {arm['name']} subject {s}: LI {subs[-1]['li']}")
            arms[arm["name"]] = {"arm": arm, "subjects": subs, "li": stats.summary([x["li"] for x in subs if x["li"] is not None])}
    echo_mb = json.loads(Path(echo_mb_path).read_text(encoding="utf-8")) if echo_mb_path else None
    verdicts = [judge(cr, arms, echo_mb) for cr in cfg["criteria"]]
    body = {
        "schema": RESULT_SCHEMA,
        "kind": "plasticity",
        "experiment": cfg["id"],
        "config_file": Path(cfg_path).name,
        "config_sha256": hashlib.sha256(Path(cfg_path).read_bytes().replace(b"\r\n", b"\n")).hexdigest(),
        "split": split,
        "subjects": n_sub,
        "partial": subjects is not None and subjects != cfg["subjects_per_split"],
        "connectome": {"path_name": Path(compiled).name, "manifest_sha256": c.manifest.get("sha256")},
        "circuit": circuit.describe(),
        "odour_neurons": {k: int(v.size) for k, v in odours.items()},
        "arms": arms,
        "echo_mushroom_body": echo_mb,
        "criteria": verdicts,
        "failed": [v["id"] for v in verdicts if not v["passed"]],
        "resources": {**meter.describe(), "machine": machine()},
        "environment": environment(),
        "code": code_state(out_dir),
    }
    data = sealed(body)
    name = f"{cfg['id']}-{split}{'-partial' if body['partial'] else ''}.json"
    write_json(out_dir / name, data)
    log(f"wrote {out_dir / name}; failed {data['failed']}")
    return data
