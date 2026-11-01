"""BANC v888, the brain and ventral nerve cord, compiled for the integrator from the pinned Codex tables.

FAFB v783 is a brain: the descending neurons leave it and nothing they drive
is in it, so a v783 research fly's readouts stop at descending neurons and its
feet taste through a labellar stand-in. BANC v888 (Bates et al. 2026) is the
central nervous system of another female fly, brain and ventral nerve cord in
one reconstruction: the leg, wing, neck and proboscis motor neurons, the
tarsal taste neurons, and the ascending neurons that carry the cord's state
back up are in the same graph. This module compiles it into the same
``Connectome`` format, so Shiu et al.'s integrator runs on it unchanged.

Inputs: the two tables a person downloaded from Codex and pinned with ``codex
pin banc-v888`` (``neurons.csv.gz`` and ``connections_princeton.csv.gz``).
The simulation accepts only the bytes reviewed into ``REVIEWED`` below, copied
from the operator's pin of 2026-10-31; a pin of any other file is refused here
(the Codex reference layer still reads it). The tables stay in
``$FLY_NEURAL_DATA/codex/banc-v888/``, outside Git.

What differs from the v783 import, and how it is handled:

- **Transmitters.** BANC's connection rows carry no transmitter (the
  ``nt_type`` column is empty in every row of this export), so each neuron's
  sign comes from the neuron table's ``Predicted NT type``, one call per
  neuron as in Shiu et al.'s model. BANC predicts two transmitters FAFB's
  table has no column for: histamine (photoreceptors and some interneurons;
  its receptors in the fly, Ort and HisCl1, are chloride channels, so it is
  inhibitory here) and tyramine (a modulator, excitatory here as Shiu et al.
  treat the other modulators; an assumption). A neuron with no prediction
  gets +1, as the v783 import gives its uncalled neurons; unlike there, some
  of these neurons have outputs, and the import counts them and their
  synapses.
- **Thresholds.** Codex's BANC connections list pairs of at least 3
  synapses (summed over neuropils); FAFB's v783 table lists every pair. So
  BANC has fewer pairs and synapses per neuron, and the same weight per
  synapse (Shiu et al.'s ``w_syn``) drives it less. The import states both
  totals; no parameter is refitted to compensate.
- **No gap junctions.** The giant fiber drives the jump motor neuron (TTMn)
  and PSI mostly through electrical synapses, which electron microscopy does
  not see; BANC records only their chemical synapses (13 and 15 in this
  export). The model has no gap junctions, so it is tested, not assumed,
  whether the giant fiber's spike reaches the jump (``banc-cord-v888.json``).

Datasets are never pooled: a BANC connectome's neurons are BANC's, its
populations are selected from BANC's own annotations (``populations.py``,
keys ``banc_*``), and a FAFB population is refused on it, and the reverse.
"""

from __future__ import annotations

import time
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path

import numpy as np
import polars as pl

from . import codex
from . import connectome as cx
from .record import code_state
from .resources import Meter, machine

DATASET = "banc-v888"
SIGN_POLICY = "predicted-nt"
COMPILED_NAME = f"{DATASET}-{SIGN_POLICY}"

#: v783's names first, in v783's order, so a code means the same transmitter in both.
NT_NAMES = cx.NT_NAMES + ("hist", "tyr")
NT_SIGN = {**cx.NT_SIGN, "hist": -1, "tyr": 1}
CODEX_NT = {"GABA": "gaba", "ACH": "ach", "GLUT": "glut", "OCT": "oct", "SER": "ser", "DA": "da", "HIST": "hist", "TYR": "tyr"}
SIGN_NOTES = {
    "hist": "histamine-gated chloride channels (Ort, HisCl1): inhibitory",
    "tyr": "a modulator, excitatory as Shiu et al. treat octopamine, serotonin and dopamine (assumption)",
    "uncalled": "no prediction: +1, as the v783 import treats uncalled neurons",
}

