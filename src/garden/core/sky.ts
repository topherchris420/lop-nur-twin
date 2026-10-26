/**
 * The sky over the garden at a presented instant: sun and moon positions for
 * Bethesda (the coordinates the server asks Open-Meteo about), and the light
 * they give, read from the server's clock and its reported weather.
 *
 * The positions are standard low-precision ephemerides: the sun to about a
 * hundredth of a degree (NOAA's formulation of the Astronomical Almanac's
 * algorithm), the moon to a few tenths of a degree (the main periodic terms
 * of its longitude and latitude, with topocentric parallax). The light
 * derived from them (colour temperature, intensity, twilight, cloud) is a
 * cinematographic reading, not a radiometric model.
 */
import type { Weather } from "./observation.js";
import { clamp, clamp01, normalize, smoothstep, type V3 } from "./vec.js";

/** Bethesda, Maryland: the latitude and longitude in the server's weather request. */
export const SITE = { latitude: 38.9847, longitude: -77.0947 };
/**
 * Compass bearing (degrees) of the observation camera's view: the garden is
 * seen looking west. The sun then crosses the picture from behind the left
 * shoulder in the morning to side light at midday and sets behind the
 * fence, so the clay is modelled by light at every hour; looking south, the
 * fence would face away from the sun all day.
 */
export const VIEW_BEARING_DEG = 270;

const RAD = Math.PI / 180;
const wrap360 = (x: number) => ((x % 360) + 360) % 360;

/** Altitude above the horizon and azimuth from north toward east, radians. */
export interface Celestial {
  altitude: number;
  azimuth: number;
}

function horizontal(raDeg: number, decDeg: number, t: number, site = SITE): Celestial {
  const n = t / 86400 + 2440587.5 - 2451545.0;
  const gmstHours = wrap360((18.697374558 + 24.06570982441908 * n) * 15) / 15;
  const hourAngle = (gmstHours * 15 + site.longitude - raDeg) * RAD;
  const lat = site.latitude * RAD,
    dec = decDeg * RAD;
  const altitude = Math.asin(
    Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(hourAngle),
  );
  const azimuth = Math.atan2(
    -Math.sin(hourAngle),
    Math.tan(dec) * Math.cos(lat) - Math.sin(lat) * Math.cos(hourAngle),
  );
  return { altitude, azimuth: (azimuth + 2 * Math.PI) % (2 * Math.PI) };
}

/** The sun's apparent ecliptic longitude (degrees) at unix time `t`. */
function sunLongitude(t: number): { lambda: number; epsilon: number } {
  const n = t / 86400 + 2440587.5 - 2451545.0;
  const L = wrap360(280.46 + 0.9856474 * n);
  const g = wrap360(357.528 + 0.9856003 * n) * RAD;
  return {
    lambda: L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g),
    epsilon: 23.439 - 0.0000004 * n,
  };
}

/** The sun as seen from the garden at unix time `t` (seconds). */
export function sunPosition(t: number, site = SITE): Celestial {
  const { lambda, epsilon } = sunLongitude(t);
  const l = lambda * RAD,
    e = epsilon * RAD;
  const ra = Math.atan2(Math.cos(e) * Math.sin(l), Math.cos(l)) / RAD;
  const dec = Math.asin(Math.sin(e) * Math.sin(l)) / RAD;
  return horizontal(ra, dec, t, site);
}

export interface Moon extends Celestial {
  /** Fraction of the disc lit, 0 (new) … 1 (full). */
  illumination: number;
  waxing: boolean;
}

