import {
  HEX32,
  LIMITS,
  RAIN_BETHESDA_SCHEMA,
  RAIN_EXPERIMENT_ID,
  RAIN_SUBMISSION_SCHEMA,
} from "../../src/bethesda/rain/contracts.js";
import {
  normalizeQuestion,
  unsafeText,
  utf8Length,
  validateAdmission,
  validateIdentity,
  validateMeetingAnswer,
  validateMeetingFailed,
  validatePreregistration,
  validateProposalChoice,
  type Checked,
} from "../../src/bethesda/rain/validation.js";
import { Refused } from "../../src/rain/errors.js";
import { DRAFT_FIELDS, type RuntimeConfiguration } from "../../src/rain/runtime.js";
import {
  isSameOrigin,
  json,
  readBody,
  SESSION_ID,
  type RequestMeta,
} from "../jev/handler.js";
import { RateLimiter } from "../jev/rateLimit.js";

/**
 * `/api/rain/*` — the only route between the browser and the R.A.I.N. research
 * runtime, which runs in this process (`src/rain/runtime.ts`).
 *
 * The browser sends small, same-origin, closed JSON bodies; this handler
 * checks every field, paces and caps each session, calls the runtime, and
 * validates the runtime's answer with the same shared validators the browser
 * applies again — so a malformed, oversized or mismatched answer never leaves
 * the server even if the runtime had a bug. It is not a proxy: nothing the
 * browser sends chooses a path, a file, a model or a command.
 *
 *   GET  /api/rain/status          switched on? the runtime's identity
 *   POST /api/rain/meeting         one Research Panel meeting, or a model
 *                                  meeting's job (`meeting-pending`)
 *   POST /api/rain/meeting-status  that job: still pending, the meeting, or why
 *                                  it failed
 *   POST /api/rain/meeting-cancel  stop that job
 *   POST /api/rain/proposal        R.A.I.N.'s bounded choice among host options
 *   POST /api/rain/preregister     register an experiment draft
 *   POST /api/rain/submission      report a run; the registry evaluates it
 *
 * With `RAIN_RUNTIME=off`, or a runtime that could not be configured, every
 * route answers "not configured" and the lab runs OFFLINE. Nothing here ever
 * substitutes demo content.
 */

export interface RainServerConfig {
  /** The configured runtime, from `configureRuntime`; resolved once and kept. */
  runtime: RuntimeConfiguration | Promise<RuntimeConfiguration>;
  now?: () => number;
}

const OPS = [
  "status",
  "meeting",
  "meeting-status",
  "meeting-cancel",
  "proposal",
  "preregister",
  "submission",
] as const;
type Op = (typeof OPS)[number];
const REQUEST_BYTES: Record<Exclude<Op, "status">, number> = {
  meeting: LIMITS.meetingRequest,
  "meeting-status": LIMITS.meetingRequest,
  "meeting-cancel": LIMITS.meetingJobRequest,
  proposal: LIMITS.proposalRequest,
  preregister: LIMITS.preregisterRequest,
  submission: LIMITS.submissionRequest,
};
const RESPONSE_BYTES: Record<Op, number> = {
  status: LIMITS.identityResponse,
  meeting: LIMITS.meetingResponse,
  "meeting-status": LIMITS.meetingResponse,
  "meeting-cancel": LIMITS.meetingJobResponse,
  proposal: LIMITS.proposalResponse,
  preregister: LIMITS.preregistrationResponse,
  submission: LIMITS.admissionResponse,
};
/** Minimum interval between one session's requests, per operation. */
const SESSION_INTERVAL_MS: Record<Exclude<Op, "status">, number> = {
  meeting: 15_000,
  "meeting-status": 2_000,
  "meeting-cancel": 1_000,
  proposal: 5_000,
  preregister: 2_000,
  submission: 2_000,
};
const SESSION_CAPS: Record<Exclude<Op, "status">, number> = {
  meeting: LIMITS.meetingsPerSession,
  // A session lasts at most sessionMinutes; at one check every two seconds.
  "meeting-status": (LIMITS.sessionMinutes * 60) / 2,
  "meeting-cancel": LIMITS.meetingsPerSession,
  proposal: 24,
  preregister: 24,
  submission: 24,
};
/** A proposal may wait on a remote engine; everything else answers at once. */
const OPERATION_TIMEOUT_MS = 25_000;

const error = (status: number, code: string, extra: Record<string, unknown> = {}) =>
  json(status, { schema: RAIN_BETHESDA_SCHEMA, kind: "error", error: code, ...extra });

