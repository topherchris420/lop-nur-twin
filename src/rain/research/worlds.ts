/** Declarative Bethesda worlds. This registry grants no execution authority. */
import { sha256Json } from "../sha256.js";
import {
  closed,
  checkData,
  ENVELOPE_SCHEMA,
  envelopeErrors,
  type Envelope,
} from "../../bethesda/rain/discoveryProtocol.js";
import {
  PARTNERSHIP_SCHEMA,
  type Partnership,
} from "../../bethesda/rain/inceptionProtocol.js";
import {
  authorize,
  verifyAuthorization,
  type Authorization,
} from "../../bethesda/rain/authorization.js";
import type { ResearchStore } from "../autonomy/store.js";

export const ROOT_LAB = "bethesda-rain";
export const WORLD_CAPABILITIES = {
  "bethesda-native/v1": {
    terrain: "pinned-bethesda-map",
    entities: ["pedestrians", "vehicles", "buses"],
    rules: "installed-version-only",
    tools: ["corpus", "mathematics", "verified-results", "native-experiments"],
  },
} as const;
export interface ResearchWorld {
  schema: "rain-world/v1";
  id: string;
  parent: string;
  generation: number;
  objective: string;
  simulator: "bethesda-native/v1";
  assumptions: string[];
  hypotheses: string[];
  evaluation: string[];
  inheritance: {
    id: string;
    sha256: string;
    status: "source-context" | "simulated" | "hypothesis";
  }[];
  agents: Partnership;
  envelope: Envelope;
  budget: {
    experiments: number;
    model_calls: number;
    runtime_ms: number;
    storage_bytes: number;
  };
  lifetime_ms: number;
  tools: string[];
  termination: string[];
}
export interface DescendantLab {
  spec: ResearchWorld;
  digest: string;
  authorization: Authorization;
  expires_at: string;
  status: "approved" | "running" | "completed" | "stopped";
}
const word = (maxLength: number) => ({ type: "string", minLength: 1, maxLength });
const list = (maxItems: number) => ({
  type: "array",
  minItems: 1,
  maxItems,
  items: word(600),
});
const integer = (minimum: number, maximum: number) => ({
  type: "integer",
  minimum,
  maximum,
});
const identity = { ...word(64), pattern: "^[a-z][a-z0-9-]{0,63}$" };
export const WORLD_SCHEMA = closed({
  schema: { const: "rain-world/v1" },
  id: identity,
  parent: identity,
  generation: integer(1, 2),
  objective: word(400),
  simulator: { const: "bethesda-native/v1" },
  assumptions: list(8),
  hypotheses: list(8),
  evaluation: list(8),
  inheritance: {
    type: "array",
    maxItems: 24,
    items: closed({
      id: word(120),
      sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
      status: { enum: ["source-context", "simulated", "hypothesis"] },
    }),
  },
  agents: PARTNERSHIP_SCHEMA,
  envelope: ENVELOPE_SCHEMA,
  budget: closed({
    experiments: integer(1, 3),
    model_calls: integer(1, 60),
    runtime_ms: integer(10000, 900000),
    storage_bytes: integer(1048576, 67108864),
  }),
  lifetime_ms: integer(60000, 86400000),
  tools: {
    type: "array",
    minItems: 1,
    maxItems: 4,
    items: { enum: [...WORLD_CAPABILITIES["bethesda-native/v1"].tools] },
  },
  termination: list(6),
});
export function worldErrors(
  raw: unknown,
  labs: readonly DescendantLab[],
  available: ResearchWorld["inheritance"],
  now: Date,
): string[] {
  const checked = checkData<ResearchWorld>(raw, WORLD_SCHEMA);
  if (!checked.ok) return checked.errors;
  const w = checked.value,
    errors = envelopeErrors(w.envelope);
  if (new Set(w.tools).size !== WORLD_CAPABILITIES[w.simulator].tools.length)
    errors.push("This simulator requires exactly its four registered tools");
  if (w.id === ROOT_LAB || labs.some((l) => l.spec.id === w.id))
    errors.push("Laboratory identifier already exists");
  const parent = labs.find((l) => l.spec.id === w.parent);
  if (
    w.parent !== ROOT_LAB &&
    (!parent ||
      parent.status === "stopped" ||
      Date.parse(parent.expires_at) <= now.getTime())
  )
    errors.push("Parent is unavailable or expired");
  if (w.generation !== (parent?.spec.generation ?? 0) + 1)
    errors.push("Generation does not extend its parent");
  const seen = new Set([w.id]);
  let ancestor: string | undefined = w.parent;
  while (ancestor && ancestor !== ROOT_LAB) {
    if (seen.has(ancestor)) {
      errors.push("Lineage cycle");
      break;
    }
    seen.add(ancestor);
    ancestor = labs.find((l) => l.spec.id === ancestor)?.spec.parent;
  }
  if (
    labs.filter(
      (l) =>
        l.spec.parent === w.parent &&
        ["approved", "running"].includes(l.status) &&
        Date.parse(l.expires_at) > now.getTime(),
    ).length >= 2
  )
    errors.push("At most two active children per parent");
  if (
    w.inheritance.some(
      (r) =>
        !available.some(
          (a) => a.id === r.id && a.sha256 === r.sha256 && a.status === r.status,
        ),
    )
  )
    errors.push("Unverified inheritance reference or changed uncertainty label");
  if (parent) {
    if (w.lifetime_ms > Date.parse(parent.expires_at) - now.getTime())
      errors.push("Child outlives parent");
    for (const key of [
      "experiments",
      "model_calls",
      "runtime_ms",
      "storage_bytes",
    ] as const)
      if (w.budget[key] > parent.spec.budget[key])
        errors.push("Child budget exceeds parent ceiling: " + key);
  }
  return errors;
}
export function descendantLabs(store: ResearchStore): DescendantLab[] {
  const labs = new Map<string, DescendantLab>();
  for (const e of store.discoveryEntries()) {
    if (e.kind === "world-approved") {
      const lab = structuredClone(e.payload) as DescendantLab;
      if (
        sha256Json(lab.spec) !== lab.digest ||
        verifyAuthorization(lab.authorization, lab.spec.id, lab.digest).length
      )
        throw new Error("Invalid descendant authorization");
      labs.set(lab.spec.id, lab);
    } else if (e.kind === "world-state") {
      const p = e.payload as { id: string; status: DescendantLab["status"] };
      const lab = labs.get(p.id);
      if (lab) lab.status = p.status;
    }
  }
  return [...labs.values()];
}
/** Call only from an explicit operator action, never a model tool. */
export function approveWorld(
  store: ResearchStore,
  raw: unknown,
  available: ResearchWorld["inheritance"],
  input: { operator: string; typedPrefix: string; reviewed: boolean; now: Date },
): DescendantLab {
  const release = store.acquireLock("world-approval");
  try {
    const errors = worldErrors(raw, descendantLabs(store), available, input.now);
    if (errors.length) throw new Error(errors.join("; "));
    const spec = structuredClone(raw) as ResearchWorld,
      digest = sha256Json(spec);
    const auth = authorize({ ...input, experimentId: spec.id, definitionSha256: digest });
    if (!auth.ok) throw new Error(auth.errors.join("; "));
    const lab: DescendantLab = {
      spec,
      digest,
      authorization: auth.value,
      expires_at: new Date(input.now.getTime() + spec.lifetime_ms).toISOString(),
      status: "approved",
    };
    store.appendDiscovery(spec.id, "world-approved", lab);
    return lab;
  } finally {
    release();
  }
}
