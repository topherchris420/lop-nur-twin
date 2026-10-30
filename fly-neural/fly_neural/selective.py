"""Selective associative learning on the connectome's mushroom body: ``experiments/plasticity-v2-v783.json``.

``plasticity-v783`` (rule v1) depressed the KC -> MBON synapses of both odours
alike. Two causes were measured there: the odours share 95.5% of their Kenyon
cells, and odour input alone drives the PAM dopaminergic neurons, so every
unrewarded trial depressed synapses too. This module tests a rule that answers
both, and takes it apart:

- **Representation** (``mbcode.Representation``): the sparse KC code selected
  by the pre-registered sweep of ``mb-representation-v783.json``, or Shiu et
  al.'s weights as they are (``dense``).
- **Rule v2**, per KC -> MBON synapse ``ij`` of the PAM-innervated readout
  MBONs, after each training trial (10 ms bins ``b``):

  - eligibility: each KC spike adds ``1/e_sat`` to a trace that decays with
    ``tau_e`` and is capped at 1: ``e_i(b)``. Its peak in the trial is ``E_i``.
  - dopamine: ``g_j(b) = 1`` when the PAM neurons reaching MBON ``j`` (at least
    ``dan_mbon_min_synapses`` synapses, as v1 reads them) fire at a mean rate
    of at least ``theta_hz`` in bin ``b``, else 0. ``theta_hz`` comes from the
    development calibration (``calibrate``), never from a held-out run.
  - pairing: ``P_ij = min(1, sum_b e_i(b) g_j(b) dt / t_r)``; the compartment's
    reinforcement in the trial: ``R_j = min(1, sum_b g_j(b) dt / t_r)``.
  - a depression state ``V_ij`` in [0, 1] (the synapse's stored prediction
    that dopamine follows its KC):
    ``V += eta_dep P (1 - V) - eta_ext E_i (1 - R_j) V``, and the weight is
    ``w0 (1 - (1 - floor) V)``.

  With pairing and reinforcement either full or absent, this is a
  Rescorla-Wagner update per synapse, ``dV = eta (R - V)`` gated by the KC's
  eligibility: reward drives ``V`` toward 1 (acquisition), and an active KC
  whose compartment gets no reinforcement drives it back toward 0 in
  proportion to what it predicted (extinction, reversal). Weights never fall
  below ``floor`` of their naive value, never rise above it and never change
  sign. The trace links odour to a later reward (trace conditioning); the
  threshold keeps odour-evoked PAM activity from counting as reward.
- **Rule v1**, unchanged from ``plasticity.Circuit.update``: depression only,
  ``w *= 1 - eta min(1, e/e_sat) min(1, D/D_sat)``.

Every constant is ours (``status: model`` in the config) and none was fitted
to a learning result. Each subject is a fresh copy of the weights; the brain's
state is reset between trials (500 ms from rest, as before), so what carries
over is the synaptic state alone.
"""

from __future__ import annotations

import copy
import hashlib
import json
import math
import time
import zlib
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from . import RESULT_SCHEMA, lif, stats
from . import connectome as cx
from .mbcode import Groups, Representation, apply
from .record import append_progress, code_watch, environment, load_sealed, resume_progress, sealed, write_json
from .resources import Meter, machine

SCHEMA = "fly-neural-plasticity/v2"


@dataclass(frozen=True)
class RuleV2:
    eta_dep: float
    eta_ext: float
    floor: float
    e_sat: float
    tau_e_s: float
    t_r_s: float
    theta_hz: float
    bin_ms: float = 10.0
    da_window_ms: float = 50.0


