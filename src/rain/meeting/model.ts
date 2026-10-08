/**
 * A model meeting: the four perspectives, each a local model prompted with
 * its SOUL file, the research corpus and the conversation, speaking in turn.
 *
 * A port of the meeting loop of R.A.I.N.'s `rain_lab_meeting_chat_version.py`
 * (james_library, MIT) — `RainLabOrchestrator.run_meeting` and
 * `_generate_agent_response` — against any OpenAI-compatible chat server
 * (Ollama, LM Studio, llama.cpp's server, vLLM). What is kept: the souls and
 * the meeting rules appended to them; the library context; the director's
 * per-turn instructions and the wrap-up instructions; the agreeableness-shaped
 * reply to the previous speaker; the James repeated-opener guardrail; the
 * critique-and-revise pass; the truncation, corruption and too-short repairs
 * with the placeholder fallback; the citation analysis of every turn; the
 * stagnation monitor and its bounded recovery prompts; the closing line; and
 * R.A.I.N.'s session artifact. What is left out, deliberately: web search,
 * speech, the Godot event stream, the Rust daemon, the Telegram inbox, the
 * founder's keyboard, the knowledge hypergraph (a scikit-learn graph the
 * runtime does not carry) and the hypothesis tree (R.A.I.N. built its prompt
 * fragment into a string it never sent).
 *
 * Nothing a model writes is executed, followed or fetched: its words only
 * ever come back as text. The question is one argument. The one source of
 * randomness, the director's choice among its instructions, is seeded from
 * the session id so a meeting's prompts are reproducible given the answers.
 *
 * Server only.
 */
import { mulberry32 } from "../../lib/noise.js";
import { hashCorpusDocuments, verifyQuote, type CorpusDocument } from "../corpus.js";
import { sha256 } from "../sha256.js";
import {
  SessionArtifactWriter,
  type SessionArtifact,
  type TurnMetadataIn,
} from "./artifact.js";
import {
  CLOSING_LINE,
  TEAM,
  placeholderLine,
  type Perspective,
  type TeamMember,
} from "./perspectives.js";
import { soulText } from "./souls.js";
import { MeetingRecoveryController, StagnationMonitor } from "./stagnation.js";

export const PRIMARY_RESPONSE_WORD_TARGET = "90-140 words";
export const PRIMARY_RESPONSE_SENTENCE_TARGET = "3-5 complete sentences";
const REPAIR_RESPONSE_SENTENCE_TARGET = "3 or 4 complete sentences";
const WRAP_UP_RESPONSE_WORD_TARGET = "60-100 words";
const WRAP_UP_RESPONSE_SENTENCE_TARGET = "2-3 complete sentences";
const SELF_NAME_INTRO_GUIDANCE =
  'Do not start with your own name, a speaker label, or a self-intro like "James:", "James here," or "I\'m James."';
const meetingResponseLengthGuidance = () =>
  `Aim for ${PRIMARY_RESPONSE_WORD_TARGET} across ${PRIMARY_RESPONSE_SENTENCE_TARGET} so each turn lands as a complete thought.`;
const wrapUpResponseLengthGuidance = () =>
  `Aim for ${WRAP_UP_RESPONSE_WORD_TARGET} across ${WRAP_UP_RESPONSE_SENTENCE_TARGET} so the closing summary still sounds complete.`;

const RE_QUOTE_DOUBLE = /"([^"]+)"/g;
const RE_QUOTE_SINGLE = /'([^']+)'/g;
const RE_CORRUPTION_CAPS = /[A-Z]{8,}/;
const RE_WEB_SEARCH_COMMAND = /\[SEARCH:\s*(.*?)\]/i;
const RE_CORRUPTION_PATTERNS = [
  /\|eoc_fim\|/i, // End of context markers
  /ARILEX|AIVERI|RIECK/i, // Common corruption sequences
  /ingly:\w*scape/i, // Gibberish compound words
  /:\s*\n\s*:\s*\n/i, // Empty lines with colons
  /##\d+\s*\(/i, // Markdown header gibberish
  /SING\w{10,}/i, // Long corrupt strings starting with SING
  /[A-Z]{4,}:[A-Z]{4,}/i, // Multiple caps words with colons
];

