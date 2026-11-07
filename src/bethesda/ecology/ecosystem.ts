/**
 * The research ecology: a yard whose weather, soil water, fruit, flowers and
 * odour go on whether or not any fly is in it.
 *
 * - **Weather** is the `Atmosphere`'s, a pure function of the seed and time.
 * - **Soil water** per cell: rain adds it, evaporation (faster when warm,
 *   windy and dry) takes it, and what a cell cannot hold drains.
 * - **Fruit** falls from trees at a temperature-dependent rate, ripens with
 *   thermal time (Q10), grows yeast once ripe, ferments its sugar (releasing
 *   odour), rots when overripe (faster when wet) and is gone when nearly all its
 *   sugar is.
 * - **Flowers** secrete nectar in daylight up to a cap; its water evaporates in
 *   dry air while its sugar stays; they scent the air while they hold nectar.
 * - **Odour** from fermenting fruit and flowers is carried by the wind,
 *   diffused and lost (`field.ts`).
 *
 * Two things a fly does change it, each an explicit, recorded interaction:
 * feeding takes sugar (`consume`), and a fly feeding on fruit leaves yeast
 * there (`inoculate`), which hastens its fermentation and its odour. Nothing
 * places food near a fly or because a fly needs it.
 *
 * Its random draws (one stream per tree) are made on a fixed schedule, the same
 * number every step whatever happened, so nothing a fly does can shift them.
 * Sugar, soil water and odour are each kept in books that close exactly. All
 * state is plain data and typed arrays, so a life's whole-graph snapshot holds
 * it. Every constant is a model choice (`params.ts`).
 */
import { mulberry32, streamPosition } from "../../lib/noise.js";
import { canonicalJson, sha256 } from "../../rain/sha256.js";
import { Atmosphere, type Climate, type Weather } from "./atmosphere.js";
import { OdourField, type GridSpec } from "./field.js";
import { ECOLOGY_VERSION, P } from "./params.js";

export interface Placed {
  id: string;
  x: number;
  z: number;
}
export interface Rock extends Placed {
  /** Half the side of its square footprint (m), and its height. */
  half: number;
  height: number;
}

/** A tree; its canopy, if it has one, shades the ground and slows evaporation under it. */
export interface Tree extends Placed {
  /** Canopy radius (m), absent for a bare trunk. */
  canopyM?: number;
}

/** A spring: water seeping into one cell at a steady rate. */
export interface Spring extends Placed {
  inflowMmPerS: number;
}

export interface EcosystemSpec {
  seed: number;
  /** Hour of the day at time 0. */
  startHour: number;
  /** Mean direction the wind blows toward (rad). */
  windHeading: number;
  /** The yard is a square of this half-side (m), centred on the origin. */
  half: number;
  trees: Tree[];
  flowers: Placed[];
  rocks: Rock[];
  springs?: Spring[];
  /** A climate unlike the default one (the reference yard has none). */
  climate?: Climate;
}

export interface Fruit {
  id: string;
  tree: string;
  x: number;
  z: number;
  bornS: number;
  sugar0Mg: number;
  sugarMg: number;
  /** 0 when it falls, 1 ripe, past `rotRipeness` rotting. */
  ripeness: number;
  yeast: number;
}

export interface Flower extends Placed {
  waterUl: number;
  sugarMg: number;
}

export interface Interaction {
  /** Ecology time of the step it fell in (s). */
  t: number;
  kind: "consume" | "inoculate" | "drink";
  /** A food item's id, or `cell-<index>` for water drunk from the ground. */
  item: string;
  /** The research subject that did it. */
  who: string;
  /** mg of sugar asked for (consume), seconds of feeding (inoculate) or mm of a cell's water (drink). */
  amount: number;
  /** What the item could give: mg taken, yeast units left, or mm drunk. */
  effect: number;
}

export interface SugarBooks {
  produced: number;
  consumed: number;
  fermented: number;
  rotted: number;
  /** Sugar a body took that no item held: the body's own model of feeding can run past an emptied item. */
  unbacked: number;
}
export interface WaterBooks {
  rained: number;
  /** In from springs. */
  sprung: number;
  evaporated: number;
  drained: number;
  /** Taken by flies drinking from the ground. */
  drunk: number;
}