class Synapses:
    """The KC -> readout-MBON synapses of one subject's network, and their learning state."""

    def __init__(self, net: lif.Network, g: Groups):
        is_ro = np.zeros(net.n, dtype=bool)
        is_ro[g.readout] = True
        kc_row = np.full(net.n, -1, dtype=np.int64)
        kc_row[g.kc] = np.arange(g.kc.size)
        ro_col = np.full(net.n, -1, dtype=np.int64)
        ro_col[g.readout] = np.arange(g.readout.size)
        pos, pre = [], []
        for i in g.kc:
            a, b = int(net.indptr[i]), int(net.indptr[i + 1])
            m = np.flatnonzero(is_ro[net.indices[a:b]]) + a
            pos.append(m)
            pre.append(np.full(m.size, i, dtype=np.int64))
        self.pos = np.concatenate(pos) if pos else np.zeros(0, dtype=np.int64)
        self.pre = np.concatenate(pre) if pre else np.zeros(0, dtype=np.int64)
        self.post = np.asarray(net.indices)[self.pos].astype(np.int64)
        self.row = kc_row[self.pre]
        self.col = ro_col[self.post]
        self.w0 = net.weight[self.pos].copy()
        self.V = np.zeros(self.pos.size)
        self.kc_row, self.ro_col = kc_row, ro_col
        # PAM neurons reaching each readout MBON, as columns of a (pam x readout) incidence matrix.
        pam_col = np.full(net.n, -1, dtype=np.int64)
        pam_col[g.pam] = np.arange(g.pam.size)
        self.pam_col = pam_col
        inc = np.zeros((g.pam.size, g.readout.size))
        for j, ds in g.reach.items():
            inc[pam_col[np.asarray(ds)], ro_col[j]] = 1.0
        self.reach = inc
        self.reach_n = inc.sum(axis=0)

    def write(self, net: lif.Network, floor: float) -> None:
        net.weight[self.pos] = self.w0 * (1.0 - (1.0 - floor) * self.V)

    def describe(self) -> dict:
        return {"kc_readout_synapse_pairs": int(self.pos.size), "readout_mbons": int(self.reach.shape[1]), "pam_links": int(self.reach.sum())}


def binned(trial: lif.Trial, idx_map: np.ndarray, rows: int, bins: int, bin_ms: float, dt_ms: float) -> np.ndarray:
    """Spike counts of the logged neurons that ``idx_map`` maps to rows, per bin: (rows x bins)."""
    out = np.zeros((rows, bins))
    if trial.spikes_logged.size:
        step, neuron = trial.spikes_logged[:, 0], trial.spikes_logged[:, 1]
        r = idx_map[neuron]
        keep = r >= 0
        b = np.minimum((step[keep] * dt_ms / bin_ms).astype(np.int64), bins - 1)
        np.add.at(out, (r[keep], b), 1.0)
    return out


def compartment_rate(syn: "Synapses", pam_bins: np.ndarray, bin_ms: float, window_ms: float) -> np.ndarray:
    """Mean rate (Hz) of the PAM neurons reaching each readout MBON, over a causal window ending at each bin."""
    w = max(1, int(round(window_ms / bin_ms)))
    s = syn.reach.T @ pam_bins
    cs = np.cumsum(s, axis=1)
    win = cs - np.concatenate([np.zeros((s.shape[0], w)), cs[:, :-w]], axis=1) if s.shape[1] > w else cs
    span = np.minimum(np.arange(1, s.shape[1] + 1), w) * bin_ms / 1000.0
    return win / np.maximum(1.0, syn.reach_n)[:, None] / span[None, :]


def eligibility(kc_bins: np.ndarray, rule: RuleV2) -> np.ndarray:
    lam = math.exp(-rule.bin_ms / 1000.0 / rule.tau_e_s) if rule.tau_e_s > 0 else 0.0
    e = np.zeros_like(kc_bins)
    prev = np.zeros(kc_bins.shape[0])
    for b in range(kc_bins.shape[1]):
        prev = np.minimum(1.0, prev * lam + kc_bins[:, b] / rule.e_sat)
        e[:, b] = prev
    return e


def update_v2(syn: Synapses, kc_bins: np.ndarray, pam_bins: np.ndarray, rule: RuleV2, dopamine_blocked: bool) -> dict:
    """One trial's update of ``syn.V`` (rule v2). Returns what changed, for the record."""
    dt = rule.bin_ms / 1000.0
    e = eligibility(kc_bins, rule)
    E = e.max(axis=1)
    if dopamine_blocked:
        G = np.zeros((syn.reach.shape[1], kc_bins.shape[1]))
    else:
        G = (compartment_rate(syn, pam_bins, rule.bin_ms, rule.da_window_ms) >= rule.theta_hz).astype(np.float64)
    R = np.minimum(1.0, G.sum(axis=1) * dt / rule.t_r_s)
    Pm = np.minimum(1.0, (e @ G.T) * dt / rule.t_r_s)  # (KCs x readout MBONs)
    p = Pm[syn.row, syn.col]
    ext = E[syn.row] * (1.0 - R[syn.col])
    dV = rule.eta_dep * p * (1.0 - syn.V) - rule.eta_ext * ext * syn.V
    syn.V = np.clip(syn.V + dV, 0.0, 1.0)
    return {
        "depressed": int((dV > 1e-12).sum()),
        "recovered": int((dV < -1e-12).sum()),
        "reinforced_compartments": int((R > 0).sum()),
        "dopamine_bins": int(G.sum()),
    }


