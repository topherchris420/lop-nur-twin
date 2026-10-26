import { describe, expect, it } from "vitest";
import { SEQUENCES } from "./fixtures/index.js";
import { parseObservation } from "./observation.js";
import {
  gardenDirection,
  kelvinToRGB,
  lightAt,
  moonPosition,
  sunCrossing,
  sunPosition,
  VIEW_BEARING_DEG,
} from "./sky.js";

const RAD = Math.PI / 180;
const recorded = parseObservation(structuredClone(SEQUENCES["drinking"][0]!));

describe("the sun over Bethesda", () => {
  it("rises and sets within two minutes of the times the server reports", () => {
    // The server's sun table comes from Open-Meteo for the same coordinates.
    for (const [day, [rise, set]] of Object.entries(recorded.weather.sun)) {
      const r = sunCrossing(rise - 3 * 3600, true)!;
      const s = sunCrossing(set - 3 * 3600, false)!;
      expect(Math.abs(r - rise), `${day} sunrise`).toBeLessThan(120);
      expect(Math.abs(s - set), `${day} sunset`).toBeLessThan(120);
    }
  });

  it("stands about 38° high in the south at a late-October noon", () => {
    const [rise, set] = recorded.weather.sun["2026-10-26"]!;
    const noon = sunPosition((rise + set) / 2);
    expect(noon.altitude / RAD).toBeGreaterThan(36.5);
    expect(noon.altitude / RAD).toBeLessThan(40);
    expect(Math.abs(noon.azimuth / RAD - 180)).toBeLessThan(2);
  });

  it("agrees with the server's day and night", () => {
    for (const seq of Object.values(SEQUENCES))
      for (const r of seq) {
        const o = parseObservation(structuredClone(r));
        expect(sunPosition(o.serverTime).altitude > -0.833 * RAD).toBe(o.weather.isDay);
      }
  });
});

describe("the moon", () => {
  it("waxes and wanes through a lunation of about 29.5 days", () => {
    const start = Date.UTC(2026, 9, 1) / 1000;
    const fulls: number[] = [];
    let prev = moonPosition(start).illumination,
      rising = false;
    for (let t = start + 3600; t < start + 70 * 86400; t += 3600) {
      const k = moonPosition(t).illumination;
      if (rising && k < prev && prev > 0.97) fulls.push(t - 3600);
      rising = k > prev;
      prev = k;
    }
    expect(fulls.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < fulls.length; i++)
      expect((fulls[i]! - fulls[i - 1]!) / 86400).toBeCloseTo(29.5, 0);
  });

  it("rises later each day", () => {
    const t = Date.UTC(2026, 9, 26, 12) / 1000;
    const rise = (from: number) => {
      let prev = moonPosition(from).altitude;
      for (let x = from + 120; x < from + 2 * 86400; x += 120) {
        const a = moonPosition(x).altitude;
        if (prev < 0 && a >= 0) return x;
        prev = a;
      }
      return NaN;
    };
    const a = rise(t),
      b = rise(a + 3600);
    const later = (b - a - 86400) / 60;
    expect(later).toBeGreaterThan(20);
    expect(later).toBeLessThan(80);
  });
});

describe("garden directions", () => {
  it("place the view's bearing straight ahead and the zenith up", () => {
    const ahead = gardenDirection({ altitude: 0, azimuth: VIEW_BEARING_DEG * RAD });
    expect(ahead[2]).toBeCloseTo(-1, 9);
    const right = gardenDirection({
      altitude: 0,
      azimuth: (VIEW_BEARING_DEG + 90) * RAD,
    });
    expect(right[0]).toBeCloseTo(1, 9);
    expect(gardenDirection({ altitude: Math.PI / 2, azimuth: 1 })[1]).toBeCloseTo(1, 9);
  });
});

describe("light", () => {
  it("is daylight at noon, moonlight or less at midnight", () => {
    const [rise, set] = recorded.weather.sun["2026-10-26"]!;
    const day = lightAt((rise + set) / 2, recorded.weather);
    const night = lightAt(set + 6 * 3600, recorded.weather);
    expect(day.daylight).toBe(1);
    expect(day.sun.intensity).toBeGreaterThan(1);
    expect(night.daylight).toBe(0);
    expect(night.sun.intensity).toBe(0);
    expect(night.fill).toBeLessThan(day.fill / 5);
  });

  it("warms toward sunset", () => {
    const [rise, set] = recorded.weather.sun["2026-10-26"]!;
    const noon = lightAt((rise + set) / 2, recorded.weather);
    const evening = lightAt(set - 20 * 60, recorded.weather);
    const warmth = (c: number[]) => c[0]! / c[2]!;
    expect(warmth(evening.sun.color)).toBeGreaterThan(warmth(noon.sun.color));
    expect(evening.golden).toBeGreaterThan(noon.golden);
  });

  it("softens under cloud and keeps colours at unit luminance", () => {
    const [rise, set] = recorded.weather.sun["2026-10-26"]!;
    const overcast = lightAt((rise + set) / 2, { ...recorded.weather, code: 3 });
    const clear = lightAt((rise + set) / 2, recorded.weather);
    expect(overcast.softness).toBeGreaterThan(clear.softness);
    expect(overcast.sun.intensity).toBeLessThan(clear.sun.intensity);
    for (const k of [1800, 3000, 5500, 6500, 12000]) {
      const [r, g, b] = kelvinToRGB(k);
      expect(0.2126 * r + 0.7152 * g + 0.0722 * b).toBeCloseTo(1, 6);
    }
  });
});