export interface EcologyHistory {
  /** Fruit that fell, by tree, and fruit that fell outside the yard or onto a rock. */
  fallen: Record<string, number>;
  missed: number;
  gone: number;
}

const r9 = (x: number) => Number(x.toPrecision(9));
/** Surface water below this (mm) counts as evaporated. */
const SOIL_FLOOR_MM = 1e-12;

export class Ecosystem {
  readonly version = ECOLOGY_VERSION;
  readonly spec: Readonly<EcosystemSpec>;
  readonly atmosphere: Atmosphere;
  readonly odour: OdourField;
  /**
   * Water vapour from evaporating ground, carried and lost like odour (its
   * mass in mm of water over a cell): the humid air downwind of wet ground.
   */
  readonly vapour: OdourField;
  /** Surface water per cell (mm). */
  readonly soil: Float64Array;
  readonly fruits: Fruit[] = [];
  readonly flowers: Flower[];
  readonly sugar: SugarBooks = {
    produced: 0,
    consumed: 0,
    fermented: 0,
    rotted: 0,
    unbacked: 0,
  };
  readonly water: WaterBooks = {
    rained: 0,
    sprung: 0,
    evaporated: 0,
    drained: 0,
    drunk: 0,
  };
  /** Evaporation's share in each cell: less under a canopy. */
  private readonly shade: Float64Array;
  private readonly soilFlux: Float64Array;
  private readonly vapourEmit: Float64Array;
  readonly history: EcologyHistory;
  readonly interactions: Interaction[] = [];
  /** One stream per tree, drawn three times every step. */
  private readonly streams: (() => number)[];
  private readonly emit: Float64Array;
  private nextFruit = 0;
  t = 0;
  steps = 0;
  /** The weather of the step being lived. */
  weather: Weather;

  /**
   * Whether odour is transported. Always, in a life; a study of the fruit or
   * soil alone may turn it off (they never read it), and its books stay zero.
   */
  readonly transport: boolean;

  constructor(spec: EcosystemSpec, options: { transport?: boolean } = {}) {
    if (!Number.isInteger(spec.seed))
      throw new Error("an ecosystem's seed is an integer");
    this.spec = Object.freeze(structuredClone(spec));
    this.transport = options.transport ?? true;
    this.atmosphere = new Atmosphere({
      seed: spec.seed,
      startHour: spec.startHour,
      windHeading: spec.windHeading,
      ...(spec.climate ? { climate: spec.climate } : {}),
    });
    const h = P("cellM");
    const n = Math.round((2 * spec.half) / h);
    const grid: GridSpec = { nx: n, nz: n, h, x0: -spec.half, z0: -spec.half };
    const blocked = new Uint8Array(n * n);
    for (let iz = 0; iz < n; iz++)
      for (let ix = 0; ix < n; ix++) {
        const x = grid.x0 + (ix + 0.5) * h,
          z = grid.z0 + (iz + 0.5) * h;
        if (
          spec.rocks.some((r) => Math.abs(x - r.x) < r.half && Math.abs(z - r.z) < r.half)
        )
          blocked[iz * n + ix] = 1;
      }
    this.odour = new OdourField(grid, blocked);
    this.vapour = new OdourField(grid, blocked);
    this.vapourEmit = new Float64Array(n * n);
    this.soil = new Float64Array(n * n);
    this.soilFlux = new Float64Array(n * n);
    this.emit = new Float64Array(n * n);
    this.shade = new Float64Array(n * n).fill(1);
    for (let iz = 0; iz < n; iz++)
      for (let ix = 0; ix < n; ix++) {
        const x = grid.x0 + (ix + 0.5) * h,
          z = grid.z0 + (iz + 0.5) * h;
        if (spec.trees.some((t) => t.canopyM && Math.hypot(x - t.x, z - t.z) < t.canopyM))
          this.shade[iz * n + ix] = P("canopyEvaporationShare");
      }
    for (const sp of spec.springs ?? []) {
      const c = this.odour.cellAt(sp.x, sp.z);
      if (c < 0 || blocked[c])
        throw new Error(`spring ${sp.id} is outside the yard or on a rock`);
      if (!(sp.inflowMmPerS >= 0))
        throw new Error(`spring ${sp.id} flows a non-negative amount`);
    }
    this.flowers = spec.flowers.map((f) => ({ ...f, waterUl: 0, sugarMg: 0 }));
    for (const f of this.flowers)
      if (this.odour.cellAt(f.x, f.z) < 0 || blocked[this.odour.cellAt(f.x, f.z)])
        throw new Error(`flower ${f.id} is outside the yard or on a rock`);
    this.streams = spec.trees.map((_tree, k) =>
      mulberry32((Math.imul(spec.seed >>> 0, 0x85ebca6b) ^ (0x7a3e + 977 * k)) >>> 0),
    );
    this.history = {
      fallen: Object.fromEntries(spec.trees.map((tr) => [tr.id, 0])),
      missed: 0,
      gone: 0,
    };
    this.weather = this.atmosphere.at(0);
  }

