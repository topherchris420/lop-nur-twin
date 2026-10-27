/**
 * What anyone may see of the one living Bethesda life (criterion 6 of
 * docs/BETHESDA_CONTINUOUS_LIFE.md).
 *
 * - An **observation** is a small plain record of the life that the runner
 *   writes beside it about once a second, never into its checkpoints
 *   (`HeadlessBethesdaLife.observation`). Making one only reads the life.
 * - A **witness** is what the observer serves (`observer.ts`): the newest
 *   valid observation with its status, live, stale or unavailable. A viewer
 *   may interpolate between observations for presentation only. It never
 *   ticks or steps a world of its own, and when the life is stale or
 *   unavailable it says so instead of showing a fly that is not this one.
 *
 * Kept free of the simulation's imports, so a browser can parse a witness
 * without loading the city or the fly.
 */

export const OBSERVATION_SCHEMA = "bethesda-life-observation/v1" as const;
export const WITNESS_SCHEMA = "bethesda-life-witness/v1" as const;

/** Pedestrians and vehicles within this distance of the fly (m) are observed with it. */
export const NEARBY_M = 40;
/** At most this many of them, nearest first. */
export const NEARBY_MAX = 24;
/** The fly's most recent decisions, with their reasons, newest last. */
export const RECENT_DECISIONS = 6;
/** A decision's reason is cut to this many characters. */
export const REASON_MAX = 240;
/** An observation older than this (s) is stale: the life has stopped writing. */
export const STALE_AFTER_S = 5;
/**
 * While the life makes and verifies a checkpoint its clock waits (about a
 * minute for a full-grown one on a slow core), so an observation that says
 * so is stale only after this long (s).
 */
export const CHECKPOINTING_STALE_AFTER_S = 180;

export interface ObservedDecision {
  /** The fly's own clock (s). */
  t: number;
  from: string;
  to: string;
  reason: string;
  kind: "decision" | "event" | "refused";
}

export interface LifeObservation {
  schema: typeof OBSERVATION_SCHEMA;
  /** The individual's id from its birth (64 hex digits). */
  individual: string;
  /** The lease epoch of the process living it: one more after every start. */
  epoch: number;
  versions: { headless: string; city: string; fly: string; echo: string };
  flyController: "reduced-order" | "echo";
  tick: number;
  simulatedSeconds: number;
  /** When the runner wrote this observation (UTC). */
  observedUtc: string;
  /** The newest committed checkpoint: where a restart would resume. */
  checkpoint: { sequence: number; tick: number; committedUtc: string };
  /** The life is making the next checkpoint, and its clock waits until it is committed. */
  checkpointing: boolean;
  fly: {
    /** City metres: x east, y up, z south (`model.ts`). */
    position: [number, number, number];
    velocity: [number, number, number];
    yaw: number;
    mode: string;
    energyFraction: number;
    meals: number;
    escapes: number;
    recent: ObservedDecision[];
  };
  /** Pedestrians and vehicles near the fly, nearest first. */
  nearby: { kind: string; x: number; z: number }[];
  /**
   * With the ECHO controller: a summary of what its self-model holds now.
   * Self-models before `echo-self-model/v3` write no attention, conclusion
   * or inquiry.
   */
  selfModel: {
    echoVersion: string;
    inquiries: number;
    episodes: number;
    legGain: number;
    trustInSense: number;
    /** What holds its workspace (echo/workspace.ts), since when (simulated s), and whether it shields it; null when nothing does. */
    attending?: {
      source: string;
      what: string;
      since: number;
      shielded: boolean;
      expectsNext: string | null;
    } | null;
    /** Its latest conclusion, how sure it said it was, and what a second look made of it. */
    lastConclusion?: {
      t: number;
      explanation: string;
      candidate: string;
      confidence: number;
      resolved: boolean;
      checked: "confirmed" | "revised" | null;
    } | null;
    /** An inquiry open now: since when, its leading explanation and that explanation's probability. */
    openInquiry?: {
      since: number;
      leading: string;
      p: number;
      secondLook: boolean;
    } | null;
  } | null;
  /**
   * The city's wind (fly/weather.ts) at 10 m and where the fly is. Lives
   * from before the wind (fly versions before `digital-fly/8`) write none.
   */
  weather?: ObservedWeather;
}

export interface ObservedWeather {
  regime: "calm" | "breezy" | "windy" | "storm";
  /** Speed at 10 m (m/s), the gust included. */
  speedMS: number;
  /** The compass bearing it comes from (degrees clockwise from north, [0, 360)). */
  fromDeg: number;
  gusting: boolean;
  /** Its speed where the fly is (m/s): weaker near the ground and in shelter. */
  atFlyMS: number;
}

