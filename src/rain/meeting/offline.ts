/**
 * The offline research meeting: four perspectives, no model, verbatim evidence.
 *
 * A port of R.A.I.N.'s `launcher/offline_meeting.py` (james_library, MIT),
 * kept deterministic and faithful: the DEMO recording made by the Python
 * engine is reproduced by this one byte for byte, and the test suite checks
 * that. What it does:
 *
 * - Sentences are extracted from the citation corpus and ranked against the
 *   question with BM25. Nothing is paraphrased: every quote is a verbatim
 *   span of a corpus document.
 * - Each perspective chooses evidence through its own lens (measured results,
 *   buildability, cross-paper structure, stated limitations).
 * - Every quote is re-verified with the same verifier the model meeting uses,
 *   and the corpus is fingerprinted.
 * - When the library does not cover the question, the room says so instead
 *   of presenting unrelated passages as evidence.
 *
 * The reasoning text is scripted; the meeting says so, and the evidence is
 * real. The Python engine's string semantics (whitespace, line breaks,
 * rounding, word characters) are reproduced through `../text.ts`.
 *
 * Shared with the server: imports siblings as `./x.js`, nothing else.
 */
import {
  corpusFingerprint,
  documentMap,
  findQuoteSpan,
  hashCorpusDocuments,
  verifyQuote,
  type CorpusDocument,
} from "../corpus.js";
import { sha256 } from "../sha256.js";
import {
  PY_SPACE_CLASS,
  WB_AFTER,
  WB_BEFORE,
  countBefore,
  isAlpha,
  isUpper,
  lstripChars,
  pyRound,
  pySplit,
  pySplitlines,
  pyStrip,
} from "../text.js";
import { OFFLINE_ROLES, type Perspective } from "./perspectives.js";

export const DEFAULT_QUESTION =
  "Can resonance patterns reveal what drives a complex adaptive system?";
export { OFFLINE_ENGINE } from "../protocol.js";

const MIN_QUOTE_WORDS = 12;
const MAX_QUOTE_WORDS = 42;
const CANDIDATE_POOL = 60;
const EVIDENCE_WINDOW = 12;

export type Grounding = "strong" | "partial" | "none";
export const AGENT_ROLES = OFFLINE_ROLES;

const STOPWORDS = new Set(
  `a about above across actually after again against all also an and any are as at be because been
  before being between both but by can could did do does doing done during each either else even
  ever every few for from further had has have having how however i if in into is it its itself never always
  know tell think
  just like made make many may me might more most much must my need no nor not now of off often on
  once only or other our out over own per rather really same say says should so some such than that
  the their them then there these they this those through thus to too under until up upon us very
  via was we were what when where whether which while who whom why will with within without would
  yet you your`.split(/\s+/),
);
// Words too generic to count as a shared structure between two papers.
const GENERIC_TERMS = new Set(
  `paper work result method approach section figure table use used using provide show base based
  present new one two first second claim system model framework general specific different example
  case given single multiple various several overall important key main potential possible simple high
  low large small level form type part point way set number term order direct further`.split(
    /\s+/,
  ),
);
const SUFFIXES =
  "ational ization ations ation ities ity ness ments ment ingly ing edly ed ies es ly s".split(
    " ",
  );

