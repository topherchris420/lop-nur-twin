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

varying vec3 vDirection;

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

  // Soft horizon blend so pre-filter sees a seamless transition
  float blend = smoothstep(-0.04, 0.04, up);
  vec3 color = mix(ground, sky, blend);

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
  private cachedTexture: THREE.Texture | null = null;

  constructor(renderer: THREE.WebGLRenderer) {
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
    if (this.cachedTexture && this.cachedKey === key) return this.cachedTexture;

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
    this.cachedTexture?.dispose();
    this.cachedKey = key;
    this.cachedTexture = target.texture;
    return target.texture;
  }

  dispose(): void {
    this.cachedTexture?.dispose();
    this.cachedTexture = null;
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
