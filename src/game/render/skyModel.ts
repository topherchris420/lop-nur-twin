import * as THREE from "three";

/**
 * One sky for the ground-level view: the dome you look at, the haze distant
 * terrain fades into, and the light the world is lit by all come from here.
 *
 * Three things used to describe the sky separately and disagreed. The dome was
 * three's Preetham `Sky`, a pale gradient whose cloud deck is soft noise blobs;
 * the fog was one fixed beige, so a ridge ten kilometres out faded toward a
 * colour the sky behind it never had; and the image-based light was a third,
 * hand-picked gradient. A distant mountain read as a flat tan cut-out, and the
 * shade on the lakebed came out grey where a real desert's is blue.
 *
 * So the radiance is written once, as GLSL, and the dome (`skyDome.ts`), the
 * aerial perspective pass (`aerialPerspective.ts`) and the radiance map
 * (`environment.ts`) all include it, reading the same uniform objects. The
 * model is analytic rather than physical — a single-scattering look tuned by
 * eye against photographed desert skies — but it has the three properties the
 * eye checks: a deep, saturated zenith over a pale, dusty horizon band; a broad
 * forward-scattering glow around the sun that falls off smoothly rather than
 * stopping at a disc; and a sky slightly darker and bluer at right angles to
 * the sun than toward or away from it.
 *
 * Values are scene-linear radiance in the composer's units, where sunlit
 * concrete is about 2.0, so the grade treats sky and ground as one exposure.
 */

/** Uniforms shared by every material that includes `SKY_MODEL_GLSL`. */
export interface SkyUniforms {
  [name: string]: THREE.IUniform;
  skySunDir: THREE.IUniform<THREE.Vector3>;
  skyMoonDir: THREE.IUniform<THREE.Vector3>;
  skyDay: THREE.IUniform<number>;
  skySunColor: THREE.IUniform<THREE.Color>;
  skyTime: THREE.IUniform<number>;
  skyCloudCover: THREE.IUniform<number>;
  skyHaze: THREE.IUniform<number>;
}

/**
 * The live values. Shared objects, not copies: a ShaderMaterial or an Effect
 * that lists these uniforms reads the same `.value` the atmosphere writes once
 * a frame, so the dome, the fog and the radiance map cannot drift apart.
 */
export const skyUniforms: SkyUniforms = {
  skySunDir: { value: new THREE.Vector3(0, 1, 0) },
  skyMoonDir: { value: new THREE.Vector3(0, 1, 0) },
  skyDay: { value: 1 },
  skySunColor: { value: new THREE.Color(1, 0.95, 0.86) },
  skyTime: { value: 0 },
  skyCloudCover: { value: 0.36 },
  skyHaze: { value: 0.5 },
};

/**
 * The ground-level view's light, as it is this frame, for anything drawn in
 * its own pass that must look lit by the same world — the first-person weapon
 * above all. Written once a frame by `Atmosphere` (ground level only); a
 * mutable singleton, so read it on the frame loop and never copy it into
 * React state.
 *
 * - `keyDirection`, `keyColor`, `keyIntensity`: the one shadow-casting
 *   directional light. By day it is the sun; once the sun is down it is the
 *   moon (`moonKey` true), cool and dim. Same values the world's light has.
 * - `skyFill`, `groundFill`: the hemisphere light's colours times its
 *   intensity, i.e. the small cool-from-above / warm-from-below bias that sits
 *   on top of the image-based light.
 * - `dayFactor`: 1 day, 0 night, eased.
 *
 * The image-based light itself is `EnvironmentLighting` (`environment.ts`):
 * the world uses the plain variant via `scene.environment`, and the weapon's
 * `structured: true` variant is built from the same sky model.
 */
export const groundLight = {
  keyDirection: new THREE.Vector3(0, 1, 0),
  keyColor: new THREE.Color(1, 0.95, 0.86),
  keyIntensity: 0,
  moonKey: false,
  skyFill: new THREE.Color(0, 0, 0),
  groundFill: new THREE.Color(0, 0, 0),
  dayFactor: 1,
};

const SUN_HIGH = new THREE.Color(1.0, 0.94, 0.84);
const SUN_LOW = new THREE.Color(1.0, 0.58, 0.3);

/**
 * Per-frame update from the atmosphere's eased sun. `dust` is the climate's
 * airborne-dust factor (0 clear, 1 dusty): it thickens the horizon band.
 */
