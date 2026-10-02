import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import grid from "./data/terrain.json" with { type: "json" };
import { local, bounds } from "./model";
import {
  elevationAt,
  groundAt,
  TERRAIN_SOURCE,
  TERRAIN_VERSION,
  VERTICAL_OFFSET,
} from "./terrain";
import { cityFoot, type FootTarget } from "./locomotion";
import { CitySimulation } from "./simulation";
import { TRANSIT_VERSION } from "./streetscape";

describe("real Bethesda bare-earth elevation", () => {
  const dx = (grid.bbox[2]! - grid.bbox[0]!) / grid.width,
    dy = (grid.bbox[3]! - grid.bbox[1]!) / grid.height;
  const centre = (column: number, row: number) =>
    local([grid.bbox[0]! + (column + 0.5) * dx, grid.bbox[3]! - (row + 0.5) * dy]);
  it("keeps the acquired crop checksum and permission", () => {
    expect(
      createHash("sha256")
        .update(readFileSync(new URL("./data/terrain.json", import.meta.url)))
        .digest("hex"),
    ).toBe(TERRAIN_VERSION);
    expect(TERRAIN_SOURCE.licenseText).toContain("You can copy, modify, distribute");
  });
  it("samples pixel centres north-to-south and converts to the rendering datum", () => {
    for (const [x, z] of [
      [0, 0],
      [32, 32],
      [64, 64],
    ]) {
      const p = centre(x!, z!);
      expect(elevationAt(p)).toBeCloseTo(grid.elevations[z! * 65 + x!]!, 6);
      expect(groundAt(p) + VERTICAL_OFFSET).toBeCloseTo(elevationAt(p), 8);
    }
    expect(elevationAt(bounds.min)).toBeCloseTo(grid.elevations[0]!, 6);
    expect(elevationAt(bounds.max)).toBeCloseTo(grid.elevations.at(-1)!, 6);
  });
  it("interpolates between samples without transposing or wrapping", () => {
    const p = local([grid.bbox[0]! + 11 * dx, grid.bbox[3]! - 21 * dy]);
    const expected =
      [20 * 65 + 10, 20 * 65 + 11, 21 * 65 + 10, 21 * 65 + 11].reduce(
        (sum, i) => sum + grid.elevations[i]!,
        0,
      ) / 4;
    expect(elevationAt(p)).toBeCloseTo(expected, 6);
    expect(elevationAt({ x: bounds.min.x - 10, z: bounds.min.z - 10 })).toBe(
      grid.elevations[0],
    );
  });
});
describe("civilian presentation", () => {
  it("keeps a planted foot fixed in world space during forward travel", () => {
    const a: FootTarget = { y: 0, z: 0, planted: false },
      b = { ...a };
    let plantedChecks = 0;
    for (const side of [-1, 1])
      for (let travel = 0; travel < 3; travel += 0.001) {
        cityFoot(travel, side, true, a);
        cityFoot(travel + 0.001, side, true, b);
        if (a.planted && b.planted) {
          expect(travel + a.z).toBeCloseTo(travel + 0.001 + b.z, 8);
          expect(a.y).toBe(0.08);
          plantedChecks++;
        }
        expect(a.y).toBeGreaterThanOrEqual(0.08);
        expect(a.y).toBeLessThanOrEqual(0.22 + 1e-12);
      }
    expect(plantedChecks).toBeGreaterThan(3000);
    cityFoot(0.9, 1, false, a);
    expect(a).toEqual({ y: 0.08, z: 0, planted: true });
  });
  it("records elevation and transit provenance and rejects mismatches", () => {
    const sim = new CitySimulation({
      seed: 393977,
      pedestrians: 3,
      vehicles: 1,
      buses: 1,
      statisticalPopulation: 10,
    });
    for (let i = 0; i < 15; i++) sim.step();
    const trace = sim.export();
    expect(trace.terrainVersion).toBe(TERRAIN_VERSION);
    expect(trace.transitVersion).toBe(TRANSIT_VERSION);
    expect(CitySimulation.replay(trace).stateHash()).toBe(trace.finalHash);
    expect(() => CitySimulation.replay({ ...trace, terrainVersion: "wrong" })).toThrow();
    expect(() => CitySimulation.replay({ ...trace, transitVersion: "wrong" })).toThrow();
  });
});
