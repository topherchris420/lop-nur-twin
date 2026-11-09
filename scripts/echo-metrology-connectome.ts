/**
 * The bench's optional adapter for the connectome research backends
 * (`fly-neural/`: Shiu et al. 2024's LIF model on FlyWire FAFB v783, and BANC
 * v888). It evaluates their sealed results; it never runs them, never imports
 * the Python backend, and never puts a neural model in a fly's place.
 *
 * Neural-model validation stays apart from behavioural-controller validation:
 * a fly-neural criterion says how a model's spikes compare with a published
 * observation, never that a controller behaves better. A result's own seal
 * (fly-neural's `record.sealed`: SHA-256 of Python's
 * `json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False)`)
 * is re-derived here from the file's text, number lexemes kept exactly as
 * Python wrote them, so the check needs no Python.
 *
 * What the adapter reports for each result is one of the evaluation kinds the
 * bench defines for neural models (fidelity to published experiments,
 * prediction, circuit ablations and control wirings, learning selectivity,
 * behavioural use of neural outputs, and computational efficiency of reduced
 * versus larger circuits), the criteria as the result scored them, its
 * dataset and terms, and its recorded resources. Running 139,255 modelled
 * neurons is not biological equivalence, and nothing here says otherwise.
 *
 * Pure: file texts in, a report out. It lives in scripts/, not src/, because
 * nothing under src/ may name the connectome backend (the neural shadow
 * recorder's test): the browser and the deployed life never reach it.
 */
import { sha256 } from "../src/rain/sha256.js";

export const NEURAL_REPORT_SCHEMA = "eimb-neural-report/v1" as const;

type Node =
  | { t: "obj"; entries: [string, Node][] }
  | { t: "arr"; items: Node[] }
  | { t: "str"; v: string }
  | { t: "raw"; v: string };

