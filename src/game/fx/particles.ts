import * as THREE from "three";
import { mulberry32, seededNoise2D } from "@/lib/noise";

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
  crossFlash: 8,
  heatHaze: 9,
  bloodMist: 10,
  tracerHead: 11,
  /** Noise-built smoke with a baked density-gradient normal in RG. */
  billow: 12,
  /** A thinner, wispier billow for drift and barrel smoke. */
  wisp: 13,
  /** A tall dust column, denser at its foot, for sand spurts. */
  plume: 14,
  /** A soft round glow, for impact flashes and embers. */
  glow: 15,
} as const;

/** Sprites whose RG channels hold a shading normal rather than colour. */
export const NORMAL_SPRITES: ReadonlySet<SpriteId> = new Set<SpriteId>([12, 13, 14]);

export type SpriteId = (typeof SPRITE)[keyof typeof SPRITE];

const ATLAS_COLS = 4;
const ATLAS_ROWS = 4;
const ATLAS_TILE = 256;

/* ------------------------------------------------------------------ */
/* Atlas                                                               */
/* ------------------------------------------------------------------ */

function drawSmoke(ctx: CanvasRenderingContext2D, seed: number): void {
  const rand = mulberry32(seed);
  const c = ATLAS_TILE / 2;
  // Wide, low-contrast lobes. The particle colour tints this grey, so a
  // dense white core here would read as a cotton ball instead of drift.
  for (let i = 0; i < 16; i += 1) {
    const angle = rand() * Math.PI * 2;
    const dist = Math.pow(rand(), 0.5) * c * 0.66;
    const x = c + Math.cos(angle) * dist;
    const y = c + Math.sin(angle) * dist;
    const r = c * (0.32 + rand() * 0.4);
    const alpha = 0.045 + rand() * 0.05;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${alpha})`);
    g.addColorStop(0.62, `rgba(255,255,255,${alpha * 0.35})`);
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = "destination-in";
  const mask = ctx.createRadialGradient(c, c, c * 0.04, c, c, c * 0.98);
  mask.addColorStop(0, "rgba(255,255,255,0.85)");
  mask.addColorStop(0.65, "rgba(255,255,255,0.4)");
  mask.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = mask;
  ctx.fillRect(0, 0, ATLAS_TILE, ATLAS_TILE);
  ctx.globalCompositeOperation = "source-over";
}

function drawSpark(ctx: CanvasRenderingContext2D): void {
  const c = ATLAS_TILE / 2;
  // Streak along +V, which the stretch shader maps onto velocity. The quad
  // stays a centimetre or two across; a radial halo here is what turns that
  // into a glowing pill.
  const across = ctx.createLinearGradient(0, 0, ATLAS_TILE, 0);
  across.addColorStop(0, "rgba(255,255,255,0)");
  across.addColorStop(0.4, "rgba(255,255,255,0.08)");
  across.addColorStop(0.47, "rgba(255,255,255,0.7)");
  across.addColorStop(0.5, "rgba(255,255,255,1)");
  across.addColorStop(0.53, "rgba(255,255,255,0.7)");
  across.addColorStop(0.6, "rgba(255,255,255,0.08)");
  across.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = across;
  ctx.fillRect(0, 0, ATLAS_TILE, ATLAS_TILE);
  ctx.globalCompositeOperation = "destination-in";
  const along = ctx.createLinearGradient(c, ATLAS_TILE, c, 0);
  along.addColorStop(0, "rgba(255,255,255,0)");
  along.addColorStop(0.2, "rgba(255,255,255,0.2)");
  along.addColorStop(0.62, "rgba(255,255,255,0.75)");
  along.addColorStop(1, "rgba(255,255,255,1)");
  ctx.fillStyle = along;
  ctx.fillRect(0, 0, ATLAS_TILE, ATLAS_TILE);
  ctx.globalCompositeOperation = "source-over";
}

function drawDust(ctx: CanvasRenderingContext2D, seed: number): void {
  const rand = mulberry32(seed);
  const c = ATLAS_TILE / 2;
  const g = ctx.createRadialGradient(c, c, 0, c, c, c * 0.96);
  g.addColorStop(0, "rgba(255,255,255,0.4)");
  g.addColorStop(0.42, "rgba(255,255,255,0.18)");
  g.addColorStop(0.75, "rgba(255,255,255,0.06)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, ATLAS_TILE, ATLAS_TILE);
  // Fine grit. Low alpha so a settling puff stays soft instead of a sticker.
  for (let i = 0; i < 380; i += 1) {
    const x = rand() * ATLAS_TILE;
    const y = rand() * ATLAS_TILE;
    ctx.fillStyle = `rgba(255,255,255,${0.012 + rand() * 0.035})`;
    ctx.fillRect(x, y, 1 + rand() * 2, 1 + rand() * 2);
  }
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
  // Tight star. Bloom supplies the glow; a fat radial core here is the
  // lingering orange blob once the particle is tinted.
  ctx.translate(c, c);
  const spikes = 4 + Math.floor(rand() * 3);
  for (let i = 0; i < spikes; i += 1) {
    const angle = (i / spikes) * Math.PI * 2 + rand() * 0.25;
    const len = c * (0.18 + rand() * 0.16);
    const width = c * (0.018 + rand() * 0.016);
    ctx.save();
    ctx.rotate(angle);
    const g = ctx.createLinearGradient(0, 0, len, 0);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.45, "rgba(255,255,255,0.4)");
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
  const core = ctx.createRadialGradient(0, 0, 0, 0, 0, c * 0.11);
  core.addColorStop(0, "rgba(255,255,255,1)");
  core.addColorStop(0.6, "rgba(255,255,255,0.9)");
  core.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(0, 0, c * 0.11, 0, Math.PI * 2);
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

/** Anisotropic muzzle blast: one long blade, a short tongue, a tiny seed. */
function drawCrossFlash(ctx: CanvasRenderingContext2D, seed: number): void {
  const rand = mulberry32(seed);
  const c = ATLAS_TILE / 2;
  ctx.translate(c, c);

  const blade = ctx.createLinearGradient(-c * 0.95, 0, c * 0.95, 0);
  blade.addColorStop(0, "rgba(255,255,255,0)");
  blade.addColorStop(0.16, "rgba(255,255,255,0.28)");
  blade.addColorStop(0.5, "rgba(255,255,255,1)");
  blade.addColorStop(0.84, "rgba(255,255,255,0.28)");
  blade.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = blade;
  ctx.beginPath();
  ctx.ellipse(0, 0, c * 0.92, c * (0.035 + rand() * 0.018), 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.rotate(Math.PI / 2);
  const tongue = ctx.createLinearGradient(-c * 0.34, 0, c * 0.34, 0);
  tongue.addColorStop(0, "rgba(255,255,255,0)");
  tongue.addColorStop(0.5, "rgba(255,255,255,0.4)");
  tongue.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = tongue;
  ctx.beginPath();
  ctx.ellipse(0, 0, c * 0.32, c * 0.022, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const core = ctx.createRadialGradient(0, 0, 0, 0, 0, c * 0.08);
  core.addColorStop(0, "rgba(255,255,255,1)");
  core.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(0, 0, c * 0.08, 0, Math.PI * 2);
  ctx.fill();

  ctx.translate(-c, -c);
}

/** Shimmering heat haze / refraction distortion wisp. */
function drawHeatHaze(ctx: CanvasRenderingContext2D, seed: number): void {
  const rand = mulberry32(seed);
  const c = ATLAS_TILE / 2;
  // Multi-band soft undulating ripples
  for (let r = 0.15; r <= 0.85; r += 0.12) {
    ctx.beginPath();
    for (let a = 0; a <= 20; a += 1) {
      const angle = (a / 20) * Math.PI * 2;
      const distortion = 1 + Math.sin(angle * 4 + rand() * 3) * 0.18;
      const x = c + Math.cos(angle) * c * r * distortion;
      const y = c + Math.sin(angle) * c * r * distortion * 1.35; // elongated vertically
      if (a === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = `rgba(255,255,255,${0.18 - r * 0.14})`;
    ctx.lineWidth = 6 + rand() * 8;
    ctx.stroke();
  }
  const center = ctx.createRadialGradient(c, c, 0, c, c, c * 0.65);
  center.addColorStop(0, "rgba(255,255,255,0.35)");
  center.addColorStop(0.7, "rgba(255,255,255,0.08)");
  center.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = center;
  ctx.fillRect(0, 0, ATLAS_TILE, ATLAS_TILE);
}

/** Fine aerosolized blood mist cloud with micro-dispersion. */
function drawBloodMist(ctx: CanvasRenderingContext2D, seed: number): void {
  const rand = mulberry32(seed);
  const c = ATLAS_TILE / 2;
  // Soft diffuse underlying cloud
  const base = ctx.createRadialGradient(c, c, 0, c, c, c * 0.7);
  base.addColorStop(0, "rgba(255,255,255,0.45)");
  base.addColorStop(0.5, "rgba(255,255,255,0.18)");
  base.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, ATLAS_TILE, ATLAS_TILE);

  // Micro droplet scatter
  for (let i = 0; i < 48; i += 1) {
    const angle = rand() * Math.PI * 2;
    const dist = Math.pow(rand(), 0.7) * c * 0.8;
    const x = c + Math.cos(angle) * dist;
    const y = c + Math.sin(angle) * dist;
    const r = 1.5 + rand() * 4.5;
    ctx.fillStyle = `rgba(255,255,255,${0.35 + rand() * 0.45})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Thin tracer head. Bright along +V, a few pixels across, no sheath. */
function drawTracerHead(ctx: CanvasRenderingContext2D): void {
  const c = ATLAS_TILE / 2;
  const along = ctx.createLinearGradient(c, ATLAS_TILE, c, 0);
  along.addColorStop(0, "rgba(255,255,255,0)");
  along.addColorStop(0.35, "rgba(255,255,255,0.35)");
  along.addColorStop(0.78, "rgba(255,255,255,1)");
  along.addColorStop(1, "rgba(255,255,255,1)");
  ctx.fillStyle = along;
  ctx.fillRect(c - 5, 0, 10, ATLAS_TILE);
  const core = ctx.createLinearGradient(c, ATLAS_TILE, c, 0);
  core.addColorStop(0, "rgba(255,255,255,0)");
  core.addColorStop(0.55, "rgba(255,255,255,0.8)");
  core.addColorStop(1, "rgba(255,255,255,1)");
  ctx.fillStyle = core;
  ctx.fillRect(c - 1.5, 0, 3, ATLAS_TILE);
}

/* ------------------------------------------------------------------ */
/* Density tiles                                                       */
/* ------------------------------------------------------------------ */

function smoothstep01(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * A density field rasterised straight into RGBA, with its gradient baked into
 * RG as a shading normal (0.5 = flat). The particle shader tilts each pixel's
 * sphere normal by it, so the sun picks out individual billows instead of
 * lighting the whole puff as one ball. Alpha is the density itself.
 *
 * Pure (no canvas), so the field can be inspected without a browser.
 */
export function buildDensityTile(
  kind: "billow" | "wisp" | "plume",
  seed: number,
  size: number,
): Uint8ClampedArray<ArrayBuffer> {
  const noise = seededNoise2D(seed);
  const warp = seededNoise2D(seed ^ 0x5bd1);
  const field = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      // u right, v up, both -1..1.
      const u = ((x + 0.5) / size) * 2 - 1;
      const v = 1 - ((y + 0.5) / size) * 2;
      let d = 0;
      if (kind === "plume") {
        // A column that widens and thins as it climbs, streaked vertically.
        const climb = (v + 1) / 2;
        const width = 0.22 + climb * 0.5;
        const wu = u + warp(u * 1.4, v * 1.1) * 0.12;
        let streak = 0;
        let amp = 0.5;
        let f = 1.6;
        for (let o = 0; o < 4; o += 1) {
          streak += Math.abs(noise(wu * f * 2.2, v * f * 0.9)) * amp;
          amp *= 0.5;
          f *= 2.1;
        }
        const across = Math.max(0, 1 - Math.pow(Math.abs(wu) / width, 2));
        const foot = Math.min(1, (v + 1) * 3);
        const top = Math.max(0, 1 - Math.pow(climb, 1.6));
        d = across * foot * top * (0.45 + streak * 1.1);
      } else {
        const wisp = kind === "wisp";
        const wu = u + warp(u * 1.2, v * 1.2) * (wisp ? 0.32 : 0.18);
        const wv = v + warp(u * 1.2 + 5.2, v * 1.2 + 1.3) * (wisp ? 0.32 : 0.18);
        let billow = 0;
        let amp = 0.5;
        let f = wisp ? 1.2 : 1.45;
        for (let o = 0; o < 4; o += 1) {
          // 1 - |noise| gives the rounded, cauliflower lobes of a billow.
          billow += (1 - Math.abs(noise(wu * f, wv * f))) * amp;
          amp *= 0.5;
          f *= 2.03;
        }
        // Lobes push the silhouette out and bite holes into it, around a core
        // that stays dense: smoke, not lace.
        const r = Math.sqrt(wu * wu + wv * wv) + (0.62 - billow) * (wisp ? 0.9 : 0.7);
        const shape = 1 - smoothstep01(wisp ? 0.05 : 0.2, wisp ? 0.8 : 0.92, r);
        const detail = Math.max(0, billow - 0.3) * 1.6;
        d = wisp ? shape * shape * (0.25 + detail * 0.9) : shape * (0.45 + detail * 0.75);
      }
      field[y * size + x] = Math.min(1, Math.max(0, d));
    }
  }
  const out = new Uint8ClampedArray(size * size * 4);
  const k = kind === "plume" ? 1.6 : 2.2;
  const at = (xx: number, yy: number): number =>
    field[
      Math.min(size - 1, Math.max(0, yy)) * size + Math.min(size - 1, Math.max(0, xx))
    ]!;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      // Canvas y runs down; the shader's v runs up.
      const gx = (at(x + 1, y) - at(x - 1, y)) * 0.5 * (size / 64);
      const gy = (at(x, y - 1) - at(x, y + 1)) * 0.5 * (size / 64);
      const i = (y * size + x) * 4;
      out[i] = 128 + Math.max(-127, Math.min(127, -gx * k * 127));
      out[i + 1] = 128 + Math.max(-127, Math.min(127, -gy * k * 127));
      out[i + 2] = 255;
      out[i + 3] = Math.round(field[y * size + x]! * 255);
    }
  }
  return out;
}

