import * as THREE from "three";
import { mulberry32 } from "@/lib/noise";
import { patchShader } from "@/gfx/shaderPatch";
import { WEAR_HALF, WEAR_LOCAL } from "./geometry";
import { getMarkingsTexture } from "./receiver";

/**
 * Weapon materials.
 *
 * A viewmodel sits 40 cm from the near plane and fills a fifth of the screen,
 * so its PBR values carry more of the image than anything else in the frame.
 * Everything here is measured against real firearm finishes rather than picked
 * by eye: parkerising is a dark, matte phosphate conversion coating (metalness
 * 1, roughness ~0.62); hard-anodised aluminium is slightly smoother and a
 * touch warmer; reinforced polymer is a dielectric around 0.55 roughness with
 * a faint mould texture. The shared cache means an eight-weapon loadout screen
 * still only builds one set.
 */

export interface WeaponMaterials {
  /** Parkerised steel: barrels, gas blocks, bolts, pins. */
  steel: THREE.MeshStandardMaterial;
  /** Hard-anodised aluminium: upper/lower receivers, handguards. */
  receiver: THREE.MeshStandardMaterial;
  /** Nitrided black: flash hiders, suppressor bodies. */
  nitride: THREE.MeshStandardMaterial;
  /** Carbon fouling soot accumulation near muzzle devices and blast crowns. */
  carbonFouling: THREE.MeshStandardMaterial;
  /** Bare machined aluminium showing through wear. */
  bareMetal: THREE.MeshStandardMaterial;
  /** Glass-filled nylon furniture. */
  polymer: THREE.MeshStandardMaterial;
  /** Stippled grip polymer, rougher and slightly lighter. */
  grip: THREE.MeshStandardMaterial;
  /** Rubber butt pad, cheek riser, sling loops. */
  rubber: THREE.MeshStandardMaterial;
  /** Cartridge brass, for the mag follower and loaded rounds. */
  brass: THREE.MeshStandardMaterial;
  /** Copper projectile tips. */
  copper: THREE.MeshStandardMaterial;
  /** Optic lens: a dark mirror with broadband AR coating and clearcoat. */
  lens: THREE.MeshPhysicalMaterial;
  /** Emissive reticle. */
  reticle: THREE.MeshBasicMaterial;
  /** Anodised optic body — matte, slightly bluer than the receiver. */
  optic: THREE.MeshStandardMaterial;
  /** Selector/serial markings decal sheet. */
  markings: THREE.MeshStandardMaterial;
  /** Desert-tan furniture variant. */
  polymerTan: THREE.MeshStandardMaterial;
  /** Wood, for the revolver grip and shotgun furniture. */
  wood: THREE.MeshStandardMaterial;
  dispose(): void;
}

/* ------------------------------------------------------------------ */
/* Procedural maps                                                     */
/* ------------------------------------------------------------------ */

