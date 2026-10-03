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
  validateMeeting,
  validatePreregistration,
  validateProposalChoice,
  type Checked,
} from "../../src/bethesda/rain/validation.js";
import {
  isSameOrigin,
  json,
  readBody,
  SESSION_ID,
  type RequestMeta,
} from "../jev/handler.js";
import { RateLimiter } from "../jev/rateLimit.js";

/**
 * `/api/rain/*` — the only route between the browser and a R.A.I.N. backend.
 *
 * The backend address and its optional bearer token are server environment
 * (`RAIN_BACKEND_URL`, `RAIN_BACKEND_TOKEN`), read by the entry points and
 * passed in; neither ever reaches the browser, a response or a log. The
 * browser sends small, same-origin, closed JSON bodies; this handler composes
 * the upstream request itself, bounds the time and bytes of the answer, and
 * validates the answer with the same shared validators the browser applies
 * again — so a malformed, oversized, stale or mismatched answer never leaves
 * the server. It is not a proxy: the browser cannot choose the upstream path,
 * headers or body beyond the declared fields.
 *
 *   GET  /api/rain/status       configured? reachable? R.A.I.N.'s identity
 *   POST /api/rain/meeting      one Research Panel meeting
 *   POST /api/rain/proposal     R.A.I.N.'s bounded choice among host options
 *   POST /api/rain/preregister  register an experiment draft with R.A.I.N.
 *   POST /api/rain/submission   report a run; R.A.I.N. evaluates it
 *
 * Without a valid `RAIN_BACKEND_URL` every route answers "not configured" and
 * the lab runs OFFLINE. Nothing here ever substitutes demo content.
 */

export interface RainServerConfig {
  /** `RAIN_BACKEND_URL`: https, or http on a loopback host. */
  backendUrl: string | undefined;
  /** `RAIN_BACKEND_TOKEN`: sent upstream as a bearer token and nowhere else. */
  token: string | undefined;
  /** `RAIN_TIMEOUT_MS`, clamped to [1000, 55000]. */
  timeoutMs?: string | number | undefined;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

const OPS = ["status", "meeting", "proposal", "preregister", "submission"] as const;
type Op = (typeof OPS)[number];
const REQUEST_BYTES: Record<Exclude<Op, "status">, number> = {
  meeting: LIMITS.meetingRequest,
  proposal: LIMITS.proposalRequest,
  preregister: LIMITS.preregisterRequest,
  submission: LIMITS.submissionRequest,
};
const RESPONSE_BYTES: Record<Op, number> = {
  status: LIMITS.identityResponse,
  meeting: LIMITS.meetingResponse,
  proposal: LIMITS.proposalResponse,
  preregister: LIMITS.preregistrationResponse,
  submission: LIMITS.admissionResponse,
};
/** Minimum interval between one session's requests, per operation. */
const SESSION_INTERVAL_MS: Record<Exclude<Op, "status">, number> = {
  meeting: 15_000,
  proposal: 5_000,
  preregister: 2_000,
  submission: 2_000,
};
const SESSION_CAPS: Record<Exclude<Op, "status">, number> = {
  meeting: LIMITS.meetingsPerSession,
  proposal: 24,
  preregister: 24,
  submission: 24,
};
const DRAFT_FIELDS = [
  "title",
  "question",
  "hypothesis",
  "rationale",
  "subsystem",
  "created_by",
  "evidence_class",
  "runner",
  "seed",
  "parameters",
  "procedure",
  "variables",
  "metrics",
  "criteria",
  "dependencies",
  "data_policy",
  "limitations",
];

/** A usable backend base URL, or null. Credentials, queries and fragments are refused. */
export function resolveBackend(value: string | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) return null;
  if (url.username || url.password || url.search || url.hash) return null;
  return url.origin + url.pathname.replace(/\/+$/, "");
}

const error = (status: number, code: string, extra: Record<string, unknown> = {}) =>
  json(status, { schema: RAIN_BETHESDA_SCHEMA, kind: "error", error: code, ...extra });

async function readLimited(response: Response, limit: number): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(out);
}

