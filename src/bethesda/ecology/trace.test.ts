/** The causal trace only reads: a traced life is the untraced one, hash for hash. */
import { describe, expect, it } from "vitest";
import { referenceYard } from "./ecosystem";
import { cloneEcosystem, EcologicalLife, spinUp } from "./life";
import { PROVENANCE, Tracer } from "./trace";

describe("the causal trace", () => {
  it(
    "changes nothing it watches, and labels what everything is",
    { timeout: 300_000 },
    () => {
      const spec = referenceYard(42);
      const world = spinUp(spec, 3_600);
      const genesis = {
        subject: "research-trace-test",
        seed: 5,
        start: [7.3, -1] as [number, number],
        yaw: 0,
        startReserve: 0.4,
      };
      const body = { kind: "mortal" as const, thirst: true, thermal: true };
      const watched = new EcologicalLife(spec, genesis, body, cloneEcosystem(world));
      const alone = new EcologicalLife(spec, genesis, body, cloneEcosystem(world));
      const tracer = new Tracer(watched);
      for (let k = 0; k < 60; k++) {
        watched.step(100);
        alone.step(100);
        tracer.sample();
        expect(watched.fly!.stateHash()).toBe(alone.fly!.stateHash());
        expect(watched.eco.stateHash()).toBe(alone.eco.stateHash());
      }
      const last = tracer.samples[tracer.samples.length - 1]!;
      expect(last.physiology).not.toBeNull();
      expect(last.learning.remembered_places).toBeGreaterThanOrEqual(0);
      expect(last.decision?.reason.length).toBeGreaterThan(0);
      for (const k of [
        "world",
        "senses",
        "body",
        "physiology",
        "learning",
        "decision",
        "effects",
        "unavailable",
      ])
        expect(PROVENANCE[k as keyof typeof PROVENANCE].length).toBeGreaterThan(20);
      expect(PROVENANCE.decision).toMatch(/not a thought/);
    },
  );
});