def update_v1(net: lif.Network, syn: Synapses, counts: np.ndarray, g: Groups, rule: dict, dopamine_blocked: bool) -> dict:
    """``plasticity.Circuit.update`` on the readout MBONs' synapses (the others get no dopamine there either)."""
    e = np.minimum(1.0, counts[syn.pre] / rule["e_sat"])
    D = np.zeros(syn.reach.shape[1]) if dopamine_blocked else counts[g.pam] @ syn.reach
    d = np.minimum(1.0, D[syn.col] / rule["D_sat"])
    f = 1.0 - rule["eta"] * e * d
    net.weight[syn.pos] *= f
    return {"depressed": int((f < 1.0).sum()), "recovered": 0}


def pn_kc_shuffle(net: lif.Network, g: Groups, seed: int) -> dict:
    """Permute which KC each PN -> KC synapse reaches. Keeps every PN's out-degree and weights and the
    multiset of KC in-degrees from PNs (random convergence, Caron et al. 2013, as a control)."""
    pre = np.repeat(np.arange(net.n, dtype=np.int64), np.diff(net.indptr))
    post = np.asarray(net.indices).astype(np.int64)
    m = np.flatnonzero(g.is_pn[pre] & g.is_kc[post])
    rng = np.random.default_rng(seed)
    idx = np.asarray(net.indices).copy()
    idx[m] = post[m][rng.permutation(m.size)]
    net.indices = idx
    key = pre[m] * net.n + idx[m]
    return {"pn_kc_pairs_permuted": int(m.size), "repeated_pairs_after": int(key.size - np.unique(key).size)}


def schedule_rates(rate: float, window_ms: list[float] | None, trial_ms: float, bin_ms: float = 10.0) -> float | np.ndarray:
    if window_ms is None:
        return rate
    nb = int(round(trial_ms / bin_ms))
    t = (np.arange(nb) + 0.5) * bin_ms
    return np.where((t >= window_ms[0]) & (t < window_ms[1]), rate, 0.0)


def expand(phases: list[dict]) -> list[tuple[str, str, bool, bool]]:
    """(phase, odour, rewarded, plastic) for every trial of a schedule."""
    out = []
    for ph in phases:
        for _ in range(ph["repeat"]):
            for tok in ph["block"]:
                out.append((ph["name"], tok.rstrip("+"), tok.endswith("+"), bool(ph["plastic"])))
    return out


def shuffle_rewards(trials, rng):
    """Each plastic phase keeps its number of rewards, reassigned to random trials of that phase."""
    out = list(trials)
    for name in dict.fromkeys(t[0] for t in trials):
        pos = [k for k, t in enumerate(trials) if t[0] == name and t[3]]
        n = sum(trials[k][2] for k in pos)
        chosen = set(rng.choice(pos, size=n, replace=False).tolist()) if n else set()
        for k in pos:
            out[k] = (trials[k][0], trials[k][1], k in chosen, trials[k][3])
    return out


