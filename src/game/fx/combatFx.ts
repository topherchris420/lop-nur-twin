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
 * Bullet-hole atlas. Each tile packs the hole's opacity in alpha and a
 * two-channel tangent-space normal in RG, so the crater catches the sun
 * instead of reading as a flat sticker.
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

  // Concrete: a dark crater with a pale spall ring and radial cracks.
  tile(DECAL.concrete, (rand) => {
    const ring = ctx.createRadialGradient(c, c, c * 0.05, c, c, c * 0.62);
    ring.addColorStop(0, "rgba(18,17,16,0.98)");
    ring.addColorStop(0.28, "rgba(38,35,32,0.9)");
    ring.addColorStop(0.5, "rgba(196,188,172,0.55)");
    ring.addColorStop(0.78, "rgba(184,176,160,0.22)");
    ring.addColorStop(1, "rgba(160,152,138,0)");
    ctx.fillStyle = ring;
    ctx.fillRect(0, 0, DECAL_TILE, DECAL_TILE);
    ctx.strokeStyle = "rgba(30,28,26,0.55)";
    for (let i = 0; i < 9; i += 1) {
      const angle = rand() * Math.PI * 2;
      const len = c * (0.35 + rand() * 0.5);
      ctx.lineWidth = 1 + rand() * 2.4;
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(angle) * c * 0.16, c + Math.sin(angle) * c * 0.16);
      let x = c;
      let y = c;
      let a = angle;
      for (let s = 0; s < 5; s += 1) {
        a += (rand() - 0.5) * 0.7;
        x += Math.cos(a) * (len / 5);
        y += Math.sin(a) * (len / 5);
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  });

  // Metal: a bright-rimmed dent with a dark centre and radial scuffing.
  tile(DECAL.metal, (rand) => {
    const g = ctx.createRadialGradient(c, c, 0, c, c, c * 0.44);
    g.addColorStop(0, "rgba(12,12,14,0.98)");
    g.addColorStop(0.45, "rgba(60,58,58,0.8)");
    g.addColorStop(0.72, "rgba(214,208,198,0.7)");
    g.addColorStop(1, "rgba(190,186,178,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, DECAL_TILE, DECAL_TILE);
    ctx.strokeStyle = "rgba(220,214,204,0.3)";
    for (let i = 0; i < 16; i += 1) {
      const angle = rand() * Math.PI * 2;
      ctx.lineWidth = 0.8 + rand() * 1.4;
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(angle) * c * 0.3, c + Math.sin(angle) * c * 0.3);
      ctx.lineTo(
        c + Math.cos(angle) * c * (0.45 + rand() * 0.35),
        c + Math.sin(angle) * c * (0.45 + rand() * 0.35),
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

  // Sand: a shallow crater with an ejecta apron.
  tile(DECAL.sand, (rand) => {
    const g = ctx.createRadialGradient(c, c, 0, c, c, c * 0.6);
    g.addColorStop(0, "rgba(84,70,50,0.75)");
    g.addColorStop(0.4, "rgba(140,122,92,0.4)");
    g.addColorStop(0.75, "rgba(196,180,148,0.28)");
    g.addColorStop(1, "rgba(200,186,152,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, DECAL_TILE, DECAL_TILE);
    for (let i = 0; i < 240; i += 1) {
      const angle = rand() * Math.PI * 2;
      const r = c * (0.3 + Math.pow(rand(), 0.5) * 0.65);
      ctx.fillStyle = `rgba(210,196,164,${0.06 + rand() * 0.16})`;
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
uniform float uTime;
uniform vec2 uAtlas;
void main() {
  float age = uTime - aUp.w;
  float life = aMeta.y;
  if (age < 0.0 || age > life) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vUv = vec2(0.0);
    vFade = 0.0;
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
void main() {
  #include <logdepthbuf_fragment>
  vec4 texel = texture2D(uMap, vUv);
  float alpha = texel.a * vFade;
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(texel.rgb, alpha);
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

  // Fade the first two metres so the shooter is not blinded by their own round.
  float nearFade = smoothstep(0.0, 3.0, head);

  vec3 world = mix(tailPos, headPos, uv.y);
  vec3 viewDir = normalize(cameraPosition - world);
  vec3 side = normalize(cross(aDir.xyz, viewDir));
  world += side * (uv.x - 0.5) * aParams.w;

  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  vUv = uv;
  vColor = vec4(aColor.rgb, aColor.w * nearFade);
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
  // Hot thin core inside a softer sheath, brightest at the head.
  float across = 1.0 - abs(vUv.x - 0.5) * 2.0;
  float core = pow(across, 8.0);
  float sheath = pow(across, 1.6);
  float along = pow(vUv.y, 1.7);
  float intensity = (core * 2.6 + sheath * 0.55) * along * vColor.w;
  if (intensity < 0.002) discard;
  gl_FragColor = vec4(vColor.rgb * intensity, intensity * 0.35);
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
    this.params[i4 + 2] = local ? 3.4 : 2.6;
    this.params[i4 + 3] = local ? 0.055 : 0.045;
    _tmpColor.setHex(color);
    // Push the colour into HDR so bloom picks the tracer up.
    const gain = local ? 5.5 : 4;
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

  constructor(capacity = 64) {
    // A real case profile: rim, extractor groove, body taper, case mouth.
    const profile: [number, number][] = [
      [0.0, -0.0225],
      [0.0055, -0.0225],
      [0.0055, -0.0208],
      [0.0046, -0.0198],
      [0.0046, -0.0182],
      [0.0052, -0.017],
      [0.0052, 0.006],
      [0.0044, 0.019],
      [0.0044, 0.0225],
      [0.0, 0.0225],
    ];
    const points = profile.map(([r, y]) => new THREE.Vector2(Math.max(1e-5, r), y));
    const geometry = new THREE.LatheGeometry(points, 12);
    const material = new THREE.MeshStandardMaterial({
      name: "casing-brass-metal",
      color: 0xc09a48,
      metalness: 1,
      roughness: 0.24,
      envMapIntensity: 1.6,
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

  eject(position: THREE.Vector3, direction: THREE.Vector3, rand: () => number): void {
    const casing = this.casings[this.cursor]!;
    this.cursor = (this.cursor + 1) % this.casings.length;
    casing.position.copy(position);
    casing.velocity
      .copy(direction)
      .multiplyScalar(2.6 + rand() * 1.4)
      .add(_tmpA.set((rand() - 0.5) * 0.8, 1.5 + rand() * 0.9, (rand() - 0.5) * 0.8));
    casing.spin.set((rand() - 0.5) * 34, (rand() - 0.5) * 26, (rand() - 0.5) * 40);
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
      casing.velocity.y -= 9.81 * dt;
      _tmpA.copy(casing.velocity).multiplyScalar(dt);
      const ground = world ? world.groundAt(casing.position.x, casing.position.z) : 0;
      casing.position.add(_tmpA);
      if (casing.position.y <= ground + 0.006) {
        casing.position.y = ground + 0.006;
        if (casing.velocity.y < -0.4 && casing.bounces < 3) {
          casing.bounces += 1;
          casing.velocity.y *= -0.36;
          casing.velocity.x *= 0.55;
          casing.velocity.z *= 0.55;
          casing.spin.multiplyScalar(0.5);
          if (casing.bounces <= 2) {
            queueSound({
              id: "shell-drop",
              position: casing.position.clone(),
              gain: 0.35 / casing.bounces,
            });
          }
        } else {
          casing.velocity.set(0, 0, 0);
          casing.spin.multiplyScalar(0.8);
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

  /** Muzzle flash + smoke + a burst of unburnt powder sparks. */
  muzzleFlash(
    position: THREE.Vector3,
    direction: THREE.Vector3,
    calibre: number,
    suppressed: boolean,
    firstPerson: boolean,
  ): void {
    const rand = this.rand;
    const scale = this.quality.particleScale;
    if (!suppressed) {
      const lobes = firstPerson ? 3 : 2;
      for (let i = 0; i < lobes; i += 1) {
        const p = _spawn;
        p.position.copy(position).addScaledVector(direction, 0.02 + i * 0.03);
        p.velocity.copy(direction).multiplyScalar(1.5 + rand() * 2);
        p.lifetime = 0.045 + rand() * 0.02;
        p.size0 = calibre * (0.28 + i * 0.06);
        p.size1 = calibre * (0.34 + i * 0.08);
        // Well above 1.0: AgX + bloom turn this into a real flash.
        p.color0.setRGB(11, 7.4, 3.2);
        p.color1.setRGB(5, 2.2, 0.5);
        p.alpha0 = 1;
        p.alpha1 = 0;
        p.gravity = 0;
        p.drag = 6;
        p.rotation = rand() * Math.PI * 2;
        p.rotationRate = 0;
        p.sprite = SPRITE.flash;
        p.additive = 1;
        p.stretch = 0;
        p.turbulence = 0;
        this.particles.spawn(p);
      }
      // Hot gas ball right at the crown.
      const gas = _spawn;
      gas.position.copy(position).addScaledVector(direction, 0.05);
      gas.velocity.copy(direction).multiplyScalar(3.5);
      gas.lifetime = 0.11;
      gas.size0 = calibre * 0.18;
      gas.size1 = calibre * 0.55;
      gas.color0.setRGB(6, 3.4, 1.2);
      gas.color1.setRGB(0.5, 0.3, 0.2);
      gas.alpha0 = 0.85;
      gas.alpha1 = 0;
      gas.gravity = -1.2;
      gas.drag = 5;
      gas.rotation = rand() * 6.28;
      gas.rotationRate = (rand() - 0.5) * 6;
      gas.sprite = SPRITE.fire;
      gas.additive = 1;
      gas.stretch = 0;
      gas.turbulence = 0;
      this.particles.spawn(gas);

      // Unburnt powder thrown forward.
      const sparks = Math.round(6 * scale);
      for (let i = 0; i < sparks; i += 1) {
        const p = _spawn;
        p.position.copy(position);
        p.velocity
          .copy(direction)
          .multiplyScalar(7 + rand() * 9)
          .add(_tmpA.set((rand() - 0.5) * 3, (rand() - 0.5) * 3, (rand() - 0.5) * 3));
        p.lifetime = 0.16 + rand() * 0.22;
        p.size0 = 0.012;
        p.size1 = 0.004;
        p.color0.setRGB(9, 4.4, 1.1);
        p.color1.setRGB(2.2, 0.5, 0.08);
        p.alpha0 = 1;
        p.alpha1 = 0;
        p.gravity = 7;
        p.drag = 2.2;
        p.rotation = 0;
        p.rotationRate = 0;
        p.sprite = SPRITE.spark;
        p.additive = 1;
        p.stretch = 1.6;
        p.turbulence = 0;
        this.particles.spawn(p);
      }

      this.popFlashLight(position, calibre);
    }

    // Muzzle smoke, always — it is what makes sustained fire read as heat.
    const puffs = Math.round((suppressed ? 4 : 2) * scale);
    for (let i = 0; i < puffs; i += 1) {
      const p = _spawn;
      p.position.copy(position).addScaledVector(direction, 0.03 + rand() * 0.06);
      p.velocity
        .copy(direction)
        .multiplyScalar(1.4 + rand() * 1.6)
        .add(_tmpA.set((rand() - 0.5) * 0.5, 0.35 + rand() * 0.4, (rand() - 0.5) * 0.5));
      p.lifetime = 0.6 + rand() * 0.9;
      p.size0 = calibre * 0.22;
      p.size1 = calibre * (2.2 + rand());
      p.color0.setRGB(0.42, 0.4, 0.37);
      p.color1.setRGB(0.3, 0.29, 0.27);
      p.alpha0 = suppressed ? 0.32 : 0.16;
      p.alpha1 = 0;
      p.gravity = -0.5;
      p.drag = 1.6;
      p.rotation = rand() * 6.28;
      p.rotationRate = (rand() - 0.5) * 1.6;
      p.sprite = SPRITE.smoke;
      p.additive = 0;
      p.stretch = 0;
      p.turbulence = 0.25;
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
    light.intensity = 26 * calibre * 12;
    light.distance = 16;
    light.visible = true;
    this.flashTimers[index] = 0.055;
  }

  /** Casing ejection, called by the weapon layer with the port transform. */
  ejectCasing(position: THREE.Vector3, direction: THREE.Vector3): void {
    if (!this.quality.casings) return;
    this.casings.eject(position, direction, this.rand);
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
      const drops = Math.round((request.kind === "blood-headshot" ? 22 : 12) * scale);
      for (let i = 0; i < drops; i += 1) {
        const p = _spawn;
        p.position.copy(request.point);
        p.velocity
          .copy(request.incoming)
          .multiplyScalar(2 + rand() * 5)
          .add(
            _tmpA.set((rand() - 0.5) * 3.5, (rand() - 0.5) * 3.5, (rand() - 0.5) * 3.5),
          );
        p.lifetime = 0.35 + rand() * 0.5;
        p.size0 = 0.03 + rand() * 0.05;
        p.size1 = 0.015;
        p.color0.setRGB(0.32, 0.02, 0.02);
        p.color1.setRGB(0.14, 0.01, 0.01);
        p.alpha0 = 0.85;
        p.alpha1 = 0;
        p.gravity = 11;
        p.drag = 1.4;
        p.rotation = rand() * 6.28;
        p.rotationRate = (rand() - 0.5) * 8;
        p.sprite = SPRITE.blood;
        p.additive = 0;
        p.stretch = 0.6;
        p.turbulence = 0;
        this.particles.spawn(p);
      }
      // Fine mist that hangs for a moment.
      const mist = _spawn;
      mist.position.copy(request.point);
      mist.velocity.copy(request.incoming).multiplyScalar(1.2);
      mist.lifetime = 0.45;
      mist.size0 = 0.1;
      mist.size1 = 0.42;
      mist.color0.setRGB(0.28, 0.03, 0.03);
      mist.color1.setRGB(0.16, 0.02, 0.02);
      mist.alpha0 = 0.4;
      mist.alpha1 = 0;
      mist.gravity = 1.5;
      mist.drag = 3;
      mist.rotation = rand() * 6.28;
      mist.rotationRate = 1;
      mist.sprite = SPRITE.blood;
      mist.additive = 0;
      mist.stretch = 0;
      mist.turbulence = 0.2;
      this.particles.spawn(mist);
      return;
    }

    /* -------------------------------------------------------- sparks */
    if (profile.sparkiness > 0.05) {
      const count = Math.round(profile.sparkiness * 16 * energy * scale);
      for (let i = 0; i < count; i += 1) {
        const p = _spawn;
        p.position.copy(request.point);
        // Sparks fly back along the reflection, with a wide cone.
        _tmpA.copy(request.incoming).reflect(request.normal);
        p.velocity
          .copy(_tmpA)
          .multiplyScalar(4 + rand() * 12)
          .add(_tmpB.set((rand() - 0.5) * 6, (rand() - 0.5) * 6, (rand() - 0.5) * 6));
        p.lifetime = 0.25 + rand() * 0.5;
        p.size0 = 0.014;
        p.size1 = 0.003;
        p.color0.setRGB(12, 6, 1.6);
        p.color1.setRGB(2.4, 0.4, 0.04);
        p.alpha0 = 1;
        p.alpha1 = 0;
        p.gravity = 9;
        p.drag = 1.1;
        p.rotation = 0;
        p.rotationRate = 0;
        p.sprite = SPRITE.spark;
        p.additive = 1;
        p.stretch = 2.4;
        p.turbulence = 0;
        this.particles.spawn(p);
      }
    }

    /* --------------------------------------------------------- dust */
    const dustCount = Math.round(
      (request.surface === "sand" || request.surface === "gravel" ? 9 : 5) *
        energy *
        scale,
    );
    for (let i = 0; i < dustCount; i += 1) {
      const p = _spawn;
      p.position.copy(request.point).addScaledVector(request.normal, 0.02);
      p.velocity
        .copy(request.normal)
        .multiplyScalar(1.2 + rand() * 2.6)
        .add(_tmpA.set((rand() - 0.5) * 1.6, rand() * 1.2, (rand() - 0.5) * 1.6));
      p.lifetime = 0.5 + rand() * 1.1;
      p.size0 = 0.05 + rand() * 0.06;
      p.size1 = 0.34 + rand() * 0.4;
      p.color0.copy(_tmpColor).multiplyScalar(1.05);
      p.color1.copy(_tmpColor).multiplyScalar(0.72);
      p.alpha0 = 0.4;
      p.alpha1 = 0;
      p.gravity = 0.7;
      p.drag = 2.4;
      p.rotation = rand() * 6.28;
      p.rotationRate = (rand() - 0.5) * 2;
      p.sprite = SPRITE.dust;
      p.additive = 0;
      p.stretch = 0;
      p.turbulence = 0.35;
      this.particles.spawn(p);
    }

    /* ------------------------------------------------------- debris */
    const debrisCount = Math.round(4 * energy * scale);
    for (let i = 0; i < debrisCount; i += 1) {
      const p = _spawn;
      p.position.copy(request.point);
      p.velocity
        .copy(request.normal)
        .multiplyScalar(2.5 + rand() * 5)
        .add(_tmpA.set((rand() - 0.5) * 4, rand() * 2, (rand() - 0.5) * 4));
      p.lifetime = 0.6 + rand() * 0.7;
      p.size0 = 0.012 + rand() * 0.018;
      p.size1 = 0.01;
      p.color0.copy(_tmpColor).multiplyScalar(0.8);
      p.color1.copy(_tmpColor).multiplyScalar(0.5);
      p.alpha0 = 1;
      p.alpha1 = 0.6;
      p.gravity = 13;
      p.drag = 0.5;
      p.rotation = rand() * 6.28;
      p.rotationRate = (rand() - 0.5) * 16;
      p.sprite = SPRITE.debris;
      p.additive = 0;
      p.stretch = 0.2;
      p.turbulence = 0;
      this.particles.spawn(p);
    }

    /* -------------------------------------------------------- decal */
    if (this.quality.decals && request.kind !== "ricochet") {
      const tile =
        request.kind === "penetration-exit"
          ? DECAL.spall
          : decalIndexFor(request.surface);
      const size =
        (request.kind === "penetration-exit" ? 0.22 : 0.13) * (0.75 + energy * 0.5);
      this.decals.add(request.point, request.normal, size, tile, 26, 0.95);
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