/** A JSON parser that keeps every number (and NaN/Infinity) as the exact text it was written as. */
export function parseKeepingNumbers(text: string): Node {
  let i = 0;
  const ws = () => {
    while (i < text.length && " \t\n\r".includes(text[i]!)) i++;
  };
  const fail = (what: string): never => {
    throw new Error(`JSON: ${what} at offset ${i}`);
  };
  const str = (): string => {
    if (text[i] !== '"') fail("expected a string");
    const start = i;
    i++;
    while (i < text.length && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
    if (text[i] !== '"') fail("unterminated string");
    i++;
    return JSON.parse(text.slice(start, i)) as string;
  };
  const value = (): Node => {
    ws();
    const ch = text[i];
    if (ch === "{") {
      i++;
      const entries: [string, Node][] = [];
      ws();
      if (text[i] === "}") return (i++, { t: "obj", entries });
      for (;;) {
        ws();
        const k = str();
        ws();
        if (text[i] !== ":") fail("expected :");
        i++;
        entries.push([k, value()]);
        ws();
        if (text[i] === ",") i++;
        else if (text[i] === "}") return (i++, { t: "obj", entries });
        else fail("expected , or }");
      }
    }
    if (ch === "[") {
      i++;
      const items: Node[] = [];
      ws();
      if (text[i] === "]") return (i++, { t: "arr", items });
      for (;;) {
        items.push(value());
        ws();
        if (text[i] === ",") i++;
        else if (text[i] === "]") return (i++, { t: "arr", items });
        else fail("expected , or ]");
      }
    }
    if (ch === '"') return { t: "str", v: str() };
    const m = /^(-?Infinity|NaN|true|false|null|-?\d+(\.\d+)?([eE][+-]?\d+)?)/.exec(
      text.slice(i, i + 64),
    );
    if (!m) return fail("unexpected token");
    i += m[0].length;
    return { t: "raw", v: m[0] };
  };
  const out = value();
  ws();
  if (i !== text.length) fail("trailing text");
  return out;
}

const byCodePoint = (a: string, b: string): number => {
  const A = [...a],
    B = [...b];
  for (let k = 0; k < Math.min(A.length, B.length); k++) {
    const d = A[k]!.codePointAt(0)! - B[k]!.codePointAt(0)!;
    if (d) return d;
  }
  return A.length - B.length;
};

/** Python's `json.dumps(v, sort_keys=True, separators=(",", ":"), ensure_ascii=False)`. */
export function pythonCanonical(n: Node): string {
  switch (n.t) {
    case "raw":
      return n.v;
    case "str":
      return JSON.stringify(n.v);
    case "arr":
      return `[${n.items.map(pythonCanonical).join(",")}]`;
    case "obj":
      return `{${[...n.entries]
        .sort((x, y) => byCodePoint(x[0], y[0]))
        .map(([k, v]) => `${JSON.stringify(k)}:${pythonCanonical(v)}`)
        .join(",")}}`;
  }
}

/** Whether a fly-neural result's `sha256` is the seal of the rest of it; null when it carries none. */
export function checkFlyNeuralSeal(text: string): boolean | null {
  const root = parseKeepingNumbers(text);
  if (root.t !== "obj") return false;
  const seal = root.entries.find(([k]) => k === "sha256")?.[1];
  if (!seal) return null;
  if (seal.t !== "str") return false;
  const body: Node = { t: "obj", entries: root.entries.filter(([k]) => k !== "sha256") };
  return sha256(pythonCanonical(body)) === seal.v;
}

export const NEURAL_EVALUATIONS = [
  "fidelity",
  "prediction",
  "ablation",
  "learning-selectivity",
  "behavioural-use",
  "efficiency",
  "provenance",
] as const;
export type NeuralEvaluation = (typeof NEURAL_EVALUATIONS)[number];

/** Which evaluation a fly-neural result kind informs. */
export const KIND_EVALUATION: Readonly<Record<string, NeuralEvaluation>> = {
  experiment: "fidelity",
  reference: "fidelity",
  reproduction: "fidelity",
  import: "provenance",
  benchmark: "efficiency",
  "reduced-circuit": "efficiency",
  "reduced-circuit-check": "efficiency",
  shadow: "prediction",
  plasticity: "learning-selectivity",
  "plasticity-v2": "learning-selectivity",
  "plasticity-v2-calibration": "learning-selectivity",
  "mb-representation": "learning-selectivity",
  "adaptive-life": "behavioural-use",
  "closed-loop": "behavioural-use",
  threat: "behavioural-use",
};

export interface NeuralCriterion {
  id: string;
  claim: string;
  passed: boolean | null;
  /** Control wirings (shuffled, rewired, random, sign-permuted) are ablations, never the connectome. */
  control: boolean;
}

export interface NeuralResult {
  file: string;
  fileSha256: string;
  schema: string | null;
  kind: string | null;
  split: string | null;
  dataset: "FAFB v783" | "BANC v888" | "unknown";
  evaluation: NeuralEvaluation | "unclassified";
  seal: "verified" | "broken" | "absent";
  criteria: NeuralCriterion[];
  passed: number;
  total: number;
  partial: boolean | null;
  neurons: number | null;
  synapses: number | null;
  resources: { wallS: number | null; cpuS: number | null; peakRssMb: number | null };
  cost: {
    fullWallSPerSimS: number | null;
    reducedWallSPerSimS: number | null;
    speedup: number | null;
  } | null;
  code: { commit: string | null; dirty: boolean | null };
}

export interface NeuralReport {
  schema: typeof NEURAL_REPORT_SCHEMA;
  scope: string;
  results: NeuralResult[];
  byEvaluation: Record<
    string,
    { results: number; criteriaPassed: number; criteriaTotal: number }
  >;
  licences: { dataset: string; file: string; terms: string }[];
  notRun: string[];
  limits: string[];
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const CONTROL = /shuffl|rewir|random|permut|degree-preserving|sign/i;

function criteriaOf(d: Record<string, unknown>): NeuralCriterion[] {
  const c = d.criteria;
  const out: NeuralCriterion[] = [];
  const one = (id: string, x: unknown) => {
    const o = obj(x);
    if (!o) return;
    const claim = String(o.claim ?? o.text ?? "");
    out.push({
      id,
      claim,
      passed: typeof o.passed === "boolean" ? o.passed : null,
      control: CONTROL.test(claim) || /^C\d/.test(id),
    });
  };
  if (Array.isArray(c)) c.forEach((x, k) => one(String(obj(x)?.id ?? `#${k + 1}`), x));
  else if (obj(c)) for (const [id, x] of Object.entries(obj(c)!)) one(id, x);
  return out;
}

/** One sealed fly-neural result, read through the adapter's contract. */
export function readNeuralResult(file: string, text: string): NeuralResult {
  const d = JSON.parse(text) as Record<string, unknown>;
  const seal = checkFlyNeuralSeal(text);
  const kind = typeof d.kind === "string" ? d.kind : null;
  const connectome = obj(d.connectome) ?? obj(d.source);
  const resources = obj(d.resources);
  const code = obj(d.code);
  const cost = obj(d.cost);
  const criteria = criteriaOf(d);
  const text0 = JSON.stringify(d.connectome ?? d.source ?? d.config ?? "").toLowerCase();
  const dataset =
    file.includes("/banc/") || text0.includes("banc")
      ? "BANC v888"
      : text0.includes("v783") || file.includes("v783")
        ? "FAFB v783"
        : "unknown";
  return {
    file,
    fileSha256: sha256(text),
    schema: typeof d.schema === "string" ? d.schema : null,
    kind,
    split: typeof d.split === "string" ? d.split : null,
    dataset,
    evaluation: kind && KIND_EVALUATION[kind] ? KIND_EVALUATION[kind] : "unclassified",
    seal: seal === null ? "absent" : seal ? "verified" : "broken",
    criteria,
    passed: criteria.filter((x) => x.passed === true).length,
    total: criteria.length,
    partial: typeof d.partial === "boolean" ? d.partial : null,
    neurons: num(connectome?.neurons),
    synapses: num(connectome?.synapses),
    resources: {
      wallS: num(resources?.wall_s),
      cpuS: num(resources?.cpu_s),
      peakRssMb: num(resources?.peak_rss_mb_process),
    },
    cost: cost
      ? {
          fullWallSPerSimS: num(cost.full_brain_wall_s_per_sim_s),
          reducedWallSPerSimS: num(cost.reduced_wall_s_per_sim_s),
          speedup: num(cost.speedup),
        }
      : null,
    code: {
      commit: typeof code?.commit === "string" ? code.commit : null,
      dirty: typeof code?.dirty === "boolean" ? code.dirty : null,
    },
  };
}

export function neuralReport(
  files: { path: string; text: string }[],
  licences: { dataset: string; file: string; text: string }[],
): NeuralReport {
  const results = files
    .map((f) => readNeuralResult(f.path, f.text))
    .sort((a, b) => (a.file < b.file ? -1 : 1));
  const costed = results.find(
    (r) => r.cost?.fullWallSPerSimS !== null && r.cost?.fullWallSPerSimS !== undefined,
  );
  const byEvaluation: NeuralReport["byEvaluation"] = {};
  for (const r of results) {
    const e = (byEvaluation[r.evaluation] ??= {
      results: 0,
      criteriaPassed: 0,
      criteriaTotal: 0,
    });
    e.results++;
    e.criteriaPassed += r.passed;
    e.criteriaTotal += r.total;
  }
  return {
    schema: NEURAL_REPORT_SCHEMA,
    scope:
      "Sealed fly-neural results already in this repository, read and checked; none re-run. Neural-model validation only: no controller, no behavioural verdict, no original individual.",
    results,
    byEvaluation,
    licences: licences.map((l) => ({
      dataset: l.dataset,
      file: l.file,
      // The licence file's own line, without its list marker, bold or trailing comma.
      terms: (l.text.split("\n").find((x) => /CC BY/i.test(x)) ?? "see file")
        .trim()
        .replace(/^[-*]\s*/, "")
        .replaceAll("**", "")
        .replace(/,$/, ""),
    })),
    notRun: [
      `A behavioural comparison of a connectome-driven research fly against the organism under the bench's protocol: not run. ${
        costed
          ? `The whole-brain model costs ${costed.cost!.fullWallSPerSimS} wall seconds per simulated second (${costed.file}, on the machine it names), so one 2-hour run would take about ${((costed.cost!.fullWallSPerSimS! * 7200) / 3600).toFixed(1)} hours, and a protocol needs hundreds.`
          : "No sealed result records the whole-brain model's cost, so the run's length is unknown."
      }`,
      "Re-running any fly-neural experiment: not run here; their seals and criteria are read as reference cases.",
    ],
    limits: [
      "A criterion passing means a model output met a threshold against a published observation, not that the model is the fly's nervous system.",
      "FAFB v783 and BANC v888 are different animals; their results are listed apart and never pooled.",
      "Resources were measured on the machines each result names; they are not comparable across results run on different hardware.",
    ],
  };
}

const f = (x: number | null | undefined, d = 3) =>
  x === null || x === undefined || !Number.isFinite(x) ? "n/a" : x.toFixed(d);

export function renderNeural(r: NeuralReport): string {
  const L = [
    "# ECHO Intelligence Metrology Bench: connectome backends (neural-model validation)",
    "",
    "Generated by `scripts/echo-metrology.ts neural` from the sealed results in `docs/benchmarks/fly-neural/`. Do not edit by hand.",
    "",
    `${r.scope}`,
    "",
    "Terms: the results summarized here are model outputs on FlyWire FAFB v783 and BANC v888 and carry those datasets' terms; this summary carries the same terms.",
    "",
    ...r.licences.map((l) => `- ${l.dataset}: \`${l.file}\` (${l.terms})`),
    "",
    "## By evaluation",
    "",
    "| evaluation | results | criteria passed |",
    "| --- | ---: | ---: |",
    ...Object.entries(r.byEvaluation).map(
      ([k, v]) => `| ${k} | ${v.results} | ${v.criteriaPassed} of ${v.criteriaTotal} |`,
    ),
    "",
    "## Every result",
    "",
    "| file | dataset | kind | split | evaluation | seal | criteria passed | neurons | wall s | CPU s | peak RSS MB |",
    "| --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |",
    ...r.results.map(
      (x) =>
        `| ${x.file.replace("docs/benchmarks/fly-neural/", "")} | ${x.dataset} | ${x.kind ?? "—"} | ${x.split ?? "—"} | ${x.evaluation} | ${x.seal} | ${x.total ? `${x.passed} of ${x.total}` : "—"} | ${x.neurons ?? "—"} | ${f(x.resources.wallS, 1)} | ${f(x.resources.cpuS, 1)} | ${f(x.resources.peakRssMb, 0)} |`,
    ),
    "",
    "## Reduced versus larger circuits",
    "",
    ...r.results
      .filter((x) => x.cost)
      .map(
        (x) =>
          `- \`${x.file.replace("docs/benchmarks/fly-neural/", "")}\`: whole brain ${f(x.cost!.fullWallSPerSimS, 3)} wall s per simulated s, reduced circuit ${f(x.cost!.reducedWallSPerSimS, 3)} (speed-up ${f(x.cost!.speedup, 1)}×), ${x.passed} of ${x.total} fidelity criteria passed on its held-out conditions.`,
      ),
    "",
    "## Criteria that failed",
    "",
    ...r.results.flatMap((x) =>
      x.criteria
        .filter((c) => c.passed === false)
        .map(
          (c) =>
            `- \`${x.file.replace("docs/benchmarks/fly-neural/", "")}\` ${c.id}${c.control ? " (control wiring)" : ""}: ${c.claim}`,
        ),
    ),
    "",
    "## Not run",
    "",
    ...r.notRun.map((x) => `- ${x}`),
    "",
    "## Limits",
    "",
    ...r.limits.map((x) => `- ${x}`),
    "",
  ];
  return L.join("\n");
}