def run_subject(c, base: lif.Network, g: Groups, cfg: dict, arm: dict, rep: Representation | None, theta_hz: float, odours: dict, seed_seq) -> dict:
    proto = cfg["protocol"]
    sched_name = arm.get("schedule", "standard")
    timing = proto["schedules"][sched_name]
    net = copy.copy(base)
    net.weight = apply(base, g, rep) if rep is not None else base.weight.copy()
    shuffle_info = None
    if arm.get("wiring") == "pn-kc-shuffle":
        w_seed, seed_seq = seed_seq.spawn(2)
        shuffle_info = pn_kc_shuffle(net, g, int(w_seed.generate_state(1)[0]))
    syn = Synapses(net, g)
    r2 = RuleV2(**{**cfg["rule_v2"]["constants"], "theta_hz": 0.0 if arm.get("no_threshold") else theta_hz, **arm.get("rule_v2_override", {})})
    rng = np.random.default_rng(seed_seq)
    trials = expand(cfg["schedules"][timing["phases"]])
    if arm.get("reward") == "shuffled":
        trials = shuffle_rewards(trials, np.random.default_rng(seed_seq.spawn(1)[0]))
    silenced = g.pam if arm.get("silence_dans") else np.zeros(0, dtype=np.int64)
    log_set = np.concatenate([g.kc, g.pam])
    kc_map = np.full(net.n, -1, dtype=np.int64)
    kc_map[g.kc] = np.arange(g.kc.size)
    trial_ms = float(timing["trial_ms"])
    tests: dict = {}
    first_kc: dict = {}
    coding: dict = {}
    updates, b_pam, walls = [], [], []
    for phase, odour, rewarded, plastic in trials:
        t0 = time.monotonic()
        ms = trial_ms if plastic else float(proto["test_trial_ms"])
        poi = [lif.Poisson(odours[odour], schedule_rates(proto["odour_rate_hz"], timing.get("odour_ms") if plastic else None, ms), bin_ms=r2.bin_ms, label=odour)]
        if rewarded:
            poi.append(lif.Poisson(g.pam, schedule_rates(proto["reward_rate_hz"], timing.get("reward_ms"), ms), bin_ms=r2.bin_ms, label="PAM"))
        tr, _ = lif.run(net, lif.Stimulus(poisson=poi, silenced=silenced), ms, rng=rng, max_logged_spikes=5_000_000, log_neurons=log_set)
        if tr.spikes_dropped:
            raise RuntimeError(f"spike log overflow ({tr.spikes_dropped} dropped)")
        fired = tr.counts[g.kc] > 0
        if not plastic:
            tests.setdefault(phase, {}).setdefault(odour, []).append(int(tr.counts[g.readout].sum()))
            if phase == cfg["pretest_phase"]:
                first_kc.setdefault(odour, fired)
                coding.setdefault(odour, []).append(float(fired.mean()))
        else:
            if not rewarded and phase == cfg["acquisition_phase"]:
                b_pam.append(int(tr.counts[g.pam].sum()))
            if arm["rule"] == "v2":
                kc_bins = binned(tr, kc_map, g.kc.size, int(round(ms / r2.bin_ms)), r2.bin_ms, net.dt)
                pam_bins = binned(tr, syn.pam_col, g.pam.size, int(round(ms / r2.bin_ms)), r2.bin_ms, net.dt)
                u = update_v2(syn, kc_bins, pam_bins, r2, bool(arm.get("silence_dans")))
                syn.write(net, r2.floor)
            elif arm["rule"] == "v1":
                u = update_v1(net, syn, tr.counts, g, cfg["rule_v1"], bool(arm.get("silence_dans")))
            else:
                u = {"depressed": 0, "recovered": 0}
            updates.append({"phase": phase, "odour": odour, "rewarded": rewarded, **u})
        walls.append(time.monotonic() - t0)
    jac = lambda a, b: float((a & b).sum() / max(1, (a | b).sum()))  # noqa: E731
    w_ratio = net.weight[syn.pos] / np.where(syn.w0 != 0, syn.w0, 1.0)
    return {
        "tests": tests,
        "indices": indices(tests, cfg),
        "coding_level_pretest": {k: stats.summary(v) for k, v in coding.items()},
        "jaccard_pretest": {f"{a}-{b}": jac(first_kc[a], first_kc[b]) for a, b in (("A", "B"), ("A", "Asim")) if a in first_kc and b in first_kc},
        "pam_spikes_unrewarded_acquisition": stats.summary(b_pam) if b_pam else None,
        "updates": {"n": len(updates), "depressed": stats.summary([u["depressed"] for u in updates]), "recovered": stats.summary([u["recovered"] for u in updates])},
        "updates_by_trial": updates,
        "final_weight_ratio": stats.summary(w_ratio) if w_ratio.size else None,
        "wiring": shuffle_info,
        "wall_s_per_trial": stats.summary(walls),
    }


