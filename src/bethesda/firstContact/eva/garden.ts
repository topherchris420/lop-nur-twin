/**
 * A research garden: Eva's controller, ported to TypeScript for research
 * subjects only. It is `deploy/garden/service/server.py` (her patched
 * service: the original plus the lines tagged `# eva-plasticity`) with
 * `learning.py` (`learning.ts`) and `eva_plasticity.py` (`plasticity.ts`),
 * and given the same seed, birth time, clock times and weather it steps
 * exactly as her Python code does (`eva.test.ts` replays fixtures written by
 * `scripts/eva-parity.py`).
 *
 * Never Eva. A garden is born here from a caller's seed and a `research-` id
 * (`birth`), or restored from a research garden's own state (`restore`);
 * both refuse an original's id (`refuseOriginal`). Nothing in production may
 * import this (AGENTS.md, first contact).
 *
 * What differs from her service, by design:
 * - persistence is in memory: the `world` row is this object's state, the
 *   `moments` table is a bounded tail of moments plus their count (every
 *   moment's random draws still happen exactly as in Python), and the
 *   plasticity sidecar is an in-memory `PlasticityMemory`;
 * - there is no HTTP server, weather fetcher, wall clock or `uuid4`: the
 *   caller supplies times, weather (`setWeather`), the seed and the id;
 * - `snapshot` is her `/state` payload without `server_time`, and with the
 *   weather's fetch bookkeeping (`fetched_at`, `sun`) left out.
 *
 * Research seams, all absent by default (then behaviour is Python's): see
 * `GardenOptions`.
 */
import { OriginalRefused, refuseOriginal } from "../originals.js";
import {
  chooseMotion,
  context,
  execute,
  freshBody,
  freshLearning,
  model,
  summary,
  type Body,
  type LearnerState,
  type LearningSummary,
  type Obstruct,
  type Perceive,
  type Point,
  type Weather,
} from "./learning.js";
import { newYork } from "./newYork.js";
import {
  EvaPlasticity,
  type PlasticityMemory,
  type PlasticityMode,
  type PlasticityStatus,
} from "./plasticity.js";
import { pyDist, pyHypot, pyRound, pyRoundInt } from "./pyMath.js";
import { PyRandom } from "./pyRandom.js";

export type PlaceId =
  "leaf" | "window" | "flowers" | "pear" | "water" | "fence" | "stone";

export interface Place {
  name: string;
  /** Garden fractions: x right, y down. */
  x: number;
  y: number;
  sheltered?: boolean;
}

/** Her seven places, in her order (the order `random.choice` sees). */
export const PLACE_IDS: readonly PlaceId[] = Object.freeze([
  "leaf",
  "window",
  "flowers",
  "pear",
  "water",
  "fence",
  "stone",
]);

export const PLACES: Readonly<Record<PlaceId, Readonly<Place>>> = Object.freeze({
  leaf: Object.freeze({
    name: "Under the maple leaf",
    x: 0.29,
    y: 0.38,
    sheltered: true,
  }),
  window: Object.freeze({
    name: "The warm windowsill",
    x: 0.82,
    y: 0.375,
    sheltered: true,
  }),
  flowers: Object.freeze({ name: "The last of the asters", x: 0.68, y: 0.63 }),
  pear: Object.freeze({ name: "A fallen pear", x: 0.24, y: 0.79 }),
  water: Object.freeze({ name: "The rain saucer", x: 0.51, y: 0.83 }),
  fence: Object.freeze({ name: "The cedar fence", x: 0.13, y: 0.53 }),
  stone: Object.freeze({ name: "A sun-warmed stone", x: 0.77, y: 0.85 }),
});

export const ARRIVALS: Readonly<Record<PlaceId, readonly string[]>> = Object.freeze({
  leaf: [
    "Finds the small, sheltered world beneath a maple leaf.",
    "Tucks into a familiar fold of green.",
  ],
  window: [
    "Lands on the windowsill, where a little warmth lingers.",
    "The window holds a small square of borrowed warmth.",
  ],
  flowers: [
    "Finds a little sweetness in the late asters.",
    "Visits the asters. There is still something here.",
  ],
  pear: [
    "A fallen pear offers more than enough for one fly.",
    "Returns to the pear and its soft, sweet edge.",
  ],
  water: [
    "Takes a drink from the rain saucer.",
    "Finds a bead of water on the saucer's rim.",
  ],
  fence: [
    "Lands on the cedar fence and feels the air.",
    "Tries a different patch of the old fence.",
  ],
  stone: [
    "Settles on a smooth stone beside the path.",
    "Rests where the garden meets the path.",
  ],
});