export function updateSkyUniforms(
  sunDirection: THREE.Vector3,
  moonDirection: THREE.Vector3,
  dayFactor: number,
  time: number,
  dust: number,
): void {
  skyUniforms.skySunDir.value.copy(sunDirection).normalize();
  skyUniforms.skyMoonDir.value.copy(moonDirection).normalize();
  skyUniforms.skyDay.value = THREE.MathUtils.clamp(dayFactor, 0, 1);
  const lift = THREE.MathUtils.clamp(sunDirection.y * 2.4, 0, 1);
  skyUniforms.skySunColor.value.lerpColors(SUN_LOW, SUN_HIGH, lift);
  skyUniforms.skyTime.value = time;
  skyUniforms.skyHaze.value = THREE.MathUtils.clamp(dust, 0, 1);
}

/**
 * The model. Declares the shared uniforms and these functions:
 *
 *   vec3 skyClear(vec3 dir)          clear-sky radiance, no disc, no cloud
 *   vec3 skyHorizonHaze(vec3 dir)    the colour distant terrain fades into
 *   vec4 skyClouds(vec3 dir, vec3 behind)  premultiplied cloud colour + alpha
 *   vec3 skySunDisc(vec3 dir)        the solar and lunar discs
 *
 * `SKY_CLOUD_TAPS` (0..3) sets how many self-shadow samples a cloud takes.
 */