  /** Advance one step: weather, soil, fruit, flowers, then odour. */
  step(): void {
    const dt = P("stepS");
    const w = (this.weather = this.atmosphere.at(this.t));
    const q = Atmosphere.q10(w.tempC);
    const soilMax = P("soilWaterMaxMm");
    const field = this.odour;
    const blk = field.blocked;
    // Soil water: rain and springs in, evaporation out (less under a canopy),
    // a slow spread between neighbouring cells, and drainage above capacity.
    const rain = (w.rainMmH * dt) / 3600;
    const wind = Math.hypot(w.wind[0], w.wind[2]);
    const evap = P("evaporationPerS") * q * (1 + wind) * 2 * (1 - w.humidity);
    const soil = this.soil;
    for (let i = 0; i < soil.length; i++) {
      if (blk[i]) continue;
      soil[i] = soil[i]! + rain;
      this.water.rained += rain;
    }
    for (const sp of this.spec.springs ?? []) {
      const c = field.cellAt(sp.x, sp.z);
      const add = sp.inflowMmPerS * dt;
      soil[c] = soil[c]! + add;
      this.water.sprung += add;
    }
    const vEmit = this.vapourEmit;
    for (let i = 0; i < soil.length; i++) {
      if (blk[i]) continue;
      const v = soil[i]!;
      const kept = v * Math.exp(-evap * this.shade[i]! * dt);
      this.water.evaporated += v - kept;
      vEmit[i] = (v - kept) / dt;
      soil[i] = kept;
    }
    this.spreadSoil(dt);
    for (let i = 0; i < soil.length; i++) {
      if (soil[i]! > soilMax) {
        this.water.drained += soil[i]! - soilMax;
        soil[i] = soilMax;
      } else if (soil[i]! > 0 && soil[i]! < SOIL_FLOOR_MM) {
        // A film this thin has evaporated; keeping it would only grow subnormal numbers.
        this.water.evaporated += soil[i]!;
        soil[i] = 0;
      }
    }
    // Fruit falls: three draws per tree, every step, whatever they decide.
    const dropP = (P("fruitDropsPerDay") / P("dayS")) * dt * (w.tempC > 10 ? q : 0);
    this.spec.trees.forEach((tree, k) => {
      const rng = this.streams[k]!;
      const u = rng(),
        a = rng() * 2 * Math.PI,
        r = P("fruitScatterM") * Math.sqrt(rng());
      if (u >= dropP) return;
      const x = tree.x + r * Math.cos(a),
        z = tree.z + r * Math.sin(a);
      const cell = field.cellAt(x, z);
      if (cell < 0 || blk[cell]) {
        this.history.missed++;
        return;
      }
      const sugar = P("fruitSugarMg");
      this.fruits.push({
        id: `fruit-${this.nextFruit++}`,
        tree: tree.id,
        x,
        z,
        bornS: this.t,
        sugar0Mg: sugar,
        sugarMg: sugar,
        ripeness: 0,
        yeast: P("yeastStart"),
      });
      this.sugar.produced += sugar;
      this.history.fallen[tree.id]!++;
    });
    // Fruit lives: ripens, grows yeast, ferments (odour) and rots.
    const emit = this.emit;
    emit.fill(0);
    const ymax = P("yeastMax");
    for (let k = 0; k < this.fruits.length; k++) {
      const f = this.fruits[k]!;
      f.ripeness += (dt / P("ripenS")) * q;
      const ripe = f.ripeness >= 0.5;
      if (ripe)
        f.yeast = Math.min(
          ymax,
          f.yeast + P("yeastGrowthPerS") * q * f.yeast * (1 - f.yeast / ymax) * dt,
        );
      const cell = field.cellAt(f.x, f.z);
      const wet = this.soil[cell]! / soilMax;
      const lf = ripe ? P("fermentPerS") * (f.yeast / ymax) * q : 0;
      const lr = f.ripeness >= P("rotRipeness") ? P("rotPerS") * q * (1 + wet) : 0;
      const l = lf + lr;
      if (l > 0) {
        const lost = f.sugarMg * (1 - Math.exp(-l * dt));
        // Split so that a fruit not yet rotting puts every mg in `fermented`, exactly.
        const rotted = lr > 0 ? (lost * lr) / l : 0;
        const fermented = lost - rotted;
        f.sugarMg -= lost;
        this.sugar.fermented += fermented;
        this.sugar.rotted += rotted;
        emit[cell] = emit[cell]! + (P("fermentOdourUgPerMg") * fermented) / dt;
      }
    }
    // Gone fruit: what is left of its sugar rots away with it.
    for (let k = this.fruits.length - 1; k >= 0; k--) {
      const f = this.fruits[k]!;
      if (f.sugarMg < P("fruitGoneShare") * f.sugar0Mg) {
        this.sugar.rotted += f.sugarMg;
        this.fruits.splice(k, 1);
        this.history.gone++;
      }
    }
    // Flowers: nectar in daylight, water lost to dry air, scent while they hold some.
    const daylight = Math.max(0, w.light - P("nightLight"));
    const keepNectarWater = Math.exp(
      -P("nectarEvaporationPerS") * q * 2 * (1 - w.humidity) * dt,
    );
    for (const fl of this.flowers) {
      fl.waterUl *= keepNectarWater;
      // The nectary secretes until the flower holds its most nectar by volume or
      // by sugar: as water evaporates the sugar stays, and no more is added.
      const room = Math.max(0, P("nectarMaxUl") - fl.waterUl);
      const sugarRoom =
        Math.max(0, P("nectarMaxUl") * P("nectarSugarMgPerUl") - fl.sugarMg) /
        P("nectarSugarMgPerUl");
      const add = Math.min(
        room,
        sugarRoom,
        (P("nectarSecretUlPerH") / 3600) * daylight * dt,
      );
      if (add > 0) {
        fl.waterUl += add;
        const s = add * P("nectarSugarMgPerUl");
        fl.sugarMg += s;
        this.sugar.produced += s;
      }
      if (fl.sugarMg >= P("nectarMinSugarMg")) {
        const cell = field.cellAt(fl.x, fl.z);
        emit[cell] = emit[cell]! + P("nectarOdourUgPerS");
      }
    }
    if (this.transport)
      this.vapour.step(
        dt,
        w.wind[0],
        w.wind[2],
        P("odourDiffusionM2S"),
        P("vapourLossPerS"),
        vEmit,
      );
    if (this.transport)
      field.step(
        dt,
        w.wind[0],
        w.wind[2],
        P("odourDiffusionM2S"),
        P("odourDecayPerS"),
        emit,
      );
    this.t = Number((this.t + dt).toFixed(6));
    this.steps++;
  }

