import * as THREE from "three";
import { mulberry32 } from "@/lib/noise";

/**
 * GPU particle engine.
 *
 * Every particle is one instance of a unit quad. The CPU writes spawn state
 * once — position, velocity, lifetime, colour ramp, physics constants — and
 * the vertex shader integrates the trajectory analytically from the elapsed
 * time, so a 20 000-particle battlefield costs one draw call and no per-frame
 * CPU work at all. Dead particles are simply not drawn (the vertex shader
 * collapses them to a degenerate quad), and the ring buffer reuses their slots.
 *
 * Emissive particles write linear values well above 1.0 and rely on the AgX
 * tone mapper and bloom in the post stack to roll them off, which is what
 * makes sparks read as genuinely hot rather than as orange dots.
 */

export const SPRITE = {
  smoke: 0,
  spark: 1,
  dust: 2,
  debris: 3,
  blood: 4,
  fire: 5,
  flash: 6,
  ring: 7,
} as const;

export type SpriteId = (typeof SPRITE)[keyof typeof SPRITE];

const ATLAS_COLS = 4;
const ATLAS_ROWS = 2;
const ATLAS_TILE = 256;

/* ------------------------------------------------------------------ */
/* Atlas                                                               */
/* ------------------------------------------------------------------ */

function drawSmoke(ctx: CanvasRenderingContext2D, seed: number): void {
  const rand = mulberry32(seed);
  const c = ATLAS_TILE / 2;
  // Layered soft blobs give a puff with internal structure rather than a
  // uniform gaussian, which is what makes smoke read as volume.
  for (let i = 0; i < 26; i += 1) {
    const angle = rand() * Math.PI * 2;
    const dist = Math.pow(rand(), 0.6) * c * 0.52;
    const x = c + Math.cos(angle) * dist;
    const y = c + Math.sin(angle) * dist;
    const r = c * (0.2 + rand() * 0.32);
    const alpha = 0.05 + rand() * 0.07;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${alpha})`);
    g.addColorStop(0.55, `rgba(255,255,255,${alpha * 0.55})`);
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Mask to a circle so the puff never shows its tile edges.
  ctx.globalCompositeOperation = "destination-in";
  const mask = ctx.createRadialGradient(c, c, c * 0.2, c, c, c * 0.98);
  mask.addColorStop(0, "rgba(255,255,255,1)");
  mask.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = mask;
  ctx.fillRect(0, 0, ATLAS_TILE, ATLAS_TILE);
  ctx.globalCompositeOperation = "source-over";
}

function drawSpark(ctx: CanvasRenderingContext2D): void {
  const c = ATLAS_TILE / 2;
  // A stretched streak: bright thin core with a soft halo.
  const g = ctx.createLinearGradient(0, c, ATLAS_TILE, c);
  g.addColorStop(0, "rgba(255,255,255,0)");
  g.addColorStop(0.45, "rgba(255,255,255,1)");
  g.addColorStop(0.6, "rgba(255,255,255,1)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, c - 4, ATLAS_TILE, 8);
  const halo = ctx.createRadialGradient(c, c, 0, c, c, c * 0.5);
  halo.addColorStop(0, "rgba(255,255,255,0.65)");
  halo.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, ATLAS_TILE, ATLAS_TILE);
}

function drawDust(ctx: CanvasRenderingContext2D, seed: number): void {
  const rand = mulberry32(seed);
  const c = ATLAS_TILE / 2;
  const g = ctx.createRadialGradient(c, c, 0, c, c, c);
  g.addColorStop(0, "rgba(255,255,255,0.42)");
  g.addColorStop(0.4, "rgba(255,255,255,0.2)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, ATLAS_TILE, ATLAS_TILE);
  // Grain so it does not look like an airbrushed circle.
  ctx.globalCompositeOperation = "destination-in";
  for (let i = 0; i < 900; i += 1) {
    const x = rand() * ATLAS_TILE;
    const y = rand() * ATLAS_TILE;
    ctx.fillStyle = `rgba(255,255,255,${0.6 + rand() * 0.4})`;
    ctx.fillRect(x, y, 2 + rand() * 3, 2 + rand() * 3);
  }
  ctx.globalCompositeOperation = "source-over";
}

function drawDebris(ctx: CanvasRenderingContext2D, seed: number): void {
  const rand = mulberry32(seed);
  const c = ATLAS_TILE / 2;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  const points = 6;
  for (let i = 0; i < points; i += 1) {
    const angle = (i / points) * Math.PI * 2;
    const r = c * (0.42 + rand() * 0.4);
    const x = c + Math.cos(angle) * r;
    const y = c + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

function drawBlood(ctx: CanvasRenderingContext2D, seed: number): void {
  const rand = mulberry32(seed);
  const c = ATLAS_TILE / 2;
  for (let i = 0; i < 12; i += 1) {
    const x = c + (rand() - 0.5) * c * 0.9;
    const y = c + (rand() - 0.5) * c * 0.9;
    const r = c * (0.08 + rand() * 0.22);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(255,255,255,0.9)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawFire(ctx: CanvasRenderingContext2D, seed: number): void {
  const rand = mulberry32(seed);
  const c = ATLAS_TILE / 2;
  for (let i = 0; i < 18; i += 1) {
    const x = c + (rand() - 0.5) * c * 0.7;
    const y = c + (rand() - 0.5) * c * 0.7;
    const r = c * (0.2 + rand() * 0.45);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(255,255,255,0.55)");
    g.addColorStop(0.45, "rgba(255,255,255,0.22)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawFlash(ctx: CanvasRenderingContext2D, seed: number): void {
  const rand = mulberry32(seed);
  const c = ATLAS_TILE / 2;
  // A multi-lobe star: the asymmetric petal count is what stops a muzzle
  // flash looking like a generic glow sprite.
  const lobes = 5 + Math.floor(rand() * 4);
  ctx.translate(c, c);
  for (let i = 0; i < lobes; i += 1) {
    const angle = (i / lobes) * Math.PI * 2 + rand() * 0.5;
    const len = c * (0.45 + rand() * 0.5);
    const width = c * (0.1 + rand() * 0.12);
    ctx.save();
    ctx.rotate(angle);
    const g = ctx.createLinearGradient(0, 0, len, 0);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.35, "rgba(255,255,255,0.6)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, -width);
    ctx.lineTo(len, 0);
    ctx.lineTo(0, width);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  const core = ctx.createRadialGradient(0, 0, 0, 0, 0, c * 0.42);
  core.addColorStop(0, "rgba(255,255,255,1)");
  core.addColorStop(0.5, "rgba(255,255,255,0.7)");
  core.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(0, 0, c * 0.42, 0, Math.PI * 2);
  ctx.fill();
  ctx.translate(-c, -c);
}

function drawRing(ctx: CanvasRenderingContext2D): void {
  const c = ATLAS_TILE / 2;
  const g = ctx.createRadialGradient(c, c, c * 0.62, c, c, c * 0.98);
  g.addColorStop(0, "rgba(255,255,255,0)");
  g.addColorStop(0.35, "rgba(255,255,255,0.9)");
  g.addColorStop(0.6, "rgba(255,255,255,0.35)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, ATLAS_TILE, ATLAS_TILE);
}

let atlasTexture: THREE.CanvasTexture | null = null;

export function getParticleAtlas(): THREE.CanvasTexture {
  if (atlasTexture) return atlasTexture;
  const canvas = document.createElement("canvas");
  canvas.width = ATLAS_TILE * ATLAS_COLS;
  canvas.height = ATLAS_TILE * ATLAS_ROWS;
  const ctx = canvas.getContext("2d")!;
  const painters: ((ctx: CanvasRenderingContext2D, seed: number) => void)[] = [
    drawSmoke,
    (c) => drawSpark(c),
    drawDust,
    drawDebris,
    drawBlood,
    drawFire,
    drawFlash,
    (c) => drawRing(c),
  ];
  for (let i = 0; i < painters.length; i += 1) {
    const col = i % ATLAS_COLS;
    const row = Math.floor(i / ATLAS_COLS);
    ctx.save();
    ctx.translate(col * ATLAS_TILE, row * ATLAS_TILE);
    ctx.beginPath();
    ctx.rect(0, 0, ATLAS_TILE, ATLAS_TILE);
    ctx.clip();
    painters[i]!(ctx, 0x1000 + i * 977);
    ctx.restore();
  }
  atlasTexture = new THREE.CanvasTexture(canvas);
  atlasTexture.colorSpace = THREE.SRGBColorSpace;
  atlasTexture.generateMipmaps = true;
  atlasTexture.minFilter = THREE.LinearMipmapLinearFilter;
  atlasTexture.anisotropy = 4;
  return atlasTexture;
}

/* ------------------------------------------------------------------ */
/* Emitter description                                                 */
/* ------------------------------------------------------------------ */

export interface SpawnParams {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  lifetime: number;
  size0: number;
  size1: number;
  /** Linear RGB — values above 1 are intentional for emissive effects. */
  color0: THREE.Color;
  color1: THREE.Color;
  alpha0: number;
  alpha1: number;
  gravity: number;
  drag: number;
  rotation: number;
  rotationRate: number;
  sprite: SpriteId;
  /** 0 = alpha blended, 1 = additive. */
  additive: number;
  /** Stretch along the velocity vector, for sparks and debris streaks. */
  stretch: number;
  /** Turbulence amplitude, in m/s. */
  turbulence: number;
}

export function makeSpawnParams(): SpawnParams {
  return {
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    lifetime: 1,
    size0: 0.1,
    size1: 0.2,
    color0: new THREE.Color(1, 1, 1),
    color1: new THREE.Color(1, 1, 1),
    alpha0: 1,
    alpha1: 0,
    gravity: 0,
    drag: 0.4,
    rotation: 0,
    rotationRate: 0,
    sprite: SPRITE.smoke,
    additive: 0,
    stretch: 0,
    turbulence: 0,
  };
}

/* ------------------------------------------------------------------ */
/* System                                                              */
/* ------------------------------------------------------------------ */

const VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>

attribute vec3 aSpawnPos;
attribute vec3 aVelocity;
attribute vec4 aParams;     // spawnTime, lifetime, size0, size1
attribute vec4 aColor0;     // rgb, alpha0
attribute vec4 aColor1;     // rgb, alpha1
attribute vec4 aPhys;       // gravity, drag, rotation, rotationRate
attribute vec4 aStyle;      // sprite index, additive, stretch, turbulence

uniform float uTime;
uniform vec2 uAtlas;        // cols, rows

varying vec4 vColor;
varying vec2 vUv;
varying float vAdditive;

void main() {
  float age = uTime - aParams.x;
  float life = aParams.y;
  float t = age / life;

  if (age < 0.0 || t >= 1.0) {
    // Collapse dead particles so they cost nothing downstream.
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vColor = vec4(0.0);
    vUv = vec2(0.0);
    vAdditive = 0.0;
    return;
  }

  float gravity = aPhys.x;
  float drag = aPhys.y;

  // Analytic integration of dv/dt = -drag*v + g. Exact, so the trajectory is
  // identical at any frame rate and needs no CPU stepping.
  vec3 pos;
  vec3 vel;
  if (drag > 0.0001) {
    float e = exp(-drag * age);
    vec3 terminal = vec3(0.0, -gravity / drag, 0.0);
    pos = aSpawnPos + (aVelocity - terminal) * (1.0 - e) / drag + terminal * age;
    vel = (aVelocity - terminal) * e + terminal;
  } else {
    pos = aSpawnPos + aVelocity * age + vec3(0.0, -0.5 * gravity * age * age, 0.0);
    vel = aVelocity + vec3(0.0, -gravity * age, 0.0);
  }

  // Cheap curl-ish turbulence: three offset sines, divergence-free enough for
  // smoke to swirl without a noise texture fetch.
  float turb = aStyle.w;
  if (turb > 0.0001) {
    float f = 0.9;
    vec3 p = pos * f + aSpawnPos.yzx;
    pos += turb * age * vec3(
      sin(p.y * 1.7 + age * 0.9) - sin(p.z * 1.3),
      sin(p.z * 1.5 + age * 0.7) - sin(p.x * 1.1),
      sin(p.x * 1.9 + age * 1.1) - sin(p.y * 1.6)
    );
  }

  float size = mix(aParams.z, aParams.w, t);
  float rot = aPhys.z + aPhys.w * age;

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);

  // Billboard, with optional stretching along the screen-space velocity.
  vec2 corner = position.xy;
  float c = cos(rot);
  float s = sin(rot);
  vec2 rotated = vec2(corner.x * c - corner.y * s, corner.x * s + corner.y * c);
  vec2 offset = rotated * size;

  float stretch = aStyle.z;
  if (stretch > 0.0001) {
    vec3 vView = (modelViewMatrix * vec4(vel, 0.0)).xyz;
    vec2 dir = vView.xy;
    float len = length(dir);
    if (len > 0.0001) {
      dir /= len;
      vec2 perp = vec2(-dir.y, dir.x);
      float along = corner.y * size * (1.0 + stretch * min(len, 40.0) * 0.06);
      float across = corner.x * size;
      offset = dir * along + perp * across;
    }
  }

  mv.xy += offset;
  gl_Position = projectionMatrix * mv;

  vColor = vec4(mix(aColor0.rgb, aColor1.rgb, t), mix(aColor0.a, aColor1.a, t));
  vAdditive = aStyle.y;

  float sprite = aStyle.x;
  float col = mod(sprite, uAtlas.x);
  float row = floor(sprite / uAtlas.x);
  vUv = (uv + vec2(col, row)) / uAtlas;

  #include <logdepthbuf_vertex>
}
`;

const FRAGMENT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>

uniform sampler2D uAtlasMap;
varying vec4 vColor;
varying vec2 vUv;
varying float vAdditive;

void main() {
  #include <logdepthbuf_fragment>
  vec4 texel = texture2D(uAtlasMap, vUv);
  float alpha = texel.a * vColor.a;
  if (alpha < 0.003) discard;
  vec3 rgb = texel.rgb * vColor.rgb;
  // Additive particles pre-multiply by alpha and leave the destination alone;
  // alpha-blended ones go through normal source-over.
  gl_FragColor = vec4(rgb * mix(1.0, alpha, vAdditive), mix(alpha, 0.0, vAdditive));
  #include <colorspace_fragment>
}
`;

export class ParticleSystem {
  readonly mesh: THREE.Mesh;
  private readonly capacity: number;
  private cursor = 0;
  private time = 0;

  private readonly spawnPos: Float32Array;
  private readonly velocity: Float32Array;
  private readonly params: Float32Array;
  private readonly color0: Float32Array;
  private readonly color1: Float32Array;
  private readonly phys: Float32Array;
  private readonly style: Float32Array;
  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private dirtyLow = Infinity;
  private dirtyHigh = -1;

  constructor(capacity = 8192) {
    this.capacity = capacity;
    const base = new THREE.PlaneGeometry(1, 1);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = base.index;
    geometry.attributes["position"] = base.attributes["position"]!;
    geometry.attributes["uv"] = base.attributes["uv"]!;
    geometry.instanceCount = capacity;

    this.spawnPos = new Float32Array(capacity * 3);
    this.velocity = new Float32Array(capacity * 3);
    this.params = new Float32Array(capacity * 4);
    this.color0 = new Float32Array(capacity * 4);
    this.color1 = new Float32Array(capacity * 4);
    this.phys = new Float32Array(capacity * 4);
    this.style = new Float32Array(capacity * 4);
    // Everything starts dead: spawnTime far in the past with zero lifetime.
    for (let i = 0; i < capacity; i += 1) {
      this.params[i * 4] = -1000;
      this.params[i * 4 + 1] = 0.001;
    }

    const add = (name: string, array: Float32Array, size: number): void => {
      const attribute = new THREE.InstancedBufferAttribute(array, size);
      attribute.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute(name, attribute);
    };
    add("aSpawnPos", this.spawnPos, 3);
    add("aVelocity", this.velocity, 3);
    add("aParams", this.params, 4);
    add("aColor0", this.color0, 4);
    add("aColor1", this.color1, 4);
    add("aPhys", this.phys, 4);
    add("aStyle", this.style, 4);

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uTime: { value: 0 },
        uAtlasMap: { value: getParticleAtlas() },
        uAtlas: { value: new THREE.Vector2(ATLAS_COLS, ATLAS_ROWS) },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      toneMapped: true,
    });

    this.geometry = geometry;
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 12;
    this.mesh.name = "fx-particles";
    this.mesh.userData["noCollide"] = true;
    base.dispose();
  }

  /** Emit one particle. Returns its slot index. */
  spawn(p: SpawnParams): number {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    const i3 = i * 3;
    const i4 = i * 4;
    this.spawnPos[i3] = p.position.x;
    this.spawnPos[i3 + 1] = p.position.y;
    this.spawnPos[i3 + 2] = p.position.z;
    this.velocity[i3] = p.velocity.x;
    this.velocity[i3 + 1] = p.velocity.y;
    this.velocity[i3 + 2] = p.velocity.z;
    this.params[i4] = this.time;
    this.params[i4 + 1] = Math.max(0.02, p.lifetime);
    this.params[i4 + 2] = p.size0;
    this.params[i4 + 3] = p.size1;
    this.color0[i4] = p.color0.r;
    this.color0[i4 + 1] = p.color0.g;
    this.color0[i4 + 2] = p.color0.b;
    this.color0[i4 + 3] = p.alpha0;
    this.color1[i4] = p.color1.r;
    this.color1[i4 + 1] = p.color1.g;
    this.color1[i4 + 2] = p.color1.b;
    this.color1[i4 + 3] = p.alpha1;
    this.phys[i4] = p.gravity;
    this.phys[i4 + 1] = p.drag;
    this.phys[i4 + 2] = p.rotation;
    this.phys[i4 + 3] = p.rotationRate;
    this.style[i4] = p.sprite;
    this.style[i4 + 1] = p.additive;
    this.style[i4 + 2] = p.stretch;
    this.style[i4 + 3] = p.turbulence;

    if (i < this.dirtyLow) this.dirtyLow = i;
    if (i > this.dirtyHigh) this.dirtyHigh = i;
    return i;
  }

  update(dt: number): void {
    this.time += dt;
    this.material.uniforms["uTime"]!.value = this.time;
    if (this.dirtyHigh < this.dirtyLow) return;
    // Upload only the slots touched since the last frame.
    const lo = this.dirtyLow;
    const count = this.dirtyHigh - lo + 1;
    const flush = (name: string, size: number): void => {
      const attribute = this.geometry.getAttribute(name) as THREE.InstancedBufferAttribute;
      attribute.clearUpdateRanges();
      attribute.addUpdateRange(lo * size, count * size);
      attribute.needsUpdate = true;
    };
    flush("aSpawnPos", 3);
    flush("aVelocity", 3);
    flush("aParams", 4);
    flush("aColor0", 4);
    flush("aColor1", 4);
    flush("aPhys", 4);
    flush("aStyle", 4);
    this.dirtyLow = Infinity;
    this.dirtyHigh = -1;
  }

  get now(): number {
    return this.time;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
