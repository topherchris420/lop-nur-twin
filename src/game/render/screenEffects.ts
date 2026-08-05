import * as THREE from "three";
import { BlendFunction, Effect } from "postprocessing";

/**
 * Screen-space effects for the combat layer.
 *
 * `HdrGuardEffect` is the important one and it is not cosmetic: it makes the
 * rest of the HDR chain numerically safe.
 */

/* ------------------------------------------------------------------ */
/* HDR guard                                                           */
/* ------------------------------------------------------------------ */

const HDR_GUARD_FRAGMENT = /* glsl */ `
uniform float ceiling;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 color = inputColor.rgb;
  // Replace anything that is not a finite number. NaN fails every comparison,
  // so \`!(x >= 0.0 || x <= 0.0)\` is the portable NaN test in GLSL ES 1.0.
  bvec3 bad = bvec3(
    !(color.r >= 0.0 || color.r <= 0.0),
    !(color.g >= 0.0 || color.g <= 0.0),
    !(color.b >= 0.0 || color.b <= 0.0)
  );
  color = mix(color, vec3(0.0), vec3(bad));
  outputColor = vec4(min(color, vec3(ceiling)), inputColor.a);
}
`;

export interface HdrGuardOptions {
  /**
   * Maximum linear radiance allowed through. Must be comfortably below the
   * half-float maximum (65504) so that downstream convolutions — which sum
   * many taps — cannot overflow either.
   */
  ceiling?: number;
}

/**
 * Clamps the scene buffer to a finite radiance and scrubs non-finite values.
 *
 * The analytic sky's solar disc reaches radiances far above the half-float
 * range the composer's buffer uses. Once a pixel saturates to `Inf`, the
 * mipmap blur inside the bloom pass averages `Inf` with its neighbours,
 * `Inf - Inf` produces `NaN`, and the `NaN` spreads across the whole
 * downsample pyramid — which is why an unguarded chain renders the entire
 * frame black the moment the sun enters the shot, while the same chain looks
 * perfect when it does not. Placing this first costs one full-screen pass and
 * removes the failure mode completely.
 */
export class HdrGuardEffect extends Effect {
  constructor({ ceiling = 900 }: HdrGuardOptions = {}) {
    super("HdrGuardEffect", HDR_GUARD_FRAGMENT, {
      blendFunction: BlendFunction.SRC,
      uniforms: new Map<string, THREE.Uniform>([["ceiling", new THREE.Uniform(ceiling)]]),
    });
  }

  set ceiling(value: number) {
    const uniform = this.uniforms.get("ceiling");
    if (uniform) uniform.value = value;
  }
}

/* ------------------------------------------------------------------ */
/* Shared exposure handle                                              */
/* ------------------------------------------------------------------ */

let activeExposure = 1.05;

/** Called by the composer whenever it retunes. */
export function setPostExposure(value: number): void {
  activeExposure = value;
}

/**
 * The exposure the composer is currently tone mapping with.
 *
 * The viewmodel is drawn in its own pass and has to tone map itself. If it
 * uses a different exposure the weapon reads as a brighter, flatter object
 * pasted over the scene — which is exactly what happens if it is left at the
 * renderer default while the composer runs at half that. This lives here, not
 * in the composer module, so the player rig can read it without statically
 * importing the lazily-loaded post-processing chunk.
 */
export function getPostExposure(): number {
  return activeExposure;
}

/* ------------------------------------------------------------------ */
/* Combat screen feedback                                              */
/* ------------------------------------------------------------------ */

