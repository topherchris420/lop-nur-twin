/**
 * The controllers the calibration compares: the reduced-order controller the
 * fly has always run, the circuit-informed one that replaces two of its
 * proxies (`../circuits/controller.ts`), and circuit-informed/v2, which adds
 * five behavioural mechanisms to that one (`../circuits/v2/controller.ts`),
 * with its ablations. Each is built per fly from that fly's seed, through the
 * fly's own gate.
 */
import {
  CIRCUIT_DESCRIPTOR,
  CIRCUIT_FLY_CONFIG,
  circuitAdapter,
} from "../circuits/controller.js";
import type { CircuitConfig } from "../circuits/params.js";
import { REDUCED_ORDER_DESCRIPTOR, ReducedOrderController } from "../controller.js";
import { V2_DESCRIPTOR, v2Adapter, type V2Mechanism } from "../circuits/v2/controller.js";
import type { V2Config } from "../circuits/v2/params.js";
import type { Subject } from "./paradigms.js";

export const REDUCED_ORDER: Subject = {
  id: REDUCED_ORDER_DESCRIPTOR.id,
  label: REDUCED_ORDER_DESCRIPTOR.label,
  adapter: () => (rng, streams) => new ReducedOrderController(rng, streams?.navigation),
};

/**
 * The circuit-informed controller, with overrides of its fitted or model
 * values (none by default), and optionally its giant fiber silenced.
 */
export function circuitSubject(
  config: CircuitConfig = {},
  o: { silenceGiantFiber?: boolean } = {},
): Subject {
  const silenced = o.silenceGiantFiber === true;
  return {
    id: silenced ? `${CIRCUIT_DESCRIPTOR.id}+gf-silenced` : CIRCUIT_DESCRIPTOR.id,
    label: silenced
      ? `${CIRCUIT_DESCRIPTOR.label}, giant fiber silenced`
      : CIRCUIT_DESCRIPTOR.label,
    adapter: (seed, setting) =>
      circuitAdapter({
        seed,
        config,
        ...(setting.dusted ? { dust: "all-over" as const } : {}),
        ...(silenced ? { silenceGiantFiber: true } : {}),
      }),
    config: CIRCUIT_FLY_CONFIG,
  };
}

export const CIRCUIT = circuitSubject();

/**
 * circuit-informed/v2, with overrides of its own fitted or model values and
 * of v1's, and optionally some of its mechanisms switched off (an ablation:
 * the other values stay the whole controller's).
 */
export function v2Subject(
  o: { v2?: V2Config; circuit?: CircuitConfig; without?: readonly V2Mechanism[] } = {},
): Subject {
  const without = [...(o.without ?? [])].sort();
  const tag = without.length ? `-${without.join("-")}` : "";
  return {
    id: `${V2_DESCRIPTOR.id}${tag}`,
    label: without.length
      ? `${V2_DESCRIPTOR.label} without ${without.join(", ")}`
      : V2_DESCRIPTOR.label,
    adapter: (seed, setting) =>
      v2Adapter({
        seed,
        config: o.circuit ?? {},
        ...(o.v2 ? { v2: o.v2 } : {}),
        without,
        ...(setting.dusted ? { dust: "all-over" as const } : {}),
        ...(setting.enclosed ? { enclosed: true } : {}),
      }),
    config: CIRCUIT_FLY_CONFIG,
  };
}

export const V2 = v2Subject();