/** The moon as seen from the garden at unix time `t` (seconds). */
export function moonPosition(t: number, site = SITE): Moon {
  const d = t / 86400 + 2440587.5 - 2451543.5;
  const N = wrap360(125.1228 - 0.0529538083 * d) * RAD;
  const i = 5.1454 * RAD;
  const w = wrap360(318.0634 + 0.1643573223 * d) * RAD;
  const a = 60.2666,
    ecc = 0.0549;
  const M = wrap360(115.3654 + 13.0649929509 * d) * RAD;
  let E = M + ecc * Math.sin(M) * (1 + ecc * Math.cos(M));
  for (let k = 0; k < 4; k++) E -= (E - ecc * Math.sin(E) - M) / (1 - ecc * Math.cos(E));
  const xv = a * (Math.cos(E) - ecc),
    yv = a * Math.sqrt(1 - ecc * ecc) * Math.sin(E);
  const v = Math.atan2(yv, xv),
    r = Math.hypot(xv, yv);
  const xh =
    r * (Math.cos(N) * Math.cos(v + w) - Math.sin(N) * Math.sin(v + w) * Math.cos(i));
  const yh =
    r * (Math.sin(N) * Math.cos(v + w) + Math.cos(N) * Math.sin(v + w) * Math.cos(i));
  const zh = r * Math.sin(v + w) * Math.sin(i);
  let lon = Math.atan2(yh, xh) / RAD;
  let lat = Math.atan2(zh, Math.hypot(xh, yh)) / RAD;
  // The largest periodic terms (Schlyter, after Meeus).
  const Ms = wrap360(356.047 + 0.9856002585 * d) * RAD;
  const ws = wrap360(282.9404 + 4.70935e-5 * d) * RAD;
  const Ls = Ms + ws,
    Lm = N + w + M;
  const D = Lm - Ls,
    F = Lm - N;
  lon +=
    -1.274 * Math.sin(M - 2 * D) +
    0.658 * Math.sin(2 * D) -
    0.186 * Math.sin(Ms) -
    0.059 * Math.sin(2 * M - 2 * D) -
    0.057 * Math.sin(M - 2 * D + Ms) +
    0.053 * Math.sin(M + 2 * D) +
    0.046 * Math.sin(2 * D - Ms) +
    0.041 * Math.sin(M - Ms) -
    0.035 * Math.sin(D) -
    0.031 * Math.sin(M + Ms) -
    0.015 * Math.sin(2 * F - 2 * D) +
    0.011 * Math.sin(M - 4 * D);
  lat +=
    -0.173 * Math.sin(F - 2 * D) -
    0.055 * Math.sin(M - F - 2 * D) -
    0.046 * Math.sin(M + F - 2 * D) +
    0.033 * Math.sin(F + 2 * D) +
    0.017 * Math.sin(2 * M + F);
  const eps = (23.4393 - 3.563e-7 * d) * RAD;
  const lo = lon * RAD,
    la = lat * RAD;
  const xe = Math.cos(la) * Math.cos(lo);
  const ye = Math.cos(eps) * Math.cos(la) * Math.sin(lo) - Math.sin(eps) * Math.sin(la);
  const ze = Math.sin(eps) * Math.cos(la) * Math.sin(lo) + Math.cos(eps) * Math.sin(la);
  const ra = Math.atan2(ye, xe) / RAD;
  const dec = Math.atan2(ze, Math.hypot(xe, ye)) / RAD;
  const h = horizontal(ra, dec, t, site);
  // Topocentric parallax: the moon is about a degree lower than seen from the earth's centre.
  const altitude = h.altitude - Math.asin(Math.cos(h.altitude) / 60.27);
  const sun = sunLongitude(t).lambda;
  const elongation = Math.acos(Math.cos(la) * Math.cos(lo - sun * RAD));
  return {
    altitude,
    azimuth: h.azimuth,
    illumination: (1 - Math.cos(elongation)) / 2,
    waxing: wrap360(lon - sun) < 180,
  };
}

/** Unit direction toward a body, in garden coordinates (+x right, +y up, +z toward the camera). */
export function gardenDirection(c: Celestial, viewBearingDeg = VIEW_BEARING_DEG): V3 {
  const rel = c.azimuth - viewBearingDeg * RAD;
  const h = Math.cos(c.altitude);
  return normalize([h * Math.sin(rel), Math.sin(c.altitude), -h * Math.cos(rel)]);
}

