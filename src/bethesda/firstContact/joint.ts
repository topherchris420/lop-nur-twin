/**
 * Stage 1: passive observation of Eva and ECHO together.
 *
 * A read-only joint view of the two originals, built only from their public
 * observation streams: Eva's `GET /api/state` (parsed by the garden's own
 * contract, src/garden/core/observation.ts) and ECHO's witness (`/v1/now`,
 * parsed by src/bethesda/life/observation.ts). Nothing here can reach either
 * simulation: the module makes no request (the script that uses it makes
 * GETs only), holds no reference to either system, and runs neither fly.
 *
 * What it guarantees:
 * - **Identity is pinned.** A state is accepted only from the individual its
 *   stream is for (`EVA`, `ECHO` in originals.ts). Another `life_id`,
 *   another `born_at` or another individual is refused and counted, never
 *   blended into the view.
 * - **Observed, interpolated, held and unavailable stay apart.** At a UTC
 *   instant each individual is `observed` (a sample stamped then),
 *   `interpolated` (between two samples, positions only, for presentation),
 *   `held` (the newest sample, while no newer one exists and it is not yet
 *   stale) or `unavailable`. Nothing is ever extrapolated, and discrete facts
 *   (activity, mode) always belong to the earlier sample.
 * - **They are in different worlds.** Eva's position is in garden fractions,
 *   ECHO's in city metres. The joint view never relates the two positions;
 *   `representations` (below) is the only place they meet, and it is a
 *   labelled computation, delivered to neither fly.
 *
 * The **representation** each would receive of the other is what Stage 1
 * means by "each fly receives a representation of the other's location and
 * movement" while "neither can influence the other's world": it is computed
 * here, beside both lives, from declared maps, and recorded. It is not
 * delivered. Delivering anything into either production simulation is a
 * production change that needs separate authorization (docs/FIRST_CONTACT.md,
 * Stage 4).
 */
import {
  parseObservation as parseGarden,
  type Observation,
} from "../../garden/core/observation.js";
import {
  CHECKPOINTING_STALE_AFTER_S,
  parseWitness,
  STALE_AFTER_S,
  type LifeObservation,
} from "../life/observation.js";
import {
  checkGardenClock,
  checkLifeClock,
  fitClock,
  type ClockCheck,
  type ClockFit,
} from "./clock.js";
import { ECHO, EVA } from "./originals.js";

/** Eva's state is stale once it is this much older than her step would allow (s). */
export const GARDEN_STALE_AFTER_S = 30;

export interface EvaSample {
  /** The simulated instant, unix seconds (Eva's own clock is in UTC seconds). */
  utcS: number;
  /** Seconds since her birth on her own clock. */
  ownS: number;
  receivedUtcS: number;
  ticks: number;
  /** Garden fractions (x right, y down). */
  position: [number, number];
  place: string;
  activity: string;
  journeys: number;
  memories: number | null;
  clock: ClockCheck;
}

export interface EchoSample {
  /** When the runner wrote the observation (UTC seconds). */
  utcS: number;
  /** Its own simulated seconds. */
  ownS: number;
  receivedUtcS: number;
  tick: number;
  epoch: number;
  /** City metres: x east, y up, z south. */
  position: [number, number, number];
  yaw: number;
  mode: string;
  meals: number;
  escapes: number;
  checkpointing: boolean;
  selfModelEpisodes: number | null;
  clock: ClockCheck;
}

export type Presence<T> =
  | { kind: "observed"; sample: T }
  | { kind: "interpolated"; earlier: T; later: T; u: number }
  | { kind: "held"; sample: T; ageS: number }
  | { kind: "unavailable"; reason: string };

export interface Refusal {
  stream: "eva" | "echo";
  receivedUtcS: number;
  reason: string;
}

export interface JointView {
  utcS: number;
  eva: Presence<EvaSample>;
  echo: Presence<EchoSample>;
  /** Always true: the two positions are in different worlds and are never compared here. */
  separateWorlds: true;
}

const sameLife = (o: Observation) => o.lifeId === EVA.id;

export class JointObserver {
  private readonly evaSamples: EvaSample[] = [];
  private readonly echoSamples: EchoSample[] = [];
  private evaBornAt: number | null = null;
  readonly refusals: Refusal[] = [];

  get eva(): readonly EvaSample[] {
    return this.evaSamples;
  }
  get echo(): readonly EchoSample[] {
    return this.echoSamples;
  }

  private refuse(stream: Refusal["stream"], receivedUtcS: number, reason: string) {
    this.refusals.push({ stream, receivedUtcS, reason: reason.slice(0, 300) });
    return false;
  }

