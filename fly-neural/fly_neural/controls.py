"""Null wirings for ablations: the same neurons, the same stimuli, the connectome's structure destroyed.

Each control returns ``(indptr, indices, signed_count)`` for ``lif.Network(c,
wiring=...)``, built from the real connectome by a seeded permutation, so it
keeps exactly the properties named and nothing else:

- ``weight-shuffle``: the topology is kept; the signed synapse counts are
  permuted across all connected pairs. This is Shiu et al.'s control ("weights
  were shuffled randomly while maintaining the global connectivity weight
  distribution"). Dale's law is broken: a neuron's outputs get mixed signs.
- ``degree-preserving``: every neuron keeps its out-degree, its in-degree and its
  own outgoing signed counts (so its sign); the targets are permuted across all
  pairs (a configuration-model rewiring). Autapses and repeated pairs can
  appear and are counted.
- ``sign-shuffle``: wiring and counts are kept; the per-neuron signs are permuted,
  keeping the fraction of inhibitory neurons.
- ``random-graph``: as many pairs as the connectome, between uniformly random
  pre/post neurons (no autapses), with signed counts drawn from the real ones.
  Nothing but the size and the weight distribution is kept.

None of these is a connectome and results on them are never reported as one.
"""

from __future__ import annotations

import numpy as np

from .connectome import Connectome

CONTROLS = ("weight-shuffle", "degree-preserving", "sign-shuffle", "random-graph")


def _signed(c: Connectome, sign: np.ndarray | None = None) -> np.ndarray:
    s = np.asarray(c.sign if sign is None else sign).astype(np.int64)
    pre = np.repeat(np.arange(c.n, dtype=np.int64), np.diff(np.asarray(c.indptr)))
    return np.asarray(c.syn_count, dtype=np.int64) * s[pre]


def wiring(c: Connectome, kind: str, seed: int) -> tuple[tuple[np.ndarray, np.ndarray, np.ndarray], dict]:
    rng = np.random.default_rng(seed)
    indptr = np.asarray(c.indptr)
    indices = np.asarray(c.indices).astype(np.int64)
    signed = _signed(c)
    pre = np.repeat(np.arange(c.n, dtype=np.int64), np.diff(indptr))
    if kind == "weight-shuffle":
        signed = signed[rng.permutation(signed.size)]
    elif kind == "degree-preserving":
        indices = indices[rng.permutation(indices.size)]
    elif kind == "sign-shuffle":
        signed = _signed(c, np.asarray(c.sign)[rng.permutation(c.n)])
    elif kind == "random-graph":
        m = indices.size
        pre = rng.integers(0, c.n, size=m)
        post = rng.integers(0, c.n - 1, size=m)
        post = post + (post >= pre)  # no autapses
        order = np.argsort(pre, kind="stable")
        pre, indices = pre[order], post[order]
        signed = signed[rng.integers(0, signed.size, size=m)]
        indptr = np.zeros(c.n + 1, dtype=np.int64)
        np.cumsum(np.bincount(pre, minlength=c.n), out=indptr[1:])
    else:
        raise ValueError(f"unknown control {kind!r}; choose from {CONTROLS}")
    stats = {"control": kind, "seed": seed, "pairs": int(indices.size), "inhibitory_pairs": int((signed < 0).sum()), "synapses": int(np.abs(signed).sum())}
    if kind in ("weight-shuffle", "sign-shuffle"):
        # The connectome's own topology: no autapses or repeated pairs (connectome.validate).
        stats.update(autapses=0, repeated_pairs=0)
    else:
        key = pre * c.n + indices
        stats.update(autapses=int((pre == indices).sum()), repeated_pairs=int(key.size - np.unique(key).size))
    return (indptr, indices.astype(np.int32), signed), stats
