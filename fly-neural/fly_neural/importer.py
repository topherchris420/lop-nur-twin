"""Import FlyWire FAFB v783 into a compiled connectome, in chunks, with every anomaly counted.

Input: ``proofread_root_ids_783.npy`` (the neurons) and
``proofread_connections_783.feather`` (one row per presynaptic neuron,
postsynaptic neuron and neuropil, with a synapse count and the mean
transmitter probabilities of those synapses). The table is read in slices of
``chunk_rows`` rows, so memory stays bounded, and each slice is checked:

- root ids not in the proofread list (rows dropped and counted);
- null values, synapse counts below 1, probabilities outside [0, 1] or rows
  whose probabilities do not sum to about 1 (counted; nulls and bad counts are
  errors);
- duplicate (pre, post, neuropil) rows (counted; their synapses are summed);
- autapses (counted and kept, as Shiu et al. keep them).

Pairs are then summed over neuropils into the CSR graph. Each neuron's
transmitter is the argmax of its outgoing synapses' mean probabilities,
weighted by synapse count; a neuron whose top probability is below 0.5 is
counted as ambiguous (it keeps the argmax), and one with no outgoing proofread
synapse has no call (code -1, sign +1, which never matters: it has no
outgoing weight).

Sign policies (the published model's sign is per presynaptic neuron):

- ``synapse-weighted`` (default): the call above, mapped by ``NT_SIGN``;
  reproducible from the Zenodo files alone.
- ``shiu``: the sign in Shiu et al.'s Connectivity_783.parquet, for exact
  reproduction of the published model's network.
- ``annotation``: the annotation release's ``top_nt`` (averaged over all of a
  neuron's presynapses, including those onto unproofread fragments), falling
  back to the synapse-weighted call where it is null.

Whatever the policy, the import states how often the policies agree.
"""

from __future__ import annotations

import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import polars as pl

from . import connectome as cx
from .acquire import SourceError, data_dir, verify
from .record import code_state
from .resources import Budget, Meter, machine
from .sources import BY_KEY

POLICIES = ("synapse-weighted", "shiu", "annotation")
ANNOTATION_NT = {
    "acetylcholine": "ach",
    "gaba": "gaba",
    "glutamate": "glut",
    "octopamine": "oct",
    "serotonin": "ser",
    "dopamine": "da",
}


def _source_meta(key: str) -> dict:
    s = BY_KEY[key]
    return {"file": f"{s.group}/{s.filename}", "url": s.url, "sha256": s.sha256, "size": s.size, "terms": s.terms}


