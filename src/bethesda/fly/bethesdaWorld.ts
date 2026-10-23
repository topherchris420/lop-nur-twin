/**
 * The Bethesda city as the digital fly senses and touches it.
 *
 * Read-only: the fly sees the city simulator's agents and the player, and
 * touches the city's static geometry: building footprints extruded to their
 * heights, the bare-earth terrain, the mapped benches, picnic tables, lamps
 * and trees, and the procedural footpath trees and sidewalk lamps, benches
 * and planters, placed where `furniture.ts` tells the renderer to draw them.
 * Benches, tables and planters are the drawn boxes (a street bench's slats
 * are one slab); lamp poles and tree trunks are upright cylinders at the
 * drawn base radius, where the drawn ones taper; lamp globes, tree crowns and
 * shrubs are simpler shapes than the drawn ones (see the proxies below), and
 * much the renderer draws is not here at all (see
 * `BETHESDA_INPUTS.unsupported`). Nothing here writes to the simulator, and
 * the simulator never reads the fly, so the city's outcomes, replays and
 * `SIM_VERSION` are untouched by it.
 *
 * Only the neighbourhood of the fly's home range is assembled (the fly is
 * tethered to it; see `homeRadiusM`), which keeps each ray to a few dozen
 * primitives. The city ticks at 10 Hz and the fly senses at 100 Hz, so agent
 * positions are interpolated between the two ticks around each sample.
 *
 * Proxies, named as such in `inputs`: light is open sun or building shade
 * (the renderer's sun direction), dimmed in a storm by the renderer's own
 * storm-to-clear sun ratio; a pedestrian is two spheres (legs, torso), a
 * vehicle one, seen but never touched; a lamp globe is a short cylinder
 * around the drawn ellipsoid; trunks and poles are untapered cylinders, and a
 * street bench's slats one slab; a tree crown is spheres the renderer draws
 * squashed or stretched, or as faceted icosahedra (leaf cards are not
 * solid), and a shrub is a sphere drawn squashed to 0.8 of its height.
 * Facade windows are not in the map data, so facades are opaque walls.
 */
import { buildingAt, buildings, inside, type Building, type Point } from "../model";
import {
  BENCH,
  LAMP,
  PICNIC_TABLE,
  PLANTER,
  STREET_BENCH,
  STREET_LAMP,
  STREET_TREE,
  SUN,
  streetLamps,
  streetTrees,
  treeShape,
  type BoxSize,
} from "../furniture";
import { mappedBenches, mappedLamps, mappedTrees } from "../streetscape";
import { groundAt, maximumGround } from "../terrain";
import type { CitySimulation } from "../simulation";
import { PARAMS } from "./params.js";
import type { V3 } from "./units.js";
import {
  PrimitiveWorld,
  type Box,
  type Cylinder,
  type Mover,
  type Prism,
  type Sphere,
  type WorldInputs,
} from "./world.js";

export const BETHESDA_INPUTS: WorldInputs = {
  supported: [
    "building footprints and heights (OSM)",
    "bare-earth terrain",
    "mapped benches, picnic tables, lamps and trees",
    "procedural footpath trees and sidewalk lamps, benches and planters (drawn, not mapped)",
    "pedestrians, vehicles and the visitor (city simulator), seen only",
  ],
  proxies: [
    "light: open sun or building shade, relative units, dimmed in storms by the renderer's sun ratio",
    "moving things are seen, never touched: a pedestrian is two spheres, a vehicle one, and they pass through the fly",
    "a lamp globe is a flat-topped cylinder around the drawn ellipsoid: near its rim the fly stands up to 33 cm above the drawn globe",
    "lamp poles and tree trunks are upright cylinders at the drawn base radius; the drawn ones taper (trunks from 25–28 cm to 15–16 cm, poles from 9 cm to 5.5 cm)",
    "a street bench's four slats are one slab: the 1.5 cm gaps between them are solid to the fly",
    "tree crowns and planter shrubs are spheres, but the renderer stretches crowns to 0.85–1.15 of their height and shrubs to 0.8: a fly on a shrub stands 7.6 cm above its drawn top, and a large crown's top can be 36 cm off",
    "mapped tree crowns are drawn as faceted icosahedra inside the fly's spheres",
  ],
  // Senses the fly lacks everywhere are `UNSUPPORTED_SENSES`; these are this world's gaps.
  unsupported: [
    "windows (not in the map data; facades are opaque)",
    "wind and rain (a storm only dims the light)",
    "awnings and rooftop units: drawn, not solid",
    "courtyards: a building's inner courtyards are solid roof to the fly",
    "facade relief on the detailed blocks (ledges, pilasters, window frames, sills, rails): facades are flat walls",
    "other drawn street objects: traffic-signal poles and mast arms, bus stops and shelters, bike-share docks, street-name blades and signs, monuments and art, the metro entrance, construction fencing, the Bethesda Lane ring lights, tree pits and limbs",
  ],
};

