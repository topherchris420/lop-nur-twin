/**
 * The city's people as they perceive the fly, and what they do about it: a
 * bounded model of human sight and response, the counterpart of the fly's own
 * senses (`senses.ts`).
 *
 * A person sees the fly only when it is inside their field of view (214°
 * across, Strasburger et al. 2011), when it spans at least their acuity at
 * its eccentricity (1′ at the fovea, the 20/20 standard, growing linearly with
 * eccentricity, E2 = 2.72°, Kurzawski et al. 2023), and when nothing stands
 * between them. Seeing it is not noticing it: a person notices a fly in sight
 * at a rate (`noticeHz`, a model choice). Having noticed it, they look at it
 * after a reaction time (213 ms, Woods et al. 2015) and follow it with their
 * eyes while it stays in sight; out of sight for `forgetS`, it is forgotten.
 * When the fly they are looking at comes within reach in front of them, they
 * sometimes swat at it (`swatP`, a model choice): after the reaction time a
 * hand leaves their side for where they last saw the fly, in the time a slap
 * at a mosquito takes (Wynne et al. 2022) along a minimum-jerk path, and
 * comes back.
 *
 * Neither knows what the other will do. A person sees where the fly is and
 * whether it flies, never what it will do next; the fly sees a hand coming at
 * it, a moving thing like any other, and its own escape pathway decides. What
 * happens between them comes from the two running together.
 *
 * A layer stepped with the fly, never part of the city simulator: the city
 * never reads it, its people walk on as the simulator moves them, and the
 * renderer reads it only to turn a head and move an arm. A hand is seen by
 * the fly but, like every moving thing, never touches it: a swat that reaches
 * the fly is counted, not felt. Its draws come from a stream of its own, and
 * its state is part of the city fly's hash. Here `published` means reported
 * for real people in the cited paper; `model` is this simulator's choice.
 */
import { canonicalHash } from "../../game/pilot/hash.js";
import { mulberry32 } from "../../lib/noise.js";
import { fixed, model, type Citation, type Param } from "./params.js";
import { SKELETON } from "./skeleton.js";
import { degToRad, forward, left, radToDeg, type V3, wrapAngle, yawOf } from "./units.js";
import type { Mover } from "./world.js";

export const PEOPLE_CITATIONS = {
  strasburger2011: {
    short: "Strasburger, Rentschler & Jüttner 2011, J Vis 11(5):13",
    doi: "10.1167/11.5.13",
  },
  ashraf2025: {
    short: "Ashraf, Chapiro & Mantiuk 2025, Nat Commun 16:9086",
    doi: "10.1038/s41467-025-64679-2",
  },
  kurzawski2023: {
    short: "Kurzawski et al. 2023, J Vis 23(8):6",
    doi: "10.1167/jov.23.8.6",
  },
  woods2015: {
    short: "Woods et al. 2015, Front Hum Neurosci 9:131",
    doi: "10.3389/fnhum.2015.00131",
  },
  wynne2022: {
    short: "Wynne et al. 2022, Sci Rep 12:21354",
    doi: "10.1038/s41598-022-25461-2",
  },
} as const satisfies Record<string, Citation>;

