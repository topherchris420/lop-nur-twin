"""FlyWire Codex as a reference layer: two datasets kept apart, every file pinned, nothing simulated.

Codex (https://codex.flywire.ai/) is a research explorer. This module reads the
static tables a person downloads from it (or, for FAFB v783, the tables this
package already pins in ``sources.py``), and answers structural questions:
which neuron classes and types exist, which transmitter each neuron is predicted
to release, which regions carry the synapses, which short paths run from sensory
to motor or descending neurons, and how often a few connectivity motifs occur.
It runs no dynamics. Nothing here is a model of what a fly does, and Codex data
must be evaluated before they are used in any simulation.

Datasets are never combined. FAFB v783 (a female adult brain) and BANC v888 (a
female adult brain and ventral nerve cord, from a different animal) are separate
reconstructions of different individuals with different identifiers. Every
table, summary and report carries its dataset's key; ``compare`` sets two
summaries side by side, and nothing in this module merges two datasets' neurons
or edges into one graph (``Tables`` refuses it).

Files stay outside Git, in ``$FLY_NEURAL_DATA/codex/<dataset>/``. Codex asks a
person to sign in and accept its terms before data can be downloaded, so this
module downloads nothing (it imports no network module; ``test_isolation.py``
checks). A person downloads the files, then ``pin`` records each file's size and
SHA-256, the terms they accepted and the citation they were asked to give, in
``pins.json`` beside the files. Every later load verifies the bytes against that
record and refuses on any difference. A pin is the operator's record: a reviewed
change may later copy its values into this module, as ``sources.py`` does for
the v783 tables.

What Codex states about each dataset is recorded below with the date it was
read, and ``check_counts`` compares a loaded table against it, reporting any
difference rather than adjusting either.
"""

from __future__ import annotations

import csv
import gzip
import hashlib
import json
from collections import Counter, deque
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

CODEX = "https://codex.flywire.ai"
SCHEMA = "fly-neural-codex-report/v1"


@dataclass(frozen=True)
class Stated:
    """A number Codex states about a dataset, as read on a date, never adjusted."""

    value: int
    what: str
    source: str


@dataclass(frozen=True)
class Dataset:
    key: str
    name: str
    tissue: str
    version: str
    codex: str
    stated: tuple[Stated, ...]
    #: Pinned files in sources.py this module may read for the dataset (FAFB only).
    pinned_sources: tuple[str, ...]
    #: Terms key in sources.TERMS, or None when the repository has not recorded the dataset's terms.
    terms: str | None
    note: str
    cite: tuple[str, ...] = field(default=())


READ_2026_10_31 = "codex.flywire.ai home page, dataset tiles, read 2026-10-31 (UTC)"

DATASETS: dict[str, Dataset] = {
    "fafb-v783": Dataset(
        key="fafb-v783",
        name="FAFB (FlyWire)",
        tissue="female adult fly brain (central brain and optic lobes)",
        version="783",
        codex=f"{CODEX}/?dataset=fafb",
        stated=(
            Stated(139_255, "neurons", READ_2026_10_31),
            Stated(3_732_460, "connections (Codex's own count; its definition is not stated on that page)", READ_2026_10_31),
            Stated(139_255, "neurons in this package's import of the pinned v783 tables", "docs/ECHO_CONNECTOME.md"),
            Stated(54_492_922, "synapses in this package's import (15,091,983 connected pairs)", "docs/ECHO_CONNECTOME.md"),
        ),
        pinned_sources=("root_ids", "connections", "annotations"),
        terms="flywire-cc-by-nc-4.0",
        note=(
            "The validated v783 baseline: the pinned Zenodo tables and annotation release in sources.py. "
            "Codex's own downloads for 783 are read only after a person pins them."
        ),
    ),
    "banc-v888": Dataset(
        key="banc-v888",
        name="BANC (Brain And Nerve Cord)",
        tissue="female adult fly brain and ventral nerve cord (a different animal from FAFB)",
        version="888",
        codex=f"{CODEX}/?dataset=banc",
        stated=(
            Stated(158_262, "neurons", READ_2026_10_31),
            Stated(3_037_361, "connections (Codex's own count; its definition is not stated on that page)", READ_2026_10_31),
        ),
        pinned_sources=(),
        terms=None,
        note=(
            "Pinned by the operator on 2026-10-31 (neurons.csv.gz and connections_princeton.csv.gz, CC BY 4.0); "
            "that pin's sizes, hashes, terms and citation were reviewed into fly_neural/banc.py (REVIEWED), and the "
            "simulation reads only those bytes. This reference layer reads whatever is pinned: a person downloads "
            "the tables from Codex, accepts its terms there, and pins them with "
            "`python -m fly_neural codex pin banc-v888 ...`, quoting the terms and the citation Codex gives."
        ),
        cite=(
            "Bates et al. 2026, Distributed control circuits across a brain-and-cord connectome, Nature, doi:10.1038/s41586-026-10735-w",
            "BANC v888, Harvard Dataverse, doi:10.7910/DVN/7WTH1N",
        ),
    ),
}

