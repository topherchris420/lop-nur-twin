/**
 * `agent-interop/v1`: the data contract shared with the James desktop.
 *
 * The specification lives in `docs/interop/agent-interop-v1/` and is vendored
 * byte for byte into the James repository. This module seals and checks the
 * records it defines: a record's `sha256` is SHA-256 over the lab's canonical
 * JSON of the record without that field (`sha256Json`). A digest detects
 * change; it is not a signature.
 *
 * Server and scripts only. Imports no simulator, store, life, fly or garden
 * module, reads no environment and starts nothing.
 */
import { sha256Json } from "../sha256.js";
import { schemaErrors, type Schema } from "../experiments/jsonSchema.js";
import identity from "../../../docs/interop/agent-interop-v1/schemas/agent-identity.schema.json" with { type: "json" };
import task from "../../../docs/interop/agent-interop-v1/schemas/agent-task.schema.json" with { type: "json" };
import event from "../../../docs/interop/agent-interop-v1/schemas/agent-event.schema.json" with { type: "json" };
import memory from "../../../docs/interop/agent-interop-v1/schemas/agent-memory.schema.json" with { type: "json" };
import approval from "../../../docs/interop/agent-interop-v1/schemas/agent-approval.schema.json" with { type: "json" };
import status from "../../../docs/interop/agent-interop-v1/schemas/rain-interop-status.schema.json" with { type: "json" };
import evidence from "../../../docs/interop/agent-interop-v1/schemas/rain-interop-evidence.schema.json" with { type: "json" };
import proposal from "../../../docs/interop/agent-interop-v1/schemas/rain-interop-proposal.schema.json" with { type: "json" };
import receipt from "../../../docs/interop/agent-interop-v1/schemas/rain-interop-receipt.schema.json" with { type: "json" };
import error from "../../../docs/interop/agent-interop-v1/schemas/rain-interop-error.schema.json" with { type: "json" };

export const INTEROP_VERSION = "agent-interop/v1" as const;
/**
 * SHA-256 of `docs/interop/agent-interop-v1/MANIFEST.sha256`. The James
 * repository pins the same constant; a change to the specification in one
 * repository fails that repository's tests until it is made in both.
 */
export const AGENT_INTEROP_V1_MANIFEST_SHA256 =
  "08112fdb1f3ba3770cfb2975060723909f1eb47281065467297cd46c8a07c991";

export const SCHEMAS = {
  "agent-identity/v1": identity,
  "agent-task/v1": task,
  "agent-event/v1": event,
  "agent-memory/v1": memory,
  "agent-approval/v1": approval,
  "rain-interop-status/v1": status,
  "rain-interop-evidence/v1": evidence,
  "rain-interop-proposal/v1": proposal,
  "rain-interop-receipt/v1": receipt,
  "rain-interop-error/v1": error,
} as const satisfies Record<string, Schema>;
export type InteropSchemaName = keyof typeof SCHEMAS;

/** The digest a record would carry: canonical JSON without its own `sha256`. */
export function recordDigest(record: Record<string, unknown>): string {
  const body: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record))
    if (key !== "sha256")
      Object.defineProperty(body, key, {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
  return sha256Json(body);
}

/** Returns the record with its `sha256` set from its canonical body. */
export function seal<T extends Record<string, unknown>>(
  record: T,
): T & { sha256: string } {
  return { ...record, sha256: recordDigest(record) };
}

/** Schema errors plus a digest mismatch, if the schema carries `sha256`. */
export function checkRecord(name: InteropSchemaName, value: unknown): string[] {
  const errors = schemaErrors(value, SCHEMAS[name]);
  if (errors.length) return errors;
  const record = value as Record<string, unknown>;
  if (record.schema !== name) return [`schema is not ${name}`];
  if ("sha256" in record && record.sha256 !== recordDigest(record))
    errors.push("sha256 does not match the record's canonical body");
  return errors;
}

/** `prev` links and digests of an `agent-event/v1` chain, in order. */
export function checkEventChain(events: readonly unknown[]): string[] {
  const errors: string[] = [];
  let prev: string | null = null;
  events.forEach((raw, index) => {
    const problems = checkRecord("agent-event/v1", raw);
    if (problems.length) {
      errors.push(...problems.map((p) => `event ${index + 1}: ${p}`));
      return;
    }
    const e = raw as { seq: number; prev: string | null; sha256: string };
    if (e.seq !== index + 1) errors.push(`event ${index + 1}: seq ${e.seq} out of order`);
    if (e.prev !== prev) errors.push(`event ${index + 1}: prev does not link`);
    prev = e.sha256;
  });
  return errors;
}

/** An approval decision is valid only for the exact action it names. */
export function approvalHolds(raw: unknown, now: Date): boolean {
  if (checkRecord("agent-approval/v1", raw).length) return false;
  const a = raw as {
    action: Record<string, unknown>;
    action_sha256: string;
    expires_at: string;
    decision: null | { verdict: string; at: string; action_sha256: string };
  };
  if (a.action_sha256 !== sha256Json(a.action)) return false;
  if (!a.decision || a.decision.verdict !== "approved") return false;
  if (a.decision.action_sha256 !== a.action_sha256) return false;
  const decided = Date.parse(a.decision.at),
    expires = Date.parse(a.expires_at);
  return (
    Number.isFinite(decided) &&
    Number.isFinite(expires) &&
    decided <= expires &&
    now.getTime() <= expires
  );
}