const SUN_DIR: V3 = (() => {
  const n = Math.hypot(SUN.offset.x, SUN.offset.y, SUN.offset.z);
  return [SUN.offset.x / n, SUN.offset.y / n, SUN.offset.z / n];
})();

/** The home spot: a mapped bench or picnic table seat near `near`, outside buildings. */
export function homeSeat(
  near: Point,
): { point: Point; kind: string; osmId: string } | null {
  let best: { point: Point; kind: string; osmId: string; d: number } | null = null;
  for (const b of mappedBenches) {
    if (buildingAt(b.point)) continue;
    const d = Math.hypot(b.point.x - near.x, b.point.z - near.z);
    if (d < 150 && (!best || d < best.d))
      best = { point: b.point, kind: b.kind, osmId: b.osmId, d };
  }
  return best && { point: best.point, kind: best.kind, osmId: best.osmId };
}

/** A mover's position at a city tick, with the ground under it. */
interface Located {
  x: number;
  z: number;
  g: number;
}
const located = (p: Point): Located => ({ x: p.x, z: p.z, g: groundAt(p) });

const boxAt = (p: Point, b: BoxSize, kind: Box["kind"], id: string, angle = 0): Box => {
  const base = groundAt(p);
  return {
    kind,
    id,
    center: [p.x, base + b.y, p.z],
    half: [b.w / 2, b.h / 2, b.d / 2],
    angle,
  };
};

export class BethesdaFlyWorld extends PrimitiveWorld {
  private sim: CitySimulation;
  private prev = new Map<string, Located>();
  private curr = new Map<string, Located>();
  private t0 = 0;
  private t1 = 0.1;
  private weather: { stormy: boolean };