ROLES = ("neurons", "connections")

#: Column names a Codex or FlyWire table may use, mapped to this module's.
ALIASES = {
    "root_id": ("root_id", "root_id_783", "root_id_888", "pt_root_id", "id"),
    "super_class": ("super_class", "superclass"),
    "cell_class": ("cell_class", "class"),
    "cell_type": ("cell_type", "primary_type", "primary_cell_type", "type"),
    "side": ("side", "hemisphere", "soma_side"),
    "nt": ("nt_type", "top_nt", "nt", "predicted_nt", "predicted_nt_type"),
    "pre": ("pre_root_id", "pre_pt_root_id", "pre", "pre_id"),
    "post": ("post_root_id", "post_pt_root_id", "post", "post_id"),
    "neuropil": ("neuropil", "region", "neuropil_name"),
    "syn": ("syn_count", "syn", "weight", "synapses", "count"),
}
NEURON_COLUMNS = ("root_id", "super_class", "cell_class", "cell_type", "side", "nt")
EDGE_COLUMNS = ("pre", "post", "neuropil", "syn")


class CodexError(Exception):
    pass


# ----------------------------------------------------------------------------- tables


@dataclass
class Tables:
    """One dataset's neurons and edges, as loaded. Never holds two datasets."""

    dataset: str
    neurons: dict[str, np.ndarray]
    edges: dict[str, np.ndarray]
    provenance: dict

    def __post_init__(self):
        if self.dataset not in DATASETS:
            raise CodexError(f"unknown dataset {self.dataset!r}")
        n = {len(v) for v in self.neurons.values()}
        e = {len(v) for v in self.edges.values()}
        if len(n) > 1 or len(e) > 1:
            raise CodexError("columns of one table differ in length")

    def __add__(self, other):  # noqa: D105 - an explicit refusal
        raise CodexError("datasets are never combined: compare their summaries instead")


def _column(header: list[str], want: str) -> int | None:
    # Codex's BANC v888 export uses display headings such as "Root ID",
    # "Primary Cell Type", "Predicted NT type", and "Super Class". Normalize
    # whitespace, but retain the existing snake_case aliases for v783.
    lower = ["_".join(h.strip().lower().split()) for h in header]
    for alias in ALIASES[want]:
        if alias in lower:
            return lower.index(alias)
    return None


def read_table(path: Path, wanted: tuple[str, ...], required: tuple[str, ...]) -> dict[str, np.ndarray]:
    """Stream a Codex CSV/TSV (including .gz), respecting quoted commas and header aliases."""
    opener = gzip.open if path.suffix == ".gz" else Path.open
    with opener(path, "rt", encoding="utf-8-sig", newline="") as stream:
        first = stream.readline()
        sep = "\t" if first.count("\t") > first.count(",") else ","
        stream.seek(0)
        rows = csv.reader(stream, delimiter=sep)
        header = next(rows, [])
        idx = {w: _column(header, w) for w in wanted}
        missing = [w for w in required if idx[w] is None]
        if missing:
            raise CodexError(f"{path.name}: no column for {missing}; it has {header}")
        cols: dict[str, list] = {w: [] for w in wanted if idx[w] is not None}
        for cells in rows:
            if not cells or (len(cells) == 1 and not cells[0].strip()):
                continue
            for w, j in idx.items():
                if j is not None:
                    cols[w].append(cells[j].strip() if j < len(cells) else "")
    out: dict[str, np.ndarray] = {}
    for w, values in cols.items():
        if w in ("root_id", "pre", "post"):
            out[w] = np.array([int(v) for v in values], dtype=np.int64)
        elif w == "syn":
            out[w] = np.array([int(float(v)) for v in values], dtype=np.int64)
        else:
            out[w] = np.array(values, dtype=object)
    return out


