import * as THREE from "three";
import { BlendFunction, Effect, EffectAttribute, Pass } from "postprocessing";
import { mulberry32 } from "@/lib/noise";

/**
 * Custom GLSL post-processing stack for Blacksite / desert airfield twin.
 *
 * Everything here is hand-written GLSL running inside the `postprocessing`
 * composer, supporting AAA Call of Duty Modern Warfare-level optical rendering:
 *
 *   scene (HDR, linear, no tone mapping)
 *     -> N8AO                         ambient occlusion
 *     -> Bloom (mipmap/dual-filter)
 *     -> AnamorphicStreaksPass        multi-pass horizontal lens streaks
 *     -> OpticalLensDirtAndFlareEffect optical flares + illuminated glass dirt / micro-scratches
 *     -> AgXToneMappingEffect         Modern Warfare CDL + AgX display transform
 *     -> CombatScreenEffect           damage / suppression / flash feedback
 *     -> CameraMotionBlurEffect       velocity-driven rotation / sprint / slide blur
 *     -> Vignette
 *     -> SMAA                         subpixel morphological antialiasing
 *     -> LensArtifactsEffect          spectral dispersion CA + radial falloff + film grain
 *
 * The renderer itself must be `THREE.NoToneMapping` while this stack is
 * mounted.
 */

/* ------------------------------------------------------------------ */
/* Procedural Lens Dirt Texture                                       */
/* ------------------------------------------------------------------ */

let cachedLensDirtTexture: THREE.CanvasTexture | null = null;

/**
 * Generates a high-resolution procedural optical lens dirt & scratch texture.
 * Contains out-of-focus bokeh dust circles, hairline wiping micro-scratches,
 * pinpoint glass dust specks with diffraction rings, and edge smudge deposits.
 */
