/**
 * Import recorded grooming of real flies, the digital fly's grooming reference.
 *
 *   node scripts/run-ts.mjs scripts/import-fly-grooming.ts
 *
 * Source: Zhang, Guo & Simpson 2020 (Curr Biol 30:988), whose Figure 1
 * ethograms Mendeley Data publishes under CC BY 4.0 (doi:10.17632/
 * fxz8dgywcd.1): one behaviour label per video frame, 50 000 frames at 30 Hz,
 * for 44 Canton S males shaken in dust and 55 shaken without it. The importer
 * reads the dataset's metadata (its licence, its files and their SHA-256),
 * downloads the two ethogram files, refuses any whose bytes do not hash to
 * what Mendeley states, decodes them (MATLAB 5 files holding one compressed
 * numeric matrix) and reduces them to summary statistics, which it writes to
 * `src/bethesda/fly/data/grooming-reference.json` with the time it retrieved
 * them. Nothing per-frame is kept.
 *
 * The reduction, stated in the file it writes: per fly, the fraction of
 * frames in each behaviour; grooming episodes (maximal runs of the five
 * grooming labels, ended only by walking or standing), motifs (maximal runs
 * of anterior or of posterior grooming labels) and actions (maximal runs of
 * one label), with every run that touches the start or the end of a recording
 * left out of the duration statistics, because its length is not known; and
 * the fraction of each behaviour in successive 150 s intervals (the interval
 * the paper compares). Quantiles interpolate linearly between order
 * statistics. No run is filtered by length and no label is changed.
 */
import { createHash } from "node:crypto";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { inflateSync } from "node:zlib";
import {
  ANTERIOR_LABELS,
  ETHOGRAM_LABELS,
  GROOMING_LABELS,
  POSTERIOR_LABELS,
  summarizeEthograms,
} from "../src/bethesda/fly/calibration/ethogram.ts";

const API = "https://data.mendeley.com/public-api/datasets/fxz8dgywcd";
const DATASET_DOI = "10.17632/fxz8dgywcd.1";
const FOLDER = "Figure 1";
const OUT = resolve("src/bethesda/fly/data/grooming-reference.json");
/** The two files of the Figure 1 folder this reference reads, by the condition they record. */
const FILES = { dusted: "CantonS_dusted.mat", undusted: "CantonS_undusted.mat" } as const;
const MODEL_FILE = "groomingmodel.m";
/** The paper's own statement of the frame rate and assay length (STAR Methods). */
const FRAME_HZ = 30;
const FRAMES = 50000;
const INTERVAL_S = 150;
/** The labels as the dataset's description documents them for its dusting experiments, verbatim. */
const LABEL_TEXT =
  "For dusting experiments: 1.Front Leg rubbing 2. Head cleaning 3. Abdominal cleaning 4. Back Leg rubbing 5. Wing cleaning 6. Walking 7. Standing";

/** The paper's full text (PMC), against which every sentence below is checked. */
const PAPER_XML =
  "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pmc&id=7184881&rettype=xml";
/** Sentences of the paper this reference relies on, which must appear in it verbatim. */
const PAPER_QUOTES = {
  frames: "30 Hz videos were recorded for 50,000 frames (27.78 min)",
  temperature: "Dust-induced grooming assays were performed in 21–23°C",
  flies: "4–7 days male flies were anesthetized on ice",
  dusting: "Flies were tapped into dusting chamber and shaken for 10 times",
  control:
    "As undusted control, flies with the same genotype were shaken in chambers without dust",
  bristles: "the head has ~1200, the abdomen has ~600, and the wings have ~400",
  removal:
    "A simulation with dr = 0.2% generates a similar speed of grooming progression to what we observed in real flies",
  activity: "σ(t)=d(t)/5",
  bouts:
    "It was drawn from duration distributions of different grooming modules we got from two manually labeled dusted Canton S ethograms",
} as const;

const sha256 = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");

/** XML to plain text with entities decoded and whitespace removed, for verbatim checks. */
const plain = (xml: string) =>
  xml
    .replace(/<[^>]*>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, "")
    .normalize("NFC");