  constructor(sim: CitySimulation, home: Point) {
    const homeY = groundAt(home);
    const reach = PARAMS.homeRadiusM.value + PARAMS.visualRangeM.value + 10;
    const near = (p: Point) => Math.hypot(p.x - home.x, p.z - home.z) <= reach;
    const weather = { stormy: false };
    const prisms: Prism[] = [];
    const nearBuilding = (b: Building) =>
      b.ring.some((p) => Math.hypot(p.x - home.x, p.z - home.z) <= reach + 60) ||
      inside(home, b.ring);
    for (const b of buildings) {
      if (!nearBuilding(b)) continue;
      const base = groundAt(b.center);
      const xs = b.ring.map((p) => p.x),
        zs = b.ring.map((p) => p.z);
      prisms.push({
        kind: "wall",
        id: `building ${b.id}`,
        ring: b.ring,
        y0: base - 3,
        y1: base + b.height,
        min: { x: Math.min(...xs), z: Math.min(...zs) },
        max: { x: Math.max(...xs), z: Math.max(...zs) },
      });
    }
    const boxes: Box[] = [];
    const cylinders: Cylinder[] = [];
    const spheres: Sphere[] = [];
    for (const b of mappedBenches) {
      if (!near(b.point) || buildingAt(b.point)) continue;
      if (b.kind === "picnic_table") {
        boxes.push(boxAt(b.point, PICNIC_TABLE.top, "table", `picnic table ${b.osmId}`));
        for (const s of [-1, 1]) {
          const p = { x: b.point.x, z: b.point.z + s * PICNIC_TABLE.seat.dz };
          boxes.push(
            boxAt(
              p,
              PICNIC_TABLE.seat,
              "bench",
              `picnic seat ${b.osmId}${s > 0 ? "s" : "n"}`,
            ),
          );
        }
      } else {
        boxes.push(boxAt(b.point, BENCH.seat, "bench", `bench ${b.osmId}`));
        const p = { x: b.point.x, z: b.point.z + BENCH.back.dz };
        boxes.push(boxAt(p, BENCH.back, "bench", `bench back ${b.osmId}`));
      }
    }
    for (const l of mappedLamps) {
      if (!near(l.point) || buildingAt(l.point)) continue;
      const g = groundAt(l.point);
      cylinders.push({
        kind: "pole",
        id: `lamp ${l.osmId}`,
        x: l.point.x,
        z: l.point.z,
        r: LAMP.poleBottomRadius,
        y0: g,
        y1: g + LAMP.poleHeight,
      });
      const half = LAMP.globeRadius * LAMP.globeStretch;
      cylinders.push({
        kind: "lamp",
        id: `lamp globe ${l.osmId}`,
        x: l.point.x,
        z: l.point.z,
        r: LAMP.globeRadius,
        y0: g + LAMP.globeY - half,
        y1: g + LAMP.globeY + half,
      });
    }
    for (const t of mappedTrees) {
      if (!near(t.point) || buildingAt(t.point)) continue;
      const tree = treeShape(t.osmId);
      const g = groundAt(t.point);
      cylinders.push({
        kind: "pole",
        id: `tree ${t.osmId}`,
        x: t.point.x,
        z: t.point.z,
        r: tree.trunkBottomRadius,
        y0: g,
        y1: g + tree.trunkHeight,
      });
      tree.crowns.forEach((c, k) => {
        const p = { x: t.point.x + c.dx, z: t.point.z + c.dz };
        spheres.push({
          kind: "obstacle",
          id: `tree ${t.osmId} crown ${k}`,
          center: [p.x, groundAt(p) + c.y, p.z],
          r: c.r,
        });
      });
    }
    // The procedural items, as `geometry.ts` and `detail.ts` draw them.
    streetTrees().forEach((t, n) => {
      if (!near(t.point)) return;
      const g = groundAt(t.point);
      cylinders.push({
        kind: "pole",
        id: `street tree ${n}`,
        x: t.point.x,
        z: t.point.z,
        r: STREET_TREE.trunkBottomRadius,
        y0: g,
        y1: g + t.trunkHeight,
      });
      t.crowns.forEach((c, k) => {
        spheres.push({
          kind: "obstacle",
          id: `street tree ${n} crown ${k}`,
          center: [c.x, groundAt(c) + c.y, c.z],
          r: c.r,
        });
      });
    });
    streetLamps().forEach(({ point: p, angle, bench }, n) => {
      if (!near(p)) return;
      const g = groundAt(p),
        L = STREET_LAMP;
      cylinders.push({
        kind: "pole",
        id: `street lamp ${n}`,
        x: p.x,
        z: p.z,
        r: L.poleBottomRadius,
        y0: g,
        y1: g + L.poleHeight,
      });
      boxes.push(boxAt(p, L.base, "pole", `street lamp ${n} base`));
      boxes.push(boxAt(p, L.collar, "pole", `street lamp ${n} collar`));
      const half = L.globeRadius * L.globeStretch;
      cylinders.push({
        kind: "lamp",
        id: `street lamp globe ${n}`,
        x: p.x,
        z: p.z,
        r: L.globeRadius,
        y0: g + L.globeY - half,
        y1: g + L.globeY + half,
      });
      boxes.push(boxAt(p, L.cap, "lamp", `street lamp ${n} cap`));
      if (!bench) return;
      // The bench's own x axis runs across the seat: (cos, −sin) of the path angle.
      const q = bench.point,
        B = STREET_BENCH,
        across = (d: number) => ({
          x: q.x + Math.cos(angle) * d,
          z: q.z - Math.sin(angle) * d,
        });
      const first = -0.5 * B.slatPitch,
        last = (B.slats - 1.5) * B.slatPitch;
      boxes.push(
        boxAt(
          across((first + last) / 2),
          { ...B.slat, w: last - first + B.slat.w },
          "bench",
          `street bench ${n}`,
          angle,
        ),
      );
      boxes.push(
        boxAt(across(B.backOffset), B.back, "bench", `street bench back ${n}`, angle),
      );
      for (const side of [-1, 1])
        boxes.push(
          boxAt(
            {
              x: q.x + Math.sin(angle) * B.legSpread * side,
              z: q.z + Math.cos(angle) * B.legSpread * side,
            },
            B.leg,
            "obstacle",
            `street bench ${n} end ${side}`,
            angle,
          ),
        );
      const planter = bench.planter;
      if (!planter) return;
      boxes.push(boxAt(planter, PLANTER.body, "obstacle", `planter ${n}`, angle));
      boxes.push(boxAt(planter, PLANTER.rim, "obstacle", `planter ${n} rim`, angle));
      spheres.push({
        kind: "obstacle",
        id: `planter ${n} shrub`,
        center: [planter.x, groundAt(planter) + PLANTER.shrubY, planter.z],
        r: PLANTER.shrubRadius,
      });
    });
    super({
      id: "bethesda",
      home: {
        center: [home.x, homeY, home.z],
        radius: PARAMS.homeRadiusM.value,
        ceiling: homeY + 8,
      },
      inputs: BETHESDA_INPUTS,
      ground: (x, z) => groundAt({ x, z }),
      groundMax: maximumGround,
      groundKind: "ground",
      boxes,
      cylinders,
      spheres,
      prisms,
      sun: { toward: SUN_DIR, level: 1, shade: 0.35 },
      dimming: () => (weather.stormy ? SUN.stormIntensity / SUN.clearIntensity : 1),
    });
    this.sim = sim;
    this.weather = weather;
    this.curr = this.snapshot();
    this.prev = this.curr;
  }