export function getLensDirtTexture(): THREE.CanvasTexture {
  if (cachedLensDirtTexture) return cachedLensDirtTexture;
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, size, size);

  const rand = mulberry32(0x8f3c1a);

  // 1. Soft out-of-focus bokeh dust circles (rear element dust deposits)
  for (let i = 0; i < 55; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 4 + rand() * 22;
    const alpha = 0.06 + rand() * 0.16;
    const grad = ctx.createRadialGradient(x, y, r * 0.35, x, y, r);
    grad.addColorStop(0, `rgba(255, 255, 255, ${alpha * 0.4})`);
    grad.addColorStop(0.75, `rgba(255, 255, 255, ${alpha})`);
    grad.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // 2. Micro-scratches and cleaning swirls
  ctx.lineWidth = 1;
  for (let i = 0; i < 90; i++) {
    const startX = rand() * size;
    const startY = rand() * size;
    const len = 14 + rand() * 55;
    const angle = rand() * Math.PI * 2;
    const cpAngle = angle + (rand() - 0.5) * 1.3;
    const cpDist = len * 0.5;
    const alpha = 0.1 + rand() * 0.28;
    ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.quadraticCurveTo(
      startX + Math.cos(cpAngle) * cpDist,
      startY + Math.sin(cpAngle) * cpDist,
      startX + Math.cos(angle) * len,
      startY + Math.sin(angle) * len,
    );
    ctx.stroke();
  }

  // 3. Sharp pinpoint glass dust specks with diffraction rings
  for (let i = 0; i < 320; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 0.5 + rand() * 1.9;
    const brightness = 180 + Math.floor(rand() * 75);
    ctx.fillStyle = `rgba(${brightness}, ${brightness}, ${brightness}, ${0.45 + rand() * 0.55})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    if (r > 1.3) {
      ctx.strokeStyle = `rgba(210, 230, 255, ${0.15 + rand() * 0.25})`;
      ctx.beginPath();
      ctx.arc(x, y, r * 2.6, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // 4. Peripheral edge smudge & oil deposits
  const edgeGrad = ctx.createRadialGradient(
    size / 2,
    size / 2,
    size * 0.32,
    size / 2,
    size / 2,
    size * 0.52,
  );
  edgeGrad.addColorStop(0, "rgba(255, 255, 255, 0)");
  edgeGrad.addColorStop(0.7, "rgba(255, 255, 255, 0.08)");
  edgeGrad.addColorStop(1, "rgba(255, 255, 255, 0.32)");
  ctx.fillStyle = edgeGrad;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.name = "ProceduralLensDirt";
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  cachedLensDirtTexture = texture;
  return texture;
}

/* ------------------------------------------------------------------ */
/* Optical Lens Dirt & Flare Effect                                   */
/* ------------------------------------------------------------------ */

const LENS_DIRT_FLARE_FRAGMENT = /* glsl */ `
uniform sampler2D tDirt;
uniform vec3 sunScreenPos; // (uv.x, uv.y, inFront: 1.0 or 0.0)
uniform float sunFlareIntensity;
uniform float muzzleFlashIntensity;
uniform float dirtIntensity;
uniform float haloRadius;
uniform float ghostDispersal;
uniform vec3 flareTint;

vec3 computeOpticalGhosts(vec2 uv, vec2 lightPos, float intensity) {
  vec2 delta = lightPos - uv;
  vec2 ghostVec = (vec2(0.5) - lightPos) * ghostDispersal;

  // 1. Central starburst diffraction tight around the light source
  float d = length(delta);
  float angle = atan(delta.y, delta.x);
  float rays = max(0.0, sin(angle * 14.0) * 0.6 + sin(angle * 28.0) * 0.4);
  float starburst = exp(-d * 22.0) * 2.2 + exp(-d * 6.5) * 0.45 * rays;

  // 2. Optical ghost reflections through the lens axis
  vec3 ghosts = vec3(0.0);
  for (int i = 1; i <= 5; i++) {
    float fi = float(i);
    vec2 offset = fract(lightPos + ghostVec * fi);
    float dist = length(offset - uv);
    float falloff = exp(-dist * (6.5 + fi * 3.5)) * (1.0 / (fi * 0.85 + 0.5));

    // Chromatic dispersion along ghost ray
    ghosts.r += exp(-length(offset - uv - delta * 0.016) * (6.5 + fi * 3.5)) * falloff;
    ghosts.g += exp(-length(offset - uv) * (6.5 + fi * 3.5)) * falloff;
    ghosts.b += exp(-length(offset - uv + delta * 0.016) * (6.5 + fi * 3.5)) * falloff;
  }

  // 3. Chromatic Halo Ring
  vec2 haloVec = normalize(delta + 1e-5) * haloRadius;
  float haloDist = length(uv - (lightPos - haloVec));
  float haloWeight = exp(-haloDist * 28.0) * 0.45;
  vec3 halo = vec3(
    exp(-length(uv - (lightPos - haloVec * 1.025)) * 28.0),
    exp(-length(uv - (lightPos - haloVec * 1.000)) * 28.0),
    exp(-length(uv - (lightPos - haloVec * 0.975)) * 28.0)
  ) * haloWeight;

  return (vec3(starburst) + ghosts * 1.2 + halo * 1.4) * intensity * flareTint;
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 color = inputColor.rgb;
  vec4 dirt = texture2D(tDirt, uv);

  vec3 flare = vec3(0.0);

  // Sun flare (only if in front of camera and within view window)
  if (sunScreenPos.z > 0.5 && sunFlareIntensity > 0.001) {
    vec2 sunUv = sunScreenPos.xy;
    if (sunUv.x >= -0.2 && sunUv.x <= 1.2 && sunUv.y >= -0.2 && sunUv.y <= 1.2) {
      flare += computeOpticalGhosts(uv, sunUv, sunFlareIntensity);
    }
  }

  // Muzzle flash optical burst (originating from weapon muzzle screen quadrant)
  if (muzzleFlashIntensity > 0.001) {
    vec2 flashUv = vec2(0.58, 0.72);
    vec3 flashFlare = computeOpticalGhosts(uv, flashUv, muzzleFlashIntensity * 1.8);
    flare += flashFlare * vec3(1.25, 0.95, 0.72);
  }

  // Extract high-luminance glints from input HDR buffer to catch lens scratches
  float lum = dot(color, vec3(0.2126, 0.7152, 0.0722));
  float highlightGlint = max(0.0, lum - 3.2) * 0.15;

  // Glass dust and micro-scratches illuminate under direct flare or specular glints
  vec3 illuminatedDirt = dirt.rgb * dirt.a * dirtIntensity * (flare * 1.5 + highlightGlint * vec3(0.95, 0.92, 0.86));

  color += flare + illuminatedDirt;
  outputColor = vec4(max(color, 0.0), inputColor.a);
}
`;

export interface OpticalLensDirtAndFlareOptions {
  sunFlareIntensity?: number;
  muzzleFlashIntensity?: number;
  dirtIntensity?: number;
  haloRadius?: number;
  ghostDispersal?: number;
  flareTint?: THREE.ColorRepresentation;
}

export class OpticalLensDirtAndFlareEffect extends Effect {
  constructor({
    sunFlareIntensity = 0.45,
    muzzleFlashIntensity = 0.0,
    dirtIntensity = 0.35,
    haloRadius = 0.48,
    ghostDispersal = 0.28,
    flareTint = "#fff4db",
  }: OpticalLensDirtAndFlareOptions = {}) {
    const dirtTex = getLensDirtTexture();
    super("OpticalLensDirtAndFlareEffect", LENS_DIRT_FLARE_FRAGMENT, {
      blendFunction: BlendFunction.SRC,
      uniforms: new Map<string, THREE.Uniform>([
        ["tDirt", new THREE.Uniform(dirtTex)],
        ["sunScreenPos", new THREE.Uniform(new THREE.Vector3(0.5, 0.5, 0))],
        ["sunFlareIntensity", new THREE.Uniform(sunFlareIntensity)],
        ["muzzleFlashIntensity", new THREE.Uniform(muzzleFlashIntensity)],
        ["dirtIntensity", new THREE.Uniform(dirtIntensity)],
        ["haloRadius", new THREE.Uniform(haloRadius)],
        ["ghostDispersal", new THREE.Uniform(ghostDispersal)],
        ["flareTint", new THREE.Uniform(new THREE.Color(flareTint))],
      ]),
    });
  }

  private setUniform(name: string, value: unknown): void {
    const uniform = this.uniforms.get(name);
    if (uniform) uniform.value = value;
  }

  setSunScreenPos(x: number, y: number, inFront: boolean): void {
    const uniform = this.uniforms.get("sunScreenPos");
    if (uniform) {
      (uniform.value as THREE.Vector3).set(x, y, inFront ? 1 : 0);
    }
  }

  set sunFlareIntensity(value: number) {
    this.setUniform("sunFlareIntensity", value);
  }

  set muzzleFlashIntensity(value: number) {
    this.setUniform("muzzleFlashIntensity", value);
  }

  set dirtIntensity(value: number) {
    this.setUniform("dirtIntensity", value);
  }

  set haloRadius(value: number) {
    this.setUniform("haloRadius", value);
  }

  set ghostDispersal(value: number) {
    this.setUniform("ghostDispersal", value);
  }

  set flareTint(value: THREE.ColorRepresentation) {
    const uniform = this.uniforms.get("flareTint");
    if (uniform) (uniform.value as THREE.Color).set(value);
  }
}

/* ------------------------------------------------------------------ */
/* Camera Velocity Motion Blur                                         */
/* ------------------------------------------------------------------ */

const CAMERA_MOTION_BLUR_FRAGMENT = /* glsl */ `
uniform vec2 uVelocity;
uniform float uForwardVelocity;
uniform float uRollVelocity;
uniform float uIntensity;
uniform float uMaxBlur;
uniform float time;

float motionBlurHash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

#define MOTION_TAPS 8

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 centered = uv - 0.5;

  // Screen-space velocity components:
  // 1. Look yaw / pitch and lateral strafe (uVelocity)
  // 2. Sprint / slide expansion from screen center (uForwardVelocity)
  // 3. Camera roll rotation around screen center (uRollVelocity)
  vec2 rollVec = vec2(-centered.y, centered.x) * uRollVelocity;
  vec2 forwardVec = centered * uForwardVelocity;

  vec2 velocity = (uVelocity + forwardVec + rollVec) * uIntensity;
  float speed = length(velocity);

  // Skip blur if camera is stationary
  if (speed < 0.00035) {
    outputColor = inputColor;
    return;
  }

  // Smoothly clamp maximum blur vector to prevent disorienting streaks
  vec2 clampedVelocity = velocity * min(1.0, uMaxBlur / max(speed, 1e-6));
  float dither = motionBlurHash13(vec3(uv * 1024.0, fract(time * 60.0)));

  vec4 accum = vec4(0.0);
  float weightSum = 0.0;

  for (int i = 0; i < MOTION_TAPS; i++) {
    float t = (float(i) + dither) / float(MOTION_TAPS) - 0.5;
    vec2 tapUv = uv + clampedVelocity * t;
    float w = 1.0 - abs(t) * 0.45;
    accum += texture2D(inputBuffer, tapUv) * w;
    weightSum += w;
  }

  outputColor = accum / weightSum;
}
`;

export interface CameraMotionBlurOptions {
  intensity?: number;
  maxBlur?: number;
}

export class CameraMotionBlurEffect extends Effect {
  constructor({ intensity = 1.0, maxBlur = 0.038 }: CameraMotionBlurOptions = {}) {
    super("CameraMotionBlurEffect", CAMERA_MOTION_BLUR_FRAGMENT, {
      blendFunction: BlendFunction.SRC,
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, THREE.Uniform>([
        ["uVelocity", new THREE.Uniform(new THREE.Vector2(0, 0))],
        ["uForwardVelocity", new THREE.Uniform(0)],
        ["uRollVelocity", new THREE.Uniform(0)],
        ["uIntensity", new THREE.Uniform(intensity)],
        ["uMaxBlur", new THREE.Uniform(maxBlur)],
        ["time", new THREE.Uniform(0)],
      ]),
    });
  }

  setVelocity(x: number, y: number): void {
    const uniform = this.uniforms.get("uVelocity");
    if (uniform) (uniform.value as THREE.Vector2).set(x, y);
  }

  setForwardVelocity(v: number): void {
    const uniform = this.uniforms.get("uForwardVelocity");
    if (uniform) uniform.value = v;
  }

  setRollVelocity(r: number): void {
    const uniform = this.uniforms.get("uRollVelocity");
    if (uniform) uniform.value = r;
  }

  set intensity(value: number) {
    const uniform = this.uniforms.get("uIntensity");
    if (uniform) uniform.value = value;
  }

  set maxBlur(value: number) {
    const uniform = this.uniforms.get("uMaxBlur");
    if (uniform) uniform.value = value;
  }

  update(
    _renderer: THREE.WebGLRenderer,
    _input: THREE.WebGLRenderTarget,
    deltaTime: number,
  ): void {
    const uniform = this.uniforms.get("time");
    if (uniform) uniform.value = (uniform.value as number) + deltaTime;
  }
}

/* ------------------------------------------------------------------ */
/* AgX Tone Mapping & Modern Warfare Color Grade                       */
/* ------------------------------------------------------------------ */

/**
 * AgX display transform with Modern Warfare cinematic color grading.
 * Preserves dark shadow details, avoids muddy crushed blacks, maintains
 * filmic highlight rolloff, and injects subtle military split-toning.
 */
const AGX_FRAGMENT = /* glsl */ `
uniform float exposure;
uniform float slope;
uniform float offset;
uniform float power;
uniform float saturation;

const mat3 LINEAR_SRGB_TO_LINEAR_REC2020 = mat3(
  vec3(0.6274, 0.0691, 0.0164),
  vec3(0.3293, 0.9195, 0.0880),
  vec3(0.0433, 0.0113, 0.8956)
);

const mat3 LINEAR_REC2020_TO_LINEAR_SRGB = mat3(
  vec3( 1.6605, -0.1246, -0.0182),
  vec3(-0.5876,  1.1329, -0.1006),
  vec3(-0.0728, -0.0083,  1.1187)
);

const mat3 AGX_INSET = mat3(
  vec3(0.856627153315983, 0.137318972929847, 0.111898212999950),
  vec3(0.095121240538159, 0.761241990602591, 0.076799418603190),
  vec3(0.048251606145858, 0.101439036467562, 0.811302368396859)
);

const mat3 AGX_OUTSET = mat3(
  vec3( 1.127100581814437, -0.141329763498438, -0.141329763498438),
  vec3(-0.110606643096603,  1.157823702216272, -0.110606643096603),
  vec3(-0.016493938717835, -0.016493938717834,  1.251936406595041)
);

const float AGX_MIN_EV = -12.47393;
const float AGX_MAX_EV = 4.026069;

vec3 agxContrast(vec3 x) {
  vec3 x2 = x * x;
  vec3 x4 = x2 * x2;
  return + 15.5   * x4 * x2
         - 40.14  * x4 * x
         + 31.96  * x4
         - 6.868  * x2 * x
         + 0.4298 * x2
         + 0.1191 * x
         - 0.00232;
}

/** ASC-CDL style grade with shadow toe lift and Modern Warfare palette. */
vec3 agxLook(vec3 c) {
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  // Gentle toe lift so deep shadows never harshly clip
  c = pow(max(vec3(0.0005), c * slope + offset), vec3(power));

  // Subtle military split-toning: cool slate shadows, warm sunlit highlights
  vec3 shadowTint = vec3(0.96, 0.98, 1.03);
  vec3 highlightTint = vec3(1.03, 1.01, 0.97);
  vec3 graded = mix(c * shadowTint, c * highlightTint, smoothstep(0.15, 0.75, luma));

  return luma + saturation * (graded - luma);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 color = max(inputColor.rgb, 0.0) * exposure;

  color = LINEAR_SRGB_TO_LINEAR_REC2020 * color;
  color = AGX_INSET * color;

  // log2 encode into the AgX working range
  color = log2(max(color, 1e-10));
  color = (color - AGX_MIN_EV) / (AGX_MAX_EV - AGX_MIN_EV);
  color = clamp(color, 0.0, 1.0);

  color = agxContrast(color);
  color = agxLook(color);

  color = AGX_OUTSET * color;

  // back to linear so composer output pass encodes to sRGB cleanly
  color = pow(max(color, 0.0), vec3(2.2));
  color = LINEAR_REC2020_TO_LINEAR_SRGB * color;

  outputColor = vec4(clamp(color, 0.0, 1.0), inputColor.a);
}
`;

export interface AgXToneMappingOptions {
  /** Linear exposure multiplier applied before the transform. */
  exposure?: number;
  /** ASC-CDL slope (contrast pivot gain). */
  slope?: number;
  /** ASC-CDL offset (lift). */
  offset?: number;
  /** ASC-CDL power (gamma); > 1 deepens the shadows. */
  power?: number;
  /** 1 = AgX default, > 1 restores chroma AgX intentionally desaturates. */
  saturation?: number;
}

export class AgXToneMappingEffect extends Effect {
  constructor({
    exposure = 1,
    slope = 1,
    offset = 0,
    power = 1,
    saturation = 1,
  }: AgXToneMappingOptions = {}) {
    super("AgXToneMappingEffect", AGX_FRAGMENT, {
      blendFunction: BlendFunction.SRC,
      uniforms: new Map<string, THREE.Uniform>([
        ["exposure", new THREE.Uniform(exposure)],
        ["slope", new THREE.Uniform(slope)],
        ["offset", new THREE.Uniform(offset)],
        ["power", new THREE.Uniform(power)],
        ["saturation", new THREE.Uniform(saturation)],
      ]),
    });
  }

  private setUniform(name: string, value: number): void {
    const uniform = this.uniforms.get(name);
    if (uniform) uniform.value = value;
  }

  set exposure(value: number) {
    this.setUniform("exposure", value);
  }

  set slope(value: number) {
    this.setUniform("slope", value);
  }

  set offset(value: number) {
    this.setUniform("offset", value);
  }

  set power(value: number) {
    this.setUniform("power", value);
  }

  set saturation(value: number) {
    this.setUniform("saturation", value);
  }
}

/* ------------------------------------------------------------------ */
/* Lens Artifacts: Spectral Chromatic Aberration & Grain               */
/* ------------------------------------------------------------------ */

const LENS_ARTIFACTS_FRAGMENT = /* glsl */ `
uniform float aberration;
uniform float blurStrength;
uniform float grainIntensity;
uniform float falloff;
uniform float vignette;

float lensArtifactsHash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

#define TAPS 6

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 centered = uv - 0.5;

  // Aspect-corrected radial distance, pristine at center, expanding at periphery
  vec2 shaped = vec2(centered.x * aspect, centered.y) * 2.0;
  float radius = min(length(shaped), 1.45);
  float edge = pow(radius, falloff);

  vec3 accum = vec3(0.0);
  float weightSum = 0.0;

  for (int i = 0; i < TAPS; i++) {
    float t = float(i) / float(TAPS - 1);

    // radial smear marching inward
    vec2 tap = -centered * (t * blurStrength * edge);
    // spectral dispersion chromatic fringing
    vec2 fringe = centered * (aberration * edge * (0.35 + 0.65 * t));

    float w = 1.0 - 0.45 * t;
    accum.r += texture2D(inputBuffer, uv + tap + fringe).r * w;
    accum.g += texture2D(inputBuffer, uv + tap).g * w;
    accum.b += texture2D(inputBuffer, uv + tap - fringe).b * w;
    weightSum += w;
  }

  vec3 color = accum / weightSum;

  // Edge darkening / natural optical vignetting
  color *= 1.0 - vignette * pow(radius, 2.4);

  // Cinematic 35mm film grain, peaking naturally in midtones
  float noise = lensArtifactsHash13(vec3(uv * resolution, floor(time * 24.0)));
  float lum = dot(color, vec3(0.2126, 0.7152, 0.0722));
  float mask = 4.0 * lum * (1.0 - lum);
  color += (noise - 0.5) * grainIntensity * clamp(mask, 0.0, 1.0);

  outputColor = vec4(max(color, 0.0), inputColor.a);
}
`;

export interface LensArtifactsOptions {
  aberration?: number;
  blurStrength?: number;
  grainIntensity?: number;
  falloff?: number;
  vignette?: number;
}

export class LensArtifactsEffect extends Effect {
  constructor({
    aberration = 0.0016,
    blurStrength = 0.004,
    grainIntensity = 0.022,
    falloff = 2.4,
    vignette = 0.06,
  }: LensArtifactsOptions = {}) {
    super("LensArtifactsEffect", LENS_ARTIFACTS_FRAGMENT, {
      blendFunction: BlendFunction.SRC,
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, THREE.Uniform>([
        ["aberration", new THREE.Uniform(aberration)],
        ["blurStrength", new THREE.Uniform(blurStrength)],
        ["grainIntensity", new THREE.Uniform(grainIntensity)],
        ["falloff", new THREE.Uniform(falloff)],
        ["vignette", new THREE.Uniform(vignette)],
      ]),
    });
  }

  private setUniform(name: string, value: number): void {
    const uniform = this.uniforms.get(name);
    if (uniform) uniform.value = value;
  }

  set aberration(value: number) {
    this.setUniform("aberration", value);
  }

  set blurStrength(value: number) {
    this.setUniform("blurStrength", value);
  }

  set grainIntensity(value: number) {
    this.setUniform("grainIntensity", value);
  }

  set falloff(value: number) {
    this.setUniform("falloff", value);
  }

  set vignette(value: number) {
    this.setUniform("vignette", value);
  }
}

/* ------------------------------------------------------------------ */
/* Anamorphic Streaks (Multi-pass)                                    */
/* ------------------------------------------------------------------ */

const FULLSCREEN_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

const STREAK_BRIGHT_FRAGMENT = /* glsl */ `
uniform sampler2D inputBuffer;
uniform vec2 texelSize;
uniform float threshold;
uniform float knee;
varying vec2 vUv;

