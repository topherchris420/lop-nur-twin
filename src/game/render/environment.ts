import * as THREE from "three";

/**
 * Image-based lighting, generated at runtime.
 *
 * Without an environment map every metal reflects nothing and renders
 * near-black, which is why procedural hard-surface work so often reads as
 * plastic. Downloading an HDRI is off the table here (no binary assets, no
 * runtime fetches), so the radiance is generated: a bounded analytic sky is
 * drawn into a small scene and pre-filtered through `PMREMGenerator` into a
 * roughness-mipped cube.
 *
 * Enhanced with volumetric forward-scattering atmospheric shafts, desert
 * lakebed ground bounce for weapon bevels and soldier silhouettes, and
 * safe radiance ceiling to prevent half-float convolution overflow.
 */

const VERTEX = /* glsl */ `
varying vec3 vDirection;
void main() {
  vDirection = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uSunDirection;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunColor;
uniform float uSunIntensity;
uniform float uTurbidity;
// 0: the world's smooth sky. 1: the weapon's, with a horizon to reflect.
uniform float uStructure;

varying vec3 vDirection;

float envHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

// value noise around the horizon, seamless in azimuth: \`a\` is in turns
float envRing(float a, float cells) {
  float x = a * cells;
  float i = floor(x);
  float f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(envHash(vec2(mod(i, cells), cells)), envHash(vec2(mod(i + 1.0, cells), cells)), f);
}

// Henyey-Greenstein atmospheric scattering phase function
float henyeyGreenstein(float cosTheta, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (4.0 * 3.14159265 * pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5));
}

void main() {
  vec3 dir = normalize(vDirection);
  float up = dir.y;

  // Sky gradient: zenith to horizon with Rayleigh-like falloff, then a
  // warmer dusty band right at the horizon where the optical path is longest.
  float t = clamp(up, 0.0, 1.0);
  vec3 sky = mix(uHorizon, uZenith, pow(t, 0.45));
  float haze = pow(1.0 - t, 5.5);
  sky = mix(sky, uHorizon * 1.22, haze * 0.62);

  // Ground hemisphere: lakebed bounce light.
  // Highlights weapon undersides, rifle bevels, and soldier silhouettes.
  float down = clamp(-up, 0.0, 1.0);
  vec3 ground = uGround * mix(1.15, 0.38, pow(down, 0.55));
  ground += uGround * pow(1.0 - down, 3.0) * 0.28;

  if (uStructure > 0.0) {
    // What a rifle needs to reflect is a horizon. In the smooth sky the
    // ground just below it was brighter than the sky just above it, so every
    // metal face read as one warm grey from any angle. A photographed desert
    // sky has the reverse: a bright band of haze over the horizon, a darker
    // ridge line under it, and the lakebed brightening again toward the feet.
    float turns = atan(dir.z, dir.x) / 6.2831853 + 0.5;
    // haze band, brighter than anything on the ground near the horizon
    sky += uHorizon * 0.95 * exp(-max(up, 0.0) / 0.07);
    // thin, slow cloud wisps so a flat face does not reflect one tint
    float wisps = envRing(turns, 9.0) * 0.6 + envRing(turns + 0.37, 23.0) * 0.4;
    sky *= 1.0 + (wisps - 0.5) * 0.22 * smoothstep(0.03, 0.12, up) * (1.0 - smoothstep(0.35, 0.7, up));
    // the ground near the horizon reads darker than the haze above it
    ground *= mix(0.62, 1.0, smoothstep(0.0, 0.35, down));
  }

  // Soft horizon blend so pre-filter sees a seamless transition
  float blend = smoothstep(-0.04, 0.04, up);
  vec3 color = mix(ground, sky, blend);

  if (uStructure > 0.0) {
    // distant ridges: a low, broken silhouette sitting on the horizon
    float turns = atan(dir.z, dir.x) / 6.2831853 + 0.5;
    float ridge = 0.012 + 0.03 * (envRing(turns, 14.0) * 0.7 + envRing(turns + 0.11, 41.0) * 0.3);
    float onRidge = (1.0 - smoothstep(ridge - 0.006, ridge + 0.004, up)) * smoothstep(-0.03, 0.0, up);
    color = mix(color, uGround * 0.58 + uHorizon * 0.22, onRidge);
  }

  // Sun: solar disc with volumetric Mie atmospheric forward-scattering glow
  float cosAngle = dot(dir, uSunDirection);
  float disc = smoothstep(0.9996, 0.99995, cosAngle);

  float forwardScatter = henyeyGreenstein(max(cosAngle, 0.0), 0.72) * 0.45;
  float wideGlow = pow(max(cosAngle, 0.0), 24.0) * 0.06 * uTurbidity;
  float tightGlow = pow(max(cosAngle, 0.0), 320.0) * 0.45;

  color += uSunColor * (disc * uSunIntensity + (forwardScatter + wideGlow + tightGlow) * uSunIntensity * 0.02);

  // Hard ceiling on radiance keeps the half-float convolution finite
  color = min(color, vec3(35.0));
  gl_FragColor = vec4(color, 1.0);
}
`;

