import * as THREE from "three";
import { mulberry32 } from "@/lib/noise";
import { SURFACE_PROFILES, type ImpactRequest, type SurfaceType } from "../core/types";
import { game, queueSound } from "../core/gameState";
import type { CollisionWorld } from "../physics/collisionWorld";
import { ParticleSystem, SPRITE, makeSpawnParams, type SpriteId } from "./particles";

/**
 * Combat visual effects: tracers, impact decals, ejected brass, muzzle flash.
 *
 * Everything is pooled and instanced. The manager drains the queues on
 * `game` once per frame and never allocates in steady state.
 */

/* ------------------------------------------------------------------ */
/* Decals                                                              */
/* ------------------------------------------------------------------ */

const DECAL = {
  concrete: 0,
  metal: 1,
  wood: 2,
  glass: 3,
  sand: 4,
  blood: 5,
  scorch: 6,
  spall: 7,
} as const;

const DECAL_COLS = 4;
const DECAL_ROWS = 2;
const DECAL_TILE = 256;

function decalIndexFor(surface: SurfaceType): number {
  switch (surface) {
    case "metal":
    case "thin-metal":
      return DECAL.metal;
    case "wood":
      return DECAL.wood;
    case "glass":
      return DECAL.glass;
    case "sand":
    case "gravel":
      return DECAL.sand;
    case "flesh":
      return DECAL.blood;
    default:
      return DECAL.concrete;
  }
}

/**
 * Bullet-hole atlas. RGB is sRGB albedo and A is opacity — the decal shader
 * multiplies `texel.rgb` as colour. The crater normal is analytic in that
 * shader, so these tiles stay painted colour rather than a packed normal.
 */