vec3 prefilter(vec3 c) {
  float brightness = max(max(c.r, c.g), c.b);
  float soft = clamp(brightness - threshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee + 1e-5);
  float contribution = max(soft, brightness - threshold) / max(brightness, 1e-5);
  return c * contribution;
}

void main() {
  vec3 sum = vec3(0.0);
  sum += prefilter(texture2D(inputBuffer, vUv + texelSize * vec2(-1.0, -1.0)).rgb);
  sum += prefilter(texture2D(inputBuffer, vUv + texelSize * vec2( 1.0, -1.0)).rgb);
  sum += prefilter(texture2D(inputBuffer, vUv + texelSize * vec2(-1.0,  1.0)).rgb);
  sum += prefilter(texture2D(inputBuffer, vUv + texelSize * vec2( 1.0,  1.0)).rgb);
  sum += prefilter(texture2D(inputBuffer, vUv + texelSize * vec2( 0.0, -2.0)).rgb);
  sum += prefilter(texture2D(inputBuffer, vUv + texelSize * vec2( 0.0,  2.0)).rgb);
  gl_FragColor = vec4(sum / 6.0, 1.0);
}
`;

const STREAK_BLUR_FRAGMENT = /* glsl */ `
uniform sampler2D inputBuffer;
uniform vec2 texelSize;
uniform vec2 direction;
uniform float stride;
varying vec2 vUv;

