/**
 * The live garden's observation contract: what `GET /api/state` returns, checked.
 *
 * The garden's authoritative simulation is a separate Python service
 * (`server.py`/`learning.py` on the garden's VM, documented in
 * docs/LIVE_GARDEN.md). It advances every five seconds whether or not anyone
 * is watching; this browser code only reads it. `parseObservation` is the one
 * place that decides what a response means: anything malformed is refused
 * rather than drawn, and every optional field the server may omit stays
 * `null` here instead of being guessed. Nothing in this module writes or
 * requests anything.
 */

/** The server's seven places (`PLACES` in server.py), in its own order. */
export const PLACE_IDS = [
  "leaf",
  "window",
  "flowers",
  "pear",
  "water",
  "fence",
  "stone",
] as const;
export type PlaceId = (typeof PLACE_IDS)[number];

/** Activities `server.py` sets. Anything else is kept as text and drawn as a rest. */
export const ACTIVITIES = [
  "sleeping",
  "resting",
  "grooming",
  "feeding",
  "drinking",
  "flying",
  "walking",
] as const;
export type Activity = (typeof ACTIVITIES)[number];

/** The action `learning.execute` ran in the step that produced a state. */
export const ACTIONS = ["fly", "walk", "rest", "groom"] as const;
export type Action = (typeof ACTIONS)[number];

export type Vec2 = [number, number];

export interface Travel {
  /** Garden fractions: where this journey began and where it is going. */
  from: Vec2;
  to: Vec2;
  destination: PlaceId;
  /** Server time this leg began; a pause moves it to when flying resumes. */
  startedAt: number;
  /** The server's display estimate of arrival, not a schedule (arrival is physical). */
  endsAt: number | null;
  /** While set and in the future, the journey is paused to recover. */
  pausedUntil: number | null;
}

export interface Moment {
  id: number;
  at: number;
  text: string;
}

export interface Weather {
  temperatureC: number;
  description: string;
  isDay: boolean;
  /** WMO weather code, null when the server omits it. */
  code: number | null;
  /** km/h at 10 m (Open-Meteo), null when omitted. */
  windKmh: number | null;
  /** mm of precipitation, null when omitted. */
  rainMm: number | null;
  /** "Open-Meteo", or "seasonal" for the server's labelled estimate. */
  source: string | null;
  /** Sunrise and sunset per Bethesda calendar date, unix seconds. */
  sun: Record<string, Vec2>;
}

export interface Capability {
  samples: number;
  estimatedSpeed: number;
  successRate: number;
}

export interface NearbyObject {
  name: string;
  position: Vec2;
  independent: boolean;
  samples: number | null;
  externalMotion: number | null;
}

export interface LastTrial {
  at: number;
  action: Action;
  success: boolean | null;
  predictionError: number | null;
}

export interface Learning {
  trials: number;
  condition: string | null;
  fly: Capability | null;
  walk: Capability | null;
  predictionError: number | null;
  surprises: number | null;
  last: LastTrial | null;
  wingIntegrity: number | null;
  legIntegrity: number | null;
  wetness: number | null;
  nearby: NearbyObject[];
}

export interface Needs {
  energy: number;
  fullness: number;
  water: number;
}

export interface Observation {
  lifeId: string;
  bornAt: number;
  /** The server's clock when it answered, unix seconds. */
  serverTime: number;
  /** The simulated instant this state describes: bornAt plus whole five-second steps. */
  updatedAt: number;
  ticks: number;
  /** The place it is at, or departed from while travelling. */
  place: PlaceId | null;
  placeRaw: string;
  placeName: string;
  /** Garden fractions in the server's abstract 2D garden (x right, y down). */
  position: Vec2;
  /** One of ACTIVITIES, or whatever newer text the server sent. */
  activity: string;
  travel: Travel | null;
  journeys: number;
  distance: number | null;
  placesVisited: number;
  momentsCount: number | null;
  /** Newest first, as the server sends them. */
  moments: Moment[];
  weather: Weather;
  learning: Learning | null;
  needs: Needs | null;
}

