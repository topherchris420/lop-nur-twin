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
 * The sky is *bounded* deliberately. Feeding three's `Sky` object to the
 * pre-filter looks like the obvious move and quietly destroys the frame: its
 * sun disc reaches radiances in the tens of thousands, which overflow the
 * half-float blur to `Inf`, and `Inf - Inf` in the convolution yields `NaN`.
 * A `NaN` in the environment map propagates through every `MeshStandardMaterial`
 * that samples it and renders the entire scene pure black — with the sky, which
 * does not sample it, left perfectly intact. So the sun here is clamped to a
 * bright but finite radiance, and the gradient is written directly rather than
 * integrated.
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

void main() {
  vec3 dir = normalize(vDirection);
  float up = dir.y;

  // Sky gradient: zenith to horizon with a Rayleigh-like falloff, then a
  // warmer band right at the horizon where the optical path is longest.
  float t = clamp(up, 0.0, 1.0);
  vec3 sky = mix(uHorizon, uZenith, pow(t, 0.42));
  float haze = pow(1.0 - t, 6.0);
  sky = mix(sky, uHorizon * 1.18, haze * 0.55);

  // Ground hemisphere: the lakebed bounce. Without it every downward-facing
  // metal surface goes dead.
  float down = clamp(-up, 0.0, 1.0);
  vec3 ground = uGround * mix(1.0, 0.42, pow(down, 0.6));

  vec3 color = up >= 0.0 ? sky : ground;

  // Soft horizon blend so the pre-filter does not see a hard seam.
  float blend = smoothstep(-0.045, 0.045, up);
  color = mix(ground, sky, blend);

  // Sun: a small disc with a wide Mie-ish glow. Clamped — see the note above.
  float cosAngle = dot(dir, uSunDirection);
  float disc = smoothstep(0.99965, 0.99992, cosAngle);
  float glow = pow(max(cosAngle, 0.0), 380.0) * 0.55
             + pow(max(cosAngle, 0.0), 22.0) * 0.12 * uTurbidity;
  color += uSunColor * (disc * uSunIntensity + glow * uSunIntensity * 0.22);

  // Hard ceiling on radiance keeps the half-float convolution finite.
  color = min(color, vec3(140.0));
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

/*
 * These are *radiances*, in the same scene-linear units the renderer works in,
 * and the scene binds the map at `environmentIntensity = 1` (see `GameScene`).
 * They used to be authored roughly 2.6x hot and weighted back down by 0.38,
 * which was fine for the sky but wrong for the ground: the lakebed bounce is
 * what fills the shadow side of everything at eye level, and at 0.38 there was
 * effectively none. The sky values below are the old ones times that 0.38, so
 * the sky reads exactly as it did; the ground is now its own measured value.
 *
 * The ground figure is where it is because the lakebed is a diffuse surface of
 * albedo ~0.35 under a total irradiance of ~2 (sun at 29 deg plus sky), so it
 * radiates albedo * E / PI ~ 0.22 — comparable to the hazy horizon above it,
 * which is what a desert actually looks like. Because a cosine-weighted
 * hemisphere around an *upward* normal contains none of it, raising this
 * brightens walls, undersides and people without touching the terrain or the
 * roofs, and therefore without moving the frame's exposure.
 */
const DAY_ZENITH = new THREE.Color(0.061, 0.11, 0.22);
const DAY_HORIZON = new THREE.Color(0.274, 0.274, 0.251);
const DAY_GROUND = new THREE.Color(0.28, 0.24, 0.175);
const NIGHT_ZENITH = new THREE.Color(0.012, 0.02, 0.042);
const NIGHT_HORIZON = new THREE.Color(0.035, 0.045, 0.062);
const NIGHT_GROUND = new THREE.Color(0.012, 0.011, 0.009);
const SUN_WARM = new THREE.Color(1.0, 0.94, 0.84);
const SUN_LOW = new THREE.Color(1.0, 0.6, 0.3);

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
        uSunIntensity: { value: 90 },
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
    // Bucket the elevation so a slow day/night sweep does not rebuild the cube
    // every frame; 3° steps are imperceptible in a reflection.
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
    // How high the sun is drives both the colour temperature and how much of
    // the sky is lit; below the horizon the whole thing collapses to night.
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
    // Matched to the sky above: the old 110 was read back at 0.38.
    u["uSunIntensity"]!.value = 42 * Math.pow(above, 0.6) * day;
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