const DEPARTURES = [
  "Lifts off, following a small possibility.",
  "Takes the long way across the garden.",
  "Leaves its perch. The garden is wide enough.",
];
const SLEEPING = [
  "A breeze stirs the leaf. The fly settles a little closer to the stem.",
  "Wings folded. The night has its own kind of life.",
  "Somewhere beyond the fence, Bethesda goes on. Here, a fly rests.",
];
const IDLE = [
  "Turns toward a passing ripple in the air.",
  "A small pause. Then a small adjustment.",
  "The garden offers another patch of light and shade.",
];
export const BIRTH_MOMENT = "A small life begins in a garden in Bethesda.";
export const STALL_MOMENT = "The journey asks too much for now. Pauses to recover.";
const MORNING = "Morning reaches the garden. Another day to be a fly.";
const EVENING = "The garden slips into evening. A quiet place begins to matter.";
const TAU = 2 * Math.PI;

export type Activity =
  "sleeping" | "feeding" | "drinking" | "resting" | "grooming" | "flying" | "walking";

export interface Travel {
  from: Point;
  to: Point;
  control: Point;
  started_at: number;
  ends_at: number;
  destination: PlaceId;
  paused_until?: number;
}

/** Her `world` row, field for field. */
export interface EvaState extends LearnerState {
  version: number;
  life_id: string;
  born_at: number;
  updated_at: number;
  ticks: number;
  seed: string;
  place: PlaceId;
  position: Point;
  activity: Activity;
  travel: Travel | null;
  energy: number;
  fullness: number;
  water: number;
  distance: number;
  journeys: number;
  visits: Partial<Record<PlaceId, number>>;
  next_decision: number;
  next_moment: number;
  was_day: boolean;
  weather: Weather;
  body: Body;
}

export interface Moment {
  id: number;
  at: number;
  text: string;
}

/** `seasonal_weather`: her fallback when no fresh weather was fetched. */
export function seasonalWeather(now: number): Weather {
  const local = newYork(now);
  const temperatures = [3, 5, 10, 17, 22, 27, 30, 29, 25, 18, 11, 6];
  return {
    temperature:
      temperatures[local.month - 1]! - (local.hour < 8 || local.hour > 18 ? 7 : 0),
    code: 2,
    wind: 7,
    rain: 0,
    fetched_at: 0,
    source: "seasonal",
    sun: {},
  };
}

/** `daylight`: the fetched sunrise and sunset, else her seasonal estimate. */
export function daylight(now: number, weather: Weather): boolean {
  const local = newYork(now);
  const sun = (weather.sun ?? {})[local.date];
  if (sun && sun.length) return sun[0]! <= now && now < sun[1]!;
  const hours = 12 + 2.6 * Math.sin((2 * Math.PI * (local.yday - 80)) / 365.25);
  const noon = 12.15 + local.dst / 3600;
  const clock = local.hour + local.minute / 60;
  return noon - hours / 2 <= clock && clock < noon + hours / 2;
}

export function weatherName(code: number): string {
  if (code === 0) return "clear skies";
  if (code === 1 || code === 2) return "partly cloudy";
  if (code === 3) return "overcast";
  if (code === 45 || code === 48) return "a little fog";
  if ((51 <= code && code <= 67) || (80 <= code && code <= 82))
    return "rain in the garden";
  if ((71 <= code && code <= 77) || code === 85 || code === 86) return "snow in Bethesda";
  if (code >= 95) return "a passing storm";
  return "changing skies";
}