def indices(tests: dict, cfg: dict) -> dict:
    """The schedule's named indices: each a difference of responses relative to the pretest."""
    m = lambda ph, o: float(np.mean(tests[ph][o])) if ph in tests and o in tests[ph] and tests[ph][o] else None  # noqa: E731
    out = {}
    for name, spec in cfg["indices"].items():
        terms = []
        ok = True
        for coef, ph, o in spec["terms"]:
            num, den = m(ph, o), m(cfg["pretest_phase"], o)
            if num is None or den is None or den <= 0:
                ok = False
                break
            terms.append(coef * num / den)
        out[name] = (sum(terms) + spec.get("offset", 0.0)) if ok else None
    return out


def judge(crit: dict, arms: dict) -> dict:
    out = {"id": crit["id"], "claim": crit["claim"], "test": crit["test"], "threshold_note": crit.get("threshold_note")}
    vals = lambda a, f: [s["indices"][f] for s in arms[a]["subjects"] if s["indices"].get(f) is not None]  # noqa: E731
    t = crit["test"]
    if t == "readout_responds":
        means = {o: float(np.mean([np.mean(s["tests"][crit["phase"]][o]) for s in arms[crit["arm"]]["subjects"]])) for o in crit["odours"]}
        out.update(mean_spikes=means, passed=all(v >= crit["min_mean_spikes"] for v in means.values()))
    elif t in ("all_negative", "all_positive"):
        x = vals(crit["arm"], crit["field"])
        n = len(arms[crit["arm"]]["subjects"])
        sgn = -1 if t == "all_negative" else 1
        k = sum(1 for v in x if sgn * v > 0)
        p = sum(math.comb(n, i) for i in range(k, n + 1)) / 2**n if n else 1.0
        mean = float(np.mean(x)) if x else None
        ok_mean = True
        if "mean_at_most" in crit:
            ok_mean = mean is not None and mean <= crit["mean_at_most"]
        if "mean_at_least" in crit:
            ok_mean = ok_mean and mean is not None and mean >= crit["mean_at_least"]
        if "mean_fraction_of" in crit:
            ref = vals(crit["mean_fraction_of"]["arm"], crit["mean_fraction_of"]["field"])
            bound = crit["mean_fraction_of"]["fraction"] * float(np.mean(ref)) if ref else None
            out["fraction_bound"] = bound
            ok_mean = ok_mean and mean is not None and bound is not None and (mean <= bound if sgn < 0 else mean >= bound)
        out.update(values=x, n=n, in_direction=k, sign_test_p=p, mean=mean, passed=len(x) == n and p < crit["alpha"] and ok_mean)
    elif t in ("mw_less", "mw_greater"):
        a, b = vals(crit["a"], crit["field"]), vals(crit["b"], crit["field"])
        alt = "less" if t == "mw_less" else "greater"
        mw = stats.mann_whitney(a, b, alt) if a and b else {"p": 1.0}
        out.update(a_values=a, b_values=b, mean_a=float(np.mean(a)) if a else None, mean_b=float(np.mean(b)) if b else None, mann_whitney=mw, passed=bool(a and b) and mw["p"] < crit["alpha"])
    elif t == "report_only":
        out.update(values={a: {f: vals(a, f) for f in crit["fields"]} for a in crit["arms"] if a in arms}, passed=True, note="exploratory: always reported, never failed")
    else:
        raise ValueError(f"unknown test {t!r}")
    return out


def _cfg(cfg_path: Path) -> tuple[dict, str]:
    cfg = json.loads(Path(cfg_path).read_text(encoding="utf-8"))
    if cfg.get("schema") != SCHEMA:
        raise ValueError(f"{cfg_path} is not a {SCHEMA} file")
    return cfg, hashlib.sha256(Path(cfg_path).read_bytes().replace(b"\r\n", b"\n")).hexdigest()


def representation(results: Path, cfg: dict) -> tuple[Representation, dict]:
    src = results / cfg["representation"]["from"]
    data = load_sealed(src, RESULT_SCHEMA)
    if not data.get("selected"):
        raise RuntimeError(f"{src.name} selected no representation; nothing to run")
    return Representation(**data["selected"]["representation"]), {"file": src.name, "sha256": data["sha256"], "label": data["selected"]["label"]}


