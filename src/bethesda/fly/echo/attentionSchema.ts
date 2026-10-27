/**
 * Project ECHO's attention schema: a functional analogue of the attention
 * schema theory (Graziano & Webb 2015), indicator property AST-1 of Butlin,
 * Long et al. 2023: a simplified model the fly keeps of its own attention
 * (here, what holds its workspace, workspace.ts), which it uses to predict
 * and to control it.
 *
 * From its own experience the fly learns how often each kind of content has
 * taken its workspace and how long each tends to hold it. With that it
 * predicts how long its present focus will last and what is likely to take
 * it next, and, when it is working out what is wrong with itself, whether
 * something it could hold off is likely to interrupt before it is done. If
 * so, it shields the inquiry: a rival it may hold off then needs a much
 * stronger bid. Hazards, touch and the air are never held off.
 *
 * A model of attention used to control attention, in a few lines of
 * arithmetic over a reduced-order simulator. Nothing here is a claim that
 * the fly is aware of anything (docs/PROJECT_ECHO.md).
 */
import { EP } from "./params.js";
import { SOURCES, UNSHIELDED, type Source, type Workspace } from "./workspace.js";

export interface AttentionSchema {
  /** How often each kind of content takes the workspace (per second), learned. */
  rate: Record<Source, number>;
  /** How long each kind tends to hold it once it has it (s), learned. */
  dwell: Record<Source, number>;
  /** Whether it is shielding its inquiry now. */
  shield: boolean;
  /** Its expectation now: how much longer its present focus lasts, and what is likely to take it next and when. */
  expect: {
    holder: Source | null;
    remainingS: number | null;
    next: Source | null;
    nextInS: number | null;
  };
}

const perSource = (v: number): Record<Source, number> =>
  Object.fromEntries(SOURCES.map((s) => [s, v])) as Record<Source, number>;

export function freshSchema(): AttentionSchema {
  return {
    rate: perSource(0),
    dwell: perSource(EP.schemaDwellS),
    shield: false,
    expect: { holder: null, remainingS: null, next: null, nextInS: null },
  };
}

/**
 * Learn from one decision: which content entered (if any), and how long the
 * holding that just ended lasted (if one did).
 */
export function learn(
  A: AttentionSchema,
  entered: Source | null,
  ended: { source: Source; heldS: number } | null,
  dt: number,
): void {
  const k = dt / EP.schemaTauS;
  for (const s of SOURCES) A.rate[s] += k * ((entered === s ? 1 / dt : 0) - A.rate[s]);
  // How long a content holds it: over about its last four holdings.
  if (ended) A.dwell[ended.source] += 0.25 * (ended.heldS - A.dwell[ended.source]);
}

/** The chance, by the schema, that a content it could hold off takes the workspace within `s` seconds. */
export function interruptionRisk(A: AttentionSchema, holder: Source, s: number): number {
  let rate = 0;
  for (const src of SOURCES)
    if (src !== holder && !UNSHIELDED.has(src)) rate += A.rate[src];
  return 1 - Math.exp(-rate * Math.max(0, s));
}

/** What the fly expects of its own attention now. */
export function predict(A: AttentionSchema, ws: Workspace, t: number): void {
  const h = ws.holder;
  let next: Source | null = null;
  let total = 0;
  for (const s of SOURCES) {
    if (h && s === h.source) continue;
    total += A.rate[s];
    if (next === null || A.rate[s] > A.rate[next]) next = s;
  }
  A.expect = {
    holder: h ? h.source : null,
    remainingS: h ? Math.max(0, A.dwell[h.source] - (t - h.since)) : null,
    next: total > 0 ? next : null,
    nextInS: total > 0 ? 1 / total : null,
  };
}
