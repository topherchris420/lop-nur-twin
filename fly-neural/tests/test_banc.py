"""BANC v888 import, dataset separation and the brain-and-cord/v3 mapping, on synthetic tables.

The tables here are made up in BANC's export format (display headings in the
neuron table, Princeton-style connections with an empty transmitter column);
no BANC data is read, so nothing here needs a download or a pin.
"""

import csv
import gzip
import json
from pathlib import Path

import numpy as np
import pytest

from fly_neural import banc, codex, experiments, populations, sensory, stats
from fly_neural import connectome as cx

HEAD = list(banc.NEURON_COLUMNS)
EXPERIMENTS = Path(__file__).resolve().parents[1] / "experiments"


def neuron(root_id, nt="ACH", **kw):
    row = {h: "" for h in HEAD}
    row.update({"Root ID": str(root_id), "Predicted NT type": nt, "Predicted NT confidence": "0.9" if nt else ""})
    names = {v: k for k, v in banc.NEURON_COLUMNS.items()}
    for k, v in kw.items():
        row[names[k]] = v
    return row


# Root ids are made up. One of each cell type the v3 mapping reads, a little wiring between them.
NEURONS = [
    neuron(101, super_class="sensory", body_part="front_leg", function="Gr5a,gustatory,sugar", side="left"),
    neuron(102, super_class="sensory", body_part="hind_leg", function="Gr5a,gustatory,sugar", side="right"),
    neuron(103, super_class="sensory", body_part="front_leg", function="Gr64f,Ir56b,low_salt,sugar,tactile", side="left"),
    neuron(201, super_class="ascending", cell_type="AN_x", side="left"),
    neuron(301, super_class="motor", cell_class="proboscis_motor_neuron", cell_type="MN9", side="left"),
    neuron(401, super_class="descending", cell_type="DNp01", side="left"),
    neuron(402, super_class="motor", cell_class="leg_motor_neuron", cell_type="TTMn", body_part="middle_leg", side="left", nt="OCT"),
    neuron(501, super_class="descending", cell_type="DNg62", side="right"),
    neuron(601, super_class="motor", cell_class="leg_motor_neuron", cell_type="tibia_flexor", body_part="front_leg", side="right", nt="GLUT"),
    neuron(602, super_class="motor", cell_class="leg_motor_neuron", cell_type="tibia_flexor", body_part="hind_leg", side="right", nt="GLUT"),
    neuron(701, super_class="optic_lobe_intrinsic", cell_type="R7", nt="HIST"),
    neuron(702, super_class="central_brain_intrinsic", cell_type="x", nt="TYR"),
    neuron(703, super_class="central_brain_intrinsic", cell_type="y", nt=""),
]
EDGES = [  # pre, post, neuropil, synapses
    (101, 201, "VNC_T1_ProNm_L", 6),
    (101, 201, "VNC_T1_ProNm_R", 2),
    (102, 201, "VNC_T3_MetaNm_R", 5),
    (201, 301, "GNG", 30),
    (401, 402, "IntTct", 8),
    (501, 601, "VNC_T1_ProNm_R", 40),
    (701, 702, "ME_L", 3),
    (703, 702, "SMP_L", 4),
    (702, 703, "SMP_L", 3),
]


def write_tables(d: Path, neurons=NEURONS, edges=EDGES) -> dict[str, Path]:
    d.mkdir(parents=True, exist_ok=True)
    n, c = d / "neurons.csv.gz", d / "connections_princeton.csv.gz"
    with gzip.open(n, "wt", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=HEAD)
        w.writeheader()
        w.writerows(neurons)
    with gzip.open(c, "wt", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["pre_root_id", "post_root_id", "neuropil", "syn_count", "nt_type"])
        for a, b, npl, s in edges:
            w.writerow([a, b, npl, s, ""])
    return {"neurons": n, "connections": c}


@pytest.fixture
def banc_fixture(tmp_path, monkeypatch):
    files = write_tables(tmp_path / "src")
    c = banc.import_banc(tmp_path / "compiled", files=files, log=lambda *_: None)
    table = banc.read_neurons(files["neurons"])
    monkeypatch.setattr(banc, "neurons", lambda root=None: table)
    return c, files