export const PEOPLE_PARAMS = {
  fieldOfViewDeg: fixed(
    214,
    "deg",
    "published",
    "horizontal extent of the human visual field: peripheral vision reaches out to about 214° across",
    PEOPLE_CITATIONS.strasburger2011,
  ),
  acuityArcmin: fixed(
    1,
    "arcmin",
    "published",
    "the smallest detail resolved at the fovea: the 20/20 standard, as the cited study describes the widely accepted one (its own observers resolved finer, 94 pixels per degree); a person sees the fly only when it spans at least this, scaled for eccentricity",
    PEOPLE_CITATIONS.ashraf2025,
  ),
  acuityE2Deg: fixed(
    2.72,
    "deg",
    "published",
    "acuity grows linearly with eccentricity E, as the foveal size × (1 + E/E2); the cited study gives E2 = 2.72° for acuity, from earlier work",
    PEOPLE_CITATIONS.kurzawski2023,
  ),
  reactionMs: fixed(
    213,
    "ms",
    "published",
    "simple reaction time to a visual stimulus: 231 ms on average, 213 ms when corrected for the test's hardware delays. Here the least time from noticing the fly to looking at it, and from deciding to swat to the hand moving",
    PEOPLE_CITATIONS.woods2015,
  ),
  swatS: fixed(
    0.335,
    "s",
    "published",
    "duration of a hand slap toward a fictive mosquito, from the hand's image expanding (ten slaps by one person, 335 ± 82 ms): the time a swat takes to reach where the fly was seen, and again to come back",
    PEOPLE_CITATIONS.wynne2022,
  ),
  swatPeakSpeedMS: fixed(
    8.01,
    "m/s",
    "published",
    "peak speed of the same slaps: a swat that would need a faster peak to reach its target in `swatS` takes longer instead",
    PEOPLE_CITATIONS.wynne2022,
  ),
  noticeHz: model(
    2,
    "1/s",
    [0, 20],
    "rate at which a person notices a flying fly that is in sight: attention, not measured",
  ),
  stillNoticeShare: model(
    0.25,
    "fraction",
    [0, 1],
    "a fly that is not flying is noticed at this share of that rate (a still speck draws less attention; not measured)",
  ),
  swatP: model(
    0.3,
    "probability",
    [0, 1],
    "chance that a person looking at the fly swats at it when it comes within their reach in front of them, once each time it does. Swatting is a typical human response to biting insects, as the cited study says; no rate for a fly passing someone is published",
    PEOPLE_CITATIONS.wynne2022,
  ),
  reachM: model(
    0.6,
    "m",
    [0.3, 0.8],
    "how far from the shoulder on its side a person swats at the fly (not measured)",
  ),
  handRadiusM: model(
    0.05,
    "m",
    [0.02, 0.1],
    "the hand as the fly's eyes see it: a sphere (not measured)",
  ),
  eyeHeightM: model(
    1.6,
    "m",
    [1.2, 1.9],
    "height of a standing person's eyes above the ground (the fly sees a person as two spheres reaching 1.68 m)",
  ),
  forgetS: model(
    2,
    "s",
    [0, 30],
    "a fly out of a person's sight this long is forgotten (not measured)",
  ),
  swatRefractoryS: model(
    3,
    "s",
    [0, 60],
    "least time between the end of one swat and the decision to make another (not measured)",
  ),
} as const satisfies Record<string, Param>;

export type PeopleParamName = keyof typeof PEOPLE_PARAMS;
export type PeopleConfig = Partial<Record<PeopleParamName, number>>;
export type ResolvedPeopleParams = Readonly<Record<PeopleParamName, number>>;

/** The table's values with `config`'s overrides of model values applied, each within its range. */
export function resolvePeopleParams(config: PeopleConfig = {}): ResolvedPeopleParams {
  for (const name of Object.keys(config))
    if (!Object.hasOwn(PEOPLE_PARAMS, name)) throw new Error(`unknown parameter ${name}`);
  const out = {} as Record<PeopleParamName, number>;
  for (const name of Object.keys(PEOPLE_PARAMS) as PeopleParamName[]) {
    const param: Param = PEOPLE_PARAMS[name];
    const value = config[name];
    if (value === undefined) out[name] = param.value;
    else {
      if (param.kind !== "model")
        throw new Error(`${name} is a ${param.kind} value and cannot be overridden`);
      if (typeof value !== "number" || !Number.isFinite(value))
        throw new Error(`${name} must be a finite number`);
      if (value < param.min || value > param.max)
        throw new Error(`${name} must lie in ${param.min}–${param.max} ${param.unit}`);
      out[name] = value;
    }
  }
  return Object.freeze(out);
}

/** A person at an instant: where they stand, the ground under them, and the way they face (rad, as `units.ts` measures yaw). */
export interface PersonView {
  id: string;
  x: number;
  z: number;
  g: number;
  heading: number;
}

/** What a person can see of the fly: where it is, and whether it flies. */
export interface FlySeen {
  p: V3;
  flying: boolean;
}

export interface PersonState {
  /** They have noticed the fly and not lost it since. */
  aware: boolean;
  /** When the fly was last in their sight, and where it was then. */
  seenAt: number;
  seen: V3;
  /** From this time on they look at it: when they noticed it, plus the reaction time. */
  lookFrom: number;
  /** The fly was within their reach at the last look; a swat is decided once each time it comes within reach. */
  inReach: boolean;
  /** No swat is decided before this time. */
  nextSwat: number;
}

export interface Swat {
  id: string;
  /** The hand on the side the fly was: +1 the person's left, −1 their right. */
  side: number;
  start: number;
  /** The time out to the target, and the same back (s). */
  duration: number;
  /** Where the fly was seen when the swat was decided. */
  to: V3;
  /** The nearest the hand has come to the fly, as far as the looks saw (m). */
  nearest: number;
}

