"""The Codex reference layer on synthetic tables: datasets apart, pins verified, answers exact."""

import gzip
import json
from pathlib import Path

import numpy as np
import pytest

from fly_neural import codex
from fly_neural.codex import CodexError

REPO = Path(__file__).resolve().parents[2]


def toy(dataset="fafb-v783"):
    # sensory 1 -> inter 2 -> motor 3; sensory 4 -> descending 5 directly; 6 isolated.
    # 2 <-> 7 reciprocal; triangle 2->7->8, 2->8 (feed-forward); cycle 9->10->11->9.
    neurons = {
        "root_id": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
        "super_class": ["sensory", "central", "motor", "sensory", "descending", "sensory", "central", "central", "central", "central", "central"],
        "cell_class": ["ORN", "LN", "MN", "GRN", "DN", "ORN", "LN", "LN", "x", "x", "x"],
        "nt": ["acetylcholine", "gaba", "acetylcholine", "acetylcholine", "acetylcholine", "acetylcholine", "glutamate", "gaba", "gaba", "gaba", "gaba"],
    }
    edges = {
        "pre": [1, 2, 4, 2, 7, 7, 2, 9, 10, 11, 1],
        "post": [2, 3, 5, 7, 2, 8, 8, 10, 11, 9, 3],
        "neuropil": ["AL_L", "SEZ", "SEZ", "LH_L", "LH_L", "LH_L", "LH_L", "MB_L", "MB_L", "MB_L", "SEZ"],
        "syn": [10, 12, 30, 6, 7, 9, 5, 8, 8, 8, 2],
    }
    return codex.tables_from_columns(dataset, neurons, edges)


def test_datasets_are_separate_and_honest():
    assert set(codex.DATASETS) == {"fafb-v783", "banc-v888"}
    banc = codex.DATASETS["banc-v888"]
    assert banc.terms is None and banc.pinned_sources == () and "Not yet pinned" in banc.note
    assert {s.value for s in banc.stated if s.what == "neurons"} == {158_262}
    fafb = codex.DATASETS["fafb-v783"]
    text = (REPO / "docs" / "ECHO_CONNECTOME.md").read_text(encoding="utf-8")
    for s in fafb.stated:
        if s.source == "docs/ECHO_CONNECTOME.md":
            assert f"{s.value:,}" in text, s


def test_datasets_are_never_combined():
    a, b = toy("fafb-v783"), toy("banc-v888")
    with pytest.raises(CodexError):
        a + b
    with pytest.raises(CodexError):
        codex.compare(codex.motifs(a), codex.motifs(a))
    rows = codex.compare(codex.motifs(a), codex.motifs(b))
    assert all(set(r) == {"metric", "fafb-v783", "banc-v888"} for r in rows)
    with pytest.raises(CodexError):
        codex.tables_from_columns("hemibrain", {"root_id": [1]}, {})


def test_counts_regions_pathways_and_motifs():
    t = toy()
    assert dict(codex.counts(t, "super_class"))["sensory"] == 3
    assert dict(codex.counts(t, "nt"))["gaba"] == 5
    assert codex.regions(t)[0] == ("SEZ", 44)
    p = codex.pathways(t, {"super_class": ["sensory"]}, {"super_class": ["motor", "descending"]}, max_hops=3, min_syn=5)
    # 1 reaches 3 through 2 (the direct 1->3 edge has 2 synapses, below min_syn); 4 reaches 5 directly; 6 reaches nothing.
    assert p["reached"] == 2 and p["hops"] == {1: 1, 2: 1}
    assert dict(p["routes"]) == {"sensory → central → motor": 1, "sensory → descending": 1}
    p1 = codex.pathways(t, {"super_class": ["sensory"]}, {"super_class": ["motor"]}, max_hops=3, min_syn=1)
    assert p1["hops"] == {1: 1}
    m = codex.motifs(t, min_syn=5)
    assert m["reciprocal_pairs"] == 1
    # 2->7->8 with 2->8, and (through the reciprocal pair) 7->2->8 with 7->8.
    assert m["feedforward_triangles"] == 2
    assert m["cyclic_triangles"] == 1


def test_read_table_by_alias_and_refusal(tmp_path):
    p = tmp_path / "classification.csv.gz"
    p.write_bytes(gzip.compress(b"root_id,class,superclass,nt_type\n5,DN,descending,acetylcholine\n7,LN,central,gaba\n"))
    cols = codex.read_table(p, codex.NEURON_COLUMNS, ("root_id",))
    assert cols["root_id"].tolist() == [5, 7] and cols["cell_class"].tolist() == ["DN", "LN"]
    q = tmp_path / "edges.tsv"
    q.write_text("pre_root_id\tpost_root_id\tneuropil\tsyn_count\n5\t7\tGNG\t12\n", encoding="utf-8")
    e = codex.read_table(q, codex.EDGE_COLUMNS, ("pre", "post"))
    assert e["syn"].tolist() == [12]
    bad = tmp_path / "bad.csv"
    bad.write_text("a,b\n1,2\n", encoding="utf-8")
    with pytest.raises(CodexError, match="no column"):
        codex.read_table(bad, codex.NEURON_COLUMNS, ("root_id",))