def test_import_compiles_the_cord_with_per_neuron_signs(banc_fixture):
    c, _ = banc_fixture
    m = c.manifest
    assert m["dataset_key"] == "banc-v888" and m["sign_policy"] == banc.SIGN_POLICY
    assert m["inputs"]["neurons"]["verified"] is False  # a fixture is never presented as the reviewed pin
    assert c.n == len(NEURONS) and c.pairs == 8 and c.synapses == sum(e[3] for e in EDGES)
    # Two neuropil rows of one pair are summed into one pair.
    i, j = c.index_of([101, 201])
    post, cnt = c.out_edges(int(i))
    assert dict(zip(post.tolist(), cnt.tolist())) == {int(j): 8}
    sign = dict(zip(c.root_ids.tolist(), c.sign.tolist()))
    assert sign[601] == -1 and sign[701] == -1  # glutamate, histamine: inhibitory
    assert sign[702] == 1 and sign[402] == 1 and sign[101] == 1  # tyramine, octopamine, acetylcholine
    assert sign[703] == 1  # no call: +1, and counted
    st = m["import"]
    assert st["uncalled_neurons"] == 1 and st["uncalled_neurons_with_outputs"] == 1 and st["uncalled_output_synapses"] == 4
    assert st["transmitter_calls"]["hist"] == 1 and st["transmitter_calls"]["tyr"] == 1
    assert m["transmitter_names"][: len(cx.NT_NAMES)] == list(cx.NT_NAMES)
    assert c.top_out_neuropil[int(c.index_of([101])[0])] == m["neuropils"].index("VNC_T1_ProNm_L")
    assert cx.validate(c)["synapses"] == c.synapses and c.manifest["counts"]["autapses"] == 0


def test_import_refuses_repeats_and_drops_unknown_ids(tmp_path):
    with pytest.raises(cx.ConnectomeError, match="repeats"):
        banc.import_banc(tmp_path / "a", files=write_tables(tmp_path / "s1", neurons=NEURONS + [NEURONS[0]]), log=lambda *_: None)
    c = banc.import_banc(tmp_path / "b", files=write_tables(tmp_path / "s2", edges=EDGES + [(999, 101, "GNG", 4)]), log=lambda *_: None)
    assert c.manifest["import"]["rows_with_unknown_pre"] == 1 and c.manifest["import"]["synapses_dropped_unknown_ids"] == 4
    with pytest.raises(banc.BancError, match="unknown transmitter"):
        banc.import_banc(tmp_path / "c", files=write_tables(tmp_path / "s3", neurons=NEURONS + [neuron(900, nt="NOPE")]), log=lambda *_: None)


def test_simulation_reads_only_the_reviewed_pin(tmp_path):
    files = write_tables(codex.dataset_dir("banc-v888", tmp_path))
    with pytest.raises(codex.CodexError, match="no pin"):
        banc.reviewed_files(tmp_path)
    codex.pin("banc-v888", files, banc.REVIEWED["terms"], banc.REVIEWED["cite"], "2026-10-31", tmp_path)
    # The Codex reference layer reads any pin; the simulation refuses bytes nobody reviewed.
    assert codex.load("banc-v888", tmp_path).dataset == "banc-v888"
    with pytest.raises(banc.BancError, match="not the reviewed one"):
        banc.reviewed_files(tmp_path)


def test_populations_never_cross_datasets(banc_fixture):
    c, _ = banc_fixture
    idx, rep = populations.resolve("banc_tarsal_sugar", c)
    assert c.root_ids[idx].tolist() == [101, 102]  # the tactile 'sugar' bristle (103) is not a gustatory neuron
    assert rep["dataset"] == "banc-v888" and rep["neurons"] == 2
    assert c.root_ids[populations.resolve("banc_tarsal_sugar_left", c)[0]].tolist() == [101]
    assert c.root_ids[populations.resolve("banc_leg_mn_front", c)[0]].tolist() == [601]
    with pytest.raises(cx.ConnectomeError, match="never pooled"):
        populations.resolve("mn9_left", c)
    v783 = cx.from_edges([1, 2], [0], [1], [5], [1, 1], manifest={"dataset": "FlyWire FAFB public release v783"})
    with pytest.raises(cx.ConnectomeError, match="never pooled"):
        populations.resolve("banc_mn9", v783)
    assert all(p.dataset == "banc-v888" for k, p in populations.POPULATIONS.items() if k.startswith("banc_"))
    assert all(p.dataset == "fafb-v783" for k, p in populations.POPULATIONS.items() if not k.startswith("banc_"))


def test_v3_mapping_tastes_with_the_legs_and_refuses_the_other_dataset(banc_fixture):
    c, _ = banc_fixture
    m = sensory.Mapper(c, sensory.V3)
    obs = sensory.observation({"onFood": True, "odour": 0.5, "airflow": 0.2, "looming": None})
    r = m.rates(obs)
    assert r["banc_tarsal_sugar_left"] == r["banc_tarsal_sugar_right"] == 100.0
    assert r["banc_orn_vinegar_left"] == 50.0 and not any(k.startswith("sugar_grn") for k in r)
    assert {p.label for p in m.poisson(obs)} == {"banc_tarsal_sugar_left", "banc_tarsal_sugar_right"}  # the others have no neurons here
    with pytest.raises(sensory.ObservationError, match="banc-v888"):
        sensory.Mapper(c, sensory.V2)
    v783 = cx.from_edges([1, 2], [0], [1], [5], [1, 1])
    with pytest.raises(sensory.ObservationError, match="fafb-v783"):
        sensory.Mapper(v783, sensory.V3)
    d = sensory.describe_mapping(sensory.V3)
    assert d["dataset"] == "banc-v888" and "motor" in d and set(d["readouts"]) == set(sensory.READOUTS_V2) | {"jump"}
    food = next(ch for ch in d["channels"] if ch["key"] == "food contact")
    assert food["populations"] == ["banc_tarsal_sugar_left", "banc_tarsal_sugar_right"]
    # v1 and v2 keep their descriptions.
    assert "dataset" not in sensory.describe_mapping(sensory.V2) and "motor" not in sensory.describe_mapping("v1")