void main() {
  vec2 step = direction * texelSize * stride;
  vec3 sum = vec3(0.0);
  float weightSum = 0.0;
  for (int i = -4; i <= 4; i++) {
    float fi = float(i);
    float w = exp(-0.5 * fi * fi / 4.84);
    sum += texture2D(inputBuffer, vUv + step * fi).rgb * w;
    weightSum += w;
  }
  gl_FragColor = vec4(sum / weightSum, 1.0);
}
`;

const STREAK_COMPOSITE_FRAGMENT = /* glsl */ `
uniform sampler2D inputBuffer;
uniform sampler2D streakBuffer;
uniform vec3 tint;
uniform float intensity;
varying vec2 vUv;

void main() {
  vec4 base = texture2D(inputBuffer, vUv);
  vec3 streak = texture2D(streakBuffer, vUv).rgb;
  gl_FragColor = vec4(base.rgb + streak * tint * intensity, base.a);
}
`;

function fullscreenMaterial(
  fragmentShader: string,
  uniforms: Record<string, THREE.IUniform>,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: "AnamorphicStreaks",
    vertexShader: FULLSCREEN_VERTEX,
    fragmentShader,
    uniforms,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
}

export interface AnamorphicStreaksOptions {
  threshold?: number;
  knee?: number;
  intensity?: number;
  tint?: THREE.ColorRepresentation;
  iterations?: number;
  resolutionScale?: number;
}

export class AnamorphicStreaksPass extends Pass {
  private readonly targetA: THREE.WebGLRenderTarget;
  private readonly targetB: THREE.WebGLRenderTarget;
  private readonly brightMaterial: THREE.ShaderMaterial;
  private readonly blurMaterial: THREE.ShaderMaterial;
  private readonly compositeMaterial: THREE.ShaderMaterial;
  private readonly iterations: number;
  private readonly resolutionScale: number;

  constructor({
    threshold = 0.72,
    knee = 0.25,
    intensity = 0.5,
    tint = "#8fb8ff",
    iterations = 4,
    resolutionScale = 4,
  }: AnamorphicStreaksOptions = {}) {
    super("AnamorphicStreaksPass");

    this.needsSwap = true;
    this.iterations = Math.max(1, Math.round(iterations));
    this.resolutionScale = Math.max(1, resolutionScale);

    const targetOptions = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
      type: THREE.HalfFloatType,
    } satisfies THREE.RenderTargetOptions;

    this.targetA = new THREE.WebGLRenderTarget(1, 1, targetOptions);
    this.targetA.texture.name = "AnamorphicStreaks.A";
    this.targetB = new THREE.WebGLRenderTarget(1, 1, targetOptions);
    this.targetB.texture.name = "AnamorphicStreaks.B";

    this.brightMaterial = fullscreenMaterial(STREAK_BRIGHT_FRAGMENT, {
      inputBuffer: { value: null },
      texelSize: { value: new THREE.Vector2() },
      threshold: { value: threshold },
      knee: { value: knee },
    });

    this.blurMaterial = fullscreenMaterial(STREAK_BLUR_FRAGMENT, {
      inputBuffer: { value: null },
      texelSize: { value: new THREE.Vector2() },
      direction: { value: new THREE.Vector2(1, 0) },
      stride: { value: 1 },
    });

    this.compositeMaterial = fullscreenMaterial(STREAK_COMPOSITE_FRAGMENT, {
      inputBuffer: { value: null },
      streakBuffer: { value: null },
      tint: { value: new THREE.Color(tint) },
      intensity: { value: intensity },
    });
  }

  get intensity(): number {
    return this.compositeMaterial.uniforms.intensity?.value as number;
  }

  set intensity(value: number) {
    const uniform = this.compositeMaterial.uniforms.intensity;
    if (uniform) uniform.value = value;
  }

  set threshold(value: number) {
    const uniform = this.brightMaterial.uniforms.threshold;
    if (uniform) uniform.value = value;
  }

  set tint(value: THREE.ColorRepresentation) {
    const uniform = this.compositeMaterial.uniforms.tint;
    if (uniform) (uniform.value as THREE.Color).set(value);
  }

  override setSize(width: number, height: number): void {
    const w = Math.max(1, Math.round(width / this.resolutionScale));
    const h = Math.max(1, Math.round(height / this.resolutionScale));
    this.targetA.setSize(w, h);
    this.targetB.setSize(w, h);

    const sourceTexel = this.brightMaterial.uniforms.texelSize;
    if (sourceTexel) {
      (sourceTexel.value as THREE.Vector2).set(
        1 / Math.max(1, width),
        1 / Math.max(1, height),
      );
    }
    const blurTexel = this.blurMaterial.uniforms.texelSize;
    if (blurTexel) (blurTexel.value as THREE.Vector2).set(1 / w, 1 / h);
  }

  override render(
    renderer: THREE.WebGLRenderer,
    inputBuffer: THREE.WebGLRenderTarget | null,
    outputBuffer: THREE.WebGLRenderTarget | null,
  ): void {
    if (inputBuffer === null) return;

    // 1. bright pass + downsample
    const brightInput = this.brightMaterial.uniforms.inputBuffer;
    if (brightInput) brightInput.value = inputBuffer.texture;
    this.fullscreenMaterial = this.brightMaterial;
    renderer.setRenderTarget(this.targetA);
    renderer.render(this.scene, this.camera);

    // 2. widening horizontal blur ping-pong
    let source = this.targetA;
    let destination = this.targetB;
    const blurInput = this.blurMaterial.uniforms.inputBuffer;
    const blurStride = this.blurMaterial.uniforms.stride;
    this.fullscreenMaterial = this.blurMaterial;
    for (let i = 0; i < this.iterations; i++) {
      if (blurInput) blurInput.value = source.texture;
      if (blurStride) blurStride.value = Math.pow(4, i);
      renderer.setRenderTarget(destination);
      renderer.render(this.scene, this.camera);
      const swap = source;
      source = destination;
      destination = swap;
    }

    // 3. additive composite over scene
    const compositeInput = this.compositeMaterial.uniforms.inputBuffer;
    if (compositeInput) compositeInput.value = inputBuffer.texture;
    const compositeStreak = this.compositeMaterial.uniforms.streakBuffer;
    if (compositeStreak) compositeStreak.value = source.texture;
    this.fullscreenMaterial = this.compositeMaterial;
    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
    renderer.render(this.scene, this.camera);
  }

  override dispose(): void {
    this.targetA.dispose();
    this.targetB.dispose();
    this.brightMaterial.dispose();
    this.blurMaterial.dispose();
    this.compositeMaterial.dispose();
    super.dispose();
  }
}
