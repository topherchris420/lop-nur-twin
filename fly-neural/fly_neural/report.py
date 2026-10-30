"""The results README and figure, written from the sealed results and nothing else.

``python -m fly_neural report`` reads every ``*.json`` in the results
directory, refuses any whose seal does not verify, and writes ``README.md``
and ``figure-sugar-mn9.svg`` there. Numbers are never typed by hand: rerun
this after a run.
"""

from __future__ import annotations

import json
from pathlib import Path

from . import RESULT_SCHEMA
from .record import check_seal

TITLE = "Computational Neural Research"


def _load(results: Path) -> dict[str, dict]:
    out = {}
    for p in sorted(results.glob("*.json")):
        d = json.loads(p.read_text(encoding="utf-8"))
        if d.get("schema") != RESULT_SCHEMA:
            continue
        if not check_seal(d):
            raise ValueError(f"{p.name}: seal does not verify; results are never edited")
        out[p.name] = d
    return out


def _code(d: dict) -> str:
    c = d.get("code") or {}
    commit = (c.get("commit") or "?")[:7]
    return f"`{commit}`" + ("" if c.get("clean") else " (uncommitted changes)")


def _f(x, nd=1) -> str:
    return "–" if x is None else (f"{x:.{nd}f}" if isinstance(x, float) else str(x))


def _verdict(v: dict) -> str:
    t = v["test"]
    if t in ("fraction_active", "fraction_active_max"):
        lo, hi = v["wilson95"]
        return f"{v['active_trials']}/{v['trials']} trials (Wilson 95% {lo:.3f}–{hi:.3f})"
    if t in ("less", "greater"):
        s = f"{v['a_mean_hz']:.1f} vs {v['b_mean_hz']:.1f} Hz, one-sided Mann-Whitney p = {v['mann_whitney']['p']:.2g}"
        if "ratio_b_over_a" in v:
            s += f", ratio {_f(v['ratio_b_over_a'], 2)}"
        return s
    if t == "mean_at_least":
        return f"{v['mean_hz']:.1f} Hz"
    if t == "responders_increase":
        (a, lo), (b, hi) = v["responders"].items()
        return f"{lo} → {hi} responders ({a} → {b})"
    if t == "all_respond":
        return ", ".join(f"{k} {x:.1f} Hz" for k, x in v["mean_hz"].items())
    if t == "mn9_same":
        return f"{v['ours']['mean']:.1f} vs {v['brian2']['mean']:.1f} Hz (difference {v['difference_hz']:+.2f}, SE {v['se_difference_hz']:.2f}); two-sided p = {v['mann_whitney']['p']:.2g}"
    if t == "rate_correlation":
        return f"r = {_f(v['pearson_r'], 4)} over {v['neurons']} neurons"
    if t == "responder_jaccard":
        return f"Jaccard {_f(v['jaccard'], 3)} ({v['both']} shared; {v['ours']} here, {v['brian2']} in Brian 2)"
    if t == "readout_responds":
        m = v["mean_spikes_before"]
        return f"before training: A {m['A']:.1f}, B {m['B']:.1f} readout spikes per trial"
    if t == "li_negative":
        return f"{v['negative']}/{v['n']} subjects negative, sign test p = {v['sign_test_p']:.3g}; LI " + ", ".join(f"{x:+.3f}" for x in v["li"])
    if t == "li_less":
        mean = lambda xs: sum(xs) / len(xs) if xs else None  # noqa: E731
        return f"mean LI {_f(mean(v['a_li']), 3)} vs {_f(mean(v['b_li']), 3)}, one-sided Mann-Whitney p = {v['mann_whitney']['p']:.2g}"
    if t == "echo_mb_discriminates":
        if "after_A_minus_B" not in v:
            return v.get("note", "")
        d, z = v["after_A_minus_B"], v["reward_omitted_after_A_minus_B"]
        return f"after(A) − after(B): {min(d):.3f} to {max(d):.3f} with reward, {min(z):.3f} to {max(z):.3f} without"
    if t == "report_only":
        return "LI " + ", ".join(f"{x:+.3f}" for x in v["li"])
    return ""


def _criteria(d: dict) -> list[str]:
    rows = ["| | Claim | Result | |", "| --- | --- | --- | --- |"]
    for v in d["criteria"]:
        ok = "report only" if v["test"] == "report_only" else ("**pass**" if v["passed"] else "**fail**")
        rows.append(f"| {v['id']} | {v['claim']} | {_verdict(v)} | {ok} |")
    return rows