/** Sanitize corpus text before it enters a prompt: control tokens, fake headers, recursive search triggers. */
export function sanitizeText(text: string): string {
  if (!text) return "";
  for (const token of ["<|endoftext|>", "<|im_start|>", "<|im_end|>", "|eoc_fim|"])
    text = text.replaceAll(token, "[TOKEN_REMOVED]");
  text = text.replaceAll("###", ">>>");
  text = text.replaceAll("[SEARCH:", "[SEARCH;");
  return text.trim();
}

export interface ModelMeetingSettings {
  /** The OpenAI-compatible base URL, ending in `/v1`. */
  baseUrl: string;
  /** The model exactly as the server lists it. */
  model: string;
  /** Sent as a bearer token when set; local servers need none. */
  apiKey?: string;
  maxTurns: number;
  /** R.A.I.N.'s own default is 15: the last 15 of 25 turns are its wrap-up. */
  wrapUpTurns?: number;
  recursiveIntellect: boolean;
  /** Read timeout for one model answer, in milliseconds (R.A.I.N.'s `RAIN_LM_TIMEOUT`, 300 s). */
  timeoutMs: number;
  temperature?: number;
  maxTokens?: number;
  maxRetries?: number;
  recentHistoryWindow?: number;
  contextSnippetLength?: number;
  totalContextLength?: number;
  requireQuotes?: boolean;
}
export interface MeetingHooks {
  fetchImpl?: typeof fetch;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
  /** Progress, never evidence: a turn has started. */
  onTurnStart?: (turn: number, speaker: Perspective) => void;
  sessionId?: string;
}
export interface HeldMeeting {
  artifact: SessionArtifact;
  text: string;
  /** The model stopped answering and the meeting was ended early, still recorded as completed. */
  modelStopped: boolean;
  cancelled: boolean;
}

/** A model meeting that could not be held: no server, no answer to the connection test. */
export class ModelUnavailable extends Error {}

type Message = { role: "system" | "user"; content: string };
class ApiTimeout extends Error {}
class ApiConnection extends Error {}
class ApiError extends Error {}

/** Library context: each paper's text up to the snippet length, until the total budget is spent. */
export function libraryContext(
  documents: readonly CorpusDocument[],
  snippetLength = 3000,
  totalLength = 20_000,
): { context: string; papers: string[] } {
  const buffer: string[] = [];
  const papers: string[] = [];
  let totalChars = 0;
  for (const doc of documents) {
    papers.push(doc.path);
    const remaining = totalLength - totalChars;
    if (remaining > 1000) {
      const safe = sanitizeText(doc.text);
      const toInclude = Math.min(safe.length, snippetLength, remaining);
      buffer.push(`--- PAPER: ${doc.path} ---\n${safe.slice(0, toInclude)}\n`);
      totalChars += toInclude;
    }
  }
  return { context: buffer.join("\n"), papers };
}

/** The soul a perspective speaks from: its SOUL file plus the meeting rules R.A.I.N. appends. */
export function soulOf(name: Perspective): string {
  return (
    soulText(name) +
    `\n\n\n\n# MEETING RULES (CRITICAL)\n\n- You are ONLY ${name}. Never speak as another team member.\n\n- Never write dialogue for others (no "James:" or "Jasmine would say...")\n\n- Never echo or repeat what colleagues just said - use your OWN words\n\n- ${SELF_NAME_INTRO_GUIDANCE}\n\n- ${meetingResponseLengthGuidance()}\n\n- Cite sources: [from filename.md]\n\n`
  );
}

/** Quoted spans of more than three words, in double or single quotes. */
export function extractQuotes(text: string): string[] {
  const quotes = [...text.matchAll(RE_QUOTE_DOUBLE)].map((m) => m[1]!);
  quotes.push(...[...text.matchAll(RE_QUOTE_SINGLE)].map((m) => m[1]!));
  return quotes.filter((q) => q.split(/\s+/).filter(Boolean).length > 3);
}

/** Citation analysis of one turn: which quotations the corpus contains, where, and the rate. */
export function analyzeCitations(
  response: string,
  documents: ReadonlyMap<string, string>,
  requireQuotes = true,
): Required<
  Pick<
    TurnMetadataIn,
    | "verified"
    | "unverified"
    | "verified_spans"
    | "citation_rate"
    | "require_quotes"
    | "citation_success"
  >