  /** One `GET /api/state` body. Returns whether it was accepted. */
  addEva(raw: unknown, receivedUtcS: number): boolean {
    let o: Observation;
    try {
      o = parseGarden(raw);
    } catch (e) {
      return this.refuse("eva", receivedUtcS, `invalid: ${(e as Error).message}`);
    }
    if (!sameLife(o))
      return this.refuse("eva", receivedUtcS, `another individual: life_id ${o.lifeId}`);
    if (this.evaBornAt !== null && o.bornAt !== this.evaBornAt)
      return this.refuse(
        "eva",
        receivedUtcS,
        `born_at changed from ${this.evaBornAt} to ${o.bornAt}`,
      );
    this.evaBornAt = o.bornAt;
    const last = this.evaSamples.at(-1);
    if (last && o.ticks <= last.ticks) return false; // the same step again: nothing new
    this.evaSamples.push({
      utcS: o.updatedAt,
      ownS: o.updatedAt - o.bornAt,
      receivedUtcS,
      ticks: o.ticks,
      position: [o.position[0], o.position[1]],
      place: o.placeRaw,
      activity: o.activity,
      journeys: o.journeys,
      memories: o.momentsCount,
      clock: checkGardenClock(o),
    });
    return true;
  }

  /** One `/v1/now` witness. Returns whether it was accepted. */
  addEcho(raw: unknown, receivedUtcS: number): boolean {
    let o: LifeObservation | null;
    try {
      const w = parseWitness(raw);
      if (w.status !== "live")
        return this.refuse(
          "echo",
          receivedUtcS,
          `witness ${w.status}: ${w.reason ?? ""}`,
        );
      o = w.observation;
    } catch (e) {
      return this.refuse("echo", receivedUtcS, `invalid: ${(e as Error).message}`);
    }
    if (!o) return this.refuse("echo", receivedUtcS, "no observation");
    if (o.individual !== ECHO.id)
      return this.refuse("echo", receivedUtcS, `another individual: ${o.individual}`);
    const last = this.echoSamples.at(-1);
    if (last && o.tick <= last.tick) return false;
    this.echoSamples.push({
      utcS: Date.parse(o.observedUtc) / 1000,
      ownS: o.simulatedSeconds,
      receivedUtcS,
      tick: o.tick,
      epoch: o.epoch,
      position: [o.fly.position[0], o.fly.position[1], o.fly.position[2]],
      yaw: o.fly.yaw,
      mode: o.fly.mode,
      meals: o.fly.meals,
      escapes: o.fly.escapes,
      checkpointing: o.checkpointing,
      selfModelEpisodes: o.selfModel?.episodes ?? null,
      clock: checkLifeClock(o),
    });
    return true;
  }

  private presence<T extends { utcS: number }>(
    samples: readonly T[],
    utcS: number,
    staleAfter: (s: T) => number,
    interpolate: (a: T, b: T, u: number) => T,
  ): Presence<T> {
    if (!samples.length) return { kind: "unavailable", reason: "nothing received yet" };
    const first = samples[0]!;
    if (utcS < first.utcS - 1e-6)
      return { kind: "unavailable", reason: "before the first received state" };
    let i = samples.length - 1;
    while (i > 0 && samples[i]!.utcS > utcS + 1e-6) i--;
    const a = samples[i]!;
    if (Math.abs(a.utcS - utcS) <= 1e-6) return { kind: "observed", sample: a };
    const b = samples[i + 1];
    if (!b) {
      const age = utcS - a.utcS;
      return age > staleAfter(a)
        ? { kind: "unavailable", reason: `the newest state is ${age.toFixed(1)} s old` }
        : { kind: "held", sample: a, ageS: age };
    }
    const u = (utcS - a.utcS) / (b.utcS - a.utcS);
    return { kind: "interpolated", earlier: a, later: interpolate(a, b, u), u };
  }

  /** Both individuals at one UTC instant. */
  viewAt(utcS: number): JointView {
    return {
      utcS,
      eva: this.presence(
        this.evaSamples,
        utcS,
        () => GARDEN_STALE_AFTER_S,
        (a, b, u) => ({
          ...a,
          position: [
            a.position[0] + (b.position[0] - a.position[0]) * u,
            a.position[1] + (b.position[1] - a.position[1]) * u,
          ],
        }),
      ),
      echo: this.presence(
        this.echoSamples,
        utcS,
        (s) => (s.checkpointing ? CHECKPOINTING_STALE_AFTER_S : STALE_AFTER_S),
        (a, b, u) =>
          // Never interpolated across an epoch change (a restart).
          a.epoch !== b.epoch
            ? a
            : {
                ...a,
                position: [
                  a.position[0] + (b.position[0] - a.position[0]) * u,
                  a.position[1] + (b.position[1] - a.position[1]) * u,
                  a.position[2] + (b.position[2] - a.position[2]) * u,
                ],
              },
      ),
      separateWorlds: true,
    };
  }