/** Soft round glow: impact flashes, embers, the halo around a spark. */
function drawGlow(ctx: CanvasRenderingContext2D): void {
  const c = ATLAS_TILE / 2;
  const g = ctx.createRadialGradient(c, c, 0, c, c, c);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.12, "rgba(255,255,255,0.75)");
  g.addColorStop(0.35, "rgba(255,255,255,0.22)");
  g.addColorStop(0.7, "rgba(255,255,255,0.04)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, ATLAS_TILE, ATLAS_TILE);
}

let atlasTexture: THREE.CanvasTexture | null = null;

type Painter = (
  ctx: CanvasRenderingContext2D,
  seed: number,
  ox: number,
  oy: number,
) => void;

export function getParticleAtlas(): THREE.CanvasTexture {
  if (atlasTexture) return atlasTexture;
  const canvas = document.createElement("canvas");
  canvas.width = ATLAS_TILE * ATLAS_COLS;
  canvas.height = ATLAS_TILE * ATLAS_ROWS;
  const ctx = canvas.getContext("2d")!;
  const density =
    (kind: "billow" | "wisp" | "plume"): Painter =>
    (c, seed, ox, oy) => {
      const data = buildDensityTile(kind, seed, ATLAS_TILE);
      // putImageData ignores the transform, so it takes the tile origin.
      c.putImageData(new ImageData(data, ATLAS_TILE, ATLAS_TILE), ox, oy);
    };
  const painters: Painter[] = [
    drawSmoke,
    (c) => drawSpark(c),
    drawDust,
    drawDebris,
    drawBlood,
    drawFire,
    drawFlash,
    (c) => drawRing(c),
    drawCrossFlash,
    drawHeatHaze,
    drawBloodMist,
    (c) => drawTracerHead(c),
    density("billow"),
    density("wisp"),
    density("plume"),
    (c) => drawGlow(c),
  ];
  for (let i = 0; i < painters.length; i += 1) {
    const col = i % ATLAS_COLS;
    const row = Math.floor(i / ATLAS_COLS);
    ctx.save();
    ctx.translate(col * ATLAS_TILE, row * ATLAS_TILE);
    ctx.beginPath();
    ctx.rect(0, 0, ATLAS_TILE, ATLAS_TILE);
    ctx.clip();
    painters[i]!(ctx, 0x1000 + i * 977, col * ATLAS_TILE, row * ATLAS_TILE);
    ctx.restore();
  }
  atlasTexture = new THREE.CanvasTexture(canvas);
  // Raw bytes: the colour tiles are pure white (identical either way) and the
  // density tiles carry a normal in RG that an sRGB decode would bend.
  atlasTexture.colorSpace = THREE.NoColorSpace;
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
  /**
   * Linear RGB. For an unlit particle this is the emitted colour (values above
   * 1 are intentional for hot effects); for a lit one it is the albedo.
   */
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
  /** 0 = colour as given; 1 = colour is albedo, shaded by sun, sky and flash. */
  lit: number;
  /**
   * Fade toward this plane (xyz unit normal, w = offset, `dot(n, p) = w`)
   * over `softRange` metres: an analytic soft particle against the surface a
   * puff was born on, which is the intersection anyone actually sees. A
   * `softRange` of 0 turns it off.
   */
  softPlane: THREE.Vector4;
  softRange: number;
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
    lit: 0,
    softPlane: new THREE.Vector4(0, 1, 0, 0),
    softRange: 0,
  };
}