> & {
  quotes_found: number;
} {
  const quotes = extractQuotes(response);
  const verified: [string, string][] = [];
  const unverified: string[] = [];
  const spans: { quote: string; source: string; span_start: number; span_end: number }[] =
    [];
  for (const quote of quotes) {
    const match = verifyQuote(documents, quote);
    if (match) {
      verified.push([quote, match.source]);
      spans.push({
        quote,
        source: match.source,
        span_start: match.spanStart,
        span_end: match.spanEnd,
      });
    } else unverified.push(quote);
  }
  return {
    quotes_found: quotes.length,
    verified,
    unverified,
    verified_spans: spans,
    citation_rate: quotes.length ? verified.length / quotes.length : 0,
    require_quotes: requireQuotes,
    citation_success: verified.length > 0,
  };
}

/** Detect dangling clauses that should be completed before acceptance. */
export function looksTruncated(text: string, finishReason: string | null): boolean {
  if (finishReason === "length") return true;
  const normalized = (text ?? "").trim();
  if (!normalized) return false;
  if (RE_WEB_SEARCH_COMMAND.test(normalized)) return false;
  if ([".", "!", "?", '"', "'", ")", "]"].some((end) => normalized.endsWith(end)))
    return false;
  if ([",", ";", ":"].some((end) => normalized.endsWith(end)) && normalized.length < 50)
    return true;
  if ([",", ";"].some((end) => normalized.endsWith(end)))
    for (const pattern of [
      /\b(which|because|although|however|therefore|while|when|if|that|where)\s*[,:;]?\s*$/i,
      /\b(the|a|an)\s+$/i,
      /\b(and|but|or)\s+$/i,
    ])
      if (pattern.test(normalized)) return true;
  return false;
}

