"""Allowlisted local CPU probes against explicitly selected research repositories.

These probes measure decisions on independent, seeded *simulations*. They do
not establish physical validity, hardware performance, or autonomous discovery.
The caller must run each invocation in its own bounded worker process. Import
scoping and numeric parameter validation are not a sandbox for untrusted code:
the operator's repository mapping is an explicit trust decision.
"""

from __future__ import annotations

import hashlib
import importlib
import importlib.metadata
import json
import math
import re
import subprocess
import sys
import types
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

ADAPTERS = ("qnp-stable", "qnp-drift", "drr-null")
_REPOSITORIES = {
    "qnp": ("quantum-noise-profiler", "quantum-noise-profiler", "qnp"),
    "drr": ("dynamic-resonance-rooting", "drr-framework", "drr_framework"),
}
_QNP_DEFAULTS = {
    "method": "sequential", "batches": 48, "baseline_batches": 12,
    "shots": 1000, "threshold": 0.05, "null_rate": 0.05,
    "alternative_rate": 0.08, "alpha": 0.05,
}
_DRR_DEFAULTS = {
    "surrogate_method": "circular_shift", "n_samples": 256,
    "n_surrogates": 49, "ar_coefficient": 0.9, "alpha": 0.05, "max_lag": 4,
}


def _integer(value: Any, name: str, low: int, high: int) -> int:
    if type(value) is not int or not low <= value <= high:
        raise ValueError(f"{name} must be an integer in [{low}, {high}]")
    return value


def _number(value: Any, name: str, low: float, high: float) -> float:
    if type(value) not in (float, int) or not low <= value <= high or not math.isfinite(value):
        raise ValueError(f"{name} must be finite and in [{low}, {high}]")
    return float(value)


def _parameters(adapter: str, parameters: dict, seeds: list[int]) -> dict:
    defaults = _DRR_DEFAULTS if adapter == "drr-null" else _QNP_DEFAULTS
    if type(parameters) is not dict or any(key not in defaults for key in parameters):
        raise ValueError("parameters contain an unsupported field")
    if type(seeds) is not list or not 1 <= len(seeds) <= 256:
        raise ValueError("seeds must contain between 1 and 256 independent seed values")
    for seed in seeds:
        _integer(seed, "seed", 0, 2**32 - 2)
    if len(set(seeds)) != len(seeds):
        raise ValueError("duplicate seeds are not independent replications")
    cfg = {**defaults, **parameters}
    cfg["alpha"] = _number(cfg["alpha"], "alpha", 0.001, 0.2)
    if adapter == "drr-null":
        if cfg["surrogate_method"] not in ("circular_shift", "permutation", "phase_randomization"):
            raise ValueError("unsupported surrogate_method")
        for name, low, high in (("n_samples", 64, 2048), ("n_surrogates", 19, 499), ("max_lag", 1, 8)):
            _integer(cfg[name], name, low, high)
        cfg["ar_coefficient"] = _number(cfg["ar_coefficient"], "ar_coefficient", -0.97, 0.97)
        if cfg["n_samples"] * cfg["n_surrogates"] * len(seeds) > 16_000_000:
            raise ValueError("requested surrogate workload exceeds the local probe bound")
        if cfg["alpha"] < 1 / (cfg["n_surrogates"] + 1):
            raise ValueError("surrogate budget cannot resolve the requested alpha")
    else:
        if cfg["method"] not in ("sequential", "fixed"):
            raise ValueError("method must be sequential or fixed")
        for name, low, high in (("batches", 8, 128), ("shots", 50, 10_000), ("baseline_batches", 1, 127)):
            _integer(cfg[name], name, low, high)
        if cfg["baseline_batches"] >= cfg["batches"]:
            raise ValueError("baseline_batches must be smaller than batches")
        for name in ("threshold", "null_rate", "alternative_rate"):
            cfg[name] = _number(cfg[name], name, 0.001, 0.5)
        if cfg["null_rate"] > cfg["threshold"]:
            raise ValueError("null_rate must be at or below threshold")
        if cfg["alternative_rate"] <= cfg["threshold"]:
            raise ValueError("alternative_rate must exceed threshold")
    return cfg


