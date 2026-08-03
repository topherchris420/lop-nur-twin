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
  /** Runway designators painted at the `from` and `to` thresholds. */
  designators?: [string, string];
}

/**
 * Pale poured-concrete strip texture (the real site's runway and pavements
 * read almost white from above). The canvas v-axis runs along the strip's
 * length, u across its width, matching a PlaneGeometry(width, length).
 */
export function makePavementTexture(opts: PavementOptions): THREE.CanvasTexture {
  const { lengthM, widthM, markings, seed, designators = ["08", "26"] } = opts;
  const H = Math.min(4096, Math.max(512, Math.round(lengthM * 1.6)));
  const W = 256;
  const pxPerMx = W / widthM;
  const pxPerMy = H / lengthM;
  const ctx = makeCanvas(W, H);
  const rand = mulberry32(seed);

  ctx.fillStyle = "#b3aea1";
  ctx.fillRect(0, 0, W, H);
  speckle(ctx, rand, 9000, ["#c2bdb0", "#a19c8f", "#bab4a5", "#918c80"], 3);

  // faded longitudinal weathering bands
  for (let i = 0; i < 12; i++) {
    ctx.fillStyle = rand() > 0.5 ? "#bcb7aa" : "#a29d91";
    ctx.globalAlpha = 0.06 + rand() * 0.08;
    const x = rand() * W;
    ctx.fillRect(x, 0, 6 + rand() * 24, H);
  }
  ctx.globalAlpha = 1;

  // concrete expansion joints: transverse every 25 m, longitudinal thirds
  ctx.strokeStyle = "#7e7a6f";
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 0.4;
  for (let y = 25 * pxPerMy; y < H; y += 25 * pxPerMy) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
  const nLong = Math.max(2, Math.round(widthM / 12));
  for (let i = 1; i < nLong; i++) {
    const x = (W / nLong) * i;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const paint = (alpha: number) => {
    ctx.fillStyle = "#f4f1e6";
    ctx.globalAlpha = alpha;
  };

  if (markings === "runway") {
    const dashH = 30 * pxPerMy;
    const gapH = 20 * pxPerMy;
    const lineW = Math.max(3, 0.9 * pxPerMx);
    // centerline dashes, skipping the threshold zones
    paint(0.75);
    for (let y = 120 * pxPerMy; y < H - 120 * pxPerMy; y += dashH + gapH) {
      ctx.fillRect(W / 2 - lineW / 2, y, lineW, dashH);
    }
    // edge lines
    paint(0.45);
    ctx.fillRect(4, 0, 3, H);
    ctx.fillRect(W - 7, 0, 3, H);
    // threshold piano keys, designators and chevrons at both ends
    for (const end of [0, 1] as const) {
      const dir = end === 0 ? 1 : -1;
      const edge = end === 0 ? 0 : H;
      const keyY = edge + dir * 8 * pxPerMy;
      const keyH = dir * 28 * pxPerMy;
      paint(0.8);
      const nKeys = 8;
      const span = W * 0.78;
      const keyW = span / (nKeys * 2 - 1);
      for (let i = 0; i < nKeys; i++) {
        ctx.fillRect((W - span) / 2 + i * keyW * 2, keyY, keyW, keyH);
      }
      // runway designation numbers, read on approach
      paint(0.75);
      ctx.save();
      ctx.translate(W / 2, edge + dir * 70 * pxPerMy);
      if (end === 1) ctx.rotate(Math.PI);
      // canvas top (end 0) renders at the segment's `from` end
      ctx.font = `bold ${Math.round(24 * pxPerMy)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(end === 0 ? designators[0] : designators[1], 0, 0);
      ctx.restore();
      // inward-pointing chevrons
      paint(0.6);
      ctx.strokeStyle = "#f4f1e6";
      ctx.lineWidth = Math.max(3, 0.8 * pxPerMx);
      for (let i = 0; i < 3; i++) {
        const baseY = edge + dir * (92 + i * 14) * pxPerMy;
        const tipY = baseY + dir * 10 * pxPerMy;
        ctx.beginPath();
        ctx.moveTo(W * 0.2, baseY);
        ctx.lineTo(W * 0.5, tipY);
        ctx.lineTo(W * 0.8, baseY);
        ctx.stroke();
      }
      // rubber / tire streaks just past the threshold
      ctx.globalAlpha = 1;
      for (let i = 0; i < 70; i++) {
        ctx.strokeStyle = "#2b2a27";
        ctx.globalAlpha = 0.05 + rand() * 0.11;
        ctx.lineWidth = 1 + rand() * 3;
        const x = W * (0.3 + rand() * 0.4);
        const y0 = edge + dir * (110 + rand() * 260) * pxPerMy;
        ctx.beginPath();
        ctx.moveTo(x, y0);
        ctx.lineTo(x + (rand() - 0.5) * 6, y0 + dir * (30 + rand() * 120) * pxPerMy);
        ctx.stroke();
      }
    }
  } else if (markings === "taxiway") {
    ctx.fillStyle = "#c9a83c";
    ctx.globalAlpha = 0.6;
    const lineW = Math.max(3, 0.5 * pxPerMx);
    ctx.fillRect(W / 2 - lineW / 2, 0, lineW, H);
  }
  ctx.globalAlpha = 1;

  // dust encroaching from the edges
  const grad = ctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, "rgba(178,160,127,0.35)");
  grad.addColorStop(0.12, "rgba(178,160,127,0)");
  grad.addColorStop(0.88, "rgba(178,160,127,0)");
  grad.addColorStop(1, "rgba(178,160,127,0.35)");
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

  ctx.fillStyle = "#a29d92";
  ctx.fillRect(0, 0, S, S);
  speckle(ctx, rand, 14000, ["#afa99d", "#8f8a80", "#b7b1a4", "#7e796f"], 3);

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
/* Building facades                                                    */
/* ------------------------------------------------------------------ */

export interface WindowBand {
  /** band top edge as a fraction of wall height, measured from the roofline */
  top: number;
  /** band height as a fraction of wall height */
  height: number;
  /** windows across one texture tile */
  cols: number;
}

export interface FacadeOptions {
  seed: number;
  /** wall base color */
  base: string;
  bands: WindowBand[];
  /** fraction of windows lit in the emissive map */
  litRatio?: number;
}

export interface FacadeTextures {
  map: THREE.CanvasTexture;
  emissive: THREE.CanvasTexture;
}

/**
 * Wall texture with horizontal window bands, plus a matching emissive map
 * (only the lit windows are bright) for night-time glow.
 */
export function makeFacadeTextures(opts: FacadeOptions): FacadeTextures {
  const S = 512;
  const { seed, base, bands, litRatio = 0.55 } = opts;
  const rand = mulberry32(seed);

  const ctx = makeCanvas(S, S);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, S, S);
  speckle(ctx, rand, 4500, ["#ffffff", "#6f6a5f", "#8f887b"], 2);

  // vertical cladding-panel seams
  ctx.strokeStyle = "rgba(0,0,0,0.10)";
  ctx.lineWidth = 1.5;
  for (let x = 0; x < S; x += 64) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, S);
    ctx.stroke();
  }
  // dust wash streaks
  for (let i = 0; i < 26; i++) {
    ctx.strokeStyle = "#7d7669";
    ctx.globalAlpha = 0.04 + rand() * 0.06;
    ctx.lineWidth = 2 + rand() * 6;
    const x = rand() * S;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + (rand() - 0.5) * 10, rand() * S * 0.6);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const glowCtx = makeCanvas(S, S);
  glowCtx.fillStyle = "#000000";
  glowCtx.fillRect(0, 0, S, S);

  for (const band of bands) {
    const y0 = band.top * S;
    const bh = band.height * S;
    const cell = S / band.cols;
    const winW = cell * 0.58;
    for (let c = 0; c < band.cols; c++) {
      const x0 = c * cell + (cell - winW) / 2;
      // frame
      ctx.fillStyle = "#57544c";
      ctx.fillRect(x0 - 2, y0 - 2, winW + 4, bh + 4);
      // glass, slightly varied
      const g = ctx.createLinearGradient(0, y0, 0, y0 + bh);
      g.addColorStop(0, "#3a4750");
      g.addColorStop(1, "#232b31");
      ctx.fillStyle = g;
      ctx.fillRect(x0, y0, winW, bh);
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      ctx.fillRect(x0, y0, winW, bh * 0.18);

      if (rand() < litRatio) {
        glowCtx.fillStyle = `rgba(255, ${170 + Math.floor(rand() * 50)}, 94, ${0.75 + rand() * 0.25})`;
        glowCtx.fillRect(x0, y0, winW, bh);
      }
    }
  }

  return { map: toTexture(ctx), emissive: toTexture(glowCtx) };
}

/** White ribbed / seamed panel skin for the big hangar roof and shelters. */
export function makeWhitePanelTexture(seed: number): THREE.CanvasTexture {
  const S = 512;
  const ctx = makeCanvas(S, S);
  const rand = mulberry32(seed);
  ctx.fillStyle = "#dedbd2";
  ctx.fillRect(0, 0, S, S);
  speckle(ctx, rand, 3000, ["#eceae2", "#cbc8bd"], 2);
  // panel seams
  ctx.strokeStyle = "rgba(0,0,0,0.12)";
  ctx.lineWidth = 1.5;
  for (let x = 0; x < S; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, S);
    ctx.stroke();
  }
  // faint dust runs
  for (let i = 0; i < 18; i++) {
    ctx.strokeStyle = "#b3ad9e";
    ctx.globalAlpha = 0.05 + rand() * 0.07;
    ctx.lineWidth = 3 + rand() * 8;
    const x = rand() * S;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, rand() * S);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  return toTexture(ctx);
}

/** Dark photovoltaic panel grid, for the solar field and rooftop arrays. */
export function makeSolarTexture(seed: number): THREE.CanvasTexture {
  const S = 256;
  const ctx = makeCanvas(S, S);
  const rand = mulberry32(seed);
  ctx.fillStyle = "#16233d";
  ctx.fillRect(0, 0, S, S);
  // cell grid
  ctx.strokeStyle = "#2c436b";
  ctx.lineWidth = 1.5;
  for (let p = 0; p <= S; p += 16) {
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, S);
    ctx.moveTo(0, p);
    ctx.lineTo(S, p);
    ctx.stroke();
  }
  // module borders every 4 cells
  ctx.strokeStyle = "#8f96a1";
  ctx.lineWidth = 2;
  for (let p = 0; p <= S; p += 64) {
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, S);
    ctx.moveTo(0, p);
    ctx.lineTo(S, p);
    ctx.stroke();
  }
  // sky glare
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = "rgba(180, 205, 235, 0.08)";
    const w = 30 + rand() * 80;
    ctx.fillRect(rand() * S, rand() * S, w, w * 0.4);
  }
  return toTexture(ctx);
}

/* ------------------------------------------------------------------ */
/* Rust stain                                                          */
/* ------------------------------------------------------------------ */

/** Weathered steel surface with rust streaks and water stains. */
export function makeRustStainTexture(seed: number): THREE.CanvasTexture {
  const S = 512;
  const ctx = makeCanvas(S, S);
  const rand = mulberry32(seed);

  ctx.fillStyle = "#8a7e6e";
  ctx.fillRect(0, 0, S, S);
  speckle(ctx, rand, 8000, ["#7e7264", "#968a7a", "#6e6456", "#a09484"], 3);

  // vertical rust streaks
  const rustColors = ["#6b3a1f", "#8b4513", "#a0522d"];
  for (let i = 0; i < 35; i++) {
    const color = rustColors[Math.floor(rand() * rustColors.length)] ?? rustColors[0]!;
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.06 + rand() * 0.14;
    ctx.lineWidth = 2 + rand() * 8;
    const x = rand() * S;
    const y0 = rand() * S * 0.3;
    ctx.beginPath();
    ctx.moveTo(x, y0);
    ctx.lineTo(x + (rand() - 0.5) * 16, y0 + S * (0.3 + rand() * 0.5));
    ctx.stroke();
  }

  // water stain patches
  for (let i = 0; i < 12; i++) {
    ctx.fillStyle = "#5c5347";
    ctx.globalAlpha = 0.04 + rand() * 0.08;
    const r = 16 + rand() * 50;
    ctx.beginPath();
    ctx.ellipse(rand() * S, rand() * S, r, r * (0.4 + rand() * 0.6), rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  // pitting marks
  for (let i = 0; i < 200; i++) {
    ctx.fillStyle = rand() > 0.5 ? "#4a3a2a" : "#6b5a44";
    ctx.globalAlpha = 0.06 + rand() * 0.1;
    const s = 1 + rand() * 3;
    ctx.fillRect(rand() * S, rand() * S, s, s);
  }
  ctx.globalAlpha = 1;
  return toTexture(ctx);
}

/* ------------------------------------------------------------------ */
/* Stucco wall                                                         */
/* ------------------------------------------------------------------ */

/** Plastered/stucco wall surface with fine granular texture. */
export function makeStuccoTexture(seed: number, tint = "#c4b99a"): THREE.CanvasTexture {
  const S = 512;
  const ctx = makeCanvas(S, S);
  const rand = mulberry32(seed);

  ctx.fillStyle = tint;
  ctx.fillRect(0, 0, S, S);
  // fine granular speckle (high count, small size)
  speckle(ctx, rand, 12000, ["#d1c6a8", "#b0a68c", "#c8be9f", "#9e9478"], 2);

  // subtle horizontal trowel marks
  for (let i = 0; i < 50; i++) {
    ctx.strokeStyle = rand() > 0.5 ? "#b5aa90" : "#d0c5ab";
    ctx.globalAlpha = 0.03 + rand() * 0.06;
    ctx.lineWidth = 1 + rand() * 3;
    const y = rand() * S;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(S, y + (rand() - 0.5) * 6);
    ctx.stroke();
  }

  // weathering stains near the base (bottom 30%)
  const baseY = S * 0.7;
  for (let i = 0; i < 18; i++) {
    ctx.fillStyle = rand() > 0.5 ? "#8a7e66" : "#7a7060";
    ctx.globalAlpha = 0.04 + rand() * 0.08;
    const w = 20 + rand() * 80;
    const h = 10 + rand() * 40;
    ctx.fillRect(rand() * S, baseY + rand() * (S - baseY), w, h);
  }
  ctx.globalAlpha = 1;

  // faint gradient darkening toward the base
  const grad = ctx.createLinearGradient(0, 0, 0, S);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(0.75, "rgba(0,0,0,0)");
  grad.addColorStop(1, "rgba(0,0,0,0.12)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, S, S);

  return toTexture(ctx);
}

/* ------------------------------------------------------------------ */
/* Dirty concrete (compounds)                                          */
/* ------------------------------------------------------------------ */

/** Heavily weathered concrete for walled compounds. */
export function makeDirtyConcreteTexture(seed: number): THREE.CanvasTexture {
  const S = 512;
  const ctx = makeCanvas(S, S);
  const rand = mulberry32(seed);

  ctx.fillStyle = "#9b9487";
  ctx.fillRect(0, 0, S, S);
  speckle(ctx, rand, 10000, ["#a89f92", "#8c857a", "#b3ab9e", "#7a746a"], 3);

  // heavy dust staining patches
  for (let i = 0; i < 20; i++) {
    ctx.fillStyle = rand() > 0.5 ? "#7d776b" : "#6e685e";
    ctx.globalAlpha = 0.05 + rand() * 0.1;
    const r = 20 + rand() * 60;
    ctx.beginPath();
    ctx.ellipse(rand() * S, rand() * S, r, r * (0.5 + rand() * 0.5), rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  // algae / mold patches (green-gray)
  for (let i = 0; i < 10; i++) {
    ctx.fillStyle = rand() > 0.5 ? "#6b7a62" : "#5e6e58";
    ctx.globalAlpha = 0.04 + rand() * 0.08;
    const r = 12 + rand() * 45;
    ctx.beginPath();
    ctx.ellipse(rand() * S, rand() * S, r, r * (0.6 + rand() * 0.4), rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  // crack lines
  for (let i = 0; i < 8; i++) {
    ctx.strokeStyle = "#4a453e";
    ctx.globalAlpha = 0.12 + rand() * 0.15;
    ctx.lineWidth = 0.5 + rand() * 1.5;
    const x0 = rand() * S;
    const y0 = rand() * S;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    // jagged crack path with 3-5 segments
    let cx = x0;
    let cy = y0;
    const segs = 3 + Math.floor(rand() * 3);
    for (let s = 0; s < segs; s++) {
      cx += (rand() - 0.5) * 80;
      cy += 20 + rand() * 60;
      ctx.lineTo(cx, cy);
    }
    ctx.stroke();
  }

  // efflorescence streaks (white mineral deposits)
  for (let i = 0; i < 14; i++) {
    ctx.strokeStyle = "#d8d2c8";
    ctx.globalAlpha = 0.05 + rand() * 0.1;
    ctx.lineWidth = 3 + rand() * 8;
    const x = rand() * S;
    ctx.beginPath();
    ctx.moveTo(x, rand() * S * 0.3);
    ctx.lineTo(x + (rand() - 0.5) * 14, S * (0.4 + rand() * 0.5));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  return toTexture(ctx);
}

/* ------------------------------------------------------------------ */
/* Chain-link fence                                                     */
/* ------------------------------------------------------------------ */

/** Chain-link fence pattern on a mostly transparent background. */
export function makeChainLinkTexture(seed: number): THREE.CanvasTexture {
  const S = 256;
  const ctx = makeCanvas(S, S);
  const rand = mulberry32(seed);

  // transparent background with very faint haze
  ctx.clearRect(0, 0, S, S);

  // diamond wire grid pattern
  const wireColor = "#4a4a4a";
  const cellW = 16; // horizontal spacing of the diamond pattern
  const cellH = 24; // vertical spacing of the diamond pattern

  ctx.strokeStyle = wireColor;
  // A 1 px wire on a 16 px cell is 7% coverage, which mipmaps down to almost
  // nothing and then aliases into coarse moiré diamonds at any distance. Real
  // 2 mm wire on a 50 mm mesh is nearer 8% too, but a texture has to survive
  // minification, so the wire is drawn heavier than scale to hold together.
  ctx.lineWidth = 2.6;
  ctx.globalAlpha = 0.92;

  // draw diamond pattern — diagonal lines in both directions
  for (let y = -cellH; y < S + cellH; y += cellH) {
    for (let x = -cellW; x < S + cellW; x += cellW * 2) {
      const offsetX = ((y / cellH) % 2) * cellW;
      const cx = x + offsetX;
      // downward-right diagonal
      ctx.beginPath();
      ctx.moveTo(cx, y);
      ctx.lineTo(cx + cellW, y + cellH);
      ctx.stroke();
      // downward-left diagonal
      ctx.beginPath();
      ctx.moveTo(cx + cellW * 2, y);
      ctx.lineTo(cx + cellW, y + cellH);
      ctx.stroke();
    }
  }

  // slight wire thickness variation for realism
  for (let i = 0; i < 60; i++) {
    ctx.fillStyle = rand() > 0.5 ? "#5a5a5a" : "#3a3a3a";
    ctx.globalAlpha = 0.08 + rand() * 0.12;
    const s = 1 + rand() * 2;
    ctx.fillRect(rand() * S, rand() * S, s, s);
  }
  ctx.globalAlpha = 1;

  const tex = toTexture(ctx);
  tex.premultiplyAlpha = true;
  return tex;
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

/* ------------------------------------------------------------------ */
/* Drifting cloud shadows                                              */
/* ------------------------------------------------------------------ */

/**
 * Seamless, soft cloud-cover mask used to drift shadow patches across the
 * plain. RGB is a dark shadow tint; alpha carries the coverage so the layer
 * only darkens where clouds are. Wraps in both axes for endless scrolling.
 */
export function makeCloudShadowTexture(seed: number): THREE.CanvasTexture {
  const S = 512;
  const ctx = makeCanvas(S, S);
  const rand = mulberry32(seed);
  ctx.clearRect(0, 0, S, S);
  ctx.globalCompositeOperation = "lighter";
  // scatter soft blobs; draw each in a 3×3 wrap so the tile stays seamless
  const blobs = 90;
  for (let i = 0; i < blobs; i++) {
    const bx = rand() * S;
    const by = rand() * S;
    const r = 26 + rand() * 90;
    const a = 0.05 + rand() * 0.12;
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        const cx = bx + ox * S;
        const cy = by + oy * S;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, `rgba(40,34,24,${a})`);
        g.addColorStop(1, "rgba(40,34,24,0)");
        ctx.fillStyle = g;
        ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      }
    }
  }
  ctx.globalCompositeOperation = "source-over";
  return toTexture(ctx, false);
}