/** Detect corrupted or garbled model output. Returns the reason, or null. */
export function corruptionReason(text: string): string | null {
  const normalized = (text ?? "").trim();
  if (!normalized) return "Response too short";
  if (RE_CORRUPTION_CAPS.test(normalized))
    return "Excessive consecutive capitals detected";
  const special = [...normalized].filter((c) =>
    ":;/\\|<>{}[]()@#$%^&*+=~`".includes(c),
  ).length;
  if (normalized.length > 20 && special / normalized.length > 0.15)
    return "Too many special characters";
  for (const pattern of RE_CORRUPTION_PATTERNS)
    if (pattern.test(normalized))
      return `Corruption pattern detected: ${pattern.source.slice(0, 20)}`;
  if (normalized.length < 20) {
    // Compact answers like "I disagree." or "Why?" are valid. Only flag the truly broken.
    const candidate = normalized.replace(/['"”’)\]}]+$/u, "");
    const shortWords = normalized.match(/[A-Za-z]+(?:['’-][A-Za-z]+)?/g) ?? [];
    if (
      shortWords.length &&
      ([".", "!", "?"].some((e) => candidate.endsWith(e)) || shortWords.length >= 2)
    )
      return null;
    if (!shortWords.length) return "Response too short";
    return null;
  }
  if (looksTruncated(normalized, null)) return "Incomplete sentence";
  const lines = normalized.split("\n");
  const emptyLines = lines.filter((line) => line.trim().length <= 2).length;
  if (lines.length > 5 && emptyLines / lines.length > 0.5) return "Too many empty lines";
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length && words.reduce((n, w) => n + w.length, 0) / words.length > 15)
    return "Average word length too high (likely corrupted)";
  return null;
}

/** Strip a repeated speaker label from the front of a turn ("James:", "James (R.A.I.N. Lab):", "I'm James,"). */
export function stripAgentPrefix(response: string, agentName: string): string {
  let cleaned = (response ?? "").trim();
  const name = agentName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`^${name}\\s*(?:\\([^)]*\\))?\\s*[:\\-–—]\\s*`, "i"),
    new RegExp(`^${name}\\s+here\\s*[,:\\-–—]\\s*`, "i"),
    new RegExp(
      `^(?:i am|i['’]?m|im|this is)\\s+${name}(?:\\s*[,:\\-–—]\\s*|\\s+and\\s+)`,
      "i",
    ),
  ];
  while (cleaned) {
    let updated = cleaned;
    for (const pattern of patterns) updated = updated.replace(pattern, "").trim();
    if (updated === cleaned) break;
    cleaned = updated;
  }
  return cleaned.trim();
}

/** Lines in which the speaker writes as another team member are dropped. */
function dropOtherAgentLines(content: string, agentName: string): string {
  return content
    .split("\n")
    .filter(
      (line) =>
        !TEAM.some(
          (other) => other.name !== agentName && line.trim().startsWith(`${other.name}:`),
        ),
    )
    .join("\n")
    .trim();
}

/** The director's per-turn instruction; its choices are drawn from a seeded source. */
export function directorInstruction(
  agent: TeamMember,
  turnCount: number,
  topic: string,
  papers: readonly string[],
  random: () => number,
): string {
  const choose = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)]!;
  if (turnCount === 0 && agent.name === "James")
    return `Open the meeting. Survey the loaded research papers and identify which ones discuss '${topic}'. Quote key definitions or findings.`;
  if (turnCount === 4 && papers.length) {
    const paper = choose(papers);
    if (agent.name === "James")
      return `Focus specifically on '${paper}'. What does it say about '${topic}'? Quote directly.`;
  }
  const instructions: Record<Perspective, string[]> = {
    James: [
      `Quote a specific finding or definition of '${topic}' from the papers. Which paper is it from?`,
      `Synthesize: How do different papers relate to '${topic}'? Reference specific papers.`,
      `What is the core innovation regarding '${topic}' according to the text? Quote it.`,
      `Find and compare TWO different mentions of '${topic}' from different papers.`,
    ],
    Jasmine: [
      `Critique implementation: What do the papers say about building '${topic}'? Quote constraints.`,
      `Do the papers mention energy/hardware requirements for '${topic}'? Quote specifics.`,
      `Find experimental setups in the text related to '${topic}'. Quote parameters.`,
      `What materials or components are mentioned for '${topic}'? Quote from the papers.`,
    ],
    Luca: [
      `Describe the theoretical geometry of '${topic}' using equations from the text. Quote them.`,
      `Visualize '${topic}' using descriptions from the papers. Quote the relevant passages.`,
      `What topology or structure defines '${topic}' in the text? Quote mathematical descriptions.`,
      `Find field equations related to '${topic}'. Quote and explain them.`,
    ],
    Elena: [
      `Check mathematical consistency of '${topic}' in the papers. Quote specific equations.`,
      `Do papers define limits (bits, entropy, error) for '${topic}'? Quote numerical values.`,
      `Compare '${topic}' in the text to standard QM. Quote differences explicitly.`,
      `Find information-theoretic bounds on '${topic}'. Quote from papers.`,
    ],
  };
  return choose(instructions[agent.name]);
}

/** Wrap-up phase instructions, one per perspective. */
export function wrapUpInstruction(agent: TeamMember, topic: string): string {
  const guidance = wrapUpResponseLengthGuidance();
  const byName: Record<Perspective, string> = {
    James: `WRAP-UP TIME: You are closing the meeting. As lead scientist:\n\n- Summarize the KEY TAKEAWAY about '${topic}' from today's discussion\n\n- Mention 1-2 specific insights from your colleagues that stood out\n\n- Suggest ONE concrete next step or action item for the team\n\n- End with something like 'Good discussion today' or 'Let's pick this up next time'\n\n${guidance}`,
    Jasmine: `WRAP-UP TIME: Give your closing thoughts on '${topic}':\n\n- State your MAIN CONCERN or practical challenge going forward\n\n- Acknowledge if any colleague made a good point about feasibility\n\n- Mention what you'd need to see before moving forward\n\n${guidance} Be direct and practical as always.`,
    Luca: `WRAP-UP TIME: Give your closing synthesis on '${topic}':\n\n- Find the COMMON GROUND between what everyone said\n\n- Highlight how different perspectives complemented each other\n\n- Express optimism about where the research is heading\n\n${guidance} Stay diplomatic and unifying.`,
    Elena: `WRAP-UP TIME: Give your final assessment of '${topic}':\n\n- State the most important MATHEMATICAL or THEORETICAL point established\n\n- Note any concerns about rigor that still need addressing\n\n- Acknowledge good work from colleagues if warranted\n\n${guidance} Maintain your standards but be collegial.`,
  };
  return byName[agent.name];
}

