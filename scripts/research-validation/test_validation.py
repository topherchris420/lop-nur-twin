"""Boundary tests and opt-in genuine-upstream simulation checks."""

import importlib.util
import json
import os
import subprocess
import sys
import types
from pathlib import Path

import pytest
import validation


@pytest.mark.parametrize("adapter,params,seeds", [
    ("shell", {}, [1]),
    ("qnp-stable", {"command": "unexpected"}, [1]),
    ("qnp-stable", {"shots": True}, [1]),
    ("qnp-stable", {"alpha": float("nan")}, [1]),
    ("qnp-stable", {"alpha": 10**1000}, [1]),
    ("qnp-stable", {"batches": 2}, [1]),
    ("qnp-stable", {"baseline_batches": 48}, [1]),
    ("qnp-stable", {"null_rate": 0.1}, [1]),
    ("qnp-drift", {"alternative_rate": 0.01}, [1]),
    ("qnp-stable", {"method": "eval"}, [1]),
    ("drr-null", {"n_surrogates": 19, "alpha": 0.01}, [1]),
    ("drr-null", {"n_surrogates": 499, "n_samples": 2048}, list(range(20))),
    ("drr-null", {"surrogate_method": "import"}, [1]),
    ("drr-null", {"ar_coefficient": 1}, [1]),
    ("qnp-stable", {}, []),
    ("qnp-stable", {}, [1, 1]),
    ("qnp-stable", {}, [True]),
    ("qnp-stable", {}, [-1]),
    ("qnp-stable", {}, list(range(257))),
])
def test_invalid_requests_fail_before_repository_access(monkeypatch, adapter, params, seeds):
    monkeypatch.setattr(validation, "_repository", lambda *args: pytest.fail("repository accessed"))
    with pytest.raises(ValueError):
        validation.run_probe(adapter, params, seeds, {})


def test_explicit_repository_mapping_is_required():
    with pytest.raises(ValueError, match="explicit repository mapping"):
        validation.run_probe("qnp-stable", {}, [1], {})


@pytest.mark.parametrize("origin", [
    "https://github.com/unrelated/quantum-noise-profiler.git",
    "https://github.com/topherchris420/quantum-noise-profiler.evil.git",
    "file:///untrusted/quantum-noise-profiler",
])
def test_repository_identity_rejects_unapproved_origin(tmp_path, monkeypatch, origin):
    def fake_git(root, *args):
        return str(tmp_path) if args == ("rev-parse", "--show-toplevel") else origin

    monkeypatch.setattr(validation, "_git", fake_git)
    with pytest.raises(ValueError, match="origin"):
        validation._repository("qnp", {"quantum-noise-profiler": str(tmp_path)})


def test_source_inventory_rejects_symlink_escape(tmp_path):
    (tmp_path / "pyproject.toml").write_text("name = 'test'\n")
    package = tmp_path / "src" / "qnp"
    package.mkdir(parents=True)
    (package / "__init__.py").write_text("")
    outside = tmp_path / "outside.py"
    outside.write_text("pass\n")
    try:
        (package / "escape.py").symlink_to(outside)
    except OSError:
        pytest.skip("host does not permit test symlinks")
    with pytest.raises(ValueError, match="redirected"):
        validation._source_hashes(tmp_path, "qnp")


def test_import_scope_restores_path_and_bytecode_on_failure(tmp_path):
    before_path, before_bytecode = sys.path[:], sys.dont_write_bytecode
    with pytest.raises(RuntimeError), validation._imports(tmp_path, "rain_unloaded_test_package"):
        assert sys.path[0] == str((tmp_path / "src").resolve())
        assert sys.dont_write_bytecode
        raise RuntimeError("probe failed")
    assert sys.path == before_path
    assert sys.dont_write_bytecode == before_bytecode
    assert "rain_unloaded_test_package" not in sys.modules