export interface PeopleState {
  /** The people near the fly, by id, and what each makes of it. */
  persons: Record<string, PersonState>;
  swats: Swat[];
  counts: { noticed: number; swats: number; reached: number };
  /** The last look: when, and where the fly was. */
  last: { t: number; p: V3 } | null;
}

export interface PeopleEvent {
  t: number;
  id: string;
  what: string;
}

/** Where a person's hand rests, from their feet (m): to its side, at the hip, a little ahead. */
const HAND_REST = { side: 0.25, up: 0.9, ahead: 0.1 };
/** A person's shoulders, from their feet (m): to each side, and up. */
const SHOULDER = { side: 0.2, up: 1.4 };
/** The vertical extent of a person's field of view, up and down from straight ahead (deg; model choices). */
const FIELD_UP_DEG = 50;
const FIELD_DOWN_DEG = 70;
/** How far round from the way they walk a person turns head and eyes to follow the fly (deg; a model choice). */
const FOLLOW_DEG = 130;
/** A swat reaches the fly from in front of the person: within this of the way they face (rad). */
const SWAT_FRONT = Math.PI / 2;
/** The log keeps this many events. */
const LOG_KEPT = 40;
/** How large the fly looks: its body perched, the span its beating wings sweep in flight (m). */
const FLY_SIZE_PERCHED_M = SKELETON.measures.bodyLengthCm / 100;
const FLY_SIZE_FLYING_M = (2 * SKELETON.measures.wingLengthCm) / 100;
/** A time never reached: a state's "not yet" (hashed states hold no infinities). */
const NEVER = 1e9;

/** What a person can make of the fly at one look. */
export interface Percept {
  distance: number;
  /** Where it is from the way they face (rad, + to their left), and above their eyes. */
  bearing: number;
  elevation: number;
  /** How far from where their eyes point, how large it looks and how large it must be there (arcmin). */
  eccentricityDeg: number;
  sizeArcmin: number;
  neededArcmin: number;
  inField: boolean;
  resolved: boolean;
  clear: boolean;
  inSight: boolean;
}

/**
 * What a person standing as `person` makes of the fly: inside their field of
 * view, or followed by their eyes once they look at it (`looking`) while it
 * stays within `FOLLOW_DEG` of the way they face; large enough for their
 * acuity at its eccentricity; and in clear view. The line of sight is cast
 * only when the first two hold.
 */
export function perceive(
  P: ResolvedPeopleParams,
  person: PersonView,
  fly: FlySeen,
  looking: boolean,
  sight: (from: V3, to: V3) => boolean,
): Percept {
  const eye: V3 = [person.x, person.g + P.eyeHeightM, person.z];
  const d: V3 = [fly.p[0] - eye[0], fly.p[1] - eye[1], fly.p[2] - eye[2]];
  const dist = Math.hypot(...d);
  const bearing = wrapAngle(yawOf(d[0], d[2]) - person.heading);
  const elevation = dist > 0 ? Math.asin(Math.max(-1, Math.min(1, d[1] / dist))) : 0;
  // Their eyes are on the fly once they look at it, while head and eyes can
  // turn that far round; straight ahead before.
  const followed = looking && Math.abs(bearing) <= degToRad(FOLLOW_DEG);
  const eccentricity = followed ? 0 : Math.acos(Math.cos(bearing) * Math.cos(elevation));
  const size = fly.flying ? FLY_SIZE_FLYING_M : FLY_SIZE_PERCHED_M;
  const sizeArcmin = dist > 0 ? radToDeg(2 * Math.atan(size / 2 / dist)) * 60 : Infinity;
  const neededArcmin = P.acuityArcmin * (1 + radToDeg(eccentricity) / P.acuityE2Deg);
  const inField =
    followed ||
    (Math.abs(bearing) <= degToRad(P.fieldOfViewDeg / 2) &&
      elevation <= degToRad(FIELD_UP_DEG) &&
      elevation >= -degToRad(FIELD_DOWN_DEG));
  const resolved = sizeArcmin >= neededArcmin;
  const clear = inField && resolved && sight(eye, fly.p);
  return {
    distance: dist,
    bearing,
    elevation,
    eccentricityDeg: radToDeg(eccentricity),
    sizeArcmin,
    neededArcmin,
    inField,
    resolved,
    clear,
    inSight: inField && resolved && clear,
  };
}

