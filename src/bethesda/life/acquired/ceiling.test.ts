import { describe, expect, it } from "vitest";
import { resolveParams } from "../../fly/params.js";
import { OrganismAdapter } from "../organism.js";
import {
  ceilingLayout,
  FixedSearchAdapter,
  foodAround,
  FOOD_WORLDS,
  SEARCH_ARMS,
} from "./ceiling.js";
import { YardSubject } from "./yard.js";

const P = resolveParams({});

function trajectory(
  adapter: ConstructorParameters<typeof YardSubject>[0]["adapter"],
  seconds: number,
) {
  const layout = ceilingLayout(3);
  const sub = new YardSubject({ seed: 3, layout, adapter });
  const out: number[] = [];
  for (let t = 0; t < seconds; t += 30) {
    sub.step(300);
    out.push(sub.fly.state.p[0], sub.fly.state.p[2], sub.fly.state.reserve);
  }
  return out;
}

describe("the search ceiling test", () => {
  it("names the fly's real default", () => {
    expect(SEARCH_ARMS.default.exploreDistanceM).toBe(P.exploreDistanceM);
    expect(SEARCH_ARMS.default.exploreShare).toBe(P.exploreShare);
  });

  it("leaves the fly as it was when the setting is the default", () => {
    const plain = trajectory((r, s, seed) => new OrganismAdapter(r, s, seed), 900);
    const same = trajectory(
      (r, s, seed) => new FixedSearchAdapter(r, s, seed, SEARCH_ARMS.default),
      900,
    );
    expect(same).toEqual(plain);
  }, 120_000);

  it("reaches the controller when the setting differs", () => {
    const plain = trajectory(
      (r, s, seed) => new FixedSearchAdapter(r, s, seed, SEARCH_ARMS.default),
      3600,
    );
    const roam = trajectory(
      (r, s, seed) => new FixedSearchAdapter(r, s, seed, SEARCH_ARMS.roam),
      3600,
    );
    expect(roam).not.toEqual(plain);
  }, 120_000);

  it("puts food at the world's distance from the fly, inside the yard", () => {
    const layout = ceilingLayout(3);
    for (const world of ["near", "far"] as const) {
      const { minM, maxM, patches } = FOOD_WORLDS[world];
      const food = foodAround(layout, [100, -50], FOOD_WORLDS[world], 9);
      expect(food).toHaveLength(patches);
      for (const f of food) {
        const d = Math.hypot(f.center[0] - 100, f.center[2] + 50);
        expect(d).toBeGreaterThanOrEqual(minM);
        expect(d).toBeLessThanOrEqual(maxM);
      }
    }
    // Against an edge it still finds room, on the side the yard allows.
    const edge = foodAround(layout, [890, 890], FOOD_WORLDS.near, 9);
    expect(edge.length).toBeGreaterThan(0);
    for (const f of edge) {
      expect(Math.abs(f.center[0])).toBeLessThan(layout.half);
      expect(Math.abs(f.center[2])).toBeLessThan(layout.half);
    }
  });
});