  /** Run `n` steps. */
  run(n: number): void {
    for (let i = 0; i < n; i++) this.step();
  }

  /**
   * Water spreading through the surface layer between neighbouring open cells
   * (explicit diffusion, no flux across the yard's edge or into rock), so a
   * spring wets a patch around it. Moves water only between cells.
   */
  private spreadSoil(dt: number): void {
    const S = this.odour.spec;
    const k = (P("soilSpreadM2S") * dt) / (S.h * S.h);
    if (k === 0) return;
    const soil = this.soil,
      f = this.soilFlux,
      blk = this.odour.blocked;
    f.fill(0);
    for (let iz = 0; iz < S.nz; iz++)
      for (let ix = 0; ix < S.nx; ix++) {
        const i = iz * S.nx + ix;
        if (blk[i]) continue;
        if (ix + 1 < S.nx && !blk[i + 1]) {
          const q = k * (soil[i]! - soil[i + 1]!);
          f[i] = f[i]! - q;
          f[i + 1] = f[i + 1]! + q;
        }
        if (iz + 1 < S.nz && !blk[i + S.nx]) {
          const q = k * (soil[i]! - soil[i + S.nx]!);
          f[i] = f[i]! - q;
          f[i + S.nx] = f[i + S.nx]! + q;
        }
      }
    for (let i = 0; i < soil.length; i++) soil[i] = soil[i]! + f[i]!;
  }

