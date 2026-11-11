/**
 * Research-only, physically gated social cues.
 *
 * This is a sensory/memory hypothesis, NOT a model of an actual fly's
 * chemical receptors, proof of individual recognition, or a production
 * controller. It is not imported by Eva's or ECHO's runtimes.
 *
 * Only line-of-sight body geometry and contact-accessible surface chemistry
 * reach a receiver. No names, life IDs, model state or partner positions
 * enter SocialObservation. Body positions exist solely on the simulator side
 * of the observation boundary.
 *
 * Four arbitrary surface-chemistry bins are an explicitly synthetic stand-in
 * for cuticular-hydrocarbon measurements. They must be calibrated against
 * real measurements before any biological recognition claim is made.
 */
import type { V3 } from "../fly/units.js";

export const SOCIAL_SENSING_SCHEMA = "first-contact-social-sensing/v1" as const;
export type SurfaceChemistry = readonly [number, number, number, number];

export interface SocialBody {
  center: V3;
  yawRad: number;
  radiusM: number;
  /** Simulator-side, synthetic surface fingerprint; NEVER an individual ID. */
  surfaceChemistry?: SurfaceChemistry;
}

/** The complete observation available to a modelled receiving animal. */
export interface SocialObservation {
  visual: { angularSizeDeg: number; bearingRad: number } | null;
  /** Only measurable within a body-contact range, not from a distant fly. */
  contactChemistry: SurfaceChemistry | null;
}

export interface SocialSensorConfig {
  visionRangeM: number;
  fieldOfViewRad: number;
  /** Additional clearance beyond the two bodies' radii (m). */
  contactClearanceM: number;
}

export const DEFAULT_SOCIAL_SENSOR: Readonly<SocialSensorConfig> = Object.freeze({
  visionRangeM: 0.06,
  fieldOfViewRad: Math.PI * 1.5,
  contactClearanceM: 0.0005,
});

function finite(n: number, what: string): void {
  if (!Number.isFinite(n)) throw new Error(`social sensing: ${what} must be finite`);
}

function vector(raw: readonly number[]): SurfaceChemistry {
  if (raw.length !== 4) throw new Error("social sensing: four chemistry bins required");
  for (const n of raw) {
    finite(n, "chemical bin");
    if (n < 0 || n > 1) throw new Error("social sensing: chemistry must be normalized to [0,1]");
  }
  return [raw[0]!, raw[1]!, raw[2]!, raw[3]!];
}

function body(b: SocialBody): void {
  if (b.center.length !== 3) throw new Error("social sensing: body must have three coordinates");
  for (const x of b.center) finite(x, "body coordinate");
  finite(b.yawRad, "body yaw");
  finite(b.radiusM, "body radius");
  if (b.radiusM <= 0 || b.radiusM > 0.01) throw new Error("social sensing: invalid body radius");
  if (b.surfaceChemistry) vector(b.surfaceChemistry);
}

function wrapped(r: number): number {
  return Math.atan2(Math.sin(r), Math.cos(r));
}

/**
 * Computes an observation from physical geometry.
 *
 * `occluded` is supplied by a scene raycast in a future integration; it
 * blocks vision, not actual touch. This function never transmits a sender
 * identifier or behavioral ground truth. Chemistry is available only at
 * near-contact, avoiding the biologically implausible assumption that a
 * cuticular fingerprint can be read from across the arena.
 */
export function senseSocialOther(
  receiver: SocialBody,
  emitter: SocialBody,
  config: SocialSensorConfig = DEFAULT_SOCIAL_SENSOR,
  occluded = false,
): SocialObservation {
  body(receiver);
  body(emitter);
  finite(config.visionRangeM, "vision range");
  finite(config.fieldOfViewRad, "field of view");
  finite(config.contactClearanceM, "contact clearance");
  if (config.visionRangeM <= 0 || config.visionRangeM > 1)
    throw new Error("social sensing: vision range out of bounds");
  if (config.fieldOfViewRad <= 0 || config.fieldOfViewRad > 2 * Math.PI)
    throw new Error("social sensing: field of view out of bounds");
  if (config.contactClearanceM < 0 || config.contactClearanceM > 0.003)
    throw new Error("social sensing: contact clearance out of bounds");

  const dx = emitter.center[0] - receiver.center[0];
  const dy = emitter.center[1] - receiver.center[1];
  const dz = emitter.center[2] - receiver.center[2];
  const distance = Math.hypot(dx, dy, dz);
  const bearing = wrapped(Math.atan2(dx, dz) - receiver.yawRad);
  const inView =
    !occluded &&
    distance <= config.visionRangeM &&
    Math.abs(bearing) <= config.fieldOfViewRad / 2;
  const contact = distance <= receiver.radiusM + emitter.radiusM + config.contactClearanceM;
  return {
    visual: inView
      ? {
          angularSizeDeg: (2 * Math.atan2(emitter.radiusM, Math.max(distance, 1e-9)) * 180) / Math.PI,
          bearingRad: bearing,
        }
      : null,
    contactChemistry: contact && emitter.surfaceChemistry
      ? vector(emitter.surfaceChemistry)
      : null,
  };
}

export type SocialVerdict =
  | "unseen"
  | "detected-unresolved"
  | "novel-profile"
  | "not-yet-familiar"
  | "familiar-profile";

export interface SocialMemoryResult {
  verdict: SocialVerdict;
  /** Sensory detection, not subjective awareness. */
  detected: boolean;
  /** Number of temporally separated encounters underlying a matched trace. */
  encounters: number;
}