def test_v3_trailing_readout_reports_the_cord(banc_fixture):
    c, _ = banc_fixture
    m = sensory.Mapper(c, sensory.V3)
    tr = sensory.TrailingReadout(m.idx, 100.0, sensory.V3)
    counts = np.zeros(c.n, dtype=np.int64)
    i_ttmn, i_front, i_gf = (int(c.index_of([x])[0]) for x in (402, 601, 401))
    counts[[i_ttmn, i_gf]] = 1
    counts[i_front] = 3
    out = tr.update(counts, 10.0)
    assert out["escape"]["predicted"] and out["jump"]["predicted"] and out["jump"]["spikes"] == 1
    assert out["motor"]["legs"]["front_right"] == pytest.approx(300.0) and out["motor"]["legs"]["hind_right"] == 0.0
    assert set(out["motor"]["wing_power"]) == {"left", "right"}
    # The jump is a reflex, read from the newest window only.
    later = tr.update(np.zeros(c.n, dtype=np.int64), 10.0)
    assert not later["jump"]["predicted"] and later["motor"]["legs"]["front_right"] == pytest.approx(150.0)
    assert list(out)[-2:] == ["descending", "window_ms"]


def test_sign_test_and_paired_criterion():
    st = stats.sign_test([3, 3, 3, 1], [1, 1, 1, 1])
    assert (st["a_greater"], st["b_greater"], st["ties"]) == (3, 0, 1) and st["p"] == pytest.approx(1 / 8)
    trials = 12
    res = {"adn-200": {"readout_spikes_per_trial": {"front": [20] * trials, "hind": [1] * trials}}}
    crit = {"id": "X", "claim": "", "test": "paired_greater", "condition": "adn-200", "a_readout": "front", "b_readout": "hind", "per_neuron": True, "alpha": 0.01}
    v = experiments.judge(crit, res, 1.0, {"front": 10, "hind": 1})
    assert v["a_mean_hz"] == pytest.approx(2.0) and v["b_mean_hz"] == pytest.approx(1.0)
    assert v["passed"] and v["sign_test"]["p"] == pytest.approx(0.5**12)
    with pytest.raises(ValueError, match="neuron counts"):
        experiments.judge(crit, res, 1.0)


def test_the_banc_experiment_is_well_formed():
    cfg = experiments.load_config(EXPERIMENTS / "banc-cord-v888.json")
    keys = set(cfg["readouts"]) | {k for cond in cfg["conditions"] for k in cond["stimulate"]}
    assert keys <= set(populations.POPULATIONS) and all(k.startswith("banc_") for k in keys)
    assert cfg["protocol"]["sign_policy"] == banc.SIGN_POLICY and cfg["protocol"]["connectome"] == banc.COMPILED_NAME
    for crit in cfg["criteria"]:
        for k in ("readout", "a_readout", "b_readout"):
            if k in crit:
                assert crit[k] in cfg["readouts"]
    assert json.loads((EXPERIMENTS / "banc-cord-v888.json").read_text(encoding="utf-8"))["seeds"].keys() == {"dev", "heldout"}


def test_the_calibrated_file_changes_only_w_syn():
    a = json.loads((EXPERIMENTS / "banc-cord-v888.json").read_text(encoding="utf-8"))
    b = json.loads((EXPERIMENTS / "banc-cord-v888-calibrated.json").read_text(encoding="utf-8"))
    same = lambda d: {k: v for k, v in d.items() if k not in ("id", "title", "preregistration", "protocol")}  # noqa: E731
    assert same(a) == same(b)
    assert {k: v for k, v in b["protocol"].items() if k != "w_syn_mV"} == a["protocol"] and "w_syn_mV" not in a["protocol"]
    # The rule the file states: Shiu et al.'s 0.275 mV times FAFB v783's synapses per neuron over BANC v888's.
    assert b["protocol"]["w_syn_mV"] == round(0.275 * (54_492_922 / 139_255) / (23_556_214 / 158_262), 3)
    assert "No other value was tried" in b["preregistration"]


def test_the_report_states_the_paired_verdict():
    from fly_neural import report

    v = {"test": "paired_greater", "a_mean_hz": 570.04, "b_mean_hz": 8.31, "per_neuron": True, "sign_test": {"a_greater": 30, "b_greater": 0, "p": 0.5**30}}
    assert report._verdict(v) == "570.0 vs 8.3 Hz per neuron; higher in 30 of 30 trials that differ, one-sided sign test p = 9.3e-10"
