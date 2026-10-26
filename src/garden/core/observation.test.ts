import { describe, expect, it } from "vitest";
import { raw, SEQUENCES } from "./fixtures/index.js";
import { ObservationError, parseObservation, sameLife } from "./observation.js";

const sample = () => raw(SEQUENCES["stone-to-flowers"][2]!);

describe("parseObservation", () => {
  it("reads every recorded state", () => {
    for (const seq of Object.values(SEQUENCES))
      for (const r of seq) {
        const o = parseObservation(raw(r));
        expect(o.lifeId).toBe("5cf42cd6-fd0a-474d-882c-4cb70e0357e8");
        expect(o.bornAt).toBe(1792908400.321717);
        expect(o.ticks).toBe(r.ticks);
        expect(o.place).not.toBeNull();
        expect(o.weather.sun["2026-10-26"]).toEqual([1793014164, 1793052885]);
      }
  });

  it("keeps the journey the server reports", () => {
    const o = parseObservation(sample());
    expect(o.activity).toBe("flying");
    expect(o.travel?.destination).toBe("flowers");
    // The journey starts where the decision to leave found it.
    expect(o.travel?.from).toEqual(SEQUENCES["stone-to-flowers"][1]!.position);
    expect(o.learning?.last?.action).toBe("fly");
    expect(o.learning?.fly?.samples).toBeGreaterThan(0);
    expect(o.learning?.nearby.map((n) => n.name)).toEqual([
      "drifting_midge",
      "swaying_leaf",
    ]);
  });

  it("returns data that does not share the response's objects", () => {
    const r = sample();
    const o = parseObservation(r);
    (r.position as number[])[0] = 99;
    expect(o.position[0]).not.toBe(99);
  });

  it("refuses what cannot be drawn honestly", () => {
    const broken: [string, (r: Record<string, unknown>) => void][] = [
      ["no life id", (r) => delete r.life_id],
      ["empty life id", (r) => (r.life_id = "")],
      ["fractional ticks", (r) => (r.ticks = 1.5)],
      ["a time before birth", (r) => (r.updated_at = (r.born_at as number) - 10)],
      ["a non-numeric position", (r) => (r.position = ["0.5", 0.5])],
      ["a NaN", (r) => (r.server_time = Number.NaN)],
      [
        "an unknown destination",
        (r) => ((r.travel as Record<string, unknown>).destination = "moon"),
      ],
      [
        "weather without is_day",
        (r) => delete (r.weather as Record<string, unknown>).is_day,
      ],
      ["moments that are not a list", (r) => (r.moments = {})],
    ];
    for (const [what, breakIt] of broken) {
      const r = sample();
      breakIt(r);
      expect(() => parseObservation(r), what).toThrow(ObservationError);
    }
    expect(() => parseObservation(null)).toThrow(ObservationError);
    expect(() => parseObservation([])).toThrow(ObservationError);
  });

  it("keeps optional parts null rather than guessing", () => {
    const r = sample();
    delete r.learning;
    delete r.needs;
    delete r.distance;
    delete (r.weather as Record<string, unknown>).wind;
    const o = parseObservation(r);
    expect(o.learning).toBeNull();
    expect(o.needs).toBeNull();
    expect(o.distance).toBeNull();
    expect(o.weather.windKmh).toBeNull();
  });

  it("accepts a place or activity it does not know, without inventing one", () => {
    const r = sample();
    r.travel = null;
    r.place = "greenhouse";
    r.activity = "basking";
    const o = parseObservation(r);
    expect(o.place).toBeNull();
    expect(o.placeRaw).toBe("greenhouse");
    expect(o.activity).toBe("basking");
  });

  it("tells one life from another", () => {
    const a = parseObservation(sample());
    const r = sample();
    r.life_id = "another";
    expect(sameLife(a, parseObservation(sample()))).toBe(true);
    expect(sameLife(a, parseObservation(r))).toBe(false);
  });
});