/** The style the speaker takes toward the previous speaker, by agreeableness. */
function styleInstruction(agent: TeamMember, prevSpeaker: string): string {
  if (agent.agreeableness < 0.3)
    return `STYLE: You STRONGLY DISAGREE with ${prevSpeaker}. Be direct and combative:\n\n- Challenge their assumptions or data interpretation\n\n- Point out flaws in their reasoning or missing considerations`;
  if (agent.agreeableness < 0.5)
    return `STYLE: You're SKEPTICAL of what ${prevSpeaker} said. Question their claims:\n\n- Demand evidence or point out logical gaps\n\n- Ask probing questions about feasibility or rigor`;
  if (agent.agreeableness < 0.7)
    return `STYLE: You PARTIALLY AGREE with ${prevSpeaker} but add nuance:\n\n- Acknowledge one valid point then offer a different angle\n\n- Redirect the discussion toward your specialty`;
  return `STYLE: You AGREE with ${prevSpeaker} and BUILD on it:\n\n- Add a NEW insight they didn't mention\n\n- Extend their idea in a new direction`;
}

/** The user message for one turn, as R.A.I.N. writes it. */
export function userMessage(
  agent: TeamMember,
  recentChat: string,
  mission: string,
  prevSpeaker: string | null,
): string {
  if (prevSpeaker && prevSpeaker !== agent.name && prevSpeaker !== "FOUNDER")
    return `LIVE TEAM MEETING - Your turn to speak.\n\n\n\nRECENT DISCUSSION:\n\n${recentChat}\n\n\n\n${styleInstruction(agent, prevSpeaker)}\n\n\n\n=== CRITICAL RULES (MUST FOLLOW) ===\n\n1. YOU ARE ${agent.name.toUpperCase()} - Never speak as another person or quote what others "would say"\n\n2. DO NOT REPEAT phrases others just said - use completely different wording\n\n3. ADVANCE the discussion - raise a NEW point, question, or angle not yet discussed\n\n4. Focus on YOUR specialty: ${agent.focus}\n\n5. ${meetingResponseLengthGuidance()}\n\n6. ${SELF_NAME_INTRO_GUIDANCE}\n\n7. CRITICAL: If you need to verify a fact online, type: [SEARCH: your query]\n\n\n\nYour task: ${mission}\n\n\n\nRespond as ${agent.name} only:`;
  return `You are ${agent.name}, STARTING a team meeting discussion.\n\n\n\nPrevious context: ${recentChat}\n\n\n\n=== YOUR INSTRUCTIONS ===\n\n1. Open casually and introduce the topic briefly\n\n2. Share ONE specific observation from the papers\n\n3. End with a question to spark discussion\n\n4. ${meetingResponseLengthGuidance()}\n\n5. ${SELF_NAME_INTRO_GUIDANCE}\n\n\nYour specialty: ${agent.focus}\n\nYour task: ${mission}\n\n\n\nRespond as ${agent.name} only:`;
}

/**
 * One meeting, held to the end, cancelled, or ended early when the model
 * stopped answering. Throws `ModelUnavailable` when the server never answered
 * the connection test; everything after that is recorded.
 */
