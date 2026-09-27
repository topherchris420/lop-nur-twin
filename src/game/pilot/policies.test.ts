import { describe, expect, it } from "vitest";
import { SCRIPT_POLICIES, ScriptedProvider, isLegalFrame } from "./policies";
import { makeObservation } from "./testing/fixtures";
import { legalActionsFor } from "./observation";
import { mulberry32 } from "@/lib/noise";

describe("scripted reference policies", () => {
  it("the marksman holds still and engages the enemy nearest the crosshair", () => {
    const obs = makeObservation({ control: "precision" });
    const frame = new ScriptedProvider("marksman").pick(obs);
    expect(frame.move).toBe("HOLD");
    expect(frame.target).toBe("TARGET_0");
    expect(frame.weapon).toBe("ADS_FIRE");
    // 27 m: close enough that the chest is the aim point.
    expect(frame.aim).toBe("UPPER_CHEST");
  });

  it("the marksman takes the head at range, and keeps its tracked target", () => {
    const base = makeObservation({ control: "precision" }).perception.visibleEnemies[0]!;
    const obs = makeObservation({
      control: "precision",
      perception: {
        visibleEnemies: [
          { ...base, distanceM: 30 },
          { ...base, distanceM: 110, tracked: true },
        ],
      },
    });
    const frame = new ScriptedProvider("marksman").pick(obs);
    expect(frame.target).toBe("TARGET_1");
    expect(frame.aim).toBe("HEAD");
  });

  it("turns toward what it heard when nothing is in view", () => {
    const obs = makeObservation({
      control: "precision",
      perception: {
        visibleEnemies: [],
        damage: null,
        contacts: [{ source: "gunfire", bearingDeg: -40, distanceM: 60, ageS: 0.4 }],
      },
    });
    const frame = new ScriptedProvider("marksman").pick(obs);
    expect(frame.turn).toBe("TURN_LEFT_LARGE");
    expect(frame.target).toBe("NONE");
  });

  it("under direct control, aims with the rotations every brain has", () => {
    const obs = makeObservation({ control: "direct" });
    const frame = new ScriptedProvider("marksman").pick(obs);
    // The fixture enemy sits 9.4° right and 0.6° low of the crosshair.
    expect(frame.turn).toBe("TURN_RIGHT_MEDIUM");
    expect(frame.tilt).toBe("LOOK_DOWN_FINE");
    expect(frame.target).toBe("NONE");
  });

  it("only ever chooses legal options, over many varied states", () => {
    const rand = mulberry32(7);
    for (const policy of SCRIPT_POLICIES) {
      const provider = new ScriptedProvider(policy);
      for (let i = 0; i < 400; i += 1) {
        const enemies = Math.floor(rand() * 5);
        const base = makeObservation().perception.visibleEnemies[0]!;
        const obs = makeObservation({
          control: rand() < 0.5 ? "precision" : "direct",
          player: {
            stance: (["stand", "crouch", "prone"] as const)[Math.floor(rand() * 3)]!,
            grounded: rand() < 0.9,
            pitchDeg: (rand() - 0.5) * 170,
            health: rand() * 100,
          },
          weapon: {
            ammo: Math.floor(rand() * 31),
            reloading: rand() < 0.2,
            canFire: rand() < 0.9,
            reserve: rand() < 0.2 ? 0 : 90,
          },
          perception: {
            visibleEnemies: Array.from({ length: enemies }, () => ({
              ...base,
              bearingDeg: (rand() - 0.5) * 80,
              distanceM: rand() * 160,
              headVisible: rand() < 0.7,
              chestVisible: rand() < 0.7,
            })).map((e) =>
              e.headVisible || e.chestVisible ? e : { ...e, chestVisible: true },
            ),
            damage: rand() < 0.3 ? { ageS: 0.2, bearingDeg: (rand() - 0.5) * 300 } : null,
          },
        });
        // The fixture computed `legal` from its own defaults; recompute it
        // for the state actually built.
        obs.legal = legalActionsFor(obs.player, obs.weapon, {
          control: obs.control,
          visibleEnemies: obs.perception.visibleEnemies.length,
        });
        expect(isLegalFrame(provider.pick(obs), obs.legal)).toBe(true);
      }
    }
  });

  it("is deterministic: the same observations give the same frames", () => {
    const run = (): string[] => {
      const provider = new ScriptedProvider("skirmisher");
      return Array.from({ length: 30 }, (_, i) =>
        JSON.stringify(
          provider.pick(
            makeObservation({
              control: "precision",
              perception: i % 3 === 0 ? { visibleEnemies: [] } : {},
            }),
          ),
        ),
      );
    };
    expect(run()).toEqual(run());
  });
});
