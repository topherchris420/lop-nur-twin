/**
 * The garden's light, from `lightAt` (the sun, moon and reported weather at
 * presented time) to Three's lights:
 *
 * - **Key light** in two cascades (see `clay.ts`): `wide` covers the whole
 *   garden and is re-rendered only when the sun has moved; `near` is a tight
 *   box round the subject (the fly, or the free camera's target), re-rendered
 *   every frame and snapped to its texels so its shadows do not swim. The key
 *   is the sun by day and the moon by night; where the two cross over, the
 *   key dims to nothing first, so its shadows never jump.
 * - **Sky light** as image-based lighting: a small environment drawn from the
 *   same zenith, horizon and sunlit-ground colours, prefiltered for diffuse
 *   and glossy reflection. Its lower half is the lawn's bounce, the global
 *   illumination approximation: green-gold from below by day, nothing at night.
 * - **The window lamp**: a warm spot shining out through the house window from
 *   dusk, matching the room's glow.
 * - **Air**: exponential haze in the horizon's colour, thick in fog.
 * - **Exposure**, set from the light rather than metered, so night reads as
 *   night (darker, bluer) while the moonlit garden stays visible.
 */
import * as THREE from "three";
import { LAYOUT } from "../core/layout.js";
import type { Quality } from "../core/quality.js";
import type { Light } from "../core/sky.js";
import { clamp, clamp01, smoothstep, type V3 } from "../core/vec.js";

/** Everything that casts a shadow on the garden, the maple's canopy included. */
const GARDEN_BOUNDS = new THREE.Box3(
  new THREE.Vector3(-4.5, -0.1, -1.8),
  new THREE.Vector3(3.7, 5.0, 3.3),
);
const NEAR_REACH = 10;