export class ObservationError extends Error {}

type Raw = Record<string, unknown>;

const isObject = (v: unknown): v is Raw =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function need<T>(ok: boolean, value: T, what: string): T {
  if (!ok) throw new ObservationError(`observation: ${what}`);
  return value;
}
function number(raw: Raw, key: string): number {
  const v = raw[key];
  return need(finite(v), v as number, `${key} is not a finite number`);
}
function optionalNumber(raw: Raw, key: string): number | null {
  const v = raw[key];
  if (v === undefined || v === null) return null;
  return need(finite(v), v as number, `${key} is not a finite number`);
}
function text(raw: Raw, key: string, max = 2000): string {
  const v = raw[key];
  return need(
    typeof v === "string" && v.length <= max,
    v as string,
    `${key} is not text`,
  );
}
function vec2(v: unknown, what: string, bound = 10): Vec2 {
  return need(
    Array.isArray(v) &&
      v.length === 2 &&
      v.every((x) => finite(x) && Math.abs(x) <= bound),
    v as Vec2,
    `${what} is not a 2D point`,
  ).slice() as Vec2;
}
function fraction(v: unknown): number | null {
  return finite(v) && v >= 0 && v <= 1 ? v : null;
}

export const isPlaceId = (v: unknown): v is PlaceId =>
  typeof v === "string" && (PLACE_IDS as readonly string[]).includes(v);
export const isActivity = (v: unknown): v is Activity =>
  typeof v === "string" && (ACTIVITIES as readonly string[]).includes(v);

function parseTravel(v: unknown): Travel | null {
  if (v === null || v === undefined) return null;
  const t = need(isObject(v), v as Raw, "travel is not an object");
  const destination = t.destination;
  return {
    from: vec2(t.from, "travel.from"),
    to: vec2(t.to, "travel.to"),
    destination: need(
      isPlaceId(destination),
      destination as PlaceId,
      "travel.destination",
    ),
    startedAt: number(t, "started_at"),
    endsAt: optionalNumber(t, "ends_at"),
    pausedUntil: optionalNumber(t, "paused_until"),
  };
}

function parseWeather(v: unknown): Weather {
  const w = need(isObject(v), v as Raw, "weather is not an object");
  const isDay = w.is_day;
  const sun: Record<string, Vec2> = {};
  if (isObject(w.sun))
    for (const [day, span] of Object.entries(w.sun))
      if (/^\d{4}-\d{2}-\d{2}$/.test(day) && Array.isArray(span) && span.length === 2) {
        const [rise, set] = span;
        if (finite(rise) && finite(set) && rise < set) sun[day] = [rise, set];
      }
  return {
    temperatureC: number(w, "temperature"),
    description: text(w, "description", 200),
    isDay: need(typeof isDay === "boolean", isDay as boolean, "weather.is_day"),
    code: optionalNumber(w, "code"),
    windKmh: optionalNumber(w, "wind"),
    rainMm: optionalNumber(w, "rain"),
    source: typeof w.source === "string" ? w.source.slice(0, 80) : null,
    sun,
  };
}

function parseCapability(v: unknown): Capability | null {
  if (!isObject(v)) return null;
  const samples = v.samples,
    speed = v.estimated_speed,
    rate = v.success_rate;
  if (!finite(samples) || !finite(speed) || !finite(rate)) return null;
  return { samples, estimatedSpeed: speed, successRate: rate };
}

