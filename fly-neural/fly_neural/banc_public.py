"""Explicit, offline-verifiable BANC v888 public-release bridge.

The published BANC v888 products are publicly readable from the Lee Lab GCS
bucket, without a Codex login.  This path is deliberately distinct from the
2026-10-31 *reviewed Codex bytes* in banc.py: it does NOT weaken that
allowlist, silently substitute new bytes, or claim equal neuron counts.

Only the explicit `fetch` subcommand uses the network. The converted files,
their source hashes, and the compiled neural model remain under
$FLY_NEURAL_DATA, outside Git and outside either original fly's VM.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import io
import json
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import polars as pl

from .acquire import data_dir, sha256_file
from .banc import COMPILED_NAME, NEURON_COLUMNS, import_banc

BASE = "https://storage.googleapis.com/lee-lab_brain-and-nerve-cord-fly-connectome"
PRODUCTS = {
    "neurons": "compiled_data/banc_888/banc_888_meta.feather",
    "connections": (
        "neuron_connectivity/v888/"
        "synapses_v1_human_readable_sizethresh3_"
        "connectioncountsperneuropil_countthresh3.parquet"
    ),
}
FILES = {"neurons": "banc_888_meta.feather", "connections": "banc_v888_connections.parquet"}
PUBLIC_COMPILED = "banc-v888-public-predicted-nt"
MAX_PRODUCT_BYTES = 256 * 1024 * 1024
SCHEMA = "banc-public-cache/v1"
# GCS's evolving public bucket is not a frozen publication snapshot.
# A digest pinned on first local preparation protects subsequent offline runs.
# It is not an independently published checksum.
NT = {
    "acetylcholine": "ACH", "ach": "ACH", "gaba": "GABA",
    "glutamate": "GLUT", "glut": "GLUT", "dopamine": "DA", "da": "DA",
    "serotonin": "SER", "ser": "SER", "octopamine": "OCT", "oct": "OCT",
    "histamine": "HIST", "hist": "HIST", "tyramine": "TYR", "tyr": "TYR",
}


class PublicBancError(ValueError):
    pass


def root_dir(root: Path | None = None) -> Path:
    return (root if root is not None else data_dir()) / "public-banc" / "v888"


def raw_paths(root: Path | None = None) -> dict[str, Path]:
    d = root_dir(root)
    return {role: d / name for role, name in FILES.items()}


def _digest(path: Path) -> dict:
    return {"sha256": sha256_file(path), "bytes": path.stat().st_size}


def _download(role: str, path: Path) -> None:
    """Stream a fixed, public HTTPS product; never use credentials or arbitrary URLs."""
    if path.exists():
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    part = path.with_suffix(path.suffix + ".part")
    # A partial from an earlier failed transfer cannot become a valid product.
    part.unlink(missing_ok=True)
    req = urllib.request.Request(
        f"{BASE}/{PRODUCTS[role]}",
        headers={"User-Agent": "R.A.I.N.-Genesis-BANC-public/1"},
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as response, part.open("wb") as out:
            if response.url.split("/")[2] != "storage.googleapis.com":
                raise PublicBancError("unexpected host while fetching the BANC product")
            total = 0
            for chunk in iter(lambda: response.read(1 << 20), b""):
                total += len(chunk)
                if total > MAX_PRODUCT_BYTES:
                    raise PublicBancError(f"{role} exceeds the bounded 256 MiB download limit")
                out.write(chunk)
        if total == 0:
            raise PublicBancError(f"{role} is empty")
        part.replace(path)
    except Exception:
        part.unlink(missing_ok=True)
        raise


def fetch_public(root: Path | None = None, *, accept_terms: bool = False) -> dict[str, Path]:
    """Only this explicit action contacts the public bucket."""
    if not accept_terms:
        raise PublicBancError(
            "Review the BANC CC BY 4.0 attribution requirements and pass --accept-cc-by-4.0"
        )
    files = raw_paths(root)
    for role, path in files.items():
        _download(role, path)
    return files


def _nt(value: object) -> str:
    if value is None:
        return ""
    v = str(value).strip()
    if v.lower() in ("", "none", "nan", "unknown", "uncalled"):
        return ""
    try:
        return NT[v.lower()]
    except KeyError as e:
        raise PublicBancError(f"unknown BANC public transmitter {v!r}; review the source") from e


def _required(frame: pl.DataFrame, names: tuple[str, ...], label: str) -> None:
    missing = [s for s in names if s not in frame.columns]
    if missing:
        raise PublicBancError(f"{label} missing required fields: {missing}")


def _value(frame: pl.DataFrame, column: str, *, number: bool = False) -> pl.Expr:
    if column not in frame.columns:
        return pl.lit("").alias(column)
    expr = pl.col(column)
    if number:
        return expr.cast(pl.Int64, strict=True)
    return expr.cast(pl.String, strict=False).fill_null("")


def _gzip_rows(frame: pl.DataFrame, path: Path) -> None:
    """Write deterministically with low memory usage; never publish in Git."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".part")
    try:
        with temp.open("wb") as binary:
            with gzip.GzipFile(filename="", fileobj=binary, mode="wb", compresslevel=6, mtime=0) as compressed:
                with io.TextIOWrapper(compressed, encoding="utf-8", newline="") as out:
                    writer = csv.writer(out, lineterminator="\\n")
                    writer.writerow(frame.columns)
                    writer.writerows(frame.iter_rows())
        temp.replace(path)
    except Exception:
        temp.unlink(missing_ok=True)
        raise


