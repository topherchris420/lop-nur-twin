import { describe, expect, it } from "vitest";
import {
  centreWeighted,
  KEY,
  METER,
  METER_LOW,
  METER_STOPS,
  meterGain,
} from "./meter.js";

/** A reading as the GPU pass writes it: each cell's mean log2 luminance as a byte. */
const reading = (stops: (x: number, y: number) => number) => {
  const px = new Uint8Array(METER * METER * 4);
  for (let y = 0; y < METER; y++)
    for (let x = 0; x < METER; x++)
      px[(y * METER + x) * 4] = Math.round(
        ((stops(x, y) - METER_LOW) / METER_STOPS) * 255,
      );
  return px;
};

describe("the light meter", () => {
  it("reads an even picture as its own luminance", () => {
    for (const stops of [-9, -3, 0, 2])
      expect(Math.log2(centreWeighted(reading(() => stops)))).toBeCloseTo(stops, 1);
  });

  it("weights the middle of the frame, a little low, where the close-up lenses put the fly", () => {
    // A fly in shade (four cells, low centre) against a bright garden.
    const subject = (x: number, y: number) =>
      x >= 3 && x <= 4 && y >= 2 && y <= 3 ? -6 : -1;
    let plain = 0;
    for (let y = 0; y < METER; y++)
      for (let x = 0; x < METER; x++) plain += subject(x, y) / METER ** 2;
    const centred = Math.log2(centreWeighted(reading(subject)));
    expect(centred).toBeLessThan(plain - 0.5);
    // The same patch in a corner barely moves the reading.
    const corner = (x: number, y: number) => (x <= 1 && y >= 6 ? -6 : -1);
    expect(Math.log2(centreWeighted(reading(corner)))).toBeGreaterThan(centred + 0.75);
  });
});

describe("the close-up exposure", () => {
  it("leaves a subject already at middle grey alone", () => {
    expect(meterGain(1, KEY, 1)).toBeCloseTo(1, 9);
    expect(meterGain(4, KEY / 4, 1)).toBeCloseTo(1, 9);
  });

  it("goes half the way (in stops) toward middle grey", () => {
    expect(meterGain(1, KEY / 2, 1)).toBeCloseTo(Math.SQRT2, 9);
    expect(meterGain(1, KEY * 1.21, 1)).toBeCloseTo(1 / 1.1, 9);
  });

  it("opens at most a stop by day, less at night, and closes at most a third of a stop", () => {
    expect(meterGain(1, 1e-6, 1)).toBe(2);
    expect(meterGain(1, 1e-6, 0)).toBe(1.25);
    expect(meterGain(1, 1e3, 1)).toBe(0.8);
  });
});
