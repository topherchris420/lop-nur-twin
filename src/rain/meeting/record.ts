/**
 * Meetings expressed in `rain-bethesda/v2`, the lab's wire contract.
 *
 * Two engines, one record shape. The offline engine's meeting is scripted and
 * self-describing (grounding, terms, a verdict); a model meeting is R.A.I.N.'s
 * session artifact re-read with every quote verified again, and carries no
 * analysis the model meeting never computed. Both say who wrote each turn.
 *
 * Shared with the server: imports siblings as `./x.js`, nothing else.
 */
import {
  documentMap,
  verifyQuote,
  verifyQuoteAt,
  type CorpusDocument,
} from "../corpus.js";
import { sha256 } from "../sha256.js";
import { countBefore, pyJsonDumps } from "../text.js";
import type { OfflineMeeting } from "./offline.js";
import {
  MODEL_ENGINE,
  MODEL_ID,
  OFFLINE_ENGINE,
  RAIN_BETHESDA_SCHEMA,
  RAIN_SESSION_ARTIFACT_SCHEMA,
  TURN_LIMITS,
  UNSAFE_TEXT,
} from "../protocol.js";
import {
  CLOSING_LINE,
  MODEL_ROLES,
  isPerspective,
  isPlaceholderLine,
  type Perspective,
} from "./perspectives.js";
import type { SessionArtifact } from "./artifact.js";

export {
  MODEL_ENGINE,
  MODEL_ID,
  RAIN_BETHESDA_SCHEMA,
  RAIN_SESSION_ARTIFACT_SCHEMA,
  TURN_LIMITS,
  UNSAFE_TEXT,
};

export interface Revision {
  repository: string;
  commit: string | null;
  dirty: boolean | null;
}
export interface RecordQuote {
  source: string;
  line: number;
  span_start: number;
  span_end: number;
  text: string;
  verified: boolean;
}
export interface RecordTurn {
  index: number;
  speaker: Perspective;
  role: string;
  move: string;
  lead: string;
  quotes: RecordQuote[];
  coda: string;
  unverified: number;
  generation: "scripted" | "model";
}
export interface MeetingRecord {
  schema: typeof RAIN_BETHESDA_SCHEMA;
  kind: "meeting";
  request_id: string;
  meeting_id: string;
  question: string;
  generation: "scripted" | "model";
  engine: string;
  model: string | null;
  grounding: "strong" | "partial" | "none" | null;
  matched_terms: string[] | null;
  missing_terms: string[] | null;
  turns: RecordTurn[];
  verdict: {
    agreed: string;
    contested: string;
    next_move: string;
    read_next: string[];
  } | null;
  audit: {
    checked: number;
    verified: number;
    corpus_files: number;
    corpus_sha256: string;
  };
  suggestions: string[];
  rain: Revision;
  produced_at: string;
  source_artifact: {
    schema: typeof RAIN_SESSION_ARTIFACT_SCHEMA;
    session_id: string;
    status: string;
    sha256: string;
  } | null;
}

export const nowIso = (date = new Date()) => date.toISOString();

/**
 * The offline engine's meeting in `rain-bethesda/v2`. Every quote is checked
 * again with `verifyQuoteAt` against the document it cites, and the
 * meeting id is derived from the content: the engine is deterministic, so the
 * same question over the same corpus is the same meeting.
 */
