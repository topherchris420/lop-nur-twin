"""The mushroom body's odour code on the connectome: what drives the Kenyon cells, and how sparse it is.

``plasticity-v783`` found that each abstract odour fires about 3,490 of the
5,177 Kenyon cells (KCs) and that two unrelated odours share 95.5% of them,
so a learning rule on the KC -> MBON synapses has almost nothing
odour-specific to change. This module asks why, and changes the model as
little as the pre-registered rule of ``experiments/mb-representation-v783.json``
allows:

- ``census``: who makes the synapses onto the KCs, read from the connectome
  (no simulation);
- ``Representation``: three named changes to the weights of Shiu et al.'s
  model, each a model assumption with its biological basis in the config:
  the APL -> KC inhibition's gain, a KC spike threshold (applied as a
  scaling of every input onto KCs, which is exactly equivalent because the
  model resets to its resting potential), and KC -> KC muting (diagnostic);
- ``sweep``: the pre-registered grid on the development odours, and the
  representation it selects.

The weights of the connectome itself are never edited: a representation is
applied to a copy of ``Network.weight`` for one subject.
"""

from __future__ import annotations

import copy
import hashlib
import json
import math
import time
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np

from . import RESULT_SCHEMA, lif
from . import connectome as cx
from . import populations as P
from .record import code_watch, environment, sealed, write_json
from .resources import Meter, machine

SCHEMA = "fly-neural-mb-representation/v1"


@dataclass(frozen=True)
class Representation:
    """Changes to Shiu et al.'s weights for one subject. The identity is (1, 1, 1)."""

    apl_gain: float = 1.0
    kc_threshold: float = 1.0
    kc_kc: float = 1.0

    @property
    def identity(self) -> bool:
        return self.apl_gain == 1.0 and self.kc_threshold == 1.0 and self.kc_kc == 1.0

    def label(self) -> str:
        return f"apl{self.apl_gain:g}-thr{self.kc_threshold:g}-kckc{self.kc_kc:g}"


def _labels(c: cx.Connectome) -> tuple[np.ndarray, np.ndarray]:
    """cell_class and cell_type of every neuron of ``c`` (None where unannotated)."""
    ann = P._annotations(str(P.annotation_path()))
    ids = ann["root_id"].to_numpy()
    cls = np.array(ann["cell_class"].to_list(), dtype=object)
    typ = np.array(ann["cell_type"].to_list(), dtype=object)
    pos = np.searchsorted(c.root_ids, ids)
    pos = np.clip(pos, 0, c.n - 1)
    ok = c.root_ids[pos] == ids
    out_c = np.full(c.n, None, dtype=object)
    out_t = np.full(c.n, None, dtype=object)
    out_c[pos[ok]] = cls[ok]
    out_t[pos[ok]] = typ[ok]
    return out_c, out_t


class Groups:
    """The mushroom-body populations of one connectome, as index arrays and masks."""

    @classmethod
    def from_annotations(cls_, c: cx.Connectome, dan_mbon_min_synapses: int = 5) -> "Groups":
        cls, typ = _labels(c)
        return cls_(
            c,
            kc=P.resolve("kenyon_cells", c)[0],
            mbon=P.resolve("mbons", c)[0],
            pam=P.resolve("pam_dans", c)[0],
            apl=np.flatnonzero(typ == "APL"),
            pn=np.flatnonzero(cls == "ALPN"),
            dpm=np.flatnonzero(typ == "DPM"),
            ppl1=np.flatnonzero(np.array([isinstance(t, str) and t.startswith("PPL1") for t in typ])),
            cls=cls,
            typ=typ,
            dan_mbon_min_synapses=dan_mbon_min_synapses,
        )

    def __init__(self, c: cx.Connectome, *, kc, mbon, pam, apl, pn, dpm=(), ppl1=(), cls=None, typ=None, dan_mbon_min_synapses: int = 5):
        """Explicit populations (tests build synthetic ones); ``from_annotations`` reads FlyWire's."""
        self.c = c
        as_idx = lambda x: np.sort(np.asarray(x, dtype=np.int64))  # noqa: E731
        self.kc, self.mbon, self.pam, self.apl, self.pn = as_idx(kc), as_idx(mbon), as_idx(pam), as_idx(apl), as_idx(pn)
        self.dpm, self.ppl1 = as_idx(dpm), as_idx(ppl1)
        self.cls = cls if cls is not None else np.full(c.n, None, dtype=object)
        self.typ = typ if typ is not None else np.full(c.n, None, dtype=object)
        self.is_kc = np.zeros(c.n, dtype=bool)
        self.is_kc[self.kc] = True
        self.is_apl = np.zeros(c.n, dtype=bool)
        self.is_apl[self.apl] = True
        self.is_pn = np.zeros(c.n, dtype=bool)
        self.is_pn[self.pn] = True
        is_mbon = np.zeros(c.n, dtype=bool)
        is_mbon[self.mbon] = True
        # PAM -> MBON reach, as plasticity.Circuit reads it (>= min synapses), and the readout MBONs.
        reach: dict[int, list[int]] = {}
        for d in self.pam:
            t, cnt = c.out_edges(int(d))
            for j in t[(cnt >= dan_mbon_min_synapses) & is_mbon[t]]:
                reach.setdefault(int(j), []).append(int(d))
        self.reach = reach
        self.readout = np.array(sorted(reach), dtype=np.int64)

    def odour(self, glomeruli: list[str]) -> np.ndarray:
        return np.sort(np.concatenate([P.select_ids_in(self.c, {"cell_type": [g]}) for g in glomeruli]))

    def describe(self) -> dict:
        return {
            "kenyon_cells": int(self.kc.size),
            "apl": int(self.apl.size),
            "dpm": int(self.dpm.size),
            "projection_neurons_alpn": int(self.pn.size),
            "mbons": int(self.mbon.size),
            "pam_dans": int(self.pam.size),
            "ppl1_dans": int(self.ppl1.size),
            "pam_innervated_mbons": int(self.readout.size),
        }


