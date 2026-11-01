/**
 * What a comparison can show depends on the controller as well as on the
 * observation: an observation a fitted value of one controller was set to is
 * a test of another.
 *
 * - reduced-order-fsm/v1: an observation's own role, with v1's fit targets
 *   held out (nothing in it was set from them).
 * - circuit-informed/v1: the observation's own role.
 * - circuit-informed/v2 and its ablations: v2 was built after every
 *   observation registered before the 2026-11 held-out set had been seen, so
 *   those are **development** for it, except its own fit targets (**fit**,
 *   `V2_FIT_TARGETS`) and the observations a value of its came from, or that
 *   v1's did (**design**). Its ablations keep its fitted values, so their
 *   roles are its own.
 * - Every controller: an observation of the 2026-11 held-out set
 *   (`holdout.ts`) is **held-out**. It was registered and sealed before v2 was
 *   committed or run on its paradigms
 *   (`docs/benchmarks/fly-calibration/holdout-2026-11.json`, which states the
 *   order of work), and nothing in any controller was set from it.
 */
import { V2_DESCRIPTOR } from "../circuits/v2/controller.js";
import { V2_FIT_TARGETS } from "../circuits/v2/params.js";
import { CIRCUIT_DESCRIPTOR } from "../circuits/controller.js";
import type { Observation, Role } from "./observations.js";

/** Observations a published value of v2's own came from: agreement is by construction. */
export const V2_DESIGN: readonly string[] = ["flight.saccade-amplitude"];

const V2_FITS: ReadonlySet<string> = new Set(Object.values(V2_FIT_TARGETS).flat());

export const isV2 = (subject: string) =>
  subject === V2_DESCRIPTOR.id || subject.startsWith(`${V2_DESCRIPTOR.id}-`);

export function roleFor(o: Observation, subject: string): Role {
  if (o.registered) return "held-out";
  if (isV2(subject)) {
    if (V2_FITS.has(o.id)) return "fit";
    if (o.role === "design" || V2_DESIGN.includes(o.id)) return "design";
    return "development";
  }
  if (subject === CIRCUIT_DESCRIPTOR.id || subject === "body") return o.role;
  return o.role === "fit" ? "held-out" : o.role;
}