export function offlineMeetingRecord(
  meeting: OfflineMeeting,
  documents: readonly CorpusDocument[],
  requestId: string,
  revision: Revision,
  producedAt = nowIso(),
): MeetingRecord {
  const docs = documentMap(documents);
  const quote = (p: OfflineMeeting["turns"][number]["quotes"][number]): RecordQuote => {
    const match = verifyQuoteAt(docs, p.source, p.text);
    const verified = match !== null;
    return {
      source: p.source,
      line: p.line,
      span_start: verified ? match.spanStart : p.spanStart,
      span_end: verified ? match.spanEnd : p.spanEnd,
      text: p.text,
      verified,
    };
  };
  const turns: RecordTurn[] = meeting.turns.map((t, i) => ({
    index: i + 1,
    speaker: t.speaker,
    role: t.role,
    move: t.move,
    lead: t.lead,
    quotes: t.quotes.map(quote),
    coda: t.coda,
    unverified: 0,
    generation: "scripted",
  }));
  const content = {
    question: meeting.question,
    grounding: meeting.grounding,
    matched_terms: [...meeting.matchedTerms],
    missing_terms: [...meeting.missingTerms],
    turns,
    verdict: {
      agreed: meeting.verdict.agreed,
      contested: meeting.verdict.contested,
      next_move: meeting.verdict.nextMove,
      read_next: [...meeting.verdict.readNext],
    },
    audit: {
      checked: meeting.audit.checked,
      verified: meeting.audit.verified,
      corpus_files: meeting.audit.corpusFiles,
      corpus_sha256: meeting.audit.corpusSha256,
    },
    suggestions: [...meeting.suggestions],
  };
  const meetingId = "rain-offline-" + sha256(pyJsonDumps(content)).slice(0, 20);
  return {
    schema: RAIN_BETHESDA_SCHEMA,
    kind: "meeting",
    request_id: requestId,
    meeting_id: meetingId,
    generation: "scripted",
    engine: OFFLINE_ENGINE,
    model: null,
    ...content,
    rain: revision,
    produced_at: producedAt,
    source_artifact: null,
  };
}

/** A model meeting that ended without a usable record. The message is shown to the lab. */
export class MeetingFailed extends Error {}

/** Remove the invisible characters the lab refuses, and say how many there were. */
export function cleanText(value: string): [string, number] {
  const normalized = value.replaceAll("\r\n", "\n");
  const cleaned = normalized.replace(new RegExp(UNSAFE_TEXT.source, "g"), "");
  return [cleaned, normalized.length - cleaned.length];
}

/**
 * Express R.A.I.N.'s session artifact for one model meeting in `rain-bethesda/v2`.
 *
 * The turns are the model's words as the artifact recorded them. The quotes
 * are the ones the citation check verified, each checked again here against
 * the same corpus. Nothing the offline engine computes and this meeting does
 * not — grounding, terms, a verdict — is filled in. `modelStopped` means the
 * model stopped answering and the meeting was ended early: it is still
 * recorded as completed, and the record says where it stopped.
 */