def _svg(dev: dict | None, held: dict | None) -> str | None:
    """MN9 rate against sugar GRN input rate, both splits, with the 100 Hz controls."""
    sets = [(n, d) for n, d in (("dev", dev), ("held-out", held)) if d]
    if not sets:
        return None
    W, H, L, R, T, B = 560, 340, 56, 150, 28, 44
    xmax, ymax = 210.0, 120.0
    X = lambda x: L + (W - L - R) * x / xmax  # noqa: E731
    Y = lambda y: H - B - (H - T - B) * y / ymax  # noqa: E731
    out = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" font-family="system-ui, sans-serif" font-size="12">',
        f"<title>{TITLE}: MN9 firing against sugar input in the v783 model</title>",
        '<rect width="100%" height="100%" fill="#fff"/>',
        f'<text x="{L}" y="18" font-weight="600">{TITLE} · MN9 rate vs sugar GRN rate (model, FlyWire v783)</text>',
    ]
    for gy in range(0, 121, 20):
        out.append(f'<line x1="{L}" x2="{W - R}" y1="{Y(gy)}" y2="{Y(gy)}" stroke="#e5e5e5"/><text x="{L - 6}" y="{Y(gy) + 4}" text-anchor="end" fill="#555">{gy}</text>')
    for gx in (0, 50, 100, 150, 200):
        out.append(f'<text x="{X(gx)}" y="{H - B + 16}" text-anchor="middle" fill="#555">{gx}</text>')
    out.append(f'<text x="{(L + W - R) / 2}" y="{H - 8}" text-anchor="middle">sugar GRN Poisson rate (Hz)</text>')
    out.append(f'<text transform="translate(14 {(T + H - B) / 2}) rotate(-90)" text-anchor="middle">MN9 mean rate (Hz)</text>')
    colours = {"dev": "#2f6db5", "held-out": "#c0562b"}
    marks = {"weight-shuffle": "#888", "degree-preserving": "#5a9e4b", "sign-shuffle": "#9b59b6", "random-graph": "#222"}
    ly = T + 10
    for name, d in sets:
        pts = []
        for cond in d["conditions"].values():
            s = cond["stimulate"]
            if list(s) == ["sugar_shiu"] and cond["wiring"] == "connectome" and not cond["silence"]:
                m = cond["readout_summary_hz"].get("mn9_shiu")
                if m:
                    pts.append((float(s["sugar_shiu"]), m["mean"], m.get("sd") or 0.0))
        pts.sort()
        if pts:
            out.append(f'<polyline fill="none" stroke="{colours[name]}" stroke-width="2" points="{" ".join(f"{X(x):.1f},{Y(y):.1f}" for x, y, _ in pts)}"/>')
            for x, y, sd in pts:
                out.append(f'<line x1="{X(x):.1f}" x2="{X(x):.1f}" y1="{Y(max(0, y - sd)):.1f}" y2="{Y(min(ymax, y + sd)):.1f}" stroke="{colours[name]}"/><circle cx="{X(x):.1f}" cy="{Y(y):.1f}" r="3.5" fill="{colours[name]}"/>')
        out.append(f'<line x1="{W - R + 12}" x2="{W - R + 30}" y1="{ly}" y2="{ly}" stroke="{colours[name]}" stroke-width="2"/><text x="{W - R + 36}" y="{ly + 4}">connectome, {name}</text>')
        ly += 18
        for cond in d["conditions"].values():
            if cond["wiring"] in marks and "sugar_shiu" in cond["stimulate"]:
                m = cond["readout_summary_hz"].get("mn9_shiu")
                if m:
                    off = 4 if name == "dev" else -4
                    out.append(f'<rect x="{X(100) + off - 3:.1f}" y="{Y(m["mean"]) - 3:.1f}" width="6" height="6" fill="{marks[cond["wiring"]]}"/>')
    for k, col in marks.items():
        out.append(f'<rect x="{W - R + 18}" y="{ly - 3}" width="6" height="6" fill="{col}"/><text x="{W - R + 36}" y="{ly + 4}">{k} (100 Hz)</text>')
        ly += 18
    out.append(f'<text x="{W - R + 12}" y="{ly + 8}" fill="#555" font-size="10">bars: ±1 SD over trials</text>')
    out.append("</svg>")
    return "\n".join(out) + "\n"