def tables_from_columns(dataset: str, neurons: dict, edges: dict, provenance: dict | None = None) -> Tables:
    """Builds ``Tables`` from in-memory columns (tests, and loaders below)."""
    n = {k: np.asarray(v, dtype=np.int64 if k == "root_id" else object) for k, v in neurons.items()}
    e = {k: np.asarray(v, dtype=np.int64 if k in ("pre", "post", "syn") else object) for k, v in edges.items()}
    return Tables(dataset, n, e, provenance or {"dataset": dataset, "files": []})


# ------------------------------------------------------------------------------ pins


def dataset_dir(dataset: str, root: Path | None = None) -> Path:
    from .acquire import data_dir

    return (root or data_dir()) / "codex" / dataset


def _sha256(path: Path) -> tuple[str, int]:
    h = hashlib.sha256()
    size = 0
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
            size += len(chunk)
    return h.hexdigest(), size


def pin(dataset: str, files: dict[str, Path], terms: str, cite: str, retrieved: str, root: Path | None = None) -> dict:
    """Records the files a person downloaded from Codex: size, SHA-256, the terms they accepted, the citation."""
    if dataset not in DATASETS:
        raise CodexError(f"unknown dataset {dataset!r}")
    if not terms.strip() or not cite.strip():
        raise CodexError("a pin quotes the terms accepted and the citation Codex asks for")
    if not retrieved.strip():
        raise CodexError("a pin says when the files were downloaded, as the person recorded it")
    unknown = set(files) - set(ROLES)
    if unknown:
        raise CodexError(f"roles are {ROLES}, not {sorted(unknown)}")
    d = dataset_dir(dataset, root)
    d.mkdir(parents=True, exist_ok=True)
    entries = []
    for role, path in sorted(files.items()):
        path = Path(path)
        if path.resolve().parent != d.resolve():
            raise CodexError(f"{path} must be in {d}, outside the repository")
        sha, size = _sha256(path)
        entries.append({"role": role, "file": path.name, "size": size, "sha256": sha})
    record = {"dataset": dataset, "terms": terms, "cite": cite, "retrieved": retrieved, "files": entries}
    (d / "pins.json").write_text(json.dumps(record, indent=1) + "\n", encoding="utf-8")
    return record


def verified_files(dataset: str, root: Path | None = None) -> tuple[dict[str, Path], dict]:
    """The pinned files of a dataset, each re-hashed; refuses a missing pin or any changed byte."""
    d = dataset_dir(dataset, root)
    p = d / "pins.json"
    if not p.exists():
        raise CodexError(f"{dataset} has no pin in {d}: download its tables from Codex and run `codex pin`")
    record = json.loads(p.read_text(encoding="utf-8"))
    if record.get("dataset") != dataset:
        raise CodexError(f"{p} pins {record.get('dataset')!r}, not {dataset}")
    out = {}
    for e in record["files"]:
        f = d / e["file"]
        if not f.exists():
            raise CodexError(f"pinned file {f} is missing")
        sha, size = _sha256(f)
        if sha != e["sha256"] or size != e["size"]:
            raise CodexError(f"{f.name} differs from its pin (sha256 {sha[:12]}…, {size} bytes)")
        out[e["role"]] = f
    return out, record


def load_v783_annotations(root: Path | None = None) -> Tables:
    """FAFB v783's neurons from the annotation release this package already pins (no Codex sign-in needed)."""
    from .acquire import verify

    path = verify("annotations", root)
    neurons = read_table(path, NEURON_COLUMNS, ("root_id",))
    from .sources import BY_KEY

    s = BY_KEY["annotations"]
    prov = {"dataset": "fafb-v783", "files": [{"role": "neurons", "file": f"{s.group}/{s.filename}", "sha256": s.sha256}], "terms": s.terms}
    return Tables("fafb-v783", neurons, {}, prov)


def load(dataset: str, root: Path | None = None) -> Tables:
    """Loads one dataset's pinned Codex tables (neurons, and connections if pinned)."""
    files, record = verified_files(dataset, root)
    if "neurons" not in files:
        raise CodexError(f"{dataset}: no neurons table is pinned")
    neurons = read_table(files["neurons"], NEURON_COLUMNS, ("root_id",))
    edges = read_table(files["connections"], EDGE_COLUMNS, ("pre", "post")) if "connections" in files else {}
    prov = {"dataset": dataset, "pins": record, "codex": DATASETS[dataset].codex}
    return Tables(dataset, neurons, edges, prov)


