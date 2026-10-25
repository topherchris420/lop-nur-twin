import { describe, expect, it } from "vitest";
import { CitySimulation, type Config } from "../simulation.js";
import { HeadlessBethesdaLife, HEADLESS_LIFE_SCHEMA } from "./headless.js";

const TEST_CITY: Config = {
  seed: 393977,
  pedestrians: 12,
  vehicles: 2,
  buses: 1,
  statisticalPopulation: 30,
};

describe("headless Bethesda life foundation", () => {
  it("advances the city and fly without any viewer", () => {
    const life = new HeadlessBethesdaLife(TEST_CITY);
    life.advanceTicks(20);
    const status = life.status();
    expect(status.schema).toBe(HEADLESS_LIFE_SCHEMA);
    expect(status.tick).toBe(20);
    expect(status.simulatedSeconds).toBeCloseTo(2);
    expect(life.cityFly.fly.state.t).toBeCloseTo(2);
    expect(status.fly.position).toHaveLength(3);
  });

  it("reproduces exactly when ticks are grouped differently", () => {
    const a = new HeadlessBethesdaLife(TEST_CITY);
    const b = new HeadlessBethesdaLife(TEST_CITY);
    a.advanceTicks(20);
    b.advanceTicks(7);
    b.advanceTicks(13);
    expect(a.status()).toEqual(b.status());
  });

  it("keeps the city independent of the fly", () => {
    const city = new CitySimulation(TEST_CITY);
    const life = new HeadlessBethesdaLife(TEST_CITY);
    for (let i = 0; i < 10; i++) city.step();
    life.advanceTicks(10);
    expect(life.city.stateHash()).toEqual(city.stateHash());
  });

  it("rejects invalid or paused clock steps", () => {
    const life = new HeadlessBethesdaLife(TEST_CITY);
    expect(() => life.advanceTicks(-1)).toThrow();
    expect(() => life.advanceTicks(Number.POSITIVE_INFINITY)).toThrow();
    expect(() => life.advanceTicks(10_001)).toThrow();
    life.city.paused = true;
    expect(() => life.advanceTicks(1)).toThrow(/paused/);
  });
});