/** The first time after `from` (unix s) the sun's centre crosses `altitudeDeg`, rising or setting; null if none within a day. */
export function sunCrossing(
  from: number,
  rising: boolean,
  altitudeDeg = -0.833,
): number | null {
  const target = altitudeDeg * RAD;
  let t0 = from;
  let a0 = sunPosition(t0).altitude - target;
  for (let t = from + 300; t <= from + 86400; t += 300) {
    const a = sunPosition(t).altitude - target;
    if ((rising && a0 < 0 && a >= 0) || (!rising && a0 > 0 && a <= 0)) {
      let lo = t0,
        hi = t;
      for (let k = 0; k < 30; k++) {
        const mid = (lo + hi) / 2;
        const m = sunPosition(mid).altitude - target;
        if (m >= 0 === rising) hi = mid;
        else lo = mid;
      }
      return (lo + hi) / 2;
    }
    t0 = t;
    a0 = a;
  }
  return null;
}

// --------------------------------------------------------------------- light

/** Linear RGB, roughly unit luminance. */
export type RGB = [number, number, number];

/** The colour of a black body at `kelvin`, as linear RGB scaled to unit luminance (Tanner Helland's fit). */
export function kelvinToRGB(kelvin: number): RGB {
  const k = clamp(kelvin, 1000, 40000) / 100;
  const s = (x: number) => clamp(x, 0, 255) / 255;
  const r = k <= 66 ? 1 : s(329.698727446 * Math.pow(k - 60, -0.1332047592));
  const g =
    k <= 66
      ? s(99.4708025861 * Math.log(k) - 161.1195681661)
      : s(288.1221695283 * Math.pow(k - 60, -0.0755148492));
  const b =
    k >= 66 ? 1 : k <= 19 ? 0 : s(138.5177312231 * Math.log(k - 10) - 305.0447927307);
  const lin = (c: number) =>
    c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  const out: RGB = [lin(r), lin(g), lin(b)];
  const y = 0.2126 * out[0] + 0.7152 * out[1] + 0.0722 * out[2];
  return [out[0] / y, out[1] / y, out[2] / y];
}

/** How the reported WMO weather code reads as sky: cloud cover, fog, precipitation kind. */
export function skyOf(weather: Weather | null): {
  cloud: number;
  fog: number;
  snow: boolean;
  storm: boolean;
} {
  const code = weather?.code ?? null;
  const rain = weather?.rainMm ?? 0;
  if (code === null)
    return { cloud: rain > 0.2 ? 0.85 : 0.3, fog: 0, snow: false, storm: false };
  const cloud =
    code === 0
      ? 0.04
      : code === 1
        ? 0.25
        : code === 2
          ? 0.5
          : code === 3
            ? 0.92
            : code === 45 || code === 48
              ? 0.85
              : code >= 51
                ? 0.9
                : 0.4;
  return {
    cloud: Math.max(cloud, rain > 0.2 ? 0.85 : 0),
    fog: code === 45 || code === 48 ? 1 : 0,
    snow: (code >= 71 && code <= 77) || code === 85 || code === 86,
    storm: code >= 95,
  };
}

export interface Light {
  sun: { direction: V3; altitudeDeg: number; color: RGB; intensity: number };
  moon: {
    direction: V3;
    altitudeDeg: number;
    illumination: number;
    waxing: boolean;
    intensity: number;
  };
  /** Sky dome: zenith and horizon colours (linear), and hemisphere fill intensity. */
  zenith: RGB;
  horizon: RGB;
  ground: RGB;
  fill: number;
  /** 1 by day, 0 at night, through civil twilight. */
  daylight: number;
  /** Warmth of the hour: 1 at golden hour, 0 at midday or night. */
  golden: number;
  cloud: number;
  /** Rain rate in mm (reported), fog 0…1, wind km/h. */
  rain: number;
  fog: number;
  wind: number;
  snow: boolean;
  /** How much the house window glows from inside: evening and night. */
  windowGlow: number;
  /** Shadow softness: 0 hard (clear sun) … 1 diffuse (overcast). */
  softness: number;
}

const mixRGB = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
const srgb = (hex: number): RGB => {
  const lin = (c: number) =>
    c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  return [
    lin(((hex >> 16) & 255) / 255),
    lin(((hex >> 8) & 255) / 255),
    lin((hex & 255) / 255),
  ];
};