def _map_ids(root_ids: np.ndarray, ids: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    pos = np.searchsorted(root_ids, ids)
    pos = np.clip(pos, 0, root_ids.size - 1)
    return pos, root_ids[pos] == ids


def shiu_signs(root: Path, root_ids: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Shiu et al.'s per-neuron sign (+1/-1) and a mask of neurons their table signs."""
    path = verify("shiu_connectivity", root)
    per = (
        pl.scan_parquet(path)
        .group_by("Presynaptic_ID")
        .agg(pl.col("Excitatory").min().alias("lo"), pl.col("Excitatory").max().alias("hi"))
        .collect(engine="streaming")
    )
    if (per["lo"] != per["hi"]).any():
        raise cx.ConnectomeError("Shiu's table gives one presynaptic neuron two signs")
    pos, ok = _map_ids(root_ids, per["Presynaptic_ID"].to_numpy())
    if not ok.all():
        raise cx.ConnectomeError("Shiu's table names presynaptic neurons outside the proofread list")
    sign = np.ones(root_ids.size, dtype=np.int8)
    known = np.zeros(root_ids.size, dtype=bool)
    sign[pos[ok]] = per["lo"].to_numpy()[ok].astype(np.int8)
    known[pos[ok]] = True
    return sign, known


def annotation_nt(root: Path, root_ids: np.ndarray) -> np.ndarray:
    """The annotation release's top_nt as codes into NT_NAMES (-1 where null or absent)."""
    path = verify("annotations", root)
    ann = pl.read_csv(path, separator="\t", columns=["root_id", "top_nt"], schema_overrides={"root_id": pl.Int64, "top_nt": pl.String})
    codes = np.full(root_ids.size, -1, dtype=np.int8)
    pos, ok = _map_ids(root_ids, ann["root_id"].to_numpy())
    names = ann["top_nt"].to_list()
    for p, good, name in zip(pos.tolist(), ok.tolist(), names):
        if good and name in ANNOTATION_NT:
            codes[p] = cx.NT_NAMES.index(ANNOTATION_NT[name])
    return codes


def import_v783(
    out: Path,
    *,
    root: Path | None = None,
    sign_policy: str = "synapse-weighted",
    chunk_rows: int = 2_000_000,
    budget: Budget | None = None,
    files: dict[str, Path] | None = None,
    log=print,
) -> cx.Connectome:
    """Compile v783 into ``out``. ``files`` replaces the pinned, hash-verified inputs
    (for synthetic test fixtures only); the manifest then marks its inputs unverified."""
    if sign_policy not in POLICIES:
        raise ValueError(f"sign_policy must be one of {POLICIES}")
    root = root or data_dir()
    if files:
        ids_path, con_path = Path(files["root_ids"]), Path(files["connections"])
    else:
        ids_path, con_path = verify("root_ids", root), verify("connections", root)
    budget = budget or Budget()
    meter = Meter().__enter__()

    raw = np.load(ids_path, allow_pickle=False)
    if raw.dtype.kind not in "iu" or raw.ndim != 1:
        raise cx.ConnectomeError(f"root ids are {raw.dtype} {raw.shape}, expected a 1-d integer array")
    if raw.size and int(raw.max()) > np.iinfo(np.int64).max:
        raise cx.ConnectomeError("a root id does not fit int64")
    ids = raw.astype(np.int64)
    root_ids = np.unique(ids)
    n = int(root_ids.size)
    stats: dict = {
        "root_id_rows": int(ids.size),
        "duplicate_root_ids": int(ids.size - n),
        "nonpositive_root_ids": int((ids <= 0).sum()),
    }

    lf = pl.scan_ipc(con_path)
    schema = lf.collect_schema()
    want = ["pre_pt_root_id", "post_pt_root_id", "neuropil", "syn_count", *[f"{k}_avg" for k in cx.NT_NAMES]]
    missing_cols = [c for c in want if c not in schema]
    if missing_cols:
        raise cx.ConnectomeError(f"connection table lacks columns {missing_cols}")
    total_rows = int(lf.select(pl.len()).collect().item())
    neuropils = sorted(x for x in lf.select(pl.col("neuropil").unique()).collect()["neuropil"].to_list() if x is not None)
    n_np = len(neuropils)
    np_enum = pl.Enum(neuropils)
    log(f"connections: {total_rows:,} rows, {n_np} neuropil labels, {n:,} proofread neurons")

    key3_parts: list[np.ndarray] = []
    cnt_parts: list[np.ndarray] = []
    nt_sum = np.zeros((n, len(cx.NT_NAMES)), dtype=np.float64)
    syn_in = np.zeros(n, dtype=np.int64)
    syn_out = np.zeros(n, dtype=np.int64)
    in_np = np.zeros(n * n_np, dtype=np.int64)
    out_np = np.zeros(n * n_np, dtype=np.int64)
    bad = {
        "rows_with_unknown_pre": 0,
        "rows_with_unknown_post": 0,
        "synapses_dropped_unknown_ids": 0,
        "null_values": 0,
        "nonpositive_counts": 0,
        "probabilities_out_of_range": 0,
        "probability_sum_off_by_more_than_0.01": 0,
        "max_probability_sum_error": 0.0,
        "unassigned_transmitter_rows": 0,
        "unassigned_transmitter_synapses": 0,
    }
    syn_out_nt = np.zeros(n, dtype=np.int64)
    for off in range(0, total_rows, chunk_rows):
        budget.check()
        df = lf.slice(off, chunk_rows).collect()
        structural = int(sum(df.select(["pre_pt_root_id", "post_pt_root_id", "neuropil", "syn_count"]).null_count().row(0)))
        if structural:
            bad["null_values"] += structural
            raise cx.ConnectomeError(f"{structural} null id, neuropil or count value(s) in rows {off}..{off + df.height}")
        pre = df["pre_pt_root_id"].to_numpy()
        post = df["post_pt_root_id"].to_numpy()
        cnt = df["syn_count"].to_numpy().astype(np.int64)
        code = df["neuropil"].cast(np_enum).to_physical().to_numpy().astype(np.int64)
        probs = np.stack([df[f"{k}_avg"].to_numpy(allow_copy=True) for k in cx.NT_NAMES], axis=1).astype(np.float64)
        if (cnt < 1).any():
            bad["nonpositive_counts"] += int((cnt < 1).sum())
            raise cx.ConnectomeError(f"synapse counts below 1 in rows {off}..{off + df.height}")
        # A row with no transmitter prediction has all six probabilities null: its
        # synapses are connectivity, but they say nothing about the transmitter.
        nan = np.isnan(probs)
        partial = nan.any(axis=1) & ~nan.all(axis=1)
        if partial.any():
            raise cx.ConnectomeError(f"{int(partial.sum())} row(s) with some but not all transmitter probabilities null")
        unassigned = nan.all(axis=1)
        bad["unassigned_transmitter_rows"] += int(unassigned.sum())
        bad["unassigned_transmitter_synapses"] += int(cnt[unassigned].sum())
        probs[unassigned] = 0.0
        assigned = probs[~unassigned]
        out_of_range = ~np.isfinite(assigned) | (assigned < 0) | (assigned > 1)
        bad["probabilities_out_of_range"] += int(out_of_range.any(axis=1).sum())
        err = np.abs(assigned.sum(axis=1) - 1.0) if assigned.size else np.zeros(1)
        bad["probability_sum_off_by_more_than_0.01"] += int((err > 0.01).sum())
        bad["max_probability_sum_error"] = max(bad["max_probability_sum_error"], float(err.max()))
        pi, pok = _map_ids(root_ids, pre)
        qi, qok = _map_ids(root_ids, post)
        bad["rows_with_unknown_pre"] += int((~pok).sum())
        bad["rows_with_unknown_post"] += int((~qok).sum())
        ok = pok & qok
        bad["synapses_dropped_unknown_ids"] += int(cnt[~ok].sum())
        pi, qi, cnt, code, probs, unassigned = pi[ok], qi[ok], cnt[ok], code[ok], probs[ok], unassigned[ok]
        key3_parts.append((pi * n + qi) * n_np + code)
        cnt_parts.append(cnt.astype(np.int32))
        for k in range(len(cx.NT_NAMES)):
            nt_sum[:, k] += np.bincount(pi, weights=cnt * probs[:, k], minlength=n)
        syn_out_nt += np.bincount(pi, weights=cnt * ~unassigned, minlength=n).astype(np.int64)
        syn_out += np.bincount(pi, weights=cnt, minlength=n).astype(np.int64)
        syn_in += np.bincount(qi, weights=cnt, minlength=n).astype(np.int64)
        out_np += np.bincount(pi * n_np + code, weights=cnt, minlength=n * n_np).astype(np.int64)
        in_np += np.bincount(qi * n_np + code, weights=cnt, minlength=n * n_np).astype(np.int64)
        log(f"  rows {off:>10,}..{off + df.height:>10,}")
        del df, pre, post, probs
    stats["source_rows"] = total_rows
    stats.update(bad)

    key3 = np.concatenate(key3_parts)
    cnt = np.concatenate(cnt_parts).astype(np.int64)
    del key3_parts, cnt_parts
    order = np.argsort(key3, kind="stable")
    key3 = key3[order]
    cnt = cnt[order]
    del order
    stats["duplicate_pair_neuropil_rows"] = int((np.diff(key3) == 0).sum()) if key3.size else 0
    stats["pair_neuropil_records"] = int(key3.size)
    pair = key3 // n_np
    del key3
    starts = np.flatnonzero(np.r_[True, pair[1:] != pair[:-1]]) if pair.size else np.zeros(0, dtype=np.int64)
    pair_key = pair[starts]
    pair_cnt = np.add.reduceat(cnt, starts) if pair.size else cnt
    del pair, cnt
    pre_idx = pair_key // n
    post_idx = (pair_key % n).astype(np.int32)
    indptr = np.zeros(n + 1, dtype=np.int64)
    np.cumsum(np.bincount(pre_idx, minlength=n), out=indptr[1:])

    # Transmitters, per neuron, from its outgoing proofread synapses.
    with np.errstate(invalid="ignore", divide="ignore"):
        nt_prob = (nt_sum / syn_out_nt[:, None]).astype(np.float32)
    has_out = syn_out > 0
    has_call = syn_out_nt > 0
    nt = np.where(has_call, nt_prob.argmax(axis=1), -1).astype(np.int8)
    nt_prob[~has_call] = 0
    top_p = np.where(has_call, nt_prob.max(axis=1), 0)
    # Default sign +1 (excitatory) where there is no call: a modelling assumption,
    # counted below; it matters only for neurons with outputs but no prediction.
    sw_sign = np.ones(n, dtype=np.int8)
    for k, name in enumerate(cx.NT_NAMES):
        sw_sign[nt == k] = cx.NT_SIGN[name]
    stats["transmitter_calls"] = {name: int((nt == k).sum()) for k, name in enumerate(cx.NT_NAMES)}
    stats["transmitter_calls"]["none_no_outputs"] = int((~has_out).sum())
    stats["transmitter_calls"]["none_outputs_without_prediction"] = int((has_out & ~has_call).sum())
    stats["ambiguous_transmitter_top_below_0.5"] = int((has_call & (top_p < 0.5)).sum())
    stats["default_sign_for_uncalled_neurons"] = 1

    agreement: dict = {}
    sign = sw_sign
    if files and sign_policy != "synapse-weighted":
        raise cx.ConnectomeError("fixture inputs support only the synapse-weighted sign policy")
    try:
        if files:
            raise SourceError("fixture inputs: other releases' signs do not apply")
        s_sign, s_known = shiu_signs(root, root_ids)
        m = s_known & has_call
        agreement["shiu_vs_synapse_weighted"] = {
            "neurons_compared": int(m.sum()),
            "same_sign": int((s_sign[m] == sw_sign[m]).sum()),
            "pairs_compared": int(np.diff(indptr)[m].sum()),
            "pairs_same_sign": int(np.diff(indptr)[m & (s_sign == sw_sign)].sum()),
        }
        if sign_policy == "shiu":
            sign = s_sign
    except SourceError as e:
        if sign_policy == "shiu":
            raise
        agreement["shiu_vs_synapse_weighted"] = f"not computed: {e}"
    try:
        if files:
            raise SourceError("fixture inputs: other releases' annotations do not apply")
        a_nt = annotation_nt(root, root_ids)
        a_sign = sw_sign.copy()
        for k, name in enumerate(cx.NT_NAMES):
            a_sign[a_nt == k] = cx.NT_SIGN[name]
        m = (a_nt >= 0) & has_call
        agreement["annotation_vs_synapse_weighted"] = {
            "neurons_compared": int(m.sum()),
            "same_transmitter": int((a_nt[m] == nt[m]).sum()),
            "same_sign": int((a_sign[m] == sw_sign[m]).sum()),
            "annotation_null_or_absent_with_outputs": int(((a_nt < 0) & has_out).sum()),
        }
        if sign_policy == "annotation":
            sign = a_sign
    except SourceError as e:
        if sign_policy == "annotation":
            raise
        agreement["annotation_vs_synapse_weighted"] = f"not computed: {e}"
    stats["sign_agreement"] = agreement

    def top_np(arr: np.ndarray) -> np.ndarray:
        mat = arr.reshape(n, n_np)
        top = mat.argmax(axis=1).astype(np.int16)
        top[mat.max(axis=1) == 0] = -1
        return top

    c = cx.Connectome(
        root_ids=root_ids,
        indptr=indptr,
        indices=post_idx,
        syn_count=pair_cnt.astype(np.int32),
        sign=sign.astype(np.int8),
        nt=nt,
        nt_prob=nt_prob,
        syn_in=syn_in,
        syn_out=syn_out,
        top_in_neuropil=top_np(in_np),
        top_out_neuropil=top_np(out_np),
    )
    structure = cx.validate(c)
    if structure["synapses"] + stats["synapses_dropped_unknown_ids"] != int(lf.select(pl.col("syn_count").sum()).collect().item()):
        raise cx.ConnectomeError("synapse totals do not reconcile with the source table")
    meter.__exit__(None, None, None)
    c.manifest = {
        "name": out.name,
        "dataset": "unverified inputs (test fixture)" if files else "FlyWire FAFB public release v783 (proofread connections)",
        "sign_policy": sign_policy,
        "inputs": (
            {k: {"file": str(v), "verified": False} for k, v in files.items()}
            if files
            else {k: _source_meta(k) for k in ("root_ids", "connections")}
        )
        | ({"shiu_connectivity": _source_meta("shiu_connectivity")} if sign_policy == "shiu" else {})
        | ({"annotations": _source_meta("annotations")} if sign_policy == "annotation" else {}),
        "counts": structure,
        "import": stats,
        "neuropils": neuropils,
        "chunk_rows": chunk_rows,
        "code": code_state(),
        "resources": meter.describe() | {"machine": machine()},
        "created_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "transmitter_names": list(cx.NT_NAMES),
        "transmitter_sign": dict(cx.NT_SIGN),
    }
    cx.save(c, out)
    log(f"wrote {out} in {time.monotonic() - meter.t0:.1f} s")
    return cx.load(out)


def crosscheck_shiu(c: cx.Connectome, *, root: Path | None = None, chunk_rows: int = 2_000_000) -> dict:
    """Compare every pair of Shiu et al.'s Connectivity_783 with this connectome."""
    root = root or data_dir()
    path = verify("shiu_connectivity", root)
    comp = pl.read_csv(verify("shiu_completeness", root))
    shiu_ids = np.sort(comp[comp.columns[0]].to_numpy().astype(np.int64))
    in_ours = np.isin(shiu_ids, c.root_ids)
    keys = c.pre_of_edges().astype(np.int64) * c.n + c.indices.astype(np.int64)
    signed = c.signed_count()
    lf = pl.scan_parquet(path).select(["Presynaptic_ID", "Postsynaptic_ID", "Connectivity", "Excitatory", "Excitatory x Connectivity"])
    total = int(lf.select(pl.len()).collect().item())
    found = same_count = same_sign = same_signed = 0
    shiu_synapses = 0
    for off in range(0, total, chunk_rows):
        df = lf.slice(off, chunk_rows).collect()
        pi, pok = _map_ids(c.root_ids, df["Presynaptic_ID"].to_numpy())
        qi, qok = _map_ids(c.root_ids, df["Postsynaptic_ID"].to_numpy())
        ok = pok & qok
        k = pi * c.n + qi
        pos = np.clip(np.searchsorted(keys, k), 0, keys.size - 1)
        hit = ok & (keys[pos] == k)
        cnt = df["Connectivity"].to_numpy()
        shiu_synapses += int(cnt.sum())
        found += int(hit.sum())
        same_count += int((hit & (c.syn_count[pos] == cnt)).sum())
        exc = df["Excitatory"].to_numpy()
        same_sign += int((hit & (c.sign[pi] == exc)).sum())
        same_signed += int((hit & (signed[pos] == df["Excitatory x Connectivity"].to_numpy())).sum())
    return {
        "shiu_neurons": int(shiu_ids.size),
        "shiu_neurons_in_this_import": int(in_ours.sum()),
        "this_import_neurons": c.n,
        "neurons_only_here": int(c.n - in_ours.sum()),
        "neurons_only_here_isolated": int(
            np.sum((np.diff(c.indptr) == 0)[~np.isin(c.root_ids, shiu_ids)] & (np.bincount(c.indices, minlength=c.n) == 0)[~np.isin(c.root_ids, shiu_ids)])
        ),
        "shiu_pairs": total,
        "this_import_pairs": c.pairs,
        "pairs_found": found,
        "pairs_same_synapse_count": same_count,
        "shiu_synapses": shiu_synapses,
        "this_import_synapses": c.synapses,
        "pairs_same_sign": same_sign,
        "pairs_same_signed_weight": same_signed,
        "sign_policy": c.manifest.get("sign_policy"),
    }
