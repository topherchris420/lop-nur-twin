/**
 * Where the fly thinks it is, and what it remembers: path integration with a
 * celestial compass, places remembered by the landmarks around them, and a
 * coarse memory of where it has been. The reduced-order controller uses it to
 * choose long flights, return to food and search near it.
 *
 * - Path integration: the fly adds up its own travel. Its distance estimate
 *   has a relative error (`odometryNoise`), drawn afresh for each bout of
 *   walking or flight and held through it, so the error grows with the
 *   distance; its heading estimate holds to a celestial compass under an open
 *   sky (the sun or the sky's polarization, in sun or in shade) or the
 *   dominant light (a lamp, as the cited flies hold a heading to a bright
 *   spot), and drifts ten times faster without either. The estimate
 *   therefore wanders from the truth, as path integration does (Behbahani et
 *   al. 2021 for walking flies near food).
 * - Places: where the fly fed is remembered at its estimated position with
 *   the ids of the landmarks then in view (upright posts, poles, trunks).
 *   Seeing one of them again tells the fly where it is: its estimate is reset
 *   to the truth, as recognizing a place would (Ofstad et al. 2011 for visual
 *   place memory). A place is forgotten after `placeMemoryS`, and after
 *   `PLACE_MISSES` fruitless returns unless a controller's `PlaceValuation`
 *   decides which places still draw the fly back.
 * - Visited cells: the 10 m squares of its own estimate the fly has been in,
 *   with when. A long flight goes toward the direction it has visited least
 *   (a model choice: no cited study shows flies avoiding where they have been).
 * - Failed sites: a landing site whose approach was abandoned or aborted is
 *   not chosen again for `FAILED_SITE_S`, so the fly does not retry one it
 *   cannot reach (a model choice).
 *
 * Nothing here is a model of the central complex; it is bookkeeping with the
 * errors stated. Its random draws come from a stream of their own, so a
 * world without places, food or long flights draws nothing from the
 * controller's main stream on its account.
 */
import { gauss } from "./senses.js";
import type { SenseFrame } from "./senses.js";
import type { ResolvedParams } from "./params.js";
import { degToRad, wrapAngle, yawOf } from "./units.js";
import { outsideExtent, type Home } from "./world.js";

/** Side of a visited cell (m), in the fly's own estimate. */
export const CELL_M = 10;
/** How many visited cells are kept (the oldest are dropped). */
const CELLS_KEPT = 400;
/** How many places are kept (the oldest are dropped). */
const PLACES_KEPT = 12;
/** A remembered place keeps the ids of at most this many landmarks. */
const PLACE_LANDMARKS = 3;
/** An abandoned or aborted landing site is not chosen again for this long (s). */
export const FAILED_SITE_S = 60;
/** Without the dominant light in view, the heading drifts this many times faster. */
const DARK_DRIFT = 10;
/** A heading a long flight stalled on is avoided within this distance of where it stalled (m). */
const BLOCKED_NEAR_M = 10;
/** ...and within this angle of it (rad): the stalled direction of eight, not its neighbours. */
const BLOCKED_HALF_ANGLE = Math.PI / 8;

export interface Place {
  kind: "food";
  /** What the food was (its kind, as the feet tasted it). */
  what: string;
  /** Where the fly estimated it was (x, z). */
  at: [number, number];
  landmarks: string[];
  /** When it was last there (s). */
  t: number;
  /** Returns that found nothing there: after `PLACE_MISSES` the place is forgotten. */
  misses: number;
}
/** A remembered place the fly has come back to this often without finding its food is forgotten. */
export const PLACE_MISSES = 2;
/** A remembered place nearer than this (by the estimate) is searched for, not flown to (m). */
export const RETURN_MIN_M = 5;

/**
 * What decides whether a remembered food place still draws the fly back,
 * for a controller that learns it (the mushroom body's, `mushroomBody/`).
 * Without one the bookkeeping's own rule holds: every remembered place
 * draws a hungry fly, and `PLACE_MISSES` fruitless returns forget it.
 */
