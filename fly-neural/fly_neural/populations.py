"""Named neuron populations: published root ids, or cited selections from the annotation release.

Two kinds, never mixed silently:

- **Published ids.** The populations Shiu et al. (2024) stimulated, as listed in
  their ``figures.ipynb`` (commit 91bdd1e). They were published for FlyWire
  materialization 630; a root id changes whenever its neuron is edited, so each
  is resolved against release 783 by exact id and the ids that no longer exist
  are reported, never guessed. (No 630-to-783 mapping is available without
  FlyWire's authenticated services.)
- **Annotation selections.** A rule over the v3.2.0 annotation table
  (``cell_class``, ``cell_sub_class``, ``cell_type``, ``side``), each with the
  paper that identified the cell type. The table is read from the local cache
  and never copied into the repository.

Side: the annotation's ``side`` is the soma side, or for sensory neurons the
nerve-entry side. Shiu et al. call the sugar GRNs they stimulated "right" and
MN9 720575940660219265 "left"; the annotation release labels all 20 of those
GRNs that still exist in 783 ``left`` and that MN9 ``right`` (the dataset's
hemisphere convention changed; the pairing is unchanged). Populations here use
the annotation's side.

Modality: the annotation release retyped the GRNs (Tastekin et al. 2026). Of
the 20 surviving ids Shiu et al. used as "sugar", the annotation now calls 9
``sugar``, 2 ``sugar/low_salt``, 4 ``putative_attractive`` and 5
``high_salt/heavy_metal``; of their 18 "water" ids, 11 ``water`` and 7
``sugar``. The ``*_shiu`` populations reproduce the paper; the ``*_grn_*``
selections follow the current annotation.

Root ids are identifiers of public neurons, listed so experiments can be
reproduced; no connectivity or annotation data is stored here.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

import numpy as np

from .connectome import Connectome

SHIU_NB = "Shiu et al. 2024, figures.ipynb at github.com/philshiu/Drosophila_brain_model commit 91bdd1e"
CITE = {
    "shiu2024": "Shiu et al. 2024, Nature 634:210-219, doi:10.1038/s41586-024-07763-9",
    "tastekin2026": "Tastekin et al. 2026, Cell, doi:10.1016/j.cell.2026.08.016 (GRN retyping and taste modalities)",
    "gordon2009": "Gordon & Scott 2009, Neuron 61:373-384, doi:10.1016/j.neuron.2008.12.033 (MN9, proboscis extension)",
    "hampel2015": "Hampel et al. 2015, eLife 4:e08758, doi:10.7554/eLife.08758 (aDN, aBN antennal grooming circuit)",
    "kamikouchi2009": "Kamikouchi et al. 2009, Nature 458:165-171, doi:10.1038/nature07810 (JO subgroups; C/E sense static deflection)",
    "yorozu2009": "Yorozu et al. 2009, Nature 458:201-205, doi:10.1038/nature07843 (JO-C/E neurons sense wind)",
    "vonreyn2017": "von Reyn et al. 2017, Neuron 94:1190-1204, doi:10.1016/j.neuron.2017.05.036 (LC4 angular velocity, LPLC2 angular size, into the giant fiber)",
    "ache2019": "Ache et al. 2019, Curr Biol 29:1073-1081, doi:10.1016/j.cub.2019.01.079 (LPLC2 to giant fiber)",
    "klapoetke2017": "Klapoetke et al. 2017, Nature 551:237-241, doi:10.1038/nature24626 (LPLC2 looming selectivity)",
    "vonreyn2014": "von Reyn et al. 2014, Nat Neurosci 17:962-970, doi:10.1038/nn.3741 (giant fiber spike selects short-mode takeoff)",
    "semmelhack2009": "Semmelhack & Wang 2009, Nature 459:218-223, doi:10.1038/nature07983 (vinegar attraction via DM1 and VA2)",
    "aso2014": "Aso et al. 2014, eLife 3:e04577, doi:10.7554/eLife.04577 (mushroom body cell types, MBON valence)",
    "matsliah2024": "Matsliah et al. 2024, Nature 634:166-180, doi:10.1038/s41586-024-07981-1 (optic lobe types)",
    "schlegel2024": "Schlegel et al. 2024, Nature 634:139-152, doi:10.1038/s41586-024-07686-5",
    "bidaye2014": "Bidaye et al. 2014, Science 344:97-101, doi:10.1126/science.1249964 (MDN drives backward walking)",
    "bidaye2020": "Bidaye et al. 2020, Neuron 108:469-485, doi:10.1016/j.neuron.2020.07.032 (P9, annotated DNp09, initiates forward walking with an ipsilateral turn)",
    "rayshubskiy2020": "Rayshubskiy et al., Neural circuit mechanisms for steering control in walking Drosophila, bioRxiv doi:10.1101/2020.04.04.024703, eLife 102230 (DNa02 predicts high-gain ipsilateral steering)",
    "ache2019nn": "Ache et al. 2019, Nat Neurosci 22:1132-1139, doi:10.1038/s41593-019-0413-4 (DNp07 and DNp10 drive landing; their visual responses are gated by flight)",
    "keles2017": "Keles & Frye 2017, Curr Biol 27:680-687, doi:10.1016/j.cub.2017.01.012 (LC11 responds to small moving objects, not to wide-field motion)",
    "ribeiro2018": "Ribeiro et al. 2018, Cell 174:607-621, doi:10.1016/j.cell.2018.06.020 (LC10 prefers small moving objects; shown for male courtship)",
}


@dataclass(frozen=True)
class Population:
    key: str
    label: str
    role: str
    cite: tuple[str, ...]
    ids: tuple[int, ...] = ()
    published_for: str | None = None
    select: dict = field(default_factory=dict)
    note: str = ""


def _ids(text: str) -> tuple[int, ...]:
    return tuple(int(x) for x in text.split())


SHIU = {
    "sugar_shiu": _ids(
        "720575940624963786 720575940630233916 720575940637568838 720575940638202345 720575940617000768 "
        "720575940630797113 720575940632889389 720575940621754367 720575940621502051 720575940640649691 "
        "720575940639332736 720575940616885538 720575940639198653 720575940620900446 720575940617937543 "
        "720575940632425919 720575940633143833 720575940612670570 720575940628853239 720575940629176663 "
        "720575940611875570"
    ),
    "bitter_shiu": _ids(
        "720575940621778381 720575940602353632 720575940617094208 720575940619197093 720575940626287336 "
        "720575940618600651 720575940627692048 720575940630195909 720575940646212996 720575940610483162 "
        "720575940645743412 720575940627578156 720575940622298631 720575940621008895 720575940629146711 "
        "720575940610259370 720575940610481370 720575940619028208 720575940614281266 720575940613061118 "
        "720575940604027168"
    ),
    "ir94e_shiu": _ids(
        "720575940614211295 720575940638218173 720575940628832256 720575940626016017 720575940621375231 "
        "720575940612920386 720575940614273292 720575940628198503 720575940626241636 720575940619387814 "
        "720575940624604560 720575940615274425 720575940610683315 720575940627265265 720575940624079544 "
        "720575940629211607 720575940615089369 720575940631082124"
    ),
    "water_shiu": _ids(
        "720575940612950568 720575940631898285 720575940606002609 720575940612579053 720575940622902535 "
        "720575940616177458 720575940660292225 720575940622486922 720575940613786774 720575940629852866 "
        "720575940625861168 720575940613996959 720575940617857694 720575940644965399 720575940625203504 "
        "720575940630553415 720575940635172191 720575940634796536"
    ),
    "jo_ce_shiu": _ids(
        "720575940619341105 720575940630122015 720575940611061526 720575940615848788 720575940628444667 720575940627941431 "
        "720575940632449619 720575940650244342 720575940631866508 720575940638681845 720575940628978450 720575940609522461 "
        "720575940621442224 720575940602506208 720575940629022149 720575940627109991 720575940630020111 720575940615986459 "
        "720575940618684481 720575940620382889 720575940630080071 720575940626565455 720575940630319671 720575940602720940 "
        "720575940630564179 720575940637632419 720575940615809349 720575940626042149 720575940637054835 720575940602132509 "
        "720575940614188149 720575940616951124 720575940628101126 720575940629055721 720575940616589878 720575940622449388 "
        "720575940614427195 720575940625797617 720575940638664437 720575940618467195 720575940621729757 720575940613971485 "
        "720575940627585688 720575940629650997 720575940630059847 720575940608742409 720575940614351477 720575940633153375 "
        "720575940622937528 720575940604753437 720575940611783464 720575940618599872 720575940609541917 720575940637410869 "
        "720575940630070343 720575940621397417 720575940614035485 720575940610018266 720575940626307902 720575940634634606 "
        "720575940614060829 720575940624799290 720575940641921421 720575940623298559 720575940625559358 720575940629138959 "
        "720575940621625597 720575940625962568 720575940632767383 720575940624915230"
    ),
    "jo_f_shiu": _ids(
        "720575940606239243 720575940626956777 720575940604973746 720575940622222856 720575940642517284 720575940629719404 "
        "720575940616613022 720575940604299454 720575940615473186 720575940622217992 720575940606800341 720575940629267498 "
        "720575940637366335 720575940624224408 720575940609543197 720575940633364179 720575940629502009 720575940606431189 "
        "720575940625733960 720575940638529525 720575940617524053 720575940628935564 720575940624308355 720575940631170346 "
        "720575940627704375 720575940625885512 720575940614929245 720575940647493241 720575940618888368 720575940625087546 "
        "720575940606657493 720575940617273560 720575940640591861 720575940639410035 720575940621532413 720575940627523584 "
        "720575940621521917 720575940621097398 720575940625915338 720575940606222428 720575940627868471 720575940622179497 "
        "720575940608297774 720575940614026269 720575940613012959 720575940628100614 720575940606611401 720575940628649465 "
        "720575940610008217 720575940623791152 720575940625571240 720575940634923621 720575940609530653 720575940635968745 "
        "720575940625703434 720575940613105311 720575940629386819 720575940623077389 720575940625763015 720575940628359017"
    ),
    "jo_dm_shiu": _ids(
        "720575940630834171 720575940622892988 720575940621289537 720575940641395163 720575940616064546 720575940628978409 "
        "720575940652566177 720575940627493096 720575940619085397 720575940635545310 720575940645728803 720575940629141775 "
        "720575940626557995 720575940631098338 720575940639904475 720575940635067034"
    ),
    "jo_f_inhibitory_shiu": _ids("720575940636066222 720575940609957315 720575940624986407"),
    "mn9_shiu": _ids("720575940660219265 720575940645521262"),
    "abn1_shiu": _ids("720575940630907434"),
    "adn1_shiu": _ids("720575940616185531"),
    "adn2_shiu": _ids("720575940629806974"),
}

POPULATIONS: dict[str, Population] = {}


def _add(p: Population) -> None:
    POPULATIONS[p.key] = p


_SHIU_META = {
    "sugar_shiu": ("labellar sugar GRNs, the set Shiu et al. call right hemisphere", "sensory", ("shiu2024",)),
    "bitter_shiu": ("labellar bitter GRNs (Shiu et al.)", "sensory", ("shiu2024",)),
    "ir94e_shiu": ("Ir94e GRNs (Shiu et al.)", "sensory", ("shiu2024",)),
    "water_shiu": ("labellar water GRNs (Shiu et al.)", "sensory", ("shiu2024",)),
    "jo_ce_shiu": ("Johnston's organ JO-C/E neurons (Shiu et al.)", "sensory", ("shiu2024", "kamikouchi2009")),
    "jo_f_shiu": ("Johnston's organ JO-F neurons (Shiu et al.)", "sensory", ("shiu2024",)),
    "jo_dm_shiu": ("Johnston's organ JO-D/m neurons (Shiu et al.)", "sensory", ("shiu2024",)),
    "jo_f_inhibitory_shiu": ("three inhibitory neurons between JO-F and aBN1 (Shiu et al.)", "interneuron", ("shiu2024",)),
    "mn9_shiu": ("MN9 proboscis motor neurons, both sides (Shiu et al.)", "motor", ("shiu2024", "gordon2009")),
    "abn1_shiu": ("aBN1 antennal grooming interneuron (Shiu et al.)", "interneuron", ("shiu2024", "hampel2015")),
    "adn1_shiu": ("aDN1 antennal grooming descending neuron (Shiu et al.)", "descending", ("shiu2024", "hampel2015")),
    "adn2_shiu": ("aDN2 antennal grooming descending neuron (Shiu et al.)", "descending", ("shiu2024", "hampel2015")),
}
for _k, _ids_ in SHIU.items():
    _label, _role, _cite = _SHIU_META[_k]
    _add(Population(key=_k, label=_label, role=_role, cite=_cite, ids=_ids_, published_for="FlyWire materialization 630", note=SHIU_NB))

for side in ("left", "right"):
    _add(Population(f"sugar_grn_{side}", f"labellar sugar GRNs ({side})", "sensory", ("tastekin2026",), select={"cell_sub_class": ["sugar", "sugar/low_salt"], "side": side}))
    _add(Population(f"bitter_grn_{side}", f"labellar bitter GRNs ({side})", "sensory", ("tastekin2026",), select={"cell_sub_class": ["bitter"], "side": side}))
    _add(Population(f"water_grn_{side}", f"labellar water GRNs ({side})", "sensory", ("tastekin2026",), select={"cell_sub_class": ["water"], "cell_class": ["gustatory"], "side": side}))
    _add(Population(f"lplc2_{side}", f"LPLC2 looming-sensitive visual projection neurons ({side})", "sensory", ("klapoetke2017", "ache2019", "matsliah2024"), select={"cell_type": ["LPLC2"], "side": side}))
    _add(Population(f"lc4_{side}", f"LC4 visual projection neurons ({side})", "sensory", ("vonreyn2017", "matsliah2024"), select={"cell_type": ["LC4"], "side": side}))
    _add(Population(f"jo_wind_{side}", f"JO-C and JO-E wind/gravity neurons ({side})", "sensory", ("yorozu2009", "kamikouchi2009"), select={"cell_sub_class": ["wind_gravity"], "cell_type_prefix": ["JO-C", "JO-E"], "side": side}))
    _add(Population(f"orn_vinegar_{side}", f"ORNs of the DM1 and VA2 glomeruli ({side})", "sensory", ("semmelhack2009",), select={"cell_type": ["ORN_DM1", "ORN_VA2"], "side": side}))
    _add(Population(f"giant_fiber_{side}", f"giant fiber descending neuron DNp01 ({side})", "descending", ("vonreyn2014", "ache2019"), select={"cell_type": ["DNp01"], "side": side}))
    _add(Population(f"mn9_{side}", f"MN9 proboscis motor neuron, annotated CB0701 ({side})", "motor", ("gordon2009", "shiu2024"), select={"cell_type": ["CB0701"], "side": side}, note="cell_type of the MN9 id Shiu et al. analysed (720575940660219265)"))
    # whole-brain/v2: the other fly as a small moving object, and more of the brain's descending commands.
    _add(Population(f"lc11_{side}", f"LC11 small-object visual projection neurons ({side})", "sensory", ("keles2017", "matsliah2024"), select={"cell_type": ["LC11"], "side": side}))
    _add(Population(f"lc10a_{side}", f"LC10a small-object visual projection neurons ({side})", "sensory", ("ribeiro2018", "matsliah2024"), select={"cell_type": ["LC10a"], "side": side}, note="LC10's role was shown in males; this brain (FAFB) is a female's"))
    _add(Population(f"dnp09_{side}", f"DNp09 (P9) forward-walking descending neuron ({side})", "descending", ("bidaye2020",), select={"cell_type": ["DNp09"], "side": side}))
    _add(Population(f"mdn_{side}", f"MDN backward-walking descending neurons ({side})", "descending", ("bidaye2014",), select={"cell_type": ["MDN"], "side": side}))
    _add(Population(f"dna02_{side}", f"DNa02 steering descending neuron ({side})", "descending", ("rayshubskiy2020",), select={"cell_type": ["DNa02"], "side": side}))
    _add(Population(f"adn_{side}", f"aDN1 and aDN2 antennal-grooming descending neurons, annotated DNg62 and DNge078 ({side})", "descending", ("hampel2015", "shiu2024"), select={"cell_type": ["DNg62", "DNge078"], "side": side}, note="the cell types of the aDN1 and aDN2 ids Shiu et al. published (720575940616185531, 720575940629806974)"))
    _add(Population(f"dn_landing_{side}", f"DNp07 and DNp10 landing descending neurons ({side})", "descending", ("ache2019nn",), select={"cell_type": ["DNp07", "DNp10"], "side": side}))
_add(Population("descending_all", "every neuron annotated descending", "descending", ("schlegel2024",), select={"super_class": ["descending"]}))
_add(Population("kenyon_cells", "Kenyon cells", "interneuron", ("aso2014", "schlegel2024"), select={"cell_class": ["Kenyon_Cell"]}))
_add(Population("mbons", "mushroom body output neurons", "interneuron", ("aso2014",), select={"cell_class": ["MBON"]}))
_add(Population("pam_dans", "PAM dopaminergic neurons", "interneuron", ("aso2014",), select={"cell_class": ["DAN"], "cell_type_prefix": ["PAM"]}))


@lru_cache(maxsize=2)
def _annotations(path: str):
    import polars as pl

    cols = ["root_id", "super_class", "cell_class", "cell_sub_class", "cell_type", "side"]
    return pl.read_csv(path, separator="\t", columns=cols, schema_overrides={c: (pl.Int64 if c == "root_id" else pl.String) for c in cols})


def annotation_path(root: Path | None = None) -> Path:
    from .acquire import verify

    return verify("annotations", root)


def select_ids(rule: dict, root: Path | None = None) -> np.ndarray:
    import polars as pl

    ann = _annotations(str(annotation_path(root)))
    expr = pl.lit(True)
    for col, want in rule.items():
        if col == "cell_type_prefix":
            expr = expr & pl.any_horizontal([pl.col("cell_type").str.starts_with(w) for w in want])
        elif col == "side":
            expr = expr & (pl.col("side") == want)
        else:
            expr = expr & pl.col(col).is_in(list(want))
    return np.sort(ann.filter(expr)["root_id"].to_numpy())


def resolve(key: str, c: Connectome, root: Path | None = None) -> tuple[np.ndarray, dict]:
    """Indices of a population in ``c`` and a report of how they were found."""
    pop = POPULATIONS[key]
    if pop.ids:
        ids = np.array(pop.ids, dtype=np.int64)
        present = np.array([c.has(int(x)) for x in ids])
        idx = c.index_of(ids[present])
        report = {
            "kind": "published ids",
            "published_for": pop.published_for,
            "published": int(ids.size),
            "present_in_this_release": int(present.sum()),
            "missing_ids": [int(x) for x in ids[~present]],
        }
    else:
        ids = select_ids(pop.select, root)
        present = np.array([c.has(int(x)) for x in ids], dtype=bool)
        idx = c.index_of(ids[present]) if present.any() else np.zeros(0, dtype=np.int64)
        report = {"kind": "annotation selection", "rule": pop.select, "selected": int(ids.size), "in_connectome": int(present.sum())}
    report.update({"key": key, "label": pop.label, "role": pop.role, "cite": [CITE[k] for k in pop.cite], "neurons": int(idx.size)})
    return np.sort(idx), report


def select_ids_in(c: Connectome, rule: dict, root: Path | None = None) -> np.ndarray:
    """Indices in ``c`` of an annotation selection (ids absent from ``c`` are skipped)."""
    ids = select_ids(rule, root)
    present = np.array([c.has(int(x)) for x in ids], dtype=bool)
    return c.index_of(ids[present]) if present.any() else np.zeros(0, dtype=np.int64)
