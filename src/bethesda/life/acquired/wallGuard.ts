/**
 * A research fly that cannot fly into a solid. Without this, a fly that walks up
 * to a wall can come to rest exactly on its line, where a point counts as outside
 * but a ray that starts there no longer sees that wall. Its next jump goes through,
 * and from inside the walls hold: it never comes out, and stops eating.
 *
 * This is a test of a fix, kept to research flies: it wraps one fly's own `move`,
 * so src/bethesda/fly stays as it is and so does the deployed fly. A step that
 * would end inside a solid does not happen, and the fly is left where `move` would
 * have stopped it, a standing height off that surface, touching it. Until the first
 * such step the fly's life is exactly what it would have been without the guard.
 *
 * Research lives with no store: this reaches no individual and no archive.
 */
import type { DigitalFly } from "../../fly/fly.js";
import type { V3 } from "../../fly/units.js";

/** How far back a ray starts, to see the wall the fly stands on the line of (m). */
const BACK_M = 1e-6;
/** How far above its perch a fly may settle, as the body allows. */
const SETTLE_GAP_M = 0.003;
/** Where to look for the surface, when the step itself does not name it. */
const AROUND: readonly V3[] = [
  ...Array.from({ length: 16 }, (_, k): V3 => {
    const a = (k * Math.PI) / 8;
    return [Math.cos(a), 0, Math.sin(a)];
  }),
  [0, -1, 0],
  [0, 1, 0],
];

export interface WallGuard {
  /** Steps refused because they would have ended inside a solid. */
  refused: number;
  /** Of those, how many had already touched down in there. */
  touchedDown: number;
  /** Of those, how many had no surface a ray could name. */
  unnamed: number;
  /** The first few refusals, in full, to read afterwards. */
  events: {
    t: number;
    from: V3;
    end: V3;
    was: string;
    now: string;
    surface: string | null;
    normal: number[] | null;
    placed: V3;
    insideAfter: boolean;
  }[];
}

const KEEP_EVENTS = 40;

interface Moving {
  move(h: number, g: V3, wind: V3 | null): void;
  abortLanding(reason: string): void;
}

/** The side of a surface with normal `n` that is open, seen from `from`. */
function outwardOf(fly: DigitalFly, from: V3, n: readonly number[]): V3 {
  const h = fly.standingHeight;
  const open = !fly.world.solid([
    from[0] + n[0]! * h,
    from[1] + n[1]! * h,
    from[2] + n[2]! * h,
  ]);
  return open ? [n[0]!, n[1]!, n[2]!] : [-n[0]!, -n[1]!, -n[2]!];
}

/** A standing height off the surface, on its open side; or here, if neither is open. */
function clear(fly: DigitalFly, from: V3, n: readonly number[]): V3 {
  const o = outwardOf(fly, from, n);
  const h = fly.standingHeight;
  const off: V3 = [from[0] + o[0] * h, from[1] + o[1] * h, from[2] + o[2] * h];
  return fly.world.solid(off) ? from : off;
}

/** The surface in the way of a step from `from` to `end`, or else the one beside it. */
function touching(fly: DigitalFly, from: V3, end: V3 | null, reach: number) {
  const ray = (d: V3, t: number) =>
    fly.world.raycast(
      [from[0] - d[0] * BACK_M, from[1] - d[1] * BACK_M, from[2] - d[2] * BACK_M],
      d,
      t + 2 * BACK_M,
      false,
    );
  if (end) {
    const d: V3 = [
      (end[0] - from[0]) / reach,
      (end[1] - from[1]) / reach,
      (end[2] - from[2]) / reach,
    ];
    const hit = ray(d, reach);
    if (hit) return hit;
  }
  for (const d of AROUND) {
    const hit = ray(d, fly.standingHeight);
    if (hit) return hit;
  }
  return null;
}

/** Refuse, from now on, any step of this fly that would end inside a solid. */
export function guardWalls(fly: DigitalFly): WallGuard {
  const guard: WallGuard = { refused: 0, touchedDown: 0, unnamed: 0, events: [] };
  const body = fly as unknown as Moving;
  const move = body.move.bind(fly);
  const world = fly.world;
  body.move = (h, g, wind) => {
    const s = fly.state;
    const from = s.p;
    const flown = s.counts.flownM;
    const started = s.mode;
    move(h, g, wind);
    if (!world.solid(s.p) || world.solid(from)) return;
    const landedOn = s.mode;
    guard.refused++;
    const end = s.p;
    const reach = Math.hypot(end[0] - from[0], end[1] - from[1], end[2] - from[2]);
    const hit = touching(fly, from, reach > 0 ? end : null, reach);
    if (!hit) guard.unnamed++;
    // A ray's normal faces the ray, so a fly leaving the line gets the one facing in.
    s.p = hit ? clear(fly, from, hit.normal) : from;
    s.counts.flownM = flown;
    const note = () => {
      if (guard.events.length < KEEP_EVENTS)
        guard.events.push({
          t: s.t,
          from,
          end,
          was: started,
          now: landedOn,
          surface: hit?.id ?? null,
          normal: hit ? [...hit.normal] : null,
          placed: s.p,
          insideAfter: world.solid(s.p),
        });
    };
    if (s.mode === "rest" && started !== "rest") {
      // It touched down in there. Stand it on what is under it here, if there is
      // room: where ground falls away beneath a building, its floor can be lower
      // than a fly stands, and then the fly stays in the air.
      guard.touchedDown++;
      const perch = world.perchAt(
        s.p[0],
        s.p[2],
        s.p[1] - fly.standingHeight + SETTLE_GAP_M,
      );
      const stand: V3 | null = perch
        ? [s.p[0], perch.y + fly.standingHeight, s.p[2]]
        : null;
      if (perch && stand && !world.solid(stand)) {
        s.perch = perch;
        s.p = stand;
      } else {
        s.perch = null;
        s.counts.landings--;
        body.abortLanding("no room to stand here");
      }
      note();
      return;
    }
    if (hit) {
      const n = outwardOf(fly, from, hit.normal);
      const into = s.v[0] * n[0] + s.v[1] * n[1] + s.v[2] * n[2];
      if (into < 0)
        s.v = [s.v[0] - into * n[0], s.v[1] - into * n[1], s.v[2] - into * n[2]];
      s.counts.collisions++;
      s.contact = { id: hit.id, kind: hit.kind, normal: n };
    } else s.v = [0, 0, 0];
    note();
  };
  return guard;
}
