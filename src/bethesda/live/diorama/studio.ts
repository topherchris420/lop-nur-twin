/**
 * The light on the model. Bethesda has no day or night: the city the fly
 * lives in is lit by one fixed sun (`SUN` in `furniture.ts`), bright in clear
 * weather and dim in a storm, and the fly is shaded by the same numbers. The
 * model is lit the same way, as a set is lit by one lamp: that sun's
 * direction and its two intensities, with a soft sky over the workbench for
 * the fill.
 *
 * The key is drawn in the clay material's two cascades (`clay.ts`): `wide`
 * covers the whole board and is rendered once, since the set does not move;
 * `near` is a box round what the lens looks at, rendered every frame and
 * snapped to its texels so its shadows do not swim.
 */
import * as THREE from "three";
import type { Quality } from "../../../garden/core/quality.js";
import { SUN } from "../../furniture.js";
import { bounds } from "../../model.js";
import { maximumGround } from "../../terrain.js";
import { TABLE_Y } from "./city.js";
import { MODEL_SCALE } from "./stage.js";

const ENV_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`;

const ENV_FRAGMENT = /* glsl */ `
uniform vec3 uZenith, uHorizon, uGround, uSunDir, uSunColor;
varying vec3 vDir;
void main() {
  vec3 d = normalize( vDir );
  vec3 sky = mix( uHorizon, uZenith, pow( clamp( d.y, 0.0, 1.0 ), 0.5 ) );
  sky += uSunColor * pow( max( dot( d, uSunDir ), 0.0 ), 6.0 );
  vec3 below = mix( uHorizon * 0.5, uGround, smoothstep( 0.0, -0.3, d.y ) );
  gl_FragColor = vec4( d.y >= 0.0 ? sky : below, 1.0 );
}`;

/** Unit direction toward the city's sun (x east, y up, z south). */
export const SUN_DIRECTION = new THREE.Vector3(
  SUN.offset.x,
  SUN.offset.y,
  SUN.offset.z,
).normalize();

/** The look of clear weather and of a storm; the picture eases between them. */
const CLEAR = {
  key: SUN.clearIntensity,
  keyColour: new THREE.Color(1.1, 0.98, 0.87),
  zenith: new THREE.Color(0.22, 0.32, 0.47),
  horizon: new THREE.Color(0.54, 0.6, 0.62),
  fill: 0.7,
  exposure: 1,
  softness: 0.3,
};
const STORM = {
  key: SUN.stormIntensity,
  keyColour: new THREE.Color(0.86, 0.9, 0.96),
  zenith: new THREE.Color(0.2, 0.23, 0.27),
  horizon: new THREE.Color(0.36, 0.39, 0.42),
  fill: 0.62,
  exposure: 1.75,
  softness: 0.9,
};

/** Everything that casts a shadow on the board, in model metres. */
const BOARD = new THREE.Box3(
  new THREE.Vector3(bounds.min.x, TABLE_Y, bounds.min.z).multiplyScalar(MODEL_SCALE),
  new THREE.Vector3(bounds.max.x, maximumGround + 160, bounds.max.z).multiplyScalar(
    MODEL_SCALE,
  ),
);
const NEAR_REACH = 3;

function lightBasis(dir: THREE.Vector3) {
  const z = dir.clone().normalize();
  const x = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), z).normalize();
  const y = new THREE.Vector3().crossVectors(z, x);
  return { x, y, z };
}

export class StudioLights {
  readonly group = new THREE.Group();
  readonly wide: THREE.DirectionalLight;
  readonly near: THREE.DirectionalLight;
  exposure = CLEAR.exposure;
  /** 0 clear … 1 storm, as last set. */
  private storm = -1;
  private readonly pmrem: THREE.PMREMGenerator;
  private readonly envScene = new THREE.Scene();
  private readonly envMaterial: THREE.ShaderMaterial;
  private env: THREE.WebGLRenderTarget | null = null;
  private softness = CLEAR.softness;

  constructor(
    renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly q: Quality,
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
    // Order matters: the cascade patch expects the wide map first, the near one second.
    this.wide = key("sun-wide");
    this.near = key("sun-near");
    this.wide.shadow.autoUpdate = false;
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
        uSunDir: { value: SUN_DIRECTION.clone() },
        uSunColor: { value: new THREE.Color() },
      },
    });
    this.envScene.add(
      new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), this.envMaterial),
    );
    scene.fog = new THREE.FogExp2(0x000000, 0.1);
    scene.background = new THREE.Color();
    this.fitWide();
    this.setStorm(0);
  }

  /** Sets the weather's light: 0 clear … 1 storm. The sky is redrawn only when it changes visibly. */
  setStorm(storm: number) {
    const s = Math.min(1, Math.max(0, storm));
    if (Math.abs(s - this.storm) < 0.02) return;
    this.storm = s;
    const mix = (a: number, b: number) => a + (b - a) * s;
    const colour = (a: THREE.Color, b: THREE.Color) => a.clone().lerp(b, s);
    const keyColour = colour(CLEAR.keyColour, STORM.keyColour);
    for (const l of [this.wide, this.near]) {
      l.color.copy(keyColour);
      l.intensity = mix(CLEAR.key, STORM.key);
    }
    this.exposure = mix(CLEAR.exposure, STORM.exposure);
    this.softness = mix(CLEAR.softness, STORM.softness);
    this.wide.shadow.radius = 2 + 6 * this.softness;
    const zenith = colour(CLEAR.zenith, STORM.zenith),
      horizon = colour(CLEAR.horizon, STORM.horizon);
    const u = this.envMaterial.uniforms;
    u.uZenith!.value.copy(zenith);
    u.uHorizon!.value.copy(horizon);
    // The workbench's bounce: warm wood under the key.
    u.uGround!.value.setRGB(0.3, 0.2, 0.12).multiplyScalar(
      0.35 + (0.5 * mix(CLEAR.key, STORM.key)) / CLEAR.key,
    );
    u.uSunColor!.value.copy(keyColour).multiplyScalar(0.15 * (1 - s));
    const next = this.pmrem.fromScene(this.envScene, 0, 0.1, 10, {
      size: this.q.textureSize >= 1024 ? 256 : 128,
    });
    this.scene.environment = next.texture;
    this.env?.dispose();
    this.env = next;
    this.scene.environmentIntensity = mix(CLEAR.fill, STORM.fill);
    // The room beyond the bench: the horizon's colour, out of focus.
    const room = horizon.clone().multiplyScalar(0.9);
    (this.scene.fog as THREE.FogExp2).color.copy(room);
    (this.scene.background as THREE.Color).copy(room);
  }

  /** The wide cascade: the whole board, fitted once. */
  private fitWide() {
    const s = this.wide.shadow;
    const b = lightBasis(SUN_DIRECTION);
    const min = new THREE.Vector3(Infinity, Infinity, Infinity),
      max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    const c = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      c.set(
        i & 1 ? BOARD.max.x : BOARD.min.x,
        i & 2 ? BOARD.max.y : BOARD.min.y,
        i & 4 ? BOARD.max.z : BOARD.min.z,
      );
      const l = new THREE.Vector3(c.dot(b.x), c.dot(b.y), c.dot(b.z));
      min.min(l);
      max.max(l);
    }
    const pad = 0.2;
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

  /** Asks for the wide map again (after the GPU context is restored, or the set changes). */
  redrawWide() {
    this.wide.shadow.needsUpdate = true;
  }

  /** The near cascade: a box `radius` (model metres) round `focus`, snapped to whole texels. */
  fitNear(focus: THREE.Vector3, radius: number) {
    const s = this.near.shadow;
    const b = lightBasis(SUN_DIRECTION);
    const texel = (2 * radius) / s.mapSize.x;
    const snap = (v: number) => Math.round(v / texel) * texel;
    const centre = new THREE.Vector3()
      .addScaledVector(b.x, snap(focus.dot(b.x)))
      .addScaledVector(b.y, snap(focus.dot(b.y)))
      .addScaledVector(b.z, focus.dot(b.z) + NEAR_REACH);
    this.near.position.copy(centre);
    this.near.target.position.copy(centre).sub(b.z);
    const cam = s.camera;
    cam.left = cam.bottom = -radius;
    cam.right = cam.top = radius;
    cam.near = 0.02;
    cam.far = NEAR_REACH + Math.max(0.5, radius * 4);
    cam.updateProjectionMatrix();
    s.radius = 1.5 + 4 * this.softness;
    s.normalBias = texel * 1.5;
    s.bias = -(texel * 0.5) / (cam.far - cam.near);
    this.near.updateMatrixWorld();
    this.near.target.updateMatrixWorld();
  }

  dispose() {
    for (const l of [this.wide, this.near]) l.shadow.map?.dispose();
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
