/**
 * The research ecology as a fly's world: a flat, walled yard with tree trunks
 * (which are landmarks) and canopies, rocks (obstacles with tops to stand on),
 * and whatever fruit and nectar the ecosystem holds now.
 *
 * It answers the fly's questions from the ecosystem's current state and never
 * changes it: light from the atmosphere (a sun moving with the hour, rocks and
 * trunks casting shade), wind from the atmosphere (a pure function of time, so
 * the same whenever asked), odour from the transported field, food and
 * landing sites from the fruit and flowers that hold sugar. Static geometry
 * comes from one `PrimitiveWorld` built once.
 */
import type { V3 } from "../fly/units.js";
import {
  PrimitiveWorld,
  type FlyWorld,
  type FoodPatch,
  type Hit,
  type Home,
  type Landmark,
  type LandingSite,
  type LightSample,
  type Mover,
  type Perch,
  type WorldInputs,
} from "../fly/world.js";
import type { Ecosystem, Flower, Fruit } from "./ecosystem.js";
import { P } from "./params.js";

/** The courtyard's walls: thickness and the height of the air in it (m). */
const WALL_M = 0.2;
const CEILING_M = 6;
/** A standing fly is on a food item within this height of the ground (m). */
const FOOD_HEIGHT_M = 0.01;
/** Odour falls with height above the near-ground layer over this scale (m). */
const ODOUR_HEIGHT_M = 1;

export const ECOLOGY_INPUTS: WorldInputs = {
  supported: [
    "food: fallen fruit and flowers' nectar, as the ecosystem holds them",
    "odour: carried by the wind, diffused and lost",
    "wind",
    "light: a day and a sun, dimmed by cloud, shaded by rocks and trunks",
    "tree trunks (landmarks) and rocks",
  ],
  proxies: [
    "odour: one near-ground layer, falling off with height; a model, not validated fluid transport",
    "light level: relative units, not lux",
  ],
  unsupported: [
    "temperature and humidity (the ecosystem has them; the fly's senses do not)",
    "sound",
  ],
};

export class EcologyWorld implements FlyWorld {
  readonly id = "research-ecology-yard";
  readonly home: Home;
  readonly inputs = ECOLOGY_INPUTS;
  readonly eco: Ecosystem;
  private readonly base: PrimitiveWorld;
  constructor(eco: Ecosystem) {
    this.eco = eco;
    const s = eco.spec;
    this.home = {
      center: [0, 0, 0],
      radius: s.half,
      ceiling: CEILING_M,
      bounds: { min: { x: -s.half, z: -s.half }, max: { x: s.half, z: s.half } },
    };
    this.base = new PrimitiveWorld({
      id: this.id,
      home: this.home,
      inputs: ECOLOGY_INPUTS,
      ground: () => 0,
      groundMax: 0,
      ambient: 0,
      cylinders: [
        ...s.trees.map((t) => ({
          kind: "pole" as const,
          id: `trunk-${t.id}`,
          x: t.x,
          z: t.z,
          r: 0.15,
          y0: 0,
          y1: 3,
        })),
        // A canopy is a thin disc of crown above the trunk: it casts shade.
        ...s.trees
          .filter((t) => t.canopyM)
          .map((t) => ({
            kind: "roof" as const,
            id: `canopy-${t.id}`,
            x: t.x,
            z: t.z,
            r: t.canopyM!,
            y0: 2.6,
            y1: 2.9,
          })),
      ],
      boxes: [
        ...s.rocks.map((r) => ({
          kind: "obstacle" as const,
          id: r.id,
          center: [r.x, r.height / 2, r.z] as V3,
          half: [r.half, r.height / 2, r.half] as V3,
          angle: 0,
        })),
        // The yard is a walled courtyard, its walls as high as the air the fly
        // may use: nothing lies beyond it, and the fly cannot leave.
        ...(
          [
            ["wall-n", 0, -s.half - WALL_M / 2, s.half + WALL_M, WALL_M / 2],
            ["wall-s", 0, s.half + WALL_M / 2, s.half + WALL_M, WALL_M / 2],
            ["wall-w", -s.half - WALL_M / 2, 0, WALL_M / 2, s.half + WALL_M],
            ["wall-e", s.half + WALL_M / 2, 0, WALL_M / 2, s.half + WALL_M],
          ] as const
        ).map(([id, x, z, hx, hz]) => ({
          kind: "wall" as const,
          id,
          center: [x, CEILING_M / 2, z] as V3,
          half: [hx, CEILING_M / 2, hz] as V3,
          angle: 0,
        })),
      ],
    });
  }

  perchAt(x: number, z: number, maxY: number): Perch | null {
    return this.base.perchAt(x, z, maxY);
  }
  raycast(origin: V3, dir: V3, maxT: number, visible?: boolean): Hit | null {
    return this.base.raycast(origin, dir, maxT, visible);
  }
  solid(p: V3): boolean {
    return this.base.solid(p);
  }
  movers(_near: V3, _radius: number, _out: Mover[], _t: number): void {}

