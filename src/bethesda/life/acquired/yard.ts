/**
 * Research yards and research subjects for acquired search. Every subject here
 * is built from a seed for the study: none is the deployed fly, a copy of it,
 * or a continuation of it, and nothing here reads or writes a store.
 *
 * A yard is open ground under a sun, a patchwork of square cells, about half
 * of them under high canopies that shade the ground. Food appears only where
 * the study's rule says, so the rule, and not the fly's code, decides what a
 * meal looks like. A food place is used once and moves on, so no remembered
 * place can stand in for what is being tested.
 */
import { mulberry32 } from "../../../lib/noise.js";
import { DigitalFly } from "../../fly/fly.js";
import type { AdapterStreams } from "../../fly/neural.js";
import type { V3 } from "../../fly/units.js";
import {
  PrimitiveWorld,
  type Box,
  type FlyWorld,
  type FoodPatch,
  type Hit,
  type LandingSite,
  type Landmark,
  type LightSample,
  type Mover,
  type Perch,
  type PrimitiveWorldSpec,
} from "../../fly/world.js";
import { DT } from "../../simulation.js";
import type { OrganismAdapter } from "../organism.js";

export const TICK_S = 0.1;
/** Where the study puts its food. */
export type FoodRule = "sun" | "shade";
export const FOOD_RULES: readonly FoodRule[] = ["sun", "shade"];
/** How a fly is fed in training; "any" is the control, food wherever it falls. */
export type TrainingRule = FoodRule | "any";

/** Everything that differs from one yard to the next. */
export interface YardLayout {
  seed: number;
  /** Half the yard's side (m). */
  half: number;
  /** A cell's side (m). */
  cell: number;
  /** Height of the canopies (m). */
  canopyY: number;
  /** Direction toward the sun, unit length. */
  sun: V3;
  /** Share of the cells under a canopy. */
  shaded: number;
  /** Where the yard's centre is: a new yard is laid out around the fly, which is not moved. */
  origin?: readonly [number, number];
}

const unit = (v: V3): V3 => {
  const n = Math.hypot(...v);
  return [v[0] / n, v[1] / n, v[2] / n];
};
/** A sun from this bearing and elevation (rad). */
export const sunFrom = (bearing: number, elevation: number): V3 =>
  unit([
    Math.cos(bearing) * Math.cos(elevation),
    Math.sin(elevation),
    Math.sin(bearing) * Math.cos(elevation),
  ]);

const FLAT = (): number => 0;

function canopies(layout: YardLayout): Box[] {
  const r = mulberry32(layout.seed >>> 0);
  const out: Box[] = [];
  const n = Math.floor((2 * layout.half) / layout.cell);
  // Shadows fall offset from their canopies by the sun's slant.
  const dx = (-layout.sun[0] / layout.sun[1]) * layout.canopyY,
    dz = (-layout.sun[2] / layout.sun[1]) * layout.canopyY;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      if (r() >= layout.shaded) continue;
      const x = (layout.origin?.[0] ?? 0) - layout.half + (i + 0.5) * layout.cell - dx,
        z = (layout.origin?.[1] ?? 0) - layout.half + (j + 0.5) * layout.cell - dz;
      out.push({
        kind: "obstacle",
        id: `canopy ${i} ${j}`,
        center: [x, layout.canopyY, z],
        half: [layout.cell / 2, 0.05, layout.cell / 2],
        angle: 0,
      });
    }
  return out;
}

function spec(layout: YardLayout, food: readonly FoodPatch[]): PrimitiveWorldSpec {
  const [ox, oz] = layout.origin ?? [0, 0];
  return {
    id: "acquired-yard",
    home: {
      center: [ox, 0, oz],
      radius: layout.half,
      ceiling: layout.canopyY + 6,
      bounds: {
        min: { x: ox - layout.half, z: oz - layout.half },
        max: { x: ox + layout.half, z: oz + layout.half },
      },
    },
    inputs: { supported: ["food", "sun", "canopies"], proxies: [], unsupported: [] },
    ground: FLAT,
    groundMax: 0,
    ambient: 0,
    sun: { toward: layout.sun, level: 1, shade: 0.35 },
    boxes: canopies(layout),
    food: [...food],
  };
}

