/**
 * The browser's only R.A.I.N. client. It talks to this site's `/api/rain/*`
 * routes and nothing else — the CSP allows no other origin, and the backend
 * address and token live on the server.
 *
 * Every answer is validated again here with the shared validators, bound to
 * the request that asked for it, and bounded in size and time. A failure is a
 * typed failure — NOT CONFIGURED, UNAVAILABLE, TIMEOUT, RATE LIMITED, SESSION
 * LIMIT, REFUSED, INVALID ANSWER, ERROR — and never a substitute: this module
 * cannot reach the DEMO recording (a test asserts it does not import it), so
 * LIVE cannot quietly fall back to it.
 */
import {
  LIMITS,
  type Admission,
  type MeetingRecord,
  type Preregistration,
  type ProposalChoice,
  type ProposalOption,
  type RainIdentity,
} from "./contracts";
import {
  normalizeQuestion,
  parseBounded,
  validateAdmission,
  validateIdentity,
  validateMeeting,
  validatePreregistration,
  validateProposalChoice,
  type Checked,
} from "./validation";

export type Failure =
  | "NOT CONFIGURED"
  | "UNAVAILABLE"
  | "TIMEOUT"
  | "RATE LIMITED"
  | "SESSION LIMIT"
  | "REFUSED"
  | "INVALID ANSWER"
  | "ERROR";
export type Result<T> =
  { ok: true; value: T } | { ok: false; failure: Failure; detail: string };
export interface RuntimeStatus {
  configured: boolean;
  reachable: boolean | null;
  identity: RainIdentity | null;
  failure: string | null;
}