def _git(root: Path, *args: str) -> str:
    # Never interpolate parameters into a shell, or let a local fsmonitor run.
    try:
        result = subprocess.run(
            ["git", "--no-optional-locks", "-c", "core.fsmonitor=false", "-C", str(root), *args],
            capture_output=True, text=True, timeout=10, check=True,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise ValueError("repository Git identity could not be verified") from exc
    if len(result.stdout) > 1_000_000:
        raise ValueError("repository metadata exceeds the probe bound")
    return result.stdout.strip()


def _repository(kind: str, repositories: dict[str, str]) -> tuple[Path, dict]:
    repository, distribution, package = _REPOSITORIES[kind]
    if type(repositories) is not dict or not isinstance(repositories.get(repository), str):
        raise ValueError(f"an explicit repository mapping is required for {repository}")
    root = Path(repositories[repository]).resolve(strict=True)
    if not root.is_dir() or Path(_git(root, "rev-parse", "--show-toplevel")).resolve() != root:
        raise ValueError("mapping must select the repository root")
    origin = _git(root, "remote", "get-url", "origin")
    allowed = {
        f"https://github.com/topherchris420/{repository}",
        f"git@github.com:topherchris420/{repository}",
        f"ssh://git@github.com/topherchris420/{repository}",
    }
    if origin.removesuffix(".git") not in allowed:
        raise ValueError(f"repository origin does not match the allowlisted {repository}")
    metadata = root / "pyproject.toml"
    if metadata.is_symlink() or not metadata.is_file():
        raise ValueError("repository project metadata is missing or redirected")
    if not re.search(rf'^name\s*=\s*"{re.escape(distribution)}"\s*$', metadata.read_text(), re.MULTILINE):
        raise ValueError("repository distribution identity does not match")
    if not (root / "src" / package / "__init__.py").is_file():
        raise ValueError("repository package layout does not match")
    commit = _git(root, "rev-parse", "HEAD")
    if not re.fullmatch(r"[0-9a-f]{40,64}", commit):
        raise ValueError("repository revision is invalid")
    return root, {
        "repository": f"topherchris420/{repository}", "commit": commit,
        "dirty": bool(_git(root, "status", "--porcelain", "--untracked-files=normal")),
    }


def _source_hashes(root: Path, package: str) -> dict[str, str]:
    package_root = root / "src" / package
    files = [root / "pyproject.toml", *sorted(package_root.rglob("*.py"))]
    if len(files) > 512:
        raise ValueError("upstream source inventory exceeds the probe bound")
    hashes = {}
    for path in files:
        if not path.resolve().is_relative_to(root) or path.is_symlink() or path.stat().st_size > 2_000_000:
            raise ValueError("upstream source is redirected or exceeds the probe bound")
        hashes[path.relative_to(root).as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
    return hashes


@contextmanager
def _imports(root: Path, package: str) -> Iterator[None]:
    source = (root / "src").resolve()
    previous_modules = {
        name: module for name, module in tuple(sys.modules.items())
        if name == package or name.startswith(package + ".")
    }
    for name, module in tuple(sys.modules.items()):
        if name == package or name.startswith(package + "."):
            filename = getattr(module, "__file__", None)
            if not filename or not Path(filename).resolve().is_relative_to(source):
                raise ValueError("a different upstream package is already imported; use a fresh worker")
    old_path, old_bytecode = sys.path[:], sys.dont_write_bytecode
    sys.path.insert(0, str(source))
    sys.dont_write_bytecode = True
    try:
        # Import the fixed numeric modules without running a broad upstream
        # package initializer (DRR's initializer imports optional pandas code).
        # No source is copied, transformed, or evaluated from a request.
        if package not in sys.modules:
            namespace = types.ModuleType(package)
            namespace.__file__ = str(source / package / "__init__.py")
            namespace.__package__ = package
            namespace.__path__ = [str(source / package)]
            sys.modules[package] = namespace
        yield
        for name, module in tuple(sys.modules.items()):
            if name == package or name.startswith(package + "."):
                filename = getattr(module, "__file__", None)
                if not filename or not Path(filename).resolve().is_relative_to(source):
                    raise ValueError("import escaped the selected upstream source")
    finally:
        for name in tuple(sys.modules):
            if (name == package or name.startswith(package + ".")) and name not in previous_modules:
                del sys.modules[name]
        sys.modules.update(previous_modules)
        sys.path[:] = old_path
        sys.dont_write_bytecode = old_bytecode


def _counts_hash(counts: Any) -> str:
    return hashlib.sha256(json.dumps([int(k) for k in counts], separators=(",", ":")).encode()).hexdigest()


def _qnp(adapter: str, cfg: dict, seeds: list[int]) -> tuple[list[float], dict, dict]:
    import numpy as np
    from scipy.stats import binom

    detector_type = importlib.import_module("qnp.sequential").BinomialThresholdDetector
    batches, shots = cfg["batches"], cfg["shots"]
    rates = np.full(batches, cfg["null_rate"])
    if adapter == "qnp-drift":
        rates[cfg["baseline_batches"]:] = cfg["alternative_rate"]
    counts_grid = np.arange(shots + 1)
    fixed_pvalues = binom.sf(counts_grid - 1, shots, cfg["threshold"])
    rejected = counts_grid[fixed_pvalues <= cfg["alpha"]]
    critical = int(rejected[0]) if len(rejected) else shots + 1
    one_look = float(binom.sf(critical - 1, shots, cfg["null_rate"]))
    exact_fixed_session_fpr = float(-np.expm1(batches * np.log1p(-one_look)))
    outcomes, rows = [], []
    for seed in seeds:
        counts = np.random.default_rng(seed).binomial(shots, rates)
        detector = detector_type(cfg["threshold"])
        alarms, fixed_alarms, sequential_logs = [], [], []
        for index, count in enumerate(counts):
            log_e = float(detector.update(int(count), shots))
            sequential_logs.append(log_e)
            sequential_alarm = log_e >= math.log(1 / cfg["alpha"])
            fixed_alarm = bool(fixed_pvalues[int(count)] <= cfg["alpha"])
            fixed_alarms.append(fixed_alarm)
            if sequential_alarm if cfg["method"] == "sequential" else fixed_alarm:
                alarms.append(index)
        pre = any(i < cfg["baseline_batches"] for i in alarms)
        post = any(i >= cfg["baseline_batches"] for i in alarms)
        outcomes.append(float(not alarms if adapter == "qnp-stable" else post and not pre))
        rows.append({
            "seed": seed, "counts_sha256": _counts_hash(counts),
            "first_alarm_batch": alarms[0] if alarms else None,
            "prechange_alarm": pre, "postchange_alarm": post,
            "fixed_any_alarm": any(fixed_alarms), "max_log_e": max(sequential_logs),
        })
    # A zero-error stream must not trigger; an overwhelming alternative must.
    null_control, positive_control = detector_type(cfg["threshold"]), detector_type(cfg["threshold"])
    null_logs = [null_control.update(0, shots) for _ in range(8)]
    positive_logs = [positive_control.update(shots, shots) for _ in range(8)]
    # A one-batch likelihood-ratio mixture has a closed form independent of
    # the upstream accumulation and change-time bookkeeping.
    reference_rates = np.unique(np.clip(cfg["threshold"] * (1 + np.geomspace(0.02, 5.0, 24)), 1e-12, 1 - 1e-12))
    ratios = [
        (rate / cfg["threshold"]) ** 2 * ((1 - rate) / (1 - cfg["threshold"])) ** 8
        for rate in reference_rates
    ]
    reference_log_e = math.log(47 / 48 + math.fsum(ratios) / (48 * len(ratios)))
    actual_log_e = detector_type(cfg["threshold"]).update(2, 10)
    checks = {
        "zero_error_negative_control": max(null_logs) < math.log(1 / cfg["alpha"]),
        "all_error_positive_control": max(positive_logs) >= math.log(1 / cfg["alpha"]),
        "finite_evidence": all(math.isfinite(r["max_log_e"]) for r in rows),
        "independent_one_batch_likelihood_ratio": abs(actual_log_e - reference_log_e) < 1e-12,
    }
    return outcomes, checks, {
        "truth": "independent binomial batches; synthetic threshold exceedance",
        "rows": rows, "fixed_per_batch_critical_count": critical,
        "fixed_rule_exact_null_session_false_alarm_probability": exact_fixed_session_fpr,
        "sequential_null_session_false_alarm_upper_bound": cfg["alpha"],
        "limitations": [
            "The exact sequential bound requires independent binomial shots with rate at or below threshold.",
            "The fixed rule intentionally repeats an unadjusted per-batch test; it is a naive baseline.",
            "Drift success requires detection after change without any prechange alarm.",
            "Threshold detector probes do not evaluate the full profiler, drift model, or hardware.",
        ],
    }


def _drr(cfg: dict, seeds: list[int]) -> tuple[list[float], dict, dict]:
    import numpy as np

    analyzer_type = importlib.import_module("drr_framework.modules").RootingAnalyzer
    simulate = importlib.import_module("drr_framework.calibration").simulate_ar1
    outcomes, rows = [], []
    for seed in seeds:
        data = simulate(cfg["n_samples"], 3, cfg["ar_coefficient"], np.random.default_rng(seed))
        result = analyzer_type().analyze(
            data, max_lag=cfg["max_lag"], n_surrogates=cfg["n_surrogates"],
            random_state=seed + 1, alpha=cfg["alpha"], method="lagged_correlation",
            surrogate_method=cfg["surrogate_method"], correction="max_statistic",
        )
        edges = result["significant_edges"]
        outcomes.append(float(not edges))
        rows.append({
            "seed": seed, "data_sha256": hashlib.sha256(data.astype("<f8").tobytes()).hexdigest(),
            "false_edges": len(edges),
            "minimum_adjusted_p_value": float(np.min(np.asarray(result["adjusted_p_values"])[~np.eye(3, dtype=bool)])),
        })
    # All channels constant: no lead-lag relation is identifiable.
    control = analyzer_type().analyze(
        np.zeros((cfg["n_samples"], 3)), max_lag=cfg["max_lag"],
        n_surrogates=cfg["n_surrogates"], random_state=0,
        alpha=cfg["alpha"], method="lagged_correlation",
        surrogate_method=cfg["surrogate_method"], correction="max_statistic",
    )
    return outcomes, {
        "constant_negative_control": not control["significant_edges"],
        "surrogate_resolution": 1 / (cfg["n_surrogates"] + 1) <= cfg["alpha"],
        "finite_p_values": all(math.isfinite(row["minimum_adjusted_p_value"]) for row in rows),
    }, {
        "truth": "three independent stationary Gaussian AR(1) channels; every edge is false",
        "rows": rows, "minimum_attainable_p_value": 1 / (cfg["n_surrogates"] + 1),
        "limitations": [
            "Permutation destroys serial memory and is deliberately a misspecified null for correlated channels.",
            "Circular shifts assume stationarity; this fixture does not validate random walks or real datasets.",
            "Null rejection alone measures specificity, not discovery power or causality.",
        ],
    }


def run_probe(adapter: str, parameters: dict, seeds: list[int], repositories: dict[str, str]) -> dict:
    """Return one correctness sample per independent seed, checks, and provenance.

    Only fixed CPU simulation entrypoints and numeric/enum parameters are
    supported. Unknown adapters or parameters fail before importing upstream
    code. This function writes no result records and never submits jobs.
    """
    if adapter not in ADAPTERS:
        raise ValueError("unsupported CPU validation adapter")
    cfg = _parameters(adapter, parameters, seeds)
    kind = "drr" if adapter == "drr-null" else "qnp"
    root, provenance = _repository(kind, repositories)
    package = _REPOSITORIES[kind][2]
    sources = _source_hashes(root, package)
    with _imports(root, package):
        samples, checks, details = _drr(cfg, seeds) if kind == "drr" else _qnp(adapter, cfg, seeds)
    checks = {key: bool(value) for key, value in checks.items()}
    checks["source_unchanged"] = sources == _source_hashes(root, package)
    checks["revision_unchanged"] = provenance["commit"] == _git(root, "rev-parse", "HEAD")
    provenance["source_sha256"] = sources
    provenance["module_import_mode"] = "fixed numeric modules; package initializer bypassed"
    provenance["adapter_sha256"] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    provenance["dependencies"] = {"python": sys.version.split()[0]}
    for distribution in ("numpy", "scipy", _REPOSITORIES[kind][1]):
        try:
            provenance["dependencies"][distribution] = importlib.metadata.version(distribution)
        except importlib.metadata.PackageNotFoundError:
            provenance["dependencies"][distribution] = "source tree; distribution metadata unavailable"
    details.update({"adapter": adapter, "parameters": cfg, "seed_unit": "one complete independent simulation"})
    output = {"samples": samples, "checks": checks, "details": details, "provenance": provenance}
    if len(json.dumps(output, allow_nan=False)) > 200_000:
        raise ValueError("probe output exceeds the evidence bound")
    return output
