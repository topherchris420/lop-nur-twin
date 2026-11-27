"""Bitwise continuation, binding to the body, and measured spiking on a small graph."""
from types import SimpleNamespace

import numpy as np
import pytest

from fly_neural import connectome, lif, sensory
from fly_neural.persistent import Brain


def fixture():
    keys = sorted({p for ch in sensory.channels(sensory.V3) for p in ch.populations}
                  | {p for r in sensory.readouts(sensory.V3).values() for p in r["populations"]}
                  | {p for g in sensory.MOTOR_V3.values() for p in g.values()}
                  | {sensory.descending_key(sensory.V3)})
    sensory_cell = keys.index("banc_tarsal_sugar_left")
    output = keys.index("banc_mn9_left")
    graph = connectome.from_edges(np.arange(len(keys)), [sensory_cell], [output], [1200],
                                  np.ones(len(keys), dtype=np.int8), {"dataset_key": "banc-v888"})
    mapper = sensory.Mapper(graph, sensory.V3, resolver=lambda key, _: (np.array([keys.index(key)]), {}))
    return SimpleNamespace(net=lif.Network(graph), mapper=mapper, pin="fixture-v1")


def test_spiking_controller_resumes_through_delays_rng_and_decoding():
    model = fixture()
    first = Brain(model, "garden-life-A")
    assert not first.step({"onFood": False}, 10)["feed"]["predicted"]
    assert first.step({"onFood": True}, 73.7)["feed"]["predicted"]
    saved = first.pack("body at contact")
    again = Brain(model, "garden-life-A")
    again.restore(saved, "body at contact")
    for contact in (False, True, False):
        assert first.step({"onFood": contact}, 17.3) == again.step({"onFood": contact}, 17.3)
    for key, values in first.state.to_arrays().items():
        assert np.array_equal(values, again.state.to_arrays()[key])


def test_refuses_a_mismatched_or_corrupt_checkpoint():
    model = fixture()
    fly = Brain(model, "A")
    saved = fly.pack("body1")
    for brain, body in ((Brain(model, "B"), "body1"), (fly, "body2")):
        with pytest.raises(ValueError, match="different"):
            brain.restore(saved, body)
    model.pin = "another graph"
    with pytest.raises(ValueError, match="different"):
        fly.restore(saved, "body1")
    with pytest.raises(ValueError, match="checksum"):
        fly.restore({**saved, "sha256": "0" * 64}, "body1")


def test_garden_samples_before_feeding_and_commits_the_body_with_its_brain(tmp_path, monkeypatch):
    from pathlib import Path
    import sqlite3
    import json
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[2] / "scripts"))
    import eva_persistent_connectome as garden
    db = tmp_path / "garden.sqlite"
    now = 1784044800
    original = garden.World(db, now=now)
    # Start on the pear, explicitly resting, with no upcoming departure.
    s = original.state
    s.update(place="pear", position=[garden.PLACES["pear"][k] for k in ("x", "y")],
             activity="resting", travel=None, next_decision=now + 300)
    original._save()
    original.close()
    model = fixture()
    live = garden.ConnectomeWorld(db, model, s["life_id"], attach=True)
    live._step(now + .1, .1)
    assert live.state["activity"] == "feeding"
    live.state["updated_at"] = now + .1
    live._save()
    saved = live.brain.state.to_arrays()
    live.close()
    restored = garden.ConnectomeWorld(db, model, s["life_id"])
    for k, x in saved.items():
        assert np.array_equal(x, restored.brain.state.to_arrays()[k])
    restored.close()
    conn = sqlite3.connect(db)
    body = json.loads(conn.execute("SELECT value FROM world").fetchone()[0])
    body["ticks"] += 1
    conn.execute("UPDATE world SET value=?", (json.dumps(body),))
    conn.commit()
    conn.close()
    with pytest.raises(ValueError, match="different"):
        garden.ConnectomeWorld(db, model, s["life_id"])
