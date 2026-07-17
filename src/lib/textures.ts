import * as THREE from "three";
import { mulberry32 } from "./noise";

/**
 * All surface detail is generated at runtime with 2D canvas — no texture
 * downloads. Every generator takes a seed so the output is deterministic.
 */

function makeCanvas(w: number, h: number): CanvasRenderingContext2D {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");
  return ctx;
}

function speckle(
  ctx: CanvasRenderingContext2D,
  rand: () => number,
  count: number,
  colors: string[],
  maxSize = 3,
): void {
  const { width, height } = ctx.canvas;
  for (let i = 0; i < count; i++) {
    const c = colors[Math.floor(rand() * colors.length)] ?? colors[0] ?? "#000";
    ctx.fillStyle = c;
    ctx.globalAlpha = 0.04 + rand() * 0.1;
    const s = 1 + rand() * maxSize;
    ctx.fillRect(rand() * width, rand() * height, s, s);
  }
  ctx.globalAlpha = 1;
}

function toTexture(
  ctx: CanvasRenderingContext2D,
  srgb = true,
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(ctx.canvas);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/* ------------------------------------------------------------------ */
/* Pavement                                                            */
/* ------------------------------------------------------------------ */

export interface PavementOptions {
  lengthM: number;
  widthM: number;
  markings: "runway" | "taxiway" | "none";
  seed: number;
}

/**
 * Asphalt strip texture. The canvas v-axis runs along the strip's length,
 * u across its width, matching a PlaneGeometry(width, length).
 */
export function makePavementTexture(opts: PavementOptions): THREE.CanvasTexture {
  const { lengthM, widthM, markings, seed } = opts;
  const H = Math.min(4096, Math.max(512, Math.round(lengthM * 1.6)));
  const W = 256;
  const pxPerMx = W / widthM;
  const pxPerMy = H / lengthM;
  const ctx = makeCanvas(W, H);
  const rand = mulberry32(seed);

  ctx.fillStyle = "#3d3b38";
  ctx.fillRect(0, 0, W, H);
  speckle(ctx, rand, 9000, ["#55524d", "#2c2a28", "#474540", "#605c54"], 3);

  // faded longitudinal weathering bands
  for (let i = 0; i < 14; i++) {
    ctx.fillStyle = rand() > 0.5 ? "#454340" : "#343230";
    ctx.globalAlpha = 0.06 + rand() * 0.08;
    const x = rand() * W;
    ctx.fillRect(x, 0, 6 + rand() * 24, H);
  }
  ctx.globalAlpha = 1;

  const paint = (alpha: number) => {
    ctx.fillStyle = "#d9d5c9";
    ctx.globalAlpha = alpha;
  };

  if (markings === "runway") {
    const dashH = 30 * pxPerMy;
    const gapH = 20 * pxPerMy;
    const lineW = Math.max(3, 0.9 * pxPerMx);
    // centerline dashes, skipping the threshold zones
    paint(0.5);
    for (let y = 90 * pxPerMy; y < H - 90 * pxPerMy; y += dashH + gapH) {
      ctx.fillRect(W / 2 - lineW / 2, y, lineW, dashH);
    }
    // edge lines
    paint(0.3);
    ctx.fillRect(4, 0, 3, H);
    ctx.fillRect(W - 7, 0, 3, H);
    // threshold piano keys + chevrons at both ends
    for (const end of [0, 1] as const) {
      const dir = end === 0 ? 1 : -1;
      const edge = end === 0 ? 0 : H;
      const keyY = edge + dir * 8 * pxPerMy;
      const keyH = dir * 28 * pxPerMy;
      paint(0.55);
      const nKeys = 8;
      const span = W * 0.78;
      const keyW = span / (nKeys * 2 - 1);
      for (let i = 0; i < nKeys; i++) {
        ctx.fillRect((W - span) / 2 + i * keyW * 2, keyY, keyW, keyH);
      }
      // inward-pointing chevrons
      paint(0.45);
      ctx.strokeStyle = "#d9d5c9";
      ctx.lineWidth = Math.max(3, 0.8 * pxPerMx);
      for (let i = 0; i < 3; i++) {
        const baseY = edge + dir * (46 + i * 14) * pxPerMy;
        const tipY = baseY + dir * 10 * pxPerMy;
        ctx.beginPath();
        ctx.moveTo(W * 0.2, baseY);
        ctx.lineTo(W * 0.5, tipY);
        ctx.lineTo(W * 0.8, baseY);
        ctx.stroke();
      }
      // rubber / tire streaks just past the threshold
      ctx.globalAlpha = 1;
      for (let i = 0; i < 60; i++) {
        ctx.strokeStyle = "#1f1e1c";
        ctx.globalAlpha = 0.04 + rand() * 0.09;
        ctx.lineWidth = 1 + rand() * 3;
        const x = W * (0.3 + rand() * 0.4);
        const y0 = edge + dir * (70 + rand() * 260) * pxPerMy;
        ctx.beginPath();
        ctx.moveTo(x, y0);
        ctx.lineTo(x + (rand() - 0.5) * 6, y0 + dir * (30 + rand() * 120) * pxPerMy);
        ctx.stroke();
      }
    }
  } else if (markings === "taxiway") {
    ctx.fillStyle = "#c9a83c";
    ctx.globalAlpha = 0.5;
    const lineW = Math.max(3, 0.5 * pxPerMx);
    ctx.fillRect(W / 2 - lineW / 2, 0, lineW, H);
  }
  ctx.globalAlpha = 1;

  // dust encroaching from the edges
  const grad = ctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, "rgba(178,160,127,0.28)");
  grad.addColorStop(0.12, "rgba(178,160,127,0)");
  grad.addColorStop(0.88, "rgba(178,160,127,0)");
  grad.addColorStop(1, "rgba(178,160,127,0.28)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  return toTexture(ctx);
}

/* ------------------------------------------------------------------ */
/* Dirt strips & roads                                                 */
/* ------------------------------------------------------------------ */

export function makeDirtTexture(seed: number, ruts: boolean): THREE.CanvasTexture {
  const W = 256;
  const H = 1024;
  const ctx = makeCanvas(W, H);
  const rand = mulberry32(seed);

  ctx.fillStyle = "#b5a17c";
  ctx.fillRect(0, 0, W, H);
  speckle(ctx, rand, 8000, ["#c7b58f", "#9c8a68", "#ab9a76", "#8d7c5e"], 4);

  // graded longitudinal texture
  for (let i = 0; i < 40; i++) {
    ctx.strokeStyle = rand() > 0.5 ? "#a08e6b" : "#c2b088";
    ctx.globalAlpha = 0.08 + rand() * 0.1;
    ctx.lineWidth = 1 + rand() * 2;
    const x = rand() * W;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + (rand() - 0.5) * 20, H);
    ctx.stroke();
  }

  if (ruts) {
    for (const fx of [0.36, 0.64]) {
      ctx.strokeStyle = "#8a7a5c";
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(W * fx, 0);
      ctx.lineTo(W * fx, H);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;

  // berm shadow: darker compacted center, lighter loose edges
  const grad = ctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, "rgba(220,205,170,0.5)");
  grad.addColorStop(0.18, "rgba(0,0,0,0.06)");
  grad.addColorStop(0.5, "rgba(0,0,0,0.1)");
  grad.addColorStop(0.82, "rgba(0,0,0,0.06)");
  grad.addColorStop(1, "rgba(220,205,170,0.5)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  return toTexture(ctx);
}

/* ------------------------------------------------------------------ */
/* Concrete (apron & buildings)                                        */
/* ------------------------------------------------------------------ */

export function makeApronTexture(seed: number): THREE.CanvasTexture {
  const S = 1024;
  const ctx = makeCanvas(S, S);
  const rand = mulberry32(seed);

  ctx.fillStyle = "#8f8a80";
  ctx.fillRect(0, 0, S, S);
  speckle(ctx, rand, 14000, ["#9c968b", "#7e796f", "#a8a296", "#6f6a61"], 3);

  // expansion joints every 25 m over a 250 m apron → 10 panels
  ctx.strokeStyle = "#57534a";
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 2;
  const step = S / 10;
  for (let i = 1; i < 10; i++) {
    ctx.beginPath();
    ctx.moveTo(i * step, 0);
    ctx.lineTo(i * step, S);
    ctx.moveTo(0, i * step);
    ctx.lineTo(S, i * step);
    ctx.stroke();
  }
  // oil / rubber stains
  for (let i = 0; i < 26; i++) {
    ctx.fillStyle = "#3a3835";
    ctx.globalAlpha = 0.05 + rand() * 0.12;
    const r = 8 + rand() * 46;
    ctx.beginPath();
    ctx.ellipse(rand() * S, rand() * S, r, r * (0.5 + rand() * 0.5), rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  return toTexture(ctx);
}

export function makeConcreteWallTexture(seed: number, tint = "#a49d90"): THREE.CanvasTexture {
  const S = 512;
  const ctx = makeCanvas(S, S);
  const rand = mulberry32(seed);
  ctx.fillStyle = tint;
  ctx.fillRect(0, 0, S, S);
  speckle(ctx, rand, 6000, ["#b3ac9e", "#8f887b", "#9b948a"], 3);
  // streaking from the top edge (dust wash)
  for (let i = 0; i < 40; i++) {
    ctx.strokeStyle = "#7d7669";
    ctx.globalAlpha = 0.05 + rand() * 0.08;
    ctx.lineWidth = 2 + rand() * 6;
    const x = rand() * S;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + (rand() - 0.5) * 12, rand() * S * 0.7);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  return toTexture(ctx);
}

export function makeCorrugatedTexture(seed: number, base = "#8d9297"): THREE.CanvasTexture {
  const S = 256;
  const ctx = makeCanvas(S, S);
  const rand = mulberry32(seed);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, S, S);
  // corrugation ridges
  for (let x = 0; x < S; x += 8) {
    const g = ctx.createLinearGradient(x, 0, x + 8, 0);
    g.addColorStop(0, "rgba(255,255,255,0.16)");
    g.addColorStop(0.45, "rgba(0,0,0,0.02)");
    g.addColorStop(1, "rgba(0,0,0,0.22)");
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, 8, S);
  }
  // rust / dust streaks
  for (let i = 0; i < 26; i++) {
    ctx.strokeStyle = rand() > 0.5 ? "#7c6a4f" : "#5f6468";
    ctx.globalAlpha = 0.06 + rand() * 0.12;
    ctx.lineWidth = 2 + rand() * 5;
    const x = rand() * S;
    ctx.beginPath();
    ctx.moveTo(x, rand() * S * 0.3);
    ctx.lineTo(x, S);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  return toTexture(ctx);
}

/* ------------------------------------------------------------------ */
/* Terrain detail normal map                                           */
/* ------------------------------------------------------------------ */

/**
 * Tiling normal map for high-frequency ground grain, derived from a small
 * seamless value-noise heightfield.
 */
export function makeGroundNormalTexture(seed: number): THREE.CanvasTexture {
  const S = 256;
  const rand = mulberry32(seed);

  // seamless value noise: sum of a few wrapped octaves
  const height = new Float32Array(S * S);
  const lattice = 32;
  const grid = new Float32Array(lattice * lattice);
  for (let i = 0; i < grid.length; i++) grid[i] = rand();
  const sample = (fx: number, fy: number): number => {
    const x0 = Math.floor(fx) % lattice;
    const y0 = Math.floor(fy) % lattice;
    const x1 = (x0 + 1) % lattice;
    const y1 = (y0 + 1) % lattice;
    const tx = fx - Math.floor(fx);
    const ty = fy - Math.floor(fy);
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const g = (x: number, y: number) => grid[y * lattice + x] ?? 0;
    const a = g(x0, y0) + (g(x1, y0) - g(x0, y0)) * sx;
    const b = g(x0, y1) + (g(x1, y1) - g(x0, y1)) * sx;
    return a + (b - a) * sy;
  };
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = (x / S) * lattice;
      const v = (y / S) * lattice;
      height[y * S + x] =
        sample(u, v) * 0.55 +
        sample((u * 2) % lattice, (v * 2) % lattice) * 0.3 +
        sample((u * 4) % lattice, (v * 4) % lattice) * 0.15;
    }
  }

  const ctx = makeCanvas(S, S);
  const img = ctx.createImageData(S, S);
  const strength = 2.2;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const hL = height[y * S + ((x - 1 + S) % S)] ?? 0;
      const hR = height[y * S + ((x + 1) % S)] ?? 0;
      const hU = height[((y - 1 + S) % S) * S + x] ?? 0;
      const hD = height[((y + 1) % S) * S + x] ?? 0;
      let nx = (hL - hR) * strength;
      let ny = (hU - hD) * strength;
      let nz = 1;
      const inv = 1 / Math.hypot(nx, ny, nz);
      nx *= inv;
      ny *= inv;
      nz *= inv;
      const i = (y * S + x) * 4;
      img.data[i] = Math.round((nx * 0.5 + 0.5) * 255);
      img.data[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      img.data[i + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(ctx, false);
}