  clocks(): {
    eva: ClockFit & { consistent: number };
    echo: ClockFit & { consistent: number };
  } {
    const fitOf = <T extends { receivedUtcS: number; ownS: number; clock: ClockCheck }>(
      xs: readonly T[],
      quantumS: number,
    ) => ({
      ...fitClock(
        xs.map((x) => ({ utcS: x.receivedUtcS, ownS: x.ownS })),
        { quantumS },
      ),
      consistent: xs.filter((x) => x.clock.consistent).length,
    });
    return { eva: fitOf(this.evaSamples, 5), echo: fitOf(this.echoSamples, 0.1) };
  }
}

// ------------------------------------------------- the representations (dry run)

/**
 * A metric scale for Eva's garden, derived from data the repository holds:
 * the least-squares similarity (`fitSimilarity2D`) from the server's 2D place
 * anchors (`STAGES[place].plan`, garden fractions) to the clay page's 3D
 * anchors (`STAGES[place].anchor`, x and z in metres), over all seven places.
 * It is the renderer's interpretation of the garden, not a property of Eva's
 * simulation, which has no metric scale; every representation that uses it
 * says so. The residual is large (the clay garden is sculpted, not a scaled
 * copy of the plan), and is reported with the scale.
 *
 * Pinned here because `stage.ts` cannot load under Node's type stripping;
 * joint.test.ts re-derives it from `STAGES` and fails if they disagree.
 */
export const GARDEN_SCALE = Object.freeze({
  metresPerFraction: 3.8066435580839295,
  angle: 0.08171325125433689,
  rmsResidualM: 0.6330199360665124,
  places: 7,
});

export interface Representation {
  /** Who it is for. */
  for: "Eva" | "ECHO";
  /** The other's movement since the session's anchor, in the receiver's horizontal frame (m). */
  otherDisplacementM: [number, number];
  /** The other's horizontal speed over the last interval of its own samples (m/s), or null. */
  otherSpeedMS: number | null;
  delivered: false;
  basis: string;
}

/**
 * What each would be shown of the other's movement, if a bridge existed:
 * the other's horizontal displacement since a common anchor instant, scaled
 * into the receiver's frame (Eva's garden through `GARDEN_SCALE`, an
 * interpretation; ECHO's city metres as they are). Relative movement only:
 * the two have no common origin, so neither absolute location is mapped.
 * Computed, recorded, and delivered to neither.
 */
export function representations(
  anchor: JointView,
  now: JointView,
  scale: { metresPerFraction: number; rmsResidualM: number } = GARDEN_SCALE,
): Representation[] | null {
  const pos = <T>(p: Presence<T>): T | null =>
    p.kind === "observed" || p.kind === "held"
      ? p.sample
      : p.kind === "interpolated"
        ? p.later
        : null;
  const e0 = pos(anchor.eva),
    e1 = pos(now.eva),
    c0 = pos(anchor.echo),
    c1 = pos(now.echo);
  if (!e0 || !e1 || !c0 || !c1) return null;
  const k = scale.metresPerFraction;
  const evaMoved: [number, number] = [
    (e1.position[0] - e0.position[0]) * k,
    (e1.position[1] - e0.position[1]) * k,
  ];
  const echoMoved: [number, number] = [
    c1.position[0] - c0.position[0],
    c1.position[2] - c0.position[2],
  ];
  const dtE = e1.utcS - e0.utcS,
    dtC = c1.utcS - c0.utcS;
  return [
    {
      for: "Eva",
      otherDisplacementM: echoMoved,
      otherSpeedMS: dtC > 0 ? Math.hypot(...echoMoved) / dtC : null,
      delivered: false,
      basis:
        "ECHO's city metres (x east, z south) laid on the garden's plane (x right, y down) without rotation: a model choice",
    },
    {
      for: "ECHO",
      otherDisplacementM: evaMoved,
      otherSpeedMS: dtE > 0 ? Math.hypot(...evaMoved) / dtE : null,
      delivered: false,
      basis: `Eva's garden fractions × ${k.toFixed(3)} m per fraction, the clay page's staging of her places (a renderer interpretation, rms residual ${scale.rmsResidualM.toFixed(3)} m)`,
    },
  ];
}
