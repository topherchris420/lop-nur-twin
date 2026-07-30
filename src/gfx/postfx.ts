import * as THREE from "three";
import { BlendFunction, Effect, EffectAttribute, Pass } from "postprocessing";

/**
 * Custom GLSL post-processing stack for the desert airfield twin.
 *
 * Everything here is hand-written GLSL running inside the `postprocessing`
 * composer, in this order (see `components/scene/Effects.tsx`):
 *
 *   scene (HDR, linear, no tone mapping)
 *     -> N8AO                     ambient occlusion
 *     -> Bloom (mipmap/dual-filter)
 *     -> AnamorphicStreaksPass    multi-pass horizontal lens streaks
 *     -> AgXToneMappingEffect     HDR -> display, keeps highlights intact
 *     -> Vignette
 *     -> SMAA                     antialiasing on display-referred values
 *     -> LensArtifactsEffect      chromatic aberration + radial blur + grain
 *
 * The renderer itself must be `THREE.NoToneMapping` while this stack is
 * mounted — `Atmosphere.tsx` owns that decision and `EffectComposer` also
 * forces it. Tone mapping twice is the classic washed-out-render bug.
 */

/* ------------------------------------------------------------------ */
/* Shared GLSL                                                         */
/* ------------------------------------------------------------------ */

const LUMA = "const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);";

/** Cheap, stable integer-ish hash. Deterministic across drivers in practice. */
const HASH_GLSL = /* glsl */ `
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
`;

/* ------------------------------------------------------------------ */
/* AgX tone mapping                                                    */
/* ------------------------------------------------------------------ */

/**
 * AgX display transform.
 *
 * Matrices, the 6th-order sigmoid fit and the Rec.2020 round-trip follow
 * three.js' `AgXToneMapping` (which in turn follows Troy Sobotka's AgX and
 * Missing Deadlines' minimal implementation). The extra `agxLook` stage is
 * the Blender "punchy" look, exposed as uniforms so the scene can be tuned
 * from the probe screenshots.
 *
 * Output is **linear** (the `pow(x, 2.2)` un-does the display encode) because
 * the composer's final pass applies the sRGB transfer function itself.
 */
const AGX_FRAGMENT = /* glsl */ `
uniform float exposure;
uniform float slope;
uniform float offset;
uniform float power;
uniform float saturation;

${LUMA}

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

/** ASC-CDL style grade applied in AgX base space, then saturation. */
vec3 agxLook(vec3 c) {
  float luma = dot(c, LUMA);
  c = pow(max(vec3(0.0), c * slope + offset), vec3(power));
  return luma + saturation * (c - luma);
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

  // back to linear so the composer's output pass can encode to sRGB once
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
/* Lens artifacts: chromatic aberration, radial blur, film grain        */
/* ------------------------------------------------------------------ */

/**
 * Screen-space sensor/lens artifacts, gathered in a single loop so the
 * radial blur taps double as the chromatic aberration taps.
 *
 * All three terms scale with `pow(radius, falloff)` so the centre of frame
 * stays clean and only the edges pick up the lens character.
 */
const LENS_ARTIFACTS_FRAGMENT = /* glsl */ `
uniform float aberration;
uniform float blurStrength;
uniform float grainIntensity;
uniform float falloff;
uniform float vignette;

${LUMA}
${HASH_GLSL}