function makeFallbackTexture(): THREE.Texture {
  const data = new Uint8Array([128, 128, 255, 255]);
  const tex = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

/** Fine machining/blast texture: a normal map with high-frequency grain. */
function makeMicroNormal(seed: number, coarse: number, size = 512): THREE.Texture {
  if (typeof document === "undefined") return makeFallbackTexture();
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(size, size);
  const data = image.data;
  const rand = mulberry32(seed);
  const height = new Float32Array(size * size);
  for (let i = 0; i < height.length; i += 1) height[i] = rand();
  const blurred = new Float32Array(size * size);
  const radius = Math.max(1, Math.round(coarse));
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let sum = 0;
      let count = 0;
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          const sx = (x + dx + size) % size;
          const sy = (y + dy + size) % size;
          sum += height[sy * size + sx]!;
          count += 1;
        }
      }
      blurred[y * size + x] = sum / count;
    }
  }
  const strength = 2.4;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const l = blurred[y * size + ((x - 1 + size) % size)]!;
      const r = blurred[y * size + ((x + 1) % size)]!;
      const d = blurred[((y - 1 + size) % size) * size + x]!;
      const u = blurred[((y + 1) % size) * size + x]!;
      const nx = (l - r) * strength;
      const ny = (d - u) * strength;
      const nz = 1;
      const inv = 1 / Math.hypot(nx, ny, nz);
      const o = (y * size + x) * 4;
      data[o] = (nx * inv * 0.5 + 0.5) * 255;
      data[o + 1] = (ny * inv * 0.5 + 0.5) * 255;
      data[o + 2] = (nz * inv * 0.5 + 0.5) * 255;
      data[o + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

/** Procedural micro-scratches: fine directional hairline scratches and toolpath scuffs. */
function makeMicroScratchNormal(seed: number, size = 512): THREE.Texture {
  if (typeof document === "undefined") return makeFallbackTexture();
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#8080ff";
  ctx.fillRect(0, 0, size, size);

  const rand = mulberry32(seed);

  // 1. Hairline linear scratches along machining axes
  for (let i = 0; i < 220; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const len = 12 + rand() * 48;
    const angle = (rand() < 0.7 ? 0 : Math.PI / 2) + (rand() - 0.5) * 0.4;
    const nx = Math.cos(angle);
    const ny = Math.sin(angle);
    ctx.lineWidth = 1;
    ctx.strokeStyle = `rgba(${128 + nx * 45}, ${128 + ny * 45}, 255, 0.35)`;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + nx * len, y + ny * len);
    ctx.stroke();
  }

  // 2. Micro surface handling scuffs
  for (let i = 0; i < 80; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 1.5 + rand() * 5.5;
    ctx.fillStyle = "rgba(115, 115, 245, 0.16)";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

/** Realistic brushed metal normal map with fine longitudinal extrusion grooves. */
function makeBrushedMetalNormal(seed: number, size = 512): THREE.Texture {
  if (typeof document === "undefined") return makeFallbackTexture();
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(size, size);
  const data = image.data;
  const rand = mulberry32(seed);

  const profile = new Float32Array(size);
  for (let x = 0; x < size; x++) {
    profile[x] = (rand() - 0.5) * 0.85 + Math.sin(x * 0.4) * 0.18;
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const xPrev = (x - 1 + size) % size;
      const xNext = (x + 1) % size;
      const dx = (profile[xNext]! - profile[xPrev]!) * 4.2;
      const dy = (rand() - 0.5) * 0.12;
      const dz = 1.0;
      const inv = 1 / Math.hypot(dx, dy, dz);

      const o = (y * size + x) * 4;
      data[o] = (dx * inv * 0.5 + 0.5) * 255;
      data[o + 1] = (dy * inv * 0.5 + 0.5) * 255;
      data[o + 2] = (dz * inv * 0.5 + 0.5) * 255;
      data[o + 3] = 255;
    }
  }

  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

/** Stipple texture for the pistol grip: aggressive raised pyramids. */
function makeStippleNormal(seed: number, size = 256): THREE.Texture {
  if (typeof document === "undefined") return makeFallbackTexture();
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#8080ff";
  ctx.fillRect(0, 0, size, size);
  const rand = mulberry32(seed);
  const cells = 26;
  const cell = size / cells;
  for (let y = 0; y < cells; y += 1) {
    for (let x = 0; x < cells; x += 1) {
      const cx = (x + 0.5 + (rand() - 0.5) * 0.35) * cell;
      const cy = (y + 0.5 + (rand() - 0.5) * 0.35) * cell;
      const r = cell * (0.3 + rand() * 0.16);
      const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      gradient.addColorStop(0, "rgba(128,128,255,1)");
      gradient.addColorStop(0.75, "rgba(150,150,235,1)");
      gradient.addColorStop(1, "rgba(128,128,255,0)");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

/** Roughness variation so a finish is never perfectly uniform. */
function makeRoughnessVariation(
  seed: number,
  base: number,
  spread: number,
  size = 256,
): THREE.Texture {
  if (typeof document === "undefined") return makeFallbackTexture();
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(size, size);
  const rand = mulberry32(seed);
  const field = new Float32Array(size * size);
  for (let i = 0; i < field.length; i += 1) field[i] = rand();
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let v = 0;
      let amp = 0.5;
      let step = 1;
      for (let o = 0; o < 3; o += 1) {
        const sx = (x * step) % size;
        const sy = (y * step) % size;
        v += field[sy * size + sx]! * amp;
        amp *= 0.5;
        step *= 3;
      }
      const r = Math.max(0, Math.min(1, base + (v - 0.44) * spread));
      const o = (y * size + x) * 4;
      const byte = r * 255;
      image.data[o] = byte;
      image.data[o + 1] = byte;
      image.data[o + 2] = byte;
      image.data[o + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

/* ------------------------------------------------------------------ */
/* Collimated Parallax Reticle Shader                                 */
/* ------------------------------------------------------------------ */

export function createCollimatedReticleMaterial(
  reticleTexture: THREE.Texture,
  color: THREE.ColorRepresentation = 0xff2a18,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: "CollimatedReticleShader",
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    uniforms: {
      uReticleTexture: { value: reticleTexture },
      uColor: { value: new THREE.Color(color) },
      uBrightness: { value: 6.5 },
      uApertureRadius: { value: 0.46 },
      uParallaxScale: { value: 0.85 },
      uEyeOffset: { value: new THREE.Vector2(0, 0) },
      uAds: { value: 0 },
    },
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform sampler2D uReticleTexture;
      uniform vec3 uColor;
      uniform float uBrightness;
      uniform float uApertureRadius;
      uniform float uParallaxScale;
      uniform vec2 uEyeOffset;
      uniform float uAds;
      varying vec2 vUv;

      void main() {
        vec2 centered = vUv - 0.5;
        float dist = length(centered);

        // Soft optical aperture window boundary
        float apertureMask = 1.0 - smoothstep(uApertureRadius - 0.05, uApertureRadius, dist);
        if (apertureMask <= 0.0) discard;

        // Parallax offset: locks the reticle dot to the sight line as weapon sways
        vec2 parallaxUv = centered + uEyeOffset * uParallaxScale + 0.5;

        vec4 tex = vec4(0.0);
        if (parallaxUv.x >= 0.0 && parallaxUv.x <= 1.0 && parallaxUv.y >= 0.0 && parallaxUv.y <= 1.0) {
          tex = texture2D(uReticleTexture, parallaxUv);
        }

        // Ghost reflection inside optical lens glass thickness
        vec2 ghostUv = parallaxUv + vec2(0.004, 0.003);
        vec4 ghostTex = vec4(0.0);
        if (ghostUv.x >= 0.0 && ghostUv.x <= 1.0 && ghostUv.y >= 0.0 && ghostUv.y <= 1.0) {
          ghostTex = texture2D(uReticleTexture, ghostUv) * 0.08;
        }

        vec3 color = uColor * (tex.rgb * tex.a + ghostTex.rgb * ghostTex.a) * uBrightness;
        float alpha = (tex.a + ghostTex.a) * apertureMask;

        // Smooth opacity ramp during ADS transition
        alpha *= smoothstep(0.12, 0.7, uAds);

        gl_FragColor = vec4(color, alpha);
        #include <logdepthbuf_fragment>
      }
    `,
  });
}

/* ------------------------------------------------------------------ */
/* Factory                                                             */
/* ------------------------------------------------------------------ */

let cached: WeaponMaterials | null = null;

/** What a finish wears through to on a handled edge, and how it ages. */
export interface EdgeWear {
  /** The material underneath (sRGB hex). */
  color: number;
  metalness: number;
  roughness: number;
  /** How far onto a face the wear reaches at most, in metres. */
  width: number;
  /** 0 to 1. */
  strength: number;
  /**
   * 0 to 1: wear on any rounded convex edge, found from the curvature of the
   * shading normal rather than a box frame, so extruded profiles, tubes and
   * slabs wear too. Default 0.
   */
  curvature?: number;
  /** Peak height of the object-space micro relief, metres. Default 0. */
  grain?: number;
  /** Spatial frequency of that relief, cycles per metre. */
  grainScale?: number;
  /** Low-frequency roughness breakup (handling, oil, smudges), +-. Default 0. */
  smudge?: number;
  /** 0 to 1: desert dust settled on upward faces and in recesses. Default 0. */
  dust?: number;
}

/**
 * Coatings wear through on handled edges first. A finish this patches turns,
 * near any edge of a chamfered-box part, to what is under it: bright steel
 * under parkerising and nitride, bare aluminium under anodising, a lighter,
 * smoother scuff on polymer. The distance to the edge is exact, from the
 * part's own frame (`WEAR_LOCAL`, `WEAR_HALF` in geometry.ts), so the wear
 * runs a few millimetres onto each face as it does on a used rifle. Two
 * octaves of noise chip it, a slow one decides which regions were handled
 * more, and a part too small to have a face of its own is left alone rather
 * than turned to bare metal. Parts with no box frame (tubes, rails, cast
 * profiles) carry a zero half-size and are untouched by that term.
 *
 * Those parts still wear on their rounded edges: the curvature of the
 * interpolated normal (how fast it turns per metre of surface, signed so a
 * convex edge is positive) picks out every bevel, and the same chips break
 * it up. Since `creaseNormals` gives every bevel a smooth normal, that is
 * every edge of the receiver, the handguard and the optic.
 *
 * Under the wear sit the things that stop a finish reading as one flat
 * colour: a micro relief (bead blast on anodising, mould texture on polymer)
 * bumped into the normal and faded out before it can alias, a slow roughness
 * breakup where hands and oil have polished it, and a little desert dust on
 * upward faces. All of it is in the mesh's own space, so it moves with the
 * weapon: a world-space pattern swam across the receiver as a tartan once
 * already.
 */
const WEAR_VERTEX_HEAD = /* glsl */ `
attribute vec3 ${WEAR_LOCAL};
attribute vec3 ${WEAR_HALF};
varying vec3 vWearLocal;
varying vec3 vWearHalf;
varying vec3 vFinishObj;
varying vec3 vFinishObjN;
`;

const WEAR_FRAGMENT_HEAD = /* glsl */ `
varying vec3 vWearLocal;
varying vec3 vWearHalf;
varying vec3 vFinishObj;
varying vec3 vFinishObjN;
uniform vec3 uWearColor;
uniform float uWearMetalness;
uniform float uWearRoughness;
uniform float uWearWidth;
uniform float uWearStrength;
uniform float uWearCurvature;
uniform float uFinishGrain;
uniform float uFinishGrainScale;
uniform float uFinishSmudge;
uniform float uFinishDust;

float wearHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float wearNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(wearHash(i), wearHash(i + vec3(1, 0, 0)), f.x),
        mix(wearHash(i + vec3(0, 1, 0)), wearHash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(wearHash(i + vec3(0, 0, 1)), wearHash(i + vec3(1, 0, 1)), f.x),
        mix(wearHash(i + vec3(0, 1, 1)), wearHash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}

vec3 finishPerturb(vec3 surfPos, vec3 surfNorm, float h, float faceDir) {
  vec3 sx = dFdx(surfPos);
  vec3 sy = dFdy(surfPos);
  vec3 r1 = cross(sy, surfNorm);
  vec3 r2 = cross(surfNorm, sx);
  float det = dot(sx, r1) * faceDir;
  vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
  return normalize(abs(det) * surfNorm - grad);
}
`;

const WEAR_FRAGMENT = /* glsl */ `
{
  // Signed curvature of the interpolated normal, per metre of surface:
  // positive on a convex edge, negative in a concave one, ~0 on a flat.
  vec3 finishN = normalize(vNormal);
  vec3 finishDpx = dFdx(vViewPosition);
  vec3 finishDpy = dFdy(vViewPosition);
  float finishK = -(dot(dFdx(finishN), finishDpx) + dot(dFdy(finishN), finishDpy))
    / max(dot(finishDpx, finishDpx) + dot(finishDpy, finishDpy), 1e-14);

  float wearChips = wearNoise(vFinishObj * 420.0) * 0.6 + wearNoise(vFinishObj * 1150.0) * 0.4;
  float wearHandled = wearNoise(vFinishObj * 14.0 + 3.7);
  float wear = 0.0;

  float wearMinHalf = min(vWearHalf.x, min(vWearHalf.y, vWearHalf.z));
  if (wearMinHalf > 1e-5) {
    // distance to each pair of faces; the smallest is the face this pixel is
    // on, the middle one is how far it is from that face's nearest edge
    vec3 wearQ = max(vWearHalf - abs(vWearLocal), 0.0);
    float wearLo = min(wearQ.x, min(wearQ.y, wearQ.z));
    float wearHi = max(wearQ.x, max(wearQ.y, wearQ.z));
    float wearEdge = wearQ.x + wearQ.y + wearQ.z - wearLo - wearHi;
    float boxChips = wearNoise(vWearLocal * 420.0) * 0.6 + wearNoise(vWearLocal * 1150.0) * 0.4;
    // a pin or a button has no face to wear onto
    float wearWidth = min(uWearWidth * (0.3 + 1.2 * boxChips), wearMinHalf * 0.3);
    float wearAa = fwidth(wearEdge);
    float boxWear = 1.0 - smoothstep(wearWidth * 0.45, wearWidth + wearAa, wearEdge);
    boxWear *= smoothstep(0.3, 0.62, boxChips + 0.18 * wearHandled);
    wear = boxWear * uWearStrength * (0.45 + 0.55 * wearHandled);
  }

  // Bevels on everything else: the same chips, keyed off curvature.
  float edgeK = smoothstep(260.0, 900.0, finishK);
  float edgeWear = edgeK * smoothstep(0.34, 0.6, wearChips + 0.2 * wearHandled);
  wear = max(wear, edgeWear * uWearCurvature * (0.5 + 0.5 * wearHandled));

  // Handling breakup.
  float smudge = wearNoise(vFinishObj * 38.0 + 11.0) * 0.65 + wearNoise(vFinishObj * 160.0) * 0.35;
  roughnessFactor = clamp(roughnessFactor + (smudge - 0.5) * 2.0 * uFinishSmudge
    - 0.08 * wearHandled * uFinishSmudge, 0.04, 1.0);

  // Dust settles on what faces up and collects in concave breaks.
  float dustUp = smoothstep(0.25, 0.95, normalize(vFinishObjN).y);
  float dustCav = smoothstep(120.0, 600.0, -finishK);
  float dustMask = (dustUp * 0.7 + dustCav * 0.8)
    * smoothstep(0.38, 0.72, wearNoise(vFinishObj * 55.0 + 2.0) * 0.7 + wearNoise(vFinishObj * 300.0) * 0.3);
  float dust = clamp(dustMask * uFinishDust, 0.0, 1.0) * (1.0 - wear);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.36, 0.28), dust * 0.55);
  roughnessFactor = mix(roughnessFactor, 0.92, dust);
  metalnessFactor = mix(metalnessFactor, 0.0, dust);

  diffuseColor.rgb = mix(diffuseColor.rgb, uWearColor, wear);
  metalnessFactor = mix(metalnessFactor, uWearMetalness, wear);
  roughnessFactor = mix(roughnessFactor, uWearRoughness, wear);
}
`;

const GRAIN_FRAGMENT = /* glsl */ `
{
  float finishFoot = length(fwidth(vFinishObj)) * uFinishGrainScale;
  float finishFade = 1.0 - smoothstep(0.35, 1.1, finishFoot);
  if (uFinishGrain > 0.0 && finishFade > 0.0) {
    vec3 gp = vFinishObj * uFinishGrainScale;
    float h = (wearNoise(gp) * 0.6 + wearNoise(gp * 2.63 + 5.1) * 0.4 - 0.5)
      * uFinishGrain * finishFade;
    normal = finishPerturb(-vViewPosition, normal, h, faceDirection);
  }
}
`;

/** Patch a finish so its handled edges wear through to `wear`. */
export function applyEdgeWear<M extends THREE.MeshStandardMaterial>(
  material: M,
  wear: EdgeWear,
): M {
  const uniforms: Record<string, THREE.IUniform> = {
    uWearColor: { value: new THREE.Color(wear.color) },
    uWearMetalness: { value: wear.metalness },
    uWearRoughness: { value: wear.roughness },
    uWearWidth: { value: wear.width },
    uWearStrength: { value: wear.strength },
    uWearCurvature: { value: wear.curvature ?? 0 },
    uFinishGrain: { value: wear.grain ?? 0 },
    uFinishGrainScale: { value: wear.grainScale ?? 2000 },
    uFinishSmudge: { value: wear.smudge ?? 0 },
    uFinishDust: { value: wear.dust ?? 0 },
  };
  material.userData.edgeWear = uniforms;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = patchShader("weapon edge wear (vertex)", shader.vertexShader, [
      ["#include <common>", `#include <common>\n${WEAR_VERTEX_HEAD}`],
      [
        "#include <begin_vertex>",
        `#include <begin_vertex>\nvWearLocal = ${WEAR_LOCAL};\nvWearHalf = ${WEAR_HALF};\nvFinishObj = position;\nvFinishObjN = normal;`,
      ],
    ]);
    shader.fragmentShader = patchShader(
      "weapon edge wear (fragment)",
      shader.fragmentShader,
      [
        ["#include <common>", `#include <common>\n${WEAR_FRAGMENT_HEAD}`],
        [
          "#include <metalnessmap_fragment>",
          `#include <metalnessmap_fragment>\n${WEAR_FRAGMENT}`,
        ],
        [
          "#include <normal_fragment_maps>",
          `#include <normal_fragment_maps>\n${GRAIN_FRAGMENT}`,
        ],
      ],
    );
  };
  material.customProgramCacheKey = () => "weapon-finish-v2";
  material.needsUpdate = true;
  return material;
}

export function getWeaponMaterials(): WeaponMaterials {
  if (cached) return cached;

  const steelNormal = makeMicroNormal(0x51ee1, 2);
  const scratchNormal = makeMicroScratchNormal(0x42f7c);
  const brushedNormal = makeBrushedMetalNormal(0x81da3);
  // Bead-blast grain under hard anodising is sub-millimetre: a 3 px blur at
  // this repeat read as hammered, peened metal, and every bump caught a sky
  // glint. One pixel of blur and a light hand keep it a matte, even finish.
  const receiverNormal = makeMicroNormal(0x2ecee, 1);
  const polymerNormal = makeMicroNormal(0x9017, 4);
  const stipple = makeStippleNormal(0x9217);
  const steelRough = makeRoughnessVariation(0x77aa, 0.6, 0.2);
  const receiverRough = makeRoughnessVariation(0x31bc, 0.44, 0.1);
  const polymerRough = makeRoughnessVariation(0x5c10, 0.64, 0.18);

  // three.js *multiplies* `roughness` by the roughness map's green channel,
  // and these maps already encode absolute roughness around their base. Every
  // mapped material below therefore sets `roughness: 1`, so the value that
  // renders is the map's. Authored as 0.5 x a 0.52 map, the receiver rendered
  // at 0.26, glossy enough to turn every micro-bump into a speckle of sky.
  const repeat = (t: THREE.Texture, n: number): THREE.Texture => {
    t.repeat.set(n, n);
    return t;
  };

  // Parkerising and anodising are dark, but they are not a hole in the
  // frame. These hexes are sRGB; three stores them as linear albedo, and
  // AgX at the combat exposure maps anything near 0x1c to a clipped black
  // with no edge left to catch the sun. The values below are the darkest
  // grey that still reads as a machined object. Metalness stays low on the
  // coated parts — a conversion coating has a diffuse body; metalness 1
  // here was a black mirror with nothing to reflect.
  // A working rifle is oiled. The film is a clear dielectric over the
  // coating: about 4% reflectance head-on, far more at a grazing angle, so
  // the top of the receiver picks up the sky's haze band and ridge line
  // while the body stays dark. The coatings alone are too rough to show a
  // horizon at all; without the film, giving the weapon a sky with structure
  // changed 0.1% of its pixels.
  //
  // The three finishes have to read as three materials, not three greys:
  // parkerised steel is the flattest and faintly green-grey, hard anodising
  // is a satin near-black with a soft sheen, nitride is the darkest and the
  // glossiest. The procedural UV normal maps went: every primitive here
  // generates UVs at a different scale (metres on an extrusion, 0..1 round a
  // 6 mm pin), so one repeat was fine grain on the receiver and a smeared
  // average everywhere else. The relief now comes from `applyEdgeWear`, in
  // the mesh's own space and at one physical scale on every part.
  const oilFilm = { clearcoat: 0.24, clearcoatRoughness: 0.3 } as const;
  const steel = new THREE.MeshPhysicalMaterial({
    clearcoat: 0.14,
    clearcoatRoughness: 0.42,
    name: "weapon-steel-metal",
    color: 0x4a4c49,
    metalness: 0.3,
    roughness: 1,
    roughnessMap: repeat(steelRough, 4),
    envMapIntensity: 0.32,
  });

  // Hard-anodised aluminium, black-grey and faintly warm. No plate shader:
  // it quantises *world* position, and in the viewmodel pass world space
  // moves with the gun, so the cells swam across the receiver as a tartan.
  const receiver = new THREE.MeshPhysicalMaterial({
    ...oilFilm,
    name: "weapon-receiver-metal",
    color: 0x38393b,
    metalness: 0.2,
    roughness: 1,
    roughnessMap: repeat(receiverRough, 3),
    envMapIntensity: 0.42,
  });

  const nitride = new THREE.MeshPhysicalMaterial({
    ...oilFilm,
    name: "weapon-nitride-metal",
    color: 0x2c2d30,
    metalness: 0.5,
    roughness: 0.38,
    envMapIntensity: 0.45,
  });

  const carbonFouling = new THREE.MeshStandardMaterial({
    name: "weapon-carbon-fouling",
    color: 0x2a2c30,
    metalness: 0.05,
    roughness: 0.92,
    normalMap: repeat(steelNormal.clone(), 6),
    normalScale: new THREE.Vector2(0.4, 0.4),
    envMapIntensity: 0.2,
  });

  const bareMetal = new THREE.MeshStandardMaterial({
    name: "weapon-bare-metal",
    color: 0xa8a9af,
    metalness: 1,
    roughness: 0.28,
    normalMap: repeat(brushedNormal.clone(), 12),
    normalScale: new THREE.Vector2(0.3, 0.3),
    envMapIntensity: 1.4,
  });

  const polymer = new THREE.MeshStandardMaterial({
    name: "weapon-polymer",
    color: 0x333436,
    metalness: 0,
    roughness: 1,
    roughnessMap: repeat(polymerRough, 3),
    envMapIntensity: 0.6,
  });

  const polymerTan = polymer.clone();
  polymerTan.name = "weapon-polymer-tan";
  polymerTan.color.setHex(0x8b7656);
  polymerTan.envMapIntensity = 0.3;

  const grip = new THREE.MeshStandardMaterial({
    name: "weapon-grip-polymer",
    color: 0x343830,
    metalness: 0,
    roughness: 0.76,
    normalMap: repeat(stipple, 3),
    normalScale: new THREE.Vector2(0.9, 0.9),
    envMapIntensity: 0.65,
  });

  const rubber = new THREE.MeshStandardMaterial({
    name: "weapon-rubber",
    color: 0x2e2e2f,
    metalness: 0,
    roughness: 0.88,
    normalMap: repeat(polymerNormal.clone(), 8),
    normalScale: new THREE.Vector2(0.5, 0.5),
    envMapIntensity: 0.45,
  });

  const brass = new THREE.MeshStandardMaterial({
    name: "weapon-brass-metal",
    color: 0xb49144,
    metalness: 1,
    roughness: 0.25,
    normalMap: repeat(brushedNormal.clone(), 16),
    normalScale: new THREE.Vector2(0.2, 0.2),
    envMapIntensity: 1.45,
  });

  const copper = new THREE.MeshStandardMaterial({
    name: "weapon-copper-metal",
    color: 0xa15d36,
    metalness: 1,
    roughness: 0.32,
    envMapIntensity: 1.35,
  });

  const lens = new THREE.MeshPhysicalMaterial({
    name: "weapon-lens-glass",
    // A reflex window. A dark albedo at any opacity still fills the glass
    // with navy, because the combat env map is a smooth sky gradient and
    // that reflection becomes the whole surface. Keep the tint pale and the
    // reflection an edge, so the reticle and the world both show through.
    color: 0xb7c4d1,
    metalness: 0,
    roughness: 0.04,
    transmission: 0,
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
    side: THREE.DoubleSide,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    reflectivity: 0.5,
    sheen: 0.06,
    envMapIntensity: 0.35,
  });
  // Centre stays clear; the rim thickens. A constant alpha is a grey plate.
  lens.onBeforeCompile = (shader) => {
    shader.fragmentShader = patchShader("optic lens (fresnel)", shader.fragmentShader, [
      [
        "#include <opaque_fragment>",
        `float lensFres = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 2.4);
       diffuseColor.a = mix(0.08, 0.5, lensFres);
       outgoingLight += vec3(0.85, 0.92, 1.0) * lensFres * lensFres * 0.55;
       #include <opaque_fragment>`,
      ],
    ]);
  };
  lens.customProgramCacheKey = () => "lens-fresnel-v2";

  const reticle = new THREE.MeshBasicMaterial({
    name: "weapon-reticle",
    color: 0xff2a18,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });

  const optic = new THREE.MeshPhysicalMaterial({
    ...oilFilm,
    name: "weapon-optic-metal",
    color: 0x323336,
    metalness: 0.22,
    roughness: 0.42,
    envMapIntensity: 0.6,
  });

  // Paint-filled roll marks: an off-white fill, a touch rough, drawn just
  // proud of the surface and pulled forward in depth so it never fights it.
  const markings = new THREE.MeshStandardMaterial({
    name: "weapon-markings",
    color: 0xc9c4b6,
    map: getMarkingsTexture(),
    metalness: 0,
    roughness: 0.78,
    transparent: true,
    opacity: 0.82,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    envMapIntensity: 0.4,
  });

  const wood = new THREE.MeshStandardMaterial({
    name: "weapon-wood",
    color: 0x54331d,
    metalness: 0,
    roughness: 0.48,
    normalMap: repeat(brushedNormal.clone(), 3),
    normalScale: new THREE.Vector2(0.35, 0.35),
    envMapIntensity: 0.75,
  });

  // Under parkerising and nitride is steel; under anodising, aluminium. Both
  // show bright and fairly smooth where the coating has gone. Polymer does not
  // wear to anything but itself, lighter and polished by hands.
  const steelUnder = { color: 0x9ea0a5, metalness: 0.92, roughness: 0.34 } as const;
  const aluminiumUnder = { color: 0xb3b4b7, metalness: 0.95, roughness: 0.3 } as const;
  applyEdgeWear(steel, {
    ...steelUnder,
    width: 0.0022,
    strength: 0.85,
    curvature: 0.7,
    grain: 2.4e-5,
    grainScale: 900,
    smudge: 0.08,
    dust: 0.3,
  });
  applyEdgeWear(nitride, {
    ...steelUnder,
    width: 0.002,
    strength: 0.75,
    curvature: 0.6,
    grain: 1e-5,
    grainScale: 1100,
    smudge: 0.06,
    dust: 0.2,
  });
  applyEdgeWear(receiver, {
    ...aluminiumUnder,
    width: 0.0026,
    strength: 0.85,
    curvature: 0.8,
    grain: 1.4e-5,
    grainScale: 1000,
    smudge: 0.07,
    dust: 0.28,
  });
  applyEdgeWear(optic, {
    ...aluminiumUnder,
    width: 0.0018,
    strength: 0.7,
    curvature: 0.85,
    grain: 1e-5,
    grainScale: 1100,
    smudge: 0.05,
    dust: 0.18,
  });
  applyEdgeWear(polymer, {
    color: 0x6b6c6e,
    metalness: 0,
    roughness: 0.42,
    width: 0.003,
    strength: 0.6,
    curvature: 0.55,
    grain: 4e-5,
    grainScale: 650,
    smudge: 0.08,
    dust: 0.35,
  });
  applyEdgeWear(polymerTan, {
    color: 0xb6a586,
    metalness: 0,
    roughness: 0.42,
    width: 0.003,
    strength: 0.6,
    curvature: 0.5,
    grain: 4e-5,
    grainScale: 650,
    smudge: 0.08,
    dust: 0.22,
  });
  applyEdgeWear(grip, {
    color: 0x5d625a,
    metalness: 0,
    roughness: 0.5,
    width: 0.0025,
    strength: 0.5,
    curvature: 0.4,
    dust: 0.2,
  });

  const textures = [
    steelNormal,
    scratchNormal,
    brushedNormal,
    receiverNormal,
    polymerNormal,
    stipple,
    steelRough,
    receiverRough,
    polymerRough,
  ];

  cached = {
    steel,
    receiver,
    nitride,
    carbonFouling,
    bareMetal,
    polymer,
    polymerTan,
    grip,
    rubber,
    brass,
    copper,
    lens,
    reticle,
    optic,
    markings,
    wood,
    dispose() {
      for (const t of textures) t.dispose();
      nitride.normalMap?.dispose();
      rubber.normalMap?.dispose();
      optic.normalMap?.dispose();
      wood.normalMap?.dispose();
      bareMetal.normalMap?.dispose();
      brass.normalMap?.dispose();
      for (const m of [
        steel,
        receiver,
        nitride,
        carbonFouling,
        bareMetal,
        polymer,
        polymerTan,
        grip,
        rubber,
        brass,
        copper,
        lens,
        reticle,
        optic,
        markings,
        wood,
      ]) {
        m.dispose();
      }
      cached = null;
    },
  };
  return cached;
}
