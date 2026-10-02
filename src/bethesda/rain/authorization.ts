/**
 * Human authorization of one exact experiment definition.
 *
 * Modelled on R.A.I.N.'s reviewed workflow, where `--approve` must repeat the
 * reviewed plan's SHA-256: the operator reads the definition's digest and
 * types its first eight characters back, names a role label, and confirms the
 * review. The record binds that act to the definition's SHA-256, so any
 * change to the definition — a seed, a threshold, the scenario — invalidates
 * it, and the runner refuses to start without a record that verifies.
 *
 * What this is not: authenticated identity. It is a **local operator
 * authorization record** — an explicit, caller-attested decision, written by
 * this browser. Its digest detects accidental change; it is not a signature,
 * and anyone who can rewrite the record can rewrite the digest. Both are said
 * in the record itself (`attestation`, `identity_verified`).
 */
import { AUTHORIZATION_SCHEMA, OPERATOR, SHA256 } from "./contracts";
import { sha256Json } from "./sha256";
import type { Checked } from "./validation";

export const CONFIRMATION_LENGTH = 8;
export interface Authorization {
  schema: typeof AUTHORIZATION_SCHEMA;
  experiment_id: string;
  definition_sha256: string;
  /** A role label in R.A.I.N.'s actor pattern; never a name or an address. */
  operator: string;
  attestation: "local-operator";
  identity_verified: false;
  scope: "bethesda-simulation";
  /** What the operator typed: the definition digest's first characters. */
  confirmed_prefix: string;
  authorized_at: string;
  /** SHA-256 of every field above. */
  authorization_sha256: string;
}

export function authorize(input: {
  experimentId: string;
  definitionSha256: string;
  operator: string;
  typedPrefix: string;
  reviewed: boolean;
  now: Date;
}): Checked<Authorization> {
  const errors: string[] = [];
  if (!SHA256.test(input.definitionSha256)) errors.push("definition digest is malformed");
  if (!input.reviewed) errors.push("the protocol review was not confirmed");
  if (!OPERATOR.test(input.operator))
    errors.push("operator must be a role label (letters, digits, . _ -), not a name");
  const typed = input.typedPrefix.trim().toLowerCase();
  if (typed.length !== CONFIRMATION_LENGTH || !input.definitionSha256.startsWith(typed))
    errors.push(
      `type the first ${CONFIRMATION_LENGTH} characters of the definition digest to confirm`,
    );
  if (errors.length) return { ok: false, errors };
  const body = {
    schema: AUTHORIZATION_SCHEMA,
    experiment_id: input.experimentId,
    definition_sha256: input.definitionSha256,
    operator: input.operator,
    attestation: "local-operator" as const,
    identity_verified: false as const,
    scope: "bethesda-simulation" as const,
    confirmed_prefix: typed,
    authorized_at: input.now.toISOString(),
  };
  return { ok: true, value: { ...body, authorization_sha256: sha256Json(body) } };
}

/** Does this record authorize exactly this definition? Every check, every time. */
export function verifyAuthorization(
  auth: unknown,
  experimentId: string,
  definitionSha256: string,
): string[] {
  const a = auth as Authorization | null;
  if (!a || typeof a !== "object") return ["no authorization record"];
  const keys = [
    "schema",
    "experiment_id",
    "definition_sha256",
    "operator",
    "attestation",
    "identity_verified",
    "scope",
    "confirmed_prefix",
    "authorized_at",
    "authorization_sha256",
  ];
  const errors: string[] = [];
  if (Object.keys(a).some((k) => !keys.includes(k)) || keys.some((k) => !(k in a)))
    errors.push("authorization record has unexpected or missing fields");
  if (a.schema !== AUTHORIZATION_SCHEMA) errors.push("unsupported authorization schema");
  if (a.attestation !== "local-operator" || a.identity_verified !== false)
    errors.push("authorization claims an identity this lab cannot verify");
  if (a.scope !== "bethesda-simulation")
    errors.push("authorization scope is not this simulation");
  if (a.experiment_id !== experimentId || a.definition_sha256 !== definitionSha256)
    errors.push("authorization is for a different definition");
  if (typeof a.operator !== "string" || !OPERATOR.test(a.operator))
    errors.push("operator is not a role label");
  if (
    typeof a.confirmed_prefix !== "string" ||
    a.confirmed_prefix.length !== CONFIRMATION_LENGTH ||
    !definitionSha256.startsWith(a.confirmed_prefix)
  )
    errors.push("the confirmation does not repeat the definition digest");
  if (typeof a.authorized_at !== "string" || Number.isNaN(Date.parse(a.authorized_at)))
    errors.push("authorization time is missing");
  if (!errors.length) {
    const { authorization_sha256, ...body } = a;
    if (sha256Json(body) !== authorization_sha256)
      errors.push("authorization record does not match its digest");
  }
  return errors;
}
