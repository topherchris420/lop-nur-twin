/**
 * The browser's only R.A.I.N. client. It talks to this site's `/api/rain/*`
 * routes and nothing else — the CSP allows no other origin, and the research
 * runtime, with any model-server address or key, lives on the server.
 *
 * Every answer is validated again here with the shared validators, bound to
 * the request that asked for it, and bounded in size and time. A failure is a
 * typed failure — NOT CONFIGURED, UNAVAILABLE, TIMEOUT, RATE LIMITED, SESSION
 * LIMIT, REFUSED, INVALID ANSWER, FAILED, CANCELLED, ERROR — and never a
 * substitute: this module
 * cannot reach the DEMO recording (a test asserts it does not import it), so
 * LIVE cannot quietly fall back to it.
 */
import {
  LIMITS,
  type Admission,
  type MeetingRecord,
  type PreregistrationAnswer,
  type RegistryReceipt,
  type ProposalChoice,
  type ProposalOption,
  type RainIdentity,
} from "./contracts";
import {
  normalizeQuestion,
  parseBounded,
  validateAdmission,
  validateIdentity,
  validateMeetingAnswer,
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
  | "FAILED"
  | "CANCELLED"
  | "ERROR";
/** A model meeting in progress, as R.A.I.N.'s console reports it. Progress, not evidence. */
export interface MeetingProgress {
  jobId: string;
  model: string;
  elapsedS: number;
  turnsStarted: number;
  turnsPlanned: number;
}
export interface MeetingOptions {
  onProgress?: (p: MeetingProgress) => void;
  signal?: AbortSignal;
  /** How often to check on a model meeting. */
  pollMs?: number;
}
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
const POLL_MS = 3000;

/** Resolves after `ms`, or as soon as `signal` aborts. */
const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });

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
                ? code === "session limit reached" || code === "address limit reached"
                  ? "SESSION LIMIT"
                  : "RATE LIMITED"
                : response.status === 422
                  ? "REFUSED"
                  : response.status === 502 &&
                      (code.startsWith("invalid runtime") ||
                        code.startsWith("runtime answer too large"))
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

  /**
   * One meeting. The offline engine answers at once. A model meeting answers
   * with a job, which is checked every few seconds until R.A.I.N. returns the
   * meeting or says why it could not — each answer validated against this
   * request. Aborting asks R.A.I.N. to stop the job; so does giving up after
   * `LIMITS.meetingJobMinutes`. Nothing stands in for a meeting that did not
   * arrive.
   */
  async meeting(
    question: string,
    options: MeetingOptions = {},
  ): Promise<Result<MeetingRecord>> {
    const closed = this.sessionOpen();
    if (closed) return { ok: false, failure: "SESSION LIMIT", detail: closed };
    const q = normalizeQuestion(question);
    if (!q || q.length > LIMITS.question)
      return { ok: false, failure: "ERROR", detail: "a question of 1 to 500 characters" };
    const requestId = hex(16);
    this.meetings++;
    const started = Date.now();
    let answer = this.checked(
      await this.call(
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
      ),
      (v) => validateMeetingAnswer(v, { requestId, question: q }),
    );
    for (;;) {
      if (!answer.ok) return answer;
      const a = answer.value;
      if (a.kind === "meeting") return { ok: true, value: a };
      if (a.kind === "meeting-failed")
        return { ok: false, failure: "FAILED", detail: a.reason };
      options.onProgress?.({
        jobId: a.job_id,
        model: a.model,
        elapsedS: a.elapsed_s,
        turnsStarted: a.turns_started,
        turnsPlanned: a.turns_planned,
      });
      await wait(options.pollMs ?? POLL_MS, options.signal);
      if (options.signal?.aborted) {
        await this.cancelMeeting(requestId, a.job_id);
        return { ok: false, failure: "CANCELLED", detail: "the meeting was stopped" };
      }
      if (Date.now() - started > LIMITS.meetingJobMinutes * 60_000) {
        await this.cancelMeeting(requestId, a.job_id);
        return {
          ok: false,
          failure: "TIMEOUT",
          detail: `no meeting after ${LIMITS.meetingJobMinutes} minutes`,
        };
      }
      const jobId = a.job_id;
      const next = this.checked(
        await this.call(
          "meeting-status",
          {
            method: "POST",
            body: JSON.stringify({
              session: this.session,
              request_id: requestId,
              job_id: jobId,
              question: q,
            }),
          },
          LIMITS.meetingResponse,
          CALL_TIMEOUT,
        ),
        (v) => validateMeetingAnswer(v, { requestId, question: q, jobId }),
      );
      // Being paced is not an answer: check again, with the same job.
      answer = !next.ok && next.failure === "RATE LIMITED" ? answer : next;
    }
  }

  /** Ask R.A.I.N. to stop a model meeting. Best effort: the outcome is a stop, not a record. */
  async cancelMeeting(requestId: string, jobId: string): Promise<void> {
    await this.call(
      "meeting-cancel",
      {
        method: "POST",
        body: JSON.stringify({
          session: this.session,
          request_id: requestId,
          job_id: jobId,
        }),
      },
      LIMITS.meetingJobResponse,
      STATUS_TIMEOUT,
    );
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

  async preregister(draft: unknown): Promise<Result<PreregistrationAnswer>> {
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

  /**
   * Report a run. With the receipt of its pre-registration, whichever instance
   * of the registry the request reaches can check it against the definition
   * that was registered.
   */
  async submit(
    experimentId: string,
    submission: unknown,
    receipt: RegistryReceipt | null = null,
  ): Promise<Result<Admission>> {
    const requestId = hex(16);
    const body = JSON.stringify({
      session: this.session,
      request_id: requestId,
      experiment_id: experimentId,
      submission,
      ...(receipt ? { preregistration: receipt } : {}),
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