export interface PlaceValuation {
  /** Whether a hungry fly goes back to `place`. */
  worth(place: Place): boolean;
  /** The fly started a meal at `place` (just remembered, or remembered again). */
  fed(place: Place): void;
  /** The fly came back to `place` and found neither its food nor its odour; true forgets it. */
  missed(place: Place): boolean;
}

/**
 * Each navigator's valuation, kept beside it rather than in it, so a
 * navigator without one (the reduced-order controller's) keeps the object
 * graph, and its checkpoints the bytes, it had before valuations existed.
 */
const VALUATION = new WeakMap<Navigator, PlaceValuation>();

export interface Goal {
  kind: "explore" | "return";
  /** The goal (x, z), in the fly's own estimate. */
  at: [number, number];
  since: number;
  /** The nearest the estimate has come to the goal, and when that last improved by a metre. */
  nearest: number;
  progressAt: number;
}

export interface NavigationState {
  /** The fly's estimate of its position (x, z) and its heading error (rad, estimate − truth). */
  est: [number, number];
  headingErr: number;
  /** This bout's odometry gain (1 is exact), and the mode it was drawn for. */
  odoGain: number;
  odoMode: string;
  /** Whether the dominant light was in view at the last update (the compass). */
  compass: boolean;
  places: Place[];
  /** Visited cells, as [cell key, last time], oldest first. */
  visited: [string, number][];
  goal: Goal | null;
  /** Odour at the last decision, for its change. */
  lastOdour: number;
  /** Local search around food: where (x, z, estimate) and until when. */
  search: { at: [number, number]; until: number } | null;
  /** Landing sites not to choose again before the time given. */
  failed: [string, number][];
  /** Headings a long flight stalled on: where (x, z, estimate), the heading (rad), and until when. */
  blocked: [number, number, number, number][];
}

export function initialNavigation(x: number, z: number): NavigationState {
  return {
    est: [x, z],
    headingErr: 0,
    odoGain: 1,
    odoMode: "",
    compass: false,
    places: [],
    visited: [],
    goal: null,
    lastOdour: 0,
    search: null,
    failed: [],
    blocked: [],
  };
}

const cellKey = (x: number, z: number) =>
  `${Math.floor(x / CELL_M)},${Math.floor(z / CELL_M)}`;

export class Navigator {
  readonly state: NavigationState;
  private rng: () => number;
  constructor(
    state: NavigationState,
    rng: () => number,
    valuation: PlaceValuation | null = null,
  ) {
    this.state = state;
    this.rng = rng;
    if (valuation) VALUATION.set(this, valuation);
  }

  private get valuation(): PlaceValuation | null {
    return VALUATION.get(this) ?? null;
  }

  /**
   * One decision period of path integration: the body's travel over `dt`
   * (its velocity, which the fly senses through its own motion), measured
   * with the stated errors.
   */
  integrate(
    v: readonly number[],
    dt: number,
    frame: SenseFrame,
    P: ResolvedParams,
    t: number,
    mode: string,
  ): void {
    const S = this.state;
    S.compass = frame.sky || frame.lightBearing !== null;
    // A walking bout and a flight each get their own odometry gain.
    const moving =
      mode === "walk" ? "walk" : mode === "flight" || mode === "land" ? "flight" : "";
    if (moving && moving !== S.odoMode)
      S.odoGain = Math.max(0, 1 + P.odometryNoise * gauss(this.rng) * 0.5);
    S.odoMode = moving;
    const drift = degToRad(P.compassNoiseDeg) * (S.compass ? 1 : DARK_DRIFT);
    // With the compass the error stays near zero; without it, it wanders.
    S.headingErr = S.compass
      ? drift * gauss(this.rng) * 0.5
      : wrapAngle(S.headingErr + drift * Math.sqrt(dt) * gauss(this.rng) * 0.5);
    const dx = v[0]! * dt,
      dz = v[2]! * dt;
    const d = Math.hypot(dx, dz);
    if (d > 0) {
      const gain = S.odoGain;
      const c = Math.cos(S.headingErr),
        s = Math.sin(S.headingErr);
      // The travel turned by the heading error (a turn about +y, as yaw is).
      S.est[0] += (dx * c + dz * s) * gain;
      S.est[1] += (-dx * s + dz * c) * gain;
    }
    const key = cellKey(S.est[0], S.est[1]);
    const last = S.visited[S.visited.length - 1];
    if (!last || last[0] !== key) {
      const i = S.visited.findIndex((c) => c[0] === key);
      if (i >= 0) S.visited.splice(i, 1);
      S.visited.push([key, t]);
      if (S.visited.length > CELLS_KEPT) S.visited.shift();
    } else last[1] = t;
    S.places = S.places.filter((p) => t - p.t <= P.placeMemoryS);
    S.failed = S.failed.filter(([, until]) => until > t);
    S.blocked = S.blocked.filter((b) => b[3] > t);
  }