export interface GardenOptions {
  /** Research only: extra things her own tracker follows (`learning.ts`). */
  perceive?: Perceive;
  /** Research only: where a motion actually stops (`learning.ts`). */
  obstruct?: Obstruct;
  /**
   * Research only: called after every step `advance` takes, with this garden.
   * It must only read (a deep copy via `state()`); it changes nothing.
   */
  onStep?: (garden: EvaGarden) => void;
  /** Moments kept in memory (all are counted). Default 1000. */
  keepMoments?: number;
}

export interface Needs {
  energy: number;
  fullness: number;
  water: number;
}

export interface GardenSnapshot {
  life_id: string;
  born_at: number;
  updated_at: number;
  ticks: number;
  place: PlaceId;
  place_name: string;
  position: Point;
  activity: Activity;
  travel: Travel | null;
  journeys: number;
  distance: number;
  places_visited: number;
  moments_count: number;
  moments: Moment[];
  weather: Omit<Weather, "fetched_at" | "sun"> & { description: string; is_day: boolean };
  learning: LearningSummary;
  needs: Needs;
  adaptive?: PlasticityStatus;
}

function refuseNonResearch(id: string): void {
  refuseOriginal(id, "Eva research garden");
  if (!id.startsWith("research-"))
    throw new OriginalRefused(`research garden ids start with "research-", not ${id}`);
}

export class EvaGarden {
  private readonly s: EvaState;
  /** Her plasticity extension, or null when it is off (her original service). */
  readonly plasticity: EvaPlasticity | null;
  private readonly perceive: Perceive | undefined;
  private readonly obstruct: Obstruct | undefined;
  private readonly onStep: ((garden: EvaGarden) => void) | undefined;
  private readonly keep: number;
  private readonly kept: Moment[] = [];
  private count = 0;

  private constructor(
    state: EvaState,
    plasticity: EvaPlasticity | null,
    options: GardenOptions,
    moments: { count: number; kept: Moment[] } = { count: 0, kept: [] },
  ) {
    this.s = state;
    this.plasticity = plasticity;
    this.perceive = options.perceive;
    this.obstruct = options.obstruct;
    this.onStep = options.onStep;
    this.keep = Math.max(8, options.keepMoments ?? 1000);
    this.count = moments.count;
    this.kept.push(...moments.kept.slice(-this.keep));
  }

  /** `World.__init__` for a new life (see `birth`). */
  static born(options: BirthOptions): EvaGarden {
    refuseNonResearch(options.lifeId);
    if (typeof options.seed !== "string" || !options.seed)
      throw new Error("a research garden needs a seed string");
    const now = options.bornAt;
    if (!Number.isFinite(now)) throw new Error("bornAt must be unix seconds");
    const place: PlaceId = !daylight(now, seasonalWeather(now)) ? "leaf" : "flowers";
    const state: EvaState = {
      version: 1,
      life_id: options.lifeId,
      born_at: now,
      updated_at: now,
      ticks: 0,
      seed: options.seed,
      place,
      position: [PLACES[place].x, PLACES[place].y],
      activity: place === "leaf" ? "sleeping" : "feeding",
      travel: null,
      energy: 78.0,
      fullness: 75.0,
      water: 80.0,
      distance: 0.0,
      journeys: 0,
      visits: { [place]: 1 },
      next_decision: now + 100,
      next_moment: now + 180,
      was_day: daylight(now, seasonalWeather(now)),
      weather: seasonalWeather(now),
      body: freshBody(),
      learning: freshLearning(),
    };
    state.version = 2; // learning.initialize
    for (const [key, value] of Object.entries(options.body ?? {})) {
      if (!(key in state.body) || typeof value !== "number" || !Number.isFinite(value))
        throw new Error(`body.${key} must be one of her body's numbers`);
      state.body[key as keyof Body] = value;
    }
    const mode = options.plasticity ?? "off";
    let plasticity: EvaPlasticity | null = null;
    if (mode !== "off") {
      plasticity = new EvaPlasticity(mode);
      plasticity.bind(state, now);
    }
    const garden = new EvaGarden(state, plasticity, options);
    garden.moment(now, BIRTH_MOMENT);
    garden.advance(now);
    if (options.weather) garden.setWeather(options.weather);
    return garden;
  }