const REGIMES: readonly string[] = ["calm", "breezy", "windy", "storm"];

export type WitnessStatus = "live" | "stale" | "unavailable";

export interface Witness {
  schema: typeof WITNESS_SCHEMA;
  status: WitnessStatus;
  /** When the observer made this witness (UTC). */
  servedUtc: string;
  /** Seconds since the observation was written; null when there is none. */
  ageS: number | null;
  /** Why it is stale or unavailable; null when live. */
  reason: string | null;
  /** The newest valid observation: null only when unavailable. */
  observation: LifeObservation | null;
}

type Obj = Record<string, unknown>;

class Invalid extends Error {}
const fail = (path: string, what: string): never => {
  throw new Invalid(`${path}: ${what}`);
};

function object(
  v: unknown,
  path: string,
  keys: readonly string[],
  optional: readonly string[] = [],
): Obj {
  if (typeof v !== "object" || v === null || Array.isArray(v))
    fail(path, "not an object");
  const o = v as Obj;
  const extra = Object.keys(o).filter((k) => !keys.includes(k) && !optional.includes(k));
  if (extra.length) fail(path, `unexpected ${extra.join(", ")}`);
  for (const k of keys) if (!(k in o)) fail(path, `missing ${k}`);
  return o;
}

function num(v: unknown, path: string, min = -Infinity, max = Infinity): number {
  if (typeof v !== "number" || !Number.isFinite(v)) fail(path, "not a finite number");
  if ((v as number) < min || (v as number) > max) fail(path, `outside [${min}, ${max}]`);
  return v as number;
}

function int(v: unknown, path: string, min = 0): number {
  const n = num(v, path, min);
  if (!Number.isSafeInteger(n)) fail(path, "not an integer");
  return n;
}

function str(v: unknown, path: string, max = 120, pattern?: RegExp): string {
  if (typeof v !== "string") fail(path, "not a string");
  const s = v as string;
  if (s.length > max) fail(path, `longer than ${max}`);
  if (pattern && !pattern.test(s)) fail(path, "malformed");
  return s;
}

