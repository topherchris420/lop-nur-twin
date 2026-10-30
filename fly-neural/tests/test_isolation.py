"""The backend's boundaries: one module touches the network, none touches production."""

import ast
from pathlib import Path

import pytest

from fly_neural import sensory, shadow
from fly_neural.plasticity import sign_test_negative

PACKAGE = Path(__file__).resolve().parents[1] / "fly_neural"
REPO = PACKAGE.parents[1]
NETWORK = {"urllib", "http", "socket", "ssl", "requests", "httpx", "ftplib", "smtplib"}


def imports(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    out = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            out |= {a.name.split(".")[0] for a in node.names}
        elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            out.add(node.module.split(".")[0])
    return out


def test_only_acquire_touches_the_network():
    for f in PACKAGE.glob("*.py"):
        used = imports(f) & NETWORK
        if f.name == "acquire.py":
            assert used, "acquire.py is the one module that fetches"
        else:
            assert not used, f"{f.name} imports {used}"


def test_production_code_never_reaches_the_backend():
    for root in ("src", "deploy"):
        for f in (REPO / root).rglob("*"):
            if f.is_file() and f.suffix in {".ts", ".tsx", ".js", ".mjs", ".sh", ".service", ".timer", ".py", ".conf"}:
                text = f.read_text(encoding="utf-8", errors="replace")
                assert "fly_neural" not in text and "fly-neural" not in text, f


def test_no_dataset_or_credential_is_committed():
    big = [p for p in (REPO / "fly-neural").rglob("*") if p.is_file() and p.stat().st_size > 2_000_000]
    assert not big, f"large files under fly-neural/: {big}"
    for p in (REPO / "fly-neural").rglob("*"):
        assert p.suffix not in {".feather", ".parquet", ".npy", ".npz", ".arrow"}, p
    for f in PACKAGE.glob("*.py"):
        text = f.read_text(encoding="utf-8")
        for marker in ("Authorization:", "Bearer ", "CAVE_TOKEN", "api_key=", "hf_"):
            assert marker not in text or f.name == "test_isolation.py", (f, marker)


def test_observation_keeps_only_sensable_fields():
    ok = sensory.observation({"looming": {"sizeDeg": 20, "expansionDegS": 300, "bearing": 0.4}, "airflow": 0.2, "airflowFrom": None, "odour": 0.1, "onFood": False})
    assert ok["looming"] == {"sizeDeg": 20.0, "expansionDegS": 300.0, "bearing": 0.4}
    for bad in (
        {"looming": {"sizeDeg": 20, "expansionDegS": 300, "bearing": 0.4, "distance": 0.3}},
        {"looming": {"sizeDeg": 20, "expansionDegS": 300, "bearing": 0.4, "drive": 2.0}},
        {"onFood": "fruit"},
        {"p": [0, 0, 0]},
        {"landmarks": []},
    ):
        with pytest.raises(sensory.ObservationError):
            sensory.observation(bad)


def test_shadow_refuses_anything_but_a_research_subject():
    good = {"schema": "fly-neural-shadow/v1", "mode": "neural-shadow", "subject": "research-looms-1"}
    shadow.check_header(good)
    for bad in (
        {**good, "subject": "04f8c797"},
        {**good, "subject": "research-copy", "note": "04f8c797b6971a46138dabc3fdfde5baae2aa224d3a8f9c0099a7c207dec1921"},
        {**good, "subject": "research-x", "lifeId": "abc"},
        {**good, "note": "restored from /var/lib/bethesda-life/store"},
        {**good, "note": "https://129-213-139-78.sslip.io/v1/now"},
        {**good, "mode": "production"},
        {**good, "schema": "bethesda-headless-life/v2"},
    ):
        with pytest.raises(shadow.RefusedSubject):
            shadow.check_header(bad)


def test_comparison_matches_onsets_and_counts_false_alarms():
    rows = []
    for k in range(200):
        t = k * 0.01
        echo = {"escape": k in (10, 150), "feeding": False} if k % 5 == 0 else None
        gf = k in (12, 13, 80)  # one hit 20 ms late, one false alarm; the onset at 1.5 s is missed
        rows.append({"t": t, "echo": echo, "outcome": {"mode": "feed" if k < 50 else "rest"}, "neural": {"escape": {"predicted": gf}, "feed": {"predicted": k < 60}}})
    out = shadow.compare(rows)
    e = out["escape"]
    assert (e["echo_onsets"], e["hits"], e["misses"], e["false_alarms"]) == (2, 1, 1, 1)
    assert e["gf_minus_echo_latency_s"][0] == pytest.approx(0.02)
    f = out["feed"]
    assert (f["both"], f["model_only"], f["echo_only"]) == (50, 10, 0)


def test_sign_test():
    assert sign_test_negative([-1] * 8) == pytest.approx(1 / 256)
    assert sign_test_negative([-1] * 7 + [1]) == pytest.approx(9 / 256)