  /**
   * A research garden from its own saved state (and plasticity memory), as
   * her service reopens its database. Refuses an original's id.
   */
  static restore(
    state: EvaState,
    options: GardenOptions & {
      plasticity?: PlasticityMode | "off";
      memory?: PlasticityMemory;
      moments?: { count: number; kept: Moment[] };
      at?: number;
    } = {},
  ): EvaGarden {
    refuseNonResearch(state.life_id);
    const copy = structuredClone(state);
    const mode = options.plasticity ?? "off";
    let plasticity: EvaPlasticity | null = null;
    if (mode !== "off") {
      plasticity = new EvaPlasticity(mode);
      const at = options.at ?? copy.updated_at;
      if (options.memory) {
        refuseNonResearch(options.memory.life_id);
        if (
          options.memory.life_id !== copy.life_id ||
          options.memory.born_at !== copy.born_at
        )
          throw new Error("the plasticity memory belongs to a different life");
        plasticity.adopt(options.memory, copy, at);
      } else plasticity.bind(copy, at);
    }
    const garden = new EvaGarden(copy, plasticity, options, options.moments);
    if (options.at !== undefined) garden.advance(options.at);
    return garden;
  }

  /** `World.effective_weather`: fetched weather younger than six hours, else seasonal. */
  effectiveWeather(now: number): Weather {
    const weather = this.s.weather;
    return (weather.fetched_at ?? 0) > now - 21600 ? weather : seasonalWeather(now);
  }

  /** `World.set_weather`: what her weather loop does after a fetch. */
  setWeather(weather: Weather): void {
    this.s.weather = structuredClone(weather);
  }

  /** `World.advance`: five-second steps, with her bounded catch-up after an outage. */
  advance(now: number): void {
    const s = this.s;
    const remaining = Math.max(0.0, now - s.updated_at);
    const step = Math.max(5.0, Math.ceil(remaining / 3600 / 5) * 5);
    while (now - s.updated_at >= 5) {
      const dt = Math.min(step, now - s.updated_at);
      s.updated_at += dt;
      this.step(s.updated_at, Math.min(dt, 5.0));
      this.onStep?.(this);
    }
  }

