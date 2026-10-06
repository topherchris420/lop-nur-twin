/**
 * The names and bounds shared by the research runtime (`src/rain/`), the
 * `/api/rain/*` route and the Bethesda lab's browser code — the parts of the
 * `rain-bethesda/v2` vocabulary that have to agree on both sides of the route.
 * The lab's full wire contract is `src/bethesda/rain/contracts.ts`.
 *
 * Imports nothing, so the browser bundle that needs a schema string never
 * pulls in a corpus or an engine.
 */

export const RAIN_BETHESDA_SCHEMA = "rain-bethesda/v2" as const;
/** R.A.I.N.'s own record of a model meeting (`src/rain/meeting/artifact.ts`). */
export const RAIN_SESSION_ARTIFACT_SCHEMA = "rain-session-artifact/v1" as const;
/** The R.A.I.N. code paths a meeting record names. */
export const OFFLINE_ENGINE = "rain.meeting.offline.buildOfflineMeeting" as const;
export const MODEL_ENGINE = "rain.meeting.model.holdMeeting" as const;

/** The lab's limits for one meeting turn; `contracts.ts` LIMITS carries the same numbers. */
export const TURN_LIMITS = {
  /** R.A.I.N.'s default model meeting is 25 turns and its closing line. */
  turns: 32,
  quotesPerTurn: 12,
  turnText: 4000,
  quoteText: 800,
} as const;

/**
 * Control characters other than newline and tab, the bidirectional overrides
 * and marks that let text read differently from what it contains, and the
 * invisible separators two runtimes disagree about splitting on. Research
 * prose has no use for any of them, so their presence rejects the message.
 * Written as escapes: the source must never contain the characters it bans.
 */
export const UNSAFE_TEXT =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u0085\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/;

/**
 * The model-id shape the city's Jev proposals already use — Ollama's
 * `qwen2.5:7b`, LM Studio's `publisher/model` — and never a URL.
 */
export const MODEL_ID = /^(?!.*:\/\/)[a-zA-Z0-9][a-zA-Z0-9._/:-]{0,95}$/;
/** A git repository as `owner/name`. */
export const REPOSITORY = /^[A-Za-z0-9_.-]{1,64}\/[A-Za-z0-9_.-]{1,100}$/;
