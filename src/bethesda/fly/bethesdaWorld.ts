/**
 * The Bethesda city as the digital fly senses and touches it.
 *
 * Read-only: the fly sees the city simulator's agents and the player, and
 * touches the city's static geometry: building footprints extruded to their
 * heights, with their courtyards open, and the rooftop units and shop awnings
 * drawn on them; the bare-earth terrain; the mapped benches, picnic tables,
 * lamps and trees; and the procedural footpath trees and sidewalk lamps,
 * benches and planters, placed where `furniture.ts` tells the renderer to
 * draw them. Benches (slat by slat), tables, planters, rooftop units and
 * awnings are the drawn boxes; lamp poles and tree trunks are tapered round
 * cylinders, and lamp globes, tree crowns and shrubs ellipsoids, each through
 * the corners of the faceted shape the renderer draws (see the proxies below).
 * Much the renderer draws is not here at all (see
 * `BETHESDA_INPUTS.unsupported`). Nothing here writes to the simulator, and
 * the simulator never reads the fly, so the city's outcomes, replays and
 * `SIM_VERSION` are untouched by it.
 *
 * Only the neighbourhood of the fly's home range is assembled (the fly is
 * tethered to it; see `homeRadiusM`), which keeps each ray to a few dozen
 * primitives. The city ticks at 10 Hz and the fly senses at 100 Hz, so agent
 * positions are interpolated between the city states around each sample.
 *
 * Proxies, named as such in `inputs`: light is open sun or building shade
 * (the renderer's sun direction), dimmed in a storm by the renderer's own
 * storm-to-clear sun ratio; a pedestrian is two spheres (legs, torso), a
 * vehicle one, seen but never touched; the round shapes stand for faceted
 * ones (leaf cards are not solid). Facade windows are not in the map data, so
 * facades are opaque walls.
 */
import { buildingAt, buildings, inside, type Building, type Point } from "../model";
import {
  awnings,
  BENCH,
  LAMP,
  PICNIC_TABLE,
  PLANTER,
  STREET_BENCH,
  STREET_LAMP,
  STREET_TREE,
  SUN,
  rooftopUnit,
  streetLamps,
  streetTrees,
  treeShape,
  type BoxSize,
  type BuildingBox,
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
    "building footprints and heights (OSM), with their courtyards",
    "rooftop units and shop awnings (drawn, not mapped)",
    "bare-earth terrain",
    "mapped benches, picnic tables, lamps and trees",
    "procedural footpath trees and sidewalk lamps, benches and planters (drawn, not mapped)",
    "pedestrians, vehicles and the visitor (city simulator), seen only",
  ],
  proxies: [
    "light: open sun or building shade, relative units, dimmed in storms by the renderer's sun ratio",
    "moving things are seen, never touched: a pedestrian is two spheres, a vehicle one, and they pass through the fly",
    "tree crowns, lamp globes and planter shrubs are smooth ellipsoids through the corners of the faceted shapes the renderer draws: their tops are drawn corners and match, and elsewhere the drawn faces lie inside them by up to 6.6 % of the radius (crowns, icosahedra; 16 cm on the largest), 10 % (globes) and 7 % (shrubs)",
    "lamp poles and tree trunks are round tapered cylinders through the corners of the drawn ones: the drawn faces lie inside by up to 19 % of the radius (five-sided street-tree trunks), 13 % (six-sided mapped trunks) and 8 % (eight-sided poles)",
  ],
  // Senses the fly lacks everywhere are `UNSUPPORTED_SENSES`; these are this world's gaps.
  unsupported: [
    "windows (not in the map data; facades are opaque)",
    "wind and rain (a storm only dims the light)",
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
    // A box on a building, any part of which comes within reach.
    const nearBox = (f: BuildingBox) =>
      Math.hypot(f.point.x - home.x, f.point.z - home.z) <=
      reach + Math.hypot(f.w, f.d) / 2;
    const boxes: Box[] = [];
    for (const b of buildings) {
      if (!nearBuilding(b)) continue;
      const base = groundAt(b.center);
      const xs = b.ring.map((p) => p.x),
        zs = b.ring.map((p) => p.z);
      prisms.push({
        kind: "wall",
        id: `building ${b.id}`,
        ring: b.ring,
        ...(b.holes.length ? { holes: b.holes } : {}),
        y0: base - 3,
        y1: base + b.height,
        min: { x: Math.min(...xs), z: Math.min(...zs) },
        max: { x: Math.max(...xs), z: Math.max(...zs) },
      });
      // What `geometry.ts` draws on the building, from the same placement and
      // on the same base (the ground at the building's centre).
      const unit = rooftopUnit(b);
      if (unit && nearBox(unit))
        boxes.push({
          kind: "obstacle",
          id: `building ${b.id} rooftop unit`,
          center: [unit.point.x, base + unit.y, unit.point.z],
          half: [unit.w / 2, unit.h / 2, unit.d / 2],
          angle: unit.angle,
        });
      awnings(b).forEach((a, k) => {
        if (!nearBox(a)) return;
        // Drawn centred on the wall line: the half inside the building is
        // hidden by it, so the fly's awning is the half that reaches out.
        const nx = Math.sin(a.angle),
          nz = Math.cos(a.angle);
        const out = inside({ x: a.point.x + nx * 0.01, z: a.point.z + nz * 0.01 }, b.ring)
          ? -1
          : 1;
        boxes.push({
          kind: "obstacle",
          id: `building ${b.id} awning ${k}`,
          center: [
            a.point.x + out * nx * (a.d / 4),
            base + a.y,
            a.point.z + out * nz * (a.d / 4),
          ],
          half: [a.w / 2, a.h / 2, a.d / 4],
          angle: a.angle,
        });
      });
    }
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
        r1: LAMP.poleTopRadius,
        y0: g,
        y1: g + LAMP.poleHeight,
      });
      spheres.push({
        kind: "lamp",
        id: `lamp globe ${l.osmId}`,
        center: [l.point.x, g + LAMP.globeY, l.point.z],
        r: LAMP.globeRadius,
        stretch: LAMP.globeStretch,
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
        r1: tree.trunkTopRadius,
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
        r1: STREET_TREE.trunkTopRadius,
        y0: g,
        y1: g + t.trunkHeight,
      });
      t.crowns.forEach((c, k) => {
        spheres.push({
          kind: "obstacle",
          id: `street tree ${n} crown ${k}`,
          center: [c.x, groundAt(c) + c.y, c.z],
          r: c.r,
          stretch: c.stretch,
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
        r1: L.poleTopRadius,
        y0: g,
        y1: g + L.poleHeight,
      });
      boxes.push(boxAt(p, L.base, "pole", `street lamp ${n} base`));
      boxes.push(boxAt(p, L.collar, "pole", `street lamp ${n} collar`));
      spheres.push({
        kind: "lamp",
        id: `street lamp globe ${n}`,
        center: [p.x, g + L.globeY, p.z],
        r: L.globeRadius,
        stretch: L.globeStretch,
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
      // Slat by slat, as `detail.ts` draws them, with the gaps between them open.
      for (let k = 0; k < B.slats; k++)
        boxes.push(
          boxAt(
            across((k - 0.5) * B.slatPitch),
            B.slat,
            "bench",
            `street bench ${n} slat ${k}`,
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
        stretch: PLANTER.shrubStretch,
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
   * Called before the fly advances over [tStart, tEnd], once per city tick or
   * once for several taken together: the positions the city has just reached
   * become the end of the interpolation, the last ones its start.
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