export function createRainHandler(config: RainServerConfig) {
  const base = resolveBackend(config.backendUrl);
  const token = config.token?.trim() || null;
  const fetchImpl = config.fetchImpl ?? fetch;
  const now = config.now ?? (() => Date.now());
  const timeout = Math.max(1000, Math.min(55_000, Number(config.timeoutMs) || 20_000));
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

  /** One upstream call: fixed path, server-composed body, bounded time and bytes. */
  async function upstream(
    op: Op,
    body: unknown,
    ms: number,
  ): Promise<{ ok: true; value: unknown } | { ok: false; status: number; code: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
      const headers: Record<string, string> = { Accept: "application/json" };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const response = await fetchImpl(
        `${base}/rain-bethesda/v1/${op === "status" ? "identity" : op}`,
        {
          method: body === undefined ? "GET" : "POST",
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
          redirect: "error",
        },
      );
      const text = await readLimited(response, RESPONSE_BYTES[op]);
      if (text === null)
        return { ok: false, status: 502, code: "upstream answer too large" };
      if (!response.ok) {
        // A R.A.I.N. refusal (422) carries R.A.I.N.'s reason; pass it on only
        // as bounded, plain text. Anything else is a generic failure.
        if (response.status === 422) {
          try {
            const reason = (JSON.parse(text) as { error?: unknown }).error;
            if (typeof reason === "string" && reason.length <= 400 && !unsafeText(reason))
              return { ok: false, status: 422, code: reason };
          } catch {
            /* fall through */
          }
          return { ok: false, status: 422, code: "refused by R.A.I.N." };
        }
        return {
          ok: false,
          status: response.status === 401 ? 502 : 503,
          code: response.status === 401 ? "backend rejected credentials" : "unavailable",
        };
      }
      try {
        return { ok: true, value: JSON.parse(text) as unknown };
      } catch {
        return { ok: false, status: 502, code: "invalid upstream answer" };
      }
    } catch {
      return controller.signal.aborted
        ? { ok: false, status: 504, code: "timeout" }
        : { ok: false, status: 503, code: "unavailable" };
    } finally {
      clearTimeout(timer);
    }
  }

  async function status(): Promise<Response> {
    if (!base)
      return json(200, {
        schema: RAIN_BETHESDA_SCHEMA,
        kind: "status",
        configured: false,
        reachable: null,
        identity: null,
        failure: config.backendUrl?.trim() ? "misconfigured" : null,
      });
    if (!identity || now() - identity.at > 30_000) {
      const answer = await upstream("status", undefined, Math.min(timeout, 4000));
      if (!answer.ok)
        return json(200, {
          schema: RAIN_BETHESDA_SCHEMA,
          kind: "status",
          configured: true,
          reachable: false,
          identity: null,
          failure: answer.code,
        });
      const checked = validateIdentity(answer.value);
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

  type Plan = { body: unknown; check: (v: unknown) => Checked<unknown> };
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
        body: {
          schema: RAIN_BETHESDA_SCHEMA,
          kind: "meeting-request",
          request_id: requestId,
          question,
        },
        check: (a) => validateMeeting(a, { requestId, question }),
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
      const optionIds = (options as { id: string }[]).map((o) => o.id);
      if (new Set(optionIds).size !== optionIds.length) return "invalid options";
      return {
        body: {
          schema: RAIN_BETHESDA_SCHEMA,
          kind: "proposal-request",
          request_id: requestId,
          question,
          options,
        },
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
        body: {
          schema: RAIN_BETHESDA_SCHEMA,
          kind: "preregister-request",
          request_id: requestId,
          draft,
        },
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
      // R.A.I.N. evaluates; a submission that brings its own verdict is refused.
      "status" in submission ||
      "verdict" in submission ||
      "hypothesis_verdict" in submission
    )
      return "invalid submission";
    return {
      body: {
        schema: RAIN_BETHESDA_SCHEMA,
        kind: "submission-request",
        request_id: requestId,
        experiment_id: experimentId,
        submission,
      },
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
    if (!base) return error(503, "not configured");
    const refused = admit(op, v.session, meta.clientKey);
    if (refused) return error(429, refused);
    if (!limiter.admitUpstream().ok) return error(429, "busy");
    try {
      const answer = await upstream(op, planned.body, timeout);
      if (!answer.ok) return error(answer.status, answer.code);
      const checked = planned.check(answer.value);
      if (!checked.ok)
        return error(502, "invalid upstream answer", {
          reasons: checked.errors.slice(0, 5),
        });
      if (utf8Length(JSON.stringify(checked.value)) > RESPONSE_BYTES[op])
        return error(502, "upstream answer too large");
      return json(200, checked.value);
    } finally {
      limiter.release();
    }
  };
}
