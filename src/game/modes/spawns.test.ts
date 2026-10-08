import { describe, expect, it } from "vitest";
import { GROUND_OVERLOOK, GROUND_ZONES, type GroundZone } from "@/lib/layout";
import { CollisionWorld } from "../physics/collisionWorld";
import { SpawnSelector, TEAM_HOME_SIDE } from "./spawns";

function nearestZone(x: number, z: number): GroundZone {
  let best = GROUND_ZONES[0]!;
  let bestD = Infinity;
  for (const zone of GROUND_ZONES) {
    const d = Math.hypot(zone.position[0] - x, zone.position[1] - z);
    if (d < bestD) {
      bestD = d;
      best = zone;
    }
  }
  return best;
}

describe("team home sides", () => {
  it("put blue, the player's team, on the side of the opening spawn", () => {
    const [x, z] = GROUND_OVERLOOK.position;
    expect(nearestZone(x, z).side).toBe(TEAM_HOME_SIDE.blue);
    expect(TEAM_HOME_SIDE.red).not.toBe(TEAM_HOME_SIDE.blue);
  });

  it("make the spawn selector favour each team's own half", () => {
    const selector = new SpawnSelector(new CollisionWorld(() => 0));
    for (const team of ["blue", "red"] as const) {
      for (let i = 0; i < 6; i += 1) {
        const spawn = selector.pickSpawn(team, []);
        const zone = nearestZone(spawn.position[0], spawn.position[2]);
        expect(zone.side, `${team} spawn ${i}`).toBe(TEAM_HOME_SIDE[team]);
      }
    }
  });
});