function utc(v: unknown, path: string): string {
  const s = str(v, path, 40, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
  if (!Number.isFinite(Date.parse(s))) fail(path, "not a date");
  return s;
}

function v3(v: unknown, path: string): [number, number, number] {
  if (!Array.isArray(v) || v.length !== 3) fail(path, "not three numbers");
  const a = v as unknown[];
  return [num(a[0], `${path}[0]`), num(a[1], `${path}[1]`), num(a[2], `${path}[2]`)];
}

function list<T>(
  v: unknown,
  path: string,
  max: number,
  each: (x: unknown, p: string) => T,
) {
  if (!Array.isArray(v)) fail(path, "not a list");
  const a = v as unknown[];
  if (a.length > max) fail(path, `more than ${max}`);
  return a.map((x, i) => each(x, `${path}[${i}]`));
}

const WORD = /^[a-z][a-z0-9/_-]*$/;

/** A validated observation, or a thrown error that says what is wrong with it. */
export function parseObservation(value: unknown): LifeObservation {
  const o = object(
    value,
    "observation",
    [
      "schema",
      "individual",
      "epoch",
      "versions",
      "flyController",
      "tick",
      "simulatedSeconds",
      "observedUtc",
      "checkpoint",
      "checkpointing",
      "fly",
      "nearby",
      "selfModel",
    ],
    ["weather"],
  );
  if (o.schema !== OBSERVATION_SCHEMA)
    fail("observation.schema", `not ${OBSERVATION_SCHEMA}`);
  const versions = object(o.versions, "versions", ["headless", "city", "fly", "echo"]);
  const checkpoint = object(o.checkpoint, "checkpoint", [
    "sequence",
    "tick",
    "committedUtc",
  ]);
  const fly = object(o.fly, "fly", [
    "position",
    "velocity",
    "yaw",
    "mode",
    "energyFraction",
    "meals",
    "escapes",
    "recent",
  ]);
  if (typeof o.checkpointing !== "boolean") fail("checkpointing", "not true or false");
  if (o.flyController !== "reduced-order" && o.flyController !== "echo")
    fail("flyController", "neither reduced-order nor echo");
  const tick = int(o.tick, "tick");
  const at = int(checkpoint.tick, "checkpoint.tick");
  if (at > tick) fail("checkpoint.tick", "later than the observation");
  let selfModel: LifeObservation["selfModel"] = null;
  if (o.selfModel !== null) {
    const m = object(
      o.selfModel,
      "selfModel",
      ["echoVersion", "inquiries", "episodes", "legGain", "trustInSense"],
      ["attending", "lastConclusion", "openInquiry"],
    );
    selfModel = {
      echoVersion: str(m.echoVersion, "selfModel.echoVersion"),
      inquiries: int(m.inquiries, "selfModel.inquiries"),
      episodes: int(m.episodes, "selfModel.episodes"),
      legGain: num(m.legGain, "selfModel.legGain"),
      trustInSense: num(m.trustInSense, "selfModel.trustInSense", 0),
    };
    const nullable = <T>(v: unknown, read: (v: unknown) => T): T | null =>
      v === null ? null : read(v);
    if (m.attending !== undefined)
      selfModel.attending = nullable(m.attending, (v) => {
        const a = object(v, "selfModel.attending", [
          "source",
          "what",
          "since",
          "shielded",
          "expectsNext",
        ]);
        if (typeof a.shielded !== "boolean")
          fail("selfModel.attending.shielded", "not true or false");
        return {
          source: str(a.source, "selfModel.attending.source", 24, WORD),
          what: str(a.what, "selfModel.attending.what", 60),
          since: num(a.since, "selfModel.attending.since", 0),
          shielded: a.shielded as boolean,
          expectsNext: nullable(a.expectsNext, (s) =>
            str(s, "selfModel.attending.expectsNext", 24, WORD),
          ),
        };
      });
    if (m.lastConclusion !== undefined)
      selfModel.lastConclusion = nullable(m.lastConclusion, (v) => {
        const c = object(v, "selfModel.lastConclusion", [
          "t",
          "explanation",
          "candidate",
          "confidence",
          "resolved",
          "checked",
        ]);
        if (typeof c.resolved !== "boolean")
          fail("selfModel.lastConclusion.resolved", "not true or false");
        if (c.checked !== null && c.checked !== "confirmed" && c.checked !== "revised")
          fail("selfModel.lastConclusion.checked", "neither confirmed, revised nor null");
        return {
          t: num(c.t, "selfModel.lastConclusion.t", 0),
          explanation: str(
            c.explanation,
            "selfModel.lastConclusion.explanation",
            24,
            WORD,
          ),
          candidate: str(c.candidate, "selfModel.lastConclusion.candidate", 60),
          confidence: num(c.confidence, "selfModel.lastConclusion.confidence", 0, 1),
          resolved: c.resolved as boolean,
          checked: c.checked as "confirmed" | "revised" | null,
        };
      });
    if (m.openInquiry !== undefined)
      selfModel.openInquiry = nullable(m.openInquiry, (v) => {
        const q = object(v, "selfModel.openInquiry", [
          "since",
          "leading",
          "p",
          "secondLook",
        ]);
        if (typeof q.secondLook !== "boolean")
          fail("selfModel.openInquiry.secondLook", "not true or false");
        return {
          since: num(q.since, "selfModel.openInquiry.since", 0),
          leading: str(q.leading, "selfModel.openInquiry.leading", 60),
          p: num(q.p, "selfModel.openInquiry.p", 0, 1),
          secondLook: q.secondLook as boolean,
        };
      });
  }
  if ((o.flyController === "echo") !== (selfModel !== null))
    fail("selfModel", "present exactly when the controller is echo");
  let weather: ObservedWeather | undefined;
  if (o.weather !== undefined) {
    const w = object(o.weather, "weather", [
      "regime",
      "speedMS",
      "fromDeg",
      "gusting",
      "atFlyMS",
    ]);
    if (typeof w.regime !== "string" || !REGIMES.includes(w.regime))
      fail("weather.regime", "not calm, breezy, windy or storm");
    if (typeof w.gusting !== "boolean") fail("weather.gusting", "not true or false");
    const fromDeg = num(w.fromDeg, "weather.fromDeg", 0, 360);
    if (fromDeg === 360) fail("weather.fromDeg", "outside [0, 360)");
    weather = {
      regime: w.regime as ObservedWeather["regime"],
      speedMS: num(w.speedMS, "weather.speedMS", 0, 100),
      fromDeg,
      gusting: w.gusting as boolean,
      atFlyMS: num(w.atFlyMS, "weather.atFlyMS", 0, 100),
    };
  }
  return {
    schema: OBSERVATION_SCHEMA,
    individual: str(o.individual, "individual", 64, /^[0-9a-f]{64}$/),
    epoch: int(o.epoch, "epoch", 1),
    versions: {
      headless: str(versions.headless, "versions.headless"),
      city: str(versions.city, "versions.city"),
      fly: str(versions.fly, "versions.fly"),
      echo: str(versions.echo, "versions.echo"),
    },
    flyController: o.flyController as LifeObservation["flyController"],
    tick,
    simulatedSeconds: num(o.simulatedSeconds, "simulatedSeconds", 0),
    observedUtc: utc(o.observedUtc, "observedUtc"),
    checkpoint: {
      sequence: int(checkpoint.sequence, "checkpoint.sequence"),
      tick: at,
      committedUtc: utc(checkpoint.committedUtc, "checkpoint.committedUtc"),
    },
    checkpointing: o.checkpointing as boolean,
    fly: {
      position: v3(fly.position, "fly.position"),
      velocity: v3(fly.velocity, "fly.velocity"),
      yaw: num(fly.yaw, "fly.yaw"),
      mode: str(fly.mode, "fly.mode", 40, WORD),
      energyFraction: num(fly.energyFraction, "fly.energyFraction", 0, 2),
      meals: int(fly.meals, "fly.meals"),
      escapes: int(fly.escapes, "fly.escapes"),
      recent: list(fly.recent, "fly.recent", RECENT_DECISIONS, (x, p) => {
        const d = object(x, p, ["t", "from", "to", "reason", "kind"]);
        if (d.kind !== "decision" && d.kind !== "event" && d.kind !== "refused")
          fail(`${p}.kind`, "not decision, event or refused");
        return {
          t: num(d.t, `${p}.t`, 0),
          from: str(d.from, `${p}.from`, 60),
          to: str(d.to, `${p}.to`, 60),
          reason: str(d.reason, `${p}.reason`, REASON_MAX),
          kind: d.kind as ObservedDecision["kind"],
        };
      }),
    },
    nearby: list(o.nearby, "nearby", NEARBY_MAX, (x, p) => {
      const a = object(x, p, ["kind", "x", "z"]);
      return {
        kind: str(a.kind, `${p}.kind`, 20, WORD),
        x: num(a.x, `${p}.x`),
        z: num(a.z, `${p}.z`),
      };
    }),
    selfModel,
    ...(weather ? { weather } : {}),
  };
}

/** A validated witness, or a thrown error that says what is wrong with it. */
export function parseWitness(value: unknown): Witness {
  const w = object(value, "witness", [
    "schema",
    "status",
    "servedUtc",
    "ageS",
    "reason",
    "observation",
  ]);
  if (w.schema !== WITNESS_SCHEMA) fail("witness.schema", `not ${WITNESS_SCHEMA}`);
  if (w.status !== "live" && w.status !== "stale" && w.status !== "unavailable")
    fail("witness.status", "not live, stale or unavailable");
  const status = w.status as WitnessStatus;
  const observation = w.observation === null ? null : parseObservation(w.observation);
  if ((status === "unavailable") !== (observation === null))
    fail("witness.observation", "null exactly when unavailable");
  const reason = w.reason === null ? null : str(w.reason, "witness.reason", 300);
  if ((status === "live") !== (reason === null))
    fail("witness.reason", "null exactly when live");
  return {
    schema: WITNESS_SCHEMA,
    status,
    servedUtc: utc(w.servedUtc, "witness.servedUtc"),
    ageS: w.ageS === null ? null : num(w.ageS, "witness.ageS"),
    reason,
    observation,
  };
}

/**
 * The witness of an observation (or of none) at `now`: live while it is
 * fresher than `STALE_AFTER_S` (`CHECKPOINTING_STALE_AFTER_S` while the life
 * makes a checkpoint), stale after, unavailable without one.
 */
export function witness(
  observation: LifeObservation | null,
  now: number,
  unavailable = "the life is not running: there is no observation",
): Witness {
  const servedUtc = new Date(now).toISOString();
  if (!observation)
    return {
      schema: WITNESS_SCHEMA,
      status: "unavailable",
      servedUtc,
      ageS: null,
      reason: unavailable,
      observation: null,
    };
  const ageS = Math.max(0, (now - Date.parse(observation.observedUtc)) / 1000);
  const stale =
    ageS > (observation.checkpointing ? CHECKPOINTING_STALE_AFTER_S : STALE_AFTER_S);
  return {
    schema: WITNESS_SCHEMA,
    status: stale ? "stale" : "live",
    servedUtc,
    ageS: Math.round(ageS * 10) / 10,
    reason: stale ? `no new observation for ${Math.round(ageS)} s` : null,
    observation,
  };
}