const DAY_ZENITH = srgb(0x6f93b8),
  DAY_HORIZON = srgb(0xc9d3d6),
  GOLD_ZENITH = srgb(0x5d7aa0),
  GOLD_HORIZON = srgb(0xe8b98a),
  DUSK_ZENITH = srgb(0x27344f),
  DUSK_HORIZON = srgb(0x8a6e74),
  NIGHT_ZENITH = srgb(0x0a1020),
  NIGHT_HORIZON = srgb(0x1c2533),
  OVERCAST = srgb(0xa9adb0),
  GROUND = srgb(0x5a5233);

/**
 * The garden's light at unix time `t`, from the sun and moon and the reported
 * weather. Deterministic: the same instant gives the same light everywhere.
 */
export function lightAt(t: number, weather: Weather | null): Light {
  const sun = sunPosition(t);
  const moon = moonPosition(t);
  const sunAlt = sun.altitude / RAD;
  const sky = skyOf(weather);
  const cloud = sky.cloud;
  const daylight = smoothstep(-6, 4, sunAlt);
  const golden = smoothstep(-2, 3, sunAlt) * (1 - smoothstep(6, 22, sunAlt));
  // Warm near the horizon, a touch warm of neutral when high (against the blue
  // sky fill, as a film camera balanced for daylight sees it); cloud cools it.
  const kelvin = clamp(
    Math.min(2200 + 220 * Math.max(0, sunAlt), 5400) + 1100 * cloud,
    2000,
    6500,
  );
  const direct = smoothstep(-1, 6, sunAlt) * (1 - 0.88 * cloud) * (1 - 0.6 * sky.fog);
  const sunIntensity =
    4.2 * direct * clamp01(0.35 + Math.sin(Math.max(0, sun.altitude)) * 1.3);
  const moonAlt = moon.altitude / RAD;
  const moonUp = smoothstep(-1, 8, moonAlt);
  const moonIntensity =
    0.11 *
    moonUp *
    Math.pow(moon.illumination, 1.5) *
    (1 - 0.85 * cloud) *
    (1 - daylight);

  let zenith = mixRGB(NIGHT_ZENITH, DUSK_ZENITH, smoothstep(-14, -4, sunAlt));
  let horizon = mixRGB(NIGHT_HORIZON, DUSK_HORIZON, smoothstep(-14, -4, sunAlt));
  zenith = mixRGB(zenith, GOLD_ZENITH, smoothstep(-4, 2, sunAlt));
  horizon = mixRGB(horizon, GOLD_HORIZON, smoothstep(-4, 2, sunAlt));
  zenith = mixRGB(zenith, DAY_ZENITH, smoothstep(4, 20, sunAlt));
  horizon = mixRGB(horizon, DAY_HORIZON, smoothstep(4, 20, sunAlt));
  const grey = mixRGB(NIGHT_HORIZON, OVERCAST, daylight);
  zenith = mixRGB(zenith, grey, cloud * 0.85);
  horizon = mixRGB(horizon, grey, cloud * 0.7);
  // Sky fill against the sun: in clear weather sunlit ground is about three
  // times brighter than shade (a cinematographer's ratio, a little gentler
  // than nature's); under cloud the sky carries nearly all the light.
  const fill = 0.06 + daylight * (0.42 + 0.72 * cloud) + 0.35 * moonIntensity;
  const hour = new Date(t * 1000).getUTCHours();
  return {
    sun: {
      direction: gardenDirection(sun),
      altitudeDeg: sunAlt,
      color: kelvinToRGB(kelvin),
      intensity: sunIntensity,
    },
    moon: {
      direction: gardenDirection(moon),
      altitudeDeg: moonAlt,
      illumination: moon.illumination,
      waxing: moon.waxing,
      intensity: moonIntensity,
    },
    zenith,
    horizon,
    ground: mixRGB(srgb(0x0b0d0a), GROUND, daylight),
    fill,
    daylight,
    golden: golden * (1 - cloud),
    cloud,
    rain: weather?.rainMm ?? 0,
    fog: sky.fog,
    wind: weather?.windKmh ?? 6,
    snow: sky.snow,
    // Lamps come on at dusk and go off late at night (local time is UTC−4/−5; a seeded house, not a measurement).
    windowGlow: (1 - daylight) * (hour >= 4 && hour < 10 ? 0.25 : 1),
    softness: clamp01(cloud * 1.1 + sky.fog),
  };
}
