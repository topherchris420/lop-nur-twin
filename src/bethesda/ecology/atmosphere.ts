/**
 * The research ecology's sky: light, cloud, temperature, humidity, wind and
 * rain as pure functions of a seed and the time.
 *
 * Nothing here holds state or draws a random number: the weather at a time is
 * the same whenever and however often it is asked for, with or without a fly
 * in the world, so it evolves on its own by construction. Variation comes from
 * seeded simplex noise (`src/lib/noise.ts`) read at the time over a few
 * fixed timescales. Every form and constant is a model choice
 * (`ECOLOGY_PARAMS`), not a fit to any climate.
 */
import type { NoiseFunction2D } from "simplex-noise";
import { seededNoise2D } from "../../lib/noise.js";
import type { V3 } from "../fly/units.js";
import { P } from "./params.js";

export interface AtmosphereSpec {
  seed: number;
  /** Hour of the day at time 0 (0–24). */
  startHour: number;
  /** Mean direction the wind blows toward (rad, the fly's heading convention: 0 east, π/2 north). */
  windHeading: number;
}

export interface Weather {
  t: number;
  hour: number;
  /** Relative light: 1 is a clear midday. */
  light: number;
  /** Cloud cover, 0–1. */
  cloud: number;
  tempC: number;
  /** Relative humidity, 0.1–1. */
  humidity: number;
  /** The air's velocity near the ground (m/s, horizontal, world frame). */
  wind: V3;
  rainMmH: number;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export class Atmosphere {
  readonly spec: Readonly<AtmosphereSpec>;
  private readonly noise: NoiseFunction2D;
  constructor(spec: AtmosphereSpec) {
    this.spec = Object.freeze({ ...spec });
    this.noise = seededNoise2D((spec.seed ^ 0x57ea7e) >>> 0);
  }

  /** Noise on its own row `row`, at time `t` over timescale `tau` (s). */
  private n(t: number, tau: number, row: number): number {
    return this.noise(t / tau, row * 17.31);
  }

  at(t: number): Weather {
    const day = P("dayS");
    const hour = (((this.spec.startHour + t / 3600) % 24) + 24) % 24;
    const cloud = clamp(0.45 + 0.6 * this.n(t, 10_800, 1), 0, 1);
    const sun = Math.sin((2 * Math.PI * (hour - 6)) / 24);
    const light = P("nightLight") + (sun > 0 ? sun * (1 - P("cloudDimming") * cloud) : 0);
    const tempC =
      P("meanTempC") +
      P("dailyTempAmpC") * Math.sin((2 * Math.PI * (hour - 9)) / 24) -
      P("cloudCooling") * cloud * Math.max(0, sun) +
      P("synopticTempAmpC") * this.n(t, 3 * day, 2);
    const r = this.n(t, 5_400, 3);
    const rainMmH =
      r > P("rainThreshold")
        ? (P("rainMaxMmH") * (r - P("rainThreshold"))) / (1 - P("rainThreshold"))
        : 0;
    const humidity = clamp(
      0.55 - 0.02 * (tempC - P("meanTempC")) + 0.3 * cloud + (rainMmH > 0 ? 0.2 : 0),
      0.1,
      1,
    );
    const speed = Math.max(
      0,
      P("windMeanMS") * (1 + P("windGustShare") * this.n(t, 900, 4)),
    );
    const heading = this.spec.windHeading + P("windVeerRad") * this.n(t, 7_200, 5);
    // Heading convention (units.ts): forward(yaw) = (cos, 0, −sin).
    const wind: V3 = [speed * Math.cos(heading), 0, -speed * Math.sin(heading)];
    return { t, hour, light, cloud, tempC, humidity, wind, rainMmH };
  }

  /** The temperature factor of a rate with the ecology's Q10, at 20 °C reference. */
  static q10(tempC: number): number {
    return Math.pow(P("q10"), (tempC - 20) / 10);
  }
}