  /** The cell of world point (x, z), or −1. */
  cellAt(x: number, z: number): number {
    return this.odour.cellAt(x, z);
  }

  /** Surface water (mm) at a world point, bilinear between cell centres; 0 outside and in rock. */
  soilWaterAt(x: number, z: number): number {
    const S = this.odour.spec;
    const fx = (x - S.x0) / S.h - 0.5,
      fz = (z - S.z0) / S.h - 0.5;
    const ix = Math.floor(fx),
      iz = Math.floor(fz);
    const ux = fx - ix,
      uz = fz - iz;
    const at = (i: number, k: number) => {
      if (i < 0 || k < 0 || i >= S.nx || k >= S.nz) return 0;
      const c = k * S.nx + i;
      return this.odour.blocked[c] ? 0 : this.soil[c]!;
    };
    return (
      (1 - uz) * ((1 - ux) * at(ix, iz) + ux * at(ix + 1, iz)) +
      uz * ((1 - ux) * at(ix, iz + 1) + ux * at(ix + 1, iz + 1))
    );
  }

  /**
   * A fly drank `mm` of a cell's surface water (as mm over the cell): take up
   * to what the cell holds.
   */
  drink(cell: number, mm: number, who: string): number {
    if (!(mm >= 0) || !Number.isFinite(mm))
      throw new Error("drinking is a finite amount");
    if (cell < 0 || cell >= this.soil.length || this.odour.blocked[cell])
      throw new Error("water is drunk from an open cell of the yard");
    const taken = Math.min(this.soil[cell]!, mm);
    this.soil[cell] = this.soil[cell]! - taken;
    this.water.drunk += taken;
    this.record({
      t: this.t,
      kind: "drink",
      item: `cell-${cell}`,
      who,
      amount: mm,
      effect: taken,
    });
    return taken;
  }

  /** The food item with this id, or null. */
  item(id: string): Fruit | Flower | null {
    return (
      this.fruits.find((f) => f.id === id) ??
      this.flowers.find((f) => f.id === id) ??
      null
    );
  }

  /**
   * A fly fed on `id` and its body took `mg` of sugar: take what the item
   * holds, up to that, and record the rest as unbacked.
   */
  consume(id: string, mg: number, who: string): number {
    if (!(mg >= 0) || !Number.isFinite(mg))
      throw new Error("consumption is a finite amount");
    const it = this.item(id);
    const held = it ? it.sugarMg : 0;
    const taken = Math.min(held, mg);
    if (it && taken > 0) {
      if ("waterUl" in it) it.waterUl *= held > 0 ? 1 - taken / held : 1;
      it.sugarMg = held - taken;
    }
    this.sugar.consumed += taken;
    this.sugar.unbacked += mg - taken;
    this.record({ t: this.t, kind: "consume", item: id, who, amount: mg, effect: taken });
    return taken;
  }

