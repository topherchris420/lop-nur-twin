import { describe, expect, it } from "vitest";
import { AdaptiveResolution, defaultQuality, QUALITY } from "./quality.js";
import { boil, clampFps, frameAt } from "./stopMotion.js";

describe("stop-motion frames", () => {
  it("step presented time at 12–15 fps on the shared clock", () => {
    const sm = { enabled: true, fps: 12 };
    expect(frameAt(1000.05, sm)).toEqual({ index: 12000, time: 1000 });
    expect(frameAt(1000.09, sm).time).toBe(1000.0833333333334);
    expect(clampFps(30)).toBe(15);
    expect(clampFps(5)).toBe(12);
    expect(clampFps(Number.NaN)).toBe(12);
  });

  it("leave time continuous when switched off", () => {
    expect(frameAt(1000.0371, { enabled: false, fps: 12 }).time).toBe(1000.0371);
  });

  it("boil the same way for everyone on a frame, differently between frames", () => {
    expect(boil(12000, "leg")).toBe(boil(12000, "leg"));
    expect(boil(12000, "leg")).not.toBe(boil(12001, "leg"));
    for (let i = 0; i < 500; i++) {
      const v = boil(i, "x");
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe("quality", () => {
  it("starts phones and data savers on the light preset", () => {
    expect(defaultQuality({ mobile: true, cores: 4, memoryGb: 3, saveData: false })).toBe(
      "performance",
    );
    expect(
      defaultQuality({ mobile: false, cores: 12, memoryGb: 16, saveData: true }),
    ).toBe("performance");
    expect(
      defaultQuality({ mobile: false, cores: 12, memoryGb: 16, saveData: false }),
    ).toBe("high");
    expect(
      defaultQuality({ mobile: false, cores: 4, memoryGb: null, saveData: false }),
    ).toBe("balanced");
  });

  it("lowers resolution under load and raises it again with room, within the preset", () => {
    const a = new AdaptiveResolution(QUALITY.balanced, 2);
    expect(a.dpr).toBe(1.5);
    let changed = false;
    for (let i = 0; i < 40 && !changed; i++) changed = a.sample(40);
    expect(changed).toBe(true);
    expect(a.dpr).toBeLessThan(1.5);
    expect(a.dpr).toBeGreaterThanOrEqual(QUALITY.balanced.minDpr);
    for (let i = 0; i < 400; i++) a.sample(5);
    expect(a.dpr).toBe(1.5);
  });
});