#define TAPS 6

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 centered = uv - 0.5;

  // circular radius regardless of viewport aspect, 0 at centre, 1 at the
  // shorter edge, slightly above 1 in the corners
  vec2 shaped = vec2(centered.x * aspect, centered.y) * 2.0;
  float radius = min(length(shaped), 1.45);
  float edge = pow(radius, falloff);

  vec3 accum = vec3(0.0);
  float weightSum = 0.0;

  for (int i = 0; i < TAPS; i++) {
    float t = float(i) / float(TAPS - 1);

    // radial blur: march back toward the frame centre
    vec2 tap = -centered * (t * blurStrength * edge);
    // aberration grows along the tap so the fringe smears rather than ghosts
    vec2 fringe = centered * (aberration * edge * (0.35 + 0.65 * t));

    float w = 1.0 - 0.5 * t;
    accum.r += texture2D(inputBuffer, uv + tap + fringe).r * w;
    accum.g += texture2D(inputBuffer, uv + tap).g * w;
    accum.b += texture2D(inputBuffer, uv + tap - fringe).b * w;
    weightSum += w;
  }

  vec3 color = accum / weightSum;

  // extra edge falloff on top of the composer's vignette, keyed to the same
  // radius so the lens reads as one piece of glass
  color *= 1.0 - vignette * pow(radius, 2.4);

  // 24 fps film grain, heavier in the shadows where real film noise lives
  float noise = hash13(vec3(uv * resolution, floor(time * 24.0)));
  float mask = mix(1.0, 0.28, smoothstep(0.02, 0.7, dot(color, LUMA)));
  color += (noise - 0.5) * grainIntensity * mask;

  outputColor = vec4(max(color, 0.0), inputColor.a);
}
`;

export interface LensArtifactsOptions {
  /** UV-space colour split at the frame edge. Keep below ~0.004. */
  aberration?: number;
  /** UV-space radial smear length at the frame edge. */
  blurStrength?: number;
  /** Peak grain amplitude in display-referred units. */
  grainIntensity?: number;
  /** Radial exponent; higher keeps more of the frame centre pristine. */
  falloff?: number;
  /** Additional radial darkening. */
  vignette?: number;
}

export class LensArtifactsEffect extends Effect {
  constructor({
    aberration = 0.0016,
    blurStrength = 0.004,
    grainIntensity = 0.022,
    falloff = 2.2,
    vignette = 0.06,
  }: LensArtifactsOptions = {}) {
    super("LensArtifactsEffect", LENS_ARTIFACTS_FRAGMENT, {
      blendFunction: BlendFunction.SRC,
      // samples inputBuffer at offsets, so it needs its own pass
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
/* Anamorphic streaks (multi-pass)                                     */
/* ------------------------------------------------------------------ */

/** Fullscreen-triangle vertex shader matching `Pass.fullscreenGeometry`. */
const FULLSCREEN_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

/**
 * Bright pass + downsample. Prefilters with a soft knee so mid-tones do not
 * leak into the streaks, and takes extra vertical taps so the streak has some
 * thickness instead of being one texel tall.
 */
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

/**
 * Separable Gaussian tap run repeatedly with a growing stride — the
 * dual-filter trick that reaches hundreds of pixels for the cost of nine
 * samples per pass.
 */
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
  /** Luminance above which pixels streak. */
  threshold?: number;
  /** Soft-knee width below the threshold. */
  knee?: number;
  /** Additive strength of the streak. */
  intensity?: number;
  /** Streak colour; classic anamorphic glass is cyan-blue. */
  tint?: THREE.ColorRepresentation;
  /** Number of blur iterations. Each one quadruples the reach. */
  iterations?: number;
  /** Working resolution divisor. 4 = quarter res. */
  resolutionScale?: number;
}

/**
 * Horizontal anamorphic streaks as a real multi-pass: bright pass into a
 * quarter-res target, then N horizontal blur ping-pongs with exponentially
 * growing stride, then an additive composite back over the scene.
 *
 * Mounted as a raw `Pass` (via `<primitive>`), the same way
 * `@react-three/postprocessing` mounts N8AO.
 */
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

    // this pass writes the composited image into the output buffer
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
      (sourceTexel.value as THREE.Vector2).set(1 / Math.max(1, width), 1 / Math.max(1, height));
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

    // 2. widening horizontal blur, ping-ponging between the two targets
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

    // 3. additive composite over the untouched scene colour
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
