/**
 * The controllers the calibration compares: the reduced-order controller the
 * fly has always run, and the circuit-informed one that replaces two of its
 * proxies (`../circuits/controller.ts`). Each is built per fly from that
 * fly's seed, through the fly's own gate.
 */
import {
  CIRCUIT_DESCRIPTOR,
  CIRCUIT_FLY_CONFIG,
  circuitAdapter,
} from "../circuits/controller.js";
import type { CircuitConfig } from "../circuits/params.js";
import { REDUCED_ORDER_DESCRIPTOR, ReducedOrderController } from "../controller.js";
import type { Subject } from "./paradigms.js";

export const REDUCED_ORDER: Subject = {
  id: REDUCED_ORDER_DESCRIPTOR.id,
  label: REDUCED_ORDER_DESCRIPTOR.label,
  adapter: () => (rng) => new ReducedOrderController(rng),
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
