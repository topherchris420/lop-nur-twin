/**
 * A headless Bethesda clock: city and its one fly advance together without a
 * mounted React scene, a browser, or a visitor. This is an in-memory foundation,
 * not the persistent, authoritative production service.
 *
 * Preserve the city's and fly's existing deterministic engines and isolation:
 * CityFly observes CitySimulation, and CitySimulation never observes CityFly.
 */
import { CitySimulation, DT, PROFILES, SIM_VERSION, type Config } from "../simulation.js";
import { CityFly, type CityController } from "../fly/cityFly.js";
import type { EchoCheckpoint } from "../fly/echo/checkpoint.js";
import { EchoAdapter } from "../fly/echo/adapter.js";
import { FLY_VERSION } from "../fly/fly.js";
import type { Mode } from "../fly/neural.js";

/** v2: the fly's controller, and with the ECHO controller a summary of its self-model. */
export const HEADLESS_LIFE_SCHEMA = "bethesda-headless-life/v2" as const;

export interface HeadlessLifeStatus {
  schema: typeof HEADLESS_LIFE_SCHEMA;
  cityVersion: string;
  flyVersion: string;
  tick: number;
  simulatedSeconds: number;
  cityHash: string;
  flyHash: string;
  flyController: CityController;
  /** With the ECHO controller: what its self-model holds now. In memory only, like everything here. */
  selfModel: {
    echoVersion: string;
    inquiries: number;
    episodes: number;
    legGain: number;
    trustInSense: number;
  } | null;
  fly: {
    position: [number, number, number];
    mode: Mode;
    energyFraction: number;
    meals: number;
    escapes: number;
  };
}

/**
 * One authority within this process. No second fly is made for an observer.
 *
 * Important: this class intentionally has NO production persistence API.
 * A daemon must not deploy it as a "persistent fly" until versioned snapshots,
 * random-stream restoration, durable transactional storage, and a single-writer
 * lease are implemented and tested. Replaying from genesis indefinitely is
 * not an acceptable substitute for durable checkpoints.
 */
export class HeadlessBethesdaLife {
  readonly city: CitySimulation;
  readonly cityFly: CityFly;

  constructor(
    config: Config = PROFILES[1]!,
    options: { flyController?: CityController } = {},
  ) {
    this.city = new CitySimulation({ ...config });
    this.cityFly = new CityFly(this.city, { controller: options.flyController });
  }

  /**
   * An experimental checkpoint of the ECHO self-model (echo/checkpoint.ts), or
   * null with the reduced-order controller. It holds the self-model only: not
   * the city, the body, the controller underneath or any random stream, so it
   * is not a recovery of this fly and must never be presented as one.
   */
  selfModelCheckpoint(): EchoCheckpoint | null {
    const a = this.cityFly.fly.adapter;
    return a instanceof EchoAdapter ? a.checkpoint() : null;
  }

  advanceTicks(count: number): void {
    if (!Number.isSafeInteger(count) || count < 0 || count > 10_000) {
      throw new Error("Headless tick count must be an integer from 0 to 10,000");
    }
    if (this.city.paused) throw new Error("A headless living city cannot be paused");
    if (this.cityFly.failed) {
      throw new Error(`Digital fly stopped: ${this.cityFly.failed}`);
    }
    for (let i = 0; i < count; i++) {
      this.city.step();
      this.cityFly.tick();
      if (this.cityFly.failed) {
        throw new Error(`Digital fly stopped: ${this.cityFly.failed}`);
      }
    }
  }

  status(): HeadlessLifeStatus {
    const fly = this.cityFly.fly.state;
    return {
      schema: HEADLESS_LIFE_SCHEMA,
      cityVersion: SIM_VERSION,
      flyVersion: FLY_VERSION,
      tick: this.city.tick,
      simulatedSeconds: this.city.tick * DT,
      cityHash: this.city.stateHash(),
      flyHash: this.cityFly.stateHash(),
      flyController: this.cityFly.controller,
      selfModel: (() => {
        const a = this.cityFly.fly.adapter;
        const m = a instanceof EchoAdapter ? a.model?.state : undefined;
        return m
          ? {
              echoVersion: m.version,
              inquiries: m.counts.inquiries,
              episodes: m.episodes.length,
              legGain: m.belief.x[0]!,
              trustInSense: 1 / m.noiseScale,
            }
          : null;
      })(),
      fly: {
        position: [fly.p[0], fly.p[1], fly.p[2]],
        mode: fly.mode,
        energyFraction: fly.reserve / this.cityFly.fly.params.reserveJ,
        meals: fly.counts.meals,
        escapes: fly.counts.escapes,
      },
    };
  }
}