const SP = PY_SPACE_CLASS;
/** Python's `[^\W\d_][^\W_]*(?:-[^\W_]+)*` with Unicode word characters. */
const WORD_RE = /[\p{L}\p{Nl}\p{No}][\p{L}\p{N}]*(?:-[\p{L}\p{N}]+)*/gu;
const SENTENCE_END_RE = new RegExp(`[.!?]["”’)]?[${SP}]+(?=["“(]?[A-Z])`, "gu");
const ENUMERATED_HEADING_RE = new RegExp(
  `^(?:#{1,6}[${SP}]*)?(?:[IVXLC]+|[A-Z]|\\p{Nd}+(?:\\.\\p{Nd}+)*)[.)][${SP}]+[^${SP}]`,
  "u",
);
const BARE_ENUMERATOR_RE = /^(?:[IVXLC]+|[A-Z]|\p{Nd}+(?:\.\p{Nd}+)*)[.)]?$/u;
const REFERENCES_RE = new RegExp(
  `^[${SP}]*(?:#{1,6}[${SP}]*)?(?:[IVXLC]+\\.[${SP}]*)?(?:references|bibliography)[${SP}]*$`,
  "gimu",
);
const ABSTRACT_RE = new RegExp(`${WB_BEFORE}abstract${WB_AFTER}`, "iu");
const ABSTRACT_PREFIX_RE = new RegExp(`^abstract[${SP}]*[—–\\-:.]*[${SP}]*`, "iu");
const ABBREVIATIONS = new Set(
  "e.g. i.e. fig. eq. al. vs. u.s. dr. no. approx. cf. etc.".split(" "),
);
const ABBREVIATION_LETTERS_RE = /^(?:[a-z]\.)+$/u;
const REJECT_PATTERNS: RegExp[] = [
  /[a-z]- [a-z]/u, // PDF hyphenation break
  new RegExp(`${WB_BEFORE}[A-Z]{6,}${WB_AFTER}`, "u"), // shouted heading glued to a sentence
  /[#•@|<>{}=]/u,
  /https?:|www\./u,
  new RegExp(`\\.[${SP}]\\p{Nd}+(?:\\.\\p{Nd}+)*[${SP}][A-Z]`, "u"), // numbered heading inside the sentence
  new RegExp(`[${SP}]\\p{Nd}+\\.$`, "u"), // trailing list or claim number
  new RegExp(`${WB_BEFORE}et al${WB_AFTER}`, "u"),
  new RegExp(`${WB_BEFORE}pp\\.`, "u"),
  /\[\p{Nd}/u,
  new RegExp(`${WB_BEFORE}Page \\p{Nd}+${WB_AFTER}`, "u"),
  /Index Terms/u,
  /---/u,
  /[´¨ˆ˜]/u, // detached accents from PDF extraction
  /[Ͱ-Ͽ][a-z]/u, // Greek symbol with a flattened subscript, e.g. "ωloc"
  new RegExp(`${WB_BEFORE}(?:Eqs?|Fig|Figs|Table)\\.?[${SP}]*\\(?\\p{Nd}`, "u"), // cross-references read badly out of context
];
const TOKEN_RE = /^["“(]?[A-Za-z][A-Za-z'’-]*[.,;:)"”’]*$/u;
const NUMERIC_TOKEN_RE = /^[([]?[$€£]?\p{Nd}+(?:[.,/:]\p{Nd}+)*(?:%|x)?[)\]]?[.,;:]?$/u;
const NUMBER_RE = /(?<![\p{L}\p{N}_.])\p{Nd}+(?:[.,]\p{Nd}+)?(?![\p{L}\p{N}_.]*\p{Nd})/gu;
const YEAR_RE = /^(?:18|19|20)\p{Nd}\p{Nd}$/u;
const MINOR_WORDS = new Set("a an and as at by for in of on or the to via vs".split(" "));
const ANAPHORIC_OPENERS = new Set(
  "this that these those it they such here there".split(" "),
);

// Lens lexicons are matched against stemmed terms by prefix.
const RESULT_STEMS =
  "detect measur yield demonstrat observ reproduc improv recover achiev record extend increas reduc exceed estimat".split(
    " ",
  );
const BUILD_STEMS =
  "hardware device sensor actuat power energy thermal heat temperatur material fabricat implement prototyp circuit voltage noise latenc cost calibrat instrument apparatus laser magnet coil cool microcontroller electrode toleranc precision hz khz mhz ghz watt".split(
    " ",
  );
const MEASURE_STEMS =
  "measur data sample estimat metric instrument benchmark observ record signal detect monitor diagnost calibrat indicator stress".split(
    " ",
  );
const SHAPE_STEMS =
  "geometr topolog field phase spectr coheren symmetr manifold pattern wave mode modal structur lattice spiral interferen resonan curvatur holograph attractor oscillat gradient node frequenc".split(
    " ",
  );
const TEST_STEMS =
  "predict test experiment benchmark falsif validat replicat control comparator".split(
    " ",
  );
const WEAK_TEST_STEMS = "measur protocol reproduc audit compar".split(" ");
const HEDGES: [string, number][] = [
  ["does not establish", 3.0],
  ["cannot, by itself", 3.0],
  ["cannot by itself", 3.0],
  ["not constitut", 3.0],
  ["independent validation", 3.0],
  ["requires independent", 3.0],
  ["no direct causal", 3.0],
  ["not a proof", 3.0],
  ["does not validate", 3.0],
  ["does not prove", 3.0],
  ["unmeasured", 3.0],
  ["not established", 3.0],
  ["to be tested", 2.0],
  ["untested", 3.0],
  ["limitation", 1.5],
  ["counterexample", 2.5],
  ["does not", 2.0],
  ["cannot", 2.0],
  ["not yet", 2.0],
  ["unverified", 2.0],
  ["speculative", 2.0],
  ["assum", 1.5],
  ["hypothe", 1.5],
  ["uncertain", 1.5],
  ["caveat", 1.5],
  ["preliminary", 1.5],
  ["only if", 1.5],
  ["despite", 1.0],
  ["however", 1.0],
  ["although", 1.0],
  ["rather than", 0.5],
];
const STRONG_HEDGE = 3.0;
const COUNTER_HEDGE = 2.0;

// Constraint families Jasmine needs before she calls something buildable (hardware topics)
// or measurable (everything else).
const HARDWARE_CONSTRAINTS: [string, string[]][] = [
  ["a power budget", ["power", "energy", "watt", "joule"]],
  ["a cost", ["cost", "price", "afford"]],
  ["a tolerance", ["toleranc", "precision", "accuracy"]],
  ["a noise floor", ["noise", "snr", "signal-to-noise"]],
  ["a thermal limit", ["thermal", "heat", "temperatur", "cooling"]],
];
const MEASUREMENT_CONSTRAINTS: [string, string[]][] = [
  [
    "an error bar",
    ["error bar", "uncertaint", "confidence interval", "standard deviation", "±"],
  ],
  ["a baseline", ["baseline", "comparator", "control group", "null model"]],
  ["a sample size", ["sample size", "sample of", "observations", "trials", "n ="]],
];
const HARDWARE_STEMS =
  "hardware device sensor actuat power energy thermal heat temperatur voltage circuit magnet laser coil electrode fabricat prototyp material plasma piezo transducer hz khz mhz ghz watt".split(
    " ",
  );

/** One verbatim sentence from a corpus document. */
export interface Passage {
  source: string;
  title: string;
  text: string;
  line: number;
  spanStart: number;
  spanEnd: number;
}
export const citationOf = (p: Passage) => `${p.source}:${p.line}`;

/** One perspective's contribution: a lead-in, optional verbatim quotes, and a coda. */
export interface Turn {
  speaker: Perspective;
  role: string;
  move: string;
  lead: string;
  quotes: Passage[];
  coda: string;
}
export interface Verdict {
  agreed: string;
  contested: string;
  nextMove: string;
  readNext: string[];
}
export interface CitationAudit {
  checked: number;
  verified: number;
  corpusFiles: number;
  corpusSha256: string;
}
export interface OfflineMeeting {
  question: string;
  corpusFiles: number;
  quotablePassages: number;
  grounding: Grounding;
  matchedTerms: string[];
  missingTerms: string[];
  turns: Turn[];
  verdict: Verdict;
  audit: CitationAudit;
  suggestions: string[];
}
export const quotesOf = (m: OfflineMeeting) => m.turns.flatMap((t) => t.quotes);

interface Sentence {
  source: string;
  title: string;
  text: string;
  terms: string[];
}
export interface LoadedCorpus {
  documents: Map<string, string>;
  sentences: Sentence[];
  postings: Map<string, number[]>;
  idf: Map<string, number>;
  averageLength: number;
  surface: Map<string, string>;
  files: CorpusDocument[];
}
interface Scored {
  index: number;
  relevance: number;
}

// ---------------------------------------------------------------------------
// Text processing
// ---------------------------------------------------------------------------

/** A deliberately small suffix stripper: enough to match "patterns" to "pattern", nothing clever. */
export function stem(word: string): string {
  for (const suffix of SUFFIXES) {
    if (word.length > suffix.length + 3 && word.endsWith(suffix)) {
      const s = word.slice(0, -suffix.length);
      if (suffix === "ies") return s + "y";
      if (
        (suffix === "ed" || suffix === "ing") &&
        s.length > 3 &&
        s[s.length - 1] === s[s.length - 2] &&
        !"lsz".includes(s[s.length - 1]!)
      )
        return s.slice(0, -1); // "lagged" -> "lag", "mapping" -> "map"
      return s;
    }
  }
  return word;
}

/** Lowercase words; a hyphenated compound also contributes its parts ("lead-lag" -> "lead", "lag"). */
function words(text: string): string[] {
  const out: string[] = [];
  for (const match of text.toLowerCase().matchAll(WORD_RE)) {
    const word = match[0];
    out.push(word);
    if (word.includes("-")) out.push(...word.split("-").filter((part) => part));
  }
  return out.filter((word) => word.length > 2 && !STOPWORDS.has(word));
}
const terms = (text: string) => words(text).map(stem);

function isHeading(line: string): boolean {
  let stripped = pyStrip(line);
  if (!stripped) return false;
  if (stripped.startsWith("#")) {
    // Markdown headings, but also PDF-to-markdown debris like "# This paper formalizes...".
    stripped = pyStrip(lstripChars(stripped, "#"));
    if (!stripped) return true;
  }
  if (BARE_ENUMERATOR_RE.test(stripped)) return true;
  const ws = pySplit(stripped);
  if (ws.length > 9 || ".,;:!?".includes(stripped[stripped.length - 1]!)) return false;
  if (ENUMERATED_HEADING_RE.test(stripped)) return true;
  const alpha = ws.filter((word) => isAlpha(word.slice(0, 1)));
  if (!alpha.length) return true;
  const capitalized = alpha.filter(
    (word) => isUpper(word[0]!) || MINOR_WORDS.has(word.toLowerCase()),
  ).length;
  return capitalized === alpha.length && isUpper(alpha[0]![0]!);
}

/** Drop the byline block before the abstract and the reference list at the end. */
function bodyText(content: string): string {
  let body = content;
  let lastReference: RegExpExecArray | null = null;
  for (const match of body.matchAll(REFERENCES_RE)) lastReference = match;
  if (lastReference !== null && lastReference.index > body.length * 0.4)
    body = body.slice(0, lastReference.index);
  const abstract = ABSTRACT_RE.exec(body.slice(0, 4000));
  if (abstract !== null) body = body.slice(abstract.index);
  return body;
}

/** Join wrapped lines into paragraphs; blank lines and headings end a paragraph. */
function blocks(body: string): string[] {
  const out: string[] = [];
  let current: string[] = [];
  for (const line of pySplitlines(body)) {
    if (!pyStrip(line) || isHeading(line)) {
      if (current.length) {
        out.push(pySplit(current.join(" ")).join(" "));
        current = [];
      }
      continue;
    }
    current.push(pyStrip(lstripChars(pyStrip(line), "#")));
  }
  if (current.length) out.push(pySplit(current.join(" ")).join(" "));
  return out;
}

function splitSentences(block: string): string[] {
  const sentences: string[] = [];
  let start = 0;
  for (const match of block.matchAll(SENTENCE_END_RE)) {
    let end = match.index + 1;
    while (end < block.length && '"”’)'.includes(block[end]!)) end++;
    const candidate = block.slice(start, end);
    const lastSpace = candidate.lastIndexOf(" ");
    const lastToken = (
      lastSpace >= 0 ? candidate.slice(lastSpace + 1) : candidate
    ).toLowerCase();
    if (ABBREVIATIONS.has(lastToken) || ABBREVIATION_LETTERS_RE.test(lastToken)) continue;
    sentences.push(pyStrip(candidate));
    start = match.index + match[0].length;
  }
  const tail = pyStrip(block.slice(start));
  if (tail) sentences.push(tail);
  return sentences;
}

const countChar = (text: string, ch: string) => countBefore(text, ch, text.length);

function isQuotable(sentence: string): boolean {
  const ws = pySplit(sentence);
  if (!(MIN_QUOTE_WORDS <= ws.length && ws.length <= MAX_QUOTE_WORDS)) return false;
  if (!isUpper(sentence[0]!) || !".!?".includes(sentence[sentence.length - 1]!))
    return false;
  if (countChar(sentence, "(") !== countChar(sentence, ")")) return false;
  if (REJECT_PATTERNS.some((pattern) => pattern.test(sentence))) return false;
  // Numbers are welcome (they are James's favourite evidence); stray math symbols are not.
  const wordlike = ws.filter((w) => TOKEN_RE.test(w) || NUMERIC_TOKEN_RE.test(w)).length;
  return wordlike / ws.length >= 0.85;
}

/** `Counter.most_common(1)`: the first key to reach the highest count. */
function mostCommon<K>(counts: Map<K, number>): [K, number] {
  let best: [K, number] | null = null;
  for (const entry of counts) if (best === null || entry[1] > best[1]) best = entry;
  if (best === null) throw new Error("mostCommon of an empty counter");
  return best;
}
const stemOf = (path: string) => {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
};

/** Index the corpus: every quotable sentence, its terms, BM25 postings and the surface form of each stem. */
export function loadCorpus(files: readonly CorpusDocument[]): LoadedCorpus {
  const documents = new Map<string, string>();
  const sentences: Sentence[] = [];
  const seen = new Set<string>();
  const surfaceCounts = new Map<string, Map<string, number>>();
  for (const file of files) {
    const content = file.text;
    documents.set(file.path, content);
    const title = stemOf(file.path);
    for (const block of blocks(bodyText(content)))
      for (const raw of splitSentences(block)) {
        const text = raw.replace(ABSTRACT_PREFIX_RE, "");
        const key = text.toLowerCase();
        if (seen.has(key) || !isQuotable(text)) continue;
        seen.add(key);
        for (const word of words(text)) {
          const s = stem(word);
          let counts = surfaceCounts.get(s);
          if (!counts) surfaceCounts.set(s, (counts = new Map()));
          counts.set(word, (counts.get(word) ?? 0) + 1);
        }
        sentences.push({ source: file.path, title, text, terms: terms(text) });
      }
  }
  const postings = new Map<string, number[]>();
  sentences.forEach((sentence, index) => {
    for (const term of new Set(sentence.terms)) {
      let list = postings.get(term);
      if (!list) postings.set(term, (list = []));
      list.push(index);
    }
  });
  const total = sentences.length;
  const idf = new Map<string, number>();
  for (const [term, hits] of postings)
    idf.set(term, Math.log(1 + (total - hits.length + 0.5) / (hits.length + 0.5)));
  const averageLength = total
    ? sentences.reduce((sum, s) => sum + s.terms.length, 0) / total
    : 0.0;
  const surface = new Map<string, string>();
  for (const [s, counts] of surfaceCounts) surface.set(s, mostCommon(counts)[0]);
  return {
    documents,
    sentences,
    postings,
    idf,
    averageLength,
    surface,
    files: [...files],
  };
}

// ---------------------------------------------------------------------------
// Retrieval and lenses
// ---------------------------------------------------------------------------

/** Fraction of the question's terms that each paper uses anywhere in its quotable text. */
function paperCoverage(
  corpus: LoadedCorpus,
  query: readonly string[],
): Map<string, number> {
  const unique = new Set(query);
  const titleTerms = new Map<string, Set<string>>();
  for (const sentence of corpus.sentences) {
    let set = titleTerms.get(sentence.title);
    if (!set) titleTerms.set(sentence.title, (set = new Set()));
    for (const t of sentence.terms) set.add(t);
  }
  const out = new Map<string, number>();
  for (const [title, set] of titleTerms)
    out.set(
      title,
      unique.size ? [...unique].filter((t) => set.has(t)).length / unique.size : 0.0,
    );
  return out;
}

/** BM25 over sentences, nudged toward papers that cover more of the question. */
function rank(corpus: LoadedCorpus, query: readonly string[]): Scored[] {
  const unique = [...new Set(query)].sort();
  if (!unique.length || !corpus.sentences.length) return [];
  const coverage = paperCoverage(corpus, unique);
  const k1 = 1.4,
    b = 0.75;
  const scores = new Map<number, number>();
  const matches = new Map<number, number>();
  for (const term of unique)
    for (const index of corpus.postings.get(term) ?? []) {
      const sentenceTerms = corpus.sentences[index]!.terms;
      const frequency = sentenceTerms.filter((t) => t === term).length;
      const norm = k1 * (1 - b + (b * sentenceTerms.length) / corpus.averageLength);
      scores.set(
        index,
        (scores.get(index) ?? 0.0) +
          (corpus.idf.get(term)! * frequency * (k1 + 1)) / (frequency + norm),
      );
      matches.set(index, (matches.get(index) ?? 0) + 1);
    }
  const ranked: Scored[] = [];
  for (const [index, score] of scores) {
    const sentence = corpus.sentences[index]!;
    let weight = 0.6 + coverage.get(sentence.title)!;
    if (ANAPHORIC_OPENERS.has(sentence.text.split(" ")[0]!.toLowerCase())) weight *= 0.7;
    ranked.push({ index, relevance: score * weight });
  }
  if (!ranked.length) return [];
  ranked.sort((x, y) => y.relevance - x.relevance || x.index - y.index);
  // One incidental shared word ("system", "drives") is not relevance. For multi-term
  // questions a passage must match two terms unless it scores close to the best hit.
  const needed = unique.length >= 3 ? 2 : 1;
  const floor = ranked[0]!.relevance * 0.5;
  const kept = ranked.filter(
    (item) => matches.get(item.index)! >= needed || item.relevance >= floor,
  );
  return kept.slice(0, CANDIDATE_POOL);
}

const startsWithAny = (term: string, stems: readonly string[]) =>
  stems.some((s) => term.startsWith(s));
const stemHits = (sentenceTerms: readonly string[], stems: readonly string[]) =>
  [...new Set(sentenceTerms)].filter((t) => startsWithAny(t, stems)).length;
const hasNumber = (text: string) =>
  [...text.matchAll(NUMBER_RE)].some((m) => !YEAR_RE.test(m[0]));
function hedgeScore(text: string): number {
  const lowered = text.toLowerCase();
  let total = 0.0;
  for (const [phrase, weight] of HEDGES) if (lowered.includes(phrase)) total += weight;
  return Math.min(5.0, total);
}
/** How directly a sentence proposes something that could fail. Zero unless a strong test word appears. */
function testScore(sentence: Sentence): number {
  const strong = stemHits(sentence.terms, TEST_STEMS);
  return strong ? 2.0 * strong + stemHits(sentence.terms, WEAK_TEST_STEMS) : 0.0;
}
const buildScore = (sentence: Sentence) => stemHits(sentence.terms, BUILD_STEMS);
const measureScore = (sentence: Sentence) =>
  stemHits(sentence.terms, MEASURE_STEMS) + (hasNumber(sentence.text) ? 2.0 : 0.0);
const quantScore = (sentence: Sentence) =>
  (hasNumber(sentence.text) ? 2.0 : 0.0) +
  Math.min(2, stemHits(sentence.terms, RESULT_STEMS));

/**
 * Best candidate under `lens`, preferring papers no one has cited yet.
 * `minRelevance` is relative to the best hit: a lens may reorder relevant
 * passages, but it must not promote an off-topic one.
 */
function pick(
  pool: readonly Scored[],
  corpus: LoadedCorpus,
  used: ReadonlySet<number>,
  lens: (s: Sentence) => number | null,
  options: {
    lensWeight?: number;
    minLens?: number | null;
    citedSources?: ReadonlySet<string> | null;
    minRelevance?: number;
  } = {},
): Scored | null {
  const lensWeight = options.lensWeight ?? 0.5;
  const minLens = options.minLens ?? null;
  const cited = options.citedSources ?? null;
  const minRelevance = options.minRelevance ?? 0.3;
  if (!pool.length) return null;
  const top = pool[0]!.relevance || 1.0;
  let best: [number, number] | null = null;
  let choice: Scored | null = null;
  for (const candidate of pool) {
    if (used.has(candidate.index) || candidate.relevance < minRelevance * top) continue;
    const sentence = corpus.sentences[candidate.index]!;
    const lensValue = lens(sentence);
    if (lensValue === null || (minLens !== null && lensValue < minLens)) continue;
    let score = (candidate.relevance / top) * (1 + lensWeight * lensValue);
    if (cited && cited.size && cited.has(sentence.source)) score *= 0.8;
    const key: [number, number] = [score, -candidate.index];
    if (best === null || key[0] > best[0] || (key[0] === best[0] && key[1] > best[1])) {
      best = key;
      choice = candidate;
    }
  }
  return choice;
}

function passage(corpus: LoadedCorpus, index: number): Passage {
  const sentence = corpus.sentences[index]!;
  const content = corpus.documents.get(sentence.source)!;
  const span = findQuoteSpan(content, sentence.text);
  if (span === null)
    throw new Error(`extracted sentence is not verbatim in ${sentence.source}`);
  return {
    source: sentence.source,
    title: sentence.title,
    text: sentence.text,
    line: countBefore(content, "\n", span[0]) + 1,
    spanStart: span[0],
    spanEnd: span[1],
  };
}

/** The word in `text` that stems to `stem`, so the quoted term appears in the quote. */
function surfaceIn(text: string, s: string): string {
  for (const word of words(text)) if (stem(word) === s) return word;
  return "";
}

/**
 * Two relevant passages from different papers that share structure beyond the question's words.
 * A pair qualifies when it shares a geometric/structural term (Luca's lens) or at least two
 * other distinctive terms. One incidental shared word is a coincidence, not a connection.
 */
function bridge(
  corpus: LoadedCorpus,
  pool: readonly Scored[],
  used: ReadonlySet<number>,
  query: ReadonlySet<string>,
): [Scored, Scored, string] | null {
  const top = pool[0]!.relevance || 1.0;
  const candidates = pool
    .slice(0, 24)
    .filter((item) => !used.has(item.index) && item.relevance >= 0.3 * top);
  if (!candidates.length) return null;
  const maxIdf = Math.max(...corpus.idf.values()) || 1.0;
  let best: [number, number, number] | null = null;
  let result: [Scored, Scored, string] | null = null;
  candidates.forEach((first, position) => {
    const firstSentence = corpus.sentences[first.index]!;
    const firstTerms = new Set(firstSentence.terms);
    for (const second of candidates.slice(position + 1)) {
      const secondSentence = corpus.sentences[second.index]!;
      if (secondSentence.title === firstSentence.title) continue;
      const shared = [...new Set(secondSentence.terms)].filter(
        (t) =>
          firstTerms.has(t) && !query.has(t) && !GENERIC_TERMS.has(t) && t.length > 3,
      );
      if (!shared.some((t) => startsWithAny(t, SHAPE_STEMS)) && shared.length < 2)
        continue;
      // Prefer rare terms, and geometric vocabulary when rarity ties: that is Luca's lens.
      const keyOf = (t: string): [number, string] => [
        corpus.idf.get(t)! + 0.5 * (startsWithAny(t, SHAPE_STEMS) ? 1 : 0),
        t,
      ];
      let term = shared[0]!;
      let termKey = keyOf(term);
      for (const t of shared.slice(1)) {
        const k = keyOf(t);
        if (k[0] > termKey[0] || (k[0] === termKey[0] && k[1] > termKey[1])) {
          term = t;
          termKey = k;
        }
      }
      const score =
        first.relevance / top + second.relevance / top + corpus.idf.get(term)! / maxIdf;
      const key: [number, number, number] = [score, -first.index, -second.index];
      if (
        best === null ||
        key[0] > best[0] ||
        (key[0] === best[0] &&
          (key[1] > best[1] || (key[1] === best[1] && key[2] > best[2])))
      ) {
        best = key;
        result = [
          first,
          second,
          surfaceIn(firstSentence.text, term) || corpus.surface.get(term) || term,
        ];
      }
    }
  });
  return result;
}

/** True when hardware vocabulary runs through the evidence, not just one stray sentence. */
function isHardwareTopic(passages: readonly Sentence[]): boolean {
  const hardware = passages.filter((s) => stemHits(s.terms, HARDWARE_STEMS) > 0).length;
  return hardware >= Math.max(3, Math.floor(passages.length / 3));
}

function missingConstraints(passages: readonly Sentence[], hardware: boolean): string[] {
  const stems = new Set(passages.flatMap((s) => s.terms));
  const lowered = passages.map((s) => s.text.toLowerCase()).join(" ");
  const missing: string[] = [];
  for (const [label, markers] of hardware
    ? HARDWARE_CONSTRAINTS
    : MEASUREMENT_CONSTRAINTS) {
    const present =
      [...stems].some((t) => startsWithAny(t, markers)) ||
      markers.some((marker) => lowered.includes(marker));
    if (!present) missing.push(label);
  }
  return missing;
}

function variant(key: string, options: readonly string[]): string {
  const first = parseInt(sha256(key).slice(0, 2), 16);
  return options[first % options.length]!;
}
function join(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return items.slice(0, -1).join(", ") + ` and ${items[items.length - 1]}`;
}
const quotedTerms = (items: readonly string[]) => join(items.map((item) => `'${item}'`));

// ---------------------------------------------------------------------------
// Meeting assembly
// ---------------------------------------------------------------------------

function questionTerms(question: string): {
  stems: string[];
  surfaces: Map<string, string>;
} {
  const surfaces = new Map<string, string>();
  const stems: string[] = [];
  for (const word of words(question)) {
    const s = stem(word);
    if (!surfaces.has(s)) {
      surfaces.set(s, word);
      stems.push(s);
    }
  }
  return { stems, surfaces };
}

function grounding(
  corpus: LoadedCorpus,
  pool: readonly Scored[],
  query: readonly string[],
): [Grounding, string[], string[]] {
  const window = pool
    .slice(0, EVIDENCE_WINDOW)
    .map((item) => corpus.sentences[item.index]!);
  const seen = new Set(window.flatMap((s) => s.terms));
  const matched = query.filter((t) => seen.has(t));
  const missing = query.filter((t) => !seen.has(t));
  const coverage = query.length ? matched.length / query.length : 0.0;
  if (pool.length >= 3 && coverage >= 0.6) return ["strong", matched, missing];
  if (pool.length >= 2 && coverage >= 0.34) return ["partial", matched, missing];
  return ["none", matched, missing];
}

const fingerprint = (corpus: LoadedCorpus) =>
  corpusFingerprint(corpus.files.length ? hashCorpusDocuments(corpus.files) : []);

function audit(corpus: LoadedCorpus, turns: readonly Turn[]): CitationAudit {
  const quotes = turns.flatMap((t) => t.quotes);
  let verified = 0;
  for (const quote of quotes) {
    const match = verifyQuote(corpus.documents, quote.text);
    if (match !== null && match.source === quote.source) verified++;
  }
  return {
    checked: quotes.length,
    verified,
    corpusFiles: corpus.documents.size,
    corpusSha256: fingerprint(corpus),
  };
}

/**
 * Questions the library can actually answer, one per best-covered paper.
 * Each question uses the title words that are specific to that paper ("sovereign debt", not
 * "resonant dynamics"), so asking it retrieves that paper rather than its neighbours.
 */
function suggestQuestions(corpus: LoadedCorpus): string[] {
  const counts = new Map<string, number>();
  for (const s of corpus.sentences) counts.set(s.title, (counts.get(s.title) ?? 0) + 1);
  const titles = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, 3)
    .map(([title]) => title);
  const questions: string[] = [];
  for (const title of titles) {
    const specific: string[] = [];
    for (const word of words(title)) {
      const hits = corpus.postings.get(stem(word)) ?? [];
      const own = hits.filter((index) => corpus.sentences[index]!.title === title).length;
      if (hits.length && own / hits.length >= 0.6) specific.push(word);
    }
    questions.push(`What do we really know about ${specific.join(" ") || title}?`);
  }
  return questions;
}

/** The built-in question when the library covers it, otherwise one the library can answer. */
function defaultQuestion(corpus: LoadedCorpus): string {
  const { stems: query } = questionTerms(DEFAULT_QUESTION);
  const [g] = grounding(corpus, rank(corpus, query), query);
  if (g === "strong" || !corpus.sentences.length) return DEFAULT_QUESTION;
  return suggestQuestions(corpus)[0]!;
}

/**
 * Run the four-perspective meeting over the corpus without a model.
 * With no question, the meeting uses `DEFAULT_QUESTION` when the library covers it and
 * otherwise a question drawn from the library itself, so a first run always has evidence.
 */
export function buildOfflineMeeting(
  question: string | null,
  documents: readonly CorpusDocument[],
  loaded?: LoadedCorpus,
): OfflineMeeting {
  const corpus = loaded ?? loadCorpus(documents);
  const q = pySplit(question ?? "").join(" ") || defaultQuestion(corpus);
  const { stems: query, surfaces } = questionTerms(q);
  const pool = rank(corpus, query);
  const [g, matched, missing] = grounding(corpus, pool, query);
  const matchedWords = matched.map((t) => surfaces.get(t)!);
  const missingWords = missing.map((t) => surfaces.get(t)!);
  if (g === "none") {
    const turns = ungroundedTurns(corpus, query, surfaces);
    return {
      question: q,
      corpusFiles: corpus.documents.size,
      quotablePassages: corpus.sentences.length,
      grounding: g,
      matchedTerms: matchedWords,
      missingTerms: missingWords,
      turns,
      verdict: {
        agreed:
          "The local library has no evidence on this question, so the room made no claims about it.",
        contested: "Nothing yet. A disagreement needs evidence on the table first.",
        nextMove:
          "Add two or three papers on this topic to the library and rerun the same command, or connect a local model for an open-ended meeting.",
        readNext: [],
      },
      audit: audit(corpus, turns),
      suggestions: corpus.sentences.length ? suggestQuestions(corpus) : [],
    };
  }
  const [turns, verdict] = groundedTurns(
    corpus,
    q,
    pool,
    query,
    g,
    matchedWords,
    missingWords,
  );
  return {
    question: q,
    corpusFiles: corpus.documents.size,
    quotablePassages: corpus.sentences.length,
    grounding: g,
    matchedTerms: matchedWords,
    missingTerms: missingWords,
    turns,
    verdict,
    audit: audit(corpus, turns),
    suggestions: [],
  };
}

/** What each perspective chose to put on the table, plus the retrieval context. */
interface Evidence {
  question: string;
  grounding: Grounding;
  matched: string[];
  missing: string[];
  windowPapers: string[];
  windowSources: Map<string, number>;
  hardware: boolean;
  gaps: string[];
  anchor: Passage | null;
  build: Passage | null;
  bridge: [Passage, Passage] | null;
  bridgeTerm: string;
  counter: Passage | null;
  test: Passage | null;
}

/** Share of the shorter sentence's terms that the other one repeats. */
function overlap(first: ReadonlySet<string>, second: ReadonlySet<string>): number {
  if (!first.size || !second.size) return 0.0;
  return (
    [...first].filter((t) => second.has(t)).length / Math.min(first.size, second.size)
  );
}

function selectEvidence(
  corpus: LoadedCorpus,
  question: string,
  pool: readonly Scored[],
  query: readonly string[],
  g: Grounding,
  matched: string[],
  missing: string[],
): Evidence {
  const used = new Set<number>();
  const taken = new Set<number>();
  const cited = new Set<string>();
  const take = (choice: Scored | null): Passage | null => {
    if (choice === null) return null;
    const p = passage(corpus, choice.index);
    taken.add(choice.index);
    cited.add(p.source);
    // Retire near-duplicates too, so two agents never read out the same sentence twice.
    const chosenTerms = new Set(corpus.sentences[choice.index]!.terms);
    for (const item of pool)
      if (
        item.index === choice.index ||
        overlap(chosenTerms, new Set(corpus.sentences[item.index]!.terms)) >= 0.55
      )
        used.add(item.index);
    used.add(choice.index);
    return p;
  };

  // Caveats are Elena's material: no one else may spend a hedged sentence as supporting evidence.
  const top = pool[0]!.relevance || 1.0;
  const hedged = new Set(
    pool
      .filter((item) => hedgeScore(corpus.sentences[item.index]!.text) >= COUNTER_HEDGE)
      .map((item) => item.index),
  );
  for (const index of hedged) used.add(index);

  const anchor = take(
    pick(pool, corpus, used, quantScore, { lensWeight: 0.35, minRelevance: 0.0 }),
  );
  let bridgePair: [Passage, Passage] | null = null;
  let bridgeTerm = "";
  const pair = bridge(corpus, pool, used, new Set(query));
  if (pair !== null) {
    const [first, second, term] = pair;
    bridgeTerm = term;
    const firstPassage = take(first),
      secondPassage = take(second);
    if (firstPassage !== null && secondPassage !== null)
      bridgePair = [firstPassage, secondPassage];
  }
  const window = pool
    .slice(0, EVIDENCE_WINDOW)
    .map((item) => corpus.sentences[item.index]!);
  const hardware = isHardwareTopic(window);
  // A measurement needs a number or two measurement words; one stray "signal" is not an instrument.
  const [buildLens, buildFloor] = hardware
    ? ([buildScore, 1.0] as const)
    : ([measureScore, 2.0] as const);
  const build = take(
    pick(pool, corpus, used, buildLens, { minLens: buildFloor, citedSources: cited }),
  );
  const test = take(pick(pool, corpus, used, testScore, { minLens: 1.0 }));

  // Elena speaks from relevant caveats, or from a caveat a cited paper states about itself even
  // when it does not repeat the question's wording.
  const citedTitles = new Set([...cited].map(stemOf));
  const relevance = new Map(pool.map((item) => [item.index, item.relevance]));
  const relevant = pool.filter(
    (item) => hedged.has(item.index) && item.relevance >= 0.25 * top,
  );
  const shortlisted = new Set(relevant.map((item) => item.index));
  const candidates: Scored[] = [
    ...relevant,
    ...corpus.sentences.flatMap((sentence, index) =>
      !shortlisted.has(index) &&
      !taken.has(index) &&
      citedTitles.has(sentence.title) &&
      hedgeScore(sentence.text) >= STRONG_HEDGE
        ? [{ index, relevance: relevance.get(index) ?? 0.0 }]
        : [],
    ),
  ];
  const counter = take(
    bestCounter(candidates, corpus, top, anchor ? anchor.title : null),
  );

  const windowSources = new Map<string, number>();
  for (const s of window)
    windowSources.set(s.source, (windowSources.get(s.source) ?? 0) + 1);
  return {
    question,
    grounding: g,
    matched,
    missing,
    windowPapers: [...new Set(window.map((s) => s.title))].sort(),
    windowSources,
    hardware,
    gaps: missingConstraints(
      [
        ...window,
        ...[...used].sort((a, b) => a - b).map((index) => corpus.sentences[index]!),
      ],
      hardware,
    ),
    anchor,
    build,
    bridge: bridgePair,
    bridgeTerm,
    counter,
    test,
  };
}

/**
 * Elena's pick. A measured counterexample outranks a caveat about James's own source,
 * which outranks a general disclaimer: she wants the leak rate, not the warning label.
 */
function bestCounter(
  candidates: readonly Scored[],
  corpus: LoadedCorpus,
  top: number,
  anchorTitle: string | null,
): Scored | null {
  let best: [number, number] | null = null;
  let choice: Scored | null = null;
  for (const candidate of candidates) {
    const sentence = corpus.sentences[candidate.index]!;
    let score = hedgeScore(sentence.text) * (0.35 + candidate.relevance / top);
    score += hasNumber(sentence.text) ? 1.5 : 0.0;
    score += sentence.title === anchorTitle ? 0.75 : 0.0;
    const key: [number, number] = [score, -candidate.index];
    if (best === null || key[0] > best[0] || (key[0] === best[0] && key[1] > best[1])) {
      best = key;
      choice = candidate;
    }
  }
  return choice;
}

const papersPhrase = (count: number) => `${count} ${count === 1 ? "paper" : "papers"}`;
const turn = (
  speaker: Perspective,
  move: string,
  lead: string,
  quotes: Passage[] = [],
  coda = "",
): Turn => ({ speaker, role: AGENT_ROLES[speaker], move, lead, quotes, coda });

function jamesFrame(ev: Evidence): Turn {
  const passages = [...ev.windowSources.values()].reduce((a, b) => a + b, 0);
  let lead = `I pulled ${passages} passages from ${papersPhrase(ev.windowPapers.length)} that speak to ${quotedTerms(ev.matched.slice(0, 4))}.`;
  if (ev.grounding === "partial" && ev.missing.length)
    lead += ` Nothing in the library touches ${quotedTerms(ev.missing.slice(0, 3))}, so I'm scoping to what it covers.`;
  if (ev.anchor === null)
    return turn(
      "James",
      "frame",
      lead,
      [],
      "None of it is a measured result, so everything below is a claim.",
    );
  const key = ev.question.toLowerCase();
  const coda = hasNumber(ev.anchor.text)
    ? variant(key + "james-number", [
        "That's a stated number, not a vibe, so that's where I anchor. The question is whether it survives this room.",
        "A number I can check. I'll anchor there and let the rest of you try to break it.",
      ])
    : variant(key + "james-claim", [
        "No number attached, so I'm logging it as a claim, not a result. Let's see if it survives this room.",
        "It's a clear statement, but it isn't a measurement. Treat it as the claim under test.",
      ]);
  return turn(
    "James",
    "frame",
    `${lead} The most concrete line is in ${ev.anchor.title}:`,
    [ev.anchor],
    coda,
  );
}

function jasmineCheck(ev: Evidence): Turn {
  if (ev.build === null)
    return turn(
      "Jasmine",
      "reality check",
      "I went looking for anything I could build or measure against: a sensor, a dataset, a number with units. Nothing in the retrieved passages qualifies.",
      [],
      "That's a gap, not a green light. I won't sign off on a mechanism nobody can instrument.",
    );
  const key = ev.question.toLowerCase() + "jasmine-lead";
  let lead: string, consequence: string, satisfied: string;
  if (ev.hardware) {
    lead = variant(key, [
      `Before we fall in love with it: can anyone build this? The closest thing to a spec is in ${ev.build.title}:`,
      `Okay, reality check. What would we actually wire up? ${ev.build.title} gets closest:`,
    ]);
    consequence = "and without those I can't spec or price a build";
    satisfied =
      "Rare case: the papers hand me constraints I can actually build against. I'm cautiously in.";
  } else {
    lead = variant(key, [
      `Before we fall in love with it: what would we actually measure? The closest thing to an instrument is in ${ev.build.title}:`,
      `Okay, reality check. What's the measurement here? ${ev.build.title} gets closest:`,
    ]);
    consequence =
      "and without those a clean-looking signal and a lucky one look identical";
    satisfied =
      "Rare case: the papers give me a measurement I could actually rerun. I'm cautiously in.";
  }
  const coda = ev.gaps.length
    ? `That's something I can work with. What none of these passages gives me is ${join(ev.gaps.slice(0, 2))}, ${consequence}.`
    : satisfied;
  return turn("Jasmine", "reality check", lead, [ev.build], coda);
}

function lucaConnection(ev: Evidence): Turn {
  if (ev.bridge === null) {
    const lead =
      ev.windowPapers.length === 1
        ? `Every strong hit comes from ${ev.windowPapers[0]}. One paper shows me a point, not a pattern.`
        : "I tried to find the same structure in two different papers and couldn't. The hits don't rhyme yet.";
    return turn(
      "Luca",
      "connection",
      lead,
      [],
      "I'd want a second, independent framing before I call it structure.",
    );
  }
  const [first, second] = ev.bridge;
  const lead = variant(ev.question.toLowerCase() + "luca-lead", [
    `Look at the shape of this. ${first.title} and ${second.title} both reach for '${ev.bridgeTerm}', from different directions:`,
    `Here's what nobody said out loud. Two papers, two framings, one shared idea: '${ev.bridgeTerm}'.`,
  ]);
  return turn(
    "Luca",
    "connection",
    lead,
    [first, second],
    "Same structure, two framings. If it's real, one test should light up in both places, and that's the connection I'd chase.",
  );
}

function concentrationNote(ev: Evidence): string {
  const total = [...ev.windowSources.values()].reduce((a, b) => a + b, 0);
  const [source, count] = mostCommon(ev.windowSources);
  const share = pyRound((100 * count) / total);
  if (share < 50) return "";
  return `And ${share}% of what James retrieved comes from a single paper, ${stemOf(source)}. `;
}

function elenaCounter(ev: Evidence): Turn {
  const note = concentrationNote(ev);
  if (ev.counter === null)
    return turn(
      "Elena",
      "counter-argument",
      "I looked for a stated limitation in what we pulled and found none. A claim that doesn't state its limits hasn't finished its argument.",
      [],
      `${note}I'd treat every claim here as unreviewed until someone tries to break it.`,
    );
  const lead = variant(ev.question.toLowerCase() + "elena-lead", [
    `Here's the strongest counter-argument, and it's in our own library. ${ev.counter.title} says it plainly:`,
    `Before anyone gets attached: the best objection is already written down, in ${ev.counter.title}:`,
  ]);
  const measured = hasNumber(ev.counter.text)
    ? "That's a measured counterexample: a strong signal with nothing causal behind it. "
    : "";
  return turn(
    "Elena",
    "counter-argument",
    lead,
    [ev.counter],
    `${measured}${note}Until something outside this library reproduces James's anchor, this is a well-instrumented hypothesis, not a result.`,
  );
}

function exchange(ev: Evidence): Turn[] {
  const turns: Turn[] = [];
  if (ev.bridge !== null)
    turns.push(
      turn(
        "Luca",
        "pushback",
        `Fair, Elena. But '${ev.bridgeTerm}' holding up in two separate framings is exactly what's worth testing, not dismissing.`,
      ),
    );
  turns.push(
    turn(
      "Jasmine",
      "pushback",
      "Then give me one measurement that could come out the other way. Otherwise we're just admiring the shape.",
    ),
  );
  return turns;
}

function jamesClose(ev: Evidence): Turn {
  if (ev.test === null)
    return turn(
      "James",
      "next move",
      `Here's where I land. Nothing we pulled proposes a test that could fail, so designing one is the next move, before anyone ${ev.hardware ? "builds" : "acts on"} anything.`,
    );
  return turn(
    "James",
    "next move",
    `Here's where I land. We don't need to invent the test; ${ev.test.title} already points at one:`,
    [ev.test],
    "That's the next move: run it, and write down in advance the result that would kill the idea.",
  );
}

function verdictOf(ev: Evidence): Verdict {
  let agreed =
    `The library speaks to this directly: ${papersPhrase(ev.windowPapers.length)} ` +
    `${ev.windowPapers.length === 1 ? "covers" : "cover"} ` +
    `${quotedTerms(ev.matched.slice(0, 4))}` +
    (ev.anchor !== null ? `, led by ${ev.anchor.title}.` : ".");
  if (ev.grounding === "partial" && ev.missing.length)
    agreed += ` It is silent on ${quotedTerms(ev.missing.slice(0, 3))}.`;
  let contested: string;
  if (ev.bridge !== null)
    contested = `Luca reads the shared '${ev.bridgeTerm}' in ${ev.bridge[0].title} and ${ev.bridge[1].title} as real structure; Elena reads it as unreplicated until an outside source reproduces it.`;
  else if (ev.counter !== null)
    contested = `Whether James's anchor survives the limitation ${ev.counter.title} states about its own method.`;
  else
    contested =
      "Whether any of these claims survive a test designed to break them. Nobody has run one yet.";
  let nextMove =
    ev.test !== null
      ? `Run the test ${ev.test.title} points to (${citationOf(ev.test)}), with the failure condition written down first.`
      : "Write one falsifiable prediction for this question and the measurement that would refute it.";
  if (ev.gaps.length && ev.build !== null)
    nextMove += ev.hardware
      ? ` Put a number on ${ev.gaps[0]} before building anything.`
      : ` Report it with ${join(ev.gaps.slice(0, 2))}.`;
  // Read-next favours breadth: one citation per paper first, then the rest.
  const ordered = [ev.anchor, ev.counter, ...(ev.bridge ?? []), ev.test, ev.build].filter(
    (p): p is Passage => p !== null,
  );
  const readNext: string[] = [];
  const seenSources = new Set<string>();
  for (const p of ordered)
    if (!seenSources.has(p.source)) {
      seenSources.add(p.source);
      readNext.push(citationOf(p));
    }
  for (const p of ordered)
    if (!readNext.includes(citationOf(p))) readNext.push(citationOf(p));
  return { agreed, contested, nextMove, readNext: readNext.slice(0, 3) };
}

function groundedTurns(
  corpus: LoadedCorpus,
  question: string,
  pool: readonly Scored[],
  query: readonly string[],
  g: Grounding,
  matched: string[],
  missing: string[],
): [Turn[], Verdict] {
  const ev = selectEvidence(corpus, question, pool, query, g, matched, missing);
  const turns = [
    jamesFrame(ev),
    jasmineCheck(ev),
    lucaConnection(ev),
    elenaCounter(ev),
    ...exchange(ev),
  ];
  turns.push(jamesClose(ev));
  return [turns, verdictOf(ev)];
}

function ungroundedTurns(
  corpus: LoadedCorpus,
  query: readonly string[],
  surfaces: ReadonlyMap<string, string>,
): Turn[] {
  const searched =
    quotedTerms(query.slice(0, 5).map((t) => surfaces.get(t)!)) || "this question";
  const library = corpus.sentences.length
    ? `I searched ${papersPhrase(corpus.documents.size)} and ${corpus.sentences.length} quotable passages for ${searched}. Nothing speaks to it.`
    : "There's no paper library here yet, so there is nothing to search.";
  return [
    turn(
      "James",
      "frame",
      library,
      [],
      "That's not in our active research context, and I won't dress up unrelated passages as evidence.",
    ),
    turn(
      "Jasmine",
      "reality check",
      "Then let's be useful about what would count. What's the one number we could instrument on day one that tells us this works?",
    ),
    turn(
      "Luca",
      "connection",
      "And what would it look like if it didn't work? Knowing the shape of failure tells us where to look first.",
    ),
    turn(
      "Elena",
      "counter-argument",
      "State the claim so it can fail: what changes, by how much, measured how. Until then there is nothing for me to verify, and I'd rather say so than pretend.",
    ),
    turn(
      "James",
      "next move",
      "Agreed. The next move is evidence: put two or three solid papers on this into the library and rerun, and this room will argue from them.",
    ),
  ];
}

/** Every quote in a meeting, re-verified against the documents it was drawn from. */
export const verifyMeetingQuotes = (
  meeting: OfflineMeeting,
  documents: readonly CorpusDocument[],
) =>
  quotesOf(meeting).map((q) => {
    const match = verifyQuote(documentMap(documents), q.text);
    return match !== null && match.source === q.source;
  });