async function fetchBytes(url: string, max: number): Promise<Uint8Array> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = new Uint8Array(await res.arrayBuffer());
      if (body.length > max) throw new Error("response too large");
      return body;
    } catch (e) {
      if (attempt >= 3)
        throw new Error(`${url}: ${e instanceof Error ? e.message : String(e)}`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}
async function fetchJson(url: string): Promise<{ body: string; json: unknown }> {
  const body = new TextDecoder().decode(await fetchBytes(url, 2_000_000));
  return { body, json: JSON.parse(body) as unknown };
}

/**
 * The single numeric matrix of a MATLAB 5 file (little-endian, one
 * zlib-compressed element whose real part is stored as unsigned bytes), or a
 * thrown error for anything else.
 */
function decodeMat(file: Uint8Array): {
  name: string;
  rows: number;
  cols: number;
  data: Uint8Array;
} {
  const fail = (why: string): never => {
    throw new Error(`MAT file: ${why}`);
  };
  if (file.length < 136) fail("too short");
  const head = new TextDecoder().decode(file.subarray(0, 116));
  if (!head.startsWith("MATLAB 5.0 MAT-file")) fail("not a MATLAB 5 file");
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  if (view.getUint16(124, true) !== 0x0100 || file[126] !== 0x49 || file[127] !== 0x4d)
    fail("not version 0x0100, little-endian");
  if (view.getUint32(128, true) !== 15) fail("the first element is not compressed");
  const size = view.getUint32(132, true);
  if (136 + size !== file.length) fail("more than one element");
  const raw = inflateSync(file.subarray(136, 136 + size));
  const v = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  if (v.getUint32(0, true) !== 14) fail("not a matrix");
  let p = 8;
  // A sub-element: small (type and size packed in the tag) or normal, 8-byte aligned.
  const sub = (): { type: number; bytes: Uint8Array } => {
    const tag = v.getUint32(p, true);
    if (tag >>> 16) {
      const bytes = raw.subarray(p + 4, p + 4 + (tag >>> 16));
      p += 8;
      return { type: tag & 0xffff, bytes };
    }
    const n = v.getUint32(p + 4, true);
    const bytes = raw.subarray(p + 8, p + 8 + n);
    p += 8 + Math.ceil(n / 8) * 8;
    return { type: tag, bytes };
  };
  const flags = sub();
  if (flags.type !== 6 || flags.bytes.length !== 8) fail("array flags");
  // Class 6 is double: MATLAB stores whole numbers that fit as unsigned bytes.
  if ((flags.bytes[0]! & 0xff) !== 6 || flags.bytes[1]! & 0x08)
    fail("not a real double array");
  const dims = sub();
  if (dims.type !== 5 || dims.bytes.length !== 8) fail("not two-dimensional");
  const dv = new DataView(dims.bytes.buffer, dims.bytes.byteOffset, 8);
  const rows = dv.getInt32(0, true),
    cols = dv.getInt32(4, true);
  const name = new TextDecoder().decode(sub().bytes);
  const real = sub();
  if (real.type !== 2) fail("values are not stored as unsigned bytes");
  if (real.bytes.length !== rows * cols) fail("value count differs from the dimensions");
  if (p !== raw.length) fail("trailing data (an imaginary part?)");
  return { name, rows, cols, data: real.bytes };
}

interface FileMeta {
  filename: string;
  /** Absent for a file at the dataset's root. */
  folder_id?: string;
  content_details: { sha256_hash: string; size: number; download_url: string };
}

const retrievedAt = new Date().toISOString();
const dataset = await fetchJson(`${API}?version=1`);
const meta = dataset.json as {
  doi?: { id?: string };
  name?: string;
  publish_date?: string;
  description?: string;
  data_licence?: { short_name?: string; url?: string };
};
if (meta.doi?.id !== DATASET_DOI)
  throw new Error(`dataset DOI is ${String(meta.doi?.id)}`);
if (!(meta.description ?? "").includes(LABEL_TEXT))
  throw new Error(
    "the dataset no longer documents its labels as this reference reads them",
  );
if (meta.data_licence?.short_name !== "CC BY 4.0")
  throw new Error(
    `dataset licence is ${String(meta.data_licence?.short_name)}, not CC BY 4.0`,
  );
const folders = (await fetchJson(`${API}/folders/1?version=1`)).json as {
  id: string;
  name: string;
}[];
const folder = folders.find((f) => f.name === FOLDER);
if (!folder) throw new Error(`no ${FOLDER} folder`);
const listed = (await fetchJson(`${API}/files?folder_id=${folder.id}&version=1`))
  .json as FileMeta[];

/**
 * The constants of the authors' grooming model as their deposited code sets
 * them (`groomingmodel.m`, at the dataset's root): initial dust on head, abdomen
 * and wings and on each pair of legs, the dust-removal rate, and the gamma
 * distributions (shape, scale in frames) bout lengths are drawn from, per
 * ethogram label. Each is read with a pattern that must match exactly once.
 */
async function modelConstants() {
  const root = (await fetchJson(`${API}/files?folder_id=root&version=1`))
    .json as FileMeta[];
  const m = root.find((f) => f.filename === MODEL_FILE && f.folder_id === undefined);
  if (!m) throw new Error(`${MODEL_FILE} is not at the dataset's root`);
  const bytes = await fetchBytes(m.content_details.download_url, 100_000);
  if (sha256(bytes) !== m.content_details.sha256_hash)
    throw new Error(`${MODEL_FILE} does not hash to what Mendeley states`);
  const code = new TextDecoder().decode(bytes);
  const once = (re: RegExp, what: string): RegExpMatchArray => {
    const all = [...code.matchAll(new RegExp(re.source, "g"))];
    if (all.length !== 1)
      throw new Error(`${MODEL_FILE}: ${what} found ${all.length} times`);
    return all[0]!;
  };
  const num = "(\\d+(?:\\.\\d+)?)";
  const body = once(new RegExp(`d_body=\\[${num};${num};${num}\\];`), "d_body");
  const gamma = Object.fromEntries(
    [1, 2, 3, 4, 5].map((label) => {
      const g = once(
        new RegExp(`case ${label}\\s+boutlength=gamrnd\\(${num},${num}\\);`),
        `bout length of label ${label}`,
      );
      return [label, { shape: Number(g[1]), scaleFrames: Number(g[2]) }];
    }),
  );
  return {
    file: {
      name: MODEL_FILE,
      sha256: m.content_details.sha256_hash,
      bytes: bytes.length,
    },
    initialDust: {
      head: Number(body[1]),
      abdomen: Number(body[2]),
      wings: Number(body[3]),
      eachLegPair: Number(once(new RegExp(`d_leg=${num};`), "d_leg")[1]),
    },
    dustRemovalRate: Number(
      once(new RegExp(`dr_dustremoval=${num};`), "dr_dustremoval")[1],
    ),
    legRubRemovalFactor: Number(
      once(new RegExp(`-${num}\\*d_delta;`), "the leg-rub removal factor")[1],
    ),
    activitySdOverDust:
      1 / Number(once(new RegExp(`d_record\\(j,i\\)/${num}\\)`), "σ")[1]),
    /** The code takes the absolute value of each normal draw (`abs(normrnd(...))`). */
    activityAbsolute:
      once(/a_record\(j,i\)=abs\(normrnd\(/, "abs(normrnd(…))").length > 0,
    boutLengthGamma: gamma,
  };
}

const paperXml = new TextDecoder().decode(await fetchBytes(PAPER_XML, 5_000_000));
const paperText = plain(paperXml);
for (const [what, quote] of Object.entries(PAPER_QUOTES))
  if (!paperText.includes(plain(quote)))
    throw new Error(
      `the paper's text no longer says what this reference quotes (${what})`,
    );

const conditions: Record<string, unknown> = {};
for (const [condition, filename] of Object.entries(FILES)) {
  const m = listed.find((f) => f.filename === filename && f.folder_id === folder.id);
  if (!m) throw new Error(`${filename} is not in ${FOLDER}`);
  const expected = m.content_details.sha256_hash;
  if (!/^[0-9a-f]{64}$/.test(expected)) throw new Error(`${filename}: no SHA-256 stated`);
  const bytes = await fetchBytes(m.content_details.download_url, 5_000_000);
  if (bytes.length !== m.content_details.size || sha256(bytes) !== expected)
    throw new Error(`${filename} does not hash to what Mendeley states`);
  const mat = decodeMat(bytes);
  if (mat.cols !== FRAMES)
    throw new Error(`${filename}: ${mat.cols} frames, not ${FRAMES}`);
  if (mat.data.some((l) => l < 1 || l > 7))
    throw new Error(`${filename}: a label outside 1–7`);
  // Column-major: frame j of fly i is at i + j × rows.
  const flies = Array.from({ length: mat.rows }, (_, i) => {
    const f = new Uint8Array(mat.cols);
    for (let j = 0; j < mat.cols; j++) f[j] = mat.data[i + j * mat.rows]!;
    return f;
  });
  conditions[condition] = {
    file: { name: filename, sha256: expected, bytes: bytes.length, matrix: mat.name },
    flies: mat.rows,
    frames: mat.cols,
    summary: summarizeEthograms(flies, FRAME_HZ, INTERVAL_S),
  };
}

const reference = {
  schema: "fly-grooming-reference/v1",
  retrievedAt,
  importer: "scripts/import-fly-grooming.ts",
  dataset: {
    doi: DATASET_DOI,
    title: meta.name ?? null,
    published: meta.publish_date ?? null,
    api: `${API}?version=1`,
    sha256: sha256(dataset.body),
    folder: FOLDER,
  },
  paper: {
    short: "Zhang, Guo & Simpson 2020, Curr Biol 30:988",
    doi: "10.1016/j.cub.2020.01.045",
    pmcid: "PMC7184881",
    fullText: PAPER_XML,
    sha256: sha256(paperXml),
    /** Each found verbatim in the full text above when it was retrieved. */
    quotes: PAPER_QUOTES,
  },
  /**
   * The authors' model as their deposited code sets it. The paper's text
   * gives a dust-removal rate of 0.2% (`paper.quotes.removal`); the code sets
   * the value below.
   */
  model: await modelConstants(),
  licence: {
    name: "CC BY 4.0",
    url: meta.data_licence?.url ?? "http://creativecommons.org/licenses/by/4.0",
    attribution:
      "Zhang N, Guo L, Simpson JH. Spatial comparisons of mechanosensory information govern the grooming sequence in Drosophila. Mendeley Data, V1 (2020), doi:10.17632/fxz8dgywcd.1",
    changes:
      "Per-frame ethograms reduced to the summary statistics in this file by scripts/import-fly-grooming.ts; no per-frame data are kept.",
  },
  paradigm:
    "Canton S males, 4–7 days old, shaken 10 times in a dusting chamber with Reactive Yellow 86 dust or, as the undusted control, in chambers without dust, then filmed alone at 30 Hz for 50 000 frames (27.78 min) at 21–23 °C; frames labelled by the Automatic Behavior Recognition System classifier (Zhang, Guo & Simpson 2020, STAR Methods).",
  frameHz: FRAME_HZ,
  labels: ETHOGRAM_LABELS,
  groups: {
    grooming: GROOMING_LABELS,
    anterior: ANTERIOR_LABELS,
    posterior: POSTERIOR_LABELS,
  },
  method:
    "Reduced by src/bethesda/fly/calibration/ethogram.ts, as the calibration reduces simulated flies: fractions per fly, then across flies (mean, SD with n − 1, quartiles); episodes are maximal runs of grooming labels (1–5), motifs maximal runs of anterior (1–2) or posterior (3–5) labels, actions maximal runs of one label, and transitions the shares of successive actions within an episode that stay in the anterior or the posterior motif; runs touching the start or end of a recording are left out of durations; quantiles interpolate linearly between order statistics; intervals are successive 150 s windows from the first frame, the last, partial one left out. No run is filtered by length and no label is changed.",
  conditions,
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT + ".tmp", JSON.stringify(reference, null, 2) + "\n");
renameSync(OUT + ".tmp", OUT);
console.log(
  `imported grooming reference: ${Object.entries(conditions)
    .map(([c, v]) => `${c} ${(v as { flies: number }).flies} flies`)
    .join(", ")}, retrieved ${retrievedAt}`,
);