#: The operator's pin of 2026-10-31, reviewed into the repository: the only bytes the simulation reads.
REVIEWED = {
    "retrieved": "2026-10-31",
    "terms": "CC BY 4.0 (BANC v888 data, per the BANC project README and Harvard Dataverse doi:10.7910/DVN/7WTH1N; files downloaded from FlyWire Codex)",
    "cite": (
        "Bates AS, Phelps JS, Kim M, Yang HHJ, Matsliah A, Ajabi Z, Perlman E, et al. (2026) Distributed control circuits "
        "across a brain-and-cord connectome. Nature. doi:10.1038/s41586-026-10735-w; and BANC v888 - Brain-and-nerve-cord "
        "connectome (data and analysis code), Harvard Dataverse, doi:10.7910/DVN/7WTH1N"
    ),
    "files": {
        "neurons": {"file": "neurons.csv.gz", "size": 2_881_728, "sha256": "40a2201554a8c34d2c4b07c8322543a07c1b3faf5acafbac363fd1a3d0fa617f"},
        "connections": {"file": "connections_princeton.csv.gz", "size": 29_164_674, "sha256": "8772298eb69455759c7b4a23ee1d1843f5b389965e312524e652415f8a09b312"},
    },
}

#: Codex's display headings, mapped to the names populations select on.
NEURON_COLUMNS = {
    "Root ID": "root_id",
    "Super Class": "super_class",
    "Class": "cell_class",
    "Sub Class": "cell_sub_class",
    "Primary Cell Type": "cell_type",
    "Alternative Cell Type(s)": "alt_types",
    "Soma side": "side",
    "Body Part": "body_part",
    "Function": "function",
    "Flow": "flow",
    "Nerve": "nerve",
    "Predicted NT type": "nt",
    "Predicted NT confidence": "nt_confidence",
}
EDGE_COLUMNS = ("pre_root_id", "post_root_id", "neuropil", "syn_count")


class BancError(ValueError):
    pass


def reviewed_files(root: Path | None = None) -> tuple[dict[str, Path], dict]:
    """The pinned tables, re-hashed, refused unless they are the reviewed bytes and terms."""
    files, record = codex.verified_files(DATASET, root)
    for role, want in REVIEWED["files"].items():
        got = next((e for e in record["files"] if e["role"] == role), None)
        if got is None:
            raise BancError(f"{DATASET}: the pin has no {role} table; the simulation needs both")
        if (got["file"], got["size"], got["sha256"]) != (want["file"], want["size"], want["sha256"]):
            raise BancError(
                f"{DATASET}: the pinned {role} table ({got['file']}, sha256 {got['sha256'][:12]}…) is not the reviewed one "
                f"({want['file']}, {want['sha256'][:12]}…); a new export needs its own review"
            )
    if record.get("terms") != REVIEWED["terms"] or record.get("cite") != REVIEWED["cite"]:
        raise BancError(f"{DATASET}: the pin's terms or citation differ from the reviewed record")
    return files, record


def read_neurons(path: Path) -> pl.DataFrame:
    """The neuron table under this module's column names (every column a string but the root id)."""
    df = pl.read_csv(path, infer_schema_length=0)
    missing = [h for h in NEURON_COLUMNS if h not in df.columns]
    if missing:
        raise BancError(f"{Path(path).name}: no column {missing}; it has {df.columns}")
    df = df.select([pl.col(h).alias(k) for h, k in NEURON_COLUMNS.items()])
    if df["root_id"].null_count():
        raise BancError(f"{Path(path).name}: {df['root_id'].null_count()} rows without a root id")
    return df.with_columns(pl.col("root_id").cast(pl.Int64))


@lru_cache(maxsize=2)
def _neurons_cached(path: str, sha256: str) -> pl.DataFrame:
    return read_neurons(Path(path))


