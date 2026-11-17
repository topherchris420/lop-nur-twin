/**
 * `/api/rain/interop/v1/*` — the optional, least-privilege interface the
 * James desktop may use (`docs/interop/agent-interop-v1/README.md`).
 *
 * Off unless the operator configures a token for a scope; served only by the
 * local dev and preview servers (no Vercel function), only to loopback peers.
 *
 * - `read`: status and the sealed evidence of collaboration episodes already
 *   written to `docs/benchmarks/rain-collaboration/`. Runs nothing.
 * - `propose`: stores a `rain-interop-proposal/v1` in the operator's review
 *   queue (one file per proposal digest, written once). Nothing submitted
 *   here is authorized, preregistered or executed; the receipt says so.
 *
 * No route here touches the registry, a simulator, an organism, the
 * autonomy controller or any agent's memory. Tokens arrive by value from
 * `vite.config.ts`; this module reads no environment.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkRecord, INTEROP_VERSION } from "../../src/rain/interop/contract.js";

export interface InteropConfig {
  readToken?: string | undefined;
  proposeToken?: string | undefined;
  /** Where sealed `evidence-*.json` files live. */
  evidenceDir: string;
  /** Where queued proposals are written for the operator. */
  queueDir: string;
  labCommit: () => string | null;
  labDirty?: () => boolean | null;
}

export const MAX_PROPOSAL_BYTES = 16 * 1024;
export const MAX_QUEUE = 100;
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const EPISODE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/;
const usable = (t: string | undefined) =>
  t && t.trim().length >= 8 ? t.trim() : undefined;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
const fail = (status: number, code: string, message: string) =>
  json(status, { schema: "rain-interop-error/v1", code, message });

const digest = (s: string) => createHash("sha256").update(s).digest();
const same = (presented: string, expected: string) =>
  timingSafeEqual(digest(presented), digest(expected));

function evidenceFiles(dir: string): Array<Record<string, unknown>> {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => /^evidence-[A-Za-z0-9_.:-]+\.json$/.test(n))
    .sort()
    .flatMap((n) => {
      try {
        const v = JSON.parse(readFileSync(join(dir, n), "utf8")) as Record<
          string,
          unknown
        >;
        // Only a record that passes the shared schema and its own digest is served.
        return checkRecord("rain-interop-evidence/v1", v).length ? [] : [v];
      } catch {
        return [];
      }
    });
}

const queued = (dir: string) =>
  existsSync(dir)
    ? readdirSync(dir).filter((n) => /^[a-f0-9]{64}\.json$/.test(n)).length
    : 0;

export function createInteropHandler(config: InteropConfig) {
  const read = usable(config.readToken),
    propose = usable(config.proposeToken);
  return async (request: Request, meta: { clientKey: string }): Promise<Response> => {
    const url = new URL(request.url);
    if (!read && !propose)
      return fail(
        404,
        "not_configured",
        "Interop is off in this lab. Its operator turns it on with a token.",
      );
    if (!LOOPBACK.has(meta.clientKey))
      return fail(403, "not_loopback", "Interop answers only on this computer.");
    const presented = (request.headers.get("authorization") ?? "")
      .replace(/^Bearer\s+/i, "")
      .trim();
    const scopes = [
      read && same(presented, read) ? "read" : null,
      propose && same(presented, propose) ? "propose" : null,
    ].filter(Boolean);
    if (!presented || !scopes.length)
      return fail(401, "unauthorized", "A valid interop token is required.");
    const route = url.pathname.replace(/\/+$/, "");
    if (
      route === "/api/rain/interop/v1/status" ||
      route === "/api/rain/interop/v1/evidence"
    ) {
      if (request.method !== "GET") return fail(405, "method_not_allowed", "Use GET.");
      if (!scopes.includes("read"))
        return fail(403, "forbidden_scope", "This token may not read.");
      const evidence = evidenceFiles(config.evidenceDir);
      if (route === "/api/rain/interop/v1/status") {
        const commit = config.labCommit();
        return json(200, {
          schema: "rain-interop-status/v1",
          system: "rain-lab",
          interop_version: INTEROP_VERSION,
          lab: {
            commit: commit && /^[a-f0-9]{7,40}$/.test(commit) ? commit : null,
            dirty: config.labDirty?.() ?? null,
          },
          scopes_enabled: [read ? "read" : null, propose ? "propose" : null].filter(
            Boolean,
          ),
          episodes: evidence.slice(0, 64).map((e) => ({
            episode_id: e.episode_id,
            title: e.title,
            outcome: e.outcome,
            evidence_sha256: e.sha256,
          })),
          proposals_pending: queued(config.queueDir),
          limitations: [
            "Simulated evidence from this lab's numerical backend; not physical measurement.",
            "A digest shows a record is intact, not that it is true.",
          ],
        });
      }
      const episode = url.searchParams.get("episode") ?? "";
      if (
        !EPISODE.test(episode) ||
        [...url.searchParams.keys()].some((k) => k !== "episode")
      )
        return fail(400, "invalid_request", "Name one episode id.");
      const found = evidence.find((e) => e.episode_id === episode);
      return found
        ? json(200, found)
        : fail(404, "not_found", "No sealed evidence for that episode.");
    }
    if (route === "/api/rain/interop/v1/proposals") {
      if (request.method !== "POST") return fail(405, "method_not_allowed", "Use POST.");
      if (!scopes.includes("propose"))
        return fail(403, "forbidden_scope", "This token may not propose.");
      const body = await request.text();
      if (body.length > MAX_PROPOSAL_BYTES)
        return fail(413, "too_large", "A proposal is at most 16 KiB.");
      let proposal: Record<string, unknown>;
      try {
        proposal = JSON.parse(body) as Record<string, unknown>;
      } catch {
        return fail(400, "invalid_request", "The body is not JSON.");
      }
      const errors = checkRecord("rain-interop-proposal/v1", proposal);
      if (errors.length)
        return fail(
          400,
          "invalid_request",
          `Not a valid rain-interop-proposal/v1: ${errors.slice(0, 3).join("; ")}`.slice(
            0,
            400,
          ),
        );
      const sha = String(proposal.sha256);
      mkdirSync(config.queueDir, { recursive: true, mode: 0o700 });
      const name = `${sha}.json`;
      let status: "queued_for_operator_review" | "duplicate" =
        "queued_for_operator_review";
      if (queued(config.queueDir) >= MAX_QUEUE) {
        // Full: never write. A proposal already in the queue is still a duplicate.
        if (!readdirSync(config.queueDir).includes(name))
          return fail(
            429,
            "queue_full",
            "The review queue is full; the operator has not caught up.",
          );
        status = "duplicate";
      } else {
        // One exclusive create, readable by the operator's account only: no
        // separate existence check that the file system could race.
        try {
          writeFileSync(
            join(config.queueDir, name),
            JSON.stringify(proposal, null, 2) + "\n",
            {
              flag: "wx",
              mode: 0o600,
            },
          );
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          status = "duplicate";
        }
      }
      const position =
        readdirSync(config.queueDir)
          .filter((n) => /^[a-f0-9]{64}\.json$/.test(n))
          .sort()
          .indexOf(`${sha}.json`) + 1;
      return json(200, {
        schema: "rain-interop-receipt/v1",
        proposal_sha256: sha,
        status,
        authorizes_execution: false,
        queue_position: Math.max(1, position),
        note: "Queued for a lab operator. Nothing has been authorized, preregistered or run.",
      });
    }
    return fail(404, "not_found", "No such interop route.");
  };
}
