"""Every external file this package reads, pinned by URL, size and hash.

Nothing here is redistributed. Each entry says where the file comes from, the
terms it is offered under (as the publisher states them, quoted), what to cite,
and the bytes it must have. ``acquire`` fetches a file only if the person
running it names the terms they accept, and refuses a file whose hash differs.

Licensing, as checked on 2026-10-30:

- The Zenodo deposit of the v783 connection tables (doi:10.5281/zenodo.10676866)
  states "cc-by-4.0" in its metadata.
- FlyWire's own guidelines (https://flywire.ai/guidelines) state "FlyWire's
  public release data is made available under license CC BY-NC 4.0" and cover
  "all data available in Codex for snapshot 783".

The two disagree. This repository treats the stricter, CC BY-NC 4.0, as binding
for every FlyWire-derived file: use is non-commercial research, nothing derived
from the tables is committed, and every result cites the sources below.

- The FlyWire annotations repository (flyconnectome/flywire_annotations) has no
  licence file; it asks users to cite its papers. With no grant of rights it is
  read locally and never redistributed.
- Shiu et al.'s model code is MIT (Copyright (c) 2023 Philip Shiu and Nico
  Spiller). Its data files are derived from FlyWire, and MIT on the code grants
  nothing over FlyWire's data; they are read only to cross-check this import
  and are never redistributed.
"""

from __future__ import annotations

from dataclasses import dataclass

TERMS = {
    "flywire-cc-by-nc-4.0": (
        "FlyWire public release data (CC BY-NC 4.0 per flywire.ai/guidelines; the Zenodo "
        "deposit states CC BY 4.0). Non-commercial research use; cite Dorkenwald et al. 2024, "
        "Schlegel et al. 2024, Buhmann et al. 2021, Heinrich et al. 2018, Eckstein et al. 2024."
    ),
    "flywire-annotations-cite": (
        "flyconnectome/flywire_annotations: no licence file; cite Berg et al. 2026, Schlegel "
        "et al. 2024, Tastekin et al. 2026, Matsliah et al. 2024, Dorkenwald et al. 2024. "
        "Read locally, never redistributed."
    ),
    "shiu-mit-code-flywire-data": (
        "philshiu/Drosophila_brain_model: code MIT (c) 2023 Philip Shiu and Nico Spiller; its "
        "data files derive from FlyWire and fall under FlyWire's terms. Read locally for "
        "cross-checks, never redistributed."
    ),
}


@dataclass(frozen=True)
class Source:
    key: str
    group: str
    filename: str
    url: str
    size: int
    sha256: str
    md5: str | None
    terms: str
    cite: tuple[str, ...]
    required: bool
    note: str


ZENODO = "https://zenodo.org/records/10676866/files/{}?download=1"
ANNOTATIONS_COMMIT = "a83b2776d60d5764cef36b927f5f9679c16c47a2"  # tag v3.2.0
SHIU_COMMIT = "91bdd1e7dcf193f3e7ca5a8933497fcef63b7960"

CITE_FLYWIRE = (
    "Dorkenwald et al. 2024, Neuronal wiring diagram of an adult brain, Nature 634:124-138, doi:10.1038/s41586-024-07558-y",
    "Schlegel et al. 2024, Whole-brain annotation and multi-connectome cell typing of Drosophila, Nature 634:139-152, doi:10.1038/s41586-024-07686-5",
    "Buhmann et al. 2021, Automatic detection of synaptic partners in a whole-brain Drosophila electron microscopy data set, Nat Methods 18:771-774, doi:10.1038/s41592-021-01183-7",
    "Heinrich et al. 2018, Synaptic cleft segmentation in non-isotropic volume electron microscopy of the complete Drosophila brain, MICCAI, doi:10.1007/978-3-030-00934-2_36",
    "Eckstein et al. 2024, Neurotransmitter classification from electron microscopy images at synaptic sites in Drosophila melanogaster, Cell 187:2574-2594, doi:10.1016/j.cell.2024.03.016",
    "FlyWire Consortium, FlyWire Whole-brain Connectome Connectivity Data v783, Zenodo, doi:10.5281/zenodo.10676866",
)
CITE_ANNOTATIONS = (
    "Schlegel et al. 2024, doi:10.1038/s41586-024-07686-5",
    "Matsliah et al. 2024, Neuronal parts list and wiring diagram for a visual system, Nature 634:166-180, doi:10.1038/s41586-024-07981-1",
    "Berg et al. 2026, Sexual dimorphism in the complete Drosophila male central nervous system connectome, Cell 189:5504-5526, doi:10.1016/j.cell.2026.08.015",
    "Tastekin et al. 2026, The complete gustatory connectome of adult Drosophila reveals how taste guides feeding, foraging, and social behavior, Cell 189:5527-5551, doi:10.1016/j.cell.2026.08.016",
    "Dorkenwald et al. 2024, doi:10.1038/s41586-024-07558-y",
)
CITE_SHIU = (
    "Shiu et al. 2024, A Drosophila computational brain model reveals sensorimotor processing, Nature 634:210-219, doi:10.1038/s41586-024-07763-9",
)

