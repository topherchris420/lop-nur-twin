/**
 * What the research compound eye costs, against what the deployed life costs.
 *
 *   node scripts/run-ts.mjs scripts/vision-cost.ts [--out FILE]
 *
 * Times research flies only, each built from a seed: in the battery arena
 * (the deployed configuration with and without the eye) and in a Bethesda
 * development city (seed 1201, never the reporting city 393977), the city
 * stepped alone, with the fly, and with the fly seeing through the eye. Also
 * times one image alone and at coarser lattices' ray counts. Machine-specific:
 * a record of this machine, never a result to reproduce. Reads and writes no
 * store, checkpoint or individual.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { arch, cpus, platform, totalmem } from "node:os";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { refuseProductionHost } from "../src/bethesda/firstContact/originals.js";
import { CityFly } from "../src/bethesda/fly/cityFly.js";
import { DigitalFly } from "../src/bethesda/fly/fly.js";
import { PARAMS } from "../src/bethesda/fly/params.js";
import { OrganismAdapter } from "../src/bethesda/life/organism.js";
import { CitySimulation } from "../src/bethesda/simulation.js";
import { EyeAdapter } from "../src/bethesda/vision/adapter.js";
import { LATTICE } from "../src/bethesda/vision/lattice.js";
import { Renderer } from "../src/bethesda/vision/scene.js";
import {
  batteryArena,
  groundTruth,
  segments,
  StimulusWorld,
  type StimulusSpec,
} from "../src/bethesda/vision/stimuli.js";

const args = process.argv.slice(2);
const at = args.indexOf("--out");
const out = at >= 0 ? args[at + 1]! : "docs/benchmarks/fly-vision/cost.json";
refuseProductionHost(resolve(out), existsSync);

const SIM_S = 10;
/** The city run is longer, so that it averages over what a fly does. */
const CITY_S = 300;
const r4 = (x: number) => Number(x.toPrecision(4));

function arena(withEye: boolean) {
  const spec: StimulusSpec = {
    kind: "approach",
    radius: 0.05,
    contrast: -0.8,
    azimuth_deg: 30,
    elevation_deg: 20,
    speed: 0.5,
    distance: 4,
  };
  const P: [number, number, number] = [0, 0.01, 0];
  const segs = segments(spec, P, 0, 1);
  const world = new StimulusWorld(
    batteryArena(0.7),
    { spec, segments: segs, truth: groundTruth(spec, segs, P) },
    5,
  );
  const fly = new DigitalFly({
    seed: 21,
    world,
    start: { p: P, yaw: 0 },
    config: { takeoffHz: 0, walkStartHz: 0, groomHz: 0 },
    adapter: (rng, streams) => {
      const o = new OrganismAdapter(rng, streams, 21);
      return withEye
        ? new EyeAdapter(o, {
            subject: "research-vision-cost",
            seed: 1,
            scene: world,
            mode: "drive",
            readout: "lplc2",
            gain: 1.9,
          })
        : o;
    },
  });
  const t0 = performance.now();
  while (fly.state.t < SIM_S) fly.advance(0.1);
  return (performance.now() - t0) / 1000 / SIM_S;
}

const CITY = {
  seed: 1201,
  pedestrians: 30,
  vehicles: 10,
  buses: 2,
  statisticalPopulation: 120,
};

function city(mode: "alone" | "fly" | "eye") {
  const sim = new CitySimulation(CITY);
  let fly: CityFly | null = null;
  if (mode !== "alone") {
    let world: CityFly["world"] | null = null;
    fly = new CityFly(sim, {
      researchAdapter: (rng, streams) => {
        const seed = 31;
        const o = new OrganismAdapter(rng, streams, seed);
        if (mode === "fly") return o;
        return new EyeAdapter(o, {
          subject: "research-vision-cost-city",
          seed: 2,
          // The city world is built before the fly; it is read through this getter.
          scene: {
            textureSeed: 1201,
            get world() {
              return world!;
            },
          },
          mode: "drive",
          readout: "lplc2",
          gain: 1.9,
        });
      },
    });
    world = fly.world;
  }
  const ticks = Math.round(CITY_S / 0.1);
  const t0 = performance.now();
  const modes = new Map<string, number>();
  for (let k = 0; k < ticks; k++) {
    sim.step();
    fly?.tick();
    if (fly) modes.set(fly.fly.state.mode, (modes.get(fly.fly.state.mode) ?? 0) + 1);
  }
  if (fly?.failed) throw new Error(`the research fly failed: ${fly.failed}`);
  const eye = fly?.fly.adapter instanceof EyeAdapter ? fly.fly.adapter : null;
  return {
    wallPerSimS: (performance.now() - t0) / 1000 / CITY_S,
    fly,
    modes: Object.fromEntries([...modes].sort(([a], [b]) => (a < b ? -1 : 1))),
    casts: eye ? eye.renderStats() : null,
  };
}

function imageCost(fly: CityFly) {
  const r = new Renderer(
    { world: fly.world, textureSeed: 1201 },
    LATTICE,
    PARAMS.visualRangeM.value,
  );
  const img = new Float64Array(LATTICE.n);
  const s = fly.fly.state;
  const n = 200;
  const t0 = performance.now();
  for (let k = 0; k < n; k++) r.render(s.p, s.yaw + k * 0.01, s.t, img, null);
  return { msPerImage: (performance.now() - t0) / n, rays: r.rays };
}

// Warm up the JIT on each path once, then measure.
arena(true);
const arenaBare = arena(false),
  arenaEye = arena(true);
city("eye");
const cityAlone = city("alone").wallPerSimS;
const cityFly = city("fly").wallPerSimS;
const cityEye = city("eye");
const image = imageCost(cityEye.fly!);
const imagesPerSimS = 1000 / PARAMS.sensePeriodMs.value;
const record = {
  schema: "vision-cost/v1",
  note: "Wall seconds per simulated second on this machine (one thread). Not the deployed VM; not reproduced byte for byte.",
  machine: {
    platform: `${platform()} ${arch()}`,
    node: process.version,
    cpus: cpus().length,
    cpu: cpus()[0]?.model ?? "unknown",
    memory_gb: Math.round(totalmem() / 1e9),
  },
  simulated_s: SIM_S,
  ommatidia: LATTICE.n,
  images_per_simulated_s: imagesPerSimS,
  arena: {
    deployed_fly: r4(arenaBare),
    deployed_fly_with_eye: r4(arenaEye),
    eye_share: r4((arenaEye - arenaBare) / arenaEye),
  },
  city_1201: {
    simulated_s: CITY_S,
    fly_modes_ticks: cityEye.modes,
    images: cityEye.casts,
    city_alone: r4(cityAlone),
    city_with_fly: r4(cityFly),
    city_with_fly_and_eye: r4(cityEye.wallPerSimS),
    one_image_ms: r4(image.msPerImage),
    rays_per_image: image.rays,
    eye_at_sense_rate_core_share: r4((image.msPerImage * imagesPerSimS) / 1000),
  },
  coarser_lattices_estimate:
    "Rays scale with ommatidia: twice the spacing is about a quarter of the rays (and of the image time); 50 Hz instead of 100 Hz halves it again. Estimates from this image time, not measured runs.",
};
mkdirSync(dirname(resolve(out)), { recursive: true });
writeFileSync(resolve(out), JSON.stringify(record, null, 2) + "\n");
console.log(JSON.stringify(record, null, 2));
