/**
 * Exploratory: an Eva-kind and an ECHO-kind research subject living in Eva's
 * garden at true scale, for as long as asked, with a record of what each did
 * and of every contact, perception and collision between them.
 *
 * Not a confirmatory study (no hypothesis, no held-out seeds): a place for
 * the two kinds to meet, with nothing arranged to make them meet. Both are
 * placed, then left alone. The Eva-kind runs her service's code with her
 * plasticity in active mode, as Eva does; the ECHO-kind is the deployed
 * ECHO's kind (plasticity organism, active) with the social brain.
 */
import { DigitalFly } from "../../fly/fly.js";
import { LAYOUT, groundHeight } from "../../../garden/core/layout.js";
import type { V3 } from "../../fly/units.js";
import { Commons } from "./commons.js";
import { EvaOccupant, PERCEIVED_KEY } from "./evaOccupant.js";
import { individualChemistry } from "./familiarity.js";
import { gardenCommonsWorld } from "./garden.js";
import { FlyOccupant } from "./occupants.js";
import { SocialBrain, SocialOrganismAdapter } from "./social.js";

export const GARDEN_ENCOUNTER_SCHEMA = "first-contact-garden-encounter/v1" as const;
const CHEMISTRY = {
  speciesProfile: [0.4, 0.3, 0.2, 0.1] as [number, number, number, number],
  individualSigma: 0.3,
};

export interface GardenEncounterOptions {
  pair: number;
  hours: number;
  /** Eva-kind's birth (unix s). Default 2026-11-11 10:00 in New York. */
  bornAt?: number;
  /** Seconds between recorded frames far apart, and near (within `nearM`). */
  frameS?: number;
  nearFrameS?: number;
  nearM?: number;
}

/** [t, x, y, z, yaw, state] */
export type Frame = [number, number, number, number, number, string];

export interface GardenEncounterRecord {
  schema: typeof GARDEN_ENCOUNTER_SCHEMA;
  pair: number;
  ids: { eva: string; echo: string };
  seeds: { eva: string; echo: number };
  bornAt: number;
  hours: number;
  start: { echo: { p: V3; yaw: number } };
  contacts: { start: number; end: number | null; closestMm: number }[];
  echoOnsets: {
    t: number;
    mode: string | null;
    novelty: number | null;
    walkedAway: boolean | null;
    alerted: boolean | null;
  }[];
  eva: {
    stops: number;
    mismatches: number;
    perceivedSteps: number;
    overlapSteps: number;
    track: { samples: number; external_motion: number } | null;
    independent: boolean;
    journeys: number;
    visits: Record<string, number>;
    moments: { at: number; text: string }[];
  };
  echo: { reserveAtEnd: number; meals: number; flights: number; escapes: number };
  closestMm: number;
  frames: { eva: Frame[]; echo: Frame[] };
}