function buildDecalAtlas(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = DECAL_TILE * DECAL_COLS;
  canvas.height = DECAL_TILE * DECAL_ROWS;
  const ctx = canvas.getContext("2d")!;
  const c = DECAL_TILE / 2;

  const tile = (index: number, paint: (rand: () => number) => void): void => {
    const col = index % DECAL_COLS;
    const row = Math.floor(index / DECAL_COLS);
    ctx.save();
    ctx.translate(col * DECAL_TILE, row * DECAL_TILE);
    ctx.beginPath();
    ctx.rect(0, 0, DECAL_TILE, DECAL_TILE);
    ctx.clip();
    paint(mulberry32(0x2200 + index * 6151));
    ctx.restore();
  };

  // Concrete: dark pit, pale spall lip, short radial cracks.
  tile(DECAL.concrete, (rand) => {
    const spall = ctx.createRadialGradient(c, c, c * 0.1, c, c, c * 0.56);
    spall.addColorStop(0, "rgba(220,214,202,0)");
    spall.addColorStop(0.28, "rgba(232,226,212,0.9)");
    spall.addColorStop(0.55, "rgba(196,188,174,0.34)");
    spall.addColorStop(1, "rgba(170,162,148,0)");
    ctx.fillStyle = spall;
    ctx.fillRect(0, 0, DECAL_TILE, DECAL_TILE);
    const pit = ctx.createRadialGradient(c, c, 0, c, c, c * 0.26);
    pit.addColorStop(0, "rgba(5,5,4,0.98)");
    pit.addColorStop(0.5, "rgba(18,16,14,0.92)");
    pit.addColorStop(1, "rgba(36,32,28,0)");
    ctx.fillStyle = pit;
    ctx.fillRect(0, 0, DECAL_TILE, DECAL_TILE);
    ctx.strokeStyle = "rgba(22,20,18,0.7)";
    for (let i = 0; i < 8; i += 1) {
      const angle = rand() * Math.PI * 2;
      const len = c * (0.22 + rand() * 0.28);
      ctx.lineWidth = 1 + rand() * 1.8;
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(angle) * c * 0.12, c + Math.sin(angle) * c * 0.12);
      let x = c + Math.cos(angle) * c * 0.12;
      let y = c + Math.sin(angle) * c * 0.12;
      let a = angle;
      for (let s = 0; s < 4; s += 1) {
        a += (rand() - 0.5) * 0.55;
        x += Math.cos(a) * (len / 4);
        y += Math.sin(a) * (len / 4);
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  });

  // Metal: a small heat scorch, not a silver crater.
  tile(DECAL.metal, (rand) => {
    const scorch = ctx.createRadialGradient(c, c, 0, c, c, c * 0.42);
    scorch.addColorStop(0, "rgba(8,6,5,0.96)");
    scorch.addColorStop(0.38, "rgba(36,22,12,0.78)");
    scorch.addColorStop(0.7, "rgba(72,44,24,0.28)");
    scorch.addColorStop(1, "rgba(60,40,24,0)");
    ctx.fillStyle = scorch;
    ctx.fillRect(0, 0, DECAL_TILE, DECAL_TILE);
    ctx.strokeStyle = "rgba(24,14,8,0.55)";
    for (let i = 0; i < 6; i += 1) {
      const angle = rand() * Math.PI * 2;
      ctx.lineWidth = 0.7 + rand();
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(angle) * c * 0.08, c + Math.sin(angle) * c * 0.08);
      ctx.lineTo(
        c + Math.cos(angle) * c * (0.16 + rand() * 0.16),
        c + Math.sin(angle) * c * (0.16 + rand() * 0.16),
      );
      ctx.stroke();
    }
  });

  // Wood: a splintered hole with fibres torn outward.
  tile(DECAL.wood, (rand) => {
    const g = ctx.createRadialGradient(c, c, 0, c, c, c * 0.4);
    g.addColorStop(0, "rgba(16,11,7,0.98)");
    g.addColorStop(0.55, "rgba(74,52,31,0.72)");
    g.addColorStop(1, "rgba(120,90,56,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, DECAL_TILE, DECAL_TILE);
    ctx.strokeStyle = "rgba(150,116,72,0.5)";
    for (let i = 0; i < 22; i += 1) {
      const angle = rand() * Math.PI * 2;
      ctx.lineWidth = 1 + rand() * 2;
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(angle) * c * 0.18, c + Math.sin(angle) * c * 0.18);
      ctx.lineTo(
        c + Math.cos(angle) * c * (0.4 + rand() * 0.45),
        c + Math.sin(angle) * c * (0.4 + rand() * 0.45),
      );
      ctx.stroke();
    }
  });

  // Glass: a star fracture with concentric rings.
  tile(DECAL.glass, (rand) => {
    ctx.strokeStyle = "rgba(238,246,252,0.75)";
    for (let i = 0; i < 14; i += 1) {
      const angle = (i / 14) * Math.PI * 2 + rand() * 0.2;
      ctx.lineWidth = 0.8 + rand() * 1.8;
      ctx.beginPath();
      ctx.moveTo(c, c);
      let x = c;
      let y = c;
      let a = angle;
      const len = c * (0.4 + rand() * 0.55);
      for (let s = 0; s < 4; s += 1) {
        a += (rand() - 0.5) * 0.35;
        x += Math.cos(a) * (len / 4);
        y += Math.sin(a) * (len / 4);
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.lineWidth = 1.1;
    for (let r = 0.16; r < 0.62; r += 0.12) {
      ctx.beginPath();
      for (let i = 0; i <= 24; i += 1) {
        const angle = (i / 24) * Math.PI * 2;
        const jitter = 1 + (rand() - 0.5) * 0.18;
        const px = c + Math.cos(angle) * c * r * jitter;
        const py = c + Math.sin(angle) * c * r * jitter;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    const core = ctx.createRadialGradient(c, c, 0, c, c, c * 0.16);
    core.addColorStop(0, "rgba(20,26,30,0.85)");
    core.addColorStop(1, "rgba(200,220,235,0)");
    ctx.fillStyle = core;
    ctx.fillRect(0, 0, DECAL_TILE, DECAL_TILE);
  });

  // Sand: a wide, shallow apron. Almost no dark pit.
  tile(DECAL.sand, (rand) => {
    const g = ctx.createRadialGradient(c, c, c * 0.04, c, c, c * 0.9);
    g.addColorStop(0, "rgba(96,80,54,0.42)");
    g.addColorStop(0.28, "rgba(140,120,88,0.26)");
    g.addColorStop(0.62, "rgba(186,168,136,0.14)");
    g.addColorStop(1, "rgba(200,186,152,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, DECAL_TILE, DECAL_TILE);
    for (let i = 0; i < 280; i += 1) {
      const angle = rand() * Math.PI * 2;
      const r = c * (0.12 + Math.pow(rand(), 0.45) * 0.82);
      ctx.fillStyle = `rgba(210,196,164,${0.04 + rand() * 0.1})`;
      ctx.fillRect(
        c + Math.cos(angle) * r,
        c + Math.sin(angle) * r,
        2 + rand() * 3,
        2 + rand() * 3,
      );
    }
  });

  // Blood: a small central pool with directional cast-off.
  tile(DECAL.blood, (rand) => {
    const g = ctx.createRadialGradient(c, c, 0, c, c, c * 0.36);
    g.addColorStop(0, "rgba(72,7,7,0.9)");
    g.addColorStop(0.6, "rgba(96,12,10,0.55)");
    g.addColorStop(1, "rgba(110,16,12,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, DECAL_TILE, DECAL_TILE);
    for (let i = 0; i < 26; i += 1) {
      const angle = rand() * Math.PI * 2;
      const dist = c * (0.25 + Math.pow(rand(), 0.7) * 0.6);
      const r = 2 + rand() * 8;
      ctx.fillStyle = `rgba(86,9,8,${0.25 + rand() * 0.45})`;
      ctx.beginPath();
      ctx.ellipse(
        c + Math.cos(angle) * dist,
        c + Math.sin(angle) * dist,
        r,
        r * (0.5 + rand() * 0.6),
        angle,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  });

  // Scorch: soot with a hot ring.
  tile(DECAL.scorch, (rand) => {
    const g = ctx.createRadialGradient(c, c, 0, c, c, c);
    g.addColorStop(0, "rgba(10,9,8,0.92)");
    g.addColorStop(0.42, "rgba(26,22,19,0.7)");
    g.addColorStop(0.72, "rgba(48,40,33,0.32)");
    g.addColorStop(1, "rgba(60,50,40,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, DECAL_TILE, DECAL_TILE);
    for (let i = 0; i < 40; i += 1) {
      const angle = rand() * Math.PI * 2;
      ctx.strokeStyle = `rgba(16,14,12,${0.2 + rand() * 0.4})`;
      ctx.lineWidth = 2 + rand() * 6;
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(angle) * c * 0.3, c + Math.sin(angle) * c * 0.3);
      ctx.lineTo(
        c + Math.cos(angle) * c * (0.6 + rand() * 0.4),
        c + Math.sin(angle) * c * (0.6 + rand() * 0.4),
      );
      ctx.stroke();
    }
  });

  // Exit spall: a bigger, rougher hole for penetration exits.
  tile(DECAL.spall, (rand) => {
    ctx.fillStyle = "rgba(24,22,20,0.9)";
    ctx.beginPath();
    for (let i = 0; i <= 20; i += 1) {
      const angle = (i / 20) * Math.PI * 2;
      const r = c * (0.24 + rand() * 0.2);
      const x = c + Math.cos(angle) * r;
      const y = c + Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    const g = ctx.createRadialGradient(c, c, c * 0.24, c, c, c * 0.85);
    g.addColorStop(0, "rgba(190,182,168,0.45)");
    g.addColorStop(1, "rgba(180,172,158,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, DECAL_TILE, DECAL_TILE);
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.anisotropy = 8;
  return texture;
}

const DECAL_VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec3 aCenter;
attribute vec4 aRight;   // xyz + size
attribute vec4 aUp;      // xyz + spawnTime
attribute vec4 aMeta;    // tile index, lifetime, rotation, opacity
varying vec2 vUv;
varying float vFade;
varying vec3 vNormal;
varying vec3 vTangent;
varying vec3 vBitangent;
varying vec2 vLocal;
uniform float uTime;
uniform vec2 uAtlas;
void main() {
  float age = uTime - aUp.w;
  float life = aMeta.y;
  if (age < 0.0 || age > life) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vUv = vec2(0.0);
    vFade = 0.0;
    vNormal = vec3(0.0, 1.0, 0.0);
    vTangent = vec3(1.0, 0.0, 0.0);
    vBitangent = vec3(0.0, 0.0, 1.0);
    vLocal = vec2(0.0);
    return;
  }
  float rot = aMeta.z;
  float c = cos(rot);
  float s = sin(rot);
  vec2 corner = position.xy;
  vec2 r = vec2(corner.x * c - corner.y * s, corner.x * s + corner.y * c) * aRight.w;
  vec3 world = aCenter + aRight.xyz * r.x + aUp.xyz * r.y;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  float tile = aMeta.x;
  float col = mod(tile, uAtlas.x);
  float row = floor(tile / uAtlas.x);
  vUv = (uv + vec2(col, row)) / uAtlas;
  vLocal = corner;
  vTangent = normalize(aRight.xyz);
  vBitangent = normalize(aUp.xyz);
  vNormal = normalize(cross(aRight.xyz, aUp.xyz));
  // Hold full strength for most of the life, then fade out over the last 20%.
  vFade = aMeta.w * smoothstep(1.0, 0.8, age / life);
  #include <logdepthbuf_vertex>
}
`;

const DECAL_FRAGMENT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform sampler2D uMap;
varying vec2 vUv;
varying float vFade;
varying vec3 vNormal;
varying vec3 vTangent;
varying vec3 vBitangent;
varying vec2 vLocal;
void main() {
  #include <logdepthbuf_fragment>
  vec4 texel = texture2D(uMap, vUv);
  float alpha = texel.a * vFade;
  if (alpha < 0.004) discard;

  // Analytic cavity: a dark pit and a lip that catches the sun. Albedo
  // stays in texel.rgb; this normal is not read out of the atlas.
  vec2 rad = vLocal * 2.0;
  float d = length(rad);
  float pit = (1.0 - smoothstep(0.0, 0.32, d)) * 0.4;
  float lip = smoothstep(0.16, 0.38, d) * (1.0 - smoothstep(0.38, 0.7, d));
  vec3 craterN = normalize(vNormal + (-rad.x * vTangent - rad.y * vBitangent) * (lip * 0.9 - pit));
  vec3 sunDir = normalize(vec3(0.42, 0.82, -0.38));
  float diff = clamp(dot(craterN, sunDir), 0.2, 1.32);

  gl_FragColor = vec4(texel.rgb * diff, alpha);
  #include <colorspace_fragment>
}
`;

class DecalRenderer {
  readonly mesh: THREE.Mesh;
  private readonly capacity: number;
  private cursor = 0;
  private time = 0;
  private readonly center: Float32Array;
  private readonly right: Float32Array;
  private readonly up: Float32Array;
  private readonly meta: Float32Array;
  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly texture: THREE.CanvasTexture;
  private readonly rand = mulberry32(0xdeca1);

  constructor(capacity = 320) {
    this.capacity = capacity;
    const base = new THREE.PlaneGeometry(1, 1);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = base.index;
    geometry.attributes["position"] = base.attributes["position"]!;
    geometry.attributes["uv"] = base.attributes["uv"]!;
    geometry.instanceCount = capacity;
    this.center = new Float32Array(capacity * 3);
    this.right = new Float32Array(capacity * 4);
    this.up = new Float32Array(capacity * 4);
    this.meta = new Float32Array(capacity * 4);
    for (let i = 0; i < capacity; i += 1) {
      this.up[i * 4 + 3] = -1000;
      this.meta[i * 4 + 1] = 0.001;
    }
    const add = (name: string, array: Float32Array, size: number): void => {
      const attribute = new THREE.InstancedBufferAttribute(array, size);
      attribute.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute(name, attribute);
    };
    add("aCenter", this.center, 3);
    add("aRight", this.right, 4);
    add("aUp", this.up, 4);
    add("aMeta", this.meta, 4);

    this.texture = buildDecalAtlas();
    this.material = new THREE.ShaderMaterial({
      vertexShader: DECAL_VERTEX,
      fragmentShader: DECAL_FRAGMENT,
      uniforms: {
        uTime: { value: 0 },
        uMap: { value: this.texture },
        uAtlas: { value: new THREE.Vector2(DECAL_COLS, DECAL_ROWS) },
      },
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    this.geometry = geometry;
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    this.mesh.name = "fx-decals";
    this.mesh.userData["noCollide"] = true;
    base.dispose();
  }

  add(
    point: THREE.Vector3,
    normal: THREE.Vector3,
    size: number,
    tile: number,
    lifetime: number,
    opacity: number,
  ): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    // Build a tangent frame around the surface normal.
    _tmpA.set(0, 1, 0);
    if (Math.abs(normal.y) > 0.94) _tmpA.set(1, 0, 0);
    _tmpB.crossVectors(_tmpA, normal).normalize();
    _tmpC.crossVectors(normal, _tmpB).normalize();
    const i3 = i * 3;
    const i4 = i * 4;
    // Lift very slightly off the surface so it never z-fights at range.
    this.center[i3] = point.x + normal.x * 0.008;
    this.center[i3 + 1] = point.y + normal.y * 0.008;
    this.center[i3 + 2] = point.z + normal.z * 0.008;
    this.right[i4] = _tmpB.x;
    this.right[i4 + 1] = _tmpB.y;
    this.right[i4 + 2] = _tmpB.z;
    this.right[i4 + 3] = size;
    this.up[i4] = _tmpC.x;
    this.up[i4 + 1] = _tmpC.y;
    this.up[i4 + 2] = _tmpC.z;
    this.up[i4 + 3] = this.time;
    this.meta[i4] = tile;
    this.meta[i4 + 1] = lifetime;
    this.meta[i4 + 2] = this.rand() * Math.PI * 2;
    this.meta[i4 + 3] = opacity;
    for (const name of ["aCenter", "aRight", "aUp", "aMeta"]) {
      this.geometry.getAttribute(name).needsUpdate = true;
    }
  }

  update(dt: number): void {
    this.time += dt;
    this.material.uniforms["uTime"]!.value = this.time;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}

/* ------------------------------------------------------------------ */
/* Tracers                                                             */
/* ------------------------------------------------------------------ */

const TRACER_VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec3 aOrigin;
attribute vec4 aDir;    // xyz + total distance
attribute vec4 aParams; // spawnTime, speed, length, width
attribute vec4 aColor;  // rgb + intensity
uniform float uTime;
varying vec4 vColor;
varying vec2 vUv;
void main() {
  float age = uTime - aParams.x;
  float travelled = age * aParams.y;
  float total = aDir.w;
  float life = total / max(1.0, aParams.y) + 0.02;
  if (age < 0.0 || age > life) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vColor = vec4(0.0);
    vUv = vec2(0.0);
    return;
  }
  float head = min(travelled, total);
  float tail = max(0.0, head - aParams.z);
  vec3 headPos = aOrigin + aDir.xyz * head;
  vec3 tailPos = aOrigin + aDir.xyz * tail;

  // Fade the first couple of metres so the shooter is not blinded, and
  // fade the tail as the round arrives so the streak stays short.
  float nearFade = smoothstep(0.0, 2.4, head);
  float endFade = 1.0 - smoothstep(total - aParams.z * 0.55, total, head);

  vec3 world = mix(tailPos, headPos, uv.y);
  vec3 viewDir = normalize(cameraPosition - world);
  vec3 side = normalize(cross(aDir.xyz, viewDir));
  float dist = max(0.5, length(cameraPosition - world));
  // Authored width is about a centimetre. The distance term holds a
  // hairline on screen instead of growing a world-space ribbon.
  float width = max(aParams.w, dist * 0.00115);
  world += side * (uv.x - 0.5) * width;

  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  vUv = uv;
  vColor = vec4(aColor.rgb, aColor.w * nearFade * endFade);
  #include <logdepthbuf_vertex>
}
`;

const TRACER_FRAGMENT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
varying vec4 vColor;
varying vec2 vUv;
void main() {
  #include <logdepthbuf_fragment>
  // The quad is already a hairline. Soften the edges and fade the tail;
  // a wide sheath is what made these read as lightsabers.
  float across = clamp(1.0 - abs(vUv.x - 0.5) * 2.0, 0.0, 1.0);
  float core = smoothstep(0.0, 0.45, across);
  float along = smoothstep(0.0, 0.16, vUv.y) * pow(max(vUv.y, 0.0001), 2.05);
  float mask = core * along * vColor.a;
  if (mask < 0.02) discard;
  gl_FragColor = vec4(vColor.rgb * mask, 0.0);
}
`;

class TracerRenderer {
  readonly mesh: THREE.Mesh;
  private readonly capacity: number;
  private cursor = 0;
  private time = 0;
  private readonly origin: Float32Array;
  private readonly dir: Float32Array;
  private readonly params: Float32Array;
  private readonly color: Float32Array;
  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly material: THREE.ShaderMaterial;

  constructor(capacity = 256) {
    this.capacity = capacity;
    const base = new THREE.PlaneGeometry(1, 1);
    base.translate(0, 0.5, 0);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = base.index;
    geometry.attributes["position"] = base.attributes["position"]!;
    geometry.attributes["uv"] = base.attributes["uv"]!;
    geometry.instanceCount = capacity;
    this.origin = new Float32Array(capacity * 3);
    this.dir = new Float32Array(capacity * 4);
    this.params = new Float32Array(capacity * 4);
    this.color = new Float32Array(capacity * 4);
    for (let i = 0; i < capacity; i += 1) this.params[i * 4] = -1000;
    const add = (name: string, array: Float32Array, size: number): void => {
      const attribute = new THREE.InstancedBufferAttribute(array, size);
      attribute.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute(name, attribute);
    };
    add("aOrigin", this.origin, 3);
    add("aDir", this.dir, 4);
    add("aParams", this.params, 4);
    add("aColor", this.color, 4);

    this.material = new THREE.ShaderMaterial({
      vertexShader: TRACER_VERTEX,
      fragmentShader: TRACER_FRAGMENT,
      uniforms: { uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: true,
    });
    this.geometry = geometry;
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 11;
    this.mesh.name = "fx-tracers";
    this.mesh.userData["noCollide"] = true;
    base.dispose();
  }

  add(
    from: THREE.Vector3,
    to: THREE.Vector3,
    speed: number,
    color: number,
    local: boolean,
  ): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    _tmpA.copy(to).sub(from);
    const distance = _tmpA.length();
    if (distance < 0.05) return;
    _tmpA.multiplyScalar(1 / distance);
    const i3 = i * 3;
    const i4 = i * 4;
    this.origin[i3] = from.x;
    this.origin[i3 + 1] = from.y;
    this.origin[i3 + 2] = from.z;
    this.dir[i4] = _tmpA.x;
    this.dir[i4 + 1] = _tmpA.y;
    this.dir[i4 + 2] = _tmpA.z;
    this.dir[i4 + 3] = distance;
    this.params[i4] = this.time;
    this.params[i4 + 1] = speed;
    this.params[i4 + 2] = local ? 1.7 : 1.25;
    this.params[i4 + 3] = local ? 0.011 : 0.008;
    _tmpColor.setHex(color);
    // HDR so the hairline still blooms. The quad itself stays thin.
    const gain = local ? 4.6 : 3.6;
    this.color[i4] = _tmpColor.r * gain;
    this.color[i4 + 1] = _tmpColor.g * gain;
    this.color[i4 + 2] = _tmpColor.b * gain;
    this.color[i4 + 3] = 1;
    for (const name of ["aOrigin", "aDir", "aParams", "aColor"]) {
      this.geometry.getAttribute(name).needsUpdate = true;
    }
  }

  update(dt: number): void {
    this.time += dt;
    this.material.uniforms["uTime"]!.value = this.time;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

/* ------------------------------------------------------------------ */
/* Ejected brass                                                       */
/* ------------------------------------------------------------------ */

interface Casing {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  spin: THREE.Vector3;
  rotation: THREE.Quaternion;
  life: number;
  bounces: number;
  active: boolean;
}

class CasingRenderer {
  readonly mesh: THREE.InstancedMesh;
  private readonly casings: Casing[] = [];
  private cursor = 0;
  private readonly dummy = new THREE.Object3D();
  private readonly rand = mulberry32(0xc51a9);

  constructor(capacity = 64) {
    // A small rifle case: rim, groove, body, mouth. Kept under a real
    // 5.56 so it reads as a tumbling glint beside the gun, not a gold bar.
    const profile: [number, number][] = [
      [0.0, -0.019],
      [0.0048, -0.019],
      [0.0048, -0.0174],
      [0.0037, -0.0166],
      [0.0037, -0.0152],
      [0.0043, -0.0142],
      [0.0043, 0.011],
      [0.0038, 0.0165],
      [0.0038, 0.019],
      [0.0, 0.019],
    ];
    const points = profile.map(([r, y]) => new THREE.Vector2(Math.max(1e-5, r), y));
    const geometry = new THREE.LatheGeometry(points, 18);
    const material = new THREE.MeshPhysicalMaterial({
      name: "casing-brass-metal",
      color: 0x7a6236,
      metalness: 1,
      roughness: 0.5,
      clearcoat: 0.65,
      clearcoatRoughness: 0.16,
      envMapIntensity: 0.55,
    });
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.name = "fx-casings";
    this.mesh.userData["noCollide"] = true;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < capacity; i += 1) {
      this.casings.push({
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        spin: new THREE.Vector3(),
        rotation: new THREE.Quaternion(),
        life: 0,
        bounces: 0,
        active: false,
      });
      this.dummy.position.set(0, -9999, 0);
      this.dummy.scale.setScalar(1);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
  }

  eject(
    position: THREE.Vector3,
    direction: THREE.Vector3,
    rand: () => number,
    linearVelocity?: THREE.Vector3,
  ): void {
    const casing = this.casings[this.cursor]!;
    this.cursor = (this.cursor + 1) % this.casings.length;
    casing.position.copy(position);
    casing.velocity
      .copy(direction)
      .multiplyScalar(3.2 + rand() * 1.6)
      .add(_tmpA.set((rand() - 0.5) * 0.8, 1.8 + rand() * 1.0, (rand() - 0.5) * 0.8));
    if (linearVelocity) {
      casing.velocity.addScaledVector(linearVelocity, 0.6);
    }
    // Slow enough that the clearcoat highlight travels instead of blurring.
    casing.spin.set((rand() - 0.5) * 22, (rand() - 0.5) * 14, 16 + rand() * 18);
    casing.rotation.identity();
    casing.life = 0;
    casing.bounces = 0;
    casing.active = true;
  }

  update(dt: number, world: CollisionWorld | null): void {
    let dirty = false;
    for (let i = 0; i < this.casings.length; i += 1) {
      const casing = this.casings[i]!;
      if (!casing.active) continue;
      dirty = true;
      casing.life += dt;
      if (casing.life > 11) {
        casing.active = false;
        this.dummy.position.set(0, -9999, 0);
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(i, this.dummy.matrix);
        continue;
      }
      casing.velocity.y -= 12.5 * dt; // Gravity
      _tmpA.copy(casing.velocity).multiplyScalar(dt);
      const stepLen = _tmpA.length();
      const ground = world ? world.groundAt(casing.position.x, casing.position.z) : 0;

      let hitNormal: THREE.Vector3 | null = null;
      // Check wall/prop collisions via raycast
      if (world && stepLen > 0.005) {
        _tmpB.copy(casing.velocity).normalize();
        const wallHit = world.raycast(casing.position, _tmpB, stepLen + 0.015, 0x07);
        if (wallHit && wallHit.distance <= stepLen + 0.01) {
          casing.position.copy(wallHit.point).addScaledVector(wallHit.normal, 0.008);
          hitNormal = wallHit.normal;
        }
      }

      if (!hitNormal) {
        casing.position.add(_tmpA);
        if (casing.position.y <= ground + 0.006) {
          casing.position.y = ground + 0.006;
          _tmpC.set(0, 1, 0);
          hitNormal = _tmpC;
        }
      }

      // Physical bouncing with restitution, spin disruption, and metallic clatter audio
      if (hitNormal) {
        const speed = casing.velocity.length();
        if (speed > 0.4 && casing.bounces < 4) {
          casing.bounces += 1;
          casing.velocity.reflect(hitNormal).multiplyScalar(0.44);
          casing.spin.set(
            (this.rand() - 0.5) * 18,
            (this.rand() - 0.5) * 10,
            (this.rand() - 0.5) * 18,
          );
          if (casing.bounces <= 3) {
            queueSound({
              id: "shell-drop",
              position: casing.position.clone(),
              gain: Math.min(0.65, 0.45 / casing.bounces),
              pitch: 0.92 + this.rand() * 0.22,
            });
          }
        } else {
          casing.velocity.set(0, 0, 0);
          casing.spin.multiplyScalar(0.7);
        }
      }

      if (casing.spin.lengthSq() > 1e-5) {
        _tmpQuat.setFromEuler(
          _tmpEuler.set(casing.spin.x * dt, casing.spin.y * dt, casing.spin.z * dt),
        );
        casing.rotation.multiply(_tmpQuat);
      }
      this.dummy.position.copy(casing.position);
      this.dummy.quaternion.copy(casing.rotation);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    if (dirty) this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

/* ------------------------------------------------------------------ */
/* Manager                                                             */
/* ------------------------------------------------------------------ */

const _tmpA = new THREE.Vector3();
const _tmpB = new THREE.Vector3();
const _tmpC = new THREE.Vector3();
const _tmpColor = new THREE.Color();
const _tmpQuat = new THREE.Quaternion();
const _tmpEuler = new THREE.Euler();
const _spawn = makeSpawnParams();

export interface FxQuality {
  /** Scales every particle count. */
  particleScale: number;
  decals: boolean;
  casings: boolean;
  flashLights: number;
}

export class FxManager {
  readonly group = new THREE.Group();
  private readonly particles: ParticleSystem;
  private readonly decals: DecalRenderer;
  private readonly tracers: TracerRenderer;
  private readonly casings: CasingRenderer;
  private readonly flashLights: THREE.PointLight[] = [];
  private readonly flashTimers: number[] = [];
  private flashCursor = 0;
  private readonly rand = mulberry32(0xf0cca);
  private quality: FxQuality = {
    particleScale: 1,
    decals: true,
    casings: true,
    flashLights: 4,
  };

  constructor() {
    this.particles = new ParticleSystem(8192);
    this.decals = new DecalRenderer(320);
    this.tracers = new TracerRenderer(256);
    this.casings = new CasingRenderer(64);
    this.group.name = "combat-fx";
    this.group.userData["noCollide"] = true;
    this.group.add(
      this.particles.mesh,
      this.decals.mesh,
      this.tracers.mesh,
      this.casings.mesh,
    );
    for (let i = 0; i < 4; i += 1) {
      const light = new THREE.PointLight(0xffcf94, 0, 14, 2);
      light.castShadow = false;
      light.visible = false;
      this.flashLights.push(light);
      this.flashTimers.push(0);
      this.group.add(light);
    }
  }

  setQuality(quality: Partial<FxQuality>): void {
    this.quality = { ...this.quality, ...quality };
  }

  /* ---------------------------------------------------------------- */

  /**
   * One-to-two frame white core, a short warm anisotropic blast, then a
   * hot puff that gives way to darker drifting smoke. Suppressed shots
   * skip the flash and keep the smoke.
   */
  muzzleFlash(
    position: THREE.Vector3,
    direction: THREE.Vector3,
    calibre: number,
    suppressed: boolean,
    firstPerson: boolean,
  ): void {
    const rand = this.rand;
    const scale = this.quality.particleScale;
    const view = firstPerson ? 1 : 0.62;
    if (!suppressed) {
      const core = _spawn;
      core.position.copy(position).addScaledVector(direction, 0.012);
      core.velocity.copy(direction).multiplyScalar(0.5);
      // Same-frame update ages the particle by dt, so this is one hard
      // frame plus a ghost at 60 Hz, and gone after that.
      core.lifetime = 0.04;
      core.size0 = calibre * 0.16 * view;
      core.size1 = calibre * 0.09 * view;
      core.color0.setRGB(18, 17, 15);
      core.color1.setRGB(14, 12.5, 10);
      core.alpha0 = 1;
      core.alpha1 = 0;
      core.gravity = 0;
      core.drag = 8;
      core.rotation = rand() * Math.PI * 2;
      core.rotationRate = 0;
      core.sprite = SPRITE.flash;
      core.additive = 1;
      core.stretch = 0;
      core.turbulence = 0;
      this.particles.spawn(core);

      const blast = _spawn;
      blast.position.copy(position).addScaledVector(direction, 0.026);
      blast.velocity.copy(direction).multiplyScalar(1.2);
      blast.lifetime = 0.052;
      blast.size0 = calibre * 0.46 * view;
      blast.size1 = calibre * 0.3 * view;
      blast.color0.setRGB(12, 6.6, 2.0);
      blast.color1.setRGB(4.0, 1.2, 0.2);
      blast.alpha0 = 1;
      blast.alpha1 = 0;
      blast.gravity = 0;
      blast.drag = 10;
      // Sprite long-axis is horizontal. Stay near that so it reads as a
      // streak, not a spinning disc.
      blast.rotation = (rand() - 0.5) * 0.4;
      blast.rotationRate = 0;
      blast.sprite = SPRITE.crossFlash;
      blast.additive = 1;
      blast.stretch = 0;
      blast.turbulence = 0;
      this.particles.spawn(blast);

      const sparks = Math.max(2, Math.round(3 * scale));
      for (let i = 0; i < sparks; i += 1) {
        const p = _spawn;
        p.position.copy(position).addScaledVector(direction, 0.02);
        p.velocity
          .copy(direction)
          .multiplyScalar(7 + rand() * 8)
          .add(
            _tmpA.set((rand() - 0.5) * 2.0, (rand() - 0.5) * 2.0, (rand() - 0.5) * 2.0),
          );
        p.lifetime = 0.05 + rand() * 0.06;
        p.size0 = 0.016;
        p.size1 = 0.005;
        p.color0.setRGB(14, 8, 2);
        p.color1.setRGB(3.2, 0.7, 0.08);
        p.alpha0 = 1;
        p.alpha1 = 0;
        p.gravity = 7;
        p.drag = 2.6;
        p.rotation = 0;
        p.rotationRate = 0;
        p.sprite = SPRITE.spark;
        p.additive = 1;
        p.stretch = 4.5;
        p.turbulence = 0;
        this.particles.spawn(p);
      }

      this.popFlashLight(position, calibre);
    }

    // Hot puff: the blast's own smoke, small, warm, gone quickly.
    const hotCount = Math.max(1, Math.round((suppressed ? 2 : 1) * scale));
    for (let i = 0; i < hotCount; i += 1) {
      const p = _spawn;
      p.position.copy(position).addScaledVector(direction, 0.02 + rand() * 0.03);
      p.velocity
        .copy(direction)
        .multiplyScalar(1.0 + rand() * 0.7)
        .add(_tmpA.set((rand() - 0.5) * 0.3, 0.22 + rand() * 0.18, (rand() - 0.5) * 0.3));
      p.lifetime = 0.16 + rand() * 0.1;
      p.size0 = calibre * 0.13 * view;
      p.size1 = calibre * 0.36 * view;
      p.color0.setRGB(0.56, 0.44, 0.32);
      p.color1.setRGB(0.34, 0.3, 0.26);
      p.alpha0 = suppressed ? 0.48 : 0.36;
      p.alpha1 = 0;
      p.gravity = 0.9;
      p.drag = 3.4;
      p.rotation = rand() * 6.28;
      p.rotationRate = (rand() - 0.5) * 1.1;
      p.sprite = SPRITE.smoke;
      p.additive = 0;
      p.stretch = 0;
      p.turbulence = 0.12;
      this.particles.spawn(p);
    }

    // Grey drift: darker, softer, lingers and rises.
    const driftCount = Math.max(1, Math.round((suppressed ? 2 : 1) * scale));
    for (let i = 0; i < driftCount; i += 1) {
      const p = _spawn;
      p.position.copy(position).addScaledVector(direction, 0.04 + rand() * 0.05);
      p.velocity
        .copy(direction)
        .multiplyScalar(0.3 + rand() * 0.35)
        .add(
          _tmpA.set((rand() - 0.5) * 0.22, 0.32 + rand() * 0.3, (rand() - 0.5) * 0.22),
        );
      p.lifetime = 0.85 + rand() * 0.7;
      p.size0 = calibre * 0.16 * view;
      p.size1 = calibre * (0.7 + rand() * 0.26) * view;
      p.color0.setRGB(0.22, 0.21, 0.19);
      p.color1.setRGB(0.15, 0.14, 0.13);
      p.alpha0 = suppressed ? 0.32 : 0.22;
      p.alpha1 = 0;
      p.gravity = -0.26;
      p.drag = 1.15;
      p.rotation = rand() * 6.28;
      p.rotationRate = (rand() - 0.5) * 0.7;
      p.sprite = SPRITE.smoke;
      p.additive = 0;
      p.stretch = 0;
      p.turbulence = 0.48;
      this.particles.spawn(p);
    }
  }

  private popFlashLight(position: THREE.Vector3, calibre: number): void {
    if (this.quality.flashLights <= 0) return;
    const count = Math.min(this.flashLights.length, this.quality.flashLights);
    const index = this.flashCursor % count;
    this.flashCursor += 1;
    const light = this.flashLights[index]!;
    light.position.copy(position);
    light.color.setHex(0xfff6ec);
    light.intensity = 14 * calibre * 10;
    light.distance = 5.2;
    light.visible = true;
    // Outlives the same-frame decrement and is gone inside two frames.
    this.flashTimers[index] = 0.042;
  }

  /** Casing ejection, called by the weapon layer with the port transform. */
  ejectCasing(
    position: THREE.Vector3,
    direction: THREE.Vector3,
    linearVelocity?: THREE.Vector3,
  ): void {
    if (!this.quality.casings) return;
    this.casings.eject(position, direction, this.rand, linearVelocity);
  }

  /** Barrel heat mirage: shimmering refractive heat waves rising off a hot barrel. */
  barrelHeatMirage(
    position: THREE.Vector3,
    direction: THREE.Vector3,
    heat: number,
  ): void {
    if (heat < 0.15) return;
    const rand = this.rand;
    const count = Math.min(3, Math.round(heat * 2.8 * this.quality.particleScale));
    for (let i = 0; i < count; i += 1) {
      const p = _spawn;
      p.position.copy(position).addScaledVector(direction, (rand() - 0.5) * 0.2);
      p.position.y += 0.015 + rand() * 0.03;
      p.velocity.set((rand() - 0.5) * 0.12, 0.45 + rand() * 0.6, (rand() - 0.5) * 0.12);
      p.lifetime = 0.32 + rand() * 0.35;
      p.size0 = 0.04 + rand() * 0.03;
      p.size1 = 0.18 + rand() * 0.12;
      p.color0.setRGB(1.0, 1.0, 1.0);
      p.color1.setRGB(0.92, 0.9, 0.88);
      p.alpha0 = Math.min(0.24, 0.08 * heat);
      p.alpha1 = 0;
      p.gravity = -1.8;
      p.drag = 1.3;
      p.rotation = rand() * 6.28;
      p.rotationRate = (rand() - 0.5) * 3.5;
      p.sprite = SPRITE.heatHaze;
      p.additive = 1;
      p.stretch = 0;
      p.turbulence = 0.7;
      this.particles.spawn(p);
    }
  }

  /** Barrel smoke wisps rising off hot barrel after sustained burst fire. */
  barrelSmoke(position: THREE.Vector3, direction: THREE.Vector3, heat: number): void {
    if (heat < 0.25) return;
    const rand = this.rand;
    const count = Math.min(2, Math.round(heat * 1.8 * this.quality.particleScale));
    for (let i = 0; i < count; i += 1) {
      const p = _spawn;
      p.position.copy(position).addScaledVector(direction, (rand() - 0.5) * 0.15);
      p.position.y += 0.01 + rand() * 0.02;
      p.velocity.set((rand() - 0.5) * 0.08, 0.3 + rand() * 0.4, (rand() - 0.5) * 0.08);
      p.lifetime = 0.65 + rand() * 0.6;
      p.size0 = 0.025 + rand() * 0.02;
      p.size1 = 0.18 + rand() * 0.14;
      p.color0.setRGB(0.5, 0.48, 0.45);
      p.color1.setRGB(0.35, 0.34, 0.32);
      p.alpha0 = Math.min(0.25, 0.12 * heat);
      p.alpha1 = 0;
      p.gravity = -1.4;
      p.drag = 1.1;
      p.rotation = rand() * 6.28;
      p.rotationRate = (rand() - 0.5) * 1.8;
      p.sprite = SPRITE.smoke;
      p.additive = 0;
      p.stretch = 0;
      p.turbulence = 0.4;
      this.particles.spawn(p);
    }
  }

  /* ---------------------------------------------------------------- */

  private impact(request: ImpactRequest): void {
    const rand = this.rand;
    const profile = SURFACE_PROFILES[request.surface];
    const scale = this.quality.particleScale;
    const energy = Math.max(0.15, Math.min(1, request.energy));
    _tmpColor.setHex(profile.debrisColor);

    if (request.kind === "explosion") {
      this.explosion(request.point, energy);
      return;
    }

    const isBlood = request.kind === "blood" || request.kind === "blood-headshot";
    if (isBlood) {
      const isHeadshot = request.kind === "blood-headshot";
      const drops = Math.round((isHeadshot ? 26 : 14) * scale);
      // Directional arterial splatter
      for (let i = 0; i < drops; i += 1) {
        const p = _spawn;
        p.position.copy(request.point);
        p.velocity
          .copy(request.incoming)
          .multiplyScalar(2.5 + rand() * 6.5)
          .add(_tmpA.set((rand() - 0.5) * 4, (rand() - 0.5) * 4, (rand() - 0.5) * 4));
        p.lifetime = 0.38 + rand() * 0.55;
        p.size0 = 0.035 + rand() * 0.06;
        p.size1 = 0.016;
        p.color0.setRGB(0.35, 0.02, 0.02);
        p.color1.setRGB(0.15, 0.01, 0.01);
        p.alpha0 = 0.9;
        p.alpha1 = 0;
        p.gravity = 11;
        p.drag = 1.3;
        p.rotation = rand() * 6.28;
        p.rotationRate = (rand() - 0.5) * 8;
        p.sprite = SPRITE.blood;
        p.additive = 0;
        p.stretch = 0.7;
        p.turbulence = 0;
        this.particles.spawn(p);
      }

      // Volumetric hanging blood mist
      const mistClouds = isHeadshot ? 2 : 1;
      for (let m = 0; m < mistClouds; m += 1) {
        const mist = _spawn;
        mist.position.copy(request.point).addScaledVector(request.incoming, 0.05 * m);
        mist.velocity.copy(request.incoming).multiplyScalar(1.2 + rand() * 0.8);
        mist.lifetime = 0.55 + rand() * 0.3;
        mist.size0 = isHeadshot ? 0.16 : 0.11;
        mist.size1 = isHeadshot ? 0.58 : 0.44;
        mist.color0.setRGB(0.32, 0.03, 0.03);
        mist.color1.setRGB(0.18, 0.015, 0.015);
        mist.alpha0 = isHeadshot ? 0.55 : 0.42;
        mist.alpha1 = 0;
        mist.gravity = 1.2;
        mist.drag = 2.8;
        mist.rotation = rand() * 6.28;
        mist.rotationRate = 1.2;
        mist.sprite = SPRITE.bloodMist;
        mist.additive = 0;
        mist.stretch = 0;
        mist.turbulence = 0.28;
        this.particles.spawn(mist);
      }
      return;
    }

    const isMetal = request.surface === "metal" || request.surface === "thin-metal";
    const isSand = request.surface === "sand";
    const isGravel = request.surface === "gravel";
    const isGlass = request.surface === "glass";
    const loose = isSand || isGravel;

    /* ------------------------------------------------- metal contact */
    if (isMetal) {
      const flash = _spawn;
      flash.position.copy(request.point).addScaledVector(request.normal, 0.01);
      flash.velocity.copy(request.normal).multiplyScalar(0.25);
      flash.lifetime = 0.03;
      flash.size0 = 0.026 * (0.7 + energy);
      flash.size1 = 0.01;
      flash.color0.setRGB(16, 13, 8);
      flash.color1.setRGB(7, 2.4, 0.3);
      flash.alpha0 = 1;
      flash.alpha1 = 0;
      flash.gravity = 0;
      flash.drag = 6;
      flash.rotation = rand() * 6.28;
      flash.rotationRate = 0;
      flash.sprite = SPRITE.flash;
      flash.additive = 1;
      flash.stretch = 0;
      flash.turbulence = 0;
      this.particles.spawn(flash);
    }

    /* -------------------------------------------------------- sparks */
    // Sand's sparkiness is 0, so a sand hit grows a dust fan and almost
    // no spark. Metal spends its budget on streaks.
    const sparkCount = Math.round(
      profile.sparkiness * (isMetal ? 9 : 8) * energy * scale,
    );
    for (let i = 0; i < sparkCount; i += 1) {
      const p = _spawn;
      p.position.copy(request.point);
      _tmpA.copy(request.incoming).reflect(request.normal);
      p.velocity
        .copy(_tmpA)
        .multiplyScalar((isMetal ? 8 : 3.5) + rand() * (isMetal ? 14 : 7))
        .add(
          _tmpB.set(
            (rand() - 0.5) * (isMetal ? 4 : 3),
            (rand() - 0.5) * 3,
            (rand() - 0.5) * (isMetal ? 4 : 3),
          ),
        );
      p.lifetime = isMetal ? 0.09 + rand() * 0.14 : 0.16 + rand() * 0.2;
      p.size0 = isMetal ? 0.02 : 0.014;
      p.size1 = 0.004;
      if (isMetal) {
        p.color0.setRGB(16, 9.2, 2.2);
        p.color1.setRGB(3.4, 0.55, 0.05);
      } else {
        p.color0.setRGB(9, 4.8, 1.2);
        p.color1.setRGB(2, 0.35, 0.04);
      }
      p.alpha0 = 1;
      p.alpha1 = 0;
      p.gravity = isMetal ? 11 : 9.81;
      p.drag = isMetal ? 0.85 : 1.3;
      p.rotation = 0;
      p.rotationRate = 0;
      p.sprite = SPRITE.spark;
      p.additive = 1;
      p.stretch = isMetal ? 7.2 : 3.4;
      p.turbulence = 0;
      this.particles.spawn(p);
    }

    /* --------------------------------------------------------- dust */
    // Metal gets streaks and a scorch, not a dust cloud. Glass neither.
    if (!isMetal && !isGlass) {
      const dustCount = Math.round((isSand ? 14 : isGravel ? 9 : 5) * energy * scale);
      const spread = isSand ? 3.8 : isGravel ? 2.5 : 1.1;
      for (let i = 0; i < dustCount; i += 1) {
        const p = _spawn;
        p.position.copy(request.point).addScaledVector(request.normal, 0.02);
        p.velocity
          .copy(request.normal)
          .multiplyScalar(loose ? 0.55 + rand() * 1.3 : 1.1 + rand() * 1.3)
          .add(
            _tmpA.set(
              (rand() - 0.5) * spread,
              rand() * (loose ? 1.5 : 0.9),
              (rand() - 0.5) * spread,
            ),
          );
        p.lifetime = loose ? 0.6 + rand() * 0.8 : 0.32 + rand() * 0.4;
        p.size0 = loose ? 0.07 : 0.035;
        p.size1 = loose ? 0.36 + rand() * 0.28 : 0.11 + rand() * 0.08;
        p.color0.copy(_tmpColor).multiplyScalar(loose ? 1.08 : 1.02);
        p.color1.copy(_tmpColor).multiplyScalar(0.7);
        p.alpha0 = loose ? 0.34 : 0.55;
        p.alpha1 = 0;
        // Positive gravity so the puff rises on its initial velocity and settles.
        p.gravity = loose ? 2.6 : 5.4;
        p.drag = loose ? 1.45 : 2.7;
        p.rotation = rand() * 6.28;
        p.rotationRate = (rand() - 0.5) * 1.4;
        p.sprite = SPRITE.dust;
        p.additive = 0;
        p.stretch = 0;
        p.turbulence = loose ? 0.22 : 0.12;
        this.particles.spawn(p);
      }
    }

    /* ------------------------------------------------------- debris */
    const debrisCount = isMetal
      ? 0
      : Math.round((isGlass ? 5 : loose ? 2 : 3) * energy * scale);
    for (let i = 0; i < debrisCount; i += 1) {
      const p = _spawn;
      p.position.copy(request.point);
      p.velocity
        .copy(request.normal)
        .multiplyScalar((loose ? 1.3 : 2.2) + rand() * (loose ? 2.2 : 4))
        .add(
          _tmpA.set(
            (rand() - 0.5) * (loose ? 2 : 3.2),
            rand() * 1.5,
            (rand() - 0.5) * (loose ? 2 : 3.2),
          ),
        );
      p.lifetime = 0.4 + rand() * 0.5;
      p.size0 = (isGlass ? 0.012 : 0.008) + rand() * 0.009;
      p.size1 = 0.006;
      p.color0.copy(_tmpColor).multiplyScalar(isGlass ? 1.15 : 0.58);
      p.color1.copy(_tmpColor).multiplyScalar(0.38);
      p.alpha0 = 0.95;
      p.alpha1 = 0.1;
      p.gravity = loose ? 10 : 14;
      p.drag = 0.55;
      p.rotation = rand() * 6.28;
      p.rotationRate = (rand() - 0.5) * 12;
      p.sprite = SPRITE.debris;
      p.additive = 0;
      p.stretch = 0.12;
      p.turbulence = 0;
      this.particles.spawn(p);
    }

    /* ---------------------------------------------------- ricochet tracer */
    if (request.kind === "ricochet") {
      _tmpA.copy(request.incoming).reflect(request.normal).normalize();
      _tmpB.copy(request.point).addScaledVector(_tmpA, 40);
      this.tracers.add(request.point, _tmpB, 450, 0xffd277, false);
    }

    /* -------------------------------------------------------- decal */
    if (this.quality.decals && request.kind !== "ricochet") {
      const tile =
        request.kind === "penetration-exit"
          ? DECAL.spall
          : decalIndexFor(request.surface);
      let size =
        (request.kind === "penetration-exit" ? 0.2 : 0.125) * (0.8 + energy * 0.4);
      if (isMetal) size *= 0.46;
      else if (isSand) size *= 1.65;
      else if (isGravel) size *= 1.3;
      this.decals.add(
        request.point,
        request.normal,
        size,
        tile,
        26,
        isMetal ? 0.88 : 0.95,
      );
    }
  }

  explosion(point: THREE.Vector3, energy: number): void {
    const rand = this.rand;
    const scale = this.quality.particleScale;
    // Fireball.
    for (let i = 0; i < Math.round(10 * scale); i += 1) {
      const p = _spawn;
      p.position
        .copy(point)
        .add(_tmpA.set((rand() - 0.5) * 0.6, rand() * 0.5, (rand() - 0.5) * 0.6));
      p.velocity.set((rand() - 0.5) * 7, 1.5 + rand() * 5, (rand() - 0.5) * 7);
      p.lifetime = 0.32 + rand() * 0.28;
      p.size0 = 0.7 * energy;
      p.size1 = 3.4 * energy;
      p.color0.setRGB(14, 6, 1.4);
      p.color1.setRGB(1.2, 0.35, 0.08);
      p.alpha0 = 1;
      p.alpha1 = 0;
      p.gravity = -2.5;
      p.drag = 2.4;
      p.rotation = rand() * 6.28;
      p.rotationRate = (rand() - 0.5) * 3;
      p.sprite = SPRITE.fire;
      p.additive = 1;
      p.stretch = 0;
      p.turbulence = 0.6;
      this.particles.spawn(p);
    }
    // Shockwave ring on the ground.
    const ring = _spawn;
    ring.position.copy(point);
    ring.velocity.set(0, 0.4, 0);
    ring.lifetime = 0.45;
    ring.size0 = 0.6;
    ring.size1 = 11 * energy;
    ring.color0.setRGB(3.2, 2.6, 1.9);
    ring.color1.setRGB(0.5, 0.44, 0.35);
    ring.alpha0 = 0.8;
    ring.alpha1 = 0;
    ring.gravity = 0;
    ring.drag = 0;
    ring.rotation = 0;
    ring.rotationRate = 0;
    ring.sprite = SPRITE.ring;
    ring.additive = 1;
    ring.stretch = 0;
    ring.turbulence = 0;
    this.particles.spawn(ring);
    // Dirt column and drifting smoke.
    for (let i = 0; i < Math.round(24 * scale); i += 1) {
      const p = _spawn;
      p.position.copy(point);
      const angle = rand() * Math.PI * 2;
      const radial = 2 + rand() * 9;
      p.velocity.set(Math.cos(angle) * radial, 3 + rand() * 11, Math.sin(angle) * radial);
      p.lifetime = 1.6 + rand() * 2.6;
      p.size0 = 0.4;
      p.size1 = 3.5 + rand() * 4;
      p.color0.setRGB(0.34, 0.3, 0.25);
      p.color1.setRGB(0.5, 0.46, 0.4);
      p.alpha0 = 0.55;
      p.alpha1 = 0;
      p.gravity = 1.4;
      p.drag = 1.1;
      p.rotation = rand() * 6.28;
      p.rotationRate = (rand() - 0.5) * 1.2;
      p.sprite = SPRITE.smoke;
      p.additive = 0;
      p.stretch = 0;
      p.turbulence = 0.7;
      this.particles.spawn(p);
    }
    // Ejecta.
    for (let i = 0; i < Math.round(22 * scale); i += 1) {
      const p = _spawn;
      p.position.copy(point);
      const angle = rand() * Math.PI * 2;
      const radial = 3 + rand() * 14;
      p.velocity.set(Math.cos(angle) * radial, 5 + rand() * 13, Math.sin(angle) * radial);
      p.lifetime = 1.2 + rand() * 1.2;
      p.size0 = 0.05 + rand() * 0.09;
      p.size1 = 0.04;
      p.color0.setRGB(0.22, 0.19, 0.15);
      p.color1.setRGB(0.16, 0.14, 0.11);
      p.alpha0 = 1;
      p.alpha1 = 0.7;
      p.gravity = 15;
      p.drag = 0.3;
      p.rotation = rand() * 6.28;
      p.rotationRate = (rand() - 0.5) * 14;
      p.sprite = SPRITE.debris;
      p.additive = 0;
      p.stretch = 0.4;
      p.turbulence = 0;
      this.particles.spawn(p);
    }
    if (this.quality.decals) {
      _tmpA.set(0, 1, 0);
      this.decals.add(point, _tmpA, 3.2 * energy, DECAL.scorch, 60, 0.85);
    }
    this.popFlashLight(point, 2.4);
  }

  /** Dust kicked up by feet, sliding and landings. */
  groundDust(
    point: THREE.Vector3,
    surface: SurfaceType,
    strength: number,
    spread = 0.35,
  ): void {
    if (surface === "concrete" || surface === "metal") strength *= 0.35;
    const count = Math.round(3 * strength * this.quality.particleScale);
    if (count <= 0) return;
    const rand = this.rand;
    _tmpColor.setHex(SURFACE_PROFILES[surface].debrisColor);
    for (let i = 0; i < count; i += 1) {
      const p = _spawn;
      p.position
        .copy(point)
        .add(_tmpA.set((rand() - 0.5) * spread, 0.02, (rand() - 0.5) * spread));
      p.velocity.set((rand() - 0.5) * 0.8, 0.25 + rand() * 0.5, (rand() - 0.5) * 0.8);
      p.lifetime = 0.7 + rand() * 0.9;
      p.size0 = 0.09;
      p.size1 = 0.5 + rand() * 0.5;
      p.color0.copy(_tmpColor);
      p.color1.copy(_tmpColor).multiplyScalar(0.8);
      p.alpha0 = 0.16 * strength;
      p.alpha1 = 0;
      p.gravity = 0.4;
      p.drag = 2.6;
      p.rotation = rand() * 6.28;
      p.rotationRate = (rand() - 0.5) * 1.4;
      p.sprite = SPRITE.dust;
      p.additive = 0;
      p.stretch = 0;
      p.turbulence = 0.4;
      this.particles.spawn(p);
    }
  }

  /** Free-form access for systems that need a bespoke burst. */
  emit(sprite: SpriteId, configure: (p: typeof _spawn) => void): void {
    _spawn.sprite = sprite;
    configure(_spawn);
    this.particles.spawn(_spawn);
  }

  /* ---------------------------------------------------------------- */

  update(dt: number, world: CollisionWorld | null): void {
    // Drain the queues the simulation filled this frame.
    for (const request of game.impactQueue) this.impact(request);
    game.impactQueue.length = 0;
    for (const tracer of game.tracerQueue) {
      this.tracers.add(tracer.from, tracer.to, tracer.speed, tracer.color, tracer.local);
    }
    game.tracerQueue.length = 0;

    for (let i = 0; i < this.flashLights.length; i += 1) {
      const remaining = this.flashTimers[i]!;
      if (remaining <= 0) continue;
      const next = remaining - dt;
      this.flashTimers[i] = next;
      const light = this.flashLights[i]!;
      if (next <= 0) {
        light.visible = false;
        light.intensity = 0;
      } else {
        light.intensity *= Math.max(0, next / remaining);
      }
    }

    this.particles.update(dt);
    this.decals.update(dt);
    this.tracers.update(dt);
    this.casings.update(dt, world);
  }

  dispose(): void {
    this.particles.dispose();
    this.decals.dispose();
    this.tracers.dispose();
    this.casings.dispose();
    for (const light of this.flashLights) light.dispose();
  }
}