def test_import_scope_rejects_preloaded_other_repository(tmp_path, monkeypatch):
    module = types.ModuleType("rain_foreign_test_package")
    module.__file__ = str(tmp_path / "outside.py")
    monkeypatch.setitem(sys.modules, module.__name__, module)
    with pytest.raises(ValueError, match="different upstream"), validation._imports(tmp_path, module.__name__):
        pytest.fail("import scope entered")


def test_git_invocation_is_argv_only_and_disables_fsmonitor(tmp_path, monkeypatch):
    seen = []

    def fake_run(argv, **kwargs):
        seen.append((argv, kwargs))
        return subprocess.CompletedProcess(argv, 0, stdout="revision\n", stderr="")

    monkeypatch.setattr(validation.subprocess, "run", fake_run)
    assert validation._git(tmp_path, "rev-parse", "HEAD") == "revision"
    argv, kwargs = seen[0]
    assert argv[:4] == ["git", "--no-optional-locks", "-c", "core.fsmonitor=false"]
    assert kwargs.get("shell", False) is False
    assert kwargs["timeout"] == 10


def test_wrapper_preserves_samples_and_records_source_changes(tmp_path, monkeypatch):
    monkeypatch.setattr(validation, "_repository", lambda *args: (tmp_path, {"commit": "a" * 40, "dirty": False}))
    snapshots = iter([{"source.py": "a"}, {"source.py": "b"}])
    monkeypatch.setattr(validation, "_source_hashes", lambda *args: next(snapshots))
    monkeypatch.setattr(validation, "_git", lambda *args: "a" * 40)
    monkeypatch.setattr(validation, "_qnp", lambda *args: ([0.0, 1.0], {"negative_control": True}, {"rows": []}))
    output = validation.run_probe("qnp-stable", {}, [10, 11], {})
    assert output["samples"] == [0.0, 1.0]
    assert output["checks"]["source_unchanged"] is False
    assert output["checks"]["revision_unchanged"] is True
    assert str(tmp_path) not in json.dumps(output)
    assert "adapter_sha256" in output["provenance"]


def _upstream(kind):
    variable = "RAIN_QNP_REPOSITORY" if kind == "qnp" else "RAIN_DRR_REPOSITORY"
    root = os.environ.get(variable)
    if not root:
        pytest.skip(f"set {variable} to explicitly approve the local upstream test repository")
    for dependency in ("numpy", "scipy"):
        if importlib.util.find_spec(dependency) is None:
            pytest.skip(f"upstream test requires {dependency}")
    repository = validation._REPOSITORIES[kind][0]
    return {repository: root}


def test_genuine_qnp_is_deterministic_and_rejects_false_claims():
    repositories = _upstream("qnp")
    cfg = {"shots": 500, "batches": 16, "baseline_batches": 4, "alternative_rate": 0.2}
    first = validation.run_probe("qnp-drift", cfg, [81201, 81202], repositories)
    second = validation.run_probe("qnp-drift", cfg, [81201, 81202], repositories)
    assert first == second
    assert first["samples"] == [1.0, 1.0]
    assert all(first["checks"].values())
    assert all(not row["prechange_alarm"] for row in first["details"]["rows"])
    assert all(not Path(key).is_absolute() for key in first["provenance"]["source_sha256"])
    stable = validation.run_probe("qnp-stable", cfg, [81201, 81202], repositories)
    assert stable["details"]["fixed_rule_exact_null_session_false_alarm_probability"] > cfg.get("alpha", 0.05)


def test_genuine_drr_uses_real_data_and_preserves_seed_identity():
    repositories = _upstream("drr")
    cfg = {"n_samples": 128, "n_surrogates": 19, "ar_coefficient": 0.5}
    first = validation.run_probe("drr-null", cfg, [91001, 91002], repositories)
    second = validation.run_probe("drr-null", cfg, [91001, 91002], repositories)
    assert first == second
    assert len(first["samples"]) == 2 and all(sample in (0.0, 1.0) for sample in first["samples"])
    assert all(first["checks"].values())
    assert first["details"]["rows"][0]["data_sha256"] != first["details"]["rows"][1]["data_sha256"]
    assert "src/drr_framework/modules.py" in first["provenance"]["source_sha256"]