export async function holdMeeting(
  topic: string,
  documents: readonly CorpusDocument[],
  settings: ModelMeetingSettings,
  hooks: MeetingHooks = {},
): Promise<HeldMeeting> {
  const fetchImpl =
    hooks.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const now = hooks.now ?? (() => new Date());
  const signal = hooks.signal;
  const wait =
    hooks.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  /** A pause between attempts that a cancellation ends early, and then refuses to continue past. */
  const sleep = async (ms: number) => {
    if (signal?.aborted) throw new MeetingCancelled();
    if (signal) {
      let onAbort = () => {};
      const aborted = new Promise<void>((resolve) => {
        onAbort = resolve;
        signal.addEventListener("abort", onAbort, { once: true });
      });
      try {
        await Promise.race([wait(ms), aborted]);
      } finally {
        signal.removeEventListener("abort", onAbort);
      }
    } else await wait(ms);
    if (signal?.aborted) throw new MeetingCancelled();
  };
  const temperature = settings.temperature ?? 0.7;
  const maxTokens = settings.maxTokens ?? 320;
  const maxRetries = settings.maxRetries ?? 2;
  const recentHistoryWindow = settings.recentHistoryWindow ?? 2;
  const wrapUpTurns = settings.wrapUpTurns ?? 15;
  const requireQuotes = settings.requireQuotes ?? true;
  const sessionId = hooks.sessionId ?? crypto.randomUUID().slice(0, 8);
  const random = mulberry32(parseInt(sha256(sessionId).slice(0, 8), 16));
  const url = `${settings.baseUrl.replace(/\/+$/, "")}/chat/completions`;

  const chat = async (
    messages: Message[],
    options: { temperature: number; maxTokens: number },
  ) => {
    // A cancelled meeting asks the model server nothing more: the listener
    // below only hears an abort that happens after it is attached.
    if (signal?.aborted) throw new MeetingCancelled();
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), settings.timeoutMs);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;
      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: settings.model,
            messages,
            temperature: options.temperature,
            max_tokens: options.maxTokens,
          }),
          signal: controller.signal,
          redirect: "error",
        });
      } catch (error) {
        if (signal?.aborted) throw new MeetingCancelled();
        throw controller.signal.aborted
          ? new ApiTimeout()
          : new ApiConnection(String(error));
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new ApiError(`HTTP ${response.status}`);
      }
      const payload = (await response.json()) as {
        choices?: { message?: { content?: unknown }; finish_reason?: unknown }[];
      };
      const choice = payload.choices?.[0];
      const content = choice?.message?.content;
      if (typeof content !== "string") throw new Error("malformed completion");
      const finish =
        typeof choice?.finish_reason === "string" ? choice.finish_reason : null;
      return { content: content.trim(), finishReason: finish };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  };

  // Connection test, three attempts, as R.A.I.N. does before a meeting.
  let connected = false;
  for (let attempt = 0; attempt < 3 && !connected; attempt++) {
    if (signal?.aborted) throw new MeetingCancelled();
    try {
      await chat([{ role: "user", content: "test" }], { temperature, maxTokens: 5 });
      connected = true;
    } catch (error) {
      if (error instanceof MeetingCancelled) throw error;
      if (attempt < 2) await sleep(2000);
    }
  }
  if (!connected)
    throw new ModelUnavailable(
      `the model server did not answer at ${settings.baseUrl} with the model ${settings.model}`,
    );

  const { context: contextBlock, papers } = libraryContext(
    documents,
    settings.contextSnippetLength,
    settings.totalContextLength,
  );
  if (!papers.length)
    throw new ModelUnavailable("no papers found in the corpus; a meeting needs evidence");
  const docs = new Map(documents.map((d) => [d.path, d.text]));
  const corpusHashes = hashCorpusDocuments(documents);
  const writer = new SessionArtifactWriter({
    sessionId,
    topic,
    model: settings.model,
    recursiveDepth: settings.recursiveIntellect ? 1 : 0,
    libraryPath: "src/rain/data/corpus.json",
    logPath: "this session artifact (no separate transcript file)",
    loadedPapers: papers,
    corpusFiles: corpusHashes,
    now,
  });
  const souls = new Map(TEAM.map((m) => [m.name, soulOf(m.name)]));
  const systemPrompt = (agent: TeamMember) =>
    `${souls.get(agent.name)}\n\n### RESEARCH DATABASE\n${contextBlock}`;
  const monitor = new StagnationMonitor();
  const recovery = new MeetingRecoveryController(TEAM.length, TEAM.length);
  const history: string[] = [];
  const speakers = new Set<string>([...TEAM.map((m) => m.name), "FOUNDER"]);

  const generate = async (
    agent: TeamMember,
    turnCount: number,
    isWrapUp: boolean,
  ): Promise<string | null> => {
    const recentChat = history.length
      ? history.slice(-recentHistoryWindow).join("\n")
      : "[Meeting Start]";
    const mission = isWrapUp
      ? wrapUpInstruction(agent, topic)
      : directorInstruction(agent, turnCount, topic, papers, random);
    let prevSpeaker: string | null = null;
    for (const entry of [...history].reverse()) {
      const colon = entry.indexOf(":");
      if (colon > 0 && speakers.has(entry.slice(0, colon).trim())) {
        prevSpeaker = entry.slice(0, colon).trim();
        break;
      }
    }
    const message = userMessage(agent, recentChat, mission, prevSpeaker);
    const system: Message = { role: "system", content: systemPrompt(agent) };
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      if (signal?.aborted) throw new MeetingCancelled();
      try {
        const answer = await chat([system, { role: "user", content: message }], {
          temperature,
          maxTokens,
        });
        const finishReason = answer.finishReason;
        let content = answer.content;
        // Guardrail: some local models collapse back to James's opener template on later turns.
        if (turnCount >= 1 && agent.name === "James") {
          const lowered = content.toLowerCase();
          if (
            lowered.startsWith("hey team") ||
            lowered.includes("today we're looking into") ||
            lowered.includes("today we're talking about")
          ) {
            const corrected = await chat(
              [
                system,
                {
                  role: "user",
                  content:
                    "You are in mid-meeting, not opening the session. Do NOT use intro phrases like 'Hey team' or restate the topic. React to the previous speaker by name in the first sentence, add one new concrete paper-grounded point, and end with a question. " +
                    `${SELF_NAME_INTRO_GUIDANCE} ${meetingResponseLengthGuidance()}`,
                },
              ],
              { temperature, maxTokens },
            );
            if (corrected.content) content = corrected.content;
          }
        }
        // Optional recursive refinement: critique + revise in one internal loop.
        if (settings.recursiveIntellect && content) {
          const critique = await chat(
            [
              {
                role: "system",
                content: `You are a strict research editor for ${agent.name}.`,
              },
              {
                role: "user",
                content:
                  "Review this draft and return a compact critique with exactly 3 bullets: (1) factual grounding to provided papers, (2) novelty vs prior turns, " +
                  `(3) clarity and completeness within ${PRIMARY_RESPONSE_WORD_TARGET}.\n\nDRAFT:\n${content}\n\nIf there are no issues, still return 3 bullets and say what is strong.`,
              },
            ],
            { temperature: 0.2, maxTokens: 120 },
          );
          const refined = await chat(
            [
              system,
              {
                role: "user",
                content:
                  `Revise this response as ${agent.name} using critique below. Keep it within ${PRIMARY_RESPONSE_WORD_TARGET} across ${PRIMARY_RESPONSE_SENTENCE_TARGET}, add one concrete paper-grounded point, avoid repetition, respond in first person only, and do not start with your own name.\n\n` +
                  `ORIGINAL:\n${content}\n\nCRITIQUE:\n${critique.content}`,
              },
            ],
            { temperature, maxTokens },
          );
          content = refined.content || content;
        }
        if (content.startsWith(`${agent.name}:`))
          content = content.replace(`${agent.name}:`, "").trim();
        content = dropOtherAgentLines(content, agent.name);
        if (looksTruncated(content, finishReason)) {
          const endCleanly = () => {
            for (const end of [". ", "! ", "? "]) {
              const lastEnd = content.lastIndexOf(end);
              if (lastEnd >= 0 && lastEnd > content.length * 0.5) {
                content = content.slice(0, lastEnd + 1);
                return;
              }
            }
            content = content.replace(/[,;:]+$/, "") + "...";
          };
          try {
            const continuation = await chat(
              [
                { role: "system", content: souls.get(agent.name)! },
                {
                  role: "user",
                  content: `Complete this thought in ONE complete sentence so the turn ends cleanly. Do not restart with your own name or a speaker label.\n\n${content}`,
                },
              ],
              { temperature, maxTokens: 60 },
            );
            const cont = continuation.content;
            if (cont && !cont.startsWith(content.slice(0, 20))) {
              if (!/^\p{Uppercase}/u.test(cont)) content = content + " " + cont;
              else endCleanly();
            }
          } catch (error) {
            if (error instanceof MeetingCancelled) throw error;
            endCleanly();
          }
        }
        const repairTooShort = async (short: string): Promise<string> => {
          try {
            const repaired = await chat(
              [
                system,
                {
                  role: "user",
                  content:
                    `Your last reply was too short or incomplete: ${short.trim() || "[empty response]"}\n\n` +
                    `Rewrite it as ${agent.name} answering this topic directly: ${topic}\n- Use ${REPAIR_RESPONSE_SENTENCE_TARGET}\n- Aim for ${PRIMARY_RESPONSE_WORD_TARGET}\n- ${SELF_NAME_INTRO_GUIDANCE}\n- No stage directions, role labels, placeholders, or code fences\n- If the short draft had a useful idea, keep it and expand it`,
                },
              ],
              { temperature, maxTokens: Math.min(maxTokens, 180) },
            );
            return dropOtherAgentLines(
              stripAgentPrefix(repaired.content, agent.name),
              agent.name,
            );
          } catch (error) {
            if (error instanceof MeetingCancelled) throw error;
            return "";
          }
        };
        if (looksTruncated(content, null)) {
          const repaired = await repairTooShort(content);
          if (
            repaired &&
            corruptionReason(repaired) === null &&
            !looksTruncated(repaired, null)
          )
            content = repaired;
        }
        let reason = corruptionReason(content);
        if (reason === "Incomplete sentence") {
          const repaired = await repairTooShort(content);
          if (repaired) {
            const repairedReason = corruptionReason(repaired);
            if (repairedReason === null) {
              content = repaired;
              reason = null;
            } else reason = repairedReason;
          }
        }
        if (reason !== null) {
          if (attempt < maxRetries - 1) {
            await sleep(1000);
            continue;
          }
          content = placeholderLine(agent.name);
        }
        return content;
      } catch (error) {
        if (error instanceof MeetingCancelled) throw error;
        if (error instanceof ApiTimeout) {
          if (attempt < maxRetries - 1) await sleep(2000);
          else return null;
        } else if (error instanceof ApiConnection) {
          if (attempt < maxRetries - 1) await sleep(3000);
          else return null;
        } else if (error instanceof ApiError) {
          if (attempt < maxRetries - 1) await sleep(2000);
          else return null;
        } else return null;
      }
    }
    return null;
  };

  let turnCount = 0;
  let inWrapUp = false;
  let wrapUpStart = settings.maxTurns - wrapUpTurns;
  let meetingEnd = settings.maxTurns;
  let modelStopped = false;
  let cancelled = false;
  try {
    while (turnCount < meetingEnd) {
      if (signal?.aborted) throw new MeetingCancelled();
      if (!inWrapUp && turnCount >= wrapUpStart) inWrapUp = true;
      const agent = TEAM[turnCount % TEAM.length]!;
      hooks.onTurnStart?.(turnCount + 1, agent.name);
      const response = await generate(agent, turnCount, inWrapUp);
      if (response === null) {
        modelStopped = true;
        break;
      }
      const metadata = analyzeCitations(response, docs, requireQuotes);
      const clean = stripAgentPrefix(response, agent.name);
      history.push(`${agent.name}: ${response}`);
      writer.recordTurn(agent.name, response, metadata);
      // Give each recovery attempt a panel round, then bound the wrap-up.
      const decision = recovery.observe(monitor.check(clean), inWrapUp);
      if (decision !== null) {
        history.push(`SYSTEM: ${decision.prompt}`);
        writer.recordTurn("SYSTEM", decision.prompt, {
          recovery: { action: decision.action, reason: decision.reason },
        });
        if (decision.action === "wrap_up") {
          wrapUpStart = turnCount + 1;
          meetingEnd = Math.min(meetingEnd, wrapUpStart + wrapUpTurns);
        }
      }
      turnCount += 1;
    }
  } catch (error) {
    if (!(error instanceof MeetingCancelled)) throw error;
    cancelled = true;
  }
  if (cancelled) {
    const { artifact, text } = writer.finalize("interrupted");
    return { artifact, text, modelStopped, cancelled };
  }
  writer.recordTurn("James", CLOSING_LINE);
  const { artifact, text } = writer.finalize("completed");
  return { artifact, text, modelStopped, cancelled: false };
}

/** The lab stopped the meeting; nothing stands in for it. */
export class MeetingCancelled extends Error {}