export interface EnvironmentOptions {
  /** Sun elevation in radians. Negative is below the horizon. */
  elevationRad: number;
  /** Sun azimuth in radians, matching the atmosphere's convention. */
  azimuthRad: number;
  /** 0 = night, 1 = day. */
  dayFactor: number;
}

const DAY_ZENITH = new THREE.Color(0.065, 0.12, 0.24);
const DAY_HORIZON = new THREE.Color(0.285, 0.282, 0.258);
const DAY_GROUND = new THREE.Color(0.32, 0.265, 0.195);
const NIGHT_ZENITH = new THREE.Color(0.012, 0.02, 0.042);
const NIGHT_HORIZON = new THREE.Color(0.035, 0.045, 0.062);
const NIGHT_GROUND = new THREE.Color(0.014, 0.012, 0.01);
const SUN_WARM = new THREE.Color(1.0, 0.95, 0.86);
const SUN_LOW = new THREE.Color(1.0, 0.62, 0.32);

export class EnvironmentLighting {
  private readonly pmrem: THREE.PMREMGenerator;
  private readonly scene = new THREE.Scene();
  private readonly material: THREE.ShaderMaterial;
  private cachedKey: string | null = null;
  /**
   * The whole render target `fromScene` returns, not just its texture:
   * disposing only the texture leaves the framebuffer and depth renderbuffer
   * behind on every regenerate.
   */
  private cachedTarget: THREE.WebGLRenderTarget | null = null;

  /**
   * `structured` draws the weapon's variant: the same sky and sun, with a
   * haze band, a ridge line and the near ground darkened, so a metal face has
   * a horizon to reflect. The world keeps the smooth sky its buildings and
   * soldiers were tuned under.
   */
  constructor(renderer: THREE.WebGLRenderer, { structured = false } = {}) {
    this.pmrem = new THREE.PMREMGenerator(renderer);

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      side: THREE.BackSide,
      depthWrite: false,
      toneMapped: false,
      uniforms: {
        uSunDirection: { value: new THREE.Vector3(0, 1, 0) },
        uZenith: { value: DAY_ZENITH.clone() },
        uHorizon: { value: DAY_HORIZON.clone() },
        uGround: { value: DAY_GROUND.clone() },
        uSunColor: { value: SUN_WARM.clone() },
        uSunIntensity: { value: 92 },
        uTurbidity: { value: 1.6 },
        uStructure: { value: structured ? 1 : 0 },
      },
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 24), this.material);
    dome.frustumCulled = false;
    this.scene.add(dome);
  }

  /**
   * Returns a radiance map for the given sun state, rebuilding only when the
   * light has moved enough to matter.
   */
  get(options: EnvironmentOptions): THREE.Texture {
    const bucket = Math.round((options.elevationRad * 180) / Math.PI / 3);
    const key = `${bucket}|${options.dayFactor.toFixed(2)}`;
    if (this.cachedTarget && this.cachedKey === key) return this.cachedTarget.texture;

    const elev = options.elevationRad;
    const az = options.azimuthRad;
    const u = this.material.uniforms;
    (u["uSunDirection"]!.value as THREE.Vector3)
      .set(Math.sin(az) * Math.cos(elev), Math.sin(elev), -Math.cos(az) * Math.cos(elev))
      .normalize();

    const day = THREE.MathUtils.clamp(options.dayFactor, 0, 1);
    const above = THREE.MathUtils.clamp(Math.sin(elev) * 3, 0, 1);
    (u["uZenith"]!.value as THREE.Color).lerpColors(
      NIGHT_ZENITH,
      DAY_ZENITH,
      day * above,
    );
    (u["uHorizon"]!.value as THREE.Color).lerpColors(
      NIGHT_HORIZON,
      DAY_HORIZON,
      day * above,
    );
    (u["uGround"]!.value as THREE.Color).lerpColors(
      NIGHT_GROUND,
      DAY_GROUND,
      day * above,
    );
    (u["uSunColor"]!.value as THREE.Color).lerpColors(SUN_LOW, SUN_WARM, above);
    u["uSunIntensity"]!.value = 46 * Math.pow(above, 0.6) * day;
    u["uTurbidity"]!.value = 1.4 + (1 - above) * 1.8;

    const target = this.pmrem.fromScene(this.scene, 0, 1, 200);
    this.cachedTarget?.dispose();
    this.cachedKey = key;
    this.cachedTarget = target;
    return target.texture;
  }

  dispose(): void {
    this.cachedTarget?.dispose();
    this.cachedTarget = null;
    this.pmrem.dispose();
    this.material.dispose();
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
  }
}

/** The atmosphere's sun sweep, exposed so the environment can track it. */
export const SUN = {
  azimuthDeg: 112,
  nightElevationDeg: -26,
  dayElevationDeg: 29,
} as const;

export function sunElevationRad(dayFactor: number): number {
  return THREE.MathUtils.degToRad(
    THREE.MathUtils.lerp(SUN.nightElevationDeg, SUN.dayElevationDeg, dayFactor),
  );
}