def convert_products(paths: dict[str, Path], out: Path) -> dict[str, Path]:
    """Project the public GCS schema onto the existing *unreviewed* import API.

    Preserve v888 root IDs as integers; preserve per-neuropil counts and explicit
    unknown transmitter calls. The metadata includes all listed fragments, so
    counts are NOT assumed identical to the reviewed Codex export.
    """
    if set(paths) != {"neurons", "connections"}:
        raise PublicBancError("both v888 metadata and connections are required")
    meta = pl.read_ipc(paths["neurons"])
    _required(meta, ("root_888", "cell_type", "neurotransmitter_predicted"), "metadata")
    if meta.is_empty():
        raise PublicBancError("BANC public metadata is empty")
    columns = [
        ("Root ID", "root_888"),
        ("Super Class", "super_class"),
        ("Class", "cell_class"),
        ("Sub Class", "cell_sub_class"),
        ("Primary Cell Type", "cell_type"),
        ("Alternative Cell Type(s)", "cell_type"),
        ("Soma side", "side"),
        ("Body Part", "body_part_sensory"),
        ("Function", "cell_function"),
        ("Flow", "flow"),
        ("Nerve", "nerve"),
        ("Predicted NT type", "neurotransmitter_predicted"),
        ("Predicted NT confidence", "neurotransmitter_score"),
    ]
    selection = [
        (_value(meta, src, number=(dst == "Root ID"))).alias(dst)
        for dst, src in columns
    ]
    neurons = meta.select(selection).sort("Root ID")
    if neurons["Root ID"].null_count() or (neurons["Root ID"] <= 0).any():
        raise PublicBancError("BANC metadata contains missing or nonpositive root IDs")
    if neurons["Root ID"].n_unique() != neurons.height:
        raise PublicBancError("duplicate BANC v888 root IDs")
    neurons = neurons.with_columns(
        pl.col("Predicted NT type").map_elements(_nt, return_dtype=pl.String),
    )
    # Match the exact existing Codex-style exporter headings, without
    # pretending the public product is the previously reviewed Codex export.
    assert neurons.columns == list(NEURON_COLUMNS)

    edges = pl.read_parquet(paths["connections"])
    _required(edges, ("pre_root_id", "post_root_id", "neuropil"), "connections")
    count_col = "syn_count" if "syn_count" in edges.columns else "num_synapses"
    _required(edges, (count_col,), "connections")
    edges = edges.select(
        pl.col("pre_root_id").cast(pl.Int64, strict=True),
        pl.col("post_root_id").cast(pl.Int64, strict=True),
        pl.col("neuropil").cast(pl.String, strict=True),
        pl.col(count_col).cast(pl.Int64, strict=True).alias("syn_count"),
    ).sort(["pre_root_id", "post_root_id", "neuropil"])
    if edges.is_empty():
        raise PublicBancError("BANC connection product is empty")
    if any(edges[c].null_count() for c in edges.columns):
        raise PublicBancError("null values in public BANC connections")
    if (edges["syn_count"] < 1).any() or (edges["pre_root_id"] <= 0).any() or (edges["post_root_id"] <= 0).any():
        raise PublicBancError("invalid BANC public connection counts or IDs")

    target = {"neurons": out / "neurons.csv.gz", "connections": out / "connections_princeton.csv.gz"}
    _gzip_rows(neurons, target["neurons"])
    _gzip_rows(edges, target["connections"])
    return target