export const hex = (bytes: number) =>
  [...crypto.getRandomValues(new Uint8Array(bytes))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

const STATUS_TIMEOUT = 8000;
const CALL_TIMEOUT = 60000;

export class RainClient {
  readonly session = hex(16);
  readonly startedAt = Date.now();
  meetings = 0;
  private readonly fetchImpl: typeof fetch;
  constructor(fetchImpl: typeof fetch = (...args) => fetch(...args)) {
    this.fetchImpl = fetchImpl;
  }

  /** Bounded session: a number of meetings, and a wall-clock lifetime. */
  sessionOpen(now = Date.now()): string | null {
    if (this.meetings >= LIMITS.meetingsPerSession)
      return `this research session has held ${LIMITS.meetingsPerSession} meetings; start a new session`;
    if (now - this.startedAt > LIMITS.sessionMinutes * 60_000)
      return `this research session is older than ${LIMITS.sessionMinutes} minutes; start a new session`;
    return null;
  }

  private async call(
    path: string,
    init: RequestInit | null,
    limit: number,
    timeout: number,
  ): Promise<Result<unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await this.fetchImpl(`/api/rain/${path}`, {
        ...(init ?? {}),
        headers: init ? { "Content-Type": "application/json" } : undefined,
        signal: controller.signal,
        credentials: "same-origin",
      });
      const text = await response.text();
      const parsed = parseBounded(text, limit + 2048);
      if (!response.ok) {
        const code =
          parsed.ok && parsed.value && typeof parsed.value === "object"
            ? String((parsed.value as { error?: unknown }).error ?? "").slice(0, 300)
            : "";
        const failure: Failure =
          response.status === 503 && code === "not configured"
            ? "NOT CONFIGURED"
            : response.status === 504
              ? "TIMEOUT"
              : response.status === 429
                ? code === "session limit reached"
                  ? "SESSION LIMIT"
                  : "RATE LIMITED"
                : response.status === 422
                  ? "REFUSED"
                  : response.status === 502 && code.startsWith("invalid upstream")
                    ? "INVALID ANSWER"
                    : response.status === 503 || response.status === 502
                      ? "UNAVAILABLE"
                      : "ERROR";
        return { ok: false, failure, detail: code || `HTTP ${response.status}` };
      }
      if (!parsed.ok)
        return { ok: false, failure: "INVALID ANSWER", detail: parsed.errors[0]! };
      return { ok: true, value: parsed.value };
    } catch {
      return controller.signal.aborted
        ? { ok: false, failure: "TIMEOUT", detail: "no answer in time" }
        : { ok: false, failure: "UNAVAILABLE", detail: "network error" };
    } finally {
      clearTimeout(timer);
    }
  }

  private checked<T>(
    result: Result<unknown>,
    check: (v: unknown) => Checked<T>,
  ): Result<T> {
    if (!result.ok) return result;
    const v = check(result.value);
    return v.ok
      ? v
      : { ok: false, failure: "INVALID ANSWER", detail: v.errors.slice(0, 3).join("; ") };
  }

  async status(): Promise<Result<RuntimeStatus>> {
    const r = await this.call("status", null, LIMITS.identityResponse, STATUS_TIMEOUT);
    if (!r.ok) return r;
    const s = r.value as Partial<RuntimeStatus> & { schema?: unknown; kind?: unknown };
    if (!s || s.kind !== "status" || typeof s.configured !== "boolean")
      return { ok: false, failure: "INVALID ANSWER", detail: "malformed status" };
    let identity: RainIdentity | null = null;
    if (s.identity !== null && s.identity !== undefined) {
      const v = validateIdentity(s.identity);
      if (!v.ok) return { ok: false, failure: "INVALID ANSWER", detail: v.errors[0]! };
      identity = v.value;
    }
    return {
      ok: true,
      value: {
        configured: s.configured,
        reachable: typeof s.reachable === "boolean" ? s.reachable : null,
        identity,
        failure: typeof s.failure === "string" ? s.failure.slice(0, 120) : null,
      },
    };
  }

  async meeting(question: string): Promise<Result<MeetingRecord>> {
    const closed = this.sessionOpen();
    if (closed) return { ok: false, failure: "SESSION LIMIT", detail: closed };
    const q = normalizeQuestion(question);
    if (!q || q.length > LIMITS.question)
      return { ok: false, failure: "ERROR", detail: "a question of 1 to 500 characters" };
    const requestId = hex(16);
    this.meetings++;
    const r = await this.call(
      "meeting",
      {
        method: "POST",
        body: JSON.stringify({
          session: this.session,
          request_id: requestId,
          question: q,
        }),
      },
      LIMITS.meetingResponse,
      CALL_TIMEOUT,
    );
    return this.checked(r, (v) => validateMeeting(v, { requestId, question: q }));
  }

  async proposal(
    question: string,
    options: ProposalOption[],
  ): Promise<Result<ProposalChoice>> {
    const requestId = hex(16);
    const r = await this.call(
      "proposal",
      {
        method: "POST",
        body: JSON.stringify({
          session: this.session,
          request_id: requestId,
          question: normalizeQuestion(question),
          options,
        }),
      },
      LIMITS.proposalResponse,
      CALL_TIMEOUT,
    );
    return this.checked(r, (v) =>
      validateProposalChoice(v, { requestId, optionIds: options.map((o) => o.id) }),
    );
  }

  async preregister(draft: unknown): Promise<Result<Preregistration>> {
    const requestId = hex(16);
    const r = await this.call(
      "preregister",
      {
        method: "POST",
        body: JSON.stringify({ session: this.session, request_id: requestId, draft }),
      },
      LIMITS.preregistrationResponse,
      CALL_TIMEOUT,
    );
    return this.checked(r, (v) => validatePreregistration(v, { requestId }));
  }

  async submit(experimentId: string, submission: unknown): Promise<Result<Admission>> {
    const requestId = hex(16);
    const body = JSON.stringify({
      session: this.session,
      request_id: requestId,
      experiment_id: experimentId,
      submission,
    });
    if (body.length > LIMITS.submissionRequest)
      return {
        ok: false,
        failure: "ERROR",
        detail: "submission exceeds the request limit",
      };
    const r = await this.call(
      "submission",
      { method: "POST", body },
      LIMITS.admissionResponse,
      CALL_TIMEOUT,
    );
    return this.checked(r, (v) => validateAdmission(v, { requestId, experimentId }));
  }
}