export function createRainHandler(config: RainServerConfig) {
  const configured = Promise.resolve(config.runtime);
  const now = config.now ?? (() => Date.now());
  const limiter = new RateLimiter(
    {
      perClient: { capacity: 12, refillPerSecond: 0.5 },
      global: { capacity: 20, refillPerSecond: 2 },
      sessionMinIntervalMs: 0,
      maxInFlight: 2,
      maxTrackedKeys: 5000,
    },
    now,
  );
  const sessionLast = new Map<string, number>();
  const sessionCount = new Map<string, number>();
  let identity: { at: number; body: unknown } | null = null;

  async function status(): Promise<Response> {
    const c = await configured;
    if (c.mode !== "local")
      return json(200, {
        schema: RAIN_BETHESDA_SCHEMA,
        kind: "status",
        configured: false,
        reachable: null,
        identity: null,
        // The reason names a setting, never a value; the browser shows it as text.
        failure: c.mode === "misconfigured" ? `misconfigured: ${c.reason}` : null,
      });
    if (!identity || now() - identity.at > 30_000) {
      const checked = validateIdentity(c.runtime.identity());
      if (!checked.ok)
        return json(200, {
          schema: RAIN_BETHESDA_SCHEMA,
          kind: "status",
          configured: true,
          reachable: true,
          identity: null,
          failure: "invalid identity",
        });
      identity = { at: now(), body: checked.value };
    }
    return json(200, {
      schema: RAIN_BETHESDA_SCHEMA,
      kind: "status",
      configured: true,
      reachable: true,
      identity: identity.body,
      failure: null,
    });
  }

  /** Session pacing and caps; the client bucket and global budget come first. */
  function admit(op: Exclude<Op, "status">, session: string, client: string) {
    if (!limiter.admitClient(client).ok) return "rate limited";
    const key = `${op}:${session}`;
    const last = sessionLast.get(key);
    if (last !== undefined && now() - last < SESSION_INTERVAL_MS[op])
      return "rate limited";
    const count = sessionCount.get(key) ?? 0;
    if (count >= SESSION_CAPS[op]) return "session limit reached";
    if (sessionLast.size > 5000) {
      sessionLast.clear();
      sessionCount.clear();
    }
    sessionLast.set(key, now());
    sessionCount.set(key, count + 1);
    return null;
  }

  type Runtime = Extract<RuntimeConfiguration, { mode: "local" }>["runtime"];
  type Plan = {
    run: (runtime: Runtime) => Promise<unknown> | unknown;
    check: (v: unknown) => Checked<unknown>;
  };
  /** Check a request's closed fields and plan the runtime call and the answer's check. */
  function plan(op: Exclude<Op, "status">, v: Record<string, unknown>): Plan | string {
    const requestId = v.request_id;
    if (typeof requestId !== "string" || !HEX32.test(requestId))
      return "invalid request id";
    if (op === "meeting") {
      if (Object.keys(v).sort().join() !== "question,request_id,session")
        return "unexpected fields";
      if (typeof v.question !== "string" || unsafeText(v.question))
        return "invalid question";
      const question = normalizeQuestion(v.question);
      if (!question || question.length > LIMITS.question) return "invalid question";
      return {
        run: (runtime) => runtime.meeting(question, requestId),
        // The offline engine answers at once; a model meeting answers with a
        // job to check on. Either way the answer is bound to this request.
        check: (a) => {
          const answer = validateMeetingAnswer(a, { requestId, question });
          return answer.ok && answer.value.kind === "meeting-failed"
            ? { ok: false, errors: ["meeting: a failure answers a job, not a request"] }
            : answer;
        },
      };
    }
    if (op === "meeting-status" || op === "meeting-cancel") {
      // A job id is a 128-bit capability, returned only to the client that
      // started the meeting. It is checked here with the request it belongs
      // to, so a status answer is validated against that request's question.
      const fields =
        op === "meeting-status"
          ? "job_id,question,request_id,session"
          : "job_id,request_id,session";
      if (Object.keys(v).sort().join() !== fields) return "unexpected fields";
      const jobId = v.job_id;
      if (typeof jobId !== "string" || !HEX32.test(jobId)) return "invalid job id";
      if (op === "meeting-cancel")
        return {
          run: (runtime) => runtime.meetingCancel(jobId, requestId),
          check: (a) => validateMeetingFailed(a, { requestId, jobId }),
        };
      if (typeof v.question !== "string" || unsafeText(v.question))
        return "invalid question";
      const question = normalizeQuestion(v.question);
      if (!question || question.length > LIMITS.question) return "invalid question";
      return {
        run: (runtime) => runtime.meetingStatus(jobId, requestId),
        check: (a) => validateMeetingAnswer(a, { requestId, question, jobId }),
      };
    }
    if (op === "proposal") {
      if (Object.keys(v).sort().join() !== "options,question,request_id,session")
        return "unexpected fields";
      if (typeof v.question !== "string" || unsafeText(v.question))
        return "invalid question";
      const question = normalizeQuestion(v.question);
      if (!question || question.length > LIMITS.question) return "invalid question";
      const options = v.options;
      if (
        !Array.isArray(options) ||
        options.length < 2 ||
        options.length > 16 ||
        !options.every(
          (o) =>
            !!o &&
            typeof o === "object" &&
            Object.keys(o).sort().join() === "description,id" &&
            typeof (o as { id: unknown }).id === "string" &&
            /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test((o as { id: string }).id) &&
            typeof (o as { description: unknown }).description === "string" &&
            (o as { description: string }).description.length <= 500 &&
            !unsafeText((o as { description: string }).description),
        )
      )
        return "invalid options";
      const offered = options as { id: string; description: string }[];
      const optionIds = offered.map((o) => o.id);
      if (new Set(optionIds).size !== optionIds.length) return "invalid options";
      return {
        run: (runtime) => runtime.proposal(question, offered, requestId),
        check: (a) => validateProposalChoice(a, { requestId, optionIds }),
      };
    }
    if (op === "preregister") {
      if (Object.keys(v).sort().join() !== "draft,request_id,session")
        return "unexpected fields";
      const draft = v.draft;
      if (
        !draft ||
        typeof draft !== "object" ||
        Array.isArray(draft) ||
        Object.keys(draft).sort().join() !== [...DRAFT_FIELDS].sort().join() ||
        (draft as { evidence_class?: unknown }).evidence_class !== "simulated" ||
        (draft as { runner?: { kind?: unknown } }).runner?.kind !== "external"
      )
        return "invalid draft";
      return {
        run: (runtime) => runtime.preregister(draft, requestId),
        check: (a) => validatePreregistration(a, { requestId }),
      };
    }
    if (Object.keys(v).sort().join() !== "experiment_id,request_id,session,submission")
      return "unexpected fields";
    const experimentId = v.experiment_id;
    const submission = v.submission as Record<string, unknown> | null;
    if (typeof experimentId !== "string" || !RAIN_EXPERIMENT_ID.test(experimentId))
      return "invalid experiment id";
    if (
      !submission ||
      typeof submission !== "object" ||
      Array.isArray(submission) ||
      submission.schema_version !== RAIN_SUBMISSION_SCHEMA ||
      submission.experiment_id !== experimentId ||
      submission.evidence_class !== "simulated" ||
      // The registry evaluates; a submission that brings its own verdict is refused.
      "status" in submission ||
      "verdict" in submission ||
      "hypothesis_verdict" in submission
    )
      return "invalid submission";
    return {
      run: (runtime) => runtime.submission(experimentId, submission, requestId),
      check: (a) => validateAdmission(a, { requestId, experimentId }),
    };
  }

  return async (request: Request, meta: RequestMeta): Promise<Response> => {
    const op = new URL(request.url).pathname.replace(/^\/api\/rain\//, "") as Op;
    if (!OPS.includes(op)) return error(404, "not found");
    if (!isSameOrigin(request)) return error(403, "same origin required");
    if (op === "status") {
      if (request.method !== "GET") return error(405, "GET required");
      return status();
    }
    if (request.method !== "POST") return error(405, "POST required");
    if (!request.headers.get("content-type")?.includes("application/json"))
      return error(415, "JSON required");
    const raw = await readBody(request, REQUEST_BYTES[op]);
    if (raw === null) return error(413, "body too large");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return error(400, "invalid JSON");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return error(400, "invalid request");
    const v = parsed as Record<string, unknown>;
    if (typeof v.session !== "string" || !SESSION_ID.test(v.session))
      return error(400, "invalid session");
    const planned = plan(op, v);
    if (typeof planned === "string") return error(400, planned);
    const c = await configured;
    if (c.mode !== "local") return error(503, "not configured");
    const refused = admit(op, v.session, meta.clientKey);
    if (refused) return error(429, refused);
    if (!limiter.admitUpstream().ok) return error(429, "busy");
    try {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const answer = await Promise.race([
        Promise.resolve().then(() => planned.run(c.runtime)),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Refused(504, "timeout")),
            OPERATION_TIMEOUT_MS,
          );
        }),
      ]).finally(() => clearTimeout(timer));
      const checked = planned.check(answer);
      if (!checked.ok)
        return error(502, "invalid runtime answer", {
          reasons: checked.errors.slice(0, 5),
        });
      if (utf8Length(JSON.stringify(checked.value)) > RESPONSE_BYTES[op])
        return error(502, "runtime answer too large");
      return json(200, checked.value);
    } catch (e) {
      // A refusal carries a reason that is safe to show; anything else is a
      // generic failure, never a stack or a value from the environment.
      if (e instanceof Refused) return error(e.status, e.code.slice(0, 400));
      return error(500, "runtime error");
    } finally {
      limiter.release();
    }
  };
}
