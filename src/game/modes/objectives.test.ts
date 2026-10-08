import { describe, expect, it } from "vitest";
import { createActor, type Actor } from "../core/gameState";
import type { Team } from "../core/types";
import {
  ObjectiveManager,
  decayCapture,
  stepCapture,
  type DominationZone,
} from "./objectives";

function zone(): DominationZone {
  return {
    id: "A",
    label: "A",
    center: [0, 0],
    radius: 18,
    owner: null,
    progress: 0,
    capturingTeam: null,
    contested: false,
  };
}

/** Step a capture in tenths of a second. */
function run(z: DominationZone, team: Team, seconds: number): void {
  const steps = Math.round(seconds * 10);
  for (let i = 0; i < steps; i += 1) stepCapture(z, team, 1, 0.1);
}

describe("domination capture", () => {
  it("does not let a second team inherit the first team's progress", () => {
    const z = zone();
    run(z, "blue", 6);
    expect(z.capturingTeam).toBe("blue");
    expect(z.progress).toBeCloseTo(0.6, 5);

    // Red must first drain blue's 0.6 before building its own.
    run(z, "red", 3);
    expect(z.capturingTeam).toBe("blue");
    expect(z.progress).toBeCloseTo(0.3, 5);
    run(z, "red", 3.1);
    expect(z.capturingTeam).toBe("red");
    expect(z.owner).toBeNull();

    // Red then needs a full capture of its own.
    run(z, "red", 9.5);
    expect(z.owner).toBeNull();
    run(z, "red", 0.6);
    expect(z.owner).toBe("red");
    expect(z.progress).toBe(1);
  });

  it("decays an abandoned neutral capture back to nobody's", () => {
    const z = zone();
    run(z, "blue", 4);
    for (let i = 0; i < 300; i += 1) decayCapture(z, 0.1);
    expect(z.progress).toBe(0);
    expect(z.capturingTeam).toBeNull();
  });

  it("restores an abandoned, half-neutralised owned zone", () => {
    const z = zone();
    run(z, "blue", 10.1);
    expect(z.owner).toBe("blue");
    run(z, "red", 4);
    expect(z.progress).toBeLessThan(1);
    for (let i = 0; i < 300; i += 1) decayCapture(z, 0.1);
    expect(z.owner).toBe("blue");
    expect(z.progress).toBe(1);
  });

  it("decays progress in the manager when nobody stands on the zone", () => {
    const manager = new ObjectiveManager("domination");
    const a = manager.getZones()[0] as DominationZone;
    const actor: Actor = createActor(301, "blue-1", "blue");
    actor.position.set(a.center[0], 0, a.center[1]);
    for (let i = 0; i < 40; i += 1) manager.update(0.1, [actor]);
    expect(a.progress).toBeCloseTo(0.4, 5);
    actor.alive = false;
    for (let i = 0; i < 40; i += 1) manager.update(0.1, [actor]);
    expect(a.progress).toBeCloseTo(0.2, 5);
    expect(manager.getHudState().zones[0]!.capturingTeam).toBe("blue");
  });
});