  /**
   * `World._step`: one step at time `now` with motor time `dt`. Exactly hers:
   * it does not move `updated_at` (`advance` does), so a direct call is for
   * research that keeps its own clock.
   */
  step(now: number, dt: number): void {
    const s = this.s;
    const seams = { perceive: this.perceive, obstruct: this.obstruct };
    const rng = new PyRandom(`${s.seed}:${s.ticks}`);
    s.ticks += 1;
    const weather = this.effectiveWeather(now);
    const day = daylight(now, weather);
    if (day !== s.was_day) {
      s.was_day = day;
      this.moment(now, day ? MORNING : EVENING);
      s.next_decision = Math.min(s.next_decision, now);
    }
    const activity = s.activity;
    s.energy +=
      dt *
      (activity === "sleeping" || activity === "resting"
        ? 0.07
        : activity === "flying"
          ? -0.055
          : -0.01);
    s.fullness += dt * (activity === "feeding" ? 0.25 : -0.003);
    s.water += dt * (activity === "drinking" ? 0.3 : -0.002);
    s.energy = pyRound(Math.max(10.0, Math.min(100.0, s.energy)), 5);
    s.fullness = pyRound(Math.max(10.0, Math.min(100.0, s.fullness)), 5);
    s.water = pyRound(Math.max(10.0, Math.min(100.0, s.water)), 5);
    const travel = s.travel;
    if (travel) {
      if (now < (travel.paused_until ?? 0)) {
        execute(s, "rest", [0.0, 0.0], now, dt, weather, rng, seams);
        return;
      }
      let motion = chooseMotion(s, weather);
      if (this.plasticity !== null)
        motion = this.plasticity.choose(s, weather, motion) as "fly" | "walk";
      const target = travel.to;
      const delta: Point = [target[0] - s.position[0], target[1] - s.position[1]];
      const distance = pyHypot(delta[0], delta[1]);
      const estimate = model(s, motion, context(s, weather)).gain;
      const effort = Math.min(1.0, distance / Math.max(0.001, estimate * dt));
      const command: Point = [
        (delta[0] / Math.max(distance, 1e-9)) * effort,
        (delta[1] / Math.max(distance, 1e-9)) * effort,
      ];
      const start: Point = [s.position[0], s.position[1]];
      s.distance += execute(s, motion, command, now, dt, weather, rng, seams) * 6;
      this.plasticity?.observe(s, motion, start, target, command, dt);
      s.activity = motion === "fly" ? "flying" : "walking";
      // No arrival by elapsed time: inability to move cannot teleport the fly.
      if (pyDist(s.position, target) < 0.012) {
        s.place = travel.destination;
        s.visits[s.place] = (s.visits[s.place] ?? 0) + 1;
        s.travel = null;
        s.activity =
          s.place === "pear" || s.place === "flowers"
            ? "feeding"
            : s.place === "water"
              ? "drinking"
              : !day
                ? "sleeping"
                : "resting";
        s.next_decision = now + rng.uniform(70, 210);
        this.moment(now, rng.choice(ARRIVALS[s.place]));
      } else if (now - travel.started_at > 600) {
        // Pause at the actual location, recover, and try the route again later.
        travel.paused_until = now + 90;
        travel.started_at = now + 90;
        s.activity = "resting";
        this.moment(now, STALL_MOMENT);
      }
      return;
    }
    // At a perch, brief leg movements provide safe calibration without a viewer.
    if (
      activity !== "sleeping" &&
      activity !== "feeding" &&
      activity !== "drinking" &&
      s.ticks % 6 === 0
    ) {
      const angle = rng.uniform(0, TAU);
      let command: Point = [0.08 * Math.cos(angle), 0.08 * Math.sin(angle)];
      const anchor: Point = [PLACES[s.place].x, PLACES[s.place].y];
      if (pyDist(s.position, anchor) > 0.018)
        command = [(anchor[0] - s.position[0]) * 3, (anchor[1] - s.position[1]) * 3];
      s.distance += execute(s, "walk", command, now, dt, weather, rng, seams) * 6;
    } else
      execute(
        s,
        activity === "grooming" ? "groom" : "rest",
        [0.0, 0.0],
        now,
        dt,
        weather,
        rng,
        seams,
      );
    if (now >= s.next_decision) {
      let destination: PlaceId | null = null;
      const sheltered = PLACES[s.place].sheltered ?? false;
      const rough = weather.rain > 0.2 || weather.wind > 25 || weather.temperature < 7;
      if (s.fullness < 32) destination = rng.choice<PlaceId>(["pear", "flowers"]);
      else if (s.water < 30) destination = "water";
      else if ((!day || rough || s.energy < 28) && !sheltered)
        destination = rng.choice<PlaceId>(["leaf", "window"]);
      else if ((!day || rough) && sheltered)
        s.activity = rng.random() < 0.8 ? "sleeping" : "grooming";
      else if (s.energy < 65 && rng.random() < 0.6) s.activity = "resting";
      else if (rng.random() < 0.64)
        destination = rng.choice(PLACE_IDS.filter((p) => p !== s.place));
      else s.activity = rng.choice<Activity>(["grooming", "resting"]);
      if (destination && destination !== s.place) this.depart(destination, now, rng);
      else if (destination) s.activity = destination === "water" ? "drinking" : "feeding";
      s.next_decision = now + rng.uniform(100, 300);
    }
    if (now >= s.next_moment) {
      let words: string;
      if (s.activity === "sleeping") words = rng.choice(SLEEPING);
      else if (s.activity === "grooming")
        words = "Cleans its forelegs, then its wings. Small, necessary work.";
      else if (s.activity === "feeding")
        words = "Lingers over a little sweetness. There is no hurry.";
      else if (s.activity === "drinking")
        words = "A drop of water is a whole event at this scale.";
      else words = rng.choice(IDLE);
      this.moment(now, words);
      s.next_moment = now + rng.uniform(180, 480);
    }
  }

