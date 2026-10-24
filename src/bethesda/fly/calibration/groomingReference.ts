/**
 * Recorded grooming of real flies, as `scripts/import-fly-grooming.ts` reduced
 * it from Zhang, Guo & Simpson 2020's published ethograms (Mendeley Data, CC
 * BY 4.0; never hand-edited). Parsed strictly: the calibration, the grooming
 * circuit and the build validator read it through `parseGroomingReference`.
 */
import data from "../data/grooming-reference.json" with { type: "json" };

export interface AcrossFlies {
  n: number;
  mean: number;
  sd: number;
  q25: number;
  median: number;
  q75: number;
}
export interface Durations {
  runs: number;
  mean?: number;
  q10?: number;
  q25?: number;
  median?: number;
  q75?: number;
  q90?: number;
}
export interface GroomingSummary {
  timeFraction: Record<string, AcrossFlies>;
  grooming: AcrossFlies;
  anterior: AcrossFlies;
  posterior: AcrossFlies;
  episodes: { durationS: Durations; perMinute: AcrossFlies };
  motifs: { anterior: Durations; posterior: Durations };
  transitions: {
    anteriorToAnterior: number | null;
    posteriorToPosterior: number | null;
    transitions: number;
  };
  actions: Record<string, Durations>;
  intervals: {
    lengthS: number;
    count: number;
    anterior: AcrossFlies[];
    posterior: AcrossFlies[];
    walking: AcrossFlies[];
    standing: AcrossFlies[];
  };
}
export interface GroomingCondition {
  file: { name: string; sha256: string; bytes: number; matrix: string };
  flies: number;
  frames: number;
  summary: GroomingSummary;
}
export interface GroomingReference {
  schema: "fly-grooming-reference/v1";
  retrievedAt: string;
  importer: string;
  dataset: {
    doi: string;
    title: string | null;
    published: string | null;
    api: string;
    sha256: string;
    folder: string;
  };
  paper: {
    short: string;
    doi: string;
    pmcid: string;
    fullText: string;
    sha256: string;
    quotes: Record<string, string>;
  };
  model: {
    file: { name: string; sha256: string; bytes: number };
    initialDust: { head: number; abdomen: number; wings: number; eachLegPair: number };
    dustRemovalRate: number;
    legRubRemovalFactor: number;
    activitySdOverDust: number;
    activityAbsolute: boolean;
    boutLengthGamma: Record<
      "1" | "2" | "3" | "4" | "5",
      { shape: number; scaleFrames: number }
    >;
  };
  licence: { name: string; url: string; attribution: string; changes: string };
  paradigm: string;
  frameHz: number;
  labels: Record<"1" | "2" | "3" | "4" | "5" | "6" | "7", string>;
  groups: { grooming: number[]; anterior: number[]; posterior: number[] };
  method: string;
  conditions: { dusted: GroomingCondition; undusted: GroomingCondition };
}

const HEX64 = /^[0-9a-f]{64}$/;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function parseGroomingReference(raw: unknown): GroomingReference {
  const r = raw as Partial<GroomingReference>;
  const fail = (why: string): never => {
    throw new Error(`grooming-reference: ${why}`);
  };
  if (!r || typeof r !== "object" || r.schema !== "fly-grooming-reference/v1")
    fail("schema");
  if (typeof r.retrievedAt !== "string" || Number.isNaN(Date.parse(r.retrievedAt)))
    fail("retrievedAt");
  if (r.dataset?.doi !== "10.17632/fxz8dgywcd.1" || !HEX64.test(r.dataset.sha256 ?? ""))
    fail("dataset");
  if (r.licence?.name !== "CC BY 4.0" || !r.licence.attribution) fail("licence");
  if (!r.paper || !/^10\.\d{4,}\//.test(r.paper.doi) || !HEX64.test(r.paper.sha256))
    fail("paper");
  if (r.frameHz !== 30) fail("frame rate");
  const m = r.model;
  if (
    !m ||
    !HEX64.test(m.file?.sha256 ?? "") ||
    ![
      m.initialDust?.head,
      m.initialDust?.abdomen,
      m.initialDust?.wings,
      m.initialDust?.eachLegPair,
    ].every((x) => isNum(x) && x > 0) ||
    !(isNum(m.dustRemovalRate) && m.dustRemovalRate > 0 && m.dustRemovalRate < 1) ||
    !(isNum(m.activitySdOverDust) && m.activitySdOverDust > 0)
  )
    fail("model constants");
  for (const label of ["1", "2", "3", "4", "5"] as const) {
    const g = m!.boutLengthGamma[label];
    if (
      !g ||
      !(isNum(g.shape) && g.shape > 0 && isNum(g.scaleFrames) && g.scaleFrames > 0)
    )
      fail(`bout length of label ${label}`);
  }
  for (const c of ["dusted", "undusted"] as const) {
    const k = r.conditions?.[c];
    if (!k || !HEX64.test(k.file?.sha256 ?? "") || !(k.flies > 1) || k.frames !== 50000)
      fail(`${c} condition`);
    const fractions = ["1", "2", "3", "4", "5", "6", "7"].map(
      (l) => k!.summary.timeFraction[l]?.mean,
    );
    if (
      !fractions.every(isNum) ||
      Math.abs(fractions.reduce((a, b) => a + b, 0) - 1) > 1e-3
    )
      fail(`${c} fractions`);
    const iv = k!.summary.intervals;
    if (
      !(iv?.count > 0) ||
      ![iv.anterior, iv.posterior, iv.walking, iv.standing].every(
        (xs) =>
          Array.isArray(xs) && xs.length === iv.count && xs.every((x) => isNum(x?.mean)),
      )
    )
      fail(`${c} intervals`);
  }
  return r as GroomingReference;
}

export const GROOMING_REFERENCE = parseGroomingReference(data);