export function modelMeetingRecord(input: {
  artifact: SessionArtifact;
  artifactText: string;
  question: string;
  requestId: string;
  revision: Revision;
  documents: readonly CorpusDocument[];
  modelStopped?: boolean;
}): MeetingRecord {
  const { artifact, question, requestId, revision } = input;
  if (artifact.schema_version !== RAIN_SESSION_ARTIFACT_SCHEMA)
    throw new MeetingFailed("R.A.I.N.'s record of the meeting is not a session artifact");
  if (artifact.status !== "completed" && artifact.status !== "interrupted")
    throw new MeetingFailed("R.A.I.N. did not finish the meeting");
  if (artifact.topic !== question)
    throw new MeetingFailed(
      "R.A.I.N.'s record of the meeting names a different question",
    );
  const model = artifact.model;
  if (typeof model !== "string" || !MODEL_ID.test(model))
    throw new MeetingFailed("R.A.I.N.'s record names no usable model");
  const session = artifact.session_id;
  if (typeof session !== "string" || !/^[A-Za-z0-9_-]{4,64}$/.test(session))
    throw new MeetingFailed("R.A.I.N.'s record has no session id");
  const docs = documentMap(input.documents);
  const turns: RecordTurn[] = [];
  for (const entry of artifact.turns ?? []) {
    const agent = entry.agent;
    const content = entry.content;
    // Process hints ("SYSTEM") are not a perspective's turn.
    if (!isPerspective(agent) || typeof content !== "string" || !content.trim()) continue;
    const meta = entry.metadata ?? {};
    let unverified = Number.isInteger(meta.unverified_count) ? meta.unverified_count : 0;
    const quotes: RecordQuote[] = [];
    for (const ev of entry.grounded_response?.evidence ?? []) {
      const text = ev?.quote;
      if (typeof text !== "string" || !text.trim()) continue;
      if (
        text.length > TURN_LIMITS.quoteText ||
        quotes.length >= TURN_LIMITS.quotesPerTurn ||
        UNSAFE_TEXT.test(text)
      ) {
        unverified += 1; // cannot be carried as checked
        continue;
      }
      const match = verifyQuote(docs, text);
      if (match === null) {
        unverified += 1;
        continue;
      }
      quotes.push({
        source: match.source,
        line: countBefore(docs.get(match.source)!, "\n", match.spanStart) + 1,
        span_start: match.spanStart,
        span_end: match.spanEnd,
        text,
        verified: true,
      });
    }
    const trimmed = content.trim();
    const closing = trimmed === CLOSING_LINE;
    const placeholder = !closing && isPlaceholderLine(trimmed);
    const [cleaned, removed] = cleanText(content);
    let lead = cleaned;
    const coda: string[] = [];
    if (removed)
      coda.push(
        `The runtime removed ${removed} invisible control character(s) from this turn.`,
      );
    if (lead.length > TURN_LIMITS.turnText) {
      lead = lead.slice(0, TURN_LIMITS.turnText - 2).trimEnd() + " …";
      coda.push("The runtime shortened this turn to the lab's 4,000-character limit.");
    }
    turns.push({
      index: turns.length + 1,
      speaker: agent,
      role: MODEL_ROLES[agent] ?? "role not stated",
      move: closing
        ? "closes the meeting"
        : placeholder
          ? "stands in for an unusable answer"
          : "speaks",
      lead,
      quotes,
      coda: coda.join(" "),
      unverified: Math.min(unverified, 100),
      generation: closing || placeholder ? "scripted" : "model",
    });
  }
  if (!turns.some((t) => t.generation === "model"))
    throw new MeetingFailed(
      "R.A.I.N.'s meeting recorded no turn from the model" +
        (input.modelStopped ? " before the model stopped answering" : ""),
    );
  if (input.modelStopped) {
    const last = [...turns].reverse().find((t) => t.move !== "closes the meeting")!;
    last.coda = [
      last.coda,
      "The model stopped answering after this turn, and R.A.I.N. ended the meeting early (it could not generate a response after its retries); it still records the meeting as completed.",
    ]
      .filter(Boolean)
      .join(" ");
  }
  if (turns.length > TURN_LIMITS.turns)
    throw new MeetingFailed(
      `R.A.I.N.'s meeting ran past the lab's ${TURN_LIMITS.turns} turns`,
    );
  const checked = turns.flatMap((t) => t.quotes);
  const corpusRows = artifact.corpus_files ?? [];
  const completed = artifact.completed_at;
  return {
    schema: RAIN_BETHESDA_SCHEMA,
    kind: "meeting",
    request_id: requestId,
    meeting_id: `rain-model-${session}`,
    question,
    generation: "model",
    engine: MODEL_ENGINE,
    model,
    grounding: null,
    matched_terms: null,
    missing_terms: null,
    turns,
    verdict: null,
    audit: {
      checked: checked.length,
      verified: checked.filter((q) => q.verified).length,
      corpus_files: corpusRows.length,
      corpus_sha256: sha256(
        corpusRows.map((row) => `${row.path}\0${row.sha256}\n`).join(""),
      ),
    },
    suggestions: [],
    rain: revision,
    produced_at: typeof completed === "string" && completed ? completed : nowIso(),
    source_artifact: {
      schema: RAIN_SESSION_ARTIFACT_SCHEMA,
      session_id: session,
      status: artifact.status,
      sha256: sha256(input.artifactText),
    },
  };
}