  /**
   * Seeing a landmark of a remembered place resets the estimate to where the
   * fly truly is: the place is recognized, and with it the fly's position.
   */
  recognize(frame: SenseFrame, x: number, z: number, t: number): Place | null {
    const S = this.state;
    if (!frame.landmarks.length) return null;
    for (const place of S.places)
      if (frame.landmarks.some((l) => place.landmarks.includes(l.id))) {
        S.est = [x, z];
        place.t = Math.max(place.t, t - 1e-9);
        return place;
      }
    return null;
  }

  /** Remember where the fly is feeding, with the landmarks in view. */
  rememberFood(what: string, frame: SenseFrame, t: number): void {
    const S = this.state;
    const ids = frame.landmarks.slice(0, PLACE_LANDMARKS).map((l) => l.id);
    const near = S.places.find(
      (p) => p.kind === "food" && Math.hypot(p.at[0] - S.est[0], p.at[1] - S.est[1]) < 2,
    );
    if (near) {
      near.t = t;
      near.misses = 0;
      near.what = what;
      near.at = [S.est[0], S.est[1]];
      if (ids.length) near.landmarks = ids;
      this.valuation?.fed(near);
      return;
    }
    const place: Place = {
      kind: "food",
      what,
      at: [S.est[0], S.est[1]],
      landmarks: ids,
      t,
      misses: 0,
    };
    S.places.push(place);
    if (S.places.length > PLACES_KEPT) S.places.shift();
    this.valuation?.fed(place);
  }

  /** The remembered food place nearest the estimate that still draws the fly back, or null. */
  foodPlace(): Place | null {
    return this.nearestFood(true);
  }

  private nearestFood(drawing: boolean): Place | null {
    const S = this.state;
    let best: Place | null = null,
      bestD = Infinity;
    for (const p of S.places) {
      if (p.kind !== "food") continue;
      if (drawing && this.valuation && !this.valuation.worth(p)) continue;
      const d = Math.hypot(p.at[0] - S.est[0], p.at[1] - S.est[1]);
      if (d < bestD) {
        best = p;
        bestD = d;
      }
    }
    return best;
  }