  /** A fly fed on fruit `id` for `seconds`: the yeast it carries is left there. */
  inoculate(id: string, seconds: number, who: string): number {
    if (!(seconds >= 0) || !Number.isFinite(seconds))
      throw new Error("feeding time is finite");
    const f = this.fruits.find((x) => x.id === id);
    let left = 0;
    if (f) {
      const before = f.yeast;
      f.yeast = Math.min(P("yeastMax"), f.yeast + P("inoculumPerFeedS") * seconds);
      left = f.yeast - before;
    }
    this.record({
      t: this.t,
      kind: "inoculate",
      item: id,
      who,
      amount: seconds,
      effect: left,
    });
    return left;
  }

  private record(e: Interaction): void {
    this.interactions.push(e);
  }

  /**
   * Apply recorded interactions, as a life applied them: a replay of an
   * ecosystem from its seed and these records reproduces it exactly.
   */
  apply(e: Interaction): void {
    if (e.kind === "consume") this.consume(e.item, e.amount, e.who);
    else if (e.kind === "inoculate") this.inoculate(e.item, e.amount, e.who);
    else this.drink(Number(e.item.slice("cell-".length)), e.amount, e.who);
  }

  /** Sugar held now, in fruit and nectar. */
  sugarStock(): number {
    let s = 0;
    for (const f of this.fruits) s += f.sugarMg;
    for (const f of this.flowers) s += f.sugarMg;
    return s;
  }
  waterStock(): number {
    let s = 0;
    for (let i = 0; i < this.soil.length; i++) s += this.soil[i]!;
    return s;
  }

  /** A digest of everything the ecology holds, for determinism and independence checks. */
  stateHash(): string {
    return sha256(
      canonicalJson({
        version: this.version,
        t: this.t,
        steps: this.steps,
        nextFruit: this.nextFruit,
        fruits: this.fruits,
        flowers: this.flowers,
        soil: Array.from(this.soil),
        odour: Array.from(this.odour.mass),
        vapour: Array.from(this.vapour.mass),
        books: {
          sugar: this.sugar,
          water: this.water,
          odour: this.odour.books,
          vapour: this.vapour.books,
        },
        history: this.history,
        streams: this.streams.map((s) => streamPosition(s)),
      }),
    );
  }

  /** A short summary for reports (rounded). */
  summary() {
    return {
      t: this.t,
      fruits: this.fruits.length,
      fallen: this.history.fallen,
      gone: this.history.gone,
      missed: this.history.missed,
      sugarStockMg: r9(this.sugarStock()),
      sugar: Object.fromEntries(Object.entries(this.sugar).map(([k, v]) => [k, r9(v)])),
      nectarMg: r9(this.flowers.reduce((a, f) => a + f.sugarMg, 0)),
      soilWaterMm: r9(this.waterStock() / this.soil.length),
      odourUg: r9(this.odour.total()),
      interactions: this.interactions.length,
    };
  }
}

/** The reference yard: 20 m across, three fruit trees, six flowers, two rocks. */
export function referenceYard(seed: number): EcosystemSpec {
  return {
    seed,
    startHour: 6,
    windHeading: Math.PI / 6,
    half: 10,
    trees: [
      { id: "tree-a", x: -5, z: -4 },
      { id: "tree-b", x: 4, z: -6 },
      { id: "tree-c", x: 6, z: 5 },
    ],
    flowers: [
      { id: "flower-1", x: -2, z: 3 },
      { id: "flower-2", x: -2.6, z: 3.4 },
      { id: "flower-3", x: 1.5, z: 1 },
      { id: "flower-4", x: -7, z: 6 },
      { id: "flower-5", x: 7.5, z: -1 },
      { id: "flower-6", x: 0.5, z: -8 },
    ],
    rocks: [
      { id: "rock-1", x: 2, z: -2, half: 0.6, height: 0.4 },
      { id: "rock-2", x: -4, z: 1, half: 0.8, height: 0.5 },
    ],
  };
}