  protected override prismsNear(x: number, z: number, r: number): readonly Prism[] {
    const all = this.spec.prisms ?? [];
    return all.filter(
      (p) => x + r >= p.min.x && x - r <= p.max.x && z + r >= p.min.z && z - r <= p.max.z,
    );
  }

  private snapshot(): Map<string, Located> {
    const out = new Map<string, Located>();
    const c = this.home.center;
    const range = this.home.radius + PARAMS.visualRangeM.value + 20;
    for (const a of this.sim.agents) {
      if (a.inside || a.riding !== 0) continue;
      if (Math.hypot(a.point.x - c[0], a.point.z - c[2]) > range) continue;
      out.set(`${a.kind === "pedestrian" ? "p" : "v"}${a.id}`, located(a.point));
    }
    out.set("player", located(this.sim.player));
    return out;
  }

  /**
   * Called once per city tick, before the fly advances over [tStart, tEnd]:
   * the positions just stepped to become the end of the interpolation.
   */
  sync(tStart: number, tEnd: number): void {
    this.prev = this.curr;
    this.curr = this.snapshot();
    this.t0 = tStart;
    this.t1 = tEnd;
    this.weather.stormy = this.sim.events.some((e) => e.kind === "storm");
  }

  override movers(near: V3, radius: number, out: Mover[], t: number): void {
    const u =
      this.t1 > this.t0
        ? Math.min(1, Math.max(0, (t - this.t0) / (this.t1 - this.t0)))
        : 1;
    for (const [id, b] of this.curr) {
      const a = this.prev.get(id) ?? b;
      const x = a.x + (b.x - a.x) * u,
        z = a.z + (b.z - a.z) * u;
      if (Math.hypot(x - near[0], z - near[2]) > radius + 2) continue;
      const g = a.g + (b.g - a.g) * u;
      if (id.startsWith("v"))
        out.push({ id, kind: "vehicle", center: [x, g + 0.75, z], radius: 1.0 });
      else {
        const kind = id === "player" ? "player" : "person";
        out.push({ id: `${id}:legs`, kind, center: [x, g + 0.45, z], radius: 0.3 });
        out.push({ id: `${id}:torso`, kind, center: [x, g + 1.3, z], radius: 0.38 });
      }
    }
  }
}
