"""The v783 importer on a synthetic table in the release's schema (no download needed)."""

import numpy as np
import polars as pl
import pytest
from conftest import synthetic_tables

from fly_neural import connectome as cx
from fly_neural.importer import import_v783


def files(tmp):
    return {"root_ids": tmp / "root_ids.npy", "connections": tmp / "connections.feather"}


def test_import_round_trip_and_counts(tmp_path):
    ids, df = synthetic_tables(tmp_path / "src")
    c = import_v783(tmp_path / "out", sign_policy="synapse-weighted", files=files(tmp_path / "src"), chunk_rows=37, log=lambda *a: None)
    cx.validate(c)
    assert c.n == ids.size
    assert c.synapses == int(df["syn_count"].sum())
    # pairs summed over neuropils
    pairs = df.group_by(["pre_pt_root_id", "post_pt_root_id"]).agg(pl.col("syn_count").sum())
    assert c.pairs == pairs.height
    for row in pairs.head(25).iter_rows(named=True):
        a, b = c.index_of([row["pre_pt_root_id"], row["post_pt_root_id"]])
        tgt, cnt = c.out_edges(int(a))
        assert int(cnt[list(tgt).index(int(b))]) == row["syn_count"]
    assert c.manifest["inputs"]["root_ids"]["verified"] is False
    assert "test fixture" in c.manifest["dataset"]
    loaded = cx.load(tmp_path / "out", verify_hashes=True)
    assert np.array_equal(loaded.indices, c.indices) and np.array_equal(loaded.sign, c.sign)


def test_chunking_does_not_change_the_result(tmp_path):
    synthetic_tables(tmp_path / "src", seed=4)
    a = import_v783(tmp_path / "a", sign_policy="synapse-weighted", files=files(tmp_path / "src"), chunk_rows=13, log=lambda *a: None)
    b = import_v783(tmp_path / "b", sign_policy="synapse-weighted", files=files(tmp_path / "src"), chunk_rows=10**6, log=lambda *a: None)
    for k in ("indptr", "indices", "syn_count", "sign"):
        assert np.array_equal(getattr(a, k), getattr(b, k)), k


def test_sign_is_synapse_weighted_transmitter(tmp_path):
    ids, _ = synthetic_tables(tmp_path / "src", n=10, extra_rows=None)
    # Neuron 0: 30 synapses of near-certain GABA, 10 of ACh -> inhibitory.
    rows = [
        {"pre_pt_root_id": int(ids[0]), "post_pt_root_id": int(ids[1]), "neuropil": "GNG", "syn_count": 30, "gaba_avg": 0.95, "ach_avg": 0.05, "glut_avg": 0.0, "oct_avg": 0.0, "ser_avg": 0.0, "da_avg": 0.0},
        {"pre_pt_root_id": int(ids[0]), "post_pt_root_id": int(ids[2]), "neuropil": "GNG", "syn_count": 10, "gaba_avg": 0.0, "ach_avg": 1.0, "glut_avg": 0.0, "oct_avg": 0.0, "ser_avg": 0.0, "da_avg": 0.0},
    ]
    df = pl.DataFrame(rows, schema_overrides={"pre_pt_root_id": pl.Int64, "post_pt_root_id": pl.Int64, "syn_count": pl.Int64})
    df.write_ipc(tmp_path / "src" / "connections.feather")
    c = import_v783(tmp_path / "out", sign_policy="synapse-weighted", files=files(tmp_path / "src"), log=lambda *a: None)
    assert c.sign[0] == -1


def test_rejects_unknown_ids_and_bad_counts(tmp_path):
    ids, _ = synthetic_tables(tmp_path / "src", n=10)
    bad = pl.DataFrame(
        [{"pre_pt_root_id": int(ids[0]), "post_pt_root_id": int(ids[1]), "neuropil": "GNG", "syn_count": 0, "gaba_avg": 0.2, "ach_avg": 0.8, "glut_avg": 0.0, "oct_avg": 0.0, "ser_avg": 0.0, "da_avg": 0.0}],
        schema_overrides={"pre_pt_root_id": pl.Int64, "post_pt_root_id": pl.Int64, "syn_count": pl.Int64},
    )
    bad.write_ipc(tmp_path / "src" / "connections.feather")
    with pytest.raises(cx.ConnectomeError):
        import_v783(tmp_path / "out", sign_policy="synapse-weighted", files=files(tmp_path / "src"), log=lambda *a: None)


def test_validate_catches_corruption(tmp_path):
    synthetic_tables(tmp_path / "src")
    c = import_v783(tmp_path / "out", sign_policy="synapse-weighted", files=files(tmp_path / "src"), log=lambda *a: None)
    c.indices = c.indices.copy()
    c.indices[0] = c.n + 5
    with pytest.raises(cx.ConnectomeError):
        cx.validate(c)


def test_tampered_compiled_file_is_detected(tmp_path):
    synthetic_tables(tmp_path / "src")
    import_v783(tmp_path / "out", sign_policy="synapse-weighted", files=files(tmp_path / "src"), log=lambda *a: None)
    arr = np.load(tmp_path / "out" / "syn_count.npy")
    arr[0] += 1
    np.save(tmp_path / "out" / "syn_count.npy", arr)
    with pytest.raises(cx.ConnectomeError):
        cx.load(tmp_path / "out", verify_hashes=True)