def test_native_banc_v888_download_headers_and_quoted_fields(tmp_path):
    """The actual Codex BANC export uses human-readable headings and quoted CSV."""
    neurons = tmp_path / "neurons.csv.gz"
    neurons.write_bytes(
        gzip.compress(
            (
                "Root ID,Community labels,Predicted NT type,Super Class,Class,"
                "Soma side,Primary Cell Type\\n"
                '720575940381905254,"first, second",ACH,sensory,'
                'olfactory_receptor_neuron,left,OR67d\\n'
                '720575940382537062,"third",GABA,descending,DN,right,DNp09\\n'
            ).replace("\\n", "\n").encode("utf-8")
        )
    )
    cols = codex.read_table(neurons, codex.NEURON_COLUMNS, ("root_id",))
    assert cols["root_id"].tolist() == [720575940381905254, 720575940382537062]
    assert cols["super_class"].tolist() == ["sensory", "descending"]
    assert cols["cell_class"].tolist() == ["olfactory_receptor_neuron", "DN"]
    assert cols["cell_type"].tolist() == ["OR67d", "DNp09"]
    assert cols["side"].tolist() == ["left", "right"]
    assert cols["nt"].tolist() == ["ACH", "GABA"]

    connections = tmp_path / "connections_princeton.csv.gz"
    connections.write_bytes(
        gzip.compress(
            (
                "pre_root_id,post_root_id,neuropil,syn_count,nt_type\\n"
                "720575940381905254,720575940382537062,AL_L,3,ACH\\n"
            ).replace("\\n", "\n").encode("utf-8")
        )
    )
    edges = codex.read_table(connections, codex.EDGE_COLUMNS, ("pre", "post"))
    assert edges["pre"].tolist() == [720575940381905254]
    assert edges["post"].tolist() == [720575940382537062]
    assert edges["neuropil"].tolist() == ["AL_L"]
    assert edges["syn"].tolist() == [3]


def test_pins_record_and_verify_every_byte(tmp_path):
    d = codex.dataset_dir("banc-v888", tmp_path)
    d.mkdir(parents=True)
    n = d / "neurons.csv"
    n.write_text("root_id,super_class\n1,sensory\n2,motor\n", encoding="utf-8")
    with pytest.raises(CodexError, match="no pin"):
        codex.load("banc-v888", tmp_path)
    with pytest.raises(CodexError, match="quotes the terms"):
        codex.pin("banc-v888", {"neurons": n}, "", "x", "2026-10-31", tmp_path)
    outside = tmp_path / "elsewhere.csv"
    outside.write_text("root_id\n1\n", encoding="utf-8")
    with pytest.raises(CodexError, match="must be in"):
        codex.pin("banc-v888", {"neurons": outside}, "terms as quoted", "cite as given", "2026-10-31", tmp_path)
    rec = codex.pin("banc-v888", {"neurons": n}, "terms as quoted", "cite as given", "2026-10-31", tmp_path)
    assert rec["files"][0]["size"] == n.stat().st_size
    t = codex.load("banc-v888", tmp_path)
    assert t.dataset == "banc-v888" and t.edges == {}
    assert codex.check_counts(t) == [{"stated": 158_262, "what": "neurons", "source": codex.READ_2026_10_31, "loaded": 2, "agrees": False}]
    n.write_text("root_id,super_class\n1,sensory\n2,motor\n3,motor\n", encoding="utf-8")
    with pytest.raises(CodexError, match="differs from its pin"):
        codex.load("banc-v888", tmp_path)
    rep = codex.report(codex.tables_from_columns("banc-v888", {"root_id": [1]}, {}), {"super_class": ["sensory"]}, {"super_class": ["motor"]})
    assert rep["pathways"] is None and rep["motifs"] is None and rep["connections_loaded"] is False


def test_links():
    links = codex.codex_links("banc-v888", root_ids=[720575940660219265], cell_types=["DNp01 & co"])
    assert links[0] == "https://codex.flywire.ai/?dataset=banc"
    assert links[1] == "https://codex.flywire.ai/app/cell_details?dataset=banc&root_id=720575940660219265"
    assert links[2] == "https://codex.flywire.ai/app/search?dataset=banc&filter_string=DNp01%20%26%20co"


def test_report_is_reproducible():
    a = json.dumps(codex.report(toy(), {"super_class": ["sensory"]}, {"super_class": ["motor"]}), default=str)
    b = json.dumps(codex.report(toy(), {"super_class": ["sensory"]}, {"super_class": ["motor"]}), default=str)
    assert a == b