def calibrate(cfg_path: Path, compiled: Path, results: Path, out_dir: Path, log=print) -> dict:
    """The dopamine threshold, from development odours and seeds only, by the config's rule."""
    code = code_watch(out_dir)
    cfg, config_sha256 = _cfg(cfg_path)
    cal = cfg["calibration"]
    c = cx.load(compiled)
    base = lif.Network(c)
    g = Groups.from_annotations(c, cfg["rule_v2"]["dan_mbon_min_synapses"])
    rep, rep_src = representation(results, cfg)
    net = copy.copy(base)
    net.weight = apply(base, g, rep)
    syn = Synapses(net, g)
    odours = {k: g.odour(v) for k, v in cfg["odours"]["dev"].items()}
    bin_ms = cfg["rule_v2"]["constants"]["bin_ms"]
    ms = float(cfg["protocol"]["test_trial_ms"])
    nb = int(round(ms / bin_ms))
    unrewarded, rewarded = [], []
    with Meter() as meter:
        for s in range(cal["subjects"]):
            rng = np.random.default_rng(np.random.SeedSequence([int(cfg["seeds"]["dev"]), 99, s]))
            for odour in cal["odours"]:
                for rew in (False, True):
                    for _ in range(cal["trials"]):
                        poi = [lif.Poisson(odours[odour], cfg["protocol"]["odour_rate_hz"], label=odour)]
                        if rew:
                            poi.append(lif.Poisson(g.pam, cfg["protocol"]["reward_rate_hz"], label="PAM"))
                        tr, _ = lif.run(net, lif.Stimulus(poisson=poi), ms, rng=rng, max_logged_spikes=5_000_000, log_neurons=g.pam)
                        pam_bins = binned(tr, syn.pam_col, g.pam.size, nb, bin_ms, net.dt)
                        rate = compartment_rate(syn, pam_bins, bin_ms, cfg["rule_v2"]["constants"]["da_window_ms"])
                        (rewarded if rew else unrewarded).append(rate.ravel())
            log(f"  calibration subject {s} done")
    u = np.concatenate(unrewarded)
    r = np.concatenate(rewarded)
    u_q = float(np.quantile(u, cal["unrewarded_quantile"]))
    r_q = float(np.quantile(r, cal["rewarded_quantile"]))
    theta = (u_q + r_q) / 2.0
    q = lambda x: {str(p): float(np.quantile(x, p)) for p in (0.5, 0.9, 0.99, 0.999, 1.0)}  # noqa: E731
    body = {
        "schema": RESULT_SCHEMA,
        "kind": "plasticity-v2-calibration",
        "experiment": cfg["id"],
        "config_file": Path(cfg_path).name,
        "config_sha256": config_sha256,
        "representation": rep_src,
        "rule": cal["rule"],
        "unrewarded_rate_hz_quantiles": q(u),
        "rewarded_rate_hz_quantiles": q(r),
        "unrewarded_quantile_value": u_q,
        "rewarded_quantile_value": r_q,
        "theta_hz": theta,
        "bins": {"unrewarded": int(u.size), "rewarded": int(r.size)},
        "connectome": {"path_name": Path(compiled).name, "manifest_sha256": c.manifest.get("sha256")},
        "resources": {**meter.describe(), "machine": machine()},
        "environment": environment(),
        "code": code(),
    }
    data = sealed(body)
    write_json(out_dir / f"{cfg['id']}-calibration.json", data)
    log(f"theta {theta:.2f} Hz (unrewarded q{cal['unrewarded_quantile']} {u_q:.2f}, rewarded q{cal['rewarded_quantile']} {r_q:.2f})")
    return data