function parseLearning(v: unknown): Learning | null {
  if (!isObject(v) || !finite(v.trials)) return null;
  const caps = isObject(v.capabilities) ? v.capabilities : {};
  const body = isObject(v.body) ? v.body : {};
  const last = isObject(v.last) ? v.last : null;
  const action = last?.action;
  const nearby: NearbyObject[] = [];
  if (Array.isArray(v.nearby))
    for (const o of v.nearby) {
      if (!isObject(o) || typeof o.name !== "string" || o.name.length > 80) continue;
      if (
        !Array.isArray(o.position) ||
        o.position.length !== 2 ||
        !o.position.every(finite)
      )
        continue;
      nearby.push({
        name: o.name,
        position: [o.position[0] as number, o.position[1] as number],
        independent: o.independent === true,
        samples: finite(o.samples) ? o.samples : null,
        externalMotion: finite(o.external_motion) ? o.external_motion : null,
      });
    }
  return {
    trials: v.trials,
    condition: typeof v.condition === "string" ? v.condition.slice(0, 80) : null,
    fly: parseCapability(caps.fly),
    walk: parseCapability(caps.walk),
    predictionError: finite(v.prediction_error) ? v.prediction_error : null,
    surprises: finite(v.surprises) ? v.surprises : null,
    last:
      last && finite(last.at) && (ACTIONS as readonly string[]).includes(action as string)
        ? {
            at: last.at,
            action: action as Action,
            success: typeof last.success === "boolean" ? last.success : null,
            predictionError: finite(last.prediction_error) ? last.prediction_error : null,
          }
        : null,
    wingIntegrity: fraction(body.wing_integrity),
    legIntegrity: fraction(body.leg_integrity),
    wetness: fraction(body.wetness),
    nearby,
  };
}

function parseNeeds(v: unknown): Needs | null {
  if (!isObject(v)) return null;
  const { energy, fullness, water } = v;
  return finite(energy) && finite(fullness) && finite(water)
    ? { energy, fullness, water }
    : null;
}

/**
 * Checks one `/api/state` body. Throws `ObservationError` for anything the
 * garden could not draw honestly; returns plain data with no references to
 * the parsed JSON.
 */
export function parseObservation(raw: unknown): Observation {
  const s = need(isObject(raw), raw as Raw, "not an object");
  const lifeId = text(s, "life_id", 120);
  need(lifeId.length > 0, 0, "life_id is empty");
  const ticks = number(s, "ticks");
  need(Number.isInteger(ticks) && ticks >= 0, 0, "ticks is not a count");
  const bornAt = number(s, "born_at");
  const updatedAt = number(s, "updated_at");
  need(updatedAt >= bornAt, 0, "updated_at precedes born_at");
  const placeRaw = text(s, "place", 80);
  const moments: Moment[] = need(
    Array.isArray(s.moments),
    s.moments as unknown[],
    "moments",
  )
    .slice(0, 40)
    .map((m) => {
      const r = need(isObject(m), m as Raw, "a moment is not an object");
      const id = r.id;
      need(finite(id) || typeof id === "string", 0, "moment id");
      return {
        id: typeof id === "number" ? id : Number(id),
        at: number(r, "at"),
        text: text(r, "text", 500),
      };
    })
    .filter((m) => Number.isFinite(m.id));
  return {
    lifeId,
    bornAt,
    serverTime: number(s, "server_time"),
    updatedAt,
    ticks,
    place: isPlaceId(placeRaw) ? placeRaw : null,
    placeRaw,
    placeName: text(s, "place_name", 200),
    position: vec2(s.position, "position"),
    activity: text(s, "activity", 80),
    travel: parseTravel(s.travel),
    journeys: number(s, "journeys"),
    distance: optionalNumber(s, "distance"),
    placesVisited: number(s, "places_visited"),
    momentsCount: optionalNumber(s, "moments_count"),
    moments,
    weather: parseWeather(s.weather),
    learning: parseLearning(s.learning),
    needs: parseNeeds(s.needs),
  };
}

/** True when two observations describe the same individual. */
export const sameLife = (a: Observation, b: Observation) =>
  a.lifeId === b.lifeId && a.bornAt === b.bornAt;