# -------------------------------------------------------------------------- questions


def counts(t: Tables, column: str, top: int | None = None) -> list[tuple[str, int]]:
    """How many neurons carry each value of an annotation column, most first."""
    if column not in t.neurons:
        return []
    c = Counter("" if v is None else str(v) for v in t.neurons[column])
    return sorted(c.items(), key=lambda kv: (-kv[1], kv[0]))[:top]


def regions(t: Tables, top: int | None = None) -> list[tuple[str, int]]:
    """Synapses per region (neuropil), most first."""
    if "neuropil" not in t.edges or "syn" not in t.edges:
        return []
    tot: Counter = Counter()
    for r, s in zip(t.edges["neuropil"], t.edges["syn"]):
        tot[str(r)] += int(s)
    return sorted(tot.items(), key=lambda kv: (-kv[1], kv[0]))[:top]


def _adjacency(t: Tables, min_syn: int) -> dict[int, dict[int, int]]:
    adj: dict[int, dict[int, int]] = {}
    syn = t.edges.get("syn")
    for i, (a, b) in enumerate(zip(t.edges.get("pre", ()), t.edges.get("post", ()))):
        w = int(syn[i]) if syn is not None else 1
        if a == b:
            continue
        row = adj.setdefault(int(a), {})
        row[int(b)] = row.get(int(b), 0) + w
    return {a: {b: w for b, w in row.items() if w >= min_syn} for a, row in adj.items()}


def select(t: Tables, rule: dict) -> np.ndarray:
    """Root ids whose annotations match every column of ``rule`` (each a list of accepted values)."""
    keep = np.ones(len(t.neurons.get("root_id", ())), dtype=bool)
    for col, want in rule.items():
        if col not in t.neurons:
            raise CodexError(f"{t.dataset}: no {col} annotation")
        keep &= np.isin(t.neurons[col].astype(str), [str(w) for w in want])
    return np.sort(t.neurons["root_id"][keep])


def pathways(t: Tables, sources: dict, targets: dict, max_hops: int = 3, min_syn: int = 5, by: str = "super_class") -> dict:
    """Shortest paths (in hops, edges of at least ``min_syn`` synapses) from one selection to another.

    Returns how many source neurons reach any target within ``max_hops``, the
    distribution of shortest hop counts, and the most common sequences of the
    ``by`` annotation along one shortest path per reached source (ties broken by
    the lowest root id, so the answer is reproducible).
    """
    adj = _adjacency(t, min_syn)
    src = [int(x) for x in select(t, sources)]
    tgt = set(int(x) for x in select(t, targets))
    label = dict(zip((int(x) for x in t.neurons["root_id"]), (str(v) for v in t.neurons.get(by, np.array(["?"] * len(t.neurons["root_id"]), dtype=object)))))
    hops: Counter = Counter()
    routes: Counter = Counter()
    reached = 0
    for s in src:
        prev = {s: None}
        q = deque([(s, 0)])
        hit = None
        while q:
            node, d = q.popleft()
            if node in tgt and node != s:
                hit = (node, d)
                break
            if d == max_hops:
                continue
            for nb in sorted(adj.get(node, {})):
                if nb not in prev:
                    prev[nb] = node
                    q.append((nb, d + 1))
        if hit is None:
            continue
        reached += 1
        hops[hit[1]] += 1
        path, node = [], hit[0]
        while node is not None:
            path.append(label.get(node, "?"))
            node = prev[node]
        routes[" → ".join(reversed(path))] += 1
    return {
        "dataset": t.dataset,
        "sources": len(src),
        "targets": len(tgt),
        "reached": reached,
        "max_hops": max_hops,
        "min_syn": min_syn,
        "hops": dict(sorted(hops.items())),
        "routes": routes.most_common(10),
    }