  /** The sun's direction at the ecosystem's hour, or null below the horizon. */
  private sun(): V3 | null {
    const hour = this.eco.weather.hour;
    const el = Math.asin(
      Math.max(-1, Math.min(1, Math.sin((2 * Math.PI * (hour - 6)) / 24))),
    );
    if (el <= 0.02) return null;
    // East at 06:00, south (+z) at noon, west at 18:00.
    const az = (Math.PI * (hour - 6)) / 12;
    return [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)];
  }

  light(p: V3): LightSample {
    const w = this.eco.weather;
    const sun = this.sun();
    if (!sun) return { level: w.light, toward: null, sunlit: false };
    const lit = !this.base.raycast([p[0], p[1] + 1e-3, p[2]], sun, 50, true);
    // In shade only the sky's share of the light arrives.
    const level = lit ? w.light : P("nightLight") + 0.35 * (w.light - P("nightLight"));
    return { level, toward: lit ? sun : null, sunlit: lit };
  }

  /**
   * The ecosystem's time at the fly's time 0 (s): a fly placed in a world that
   * had already lived this long.
   */
  timeOffsetS = 0;

  wind(_p: V3, t: number): V3 {
    return this.eco.atmosphere.at(t + this.timeOffsetS).wind;
  }

  private foods(): (Fruit | Flower)[] {
    const out: (Fruit | Flower)[] = [];
    for (const f of this.eco.fruits) if (f.sugarMg > 0) out.push(f);
    for (const f of this.eco.flowers) if (f.sugarMg >= P("nectarMinSugarMg")) out.push(f);
    return out;
  }

  private patch(f: Fruit | Flower): FoodPatch {
    const fruit = "ripeness" in f;
    return {
      id: f.id,
      kind: fruit ? "fruit" : "nectar",
      center: [f.x, 0, f.z],
      surface: "ground",
      radius: fruit ? P("fruitRadiusM") : P("flowerRadiusM"),
    };
  }

  landingSites(near: V3, radius: number, out: LandingSite[]): void {
    this.base.landingSites(near, radius, out);
    for (const f of this.foods()) {
      if (Math.hypot(f.x - near[0], f.z - near[2]) > radius) continue;
      const p = this.patch(f);
      // The square inscribed in the patch, as `PrimitiveWorld` offers food.
      out.push({
        id: p.id,
        kind: p.surface,
        center: [p.center[0], p.center[1], p.center[2]],
        half: [p.radius / Math.SQRT2, p.radius / Math.SQRT2],
        angle: 0,
        food: p.kind,
      });
    }
  }

  foodAt(p: V3): FoodPatch | null {
    if (p[1] > FOOD_HEIGHT_M) return null;
    for (const f of this.foods()) {
      const patch = this.patch(f);
      if (Math.hypot(f.x - p[0], f.z - p[2]) <= patch.radius) return patch;
    }
    return null;
  }

  odour(p: V3): number {
    return (
      P("odourScale") *
      this.eco.odour.concentrationAt(p[0], p[2]) *
      Math.exp(-Math.max(0, p[1]) / ODOUR_HEIGHT_M)
    );
  }

  landmarks(near: V3, radius: number, out: Landmark[]): void {
    this.base.landmarks(near, radius, out);
  }

  /**
   * The relative humidity of the air at `p`: the weather's, raised by the
   * vapour evaporating ground has put into the near-ground air (carried by the
   * wind, `Ecosystem.vapour`), and to saturation over wet ground itself (a
   * cell holding `WET_GROUND_MM`), each falling off with height. What a fly's
   * antennal hygroreceptors would meet; a model, not a measurement.
   */
  humidityAt(p: V3): number {
    const rh = this.eco.weather.humidity;
    const y = Math.max(0, p[1]);
    const wet = Math.min(1, this.eco.soilWaterAt(p[0], p[2]) / WET_GROUND_MM);
    const plume =
      P("vapourHumidityPerMm") *
      this.eco.vapour.concentrationAt(p[0], p[2]) *
      Math.exp(-y / VAPOUR_LAYER_M);
    const dryShare = (1 - rh) * (1 - wet * Math.exp(-y / HUMID_LAYER_M));
    return Math.min(1, 1 - dryShare + plume);
  }

  /** Air temperature at `p` (°C): the weather's, the same everywhere in the yard. */
  airTempAt(_p: V3): number {
    return this.eco.weather.tempC;
  }
}

/** Ground holding this much surface water (mm) is wet: the air at it is saturated. */
export const WET_GROUND_MM = 2;
/** Over this height (m) the humidity of wet ground falls off into the air's. */
export const HUMID_LAYER_M = 0.3;
/** Over this height (m) the vapour carried near the ground thins out. */
export const VAPOUR_LAYER_M = 1;
