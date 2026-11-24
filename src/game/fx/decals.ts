import * as THREE from "three";
import { mulberry32 } from "@/lib/noise";
import type { SurfaceType } from "../core/types";

/**
 * Bullet holes, painted as *modulate-2x* decals.
 *
 * A decal that writes its own colour has to know how the wall under it is lit,
 * and this one never did: it carried a hard-coded sun, glowed at night and
 * stayed bright in shadow. A 2x-multiply decal multiplies the lit surface
 * already in the frame by twice its texel, so 0.5 leaves the wall alone, a
 * dark pit darkens whatever light is there, and a fractured rim *brightens*
 * it — the one thing a plain multiply cannot do. Sun, shadow, AO, fog and
 * night all come for free from the surface underneath.
 *
 * On top of that, an analytic crater normal re-lights the sun's share of the
 * surface: the rim facing the sun brightens, the far wall of the pit falls
 * into shade, so the hole reads as a hole rather than a stain. Fresh decals
 * carry a pale halo of powdered material and a bright broken rim that dull as
 * the dust settles over the next seconds.
 *
 * Log depth writes `gl_FragDepth`, which polygon offset never sees, so the
 * card is lifted off the surface and nudged toward the eye along the view ray
 * (which moves no pixel) instead.
 */

export const DECAL = {
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

export function decalIndexFor(surface: SurfaceType): number {
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

/** A modulate-2x colour: `v` 0.5 is neutral, 0 is black, 1 doubles the light. */
function mod(v: number, a: number): string {
  const b = Math.round(Math.min(1, Math.max(0, v)) * 255);
  return `rgba(${b},${b},${b},${a})`;
}

function modRgb(r: number, g: number, b: number, a: number): string {
  const c = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
  return `rgba(${c(r)},${c(g)},${c(b)},${a})`;
}

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

  const radial = (r0: number, r1: number, stops: [number, string][]): void => {
    const g = ctx.createRadialGradient(c, c, r0, c, c, r1);
    for (const [at, colour] of stops) g.addColorStop(at, colour);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, DECAL_TILE, DECAL_TILE);
  };

  /** An irregular closed blob around the centre. */
  const blob = (
    rand: () => number,
    radius: number,
    jag: number,
    points: number,
    fill: string,
  ): void => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    for (let i = 0; i <= points; i += 1) {
      const angle = (i / points) * Math.PI * 2;
      const r = radius * (1 - jag + rand() * jag * 2);
      const x = c + Math.cos(angle) * r;
      const y = c + Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  };

  /** A ring of broken chips between two radii, with dark cracks between. */
  const chips = (
    rand: () => number,
    inner: number,
    outer: number,
    count: number,
    light: [number, number],
    alpha: number,
  ): void => {
    const step = (Math.PI * 2) / count;
    for (let i = 0; i < count; i += 1) {
      const a0 = i * step + (rand() - 0.5) * step * 0.25;
      const a1 = a0 + step * (0.7 + rand() * 0.25);
      const r0 = inner * (0.85 + rand() * 0.3);
      const r1 = outer * (0.7 + rand() * 0.45);
      const am = (a0 + a1) / 2;
      ctx.fillStyle = mod(light[0] + rand() * (light[1] - light[0]), alpha);
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(a0) * r0, c + Math.sin(a0) * r0);
      ctx.lineTo(c + Math.cos(a0) * r1, c + Math.sin(a0) * r1);
      ctx.lineTo(c + Math.cos(am) * r1 * (1.05 + rand() * 0.2), c + Math.sin(am) * r1);
      ctx.lineTo(c + Math.cos(a1) * r1 * 0.9, c + Math.sin(a1) * r1 * 0.9);
      ctx.lineTo(c + Math.cos(a1) * r0, c + Math.sin(a1) * r0);
      ctx.closePath();
      ctx.fill();
    }
  };

  const cracks = (
    rand: () => number,
    count: number,
    from: number,
    to: number,
    colour: string,
    width: number,
  ): void => {
    ctx.strokeStyle = colour;
    ctx.lineCap = "round";
    for (let i = 0; i < count; i += 1) {
      let a = rand() * Math.PI * 2;
      let x = c + Math.cos(a) * from;
      let y = c + Math.sin(a) * from;
      const len = (to - from) * (0.5 + rand() * 0.6);
      ctx.lineWidth = width * (0.6 + rand() * 0.8);
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let s = 0; s < 5; s += 1) {
        a += (rand() - 0.5) * 0.6;
        x += Math.cos(a) * (len / 5);
        y += Math.sin(a) * (len / 5);
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  };

  // Concrete: pale powder halo, broken lighter rim, dark stepped crater.
  tile(DECAL.concrete, (rand) => {
    radial(0, c * 0.9, [
      [0, mod(0.64, 0.55)],
      [0.45, mod(0.6, 0.4)],
      [1, mod(0.58, 0)],
    ]);
    chips(rand, c * 0.15, c * 0.42, 9, [0.66, 0.8], 0.85);
    cracks(rand, 9, c * 0.14, c * 0.5, mod(0.22, 0.7), 2.2);
    radial(0, c * 0.32, [
      [0, mod(0.04, 1)],
      [0.4, mod(0.12, 0.96)],
      [0.75, mod(0.3, 0.75)],
      [1, mod(0.42, 0)],
    ]);
    blob(rand, c * 0.1, 0.35, 11, mod(0.02, 1));
  });

  // Metal: paint flaked back to bright bare steel round a dark dent, with a
  // faint warm heat tint outside it.
  tile(DECAL.metal, (rand) => {
    radial(c * 0.1, c * 0.55, [
      [0, modRgb(0.44, 0.4, 0.35, 0.5)],
      [1, modRgb(0.48, 0.45, 0.42, 0)],
    ]);
    chips(rand, c * 0.08, c * 0.27, 8, [0.86, 0.98], 0.92);
    blob(rand, c * 0.11, 0.25, 12, mod(0.06, 1));
    radial(0, c * 0.12, [
      [0, mod(0.02, 1)],
      [1, mod(0.2, 0)],
    ]);
  });

  // Wood: dark hole, fresh pale splinters torn outward.
  tile(DECAL.wood, (rand) => {
    ctx.strokeStyle = modRgb(0.72, 0.64, 0.52, 0.75);
    ctx.lineCap = "round";
    for (let i = 0; i < 22; i += 1) {
      const angle = rand() * Math.PI * 2;
      ctx.lineWidth = 1.5 + rand() * 3;
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(angle) * c * 0.14, c + Math.sin(angle) * c * 0.14);
      ctx.lineTo(
        c + Math.cos(angle) * c * (0.35 + rand() * 0.4),
        c + Math.sin(angle) * c * (0.35 + rand() * 0.4),
      );
      ctx.stroke();
    }
    radial(0, c * 0.3, [
      [0, mod(0.04, 1)],
      [0.6, mod(0.18, 0.85)],
      [1, mod(0.4, 0)],
    ]);
  });

  // Glass: a white star fracture with concentric rings.
  tile(DECAL.glass, (rand) => {
    ctx.strokeStyle = mod(0.92, 0.8);
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
    radial(0, c * 0.14, [
      [0, mod(0.1, 0.9)],
      [1, mod(0.5, 0)],
    ]);
  });

  // Sand: a shallow darker dimple and a lighter thrown-out rim, speckled.
  tile(DECAL.sand, (rand) => {
    radial(0, c * 0.85, [
      [0, mod(0.36, 0.55)],
      [0.36, mod(0.42, 0.45)],
      [0.5, mod(0.58, 0.4)],
      [0.8, mod(0.56, 0.2)],
      [1, mod(0.55, 0)],
    ]);
    for (let i = 0; i < 260; i += 1) {
      const angle = rand() * Math.PI * 2;
      const r = c * (0.3 + Math.pow(rand(), 0.6) * 0.6);
      ctx.fillStyle = mod(rand() > 0.5 ? 0.62 : 0.4, 0.25 + rand() * 0.3);
      ctx.fillRect(
        c + Math.cos(angle) * r,
        c + Math.sin(angle) * r,
        2 + rand() * 3,
        2 + rand() * 3,
      );
    }
  });

  // Blood: dark red stain. Multiplying by this keeps red and drops the rest.
  tile(DECAL.blood, (rand) => {
    radial(0, c * 0.34, [
      [0, modRgb(0.36, 0.06, 0.05, 0.85)],
      [1, modRgb(0.4, 0.08, 0.07, 0)],
    ]);
    for (let i = 0; i < 20; i += 1) {
      const angle = rand() * Math.PI * 2;
      const dist = c * (0.25 + Math.pow(rand(), 0.7) * 0.55);
      const r = 2 + rand() * 7;
      ctx.fillStyle = modRgb(0.38, 0.07, 0.06, 0.3 + rand() * 0.4);
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

  // Scorch: soot with radial streaks.
  tile(DECAL.scorch, (rand) => {
    radial(0, c, [
      [0, mod(0.06, 0.95)],
      [0.42, mod(0.14, 0.75)],
      [0.72, mod(0.3, 0.35)],
      [1, mod(0.4, 0)],
    ]);
    for (let i = 0; i < 40; i += 1) {
      const angle = rand() * Math.PI * 2;
      ctx.strokeStyle = mod(0.12, 0.2 + rand() * 0.4);
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

  // Exit spall: a bigger, rougher hole with a wide broken apron.
  tile(DECAL.spall, (rand) => {
    radial(0, c * 0.9, [
      [0, mod(0.62, 0.5)],
      [1, mod(0.58, 0)],
    ]);
    chips(rand, c * 0.24, c * 0.6, 11, [0.64, 0.78], 0.85);
    blob(rand, c * 0.32, 0.3, 20, mod(0.05, 0.95));
    cracks(rand, 7, c * 0.3, c * 0.7, mod(0.2, 0.6), 2.5);
  });

  const texture = new THREE.CanvasTexture(canvas);
  // Raw bytes: 128 must mean 0.5, the neutral multiplier.
  texture.colorSpace = THREE.NoColorSpace;
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
varying float vAge;
varying vec3 vNormal;
varying vec3 vTangent;
varying vec3 vBitangent;
varying vec2 vLocal;
uniform float uTime;
uniform vec2 uAtlas;
void main() {
  float age = uTime - aUp.w;
  float life = aMeta.y;
  vAge = age;
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
  // Toward the eye along the view ray: moves no pixel, wins the depth test.
  vec3 toCam = cameraPosition - world;
  float dist = length(toCam);
  world += toCam / max(dist, 1e-3) * min(0.02, dist * 0.0006);
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  float tile = aMeta.x;
  float col = mod(tile, uAtlas.x);
  // Row 0 is painted at the canvas top and the texture keeps flipY = true,
  // so v = 1 is the canvas top: count rows down from there.
  float row = uAtlas.y - 1.0 - floor(tile / uAtlas.x);
  vUv = (uv + vec2(col, row)) / uAtlas;
  vLocal = corner;
  vTangent = normalize(aRight.xyz);
  vBitangent = normalize(aUp.xyz);
  vNormal = normalize(cross(aRight.xyz, aUp.xyz));
  // Hold full strength for most of the life, then fade out over the last 20%,
  // and let distant holes go before fog turns them into dark specks.
  vFade = aMeta.w * smoothstep(1.0, 0.8, age / life) * (1.0 - smoothstep(45.0, 90.0, dist));
  #include <logdepthbuf_vertex>
}
`;

const DECAL_FRAGMENT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform sampler2D uMap;
uniform vec3 uSunDir;
uniform float uSunShare;
varying vec2 vUv;
varying float vFade;
varying float vAge;
varying vec3 vNormal;
varying vec3 vTangent;
varying vec3 vBitangent;
varying vec2 vLocal;
void main() {
  #include <logdepthbuf_fragment>
  vec4 texel = texture2D(uMap, vUv);
  float alpha = texel.a * vFade;
  if (alpha < 0.004) discard;

  // Analytic crater: the bowl tilts in toward the pit, the rim's outer slope
  // tilts out. Re-light only the sun's share of the surface by the ratio of
  // the bent normal to the flat one.
  vec2 rad = vLocal * 2.0;
  float d = length(rad);
  vec2 radial = d > 1e-4 ? rad / d : vec2(0.0);
  float bowl = smoothstep(0.0, 0.1, d) * (1.0 - smoothstep(0.22, 0.34, d)) * 1.3;
  float rim = smoothstep(0.32, 0.4, d) * (1.0 - smoothstep(0.4, 0.62, d)) * 0.55;
  vec2 tilt = radial * (rim - bowl);
  vec3 bent = normalize(vNormal + vTangent * tilt.x + vBitangent * tilt.y);
  float flatL = max(dot(vNormal, uSunDir), 0.0);
  float bentL = max(dot(bent, uSunDir), 0.0);
  float other = 1.0 - uSunShare;
  float relight = clamp(
    (bentL * uSunShare + other) / max(flatL * uSunShare + other, 0.05),
    0.25,
    2.2
  );

  // Fresh: the powder halo and the broken rim are brightest at first and
  // dull as the dust settles back over them.
  float fresh = mix(1.0, 0.5, smoothstep(0.4, 10.0, vAge));
  vec3 m = texel.rgb * 2.0 - 1.0;
  m = 1.0 + max(m, 0.0) * fresh + min(m, 0.0);
  vec3 factor = mix(vec3(1.0), m * relight, alpha);
  gl_FragColor = vec4(factor, 1.0);
}
`;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();

export class DecalRenderer {
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
  private dirty = false;

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
      name: "fx-decals",
      vertexShader: DECAL_VERTEX,
      fragmentShader: DECAL_FRAGMENT,
      uniforms: {
        uTime: { value: 0 },
        uMap: { value: this.texture },
        uAtlas: { value: new THREE.Vector2(DECAL_COLS, DECAL_ROWS) },
        uSunDir: { value: new THREE.Vector3(0.42, 0.82, -0.38).normalize() },
        uSunShare: { value: 0.7 },
      },
      transparent: true,
      depthWrite: false,
      // dst * src: the lit surface times twice the texel.
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.DstColorFactor,
      blendDst: THREE.ZeroFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
      toneMapped: false,
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
    _a.set(0, 1, 0);
    if (Math.abs(normal.y) > 0.94) _a.set(1, 0, 0);
    _b.crossVectors(_a, normal).normalize();
    _c.crossVectors(normal, _b).normalize();
    const i3 = i * 3;
    const i4 = i * 4;
    this.center[i3] = point.x + normal.x * 0.004;
    this.center[i3 + 1] = point.y + normal.y * 0.004;
    this.center[i3 + 2] = point.z + normal.z * 0.004;
    this.right[i4] = _b.x;
    this.right[i4 + 1] = _b.y;
    this.right[i4 + 2] = _b.z;
    this.right[i4 + 3] = size;
    this.up[i4] = _c.x;
    this.up[i4 + 1] = _c.y;
    this.up[i4 + 2] = _c.z;
    this.up[i4 + 3] = this.time;
    this.meta[i4] = tile;
    this.meta[i4 + 1] = lifetime;
    this.meta[i4 + 2] = this.rand() * Math.PI * 2;
    this.meta[i4 + 3] = opacity;
    this.dirty = true;
  }

  setSun(direction: THREE.Vector3, share: number): void {
    (this.material.uniforms["uSunDir"]!.value as THREE.Vector3).copy(direction);
    this.material.uniforms["uSunShare"]!.value = share;
  }

  update(dt: number): void {
    this.time += dt;
    this.material.uniforms["uTime"]!.value = this.time;
    if (this.dirty) {
      for (const name of ["aCenter", "aRight", "aUp", "aMeta"]) {
        this.geometry.getAttribute(name).needsUpdate = true;
      }
      this.dirty = false;
    }
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}