def run(cfg_path: Path, split: str, compiled: Path, results: Path, out_dir: Path, echo_mb_path: Path | None = None, subjects: int | None = None, log=print, progress: Path | None = None, resume: bool = False, only: list[str] | None = None) -> dict:
    code = code_watch(out_dir)
    cfg, config_sha256 = _cfg(cfg_path)
    c = cx.load(compiled)
    base = lif.Network(c)
    g = Groups.from_annotations(c, cfg["rule_v2"]["dan_mbon_min_synapses"])
    rep, rep_src = representation(results, cfg)
    cal = load_sealed(out_dir / f"{cfg['id']}-calibration.json", RESULT_SCHEMA)
    if cal["config_sha256"] != config_sha256:
        raise RuntimeError("the calibration was made with another version of the config")
    theta = float(cal["theta_hz"])
    n_sub = subjects or cfg["subjects"][split]
    base_seed = int(cfg["seeds"][split])
    start = code.start
    header = {
        "schema": "fly-neural-progress/v1",
        "experiment": cfg["id"],
        "split": split,
        "subjects": n_sub,
        "only": only,
        "config_sha256": config_sha256,
        "calibration_sha256": cal["sha256"],
        "commit": start.get("commit"),
        "dirty": start.get("dirty"),
        "fly_neural": start.get("fly_neural"),
        "connectome_manifest_sha256": c.manifest.get("sha256"),
    }
    earlier = resume_progress(progress, header, resume, "subjects", log)
    resumed = []
    runs = {}
    arm_by = {a["name"]: a for a in cfg["arms"]}
    with Meter() as meter:
        for spec in cfg["runs"][split]:
            pair = spec["pair"]
            odours = {k: g.odour(v) for k, v in cfg["odours"][pair].items()}
            arms = {}
            for name in spec["arms"]:
                if only and name not in only:
                    continue
                arm = arm_by[name]
                subs = []
                for s in range(n_sub):
                    key = f"{pair}/{name}/{s}"
                    if key in earlier:
                        subs.append(earlier[key]["result"])
                        resumed.append(key)
                        continue
                    t1 = time.monotonic()
                    # The same subject seed across arms on the connectome's own wiring, so arms differ only by the arm.
                    ss = np.random.SeedSequence([base_seed, zlib.crc32(pair.encode()), s])
                    if arm.get("wiring") == "pn-kc-shuffle":
                        ss = np.random.SeedSequence([base_seed, zlib.crc32(pair.encode()), zlib.crc32(name.encode()), s])
                    r = run_subject(c, base, g, cfg, arm, None if arm["representation"] == "dense" else rep, theta, odours, ss)
                    subs.append(r)
                    append_progress(progress, {"name": key, "result": r, "wall_s": round(time.monotonic() - t1, 2)})
                    log(f"  {key}: {json.dumps(r['indices'])} coding {r['coding_level_pretest'].get('A', {}).get('mean')}")
                arms[name] = {"arm": arm, "subjects": subs, "indices": {f: stats.summary([x["indices"][f] for x in subs if x["indices"].get(f) is not None]) for f in cfg["indices"]}}
            runs[pair] = arms
    echo_mb = json.loads(Path(echo_mb_path).read_text(encoding="utf-8")) if echo_mb_path else None
    verdicts = []
    for crit in cfg["criteria"]:
        if crit.get("split", split) != split or crit["pair"] not in runs:
            continue
        needed = [crit.get(k) for k in ("arm", "a", "b") if crit.get(k)] + list(crit.get("arms", []))
        if any(a not in runs[crit["pair"]] for a in needed if crit["test"] != "report_only"):
            continue
        verdicts.append({**judge(crit, runs[crit["pair"]]), "pair": crit["pair"]})
    body = {
        "schema": RESULT_SCHEMA,
        "kind": "plasticity-v2",
        "experiment": cfg["id"],
        "config_file": Path(cfg_path).name,
        "config_sha256": config_sha256,
        "split": split,
        "subjects": n_sub,
        "only": only,
        "resumed_subjects": resumed,
        "partial": (subjects is not None and subjects != cfg["subjects"][split]) or bool(only),
        "representation": rep_src,
        "calibration": {"file": f"{cfg['id']}-calibration.json", "sha256": cal["sha256"], "theta_hz": theta},
        "connectome": {"path_name": Path(compiled).name, "manifest_sha256": c.manifest.get("sha256")},
        "groups": g.describe(),
        "synapses": Synapses(base, g).describe(),
        "odour_neurons": {p: {k: int(g.odour(v).size) for k, v in cfg["odours"][p].items()} for p in runs},
        "runs": runs,
        "echo_mushroom_body": echo_mb,
        "criteria": verdicts,
        "failed": [v["id"] for v in verdicts if not v["passed"]],
        "resources": {**meter.describe(), "wall_s_of_resumed_subjects": round(sum(earlier[k]["wall_s"] for k in resumed), 2), "machine": machine()},
        "environment": environment(),
        "code": code(),
    }
    data = sealed(body)
    name = f"{cfg['id']}-{split}{'-partial' if body['partial'] else ''}.json"
    write_json(out_dir / name, data)
    log(f"wrote {out_dir / name}; failed {data['failed']}")
    return data
