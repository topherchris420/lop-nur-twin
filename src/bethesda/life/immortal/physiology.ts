/**
 * Tissue-level research model, NOT measured cellular Drosophila physiology.
 * The existing body owns joules spent and food absorbed. This model owns
 * recoverable tissue condition and an explicitly artificial maintenance source.
 * All numerical constants below are model choices, not fitted measurements.
 */
import type { Mode } from "../../fly/neural.js";

export const PHYSIOLOGY_VERSION = "echo-maintenance/v1";
export const PHYSIOLOGY_PARAMS = {
  recoveryEnter: { value: 0.08, unit: "reserve fraction", kind: "model" },
  recoveryExit: { value: 0.35, unit: "reserve fraction", kind: "model" },
  maintenancePower: {
    value: 0.004,
    unit: "W, artificial external supply",
    kind: "model",
  },
  waterLoss: { value: 1 / 86400, unit: "fraction/s", kind: "model" },
  waterRecovery: { value: 1 / 120, unit: "fraction/s, artificial supply", kind: "model" },
  fatigueRise: { value: 1 / 1800, unit: "1/s", kind: "model" },
  fatigueRecovery: { value: 1 / 120, unit: "1/s", kind: "model" },
  sleepRise: { value: 1 / 14400, unit: "1/s", kind: "model" },
  sleepRecovery: { value: 1 / 600, unit: "1/s", kind: "model" },
  atpTau: { value: 10, unit: "s, availability proxy", kind: "model" },
  stressTau: { value: 60, unit: "s", kind: "model" },
  bathC: { value: 25, unit: "deg C, assumed constant bath", kind: "model" },
  thermalTau: { value: 30, unit: "s", kind: "model" },
} as const;

const P = Object.fromEntries(
  Object.entries(PHYSIOLOGY_PARAMS).map(([k, p]) => [k, p.value]),
) as { [K in keyof typeof PHYSIOLOGY_PARAMS]: number };
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const relax = (x: number, target: number, rate: number, dt: number) =>
  target + (x - target) * Math.exp(-rate * dt);

export interface PhysiologyState {
  schema: typeof PHYSIOLOGY_VERSION;
  atp: number;
  water: number;
  fatigue: number;
  sleepPressure: number;
  stress: number;
  temperatureC: number;
  protective: boolean;
  sleeping: boolean;
  recoveryBouts: number;
  maintenanceJ: number;
  artificialWater: number;
  recoveredSeconds: number;
}

export class Physiology {
  readonly state: PhysiologyState = {
    schema: PHYSIOLOGY_VERSION,
    atp: 1,
    water: 1,
    fatigue: 0,
    sleepPressure: 0,
    stress: 0,
    temperatureC: P.bathC,
    protective: false,
    sleeping: false,
    recoveryBouts: 0,
    maintenanceJ: 0,
    artificialWater: 0,
    recoveredSeconds: 0,
  };
  readonly immortal: boolean;
  constructor(immortal: boolean) {
    this.immortal = immortal;
  }

  /** One bounded body update. Returns the artificial joules actually supplied. */
  advance(dt: number, body: { mode: Mode; reserve: number; capacity: number }): number {
    const s = this.state;
    if (
      !Number.isFinite(dt) ||
      dt <= 0 ||
      dt > 1 ||
      !Number.isFinite(body.reserve) ||
      !Number.isFinite(body.capacity) ||
      body.capacity <= 0 ||
      body.reserve < 0 ||
      body.reserve > body.capacity
    )
      throw new Error("invalid physiology input; no reset performed");
    if (
      ![s.atp, s.water, s.fatigue, s.sleepPressure, s.stress].every(
        (v) => Number.isFinite(v) && v >= 0 && v <= 1,
      ) ||
      !Number.isFinite(s.temperatureC)
    )
      throw new Error("invalid tissue state; no reset performed");
    const reserve = body.reserve / body.capacity;
    const critical =
      reserve <= P.recoveryEnter ||
      s.water < 0.15 ||
      s.atp < 0.1 ||
      s.fatigue > 0.95 ||
      s.stress > 0.95;
    if (this.immortal && critical && !s.protective) {
      s.protective = true;
      s.recoveryBouts++;
    }
    if (
      s.protective &&
      reserve >= P.recoveryExit &&
      s.water >= 0.8 &&
      s.atp >= 0.7 &&
      s.fatigue <= 0.2 &&
      s.stress <= 0.2
    )
      s.protective = false;
    if (s.sleepPressure >= 0.85) s.sleeping = true;
    if (s.sleepPressure <= 0.2) s.sleeping = false;
    // Recovery slows the commanded body; it does not teleport or change its mode.
    const resting = body.mode === "rest" || body.mode === "feed";
    // The artificial service also repairs tissue while an airborne fly seeks
    // a safe landing. Recovery must not depend on reaching a particular site.
    const repairing = this.immortal && s.protective;
    const activity = resting
      ? 0
      : body.mode === "flight" || body.mode === "land"
        ? 1
        : 0.4;
    s.fatigue = relax(
      s.fatigue,
      resting || repairing ? 0 : 1,
      resting || repairing ? P.fatigueRecovery : P.fatigueRise * activity,
      dt,
    );
    s.sleepPressure = relax(
      s.sleepPressure,
      resting ? 0 : 1,
      resting ? P.sleepRecovery : P.sleepRise,
      dt,
    );
    s.water *= Math.exp(-P.waterLoss * (1 + activity) * dt);
    let supplied = 0;
    if (this.immortal && s.protective) {
      supplied = Math.min(body.capacity - body.reserve, P.maintenancePower * dt);
      const water = Math.min(1 - s.water, P.waterRecovery * dt);
      s.water += water;
      s.artificialWater += water;
      s.maintenanceJ += supplied;
      s.recoveredSeconds += dt;
    }
    // Fractional ATP availability tracks the existing energetic budget. No second J ledger.
    const available = Math.min(1, (body.reserve + supplied) / body.capacity / 0.2);
    s.atp = relax(s.atp, available * (1 - 0.25 * activity), 1 / P.atpTau, dt);
    s.stress = relax(
      s.stress,
      s.protective ? 0 : clamp(1 - available),
      1 / P.stressTau,
      dt,
    );
    // Ectothermic relaxation to an assumed bath, not active thermoregulation or weather sensing.
    s.temperatureC = relax(s.temperatureC, P.bathC, 1 / P.thermalTau, dt);
    return supplied;
  }
}