  /** `World._depart`. */
  private depart(destination: PlaceId, now: number, rng: PyRandom): void {
    const s = this.s;
    const start: Point = [s.position[0], s.position[1]];
    const end: Point = [PLACES[destination].x, PLACES[destination].y];
    const duration = rng.uniform(18, 42); // Display estimate; arrival is physical.
    s.travel = {
      from: start,
      to: end,
      control: [
        (start[0] + end[0]) / 2,
        Math.max(0.12, Math.min(start[1], end[1]) - rng.uniform(0.08, 0.2)),
      ],
      started_at: now,
      ends_at: now + duration,
      destination,
    };
    s.activity = "flying";
    s.journeys += 1;
    this.moment(now, rng.choice(DEPARTURES));
  }

  /** `World._moment`: one row of her moments table. */
  private moment(now: number, text: string): void {
    this.count += 1;
    this.kept.push({ id: this.count, at: now, text });
    if (this.kept.length > this.keep) this.kept.splice(0, this.kept.length - this.keep);
  }

  /** `World.snapshot` (her `/state` payload; see the file comment for what is left out). */
  snapshot(now: number = this.s.updated_at): GardenSnapshot {
    const s = structuredClone(this.s);
    const moments = this.kept
      .slice(-8)
      .reverse()
      .map((m) => ({ ...m }));
    const full = structuredClone(this.effectiveWeather(now));
    const isDay = daylight(now, full);
    const { fetched_at: _fetched, sun: _sun, ...weather } = full;
    const payload: GardenSnapshot = {
      life_id: s.life_id,
      born_at: s.born_at,
      updated_at: s.updated_at,
      ticks: s.ticks,
      place: s.place,
      place_name: PLACES[s.place].name,
      position: s.position,
      activity: s.activity,
      travel: s.travel,
      journeys: s.journeys,
      distance: pyRound(s.distance, 2),
      places_visited: Object.keys(s.visits).length,
      moments_count: this.count,
      moments,
      weather: { ...weather, description: weatherName(full.code), is_day: isDay },
      learning: summary(s, full, this.perceive),
      needs: {
        energy: pyRoundInt(s.energy),
        fullness: pyRoundInt(s.fullness),
        water: pyRoundInt(s.water),
      },
    };
    if (this.plasticity !== null) payload.adaptive = this.plasticity.status();
    return payload;
  }

  /** Her whole state, deep-copied. */
  state(): EvaState {
    return structuredClone(this.s);
  }

  /** The plasticity extension's memory (her sidecar), deep-copied; null when off or faulted. */
  plasticityMemory(): PlasticityMemory | null {
    return this.plasticity?.state ? structuredClone(this.plasticity.state) : null;
  }

  get lifeId(): string {
    return this.s.life_id;
  }
  get ticks(): number {
    return this.s.ticks;
  }
  get updatedAt(): number {
    return this.s.updated_at;
  }
  get position(): Point {
    return [this.s.position[0], this.s.position[1]];
  }
  get place(): PlaceId {
    return this.s.place;
  }
  get activity(): Activity {
    return this.s.activity;
  }
  get travel(): Travel | null {
    return structuredClone(this.s.travel);
  }
  get needs(): Needs {
    return { energy: this.s.energy, fullness: this.s.fullness, water: this.s.water };
  }
  get momentsCount(): number {
    return this.count;
  }
  /** The latest `n` moments kept, oldest first. */
  moments(n = this.keep): Moment[] {
    return this.kept.slice(-n).map((m) => ({ ...m }));
  }
}

export interface BirthOptions extends GardenOptions {
  /** Her per-life seed string (`f"{seed}:{ticks}"` seeds each step). Never `uuid4` here. */
  seed: string;
  /** Unix seconds. */
  bornAt: number;
  /** Must start with `research-` and name no original. */
  lifeId: string;
  /** Unset is off: her original service. */
  plasticity?: PlasticityMode | "off";
  /**
   * Applied with `setWeather` right after birth, as her weather loop would.
   * Her birth itself (place, `was_day`) always uses seasonal weather, as hers does.
   */
  weather?: Weather;
  /** A research impairment applied after birth (as `study.py` does), e.g. `{ wing_integrity: 0.35 }`. */
  body?: Partial<Body>;
}

/** A new research garden, as `World.__init__` begins a life. */
export function birth(options: BirthOptions): EvaGarden {
  return EvaGarden.born(options);
}
