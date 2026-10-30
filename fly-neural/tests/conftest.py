import sys
from pathlib import Path

import numpy as np
import pytest

PACKAGE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PACKAGE))

from fly_neural import connectome as cx  # noqa: E402

NEUROPILS = ["GNG", "LAL_L", "LAL_R", "SMP_L"]


def synthetic_tables(tmp: Path, n: int = 50, seed: int = 0, extra_rows: list[dict] | None = None):
    """A tiny table in the v783 schema. Synthetic: ids and wiring are random, not FlyWire's."""
    import polars as pl

    rng = np.random.default_rng(seed)
    ids = np.sort(rng.choice(np.arange(10**15, 10**15 + 10**6), size=n, replace=False)).astype(np.uint64)
    rows = []
    for _ in range(4 * n):
        a, b = rng.integers(0, n, size=2)
        if a == b:
            continue
        p = rng.dirichlet(np.ones(6))
        rows.append(
            {
                "pre_pt_root_id": int(ids[a]),
                "post_pt_root_id": int(ids[b]),
                "neuropil": NEUROPILS[int(rng.integers(0, len(NEUROPILS)))],
                "syn_count": int(rng.integers(1, 40)),
                "gaba_avg": p[0],
                "ach_avg": p[1],
                "glut_avg": p[2],
                "oct_avg": p[3],
                "ser_avg": p[4],
                "da_avg": p[5],
            }
        )
    # Drop duplicate (pre, post, neuropil) keys: the real table has none.
    seen, uniq = set(), []
    for r in rows + (extra_rows or []):
        k = (r["pre_pt_root_id"], r["post_pt_root_id"], r["neuropil"])
        if k not in seen:
            seen.add(k)
            uniq.append(r)
    tmp.mkdir(parents=True, exist_ok=True)
    np.save(tmp / "root_ids.npy", ids)
    df = pl.DataFrame(uniq, schema_overrides={"pre_pt_root_id": pl.Int64, "post_pt_root_id": pl.Int64, "syn_count": pl.Int64})
    df.write_ipc(tmp / "connections.feather")
    return ids, df


@pytest.fixture
def tables(tmp_path):
    return synthetic_tables(tmp_path / "src")


def tiny_connectome(pre, post, signed, n: int) -> cx.Connectome:
    signed = np.asarray(signed, dtype=np.int64)
    pre = np.asarray(pre, dtype=np.int64)
    sign = np.ones(n, dtype=np.int8)
    for a, s in zip(pre.tolist(), signed.tolist()):
        sign[a] = 1 if s > 0 else -1
    return cx.from_edges(np.arange(1000, 1000 + n), pre, post, np.abs(signed), sign)