def census(c: cx.Connectome, g: Groups) -> dict:
    """Synapses onto all KCs by presynaptic group, with the sign the model gives them."""
    pre = c.pre_of_edges()
    onto = g.is_kc[np.asarray(c.indices)]
    pre_k = pre[onto].astype(np.int64)
    syn = np.asarray(c.syn_count)[onto].astype(np.int64)
    sign = np.asarray(c.sign)[pre_k]
    cls = g.cls[pre_k]
    typ = g.typ[pre_k]
    group = np.full(pre_k.size, "other", dtype=object)
    group[g.is_pn[pre_k]] = "projection neurons (ALPN)"
    group[g.is_kc[pre_k]] = "Kenyon cells"
    group[g.is_apl[pre_k]] = "APL"
    group[typ == "DPM"] = "DPM"
    group[cls == "MBON"] = "MBONs"
    group[cls == "DAN"] = "DANs"
    total = int(syn.sum())
    rows = {}
    for name in sorted(set(group.tolist())):
        m = group == name
        rows[name] = {
            "synapses": int(syn[m].sum()),
            "share": round(float(syn[m].sum()) / total, 4),
            "excitatory_synapses": int(syn[m & (sign > 0)].sum()),
            "inhibitory_synapses": int(syn[m & (sign < 0)].sum()),
            "presynaptic_neurons": int(np.unique(pre_k[m]).size),
        }
    per_kc_in = np.bincount(np.asarray(c.indices)[onto], weights=syn, minlength=c.n)[g.kc]
    return {"synapses_onto_kcs": total, "by_presynaptic_group": rows, "synapses_per_kc": {"median": float(np.median(per_kc_in)), "mean": float(per_kc_in.mean())}}


def apply(net: lif.Network, g: Groups, rep: Representation) -> np.ndarray:
    """A copy of ``net.weight`` with the representation's changes (the network itself is not modified)."""
    w = net.weight.copy()
    if rep.identity:
        return w
    post = np.asarray(net.indices)
    pre = np.repeat(np.arange(net.n, dtype=np.int64), np.diff(net.indptr))
    onto_kc = g.is_kc[post]
    if rep.kc_threshold != 1.0:
        w[onto_kc] *= 1.0 / rep.kc_threshold
    if rep.apl_gain != 1.0:
        w[onto_kc & g.is_apl[pre]] *= rep.apl_gain
    if rep.kc_kc != 1.0:
        w[onto_kc & g.is_kc[pre]] *= rep.kc_kc
    return w


def odour_trial(net: lif.Network, g: Groups, odour: np.ndarray, rate_hz: float, ms: float, rng: np.random.Generator) -> dict:
    t0 = time.monotonic()
    trial, _ = lif.run(net, lif.Stimulus(poisson=[lif.Poisson(odour, rate_hz, label="odour")]), ms, rng=rng)
    k = trial.counts[g.kc] > 0
    return {
        "kc_fired": k,
        "coding_level": float(k.mean()),
        "kc_active": int(k.sum()),
        "readout_spikes": int(trial.counts[g.readout].sum()),
        "pam_spikes": int(trial.counts[g.pam].sum()),
        "apl_spikes": int(trial.counts[g.apl].sum()),
        "total_spikes": int(trial.total_spikes),
        "wall_s": round(time.monotonic() - t0, 2),
    }


