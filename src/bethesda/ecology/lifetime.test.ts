/**
 * Long lives: a life checkpointed at a day's end and resumed is the life that
 * was never interrupted, day summaries and state hashes alike; and the
 * place-memory lesion leaves the fly no food place to return to.
 * "Days" here are 5 simulated minutes, so the test is quick.
 */
import { describe, expect, it } from "vitest";
import { referenceYard } from "./ecosystem";
import { spinUp } from "./life";
import { runLifetime, type LifetimeCheckpoint } from "./lifetime";

const spec = referenceYard(42);
const genesis = {
  subject: "research-lifetime-test",
  seed: 9,
  start: [7.3, -1] as [number, number],
  yaw: 0,
  startReserve: 0.5,
};

describe("long lives", () => {
  it(
    "resume from a day-end checkpoint exactly as if never stopped",
    { timeout: 300_000 },
    () => {
      const world = spinUp(spec, 3_600);
      const whole = runLifetime(spec, world, genesis, "intact", 2, { daySeconds: 300 });
      let saved: LifetimeCheckpoint | null = null;
      runLifetime(spec, world, genesis, "intact", 1, {
        daySeconds: 300,
        save: (c) => (saved = JSON.parse(JSON.stringify(c)) as LifetimeCheckpoint),
      });
      expect(saved).not.toBeNull();
      const resumed = runLifetime(spec, world, genesis, "intact", 2, {
        daySeconds: 300,
        resume: saved,
      });
      expect(resumed.days).toEqual(whole.days);
      expect(resumed.life.fly!.stateHash()).toBe(whole.life.fly!.stateHash());
      expect(resumed.life.eco.stateHash()).toBe(whole.life.eco.stateHash());
    },
  );

  it("refuses a checkpoint that does not hash as it did", { timeout: 300_000 }, () => {
    const world = spinUp(spec, 1_800);
    let saved: LifetimeCheckpoint | null = null;
    runLifetime(spec, world, genesis, "intact", 1, {
      daySeconds: 60,
      save: (c) => (saved = JSON.parse(JSON.stringify(c)) as LifetimeCheckpoint),
    });
    const forged = { ...saved!, fly_hash: "0".repeat(64) };
    expect(() =>
      runLifetime(spec, world, genesis, "intact", 2, { daySeconds: 60, resume: forged }),
    ).toThrow(/not the one checkpointed/);
  });

  it(
    "leaves a fly with its place memory lesioned no food place to return to",
    { timeout: 300_000 },
    () => {
      const world = spinUp(spec, 3_600);
      const { days, life } = runLifetime(spec, world, genesis, "no-place-memory", 1, {
        daySeconds: 600,
      });
      expect(days[0]!.places).toBe(0);
      expect(
        life.organism!.inner.state.nav.places.filter((p) => p.kind === "food"),
      ).toHaveLength(0);
    },
  );
});