  /**
   * A goal for a long flight: a remembered food place when hungry, else a
   * point `exploreDistanceM` away on average toward the least visited of
   * eight directions, kept inside the fly's extent and off the headings
   * blocked near here. Null when the extent leaves no goal at least 2 m away
   * (an arena), or when not exploring; `force` (a stalled flight choosing
   * again) skips the draw against `exploreShare`.
   */
  chooseGoal(
    hungry: boolean,
    home: Home,
    P: ResolvedParams,
    t: number,
    truth: { x: number; z: number },
    force = false,
  ): Goal | null {
    const S = this.state;
    const food = hungry ? this.foodPlace() : null;
    if (
      food &&
      Math.hypot(food.at[0] - S.est[0], food.at[1] - S.est[1]) >= RETURN_MIN_M &&
      !this.isBlocked(yawOf(food.at[0] - S.est[0], food.at[1] - S.est[1]))
    )
      return this.goal("return", food.at, t);
    if (!force && this.rng() >= P.exploreShare) return null;
    const dist = -Math.log(1 - this.rng()) * P.exploreDistanceM;
    let best: { at: [number, number]; score: number } | null = null;
    const offset = this.rng() * 2 * Math.PI;
    for (let k = 0; k < 8; k++) {
      const a = offset + (k * Math.PI) / 4;
      if (this.isBlocked(a)) continue;
      // The point at heading a (the yaw convention of units.ts).
      const at: [number, number] = [
        S.est[0] + Math.cos(a) * dist,
        S.est[1] - Math.sin(a) * dist,
      ];
      // Kept inside the extent, judged from the truth: the edge is the world's.
      const off = [at[0] - S.est[0] + truth.x, at[1] - S.est[1] + truth.z];
      const { away } = outsideExtent(home, off[0]!, off[1]!);
      if (away > 0) continue;
      let seen = 0;
      for (let u = 0.25; u <= 1; u += 0.25) {
        const key = cellKey(
          S.est[0] + (at[0] - S.est[0]) * u,
          S.est[1] + (at[1] - S.est[1]) * u,
        );
        if (S.visited.some((c) => c[0] === key)) seen++;
      }
      const score = -seen + 0.1 * this.rng();
      if (!best || score > best.score) best = { at, score };
    }
    if (!best || dist < 2) return null;
    return this.goal("explore", best.at, t);
  }

  private goal(kind: Goal["kind"], at: [number, number], t: number): Goal {
    const S = this.state;
    const nearest = Math.hypot(at[0] - S.est[0], at[1] - S.est[1]);
    return (S.goal = { kind, at: [at[0], at[1]], since: t, nearest, progressAt: t });
  }

  /**
   * The goal's bearing relative to where the fly believes it is heading, and
   * its distance (by the estimate); updates the progress the goal has made.
   */
  steer(yaw: number, t: number): { bearing: number; dist: number } | null {
    const S = this.state;
    const g = S.goal;
    if (!g) return null;
    const dx = g.at[0] - S.est[0],
      dz = g.at[1] - S.est[1];
    const dist = Math.hypot(dx, dz);
    if (dist < g.nearest - 1) {
      g.nearest = dist;
      g.progressAt = t;
    }
    return { bearing: wrapAngle(yawOf(dx, dz) - (yaw + S.headingErr)), dist };
  }

  /**
   * Back at a remembered food place without finding its food: one more miss,
   * and the place is forgotten after `PLACE_MISSES` (or when the valuation
   * says so).
   */
  missed(): void {
    const S = this.state;
    const place = this.nearestFood(false);
    if (!place) return;
    const forget = this.valuation
      ? this.valuation.missed(place)
      : ++place.misses >= PLACE_MISSES;
    if (forget) S.places = S.places.filter((p) => p !== place);
  }

  /** A draw from the navigation stream, for choices made with it (meal lengths, shade). */
  draw(): number {
    return this.rng();
  }

  /**
   * A long flight that stopped getting closer: its heading from here is not
   * chosen again for `FAILED_SITE_S` while the fly is within `BLOCKED_NEAR_M`
   * of this point (by its estimate).
   */
  stalled(t: number): void {
    const S = this.state;
    const g = S.goal;
    if (!g) return;
    S.blocked.push([
      S.est[0],
      S.est[1],
      yawOf(g.at[0] - S.est[0], g.at[1] - S.est[1]),
      t + FAILED_SITE_S,
    ]);
    S.goal = null;
  }

  /** Whether a heading (rad) from the estimate is one a long flight stalled on near here. */
  private isBlocked(heading: number): boolean {
    const S = this.state;
    return S.blocked.some(
      (b) =>
        Math.hypot(b[0] - S.est[0], b[1] - S.est[1]) < BLOCKED_NEAR_M &&
        Math.abs(wrapAngle(heading - b[2])) < BLOCKED_HALF_ANGLE,
    );
  }

  /** Give a site up for a while after an abandoned or aborted landing. */
  failedSite(id: string, t: number): void {
    const S = this.state;
    S.failed = S.failed.filter(([f]) => f !== id);
    S.failed.push([id, t + FAILED_SITE_S]);
  }

  failed(id: string): boolean {
    return this.state.failed.some(([f]) => f === id);
  }
}