export interface SocialMemoryConfig {
  /** Euclidean distance across four normalized chemistry bins. */
  matchRadius: number;
  /** Samples closer than this count as ONE encounter, never repeated evidence. */
  minEncounterGapS: number;
  forgetAfterS: number;
  capacity: number;
}

export const DEFAULT_SOCIAL_MEMORY: Readonly<SocialMemoryConfig> = Object.freeze({
  matchRadius: 0.15,
  minEncounterGapS: 10,
  forgetAfterS: 3600,
  capacity: 12,
});

export interface SocialTrace {
  profile: SurfaceChemistry;
  encounters: number;
  lastEncounterAt: number;
  lastSeenAt: number;
}

export interface SocialMemorySnapshot {
  schema: typeof SOCIAL_SENSING_SCHEMA;
  lastTime: number | null;
  traces: SocialTrace[];
}

function checkMemoryConfig(c: SocialMemoryConfig): void {
  for (const [label, value] of Object.entries(c)) finite(value, label);
  if (c.matchRadius <= 0 || c.matchRadius > 2) throw new Error("social memory: match radius");
  if (c.minEncounterGapS <= 0) throw new Error("social memory: encounter gap");
  if (c.forgetAfterS <= c.minEncounterGapS) throw new Error("social memory: forgetting window");
  if (!Number.isInteger(c.capacity) || c.capacity < 1 || c.capacity > 128)
    throw new Error("social memory: capacity");
}

function chemicalDistance(a: SurfaceChemistry, b: SurfaceChemistry): number {
  return Math.hypot(...a.map((v, i) => v - b[i]!));
}

/**
 * A bounded, checkpointable *research* memory of sensory chemical patterns.
 * Its entries are not partner IDs. Indistinguishable profiles collapse into
 * one trace by design: this is a falsifiable limitation, not recognition.
 */
export class SocialFamiliarityMemory {
  private traces: SocialTrace[] = [];
  private lastTime: number | null = null;
  readonly config: SocialMemoryConfig;

  constructor(config: SocialMemoryConfig = DEFAULT_SOCIAL_MEMORY) {
    checkMemoryConfig(config);
    this.config = { ...config };
  }

  observe(observation: SocialObservation, t: number): SocialMemoryResult {
    finite(t, "encounter time");
    if (t < 0 || (this.lastTime !== null && t < this.lastTime))
      throw new Error("social memory: time cannot go backwards");
    this.lastTime = t;
    this.traces = this.traces.filter((trace) => t - trace.lastSeenAt <= this.config.forgetAfterS);
    const detected = observation.visual !== null || observation.contactChemistry !== null;
    if (!detected) return { verdict: "unseen", detected: false, encounters: 0 };
    if (!observation.contactChemistry)
      return { verdict: "detected-unresolved", detected: true, encounters: 0 };

    const profile = vector(observation.contactChemistry);
    let best = -1;
    let min = Infinity;
    for (let i = 0; i < this.traces.length; i++) {
      const d = chemicalDistance(profile, this.traces[i]!.profile);
      if (d < min) { min = d; best = i; }
    }
    if (best === -1 || min > this.config.matchRadius) {
      if (this.traces.length === this.config.capacity) {
        this.traces.sort((a, b) => a.lastSeenAt - b.lastSeenAt);
        this.traces.shift();
      }
      this.traces.push({
        profile,
        encounters: 1,
        lastEncounterAt: t,
        lastSeenAt: t,
      });
      return { verdict: "novel-profile", detected: true, encounters: 1 };
    }
    const trace = this.traces[best]!;
    const prior = trace.encounters;
    if (t - trace.lastEncounterAt >= this.config.minEncounterGapS) {
      trace.encounters += 1;
      trace.lastEncounterAt = t;
      // One new encounter contributes one update. Repeated frame samples do not.
      const k = 1 / trace.encounters;
      trace.profile = trace.profile.map((v, i) => v * (1 - k) + profile[i]! * k) as unknown as SurfaceChemistry;
    }
    trace.lastSeenAt = t;
    return {
      verdict: prior >= 2 ? "familiar-profile" : "not-yet-familiar",
      detected: true,
      encounters: trace.encounters,
    };
  }

  snapshot(): SocialMemorySnapshot {
    return {
      schema: SOCIAL_SENSING_SCHEMA,
      lastTime: this.lastTime,
      traces: this.traces.map((trace) => ({ ...trace, profile: vector(trace.profile) })),
    };
  }

  static restore(snapshot: SocialMemorySnapshot, config: SocialMemoryConfig = DEFAULT_SOCIAL_MEMORY): SocialFamiliarityMemory {
    if (snapshot.schema !== SOCIAL_SENSING_SCHEMA || !Array.isArray(snapshot.traces))
      throw new Error("social memory: incompatible snapshot");
    const m = new SocialFamiliarityMemory(config);
    if (snapshot.lastTime !== null) {
      finite(snapshot.lastTime, "saved time");
      if (snapshot.lastTime < 0) throw new Error("social memory: invalid saved time");
    }
    if (snapshot.traces.length > config.capacity)
      throw new Error("social memory: saved capacity exceeded");
    m.lastTime = snapshot.lastTime;
    for (const trace of snapshot.traces) {
      finite(trace.lastEncounterAt, "saved encounter");
      finite(trace.lastSeenAt, "saved observation");
      if (!Number.isInteger(trace.encounters) || trace.encounters < 1 ||
          trace.lastEncounterAt < 0 || trace.lastEncounterAt > trace.lastSeenAt ||
          snapshot.lastTime === null || trace.lastSeenAt > snapshot.lastTime)
        throw new Error("social memory: invalid saved trace");
      m.traces.push({ ...trace, profile: vector(trace.profile) });
    }
    return m;
  }
}