SOURCES: tuple[Source, ...] = (
    Source(
        key="root_ids",
        group="zenodo-10676866",
        filename="proofread_root_ids_783.npy",
        url=ZENODO.format("proofread_root_ids_783.npy"),
        size=1_114_168,
        sha256="7c7b7e818e9232e5ab64793d52ba20574dbe9da3a6509fbc74193b0f259a01be",
        md5="e0e6c19732fd8c7a4e39a2d170105421",
        terms="flywire-cc-by-nc-4.0",
        cite=CITE_FLYWIRE,
        required=True,
        note="All 139,255 proofread neuron root ids of release 783.",
    ),
    Source(
        key="connections",
        group="zenodo-10676866",
        filename="proofread_connections_783.feather",
        url=ZENODO.format("proofread_connections_783.feather"),
        size=852_022_274,
        sha256="24f960ae3e7d4f8cd30db3b62e99fb5179cc3d1e76d8c155bfb441e9737d3faf",
        md5="f48f972d262323a102aed49af1396b8a",
        terms="flywire-cc-by-nc-4.0",
        cite=CITE_FLYWIRE,
        required=True,
        note=(
            "Proofread synapses summed per (pre, post, neuropil), with mean transmitter "
            "probabilities. The 9.5 GB per-synapse table is not needed and never fetched."
        ),
    ),
    Source(
        key="annotations",
        group="flywire-annotations-v3.2.0",
        filename="Supplemental_file1_neuron_annotations.tsv",
        url=(
            "https://raw.githubusercontent.com/flyconnectome/flywire_annotations/"
            f"{ANNOTATIONS_COMMIT}/supplemental_files/Supplemental_file1_neuron_annotations.tsv"
        ),
        size=31_720_298,
        sha256="b214970b55d2fbe0853bba536fdcb9e28730f4eb7ab06f600491df795da683cd",
        md5="fd4fcb205256ca2f80a2eca3a0cc5d87",
        terms="flywire-annotations-cite",
        cite=CITE_ANNOTATIONS,
        required=False,
        note="Cell classes, types and sides for release 783 (tag v3.2.0); used to select populations.",
    ),
    Source(
        key="shiu_completeness",
        group="shiu-91bdd1e",
        filename="Completeness_783.csv",
        url=f"https://raw.githubusercontent.com/philshiu/Drosophila_brain_model/{SHIU_COMMIT}/Completeness_783.csv",
        size=3_327_347,
        sha256="bbb847a4cc2caaa7a16349722d220c087317b946d148d4d592d94d250617a311",
        md5="031a4b6eac490bda17c75b65ccaa7906",
        terms="shiu-mit-code-flywire-data",
        cite=CITE_SHIU,
        required=False,
        note="Shiu et al.'s neuron list for 783 (cross-check and the Brian 2 reference only).",
    ),
    Source(
        key="shiu_connectivity",
        group="shiu-91bdd1e",
        filename="Connectivity_783.parquet",
        url=f"https://raw.githubusercontent.com/philshiu/Drosophila_brain_model/{SHIU_COMMIT}/Connectivity_783.parquet",
        size=100_804_642,
        sha256="efeb23fb99098e9c390f6869969b2a121a2ee92c833cfc45ecb2c1d8e1af0347",
        md5="3d802fd542b5d18570ba1ba0bb0abed9",
        terms="shiu-mit-code-flywire-data",
        cite=CITE_SHIU,
        required=False,
        note="Shiu et al.'s signed connectivity for 783 (cross-check, sign policy 'shiu', Brian 2 reference).",
    ),
    Source(
        key="shiu_model_py",
        group="shiu-91bdd1e",
        filename="model.py",
        url=f"https://raw.githubusercontent.com/philshiu/Drosophila_brain_model/{SHIU_COMMIT}/model.py",
        size=11_900,
        sha256="fc45837d7122c6ce2a7f3f2f23c515992e4b232aadb919efabb72337fac88e4e",
        md5="5886c9105b7fc9fd4a8ae8baf1b18965",
        terms="shiu-mit-code-flywire-data",
        cite=CITE_SHIU,
        required=False,
        note="Shiu et al.'s Brian 2 model, run unmodified by reference/shiu_brian2.py; never copied into this repository.",
    ),
    Source(
        key="shiu_utils_py",
        group="shiu-91bdd1e",
        filename="utils.py",
        url=f"https://raw.githubusercontent.com/philshiu/Drosophila_brain_model/{SHIU_COMMIT}/utils.py",
        size=2_176,
        sha256="f378cf0b464f2ac5e1daf3609ba25fd51c7e34f294846281707ffe006c3e9ef1",
        md5="2468d24159f5e9d339467908ac61f732",
        terms="shiu-mit-code-flywire-data",
        cite=CITE_SHIU,
        required=False,
        note="Helper module model.py's notebooks import; fetched with it.",
    ),
)

BY_KEY = {s.key: s for s in SOURCES}


def describe() -> list[dict]:
    return [
        {
            "key": s.key,
            "file": f"{s.group}/{s.filename}",
            "url": s.url,
            "size": s.size,
            "sha256": s.sha256,
            "terms": s.terms,
            "required": s.required,
        }
        for s in SOURCES
    ]
