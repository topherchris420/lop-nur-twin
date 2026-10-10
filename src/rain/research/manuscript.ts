/** Evidence-bound manuscript compilation. Model prose never supplies measurements. */
import type { DiscoveryResult } from "../../bethesda/rain/discoveryView.js";
import {
  RESEARCH_SECTIONS,
  MANUSCRIPT_SCHEMA,
  type ManuscriptDraft,
  type ResearchSource,
  type ResearchScope,
} from "../../bethesda/rain/researchProtocol.js";
import { checkData } from "../../bethesda/rain/discoveryProtocol.js";
import { sha256Json } from "../sha256.js";

export interface PaperEvidence {
  goal: string;
  generation: "model" | "scripted";
  model: string;
  charter_sha256: string;
  sources: ResearchSource[];
  results: DiscoveryResult[];
}
const metricPattern = /\{\{metric:([^:}]+):([a-z][a-z0-9_]*)\}\}/g;
export function metricCatalog(e: PaperEvidence) {
  return e.results.flatMap((r) =>
    Object.entries(r.measurements)
      .filter(([, v]) => typeof v === "number" && Number.isFinite(v))
      .map(([key, value]) => ({
        token: "{{metric:" + r.run_id + ":" + key + "}}",
        run_id: r.run_id,
        key,
        value,
      })),
  );
}
export function validateManuscript(raw: unknown, evidence: PaperEvidence): string[] {
  const parsed = checkData<ManuscriptDraft>(raw, MANUSCRIPT_SCHEMA);
  if (!parsed.ok) return parsed.errors;
  const d = parsed.value,
    errors: string[] = [];
  if (new Set(d.paragraphs.map((p) => p.section)).size !== RESEARCH_SECTIONS.length)
    errors.push("Each required manuscript section must occur once");
  const sources = new Set(evidence.sources.map((s) => s.id));
  const runs = new Set(
    evidence.results.filter((r) => r.replay && r.registry_run_id).map((r) => r.run_id),
  );
  const metrics = new Set(metricCatalog(evidence).map((m) => m.token));
  if (!runs.size)
    errors.push("A scientific draft requires replay-verified admitted measurements");
  for (const p of d.paragraphs) {
    if (p.source_ids.some((id) => !sources.has(id)))
      errors.push(p.section + ": unavailable source citation");
    if (p.run_ids.some((id) => !runs.has(id)))
      errors.push(p.section + ": unavailable measured run");
    for (const m of p.text.matchAll(metricPattern)) {
      if (!metrics.has(m[0]) || !p.run_ids.includes(m[1]!))
        errors.push(p.section + ": metric token is unknown or its run is not cited");
    }
    const unbound = p.text.replace(metricPattern, "");
    if (/\d/.test(unbound))
      errors.push(p.section + ": numeric claims must use host-bound metric tokens");
    if (/\{\{|\}\}|https?:\/\/|!\[|<\s*\/?[a-z]/i.test(unbound))
      errors.push(p.section + ": unsupported template, link or markup");
    if (["abstract", "discussion", "conclusion"].includes(p.section) && !p.run_ids.length)
      errors.push(p.section + ": empirical interpretation must cite measured runs");
    if (p.section === "related_work" && !p.source_ids.length)
      errors.push("Related work must cite retrieved source context");
  }
  return errors;
}
const md = (s: unknown) =>
  String(s)
    .replace(/[\\[\]<>`*_{}|]/g, "\\$&")
    .replace(/\r/g, "");
const xml = (s: unknown) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!,
  );
export function deliveryGaps(scope: ResearchScope, evidence: PaperEvidence): string[] {
  const gaps: string[] = [];
  if (evidence.results.length < scope.minimum_experiments)
    gaps.push(
      "Need " +
        scope.minimum_experiments +
        " completed, replay-verified studies for this goal",
    );
  if (evidence.results.some((r) => !r.replay || !r.registry_run_id))
    gaps.push("Every cited study must have passed replay and native registry admission");
  if (
    !evidence.results.some(
      (r) => r.parent && evidence.results.some((p) => p.design_id === r.parent),
    )
  )
    gaps.push("Need an evidence-linked follow-up within this research program");
  if (
    scope.require_confirmation &&
    !evidence.results.some((r) => r.purpose === "confirmatory")
  )
    gaps.push(
      "The reviewed delivery scope requires withheld-seed confirmatory replication",
    );
  if (
    scope.literature === "crossref" &&
    !evidence.sources.some((s) => s.kind === "literature")
  )
    gaps.push("No external literature was retrieved under the approved online scope");
  if (!evidence.sources.length) gaps.push("No source context was available");
  return gaps;
}
export function researchFigure(e: PaperEvidence): string {
  const groups = new Map<string, { r: DiscoveryResult; study: number }[]>();
  e.results.forEach((r, study) => {
    const key = r.design.primary_metric + " (" + r.unit + ")";
    groups.set(key, [...(groups.get(key) ?? []), { r, study }]);
  });
  let y = 65;
  const marks: string[] = [];
  for (const [label, studies] of groups) {
    const rows = studies.flatMap(({ r, study }) => r.per_seed.map((p) => ({ p, study })));
    const max = Math.max(1, ...rows.map(({ p }) => Math.abs(p.delta ?? 0)));
    marks.push(
      '<text x="12" y="' +
        y +
        '" font-size="13">' +
        xml(label) +
        " · separate scale, bar extent ±" +
        xml(max) +
        "</text>",
    );
    y += 18;
    const top = y;
    for (const { p, study } of rows) {
      const value = p.delta;
      const width = value === null ? 0 : (Math.abs(value) / max) * 180;
      const x = value !== null && value < 0 ? 500 - width : 500;
      marks.push(
        '<text x="12" y="' +
          (y + 15) +
          '" font-size="12">Study ' +
          (study + 1) +
          " · seed " +
          p.seed +
          "</text>" +
          '<rect x="' +
          x +
          '" y="' +
          y +
          '" width="' +
          width +
          '" height="22" fill="' +
          (study % 2 ? "#6b7ab4" : "#0b5d63") +
          '"/>' +
          '<text x="695" y="' +
          (y + 15) +
          '" font-size="12">' +
          xml(value ?? "missing") +
          "</text>",
      );
      y += 38;
    }
    marks.push('<path d="M500 ' + top + "V" + (y - 12) + '" stroke="#777"/>');
    y += 30;
  }
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="820" height="' +
    y +
    '" viewBox="0 0 820 ' +
    y +
    '"><title>Paired treatment minus control differences</title>' +
    '<rect width="820" height="' +
    y +
    '" fill="white"/>' +
    '<text x="12" y="25" font-size="16">Measured paired differences; descriptive seed panels</text>' +
    '<text x="12" y="45" font-size="12">Each metric and unit has its own scale. Bars start at zero.</text>' +
    marks.join("") +
    "</svg>"
  );
}
export function bibliography(sources: ResearchSource[]): string {
  const escape = (s: string) =>
    s.replace(/[{}\\%#&_$]/g, (c) => "\\" + c).replace(/\n/g, " ");
  return sources
    .map(
      (s) =>
        "@misc{" +
        s.id +
        ",\n  title = {" +
        escape(s.title) +
        "},\n" +
        "  author = {" +
        s.authors.map(escape).join(" and ") +
        "},\n" +
        (s.year ? "  year = {" + escape(s.year) + "},\n" : "") +
        "  howpublished = {" +
        escape(s.locator) +
        "},\n" +
        "  note = {" +
        escape(s.reading_scope) +
        "; SHA-256 " +
        s.sha256 +
        "}\n}\n",
    )
    .join("\n");
}
export function compileManuscript(
  draft: ManuscriptDraft,
  e: PaperEvidence,
  figureName: string,
): string {
  const errors = validateManuscript(draft, e);
  if (errors.length) throw new Error(errors.join("; "));
  const metrics = new Map(metricCatalog(e).map((m) => [m.token, m.value]));
  const heading: Record<string, string> = {
    abstract: "Abstract",
    introduction: "Introduction",
    related_work: "Related work",
    discussion: "Discussion",
    limitations: "Limitations",
    conclusion: "Conclusion",
  };
  const sections = (names: readonly string[]) =>
    names
      .map((name) => {
        const p = draft.paragraphs.find((p) => p.section === name)!;
        const prose = p.text.replace(metricPattern, (token) =>
          String(metrics.get(token)),
        );
        return (
          "## " +
          heading[name] +
          "\n\n" +
          md(prose) +
          "\n\n" +
          (p.source_ids.length
            ? "Source references: " + p.source_ids.map(md).join(", ") + ".\n\n"
            : "") +
          (p.run_ids.length
            ? "Measured run references: " + p.run_ids.map(md).join(", ") + ".\n\n"
            : "")
        );
      })
      .join("");
  const methods = e.results
    .map((r, i) =>
      [
        "### Study " + (i + 1) + " — " + md(r.design_id),
        "",
        "Operational hypothesis: " + md(r.operational_hypothesis),
        "",
        "Intervention: " +
          md(r.design.scenario) +
          " at " +
          md(r.design.location) +
          "; population " +
          r.design.parameters.pedestrians +
          " pedestrians, " +
          r.design.parameters.vehicles +
          " vehicles and " +
          r.design.parameters.buses +
          " buses; intensity " +
          r.design.parameters.intensity +
          "; duration " +
          r.design.parameters.duration_ticks +
          " ticks; warm-up " +
          r.design.warmup_ticks +
          "; observation " +
          r.design.observation_window_ticks +
          " ticks.",
        "",
        "Purpose: " +
          r.purpose +
          ". Parent: " +
          md(r.parent ?? "none") +
          ". Native verdict: " +
          md(r.verdict) +
          ".",
        "",
        "| Seed | Control | Treatment | Treatment − control |",
        "| --- | ---: | ---: | ---: |",
        ...r.per_seed.map(
          (p) =>
            "| " +
            p.seed +
            " | " +
            (p.control ?? "missing") +
            " | " +
            (p.treatment ?? "missing") +
            " | " +
            (p.delta ?? "missing") +
            " |",
        ),
        "",
        "Primary metric: " +
          md(r.design.primary_metric) +
          " (" +
          r.unit +
          "). Mean paired difference: **" +
          r.measurements.primary_delta_mean +
          "**.",
        "",
        "Run: " +
          md(r.run_id) +
          ". Registry admission: " +
          md(r.registry_run_id) +
          ". Replay: passed.",
        "",
        "Recorded uncertainty: " +
          md(r.critique?.uncertainty.join("; ") ?? "Analysis unavailable"),
        "",
      ].join("\n"),
    )
    .join("\n");
  return (
    "# " +
    md(draft.title) +
    "\n\n" +
    "**AI-assisted research draft — requires human scientific review.**\n\n" +
    "Narrative generation: " +
    e.generation +
    "; model: " +
    md(e.model) +
    ". " +
    (e.generation === "scripted"
      ? "**SCRIPTED INTEGRATION DEMONSTRATION, not a model discovery.** "
      : "") +
    "Numeric tables and figure are host-generated from replay-verified simulator records. " +
    "Narrative and source interpretation remain model statements; reference validity does not establish entailment.\n\n" +
    "Research goal: " +
    md(e.goal) +
    "\n\nCharter SHA-256: " +
    e.charter_sha256 +
    "\n\nEvidence bundle SHA-256: " +
    sha256Json(e) +
    "\n\n" +
    sections(["abstract", "introduction", "related_work"]) +
    "## Methods and measured results\n\nOne no-event control and one treatment per seed. " +
    "Initial states are matched, criteria are preregistered, and native replay recomputes measurements. " +
    "Seed panels are small and comparisons across differing protocols are descriptive; no significance test or real-world validation is supplied.\n\n" +
    methods +
    "\n![Host-generated paired-seed measurements](" +
    figureName +
    ")\n\n" +
    sections(["discussion", "limitations", "conclusion"]) +
    "## References and reading scope\n\n" +
    e.sources
      .map(
        (s) =>
          "- **" +
          md(s.id) +
          "** — " +
          md(s.title) +
          ". " +
          md(s.authors.join(", ")) +
          (s.year ? " (" + md(s.year) + ")" : "") +
          ". " +
          md(s.reading_scope) +
          "\n  " +
          s.locator +
          "\n  SHA-256: " +
          s.sha256 +
          ". Retrieved: " +
          md(s.retrieved_at ?? "not stated") +
          ".",
      )
      .join("\n\n") +
    "\n"
  );
}