def neurons(root: Path | None = None) -> pl.DataFrame:
    """The reviewed BANC neuron table (re-hashed on every call; parsed once per file)."""
    files, record = reviewed_files(root)
    sha = next(e["sha256"] for e in record["files"] if e["role"] == "neurons")
    return _neurons_cached(str(files["neurons"]), sha)


def nt_codes(nt: list) -> np.ndarray:
    """Codes into ``NT_NAMES`` for Codex's transmitter calls (-1 where there is none)."""
    out = np.full(len(nt), -1, dtype=np.int8)
    for i, v in enumerate(nt):
        if v is None or v == "":
            continue
        if v not in CODEX_NT:
            raise BancError(f"unknown transmitter call {v!r}")
        out[i] = NT_NAMES.index(CODEX_NT[v])
    return out


def import_banc(out: Path, *, root: Path | None = None, files: dict[str, Path] | None = None, log=print) -> cx.Connectome:
    """Compile BANC v888 into ``out``. ``files`` replaces the pinned, reviewed tables
    (synthetic test fixtures only); the manifest then marks its inputs unverified."""
    with Meter() as meter:
        if files:
            paths, record = {k: Path(v) for k, v in files.items()}, None
        else:
            paths, record = reviewed_files(root)
        neu = read_neurons(paths["neurons"])
        ids = neu["root_id"].to_numpy()
        root_ids = np.unique(ids)
        n = int(root_ids.size)
        stats: dict = {"neuron_rows": int(ids.size), "duplicate_root_ids": int(ids.size - n), "nonpositive_root_ids": int((ids <= 0).sum())}
        if stats["duplicate_root_ids"]:
            raise cx.ConnectomeError(f"the neuron table repeats {stats['duplicate_root_ids']} root id(s)")

        con = pl.read_csv(
            paths["connections"],
            columns=list(EDGE_COLUMNS),
            schema_overrides={"pre_root_id": pl.Int64, "post_root_id": pl.Int64, "neuropil": pl.String, "syn_count": pl.Int64},
        )
        stats["connection_rows"] = int(con.height)
        stats["null_values"] = int(sum(con[c].null_count() for c in EDGE_COLUMNS))
        stats["nonpositive_counts"] = int((con["syn_count"] < 1).sum())
        if stats["null_values"] or stats["nonpositive_counts"]:
            raise cx.ConnectomeError(f"connection table has {stats['null_values']} null values and {stats['nonpositive_counts']} counts below 1")
        source_synapses = int(con["syn_count"].sum())
        known = pl.Series(root_ids)
        unknown_pre = ~con["pre_root_id"].is_in(known.implode())
        unknown_post = ~con["post_root_id"].is_in(known.implode())
        drop = unknown_pre | unknown_post
        stats["rows_with_unknown_pre"] = int(unknown_pre.sum())
        stats["rows_with_unknown_post"] = int(unknown_post.sum())
        stats["synapses_dropped_unknown_ids"] = int(con.filter(drop)["syn_count"].sum()) if drop.any() else 0
        con = con.filter(~drop)
        dup = con.group_by(["pre_root_id", "post_root_id", "neuropil"]).len().filter(pl.col("len") > 1)
        stats["duplicate_pair_neuropil_rows"] = int((dup["len"] - 1).sum()) if dup.height else 0
        stats["autapse_rows"] = int((con["pre_root_id"] == con["post_root_id"]).sum())

        pre = np.searchsorted(root_ids, con["pre_root_id"].to_numpy())
        post = np.searchsorted(root_ids, con["post_root_id"].to_numpy())
        cnt = con["syn_count"].to_numpy()
        neuropils = sorted(x for x in con["neuropil"].unique().to_list() if x is not None)
        log(f"connections: {stats['connection_rows']:,} rows, {len(neuropils)} neuropil labels, {n:,} neurons")

        # Transmitter and sign: one call per neuron, from the neuron table.
        order = np.argsort(ids, kind="stable")
        nt = nt_codes(neu["nt"].to_list())[order]
        sign = np.ones(n, dtype=np.int8)
        for k, name in enumerate(NT_NAMES):
            sign[nt == k] = NT_SIGN[name]
        syn_out = np.bincount(pre, weights=cnt, minlength=n).astype(np.int64)
        syn_in = np.bincount(post, weights=cnt, minlength=n).astype(np.int64)
        uncalled = nt < 0
        conf = neu["nt_confidence"].cast(pl.Float64, strict=False).to_numpy()[order]
        stats["transmitter_calls"] = {name: int((nt == k).sum()) for k, name in enumerate(NT_NAMES)}
        stats["uncalled_neurons"] = int(uncalled.sum())
        stats["uncalled_neurons_with_outputs"] = int((uncalled & (syn_out > 0)).sum())
        stats["uncalled_output_synapses"] = int(syn_out[uncalled].sum())
        stats["calls_below_0.5_confidence"] = int((~uncalled & np.isfinite(conf) & (conf < 0.5)).sum())
        stats["calls_without_confidence"] = int((~uncalled & ~np.isfinite(conf)).sum())
        stats["default_sign_for_uncalled_neurons"] = 1
        stats["synapses_by_presynaptic_transmitter"] = {
            name: int(syn_out[nt == k].sum()) for k, name in enumerate(NT_NAMES)
        } | {"uncalled": stats["uncalled_output_synapses"]}

        # Each neuron's top input and output neuropil (ties: the first name in sorted order).
        npi = con["neuropil"].cast(pl.Enum(neuropils)).to_physical().to_numpy().astype(np.int64)
        n_np = len(neuropils)

        def top(idx: np.ndarray) -> np.ndarray:
            mat = np.bincount(idx * n_np + npi, weights=cnt, minlength=n * n_np).reshape(n, n_np)
            t = mat.argmax(axis=1).astype(np.int16)
            t[mat.max(axis=1) == 0] = -1
            return t

        top_in, top_out = top(post), top(pre)
        c = cx.from_edges(root_ids, pre, post, cnt, sign)
        c.nt, c.syn_in, c.syn_out, c.top_in_neuropil, c.top_out_neuropil = nt, syn_in, syn_out, top_in, top_out
        del con, pre, post, cnt, npi
        structure = cx.validate(c)
        if structure["synapses"] + stats["synapses_dropped_unknown_ids"] != source_synapses:
            raise cx.ConnectomeError("synapse totals do not reconcile with the source table")
    c.manifest = {
        "name": Path(out).name,
        "dataset": "unverified inputs (test fixture)" if files else "BANC v888 brain and ventral nerve cord (FlyWire Codex export, connections_princeton)",
        # Which dataset's populations apply (populations.py refuses the others').
        "dataset_key": DATASET,
        "sign_policy": SIGN_POLICY,
        "inputs": (
            {k: {"file": str(v), "verified": False} for k, v in paths.items()}
            if files
            else {"pin": {k: record[k] for k in ("dataset", "terms", "cite", "retrieved", "files")}, "reviewed": True}
        ),
        "counts": structure,
        "import": stats,
        "neuropils": neuropils,
        "code": code_state(),
        "resources": meter.describe() | {"machine": machine()},
        "created_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "transmitter_names": list(NT_NAMES),
        "transmitter_sign": dict(NT_SIGN),
        "transmitter_sign_notes": SIGN_NOTES,
    }
    t0 = time.monotonic()
    cx.save(c, out)
    log(f"wrote {out} ({structure['neurons']:,} neurons, {structure['pairs']:,} pairs, {structure['synapses']:,} synapses; saved in {time.monotonic() - t0:.1f} s)")
    return cx.load(out)


def dataset_of(c: cx.Connectome) -> str:
    """The dataset whose neurons ``c`` holds: BANC's import says so; every other import is FAFB v783's."""
    return str(c.manifest.get("dataset_key", "fafb-v783"))