def motifs(t: Tables, min_syn: int = 5, sample: int = 2000, seed: int = 0) -> dict:
    """Reciprocity, and feed-forward and cyclic triangles among a seeded sample of neurons.

    Counts are over the edges of at least ``min_syn`` synapses among ``sample``
    neurons drawn with ``numpy``'s generator from ``seed`` (all neurons when
    fewer), so two datasets are compared on the same procedure, not the same neurons.
    """
    adj = _adjacency(t, min_syn)
    ids = np.array(sorted({int(x) for x in t.neurons["root_id"]}), dtype=np.int64)
    rng = np.random.default_rng(seed)
    chosen = ids if ids.size <= sample else np.sort(rng.choice(ids, size=sample, replace=False))
    keep = set(int(x) for x in chosen)
    sub = {a: {b for b in row if b in keep} for a, row in adj.items() if a in keep}
    edges = sum(len(r) for r in sub.values())
    recip = sum(1 for a, row in sub.items() for b in row if a < b and a in sub.get(b, ()))
    ffl = cyc = 0
    for a, row in sub.items():
        for b in row:
            for c in sub.get(b, ()):
                if c == a:
                    continue
                if c in row:
                    ffl += 1  # a→b, b→c, a→c
                if a in sub.get(c, ()) and a < b and a < c:
                    cyc += 1  # a→b→c→a, counted once
    return {
        "dataset": t.dataset,
        "neurons_sampled": int(chosen.size),
        "edges": edges,
        "reciprocal_pairs": recip,
        "reciprocity": (2 * recip / edges) if edges else None,
        "feedforward_triangles": ffl,
        "cyclic_triangles": cyc,
        "min_syn": min_syn,
        "seed": seed,
    }


def compare(a: dict, b: dict) -> list[dict]:
    """Two summaries side by side, metric by metric. Each keeps its own dataset; nothing is pooled."""
    if a.get("dataset") == b.get("dataset"):
        raise CodexError("compare two different datasets")
    keys = [k for k in a if k in b and k != "dataset" and isinstance(a[k], (int, float)) and isinstance(b[k], (int, float))]
    return [{"metric": k, a["dataset"]: a[k], b["dataset"]: b[k]} for k in keys]


def check_counts(t: Tables) -> list[dict]:
    """The loaded neuron count against every neuron count recorded for the dataset."""
    n = int(len(set(int(x) for x in t.neurons.get("root_id", ()))))
    out = []
    for s in DATASETS[t.dataset].stated:
        if s.what.startswith("neurons"):
            out.append({"stated": s.value, "what": s.what, "source": s.source, "loaded": n, "agrees": n == s.value})
    return out


_UNRESERVED = set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")


def _quote(text: str) -> str:
    """Percent-encodes a query value (RFC 3986 unreserved characters kept)."""
    return "".join(c if c in _UNRESERVED else "".join(f"%{b:02X}" for b in c.encode("utf-8")) for c in text)


def codex_links(dataset: str, root_ids=(), cell_types=()) -> list[str]:
    """Links to Codex for a dataset: its home, a cell page per root id, a search per cell type.

    Checked against Codex on 2026-10-31: the dataset home (``/?dataset=…``)
    and the ``/app/cell_details`` and ``/app/search`` routes exist (both answer
    with Codex's sign-in page, while an unknown route answers 404). What those
    pages show behind sign-in was not checked here.
    """
    d = DATASETS[dataset]
    short = dataset.split("-")[0]
    links = [d.codex]
    links += [f"{CODEX}/app/cell_details?dataset={short}&root_id={int(r)}" for r in root_ids]
    links += [f"{CODEX}/app/search?dataset={short}&filter_string={_quote(str(c))}" for c in cell_types]
    return links


def report(t: Tables, sensory: dict, motor: dict, max_hops: int = 3, min_syn: int = 5) -> dict:
    """A reproducible structural report for one dataset, with its provenance and terms."""
    d = DATASETS[t.dataset]
    return {
        "schema": SCHEMA,
        "dataset": {"key": d.key, "name": d.name, "tissue": d.tissue, "version": d.version, "codex": d.codex},
        "provenance": t.provenance,
        "terms": d.terms or (t.provenance.get("pins", {}) or {}).get("terms"),
        "counts": check_counts(t),
        "super_classes": counts(t, "super_class", 20),
        "cell_classes": counts(t, "cell_class", 30),
        "transmitters": counts(t, "nt"),
        "regions": regions(t, 30),
        "connections_loaded": bool(t.edges),
        # Without a connections table there is nothing to trace: not zero, not computed.
        "pathways": pathways(t, sensory, motor, max_hops, min_syn) if t.edges else None,
        "motifs": motifs(t, min_syn) if t.edges else None,
        "note": "Structure only: no dynamics were simulated, and nothing here is a claim about behaviour.",
    }