const ENV_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`;

const ENV_FRAGMENT = /* glsl */ `
uniform vec3 uZenith, uHorizon, uGround, uSunDir, uSunColor;
uniform float uAureole;
varying vec3 vDir;
void main() {
  vec3 d = normalize( vDir );
  vec3 sky = mix( uHorizon, uZenith, pow( clamp( d.y, 0.0, 1.0 ), 0.5 ) );
  sky += uSunColor * uAureole * pow( max( dot( d, uSunDir ), 0.0 ), 6.0 );
  vec3 below = mix( uHorizon * 0.5, uGround, smoothstep( 0.0, -0.3, d.y ) );
  gl_FragColor = vec4( d.y >= 0.0 ? sky : below, 1.0 );
}`;

/** A camera-like orthonormal basis looking down `-dir`. */
function lightBasis(dir: THREE.Vector3) {
  const z = dir.clone().normalize();
  const up =
    Math.abs(z.y) > 0.999 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
  const x = new THREE.Vector3().crossVectors(up, z).normalize();
  const y = new THREE.Vector3().crossVectors(z, x);
  return { x, y, z };
}

const luminance = (c: readonly number[]) =>
  0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;

export interface KeyState {
  /** Unit direction toward the key light. */
  direction: V3;
  intensity: number;
  color: THREE.Color;
  /** "sun" or "moon": which body is the key now. */
  body: "sun" | "moon";
}

/** The key light for a light state: the brighter of sun and moon, faded through zero where they cross. */
export function keyOf(light: Light): KeyState {
  const s = light.sun.intensity * clamp01(light.sun.direction[1] * 8 + 0.2);
  const m = light.moon.intensity * clamp01(light.moon.direction[1] * 8 + 0.2);
  const hi = Math.max(s, m),
    lo = Math.min(s, m);
  const fade = hi > 0 ? smoothstep(0, 1, (hi - lo) / (0.35 * hi + 1e-6)) : 0;
  if (s >= m)
    return {
      direction: light.sun.direction,
      intensity: s * fade,
      color: new THREE.Color(...light.sun.color),
      body: "sun",
    };
  // Moonlight is sunlight, but the eye at night sees it cool; graded so in film, and here.
  return {
    direction: light.moon.direction,
    intensity: m * fade,
    color: new THREE.Color(0.72, 0.8, 1.0),
    body: "moon",
  };
}

/** Light falling on open ground from the sun and sky, in the units of a clear midday (about 1). */
function groundLight(light: Light): number {
  const sky = (luminance(light.zenith) + luminance(light.horizon)) / 2;
  return (
    light.fill * sky +
    (light.sun.intensity * Math.max(light.sun.direction[1], 0)) / Math.PI
  );
}

/**
 * Exposure from the light state, as a camera operator would set it rather
 * than as a meter would. By day it opens up partly as the light falls (the
 * square root of the loss, at most three times), so golden hour and the
 * shade behind the fence stay readable without becoming midday; through
 * twilight it rises to about eight at moonlit night, a night that still
 * reads as night after grading.
 */
export function exposureOf(light: Light): number {
  const day = clamp(Math.sqrt(0.95 / Math.max(groundLight(light), 1e-3)), 1, 3);
  const night =
    1 + 6 + 3 * light.moon.illumination * smoothstep(-2, 10, light.moon.altitudeDeg);
  return night + (day - night) * light.daylight;
}

export class GardenLights {
  readonly group = new THREE.Group();
  readonly wide: THREE.DirectionalLight;
  readonly near: THREE.DirectionalLight;
  readonly lamp: THREE.SpotLight;
  /** Exposure and night amount for the finishing pass. */
  exposure = 1;
  night = 0;
  private readonly pmrem: THREE.PMREMGenerator;
  private readonly envScene = new THREE.Scene();
  private readonly envMaterial: THREE.ShaderMaterial;
  private env: THREE.WebGLRenderTarget | null = null;
  private envKey = "";
  private wideDir = new THREE.Vector3(0, 0, 0);
  private wideAt = -Infinity;
  private readonly envSize: number;
  private readonly wideEvery: number;

  constructor(
    renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    q: Quality,
  ) {
    this.group.name = "lights";
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    const key = (name: string) => {
      const l = new THREE.DirectionalLight(0xffffff, 0);
      l.name = name;
      l.castShadow = true;
      l.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
      this.group.add(l, l.target);
      return l;
    };
    // Order matters: shadow casters come first in Three's light list, in
    // scene order, and the cascade patch expects the wide map at index 0.
    this.wide = key("sun-wide");
    this.near = key("sun-near");
    this.wide.shadow.autoUpdate = false;
    const win = LAYOUT.window;
    this.lamp = new THREE.SpotLight(0xffa860, 0, 4.5, 0.95, 0.75, 2);
    this.lamp.name = "window lamp";
    this.lamp.position.set(
      (win.x0 + win.x1) / 2,
      (win.y0 + win.y1) / 2 + 0.12,
      LAYOUT.wall.front - 0.55,
    );
    this.lamp.target.position.set(
      (win.x0 + win.x1) / 2 - 0.3,
      0,
      LAYOUT.wall.front + 1.6,
    );
    this.group.add(this.lamp, this.lamp.target);
    scene.add(this.group);

    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envMaterial = new THREE.ShaderMaterial({
      vertexShader: ENV_VERTEX,
      fragmentShader: ENV_FRAGMENT,
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uZenith: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uGround: { value: new THREE.Color() },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color() },
        uAureole: { value: 0 },
      },
    });
    this.envScene.add(
      new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), this.envMaterial),
    );
    this.envSize = q.textureSize >= 1024 ? 256 : 128;
    this.wideEvery = q.name === "performance" ? 30 : 10;
    scene.fog = new THREE.FogExp2(0xb8c0c4, 0.01);
  }

  /**
   * Sets every light for presented time's light state. `focus` is the point
   * the near cascade centres on and `radius` its half-width in metres; `now`
   * is presented time, for deciding when the wide map is stale.
   */
  update(light: Light, focus: V3, radius: number, now: number) {
    const key = keyOf(light);
    const dir = new THREE.Vector3(...key.direction).normalize();
    const softness = light.softness;
    for (const l of [this.wide, this.near]) {
      l.color.copy(key.color);
      l.intensity = key.intensity;
    }
    this.fitWide(dir, now, softness);
    this.fitNear(dir, focus, radius, softness);

    // Sky light: normalised so the environment carries colour and direction
    // and `environmentIntensity` the level, which then changes smoothly.
    const fill = Math.max(light.fill, 1e-3);
    const sunOnGround =
      light.sun.intensity * Math.max(light.sun.direction[1], 0) +
      key.intensity * (key.body === "moon" ? Math.max(dir.y, 0) : 0);
    const skyAvg = (luminance(light.zenith) + luminance(light.horizon)) / 2;
    const albedo: V3 = [0.11, 0.13, 0.05];
    const bounce = albedo.map((a) => a * (sunOnGround / (Math.PI * fill) + skyAvg)) as V3;
    const u = this.envMaterial.uniforms;
    u.uZenith!.value.setRGB(...light.zenith);
    u.uHorizon!.value.setRGB(...light.horizon);
    u.uGround!.value.setRGB(...bounce);
    u.uSunDir!.value.set(...light.sun.direction);
    u.uSunColor!.value.setRGB(...light.sun.color);
    u.uAureole!.value = 0.15 * light.daylight * (1 - light.cloud);
    const envKey = [
      ...light.zenith,
      ...light.horizon,
      ...bounce,
      light.sun.direction[0] * 0.2,
      light.sun.direction[2] * 0.2,
      light.daylight,
    ]
      .map((v) => Math.round(v * 60))
      .join(",");
    if (envKey !== this.envKey) {
      this.envKey = envKey;
      const next = this.pmrem.fromScene(this.envScene, 0, 0.1, 10, {
        size: this.envSize,
      });
      this.scene.environment = next.texture;
      this.env?.dispose();
      this.env = next;
    }
    this.scene.environmentIntensity = fill;

    // The lamp in the house window, and the haze.
    this.lamp.intensity = 0.9 * light.windowGlow;
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.setRGB(...light.horizon).multiplyScalar(0.92);
    fog.density = 0.012 + 0.16 * light.fog + 0.02 * light.cloud * light.rain;

    this.exposure = exposureOf(light);
    this.night = 1 - light.daylight;
  }

  /** The wide cascade: the whole garden, refit and re-rendered only when the key has moved. */
  private fitWide(dir: THREE.Vector3, now: number, softness: number) {
    const s = this.wide.shadow;
    s.radius = 2 + 6 * softness;
    if (dir.angleTo(this.wideDir) < 0.002 && now - this.wideAt < this.wideEvery) return;
    this.wideDir.copy(dir);
    this.wideAt = now;
    const b = lightBasis(dir);
    const min = new THREE.Vector3(Infinity, Infinity, Infinity),
      max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    const c = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      c.set(
        i & 1 ? GARDEN_BOUNDS.max.x : GARDEN_BOUNDS.min.x,
        i & 2 ? GARDEN_BOUNDS.max.y : GARDEN_BOUNDS.min.y,
        i & 4 ? GARDEN_BOUNDS.max.z : GARDEN_BOUNDS.min.z,
      );
      const l = new THREE.Vector3(c.dot(b.x), c.dot(b.y), c.dot(b.z));
      min.min(l);
      max.max(l);
    }
    const pad = 0.5;
    const centre = new THREE.Vector3()
      .addScaledVector(b.x, (min.x + max.x) / 2)
      .addScaledVector(b.y, (min.y + max.y) / 2)
      .addScaledVector(b.z, max.z + pad);
    this.wide.position.copy(centre);
    this.wide.target.position.copy(centre).sub(b.z);
    const cam = s.camera;
    cam.left = -(max.x - min.x) / 2;
    cam.right = (max.x - min.x) / 2;
    cam.bottom = -(max.y - min.y) / 2;
    cam.top = (max.y - min.y) / 2;
    cam.near = pad * 0.5;
    cam.far = max.z - min.z + pad * 1.5;
    cam.updateProjectionMatrix();
    const texel = (max.x - min.x) / s.mapSize.x;
    s.normalBias = texel * 1.2;
    s.bias = -(texel * 0.6) / (cam.far - cam.near);
    this.wide.updateMatrixWorld();
    this.wide.target.updateMatrixWorld();
    s.needsUpdate = true;
  }

  /** The near cascade: a box `radius` wide round `focus`, snapped to whole texels. */
  private fitNear(dir: THREE.Vector3, focus: V3, radius: number, softness: number) {
    const s = this.near.shadow;
    const b = lightBasis(dir);
    const f = new THREE.Vector3(...focus);
    const texel = (2 * radius) / s.mapSize.x;
    const snap = (v: number) => Math.round(v / texel) * texel;
    const lx = snap(f.dot(b.x)),
      ly = snap(f.dot(b.y)),
      lz = f.dot(b.z);
    const centre = new THREE.Vector3()
      .addScaledVector(b.x, lx)
      .addScaledVector(b.y, ly)
      .addScaledVector(b.z, lz + NEAR_REACH);
    this.near.position.copy(centre);
    this.near.target.position.copy(centre).sub(b.z);
    const cam = s.camera;
    cam.left = cam.bottom = -radius;
    cam.right = cam.top = radius;
    cam.near = 0.02;
    cam.far = NEAR_REACH + Math.max(0.3, radius * 4);
    cam.updateProjectionMatrix();
    s.radius = 1.5 + 4 * softness;
    s.normalBias = texel * 1.5;
    s.bias = -(texel * 0.5) / (cam.far - cam.near);
    this.near.updateMatrixWorld();
    this.near.target.updateMatrixWorld();
  }

  dispose() {
    for (const l of [this.wide, this.near, this.lamp]) l.shadow?.map?.dispose();
    this.env?.dispose();
    this.pmrem.dispose();
    this.envMaterial.dispose();
    this.envScene.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    this.scene.remove(this.group);
    this.scene.environment = null;
  }
}
