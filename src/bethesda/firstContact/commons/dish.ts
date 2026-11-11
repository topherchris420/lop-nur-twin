/**
 * The encounter dish: the controlled place where research subjects meet
 * often enough to measure what contact does to them.
 *
 * Ramdya et al. 2015 (doi:10.1038/nature14024) measured touch responses of
 * single flies "in a small arena (3 cm × 3 cm)", and of four flies in one of
 * 1 cm × 5 cm. This dish has their single-fly arena's floor, a lid (the
 * height is ours: the paper's arenas are planar, the height is not stated in
 * the methods), and one drop of food at its centre so that hungry flies come
 * together at it as flies do at food. Lit evenly from above.
 */
import type { V3 } from "../../fly/units.js";
import { PrimitiveWorld, type Box, type WorldInputs } from "../../fly/world.js";

export const DISH_SCHEMA = "first-contact-encounter-dish/v1" as const;
/** Floor (m): Ramdya et al.'s single-fly touch arena. */
export const DISH_SIDE_M = 0.03;
/** Lid height (m): a model choice, low enough that flight is short hops. */
export const DISH_LID_M = 0.006;
/** The food drop's radius (m): a model choice. */
export const DISH_FOOD_RADIUS_M = 0.003;

export const DISH_INPUTS: WorldInputs = {
  supported: [
    "floor, four walls and a lid",
    "one drop of food at the centre",
    "even light",
  ],
  proxies: ["odour: the fly world's still-air proxy, from the drop"],
  unsupported: ["wind", "temperature", "humidity", "water to drink"],
};

export const DISH_APPROXIMATIONS = Object.freeze([
  "the dish's lid height (6 mm) and its food drop are ours; Ramdya et al.'s 3 cm × 3 cm arena had no food",
  "walls and lid are perfectly smooth solids; real arenas' walls are often coated so flies cannot climb them, and digital flies do not climb walls",
]);

const WALL = 0.005;

export function encounterDish(id = "encounter-dish"): PrimitiveWorld {
  const h = DISH_SIDE_M / 2,
    y = DISH_LID_M;
  const wall = (wid: string, center: V3, half: V3): Box => ({
    kind: "wall",
    id: wid,
    center,
    half,
    angle: 0,
  });
  return new PrimitiveWorld({
    id,
    home: {
      center: [0, 0, 0],
      radius: h,
      ceiling: y,
      bounds: { min: { x: -h, z: -h }, max: { x: h, z: h } },
    },
    inputs: DISH_INPUTS,
    ground: () => 0,
    groundMax: 0,
    groundKind: "floor",
    boxes: [
      wall("wall-n", [0, y / 2, -h - WALL / 2], [h + WALL, y / 2, WALL / 2]),
      wall("wall-s", [0, y / 2, h + WALL / 2], [h + WALL, y / 2, WALL / 2]),
      wall("wall-w", [-h - WALL / 2, y / 2, 0], [WALL / 2, y / 2, h + WALL]),
      wall("wall-e", [h + WALL / 2, y / 2, 0], [WALL / 2, y / 2, h + WALL]),
    ],
    ceiling: y,
    lights: [{ at: [0, y, 0], intensity: 1 }],
    ambient: 1,
    food: [
      {
        id: "sugar-drop",
        kind: "a drop of sugar food",
        center: [0, 0, 0],
        surface: "floor",
        radius: DISH_FOOD_RADIUS_M,
      },
    ],
  });
}