def prepare(root: Path | None = None) -> dict:
    """Offline-only conversion and provenance pin; refuse changed source bytes."""
    raw = raw_paths(root)
    missing = [role for role, path in raw.items() if not path.is_file()]
    if missing:
        raise PublicBancError(f"missing local BANC product(s) {missing}; run 'fetch --accept-cc-by-4.0'")
    d = root_dir(root)
    manifest_file = d / "source-manifest.json"
    sources = {
        role: {"url": f"{BASE}/{PRODUCTS[role]}", **_digest(path)}
        for role, path in raw.items()
    }
    if manifest_file.is_file():
        old = json.loads(manifest_file.read_text(encoding="utf-8"))
        if old.get("schema") != SCHEMA or old.get("source_products") != sources:
            raise PublicBancError("the locally pinned public BANC source changed; inspect and explicitly remove source-manifest.json before re-pinning")
    tables = convert_products(raw, d / "codex-compatible")
    derived = {role: _digest(path) for role, path in tables.items()}
    if manifest_file.exists():
        old = json.loads(manifest_file.read_text(encoding="utf-8"))
        if old.get("derived_tables") != derived:
            raise PublicBancError("converted BANC tables differ from the local pin")
        return old
    record = {
        "schema": SCHEMA,
        "dataset": "banc-v888",
        "source": "public GCS release, mutable (not the reviewed 2026-10-31 Codex pin)",
        "license": "CC BY 4.0; credit Bates et al. 2026 and Harvard Dataverse DOI:10.7910/DVN/7WTH1N",
        "snapshot_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source_products": sources,
        "derived_tables": derived,
        "independent_official_hash": None,
        "reviewed_codex_bytes": False,
        "data_policy": "research only; keep all downloaded and derived tables outside Git",
    }
    manifest_file.write_text(json.dumps(record, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return record


def import_public(root: Path | None = None) -> dict:
    """Compile a research-only BANC model using the existing spiking integrator.

    The existing Codex-reviewed BANC entrypoint remains unchanged and rejects
    nonreviewed bytes. This separate compiled model honestly labels inputs
    unverified until independently checked against publication reference data.
    """
    record = prepare(root)
    d = root_dir(root)
    files = {"neurons": d / "codex-compatible" / "neurons.csv.gz", "connections": d / "codex-compatible" / "connections_princeton.csv.gz"}
    c = import_banc(
        (root if root is not None else data_dir()) / "compiled" / PUBLIC_COMPILED,
        files=files,
        log=lambda line: print(line),
    )
    output = {
        "dataset": PUBLIC_COMPILED,
        "compiled_path": str((root if root is not None else data_dir()) / "compiled" / PUBLIC_COMPILED),
        "counts": c.manifest["counts"],
        "source_manifest": str(d / "source-manifest.json"),
        "source_hashes": {key: item["sha256"] for key, item in record["source_products"].items()},
        "reviewed_codex_bytes": False,
        "originals_touched": False,
    }
    return output


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Public BANC v888 release → isolated neural research backend")
    parser.add_argument("action", choices=("fetch", "prepare", "import"))
    parser.add_argument("--accept-cc-by-4.0", action="store_true", dest="accepted")
    args = parser.parse_args(argv)
    if args.action == "fetch":
        files = fetch_public(accept_terms=args.accepted)
        print(json.dumps({k: str(v) for k, v in files.items()}, indent=2))
    elif args.action == "prepare":
        print(json.dumps(prepare(), indent=2))
    else:
        print(json.dumps(import_public(), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