const COMBAT_FRAGMENT = /* glsl */ `
uniform float hitIntensity;
uniform vec2 hitDirection;
uniform float flashIntensity;
uniform float suppression;
uniform float lowHealth;
uniform float scopeMask;
uniform float time;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 color = inputColor.rgb;
  vec2 centred = uv - 0.5;
  float radius = length(centred) * 2.0;

  // Suppression: the edges go soft and grey while rounds are cracking past.
  if (suppression > 0.001) {
    float edge = smoothstep(0.35, 1.25, radius) * suppression;
    float grey = dot(color, vec3(0.2126, 0.7152, 0.0722));
    color = mix(color, vec3(grey), edge * 0.55);
    color *= 1.0 - edge * 0.18;
  }

  // Low health: desaturate and push a red bloom in from the corners.
  if (lowHealth > 0.001) {
    float grey = dot(color, vec3(0.2126, 0.7152, 0.0722));
    color = mix(color, vec3(grey), lowHealth * 0.4);
    float pulse = 0.72 + 0.28 * sin(time * 5.4);
    color += vec3(0.42, 0.02, 0.02) * smoothstep(0.25, 1.2, radius) * lowHealth * pulse;
  }

  // Directional hit flash: a bright arc on the side the damage came from.
  if (hitIntensity > 0.001) {
    vec2 dir = normalize(centred + 1e-5);
    float alignment = max(0.0, dot(dir, normalize(hitDirection + 1e-5)));
    float arc = pow(alignment, 3.0) * smoothstep(0.2, 1.1, radius);
    color += vec3(0.75, 0.06, 0.04) * arc * hitIntensity;
  }

  // Flashbang: a bleaching white-out that recovers unevenly across the frame.
  if (flashIntensity > 0.001) {
    float grain = hash(uv * 512.0 + time) * 0.06;
    color = mix(color, vec3(1.0 + grain), clamp(flashIntensity, 0.0, 1.0));
  }

  // Scope vignette: a hard black surround with a soft optical edge.
  if (scopeMask > 0.001) {
    float lens = 1.0 - smoothstep(0.62, 0.78, radius);
    color = mix(color, color * lens, scopeMask);
  }

  outputColor = vec4(color, inputColor.a);
}
`;

/**
 * Damage, suppression, flashbang and scope feedback in one pass.
 *
 * Driven imperatively so the game layer can push values every frame without
 * touching React state.
 */
export class CombatScreenEffect extends Effect {
  private hit = 0;
  private flash = 0;

  constructor() {
    super("CombatScreenEffect", COMBAT_FRAGMENT, {
      blendFunction: BlendFunction.SRC,
      uniforms: new Map<string, THREE.Uniform>([
        ["hitIntensity", new THREE.Uniform(0)],
        ["hitDirection", new THREE.Uniform(new THREE.Vector2(0, 1))],
        ["flashIntensity", new THREE.Uniform(0)],
        ["suppression", new THREE.Uniform(0)],
        ["lowHealth", new THREE.Uniform(0)],
        ["scopeMask", new THREE.Uniform(0)],
        ["time", new THREE.Uniform(0)],
      ]),
    });
  }

  private uniform(name: string): THREE.Uniform | undefined {
    return this.uniforms.get(name);
  }

  /** `direction` is a screen-space vector pointing at the damage source. */
  triggerHit(direction: THREE.Vector2, amount: number): void {
    this.hit = Math.min(1.4, this.hit + amount);
    const uniform = this.uniform("hitDirection");
    if (uniform) (uniform.value as THREE.Vector2).copy(direction).normalize();
  }

  triggerFlash(amount: number): void {
    this.flash = Math.min(1.6, this.flash + amount);
  }

  setSuppression(value: number): void {
    const uniform = this.uniform("suppression");
    if (uniform) uniform.value = THREE.MathUtils.clamp(value, 0, 1);
  }

  setLowHealth(value: number): void {
    const uniform = this.uniform("lowHealth");
    if (uniform) uniform.value = THREE.MathUtils.clamp(value, 0, 1);
  }

  setScope(value: number): void {
    const uniform = this.uniform("scopeMask");
    if (uniform) uniform.value = THREE.MathUtils.clamp(value, 0, 1);
  }

  update(
    _renderer: THREE.WebGLRenderer,
    _input: THREE.WebGLRenderTarget,
    deltaTime: number,
  ): void {
    const dt = Math.min(0.1, deltaTime);
    // A hit reads as a fast punch and a slower settle; a flashbang holds then
    // bleaches out over a couple of seconds.
    this.hit *= Math.exp(-6.5 * dt);
    this.flash *= Math.exp(-0.85 * dt);
    const hitUniform = this.uniform("hitIntensity");
    if (hitUniform) hitUniform.value = this.hit;
    const flashUniform = this.uniform("flashIntensity");
    if (flashUniform) flashUniform.value = this.flash;
    const timeUniform = this.uniform("time");
    if (timeUniform) timeUniform.value = (timeUniform.value as number) + dt;
  }
}
