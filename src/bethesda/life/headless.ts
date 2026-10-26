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
import { ECHO_VERSION } from "../fly/echo/params.js";
import { FLY_VERSION } from "../fly/fly.js";
import type { Mode } from "../fly/neural.js";
import type { LifeKind } from "./continuity.js";
import {
  NEARBY_M,
  NEARBY_MAX,
  OBSERVATION_SCHEMA,
  REASON_MAX,
  RECENT_DECISIONS,
  type LifeObservation,
  type ObservedWeather,
} from "./observation.js";

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
 * Its whole state is checkpointed and restored through `BETHESDA_LIFE`
 * (continuity.ts) and kept by a `LifeStore` (store.ts): versioned snapshots
 * with every random stream's position, a verified restore, an append-only
 * chain and a single-writer lease on one machine's filesystem. `observation`
 * reads what an observer may see without changing anything (observation.ts).
 * That is not yet the production service docs/BETHESDA_CONTINUOUS_LIFE.md
 * describes: no transactional database, one machine.
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
      selfModel: this.selfModelSummary(),
      fly: {
        position: [fly.p[0], fly.p[1], fly.p[2]],
        mode: fly.mode,
        energyFraction: fly.reserve / this.cityFly.fly.params.reserveJ,
        meals: fly.counts.meals,
        escapes: fly.counts.escapes,
      },
    };
  }

  /**
   * What an observer may see of this life now (observation.ts). It only
   * reads: no random draw, no step, no field written, so a watched life lives
   * exactly as an unwatched one.
   */
  observation(at: {
    individual: string;
    epoch: number;
    checkpoint: LifeObservation["checkpoint"];
    checkpointing: boolean;
    observedUtc: string;
  }): LifeObservation {
    const fly = this.cityFly.fly,
      s = fly.state;
    const nearby = this.city.agents
      .filter((a) => !a.inside)
      .map((a) => ({ a, d: Math.hypot(a.point.x - s.p[0], a.point.z - s.p[2]) }))
      .filter((n) => n.d <= NEARBY_M)
      .sort((m, n) => m.d - n.d || m.a.id - n.a.id)
      .slice(0, NEARBY_MAX)
      .map(({ a }) => ({ kind: a.kind, x: a.point.x, z: a.point.z }));
    return {
      schema: OBSERVATION_SCHEMA,
      individual: at.individual,
      epoch: at.epoch,
      versions: {
        headless: HEADLESS_LIFE_SCHEMA,
        city: SIM_VERSION,
        fly: FLY_VERSION,
        echo: ECHO_VERSION,
      },
      flyController: this.cityFly.controller,
      tick: this.city.tick,
      simulatedSeconds: this.city.tick * DT,
      observedUtc: at.observedUtc,
      checkpoint: { ...at.checkpoint },
      checkpointing: at.checkpointing,
      fly: {
        position: [s.p[0], s.p[1], s.p[2]],
        velocity: fly.velocityOverGround(),
        yaw: s.yaw,
        mode: s.mode,
        energyFraction: s.reserve / fly.params.reserveJ,
        meals: s.counts.meals,
        escapes: s.counts.escapes,
        recent: fly.log.slice(-RECENT_DECISIONS).map((d) => ({
          t: d.t,
          from: d.from.slice(0, 60),
          to: d.to.slice(0, 60),
          reason: d.reason.slice(0, REASON_MAX),
          kind: d.kind,
        })),
      },
      nearby,
      selfModel: this.selfModelSummary(),
      weather: this.weather(),
    };
  }

  /** The city's wind now, at 10 m and at the fly (read only). */
  private weather(): ObservedWeather {
    const world = this.cityFly.world,
      s = this.cityFly.fly.state;
    const now = world.windNow(s.t);
    const w = world.wind(s.p, s.t);
    const deg = (now.from * 180) / Math.PI;
    return {
      regime: now.regime,
      speedMS: now.speedMS,
      fromDeg: (deg + 360) % 360,
      gusting: now.gusting,
      atFlyMS: Math.hypot(w[0], w[2]),
    };
  }

  private selfModelSummary(): HeadlessLifeStatus["selfModel"] {
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
  }
}

/** What a headless Bethesda life is built from: plain data, all of it. */
export interface HeadlessGenesis {
  config: Config;
  flyController: CityController;
}

export const headlessGenesis = (
  config: Config = PROFILES[1]!,
  flyController: CityController = "reduced-order",
): HeadlessGenesis => ({ config: { ...config }, flyController });

/** The city and its fly as one life, for `continuity.ts`. It takes no events. */
export const BETHESDA_LIFE: LifeKind<HeadlessGenesis, HeadlessBethesdaLife> = {
  id: "bethesda-headless-life",
  versions: {
    headless: HEADLESS_LIFE_SCHEMA,
    city: SIM_VERSION,
    fly: FLY_VERSION,
    echo: ECHO_VERSION,
  },
  build: (g) => new HeadlessBethesdaLife(g.config, { flyController: g.flyController }),
  step: (life, ticks) => {
    for (let left = ticks; left > 0; left -= 10_000)
      life.advanceTicks(Math.min(left, 10_000));
  },
  tick: (life) => life.city.tick,
  hash: (life) => `${life.city.stateHash()}|${life.cityFly.stateHash()}`,
};