/** Put a reused spawn record back to its defaults. */
export function resetSpawnParams(p: SpawnParams): SpawnParams {
  p.position.set(0, 0, 0);
  p.velocity.set(0, 0, 0);
  p.lifetime = 1;
  p.size0 = 0.1;
  p.size1 = 0.2;
  p.color0.setRGB(1, 1, 1);
  p.color1.setRGB(1, 1, 1);
  p.alpha0 = 1;
  p.alpha1 = 0;
  p.gravity = 0;
  p.drag = 0.4;
  p.rotation = 0;
  p.rotationRate = 0;
  p.sprite = SPRITE.smoke;
  p.additive = 0;
  p.stretch = 0;
  p.turbulence = 0;
  p.lit = 0;
  p.softPlane.set(0, 1, 0, 0);
  p.softRange = 0;
  return p;
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
attribute vec4 aLight;      // lit, normal strength, soft range, unused
attribute vec4 aPlane;      // soft plane normal xyz, offset w

uniform float uTime;
uniform vec2 uAtlas;        // cols, rows
uniform vec3 uSunDir;       // world, toward the sun

varying vec4 vColor;
varying vec2 vUv;
varying float vAdditive;
varying vec4 vLight;
varying vec2 vBill;
varying vec4 vFrame;        // view-space sprite +u (xy) and +v (zw)
varying float vSoft;
varying vec3 vViewPos;
varying vec3 vWorldPos;
varying vec3 vSunView;

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
    vLight = vec4(0.0);
    vBill = vec2(0.0);
    vFrame = vec4(0.0);
    vSoft = 0.0;
    vViewPos = vec3(0.0);
    vWorldPos = vec3(0.0);
    vSunView = vec3(0.0, 1.0, 0.0);
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

  // Smoke and dust swell fast and then slow: ease the size ramp out.
  float lit = aLight.x;
  float st = lit > 0.5 ? 1.0 - (1.0 - t) * (1.0 - t) : t;
  float size = mix(aParams.z, aParams.w, st);
  float rot = aPhys.z + aPhys.w * age;

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);

  // Billboard, with optional stretching along the screen-space velocity.
  vec2 corner = position.xy;
  float c = cos(rot);
  float s = sin(rot);
  vec2 rotated = vec2(corner.x * c - corner.y * s, corner.x * s + corner.y * c);
  vec2 offset = rotated * size;
  vFrame = vec4(c, s, -s, c);

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
      vFrame = vec4(-perp, dir);
    }
  }

  mv.xy += offset;
  gl_Position = projectionMatrix * mv;

  vBill = corner * 2.0;
  vViewPos = mv.xyz;
  // The mesh has an identity model matrix: invert the view transform to put
  // the corner back in the world, for the soft plane and the flash light.
  vWorldPos = (mv.xyz - viewMatrix[3].xyz) * mat3(viewMatrix);
  vSoft = dot(vWorldPos, aPlane.xyz) - aPlane.w;
  vSunView = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
  vLight = aLight;

  vColor = vec4(mix(aColor0.rgb, aColor1.rgb, t), mix(aColor0.a, aColor1.a, t));
  vAdditive = aStyle.y;

  // The atlas is painted with tile row 0 at the top of the canvas, and the
  // CanvasTexture keeps three's default flipY = true, so v = 1 is the canvas
  // top: count rows down from v = 1. (Flipping the texture instead would turn
  // every tile upside down inside its cell.)
  float sprite = aStyle.x;
  float col = mod(sprite, uAtlas.x);
  float row = uAtlas.y - 1.0 - floor(sprite / uAtlas.x);
  vUv = (uv + vec2(col, row)) / uAtlas;

  #include <logdepthbuf_vertex>
}
`;

const FRAGMENT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>

uniform sampler2D uAtlasMap;
uniform vec3 uSunColor;     // sun radiance on a white Lambert surface
uniform vec3 uSkyColor;     // sky fill from above
uniform vec3 uGroundColor;  // bounce from below
uniform vec4 uFlashPos;     // world xyz, w = reach (0 = off)
uniform vec3 uFlashColor;   // flash radiance at 1 m

varying vec4 vColor;
varying vec2 vUv;
varying float vAdditive;
varying vec4 vLight;
varying vec2 vBill;
varying vec4 vFrame;
varying float vSoft;
varying vec3 vViewPos;
varying vec3 vWorldPos;
varying vec3 vSunView;

void main() {
  #include <logdepthbuf_fragment>
  vec4 texel = texture2D(uAtlasMap, vUv);
  float alpha = texel.a * vColor.a;
  // Soft against the surface the particle was born on.
  float softRange = vLight.z;
  if (softRange > 0.0) alpha *= smoothstep(0.0, softRange, vSoft);
  // Never let a particle fill the lens.
  float viewDist = -vViewPos.z;
  alpha *= smoothstep(0.1, 0.38, viewDist);
  if (alpha < 0.003) discard;

  float normalStrength = vLight.y;
  vec3 base = (normalStrength > 0.0 ? vec3(1.0) : texel.rgb) * vColor.rgb;
  vec3 rgb = base;
  float lit = vLight.x;
  if (lit > 0.0) {
    // A puff is a ball: bend a sphere normal by the baked billow gradient.
    vec3 n = vec3(vBill * 0.75, 0.66);
    if (normalStrength > 0.0) {
      vec2 g = (texel.rg - 0.5) * 2.0 * normalStrength;
      n.xy += vFrame.xy * g.x + vFrame.zw * g.y;
    }
    n = normalize(n);
    vec3 V = normalize(-vViewPos);
    float density = texel.a;
    // Wrapped diffuse: light reaches round the back of a thin puff.
    float ndl = dot(n, vSunView);
    float diffuse = clamp((ndl + 0.5) / 1.5, 0.0, 1.0);
    // Thick cores self-shadow; thin rims transmit.
    diffuse *= mix(1.0, 0.62, density * vColor.a);
    // Henyey-Greenstein forward scatter, so smoke glows when backlit.
    float g2 = 0.55;
    float cosT = dot(-vSunView, V);
    float phase = (1.0 - g2 * g2) / pow(1.0 + g2 * g2 - 2.0 * g2 * cosT, 1.5);
    float scatter = phase * (1.0 - density * 0.6) * 0.16;
    // Sky from above, sand bounce from below: the view-space up is the
    // world up carried through the view matrix.
    vec3 upView = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
    float up = dot(n, upView) * 0.5 + 0.5;
    vec3 ambient = mix(uGroundColor, uSkyColor, up);
    vec3 light = uSunColor * (diffuse + scatter) + ambient;
    if (uFlashPos.w > 0.0) {
      vec3 toFlash = uFlashPos.xyz - vWorldPos;
      float d = length(toFlash);
      float reach = 1.0 - smoothstep(uFlashPos.w * 0.4, uFlashPos.w, d);
      light += uFlashColor * reach / (0.15 + d * d);
    }
    rgb = mix(base, base * light, lit);
  }
  // The blend is ONE, ONE_MINUS_SRC_ALPHA (premultiplied source-over), so
  // both paths premultiply rgb by alpha. Additive particles then write zero
  // alpha and leave the destination alone; alpha-blended ones cover it by
  // alpha. Unpremultiplied rgb here made smoke and dust add their full colour
  // whatever their alpha.
  gl_FragColor = vec4(rgb * alpha, mix(alpha, 0.0, vAdditive));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Lighting the particle shader shades lit puffs with, written per frame. */
export interface ParticleLighting {
  sunDirection: THREE.Vector3;
  sunColor: THREE.Color;
  skyColor: THREE.Color;
  groundColor: THREE.Color;
  /** Flash position; `flashReach` 0 turns the flash term off. */
  flashPosition: THREE.Vector3;
  flashReach: number;
  flashColor: THREE.Color;
}

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
  private readonly light: Float32Array;
  private readonly plane: Float32Array;
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
    this.light = new Float32Array(capacity * 4);
    this.plane = new Float32Array(capacity * 4);
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
    add("aLight", this.light, 4);
    add("aPlane", this.plane, 4);

    this.material = new THREE.ShaderMaterial({
      name: "fx-particles",
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uTime: { value: 0 },
        uAtlasMap: { value: getParticleAtlas() },
        uAtlas: { value: new THREE.Vector2(ATLAS_COLS, ATLAS_ROWS) },
        uSunDir: { value: new THREE.Vector3(0.4, 0.8, -0.4).normalize() },
        uSunColor: { value: new THREE.Color(1.7, 1.55, 1.35) },
        uSkyColor: { value: new THREE.Color(0.3, 0.36, 0.44) },
        uGroundColor: { value: new THREE.Color(0.32, 0.27, 0.2) },
        uFlashPos: { value: new THREE.Vector4(0, 0, 0, 0) },
        uFlashColor: { value: new THREE.Color(0, 0, 0) },
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
    this.light[i4] = p.lit;
    this.light[i4 + 1] = NORMAL_SPRITES.has(p.sprite) ? 1 : 0;
    this.light[i4 + 2] = Math.max(0, p.softRange);
    this.light[i4 + 3] = 0;
    this.plane[i4] = p.softPlane.x;
    this.plane[i4 + 1] = p.softPlane.y;
    this.plane[i4 + 2] = p.softPlane.z;
    this.plane[i4 + 3] = p.softPlane.w;

    if (i < this.dirtyLow) this.dirtyLow = i;
    if (i > this.dirtyHigh) this.dirtyHigh = i;
    return i;
  }

  /** Write this frame's sun, sky and flash into the shader. */
  setLighting(lighting: ParticleLighting): void {
    const u = this.material.uniforms;
    (u["uSunDir"]!.value as THREE.Vector3).copy(lighting.sunDirection);
    (u["uSunColor"]!.value as THREE.Color).copy(lighting.sunColor);
    (u["uSkyColor"]!.value as THREE.Color).copy(lighting.skyColor);
    (u["uGroundColor"]!.value as THREE.Color).copy(lighting.groundColor);
    (u["uFlashPos"]!.value as THREE.Vector4).set(
      lighting.flashPosition.x,
      lighting.flashPosition.y,
      lighting.flashPosition.z,
      lighting.flashReach,
    );
    (u["uFlashColor"]!.value as THREE.Color).copy(lighting.flashColor);
  }

  /**
   * Move the clock. Call before this frame's spawns, so a particle born this
   * frame is drawn at age zero: a 40 ms spark spawned after the clock moved
   * by a 50 ms frame was already dead when it was drawn.
   */
  advance(dt: number): void {
    this.time += dt;
    this.material.uniforms["uTime"]!.value = this.time;
  }

  /** Upload only the slots touched since the last frame. */
  flush(): void {
    if (this.dirtyHigh < this.dirtyLow) return;
    const lo = this.dirtyLow;
    const count = this.dirtyHigh - lo + 1;
    const flush = (name: string, size: number): void => {
      const attribute = this.geometry.getAttribute(
        name,
      ) as THREE.InstancedBufferAttribute;
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
    flush("aLight", 4);
    flush("aPlane", 4);
    this.dirtyLow = Infinity;
    this.dirtyHigh = -1;
  }

  /** Advance and upload in one call, for callers that spawn before it. */
  update(dt: number): void {
    this.advance(dt);
    this.flush();
  }

  get now(): number {
    return this.time;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