/** The minimum-jerk path's share of the way done at u ∈ [0, 1] of its time. */
const minimumJerk = (u: number) => u * u * u * (10 - 15 * u + 6 * u * u);
const distance = (a: readonly number[], b: readonly number[]) =>
  Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

export interface PeopleOptions {
  /** The city fly's seed: the people draw from a stream of their own derived from it. */
  seed: number;
  /** Whether the line from one point to another is clear (seen through glass). */
  sight: (from: V3, to: V3) => boolean;
  /** Where a person is at time `t`, or null when they are not near. */
  where: (id: string, t: number) => PersonView | null;
  config?: PeopleConfig;
}

export class People {
  readonly state: PeopleState = {
    persons: {},
    swats: [],
    counts: { noticed: 0, swats: 0, reached: 0 },
    last: null,
  };
  readonly params: ResolvedPeopleParams;
  /** What the people did, newest last; not part of the state. */
  readonly log: PeopleEvent[] = [];
  private rng: () => number;
  private sight: PeopleOptions["sight"];
  private where: PeopleOptions["where"];

  constructor(o: PeopleOptions) {
    this.params = resolvePeopleParams(o.config);
    this.rng = mulberry32((o.seed ^ 0x5be0cd19) >>> 0);
    this.sight = o.sight;
    this.where = o.where;
  }

  /** The farthest anyone can resolve the fly, in flight and at the fovea (m). */
  get range(): number {
    return FLY_SIZE_FLYING_M / 2 / Math.tan(degToRad(this.params.acuityArcmin / 60) / 2);
  }

  /**
   * One look at the fly by everyone near it, at time `t`: who sees it, who
   * notices it, who stops looking, who decides to swat; and how near the
   * hands under way have come to it since the last look.
   */
  observe(t: number, fly: FlySeen, people: readonly PersonView[]): void {
    const P = this.params;
    const S = this.state;
    const dt = S.last ? Math.max(0, t - S.last.t) : 0;
    const reaction = P.reactionMs / 1000;
    const size = fly.flying ? FLY_SIZE_FLYING_M : FLY_SIZE_PERCHED_M;
    const near = new Set<string>();
    for (const person of people) {
      const dist = Math.hypot(
        fly.p[0] - person.x,
        fly.p[1] - person.g - P.eyeHeightM,
        fly.p[2] - person.z,
      );
      let st = S.persons[person.id];
      if (!st) {
        if (dist > this.range) continue;
        st = S.persons[person.id] = {
          aware: false,
          seenAt: -NEVER,
          seen: [...fly.p],
          lookFrom: NEVER,
          inReach: false,
          nextSwat: -NEVER,
        };
      }
      near.add(person.id);
      const looking = st.aware && t >= st.lookFrom;
      const seen = perceive(P, person, fly, looking, this.sight);
      const { bearing, inSight } = seen;
      if (inSight) {
        st.seenAt = t;
        st.seen = [...fly.p];
      }
      if (!st.aware) {
        const rate = P.noticeHz * (fly.flying ? 1 : P.stillNoticeShare);
        if (inSight && dt > 0 && this.rng() < 1 - Math.exp(-rate * dt)) {
          st.aware = true;
          st.lookFrom = t + reaction;
          S.counts.noticed++;
          this.note(
            t,
            person.id,
            `noticed the fly ${dist.toFixed(1)} m away, ${seen.eccentricityDeg.toFixed(0)}° from where they were looking`,
          );
        }
      } else if (t - st.seenAt > P.forgetS) {
        st.aware = false;
        st.lookFrom = NEVER;
        this.note(t, person.id, `lost sight of the fly for ${P.forgetS} s: forgotten`);
      }
      // Within reach, in front, of someone looking at it: a swat, sometimes.
      const side = bearing >= 0 ? 1 : -1;
      const shoulder = this.point(person, side * SHOULDER.side, SHOULDER.up, 0);
      const within =
        looking &&
        inSight &&
        Math.abs(bearing) <= SWAT_FRONT &&
        distance(shoulder, fly.p) <= P.reachM;
      if (within && !st.inReach && t >= st.nextSwat && this.rng() < P.swatP) {
        const from = this.point(
          person,
          side * HAND_REST.side,
          HAND_REST.up,
          HAND_REST.ahead,
        );
        const duration = Math.max(
          P.swatS,
          (1.875 * distance(from, fly.p)) / P.swatPeakSpeedMS,
        );
        S.swats.push({
          id: person.id,
          side,
          start: t + reaction,
          duration,
          to: [...fly.p],
          nearest: NEVER,
        });
        st.nextSwat = t + reaction + 2 * duration + P.swatRefractoryS;
        S.counts.swats++;
        this.note(
          t,
          person.id,
          `swats at the fly with their ${side > 0 ? "left" : "right"} hand, ${distance(shoulder, fly.p).toFixed(2)} m from their shoulder`,
        );
      }
      st.inReach = within;
    }
    // People no longer near: kept only while they still remember the fly.
    for (const id of Object.keys(S.persons))
      if (
        !near.has(id) &&
        (!S.persons[id]!.aware || t - S.persons[id]!.seenAt > P.forgetS)
      )
        delete S.persons[id];
    // How near each hand under way has come to the fly: now, and where its
    // path ended if that fell since the last look (the fly then between the
    // two), unless its person had gone by then.
    for (const swat of S.swats) {
      const hand = this.handAt(swat, t);
      if (hand) swat.nearest = Math.min(swat.nearest, distance(hand, fly.p));
      const arrive = swat.start + swat.duration;
      const end = S.last && arrive > S.last.t && arrive <= t && this.handAt(swat, arrive);
      if (S.last && end) {
        const u = (arrive - S.last.t) / (t - S.last.t);
        const then: V3 = [0, 1, 2].map(
          (k) => S.last!.p[k]! + (fly.p[k]! - S.last!.p[k]!) * u,
        ) as V3;
        swat.nearest = Math.min(swat.nearest, distance(end, then));
      }
    }
    S.swats = S.swats.filter((swat) => {
      if (t < swat.start + 2 * swat.duration) return true;
      const reached = swat.nearest <= P.handRadiusM + size / 2;
      if (reached) S.counts.reached++;
      const cm = (swat.nearest * 100).toFixed(0);
      this.note(
        t,
        swat.id,
        reached
          ? `the swat reached the fly (the hand came within ${cm} cm); a hand is seen, never felt, so it flies on`
          : swat.nearest >= NEVER
            ? "the swat ended out of view: the person went indoors"
            : `the swat missed: the hand came no nearer than ${cm} cm`,
      );
      return false;
    });
    S.last = { t, p: [...fly.p] };
  }

