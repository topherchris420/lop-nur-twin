import * as THREE from "three";
import { applyHardSurface } from "@/gfx/greeble";
import { mulberry32 } from "@/lib/noise";

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
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
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
        vec2 ghostUv = parallaxUv + vec2(0.008, 0.006);
        vec4 ghostTex = vec4(0.0);
        if (ghostUv.x >= 0.0 && ghostUv.x <= 1.0 && ghostUv.y >= 0.0 && ghostUv.y <= 1.0) {
          ghostTex = texture2D(uReticleTexture, ghostUv) * 0.14;
        }

        vec3 color = uColor * (tex.rgb * tex.a + ghostTex.rgb * ghostTex.a) * uBrightness;
        float alpha = (tex.a + ghostTex.a) * apertureMask;

        // Smooth opacity ramp during ADS transition
        alpha *= smoothstep(0.12, 0.7, uAds);

        gl_FragColor = vec4(color, alpha);
      }
    `,
  });
}

/* ------------------------------------------------------------------ */
/* Factory                                                             */
/* ------------------------------------------------------------------ */

let cached: WeaponMaterials | null = null;

export function getWeaponMaterials(): WeaponMaterials {
  if (cached) return cached;

  const steelNormal = makeMicroNormal(0x51ee1, 2);
  const scratchNormal = makeMicroScratchNormal(0x42f7c);
  const brushedNormal = makeBrushedMetalNormal(0x81da3);
  const receiverNormal = makeMicroNormal(0x2ecee, 3);
  const polymerNormal = makeMicroNormal(0x9017, 4);
  const stipple = makeStippleNormal(0x9217);
  const steelRough = makeRoughnessVariation(0x77aa, 0.6, 0.22);
  const receiverRough = makeRoughnessVariation(0x31bc, 0.52, 0.18);
  const polymerRough = makeRoughnessVariation(0x5c10, 0.58, 0.2);

  const repeat = (t: THREE.Texture, n: number): THREE.Texture => {
    t.repeat.set(n, n);
    return t;
  };

  const steel = new THREE.MeshStandardMaterial({
    name: "weapon-steel-metal",
    color: 0x26272b,
    metalness: 1,
    roughness: 0.65,
    normalMap: repeat(scratchNormal, 6),
    normalScale: new THREE.Vector2(0.35, 0.35),
    roughnessMap: repeat(steelRough, 4),
    envMapIntensity: 0.78,
  });

  const receiver = new THREE.MeshStandardMaterial({
    name: "weapon-receiver-metal",
    color: 0x212226,
    metalness: 0.88,
    roughness: 0.60,
    normalMap: repeat(receiverNormal, 5),
    normalScale: new THREE.Vector2(0.25, 0.25),
    roughnessMap: repeat(receiverRough, 3),
    envMapIntensity: 0.75,
  });
  // Micro panel lines, edge wear and grazing rim for military hard-anodised alloy
  applyHardSurface(receiver, {
    plateScale: 0.055,
    plateAspect: 0.6,
    seamWidth: 0.02,
    seamDarken: 0.68,
    seamRelief: 0.55,
    plateRoughness: 0.08,
    plateAlbedo: 0.05,
    rivets: false,
    streaks: 0.05,
    dust: 0.04,
    rimIntensity: 0.22,
    rimPower: 2.4,
  });

  const nitride = new THREE.MeshStandardMaterial({
    name: "weapon-nitride-metal",
    color: 0x171819,
    metalness: 1,
    roughness: 0.50,
    normalMap: repeat(brushedNormal, 8),
    normalScale: new THREE.Vector2(0.25, 0.25),
    envMapIntensity: 0.82,
  });

  const carbonFouling = new THREE.MeshStandardMaterial({
    name: "weapon-carbon-fouling",
    color: 0x121314,
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
    color: 0x24252a,
    metalness: 0,
    roughness: 0.56,
    normalMap: repeat(polymerNormal, 4),
    normalScale: new THREE.Vector2(0.42, 0.42),
    roughnessMap: repeat(polymerRough, 3),
    envMapIntensity: 0.85,
  });

  const polymerTan = polymer.clone();
  polymerTan.name = "weapon-polymer-tan";
  polymerTan.color.setHex(0x7d6b4e);

  const grip = new THREE.MeshStandardMaterial({
    name: "weapon-grip-polymer",
    color: 0x1f2024,
    metalness: 0,
    roughness: 0.76,
    normalMap: repeat(stipple, 3),
    normalScale: new THREE.Vector2(0.9, 0.9),
    envMapIntensity: 0.65,
  });

  const rubber = new THREE.MeshStandardMaterial({
    name: "weapon-rubber",
    color: 0x151618,
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
    color: 0x0b1a26,
    metalness: 0,
    roughness: 0.04,
    transmission: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.015,
    reflectivity: 1,
    sheenColor: new THREE.Color(0x4a78ff),
    sheen: 0.65,
    envMapIntensity: 2.4,
  });

  const reticle = new THREE.MeshBasicMaterial({
    name: "weapon-reticle",
    color: 0xff2a18,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });

  const optic = new THREE.MeshStandardMaterial({
    name: "weapon-optic-metal",
    color: 0x1c1d21,
    metalness: 0.86,
    roughness: 0.56,
    normalMap: repeat(scratchNormal.clone(), 7),
    normalScale: new THREE.Vector2(0.25, 0.25),
    envMapIntensity: 0.75,
  });

  const markings = new THREE.MeshStandardMaterial({
    name: "weapon-markings",
    color: 0xd8d4c8,
    metalness: 0,
    roughness: 0.7,
    transparent: true,
    opacity: 0.9,
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