/** The yard the fly lives in now. Its layout and food change by the study's hand. */
export class PatchworkYard implements FlyWorld {
  readonly id = "acquired-yard";
  home: FlyWorld["home"];
  inputs: FlyWorld["inputs"];
  layout: YardLayout;
  food: FoodPatch[] = [];
  private now: PrimitiveWorld;
  constructor(layout: YardLayout) {
    this.layout = layout;
    this.now = new PrimitiveWorld(spec(layout, []));
    this.home = this.now.home;
    this.inputs = this.now.inputs;
  }
  /** Change the yard: the fly is somewhere it has never been. */
  enter(layout: YardLayout, food: readonly FoodPatch[]): void {
    this.layout = layout;
    this.food = [...food];
    this.now = new PrimitiveWorld(spec(layout, food));
    this.home = this.now.home;
  }
  setFood(food: readonly FoodPatch[]): void {
    this.enter(this.layout, food);
  }
  sunlit(x: number, z: number): boolean {
    return this.now.light([x, 0.2, z]).sunlit === true;
  }
  perchAt(x: number, z: number, maxY: number): Perch | null {
    return this.now.perchAt(x, z, maxY);
  }
  raycast(origin: V3, dir: V3, maxT: number, visible?: boolean): Hit | null {
    return this.now.raycast(origin, dir, maxT, visible);
  }
  solid(p: V3): boolean {
    return this.now.solid(p);
  }
  movers(near: V3, radius: number, out: Mover[], t: number): void {
    this.now.movers(near, radius, out, t);
  }
  light(p: V3): LightSample {
    return this.now.light(p);
  }
  landingSites(near: V3, radius: number, out: LandingSite[]): void {
    this.now.landingSites(near, radius, out);
  }
  foodAt(p: V3): FoodPatch | null {
    return this.now.foodAt(p);
  }
  odour(p: V3): number {
    return this.now.odour(p);
  }
  landmarks(near: V3, radius: number, out: Landmark[]): void {
    this.now.landmarks(near, radius, out);
  }
}

/** `n` food places the rule allows, at least `apart` metres from each other and `clear` from `from`. */
export function foodByRule(
  yard: PatchworkYard,
  rule: TrainingRule,
  n: number,
  seed: number,
  from: readonly [number, number] | null = null,
  clear = 0,
  apart = 25,
): FoodPatch[] {
  const r = mulberry32(seed >>> 0);
  const out: FoodPatch[] = [];
  const h = yard.layout.half - 2;
  const [ox, oz] = yard.layout.origin ?? [0, 0];
  for (let tries = 0; tries < 50000 && out.length < n; tries++) {
    const x = ox + (r() * 2 - 1) * h,
      z = oz + (r() * 2 - 1) * h;
    if (rule !== "any" && yard.sunlit(x, z) !== (rule === "sun")) continue;
    if (from && Math.hypot(x - from[0], z - from[1]) < clear) continue;
    if (out.some((f) => Math.hypot(f.center[0] - x, f.center[2] - z) < apart)) continue;
    out.push({
      id: `food ${seed} ${out.length}`,
      kind: rule,
      center: [x, 0, z],
      surface: "ground",
      radius: 0.25,
    });
  }
  return out;
}

export interface SubjectOptions {
  seed: number;
  layout: YardLayout;
  /** The fly's controller; the organism's three additions and whatever a descendant adds. */
  adapter: (rng: () => number, streams: AdapterStreams, seed: number) => OrganismAdapter;
  startReserve?: number;
}

/** A research fly in a yard, stepped as `OrganismLife` steps the city's: physiology first. */
export class YardSubject {
  readonly yard: PatchworkYard;
  readonly fly: DigitalFly;
  tick = 0;
  constructor(o: SubjectOptions) {
    this.yard = new PatchworkYard(o.layout);
    this.fly = new DigitalFly({
      seed: o.seed,
      world: this.yard,
      start: { p: [0, 0.0011, 0], yaw: 0 },
      config: { startReserve: o.startReserve ?? 0.5 },
      adapter: (rng, streams) => o.adapter(rng, streams, o.seed),
    });
  }
  get organism(): OrganismAdapter {
    return this.fly.adapter as OrganismAdapter;
  }
  step(ticks: number): void {
    const a = this.organism,
      fly = this.fly;
    for (let i = 0; i < ticks; i++) {
      const capacity = fly.params.reserveJ;
      const supplied = a.physiology.advance(DT, {
        mode: fly.state.mode,
        reserve: Math.min(fly.state.reserve, capacity),
        capacity,
      });
      if (supplied > 0)
        fly.state.reserve = Math.min(capacity, fly.state.reserve + supplied);
      fly.advance(TICK_S);
      this.tick++;
    }
  }
  /** Run on until the fly stands on something (at most `maxTicks`). */
  untilPerched(maxTicks = 6000): void {
    const perched = new Set(["rest", "groom", "walk", "feed"]);
    for (let i = 0; i < maxTicks && !perched.has(this.fly.state.mode); i++) this.step(1);
  }
}
