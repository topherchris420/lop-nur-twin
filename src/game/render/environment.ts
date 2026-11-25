import * as THREE from "three";
import { GROUND_MOON_DIRECTION, SKY_MODEL_GLSL, type SkyUniforms } from "./skyModel";

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
 * The upper hemisphere is `skyModel.ts`, the same clear sky and cloud deck the
 * dome draws, so the light that fills a shadow is the colour of the sky you
 * can see: blue from above, which is what turns desert shade blue rather than
 * grey. The lower hemisphere is the lakebed in sunlight — warm, and as bright
 * as the sunlit ground really is — so a wall's foot and a soldier's underside
 * pick up warm bounce instead of a uniform wash. Toward the horizon the ground
 * fades into the same haze the aerial perspective pass uses.
 *
 * The result is bounded (`min(color, 35)`), because anything feeding the
 * convolution must stay finite in half float.
 */

const VERTEX = /* glsl */ `
varying vec3 vDirection;
void main() {
  vDirection = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
${SKY_MODEL_GLSL}
uniform vec3 uGround;
uniform float uSkyScale;
// 0: the world's sky. 1: the weapon's, with a horizon to reflect.
uniform float uStructure;

varying vec3 vDirection;

float envHash(vec2 p) {
  vec3 q = fract(p.xyx * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

// value noise around the horizon, seamless in azimuth: \`a\` is in turns
float envRing(float a, float cells) {
  float x = a * cells;
  float i = floor(x);
  float f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(envHash(vec2(mod(i, cells), cells)), envHash(vec2(mod(i + 1.0, cells), cells)), f);
}

void main() {
  vec3 dir = normalize(vDirection);
  float up = dir.y;

  vec3 sky = skyClear(dir);
  vec4 cloud = skyClouds(dir, sky);
  sky = sky * (1.0 - cloud.a) + cloud.rgb;
  // No hard disc in a pre-filtered map. The weapon's map keeps a tight lobe
  // for smooth metal's highlight and a broad one for its glow, both bounded.
  // The world's does not: the directional light already carries the sun, and
  // a lobe here is sunlight again, unshadowed, filling every shade warm.
  if (uStructure > 0.0) {
    float cosSun = max(dot(dir, skySunDir), 0.0);
    float sunUp = smoothstep(-0.02, 0.06, skySunDir.y) * skyDay;
    sky += skySunColor * (pow(cosSun, 1200.0) * 30.0 + pow(cosSun, 48.0) * 0.6) * sunUp;
  }
  sky *= uSkyScale;

  // The lakebed: sunlit and uniform underfoot, hazing out toward the horizon.
  float down = clamp(-up, 0.0, 1.0);
  vec3 haze = skyHorizonHaze(dir) * uSkyScale;
  vec3 ground = mix(haze * 0.85, uGround, smoothstep(0.0, 0.22, down));

  if (uStructure > 0.0) {
    // What a rifle needs to reflect is a horizon: a bright band of haze over
    // it, a darker ridge line under it, and the lakebed brightening again
    // toward the feet. Thin wisps keep a flat face from reflecting one tint.
    float turns = atan(dir.z, dir.x) / 6.2831853 + 0.5;
    sky += haze * 0.7 * exp(-max(up, 0.0) / 0.07);
    float wisps = envRing(turns, 9.0) * 0.6 + envRing(turns + 0.37, 23.0) * 0.4;
    sky *= 1.0 + (wisps - 0.5) * 0.22 * smoothstep(0.03, 0.12, up) * (1.0 - smoothstep(0.35, 0.7, up));
    ground *= mix(0.62, 1.0, smoothstep(0.0, 0.35, down));
  }

  vec3 color = mix(ground, sky, smoothstep(-0.03, 0.03, up));

  if (uStructure > 0.0) {
    // distant ridges: a low, broken silhouette sitting on the horizon
    float turns = atan(dir.z, dir.x) / 6.2831853 + 0.5;
    float ridge = 0.012 + 0.03 * (envRing(turns, 14.0) * 0.7 + envRing(turns + 0.11, 41.0) * 0.3);
    float onRidge = (1.0 - smoothstep(ridge - 0.006, ridge + 0.004, up)) * smoothstep(-0.03, 0.0, up);
    color = mix(color, uGround * 0.55 + haze * 0.25, onRidge);
  }

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

/**
 * The lakebed as the world's fill sees it. Sunlit sand is brighter than this
 * (about 0.45), but a shaded wall sees mostly the shaded ground at its own
 * foot, and full-strength bounce lifted every shade face to mid-grey.
 */
const DAY_GROUND = new THREE.Color(0.26, 0.2, 0.135);
/** The weapon's horizon reflection keeps the bright, sunlit ground. */
const DAY_GROUND_STRUCTURED = new THREE.Color(0.36, 0.28, 0.185);
/** Moonlit lakebed. */
const NIGHT_GROUND = new THREE.Color(0.0045, 0.005, 0.0065);
const SUN_WARM = new THREE.Color(1.0, 0.94, 0.84);
const SUN_LOW = new THREE.Color(1.0, 0.58, 0.3);
/**
 * Sky scale in the radiance map. Clear desert sky fills shade at roughly a
 * fifth of direct sun on the ground. With the sun lobes and the bright cirrus
 * in it, 0.82 filled to nearly half and every surface read as ambient-lit;
 * without them, 0.4 left shade at a tenth, crushed blue-black. The weapon's map stays brighter: it is
 * reflected, not used as fill, and a dark finish needs sky to show its edges.
 */
const NIGHT_SKY_SCALE = 1.5;
const DAY_SKY_SCALE = 0.7;
const DAY_SKY_SCALE_STRUCTURED = 0.82;

export class EnvironmentLighting {
  private readonly pmrem: THREE.PMREMGenerator;
  private readonly scene = new THREE.Scene();
  private readonly material: THREE.ShaderMaterial;
  private readonly uniforms: SkyUniforms & {
    uGround: THREE.IUniform<THREE.Color>;
    uSkyScale: THREE.IUniform<number>;
    uStructure: THREE.IUniform<number>;
  };
  private cachedKey: string | null = null;
  /**
   * The whole render target `fromScene` returns, not just its texture:
   * disposing only the texture leaves the framebuffer and depth renderbuffer
   * behind on every regenerate.
   */
  private cachedTarget: THREE.WebGLRenderTarget | null = null;
  private readonly structured: boolean;

  /**
   * `structured` draws the weapon's variant: the same sky and sun, with a
   * haze band, a ridge line and the near ground darkened, so a metal face has
   * a horizon to reflect.
   */
  constructor(renderer: THREE.WebGLRenderer, { structured = false } = {}) {
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.structured = structured;

    // Its own uniform values, set from the options: the radiance map is built
    // for a sun state, not for whatever the live sky shows this frame.
    this.uniforms = {
      skySunDir: { value: new THREE.Vector3(0, 1, 0) },
      skyMoonDir: { value: GROUND_MOON_DIRECTION.clone() },
      skyDay: { value: 1 },
      skySunColor: { value: SUN_WARM.clone() },
      skyTime: { value: 0 },
      skyCloudCover: { value: 0.36 },
      skyHaze: { value: 0.5 },
      uGround: { value: DAY_GROUND.clone() },
      uSkyScale: { value: DAY_SKY_SCALE },
      uStructure: { value: structured ? 1 : 0 },
    };
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      side: THREE.BackSide,
      depthWrite: false,
      toneMapped: false,
      defines: { SKY_CLOUD_TAPS: 0 },
      uniforms: this.uniforms,
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(50, 48, 32), this.material);
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
    const u = this.uniforms;
    u.skySunDir.value
      .set(Math.sin(az) * Math.cos(elev), Math.sin(elev), -Math.cos(az) * Math.cos(elev))
      .normalize();

    const day = THREE.MathUtils.clamp(options.dayFactor, 0, 1);
    const above = THREE.MathUtils.clamp(Math.sin(elev) * 3, 0, 1);
    u.skyDay.value = day;
    u.skySunColor.value.lerpColors(SUN_LOW, SUN_WARM, above);
    const dayGround = this.structured ? DAY_GROUND_STRUCTURED : DAY_GROUND;
    const daySky = this.structured ? DAY_SKY_SCALE_STRUCTURED : DAY_SKY_SCALE;
    u.uGround.value.lerpColors(NIGHT_GROUND, dayGround, day * above);
    u.uSkyScale.value = THREE.MathUtils.lerp(NIGHT_SKY_SCALE, daySky, day);

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