  /** The hands of the swats under way at time `t` within `radius` of `near`, for the fly's eyes. */
  hands(t: number, near: V3, radius: number, out: Mover[]): void {
    const r = this.params.handRadiusM;
    for (const swat of this.state.swats) {
      const hand = this.handAt(swat, t);
      if (!hand || distance(hand, near) > radius + r) continue;
      out.push({ id: `${swat.id}:hand`, kind: "hand", center: hand, radius: r });
    }
  }

  /**
   * For drawing a person at time `t`: the point they look at (the fly, where
   * they last saw it) and their swatting hand with its side, or null when
   * they do neither.
   */
  pose(id: string, t: number): { look: V3 | null; hand: V3 | null; side: number } | null {
    const st = this.state.persons[id];
    const look = st && st.aware && t >= st.lookFrom ? st.seen : null;
    const swat = this.state.swats.find((s) => s.id === id);
    const hand = swat ? this.handAt(swat, t) : null;
    if (!look && !hand) return null;
    return { look, hand, side: hand ? swat!.side : 0 };
  }

  /** A hash of everything that decides what the people do next. */
  stateHash(): string {
    return canonicalHash(this.state);
  }

  /** Where a swat's hand is at time `t`: out from the person's side to the target and back. */
  private handAt(swat: Swat, t: number): V3 | null {
    const u = (t - swat.start) / swat.duration;
    if (u < 0 || u > 2) return null;
    const person = this.where(swat.id, t);
    if (!person) return null;
    const from = this.point(
      person,
      swat.side * HAND_REST.side,
      HAND_REST.up,
      HAND_REST.ahead,
    );
    const s = minimumJerk(u <= 1 ? u : 2 - u);
    return [0, 1, 2].map((k) => from[k]! + (swat.to[k]! - from[k]!) * s) as V3;
  }

  /** A point on a person: `side` to their left (negative: right), `up` from their feet, `ahead` of them. */
  private point(person: PersonView, side: number, up: number, ahead: number): V3 {
    const f = forward(person.heading),
      l = left(person.heading);
    return [
      person.x + l[0] * side + f[0] * ahead,
      person.g + up,
      person.z + l[2] * side + f[2] * ahead,
    ];
  }

  private note(t: number, id: string, what: string): void {
    this.log.push({ t, id, what });
    if (this.log.length > LOG_KEPT) this.log.shift();
  }
}