def measure(c, base: lif.Network, g: Groups, rep: Representation, odours: dict, cfg: dict, seed: int) -> dict:
    net = copy.copy(base)
    net.weight = apply(base, g, rep)
    rng = np.random.default_rng(np.random.SeedSequence([seed, zlib_crc(rep.label())]))
    per = {}
    first = {}
    for name, idx in odours.items():
        trials = [odour_trial(net, g, idx, cfg["odour_rate_hz"], cfg["trial_ms"], rng) for _ in range(cfg["trials_per_odour"])]
        first[name] = trials[0]["kc_fired"]
        per[name] = {k: [t[k] for t in trials] for k in ("coding_level", "kc_active", "readout_spikes", "pam_spikes", "apl_spikes", "total_spikes", "wall_s")}
    a, b = first["A"], first["B"]
    return {
        "representation": asdict(rep),
        "label": rep.label(),
        "odours": per,
        "mean_coding_level": {k: float(np.mean(v["coding_level"])) for k, v in per.items()},
        "jaccard_A_B": float((a & b).sum() / max(1, (a | b).sum())),
        "mean_readout_spikes": {k: float(np.mean(v["readout_spikes"])) for k, v in per.items()},
        "mean_pam_spikes": {k: float(np.mean(v["pam_spikes"])) for k, v in per.items()},
    }


def zlib_crc(text: str) -> int:
    import zlib

    return zlib.crc32(text.encode())


def qualifies(m: dict, cfg: dict) -> bool:
    lo, hi = cfg["target"]["coding_level"]
    ok_band = all(lo <= v <= hi for v in m["mean_coding_level"].values())
    ok_floor = all(min(v["coding_level"]) >= 0.01 for v in m["odours"].values())
    ok_readout = all(v >= 20 for v in m["mean_readout_spikes"].values())
    return ok_band and ok_floor and ok_readout


def select(points: list[dict], cfg: dict) -> dict | None:
    ok = [p for p in points if p["representation"]["kc_kc"] == 1 and qualifies(p, cfg)]
    if not ok:
        return None
    key = lambda p: (round(math.log(p["representation"]["apl_gain"]) + math.log(p["representation"]["kc_threshold"]), 12), p["representation"]["kc_threshold"])  # noqa: E731
    return min(ok, key=key)


def sweep(cfg_path: Path, compiled: Path, out_dir: Path, log=print) -> dict:
    code = code_watch(out_dir)
    cfg = json.loads(Path(cfg_path).read_text(encoding="utf-8"))
    if cfg.get("schema") != SCHEMA:
        raise ValueError(f"{cfg_path} is not a {SCHEMA} file")
    config_sha256 = hashlib.sha256(Path(cfg_path).read_bytes().replace(b"\r\n", b"\n")).hexdigest()
    c = cx.load(compiled)
    base = lif.Network(c)
    g = Groups.from_annotations(c)
    odours = {k: g.odour(v) for k, v in cfg["odours"].items() if k in ("A", "B")}
    fam = cfg["families"]
    grid = [Representation(apl_gain=float(a), kc_threshold=float(k)) for k in fam["kc_threshold"]["values"] for a in fam["apl_gain"]["values"]]
    grid.append(Representation(kc_kc=0.0))
    points = []
    with Meter() as meter:
        cen = census(c, g)
        log(f"census: {json.dumps(cen['by_presynaptic_group'])}")
        for rep in grid:
            m = measure(c, base, g, rep, odours, cfg, int(cfg["seed"]))
            points.append(m)
            log(f"  {rep.label()}: coding {m['mean_coding_level']}, jaccard {m['jaccard_A_B']:.3f}, readout {m['mean_readout_spikes']}, PAM {m['mean_pam_spikes']}")
        chosen = select(points, cfg)
        if chosen is not None:
            rep = Representation(**chosen["representation"])
            muted = measure(c, base, g, Representation(rep.apl_gain, rep.kc_threshold, 0.0), odours, cfg, int(cfg["seed"]))
            points.append(muted)
            log(f"  {muted['label']} (diagnostic): coding {muted['mean_coding_level']}")
    body = {
        "schema": RESULT_SCHEMA,
        "kind": "mb-representation",
        "experiment": cfg["id"],
        "config_file": Path(cfg_path).name,
        "config_sha256": config_sha256,
        "connectome": {"path_name": Path(compiled).name, "manifest_sha256": c.manifest.get("sha256")},
        "groups": g.describe(),
        "odour_neurons": {k: int(v.size) for k, v in odours.items()},
        "census": cen,
        "points": points,
        "qualifying": [p["label"] for p in points if p["representation"]["kc_kc"] == 1 and qualifies(p, cfg)],
        "selected": None if chosen is None else {"label": chosen["label"], "representation": chosen["representation"]},
        "resources": {**meter.describe(), "machine": machine()},
        "environment": environment(),
        "code": code(),
    }
    data = sealed(body)
    write_json(out_dir / f"{cfg['id']}.json", data)
    log(f"wrote {out_dir / (cfg['id'] + '.json')}: selected {body['selected']}")
    return data
