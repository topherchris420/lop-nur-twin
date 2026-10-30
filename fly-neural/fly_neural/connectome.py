"""A compiled connectome: one directory of .npy arrays and a sealed manifest.

Neurons are indexed by position in ``root_ids``, sorted ascending, so an index
is stable for a given release and never depends on the order of a source file.
Connections are a CSR matrix with presynaptic rows: ``indptr`` (int64, n+1),
``indices`` (int32 postsynaptic index, ascending and unique within a row) and
``syn_count`` (int32, the synapses between that pair summed over neuropils).
The sign of a connection is its presynaptic neuron's (``sign``, int8 per
neuron), as in Shiu et al.'s model, so ``syn_count * sign[pre]`` is the
signed weight in synapses. Nothing is dense: the full v783 graph is about
130 MB in memory.

Counts are kept apart and never conflated: neurons (rows of ``root_ids``),
neuron-to-neuron pairs (nonzero entries), and synapses (the sum of
``syn_count``). The source table's rows are (pair, neuropil) records, a fourth
quantity the manifest also states.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from . import CONNECTOME_SCHEMA
from .record import check_seal

NT_NAMES = ("gaba", "ach", "glut", "oct", "ser", "da")
# Shiu et al. 2024: acetylcholine excitatory; GABA and glutamate inhibitory;
# the modulatory transmitters count as excitatory. Their Connectivity_783
# gives every presynaptic neuron one sign (0 of 138,005 mixed) and follows this
# mapping by transmitter; their per-neuron transmitter calls differ from a
# synapse-weighted call for some neurons, and the importer records how many.
NT_SIGN = {"gaba": -1, "ach": 1, "glut": -1, "oct": 1, "ser": 1, "da": 1}
ARRAYS = ("root_ids", "indptr", "indices", "syn_count", "sign", "nt", "nt_prob", "syn_in", "syn_out", "top_in_neuropil", "top_out_neuropil")


class ConnectomeError(ValueError):
    pass


@dataclass
class Connectome:
    root_ids: np.ndarray
    indptr: np.ndarray
    indices: np.ndarray
    syn_count: np.ndarray
    sign: np.ndarray
    manifest: dict = field(default_factory=dict)
    nt: np.ndarray | None = None
    nt_prob: np.ndarray | None = None
    syn_in: np.ndarray | None = None
    syn_out: np.ndarray | None = None
    top_in_neuropil: np.ndarray | None = None
    top_out_neuropil: np.ndarray | None = None

    @property
    def n(self) -> int:
        return int(self.root_ids.size)

    @property
    def pairs(self) -> int:
        return int(self.indices.size)

    @property
    def synapses(self) -> int:
        return int(self.syn_count.sum(dtype=np.int64))

    def index_of(self, root_ids, *, strict: bool = True) -> np.ndarray:
        """Indices of the given root ids; strict raises on any id not in this release."""
        ids = np.asarray(root_ids, dtype=np.int64)
        pos = np.searchsorted(self.root_ids, ids)
        pos = np.clip(pos, 0, self.n - 1)
        ok = self.root_ids[pos] == ids
        if strict and not ok.all():
            missing = ids[~ok].tolist()
            raise ConnectomeError(f"{len(missing)} root id(s) not in this connectome: {missing[:5]}")
        return pos[ok] if not strict else pos

    def has(self, root_id: int) -> bool:
        i = int(np.searchsorted(self.root_ids, root_id))
        return i < self.n and int(self.root_ids[i]) == int(root_id)

    def pre_of_edges(self) -> np.ndarray:
        return np.repeat(np.arange(self.n, dtype=np.int32), np.diff(self.indptr))

    def signed_count(self) -> np.ndarray:
        """Signed synapse count per pair (int32): syn_count * sign[pre]."""
        return self.syn_count * self.sign[self.pre_of_edges()].astype(np.int32)

    def out_edges(self, i: int) -> tuple[np.ndarray, np.ndarray]:
        a, b = int(self.indptr[i]), int(self.indptr[i + 1])
        return self.indices[a:b], self.syn_count[a:b]

    def neuropil_names(self) -> list[str]:
        return list(self.manifest.get("neuropils", []))


def validate(c: Connectome) -> dict:
    """Structural checks; raises ConnectomeError on the first failure, else returns counts."""
    n = c.n
    if c.root_ids.dtype != np.int64 or c.root_ids.ndim != 1:
        raise ConnectomeError("root_ids must be a 1-d int64 array")
    if n and not (np.diff(c.root_ids) > 0).all():
        raise ConnectomeError("root_ids must be strictly ascending (sorted and unique)")
    if c.indptr.shape != (n + 1,) or c.indptr[0] != 0 or c.indptr[-1] != c.indices.size:
        raise ConnectomeError("indptr must have n+1 entries from 0 to the number of pairs")
    if (np.diff(c.indptr) < 0).any():
        raise ConnectomeError("indptr must be non-decreasing")
    if c.indices.size != c.syn_count.size:
        raise ConnectomeError("indices and syn_count differ in length")
    if c.indices.size and (c.indices.min() < 0 or c.indices.max() >= n):
        raise ConnectomeError("a postsynaptic index is out of range")
    if c.syn_count.size and c.syn_count.min() < 1:
        raise ConnectomeError("every stored pair needs at least one synapse")
    if c.sign.shape != (n,) or not np.isin(c.sign, (-1, 1)).all():
        raise ConnectomeError("sign must be -1 or +1 for every neuron")
    # Within each row the targets must ascend strictly: no duplicate pairs.
    if c.indices.size > 1:
        starts = np.zeros(c.indices.size, dtype=bool)
        starts[c.indptr[:-1][np.diff(c.indptr) > 0]] = True
        bad = (np.diff(c.indices.astype(np.int64)) <= 0) & ~starts[1:]
        if bad.any():
            raise ConnectomeError("a row has unsorted or duplicate postsynaptic indices")
    autapses = int((c.pre_of_edges() == c.indices).sum()) if c.indices.size else 0
    out_degree = np.diff(c.indptr)
    in_degree = np.bincount(c.indices, minlength=n)
    return {
        "neurons": n,
        "pairs": c.pairs,
        "synapses": c.synapses,
        "autapses": autapses,
        "neurons_without_outputs": int((out_degree == 0).sum()),
        "neurons_without_inputs": int((in_degree == 0).sum()),
        "isolated_neurons": int(((out_degree == 0) & (in_degree == 0)).sum()),
        "max_pair_synapses": int(c.syn_count.max()) if c.syn_count.size else 0,
        "inhibitory_neurons": int((c.sign < 0).sum()),
    }


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def save(c: Connectome, out: Path) -> Path:
    out.mkdir(parents=True, exist_ok=True)
    files = {}
    for name in ARRAYS:
        arr = getattr(c, name)
        if arr is None:
            continue
        p = out / f"{name}.npy"
        np.save(p, arr, allow_pickle=False)
        files[name] = {"sha256": _sha256(p), "dtype": str(arr.dtype), "shape": list(arr.shape)}
    manifest = {**c.manifest, "schema": CONNECTOME_SCHEMA, "files": files}
    from .record import sealed, write_json

    write_json(out / "manifest.json", sealed(manifest))
    return out


def load(path: Path, *, mmap: bool = True, verify_hashes: bool = False) -> Connectome:
    """Load a compiled connectome. Arrays are memory-mapped (shared between processes)."""
    man_path = path / "manifest.json"
    if not man_path.is_file():
        raise ConnectomeError(f"{path} has no manifest.json; build it with `python -m fly_neural import`")
    manifest = json.loads(man_path.read_text(encoding="utf-8"))
    if manifest.get("schema") != CONNECTOME_SCHEMA:
        raise ConnectomeError(f"{man_path} is {manifest.get('schema')!r}, not {CONNECTOME_SCHEMA}")
    if not check_seal(manifest):
        raise ConnectomeError(f"{man_path} does not match its own sha256")
    arrays = {}
    for name, meta in manifest["files"].items():
        p = path / f"{name}.npy"
        if verify_hashes and _sha256(p) != meta["sha256"]:
            raise ConnectomeError(f"{p} does not match the manifest's SHA-256")
        arrays[name] = np.load(p, mmap_mode="r" if mmap else None, allow_pickle=False)
    return Connectome(manifest=manifest, **arrays)


def from_edges(root_ids, pre_idx, post_idx, counts, sign, manifest: dict | None = None) -> Connectome:
    """Build a CSR connectome from (pre, post, count) triples, summing duplicate pairs."""
    root_ids = np.asarray(root_ids, dtype=np.int64)
    n = root_ids.size
    pre_idx = np.asarray(pre_idx, dtype=np.int64)
    post_idx = np.asarray(post_idx, dtype=np.int64)
    counts = np.asarray(counts, dtype=np.int64)
    key = pre_idx * n + post_idx
    order = np.argsort(key, kind="stable")
    key = key[order]
    counts = counts[order]
    uniq, start = np.unique(key, return_index=True)
    summed = np.add.reduceat(counts, start) if key.size else counts
    pre = (uniq // n).astype(np.int64)
    post = (uniq % n).astype(np.int32)
    indptr = np.zeros(n + 1, dtype=np.int64)
    np.cumsum(np.bincount(pre, minlength=n), out=indptr[1:])
    if summed.size and summed.max() > np.iinfo(np.int32).max:
        raise ConnectomeError("a pair's synapse count exceeds int32")
    return Connectome(
        root_ids=root_ids,
        indptr=indptr,
        indices=post,
        syn_count=summed.astype(np.int32),
        sign=np.asarray(sign, dtype=np.int8),
        manifest=manifest or {},
    )