export function runGardenEncounter(o: GardenEncounterOptions): GardenEncounterRecord {
  const bornAt = o.bornAt ?? Date.UTC(2026, 10, 11, 15, 0, 0) / 1000;
  const frameS = o.frameS ?? 1,
    nearFrameS = o.nearFrameS ?? 0.05,
    nearM = o.nearM ?? 0.15;
  const ids = {
    eva: `research-eva-kind-garden-${o.pair}`,
    echo: `research-echo-kind-garden-${o.pair}`,
  };
  const seeds = { eva: `garden-commons-eva-${o.pair}`, echo: 910000 + o.pair };
  const commons = new Commons(gardenCommonsWorld());
  const eva = new EvaOccupant({
    lifeId: ids.eva,
    seed: seeds.eva,
    bornAt,
    plasticity: "active",
    chemistry: individualChemistry(900000 + o.pair, CHEMISTRY),
    commons,
    index: 0,
  });
  commons.join(0, eva);
  // On the lawn a short walk from the asters, facing a direction from the seed.
  const a = LAYOUT.heroAster.center;
  const ang = (o.pair * 2.399963) % (2 * Math.PI);
  const sx = a[0] + 0.15 * Math.cos(ang),
    sz = a[2] + 0.15 * Math.sin(ang);
  const start = { p: [sx, groundHeight(sx, sz) + 0.01, sz] as V3, yaw: ang + Math.PI };
  const brain = new SocialBrain(seeds.echo);
  const echo = new DigitalFly({
    seed: seeds.echo,
    world: commons.view(1),
    start,
    config: { startReserve: 0.6 },
    adapter: (rng, streams) =>
      new SocialOrganismAdapter(rng, streams, seeds.echo, "active", brain),
  });
  commons.join(
    1,
    new FlyOccupant({
      id: ids.echo,
      fly: echo,
      chemistry: individualChemistry(seeds.echo, CHEMISTRY),
      port: brain,
    }),
  );
  const frames = { eva: [] as Frame[], echo: [] as Frame[] };
  const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
  let lastFrame = -Infinity,
    closest = Infinity,
    meals = 0,
    flights = 0,
    escapes = 0,
    lastMode = echo.state.mode;
  const steps = Math.round((o.hours * 3600) / commons.stepS);
  for (let k = 0; k < steps; k++) {
    commons.step();
    const t = commons.t;
    const e = eva.pose(),
      f = echo.state;
    const d = Math.hypot(
      e.center[0] - f.p[0],
      e.center[1] - f.p[1],
      e.center[2] - f.p[2],
    );
    closest = Math.min(closest, d);
    if (f.mode !== lastMode) {
      if (f.mode === "feed") meals++;
      if (f.mode === "takeoff") flights++;
      if (f.mode === "escape") escapes++;
      lastMode = f.mode;
    }
    if (t - lastFrame >= (d < nearM ? nearFrameS : frameS) - 1e-9) {
      lastFrame = t;
      const s = eva.garden.state();
      frames.eva.push([
        r4(t),
        r4(e.center[0]),
        r4(e.center[1]),
        r4(e.center[2]),
        r4(e.yaw),
        `${s.activity}@${s.travel ? s.travel.destination : s.place}`,
      ]);
      frames.echo.push([r4(t), r4(f.p[0]), r4(f.p[1]), r4(f.p[2]), r4(f.yaw), f.mode]);
    }
  }
  const s = eva.garden.state();
  const track = eva.trackOfOther();
  const bornMoments = eva.garden.moments(1000).filter((m) => m.at >= bornAt);
  return {
    schema: GARDEN_ENCOUNTER_SCHEMA,
    pair: o.pair,
    ids,
    seeds,
    bornAt,
    hours: o.hours,
    start: { echo: start },
    contacts: [...commons.bouts, ...(commons.openBout ? [commons.openBout] : [])].map(
      (b) => ({
        start: r4(b.start),
        end: b.end === null ? null : r4(b.end),
        closestMm: r4(b.closestM * 1000),
      }),
    ),
    echoOnsets: brain.onsets.map((x) => ({
      t: r4(x.t),
      mode: x.mode,
      novelty: x.novelty === null ? null : r4(x.novelty),
      walkedAway: x.touchResponse,
      alerted: x.alerted,
    })),
    eva: {
      stops: eva.stops,
      mismatches: eva.mismatches,
      perceivedSteps: eva.perceivedSteps,
      overlapSteps: eva.overlapSteps,
      track: track
        ? { samples: track.samples, external_motion: track.external_motion }
        : null,
      independent: (track?.samples ?? 0) >= 10 && (track?.external_motion ?? 0) > 0.0003,
      journeys: s.journeys,
      visits: { ...s.visits },
      moments: bornMoments.map((m) => ({ at: m.at, text: m.text })),
    },
    echo: {
      reserveAtEnd: r4(echo.state.reserve / echo.params.reserveJ),
      meals,
      flights,
      escapes,
    },
    closestMm: r4(closest * 1000),
    frames,
  };
}

export { PERCEIVED_KEY };
