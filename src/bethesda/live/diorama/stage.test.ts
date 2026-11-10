import { describe, expect, it } from "vitest";
import { resolveParams } from "../../fly/params";
import { MODES } from "../../fly/neural";
import { buildings } from "../../model";
import { groundAt } from "../../terrain";
import {
  advanceGait,
  buildingInTheWay,
  cameraDistance,
  clampZoom,
  LENS,
  matchAgents,
  MODEL_SCALE,
  postureOf,
  PUPPET_MAX_CITY_M,
  PUPPET_MIN_PX,
  puppetCityLength,
  ZOOM,
} from "./stage";

describe("the lens on the clay model", () => {
  it("stands where one city metre at the fly spans the zoom's pixels", () => {
    for (const zoom of [ZOOM.min, ZOOM.start, ZOOM.max]) {
      const height = 900;
      const d = cameraDistance(zoom, height);
      const visibleModelM = 2 * d * Math.tan((LENS.fovDeg * Math.PI) / 360);
      expect(height / (visibleModelM / MODEL_SCALE)).toBeCloseTo(zoom, 9);
    }
  });

  it("never comes closer than its near plane, at any zoom or screen", () => {
    expect(cameraDistance(ZOOM.max, 320)).toBeGreaterThan(LENS.near * 2);
  });

  it("holds a zoom inside its range, and refuses what is not a number", () => {
    expect(clampZoom(0)).toBe(ZOOM.min);
    expect(clampZoom(1e9)).toBe(ZOOM.max);
    expect(clampZoom(Number.NaN)).toBe(ZOOM.start);
    expect(clampZoom(Infinity)).toBe(ZOOM.start);
  });
});

describe("the puppet's size", () => {
  it("is long enough to see, and never longer than a bus", () => {
    for (let zoom = ZOOM.min; zoom <= ZOOM.max; zoom *= ZOOM.step) {
      const length = puppetCityLength(zoom);
      expect(length).toBeLessThanOrEqual(PUPPET_MAX_CITY_M);
      // On screen it is at least the minimum wherever the cap does not bind.
      if (length < PUPPET_MAX_CITY_M) expect(length * zoom).toBeCloseTo(PUPPET_MIN_PX, 9);
    }
  });
});

describe("posing the puppet from a reported mode", () => {
  it("stands, folded, for the perched modes", () => {
    for (const mode of ["rest", "walk", "feed", "groom/eyes"]) {
      const p = postureOf(mode);
      expect(p).toMatchObject({ legs: 1, wingsOpen: 0, beating: false, airborne: false });
    }
    expect(postureOf("feed").proboscis).toBe(1);
    expect(postureOf("walk").mode).toBe("walk");
  });

  it("flies with beating wings in the airborne modes", () => {
    for (const mode of ["flight/cruise", "flight/hover", "escape", "land/approach"])
      expect(postureOf(mode)).toMatchObject({ beating: true, airborne: true });
    expect(postureOf("flight/cruise").legs).toBe(0);
    expect(postureOf("land/legs extended").legs).toBe(1);
  });

  it("is still on its feet while it prepares to take off", () => {
    expect(postureOf("takeoff/prepare")).toMatchObject({ airborne: false, wingsOpen: 1 });
    expect(postureOf("takeoff").airborne).toBe(true);
  });

  it("grooms the site it reports, and the front legs when it reports none it knows", () => {
    expect(postureOf("groom/hind legs").groom).toBe("hind legs");
    expect(postureOf("groom/abdomen").groom).toBe("abdomen");
    expect(postureOf("groom/elbows").groom).toBe("front legs");
    expect(postureOf("groom").groom).toBe("front legs");
  });

  it("answers every mode the fly has, and stands still for one it does not know", () => {
    for (const mode of MODES) expect(postureOf(mode).mode).toBe(mode);
    expect(postureOf("teleport/somewhere")).toEqual(postureOf("rest"));
    expect(postureOf("")).toEqual(postureOf("rest"));
  });
});

describe("the walking puppet's gait clock", () => {
  const P = resolveParams();
  const gait = {
    stanceLegsAt1: P.stanceLegsAt1,
    stanceLegsAt4: P.stanceLegsAt4,
    swingMs: P.swingMs,
    stepPeriodFloorMs: P.stepPeriodFloorMs,
    walkSpeedMinCmS: P.walkSpeedMinCmS,
    walkSpeedMaxCmS: P.walkSpeedMaxCmS,
  };

  it("runs while it walks and holds while it stands", () => {
    expect(advanceGait(0.25, 0, 0.1, gait)).toBe(0.25);
    expect(advanceGait(0.25, 2, 0, gait)).toBe(0.25);
    const stepped = advanceGait(0.25, 2, 0.02, gait);
    expect(stepped).toBeGreaterThan(0.25);
    expect(stepped).toBeLessThan(1);
  });

  it("stays a phase, however long the frame", () => {
    const c = advanceGait(0.9, 3, 5, gait);
    expect(c).toBeGreaterThanOrEqual(0);
    expect(c).toBeLessThan(1);
  });
});

describe("following a figure from one observation to the next", () => {
  const walker = (x: number, z: number) => ({ kind: "pedestrian", x, z });
  const bus = (x: number, z: number) => ({ kind: "bus", x, z });

  it("pairs each figure with the nearest of its kind, once", () => {
    const from = matchAgents(
      [walker(0, 0), walker(10, 0)],
      [walker(10.5, 0), walker(1, 0)],
    );
    expect(from).toEqual([
      { x: 10, z: 0 },
      { x: 0, z: 0 },
    ]);
  });

  it("does not turn a walker into a bus, or carry one across the street in a second", () => {
    expect(matchAgents([walker(0, 0)], [bus(0.5, 0)])).toEqual([null]);
    expect(matchAgents([walker(0, 0)], [walker(9, 0)])).toEqual([null]);
    expect(matchAgents([bus(0, 0)], [bus(12, 0)])).toEqual([{ x: 0, z: 0 }]);
  });

  it("gives a newcomer no past", () => {
    expect(matchAgents([], [walker(3, 3)])).toEqual([null]);
    expect(matchAgents([walker(0, 0)], [walker(0.5, 0), walker(0.6, 0)])).toEqual([
      { x: 0, z: 0 },
      null,
    ]);
  });
});

describe("whether a building hides the fly from the lens", () => {
  // A building tall enough to hide the street behind it from a low lens.
  const tall = buildings.reduce((a, b) => (b.height > a.height ? b : a));
  const roof = groundAt(tall.center) + tall.height;

  it("hides a point inside a building from every angle", () => {
    const inside = { x: tall.center.x, y: groundAt(tall.center) + 1, z: tall.center.z };
    for (let k = 0; k < 8; k++)
      expect(buildingInTheWay(inside, (k * Math.PI) / 4, 1.2, 400)).toBe(true);
  });

  it("shows a point on the roof from above", () => {
    const onRoof = { x: tall.center.x, y: roof + 0.5, z: tall.center.z };
    expect(buildingInTheWay(onRoof, 0, 1.36, 400)).toBe(false);
  });

  it("shows a point high above everything from any angle", () => {
    const above = { x: tall.center.x, y: roof + 200, z: tall.center.z };
    for (let k = 0; k < 8; k++)
      expect(buildingInTheWay(above, (k * Math.PI) / 4, 0.3, 400)).toBe(false);
  });
});