def write(results: Path) -> Path:
    res = _load(results)
    pick = lambda kind, **kw: [(n, d) for n, d in res.items() if d.get("kind") == kind and all(d.get(k) == v for k, v in kw.items())]  # noqa: E731
    lines = [
        f"# {TITLE}: fly-neural results",
        "",
        "Written by `python -m fly_neural report` from the sealed results in this",
        "directory; do not edit by hand. Every number is a model output on the",
        "FlyWire v783 connectome (terms: [LICENSE.md](LICENSE.md)). What the",
        "results mean, and what they do not, is in",
        "[docs/ECHO_CONNECTOME.md](../../ECHO_CONNECTOME.md).",
        "",
    ]
    for n, d in pick("import"):
        cr = d["shiu_crosscheck"]
        s = d["structure_revalidated"]
        lines += [
            f"## Import: `{d['connectome']}` ([{n}]({n}), {_code(d)})",
            "",
            f"{s['neurons']:,} neurons, {s['pairs']:,} connected pairs, {s['synapses']:,} synapses; {s['autapses']} autapses, "
            f"{s['inhibitory_neurons']:,} inhibitory neurons under sign policy `{d['sign_policy']}`. "
            f"Against Shiu et al.'s Connectivity_783: {cr['pairs_found']:,} of {cr['shiu_pairs']:,} pairs found, "
            f"{cr['pairs_same_synapse_count']:,} with the same synapse count, {cr['pairs_same_signed_weight']:,} with the same signed weight.",
            "",
        ]
    for n, d in pick("reference"):
        lines += [f"## Against Brian 2 ([{n}]({n}), {_code(d)})", "", *_criteria(d), ""]
        b2, en = d["brian2_run"], d["engine_run"]
        pooled = "; ".join(f"`{f['file']}` {f['trials']} of {f['requested_trials']} requested" for f in b2["files"])
        lines += [
            f"{b2['trials']} Brian 2 trials (seeds {min(b2['seeds'])} to {max(b2['seeds'])}) from {len(b2['files'])} run(s): {pooled}.",
            f"Brian 2: {b2['wall_s_per_trial']['mean']:.1f} s per simulated second; this engine: {en['wall_s_per_trial']:.2f} s.",
            "",
        ]
    exp = {d["split"]: (n, d) for n, d in pick("experiment")}
    for split in ("dev", "heldout"):
        if split not in exp:
            continue
        n, d = exp[split]
        lines += [f"## Shiu et al. 2024 on v783, {split} seeds ([{n}]({n}), {_code(d)}{', partial' if d.get('partial') else ''})", ""]
        lines += [f"{d['passed']} of {len(d['criteria'])} criteria passed; failed: {', '.join(d['failed']) or 'none'}.", "", *_criteria(d), ""]
        lines += ["| Condition | Wiring | Trials | MN9 (Hz) | aBN1 | aDN1 | aDN2 | Responders > 0 Hz | ≥ 1 Hz |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- |"]
        for c in d["conditions"].values():
            r = c["readout_summary_hz"]
            g = lambda k: _f(r[k]["mean"]) if k in r else "–"  # noqa: E731
            lines.append(f"| {c['name']} | {c['wiring']} | {c['trials']} | {g('mn9_shiu')} | {g('abn1_shiu')} | {g('adn1_shiu')} | {g('adn2_shiu')} | {c['responders_gt0']} | {c['responders_ge1hz']} |")
        lines.append("")
    svg = _svg(exp.get("dev", (None, None))[1], exp.get("heldout", (None, None))[1])
    if svg:
        (results / "figure-sugar-mn9.svg").write_text(svg, encoding="utf-8", newline="\n")
        lines += ["![MN9 rate against sugar GRN rate in the model, by split, with the controls at 100 Hz](figure-sugar-mn9.svg)", ""]
    for n, d in pick("plasticity"):
        lines += [f"## Plasticity, {d['split']} seeds ([{n}]({n}), {_code(d)}{', partial' if d.get('partial') else ''})", "", *_criteria(d), ""]
    for n, d in pick("shadow"):
        cmp_ = d["comparison"]
        e, f = cmp_.get("escape", {}), cmp_.get("feed", {})
        lines += [
            f"## Neural shadow: `{d['recording']['header'].get('subject')}` ([{n}]({n}), {_code(d)})",
            "",
            f"{cmp_['samples']} samples. Escape: ECHO {e.get('echo_onsets')} onsets, model giant-fiber episodes {e.get('model_gf_episodes')}; "
            f"{e.get('hits')} hits, {e.get('misses')} misses, {e.get('false_alarms')} false alarms. "
            f"Feeding: body feeding in {f.get('echo_feeding_samples')} samples, model MN9 ≥ threshold in {f.get('model_mn9_samples')}; both {f.get('both')}, agreement {f.get('agreement')}.",
            "",
        ]
    for n, d in pick("benchmark"):
        lines += [f"## Cost on this machine ([{n}]({n}), {_code(d)})", "", "| Connectome | Load (s) | Wall s per simulated s | CPU s | RSS (MB) |", "| --- | --- | --- | --- | --- |"]
        for r in d["full_brain"]:
            lines.append(f"| `{r['connectome']}` | {r['load']['wall_s']:.1f} | {r['wall_s_per_simulated_s']['mean']:.2f} | {r['cpu_s_per_simulated_s']['mean']:.2f} | {r['rss_end_mb']['mean']:.0f} |")
        lines += ["", "| Synthetic neurons | Pairs | Wall s per simulated s | Fired |", "| --- | --- | --- | --- |"]
        for r in d["scaling"]["rows"]:
            lines.append(f"| {r['neurons']:,} | {r['pairs']:,} | {r['run']['wall_s']:.2f} | {r['neurons_fired']:,} |")
        m = d["machine"]
        lines += ["", f"Machine: {m.get('processor')}, {m.get('logical_cpus')} logical CPUs, {m.get('total_ram_mb')} MB RAM, {m.get('os')}; {d['threads']}; GPU: none.", ""]
    out = results / "README.md"
    out.write_text("\n".join(lines), encoding="utf-8", newline="\n")
    return out
