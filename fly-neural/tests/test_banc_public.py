"""Synthetic tests for the public BANC bridge: no network, no licensed data.

The public GCS products are converted into the *unreviewed* BANC import path.
The separate immutable Codex REVIEWED allowlist must remain intact.
"""
import json
from pathlib import Path

import polars as pl
import pytest

from fly_neural import acquire, banc, banc_public


def products(root: Path, *, nt: str = "acetylcholine"):
    raw = banc_public.raw_paths(root)
    raw["neurons"].parent.mkdir(parents=True, exist_ok=True)
    pl.DataFrame(
        {
            "root_888": [101, 201, 301],
            "cell_type": ["Gr5a", "AN1", "MN9"],
            "super_class": ["sensory", "ascending", "motor"],
            "cell_class": ["gustatory", "ascending", "proboscis_motor_neuron"],
            "cell_sub_class": ["", "", ""],
            "side": ["left", "left", "left"],
            "body_part_sensory": ["front_leg", "", ""],
            "cell_function": ["sugar", "", "feeding"],
            "flow": ["input", "inter", "output"],
            "nerve": ["", "", ""],
            "neurotransmitter_predicted": [nt, "glutamate", None],
            "neurotransmitter_score": [0.93, 0.88, None],
        }
    ).write_ipc(raw["neurons"])
    pl.DataFrame(
        {
            "pre_root_id": [101, 201],
            "post_root_id": [201, 301],
            "neuropil": ["VNC_T1_L", "GNG"],
            "num_synapses": [6, 8],
        }
    ).write_parquet(raw["connections"])
    return raw


def test_public_conversion_and_compilation(tmp_path):
    products(tmp_path)
    receipt = banc_public.prepare(tmp_path)
    assert receipt["schema"] == banc_public.SCHEMA
    assert receipt["reviewed_codex_bytes"] is False
    assert receipt["source_products"]["neurons"]["url"].startswith("https://storage.googleapis.com/")
    assert banc_public.prepare(tmp_path) == receipt  # identical local pin

    out = banc_public.import_public(tmp_path)
    assert out["dataset"] != banc.COMPILED_NAME
    assert out["counts"]["neurons"] == 3
    assert out["counts"]["synapses"] == 14
    assert out["reviewed_codex_bytes"] is False

    # The *existing* reviewed Codex importer cannot be fed these different bytes.
    with pytest.raises(Exception, match="no pin"):
        banc.reviewed_files(tmp_path)


def test_a_local_source_change_cannot_silently_repin(tmp_path):
    raw = products(tmp_path)
    banc_public.prepare(tmp_path)
    pl.DataFrame(
        {
            "pre_root_id": [101, 201],
            "post_root_id": [201, 301],
            "neuropil": ["VNC_T1_L", "GNG"],
            "syn_count": [6, 9],
        }
    ).write_parquet(raw["connections"])
    with pytest.raises(banc_public.PublicBancError, match="source changed"):
        banc_public.prepare(tmp_path)


def test_unknown_transmitter_is_not_invented(tmp_path):
    products(tmp_path, nt="new-unknown-transmitter")
    with pytest.raises(banc_public.PublicBancError, match="unknown BANC public transmitter"):
        banc_public.prepare(tmp_path)


def test_no_network_without_explicit_terms(tmp_path, monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError("network must not be called without consent")
    # acquire.py is the one module that touches the network; banc_public fetches through it.
    monkeypatch.setattr(acquire.urllib.request, "urlopen", forbidden)
    with pytest.raises(banc_public.PublicBancError, match="accept-cc-by"):
        banc_public.fetch_public(tmp_path, accept_terms=False)
    with pytest.raises(banc_public.PublicBancError, match="missing local BANC"):
        banc_public.prepare(tmp_path)


def test_missing_schema_fails_closed(tmp_path):
    raw = products(tmp_path)
    pl.DataFrame({"root_888": [1], "cell_type": ["x"]}).write_ipc(raw["neurons"])
    with pytest.raises(banc_public.PublicBancError, match="metadata missing required"):
        banc_public.prepare(tmp_path)


def test_local_pin_records_exact_source_digests(tmp_path):
    files = products(tmp_path)
    receipt = banc_public.prepare(tmp_path)
    from fly_neural.acquire import sha256_file
    for role, path in files.items():
        assert receipt["source_products"][role]["sha256"] == sha256_file(path)
    persisted = json.loads((banc_public.root_dir(tmp_path) / "source-manifest.json").read_text())
    assert receipt == persisted


def test_published_background_id_zero_is_audited_not_modeled(tmp_path):
    """v888 release contains zero-root background edges, not neural cells."""
    files = products(tmp_path)
    pl.DataFrame(
        {
            "pre_root_id": [101, 201, 0, 101, 0],
            "post_root_id": [201, 301, 201, 0, 0],
            "neuropil": ["VNC_T1_L", "GNG", "VNC_unassigned", "GNG", "GNG"],
            "num_synapses": [6, 8, 3, 5, 7],
        }
    ).write_parquet(files["connections"])
    receipt = banc_public.prepare(tmp_path)
    assert receipt["conversion_audit"]["raw_connection_rows"] == 5
    assert receipt["conversion_audit"]["modeled_connection_rows"] == 2
    assert receipt["conversion_audit"]["excluded_root_zero_rows"] == 3
    assert receipt["conversion_audit"]["excluded_root_zero_synapses"] == 15
    assert pl.read_parquet(files["connections"]).height == 5  # raw source preserved
    assert banc_public.import_public(tmp_path)["counts"]["synapses"] == 14
    assert banc_public.prepare(tmp_path) == receipt


def test_negative_ids_and_nonpositive_synapse_counts_still_fail(tmp_path):
    files = products(tmp_path)
    pl.DataFrame(
        {
            "pre_root_id": [-1],
            "post_root_id": [201],
            "neuropil": ["VNC_T1_L"],
            "num_synapses": [2],
        }
    ).write_parquet(files["connections"])
    with pytest.raises(banc_public.PublicBancError, match="negative IDs"):
        banc_public.prepare(tmp_path)
    pl.DataFrame(
        {
            "pre_root_id": [101],
            "post_root_id": [201],
            "neuropil": ["VNC_T1_L"],
            "num_synapses": [0],
        }
    ).write_parquet(files["connections"])
    with pytest.raises(banc_public.PublicBancError, match="connection counts"):
        banc_public.prepare(tmp_path)
