from fly_neural import record


def test_a_result_keeps_the_code_it_started_with(monkeypatch):
    states = iter([{"commit": "a" * 40, "dirty": False, "fly_neural": "d1"}, {"commit": "b" * 40, "dirty": False, "fly_neural": "d2"}])
    monkeypatch.setattr(record, "code_state", lambda results=None: next(states))
    finish = record.code_watch()
    out = finish()
    assert out["commit"] == "a" * 40 and out["fly_neural"] == "d1"
    assert out["changed_during_run"] == ["commit", "fly_neural"]


def test_an_unchanged_run_says_so(monkeypatch):
    monkeypatch.setattr(record, "code_state", lambda results=None: {"commit": "c" * 40, "dirty": False, "fly_neural": "d"})
    assert record.code_watch()()["changed_during_run"] == []


def test_seals_detect_any_edit():
    data = record.sealed({"x": 1, "y": [1, 2]})
    assert record.check_seal(data)
    data["y"][0] = 3
    assert not record.check_seal(data)