export const SKY_MODEL_GLSL = /* glsl */ `
uniform vec3 skySunDir;
uniform vec3 skyMoonDir;
uniform float skyDay;
uniform vec3 skySunColor;
uniform float skyTime;
uniform float skyCloudCover;
uniform float skyHaze;

#ifndef SKY_CLOUD_TAPS
#define SKY_CLOUD_TAPS 3
#endif

const float SKY_PI = 3.14159265;

float skyHg(float cosTheta, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (4.0 * SKY_PI * pow(max(1.0 + g2 - 2.0 * g * cosTheta, 1e-4), 1.5));
}

// Sinless lattice hash, so every GPU draws the same clouds.
vec2 skyGrad(vec2 i) {
  vec3 p = fract(i.xyx * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yzx + 33.33);
  return fract((p.xx + p.yz) * p.zy) * 2.0 - 1.0;
}

float skyNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = dot(skyGrad(i), f);
  float b = dot(skyGrad(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0));
  float c = dot(skyGrad(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0));
  float d = dot(skyGrad(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 1.6;
}

float skyFbm3(vec2 p) {
  float r = skyNoise(p);
  r += 0.5 * skyNoise(p * 2.03 + 11.7);
  r += 0.25 * skyNoise(p * 4.07 - 7.3);
  return r * 0.5714;
}

float skyFbm5(vec2 p) {
  float r = 0.0;
  float a = 1.0;
  for (int i = 0; i < 5; i++) {
    r += a * skyNoise(p);
    a *= 0.5;
    p = mat2(1.6, 1.2, -1.2, 1.6) * p + 3.1;
  }
  return r * 0.5161;
}

// Day and night palettes, scene-linear.
const vec3 SKY_ZENITH_DAY = vec3(0.052, 0.135, 0.42);
const vec3 SKY_MID_DAY = vec3(0.16, 0.30, 0.62);
const vec3 SKY_HORIZON_DAY = vec3(0.68, 0.76, 0.84);
const vec3 SKY_DUST_DAY = vec3(0.84, 0.76, 0.62);
const vec3 SKY_ZENITH_NIGHT = vec3(0.0032, 0.0058, 0.0135);
const vec3 SKY_HORIZON_NIGHT = vec3(0.0105, 0.0135, 0.0205);

vec3 skyClear(vec3 dir) {
  float h = max(dir.y, 0.0);
  float cosSun = dot(dir, skySunDir);
  float sunUp = smoothstep(-0.12, 0.25, skySunDir.y);
  float day = skyDay * sunUp;

  // Optical depth grows toward the horizon, so blue gives way to a pale,
  // brighter band; the last few degrees are dust, warm and thick.
  float band = exp(-h * mix(5.5, 4.0, skyHaze));
  float dust = exp(-h * 18.0);
  vec3 dayCol = mix(SKY_ZENITH_DAY, SKY_MID_DAY, smoothstep(0.98, 0.25, h));
  dayCol = mix(dayCol, SKY_HORIZON_DAY, band);
  dayCol = mix(dayCol, SKY_DUST_DAY, dust * (0.45 + 0.35 * skyHaze));

  // Rayleigh's phase darkens and saturates the sky at right angles to the
  // sun; Mie scattering gives a bright core and a broad aureole around it.
  float rayleigh = 0.78 + 0.33 * (1.0 + cosSun * cosSun) * 0.5;
  dayCol *= rayleigh;
  float aureole = skyHg(cosSun, 0.76) * 0.32 + skyHg(cosSun, 0.32) * 0.9;
  float lowSun = 1.0 - smoothstep(0.05, 0.5, skySunDir.y);
  dayCol += skySunColor * aureole * (0.55 + 0.45 * band + lowSun * 0.6);
  // A low sun reddens the whole horizon on its side.
  dayCol += skySunColor * lowSun * band * max(cosSun, 0.0) * 0.6;

  // Night: a dark navy dome, a faint glow along the horizon, and the moon's
  // own aureole so silhouettes have something to stand against.
  float cosMoon = dot(dir, skyMoonDir);
  vec3 nightCol = mix(SKY_ZENITH_NIGHT, SKY_HORIZON_NIGHT, exp(-h * 3.2));
  nightCol += vec3(0.020, 0.026, 0.038) * (skyHg(cosMoon, 0.72) * 0.35 + skyHg(cosMoon, 0.25) * 0.6);

  vec3 col = mix(nightCol, dayCol, day);
  // Twilight belt: the horizon warms as the sun sits on it.
  float twilight = (1.0 - abs(skySunDir.y * 4.0 - 0.15)) * skyDay;
  col += vec3(0.30, 0.13, 0.05) * max(twilight, 0.0) * band * (0.4 + 0.6 * max(cosSun, 0.0));

  // Below the horizon: the haze continues down, a little darker, so the gap
  // between the last terrain and the dome is never a hard line.
  if (dir.y < 0.0) col *= mix(1.0, 0.82, smoothstep(0.0, -0.2, dir.y));
  return col;
}

/** What distant terrain fades into: the clear sky a few degrees up. */
vec3 skyHorizonHaze(vec3 dir) {
  vec3 flat = normalize(vec3(dir.x, max(dir.y, 0.0) * 0.4 + 0.035, dir.z));
  return skyClear(flat);
}

float skyCumulusDensity(vec2 p, float cover) {
  vec2 warp = vec2(skyFbm3(p * 0.55 + 1.7), skyFbm3(p * 0.55 - 4.3));
  float n = skyFbm5(p + warp * 0.9);
  // Large-scale coverage drift: banks and clear gaps, not a uniform field.
  float region = skyNoise(p * 0.11 + 9.1) * 0.5;
  float c = clamp(cover + region * 0.45, 0.0, 1.0);
  float threshold = 1.0 - c;
  return smoothstep(threshold - 0.06, threshold + 0.42, n * 0.5 + 0.5);
}

float skyCumulusShadowDensity(vec2 p, float cover) {
  float n = skyFbm3(p);
  float region = skyNoise(p * 0.11 + 9.1) * 0.5;
  float c = clamp(cover + region * 0.45, 0.0, 1.0);
  return smoothstep(1.0 - c - 0.06, 1.0 - c + 0.42, n * 0.5 + 0.5);
}

/** Premultiplied cloud radiance and coverage for a view direction. */
vec4 skyClouds(vec3 dir, vec3 behind) {
  if (dir.y < 0.004 || skyCloudCover <= 0.0) return vec4(0.0);
  // A curved-earth stand-in: the + 0.06 keeps the deck from stretching to
  // infinity at the horizon, where it should compress into a thin band.
  float rayLen = 1.0 / (dir.y + 0.06);
  vec2 wind = vec2(0.6, 0.22) * skyTime * 0.0035;
  vec2 p = dir.xz * rayLen * 1.8 + wind;

  float d = skyCumulusDensity(p, skyCloudCover);
  float cirrusLayer = 0.0;
  // Cirrus: high, thin, combed along the wind.
  vec2 cp = dir.xz * (1.0 / (dir.y + 0.11)) * 0.9 + wind * 0.6;
  vec2 cr = vec2(cp.x * 0.92 + cp.y * 0.38, -cp.x * 0.38 + cp.y * 0.92);
  float streak = skyFbm3(vec2(cr.x * 0.35, cr.y * 3.4) + skyNoise(cr * 0.5) * 0.8);
  cirrusLayer = smoothstep(0.18, 0.75, streak * 0.5 + 0.5) * 0.33 * smoothstep(0.02, 0.2, dir.y);

  float horizonFade = smoothstep(0.004, 0.07, dir.y);
  if (d <= 0.001 && cirrusLayer <= 0.001) return vec4(0.0);

  float cosSun = dot(dir, skySunDir);
  float sunUp = smoothstep(-0.1, 0.2, skySunDir.y) * skyDay;
  // Light from above: the sun through the cloud toward it, and the sky dome.
  vec2 toSun = normalize(skySunDir.xz + vec2(1e-4)) * 0.16;
  float shade = 0.0;
  #if SKY_CLOUD_TAPS > 0
  for (int i = 1; i <= SKY_CLOUD_TAPS; i++) {
    shade += skyCumulusShadowDensity(p + toSun * float(i), skyCloudCover);
  }
  shade /= float(SKY_CLOUD_TAPS);
  #else
  shade = d * 0.7;
  #endif
  float thickness = d * 0.75 + shade * 0.85;
  float beer = exp(-thickness * 1.8);
  float powder = 1.0 - exp(-d * 6.0);
  float silver = skyHg(cosSun, 0.62) * 2.4 + skyHg(cosSun, -0.2) * 0.6;
  float edge = clamp(1.0 - d * 1.6, 0.0, 1.0);

  vec3 sunCol = skySunColor * 4.0 * sunUp;
  vec3 zenith = skyClear(vec3(0.0, 1.0, 0.0));
  vec3 ground = vec3(0.42, 0.33, 0.22) * sunUp + vec3(0.004, 0.005, 0.007);
  // Undersides: lit by the ground's bounce and the sky around them, never black.
  vec3 ambient = mix(ground, zenith * 1.1, 0.55 + 0.45 * (1.0 - d)) * 1.05;
  vec3 lit = sunCol * (beer * (0.55 + 0.45 * powder) + silver * edge * beer * 0.55);
  vec3 cloud = ambient * (0.62 + 0.38 * (1.0 - shade)) + lit;

  // Night: moonlit, dim, with a faint silver edge toward the moon.
  float cosMoon = dot(dir, skyMoonDir);
  vec3 moonCol = vec3(0.030, 0.036, 0.050) * (1.0 - sunUp);
  cloud += moonCol * (beer * 0.8 + skyHg(cosMoon, 0.6) * edge * 1.5);

  float alpha = (1.0 - exp(-d * 4.2)) * horizonFade;
  // Cirrus is thin ice: bright, mostly transparent, no self-shadow.
  vec3 cirrusCol = sunCol * (0.55 + silver * 0.35) + zenith * 0.9 + moonCol * 0.6;
  float cirrusA = cirrusLayer * (1.0 - alpha) * horizonFade;

  // Distant cloud dissolves into the horizon haze it sits in.
  float far = 1.0 - exp(-rayLen * 0.075);
  vec3 col = mix(cloud, behind, far * 0.78) * alpha + mix(cirrusCol, behind, far * 0.6) * cirrusA;
  return vec4(col, alpha + cirrusA);
}

/** Solar disc with limb darkening, and the moon. */
vec3 skySunDisc(vec3 dir) {
  float cosSun = dot(dir, skySunDir);
  // A touch over the true 0.27 deg radius, so the sun reads at 1080p.
  float r = acos(clamp(cosSun, -1.0, 1.0)) / 0.0068;
  float disc = 1.0 - smoothstep(0.86, 1.0, r);
  float limb = sqrt(max(1.0 - r * r, 0.0));
  float sunUp = smoothstep(-0.02, 0.04, skySunDir.y) * skyDay;
  vec3 sun = skySunColor * disc * (0.45 + 0.55 * limb) * 90.0 * sunUp;

  float cosMoon = dot(dir, skyMoonDir);
  float rm = acos(clamp(cosMoon, -1.0, 1.0)) / 0.0085;
  float moonDisc = 1.0 - smoothstep(0.88, 1.0, rm);
  // A few soft maria, so the moon is a body and not a bulb.
  vec2 mp = vec2(dot(dir, normalize(cross(skyMoonDir, vec3(0.0, 1.0, 0.0)))), dir.y - skyMoonDir.y) / 0.0085;
  float maria = smoothstep(0.1, 0.6, skyNoise(mp * 1.7 + 3.0) * 0.5 + 0.5);
  vec3 moon = vec3(0.86, 0.9, 1.0) * moonDisc * (1.6 - 0.55 * maria) * (1.0 - skyDay);
  return sun + moon;
}
`;
