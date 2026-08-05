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

/**
 * Anisotropic filtering budget. Ground planes are the only surfaces here seen
 * at genuinely grazing angles — a runway seen from eye height compresses tens
 * of metres into a few pixels vertically — and 8 taps is not enough to stop
 * that smearing into mush. three clamps this to the driver's maximum, so
 * asking for 16 is safe everywhere.
 */
const GROUND_ANISOTROPY = 16;

function toTexture(
  ctx: CanvasRenderingContext2D,
  srgb = true,
  anisotropy = 8,
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(ctx.canvas);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
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

  return toTexture(ctx, true, GROUND_ANISOTROPY);
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

  return toTexture(ctx, true, GROUND_ANISOTROPY);
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
    ctx.ellipse(
      rand() * S,
      rand() * S,
      r,
      r * (0.5 + rand() * 0.5),
      rand() * Math.PI,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  return toTexture(ctx, true, GROUND_ANISOTROPY);
}

export function makeConcreteWallTexture(
  seed: number,
  tint = "#a49d90",
): THREE.CanvasTexture {
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

export function makeCorrugatedTexture(
  seed: number,
  base = "#8d9297",
): THREE.CanvasTexture {
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
    ctx.ellipse(
      rand() * S,
      rand() * S,
      r,
      r * (0.4 + rand() * 0.6),
      rand() * Math.PI,
      0,
      Math.PI * 2,
    );
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
    ctx.ellipse(
      rand() * S,
      rand() * S,
      r,
      r * (0.5 + rand() * 0.5),
      rand() * Math.PI,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }

  // algae / mold patches (green-gray)
  for (let i = 0; i < 10; i++) {
    ctx.fillStyle = rand() > 0.5 ? "#6b7a62" : "#5e6e58";
    ctx.globalAlpha = 0.04 + rand() * 0.08;
    const r = 12 + rand() * 45;
    ctx.beginPath();
    ctx.ellipse(
      rand() * S,
      rand() * S,
      r,
      r * (0.6 + rand() * 0.4),
      rand() * Math.PI,
      0,
      Math.PI * 2,
    );
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
 * Seamless value-noise sampler over a wrapped lattice. Sampling at integer
 * multiples of `lattice` wraps exactly, so any field built from it tiles.
 *
 * Written flat on purpose: this runs a few million times while the detail maps
 * build, and the obvious version — a nested `g(x, y)` helper reading
 * `grid[...] ?? 0` — is several times slower because every lookup allocates a
 * check V8 cannot hoist. Bounds are guaranteed by the wrap above it.
 */
function seamlessLattice(
  rand: () => number,
  lattice: number,
): (fx: number, fy: number) => number {
  const grid = new Float32Array(lattice * lattice);
  for (let i = 0; i < grid.length; i++) grid[i] = rand();
  return (fx: number, fy: number): number => {
    let wx = fx % lattice;
    if (wx < 0) wx += lattice;
    let wy = fy % lattice;
    if (wy < 0) wy += lattice;
    const x0 = wx | 0;
    const y0 = wy | 0;
    const x1 = x0 + 1 === lattice ? 0 : x0 + 1;
    const y1 = y0 + 1 === lattice ? 0 : y0 + 1;
    const tx = wx - x0;
    const ty = wy - y0;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const r0 = y0 * lattice;
    const r1 = y1 * lattice;
    const a00 = grid[r0 + x0]!;
    const a10 = grid[r0 + x1]!;
    const a01 = grid[r1 + x0]!;
    const a11 = grid[r1 + x1]!;
    const a = a00 + (a10 - a00) * sx;
    const b = a01 + (a11 - a01) * sx;
    return a + (b - a) * sy;
  };
}

/** Converts a wrapped heightfield into a tangent-space normal map canvas. */
function heightToNormalCanvas(
  height: Float32Array,
  S: number,
  strength: number,
): CanvasRenderingContext2D {
  const ctx = makeCanvas(S, S);
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    const row = y * S;
    const rowU = ((y - 1 + S) % S) * S;
    const rowD = ((y + 1) % S) * S;
    for (let x = 0; x < S; x++) {
      const hL = height[row + ((x - 1 + S) % S)]!;
      const hR = height[row + ((x + 1) % S)]!;
      const hU = height[rowU + x]!;
      const hD = height[rowD + x]!;
      const nx = (hL - hR) * strength;
      const ny = (hU - hD) * strength;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      const i = (row + x) * 4;
      img.data[i] = ((nx * inv * 0.5 + 0.5) * 255) | 0;
      img.data[i + 1] = ((ny * inv * 0.5 + 0.5) * 255) | 0;
      img.data[i + 2] = ((inv * 0.5 + 0.5) * 255) | 0;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return ctx;
}

/**
 * Tiling normal map for high-frequency ground grain, derived from a small
 * seamless value-noise heightfield.
 */
export function makeGroundNormalTexture(seed: number): THREE.CanvasTexture {
  const S = 256;
  const rand = mulberry32(seed);
  const lattice = 32;
  const sample = seamlessLattice(rand, lattice);

  const height = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = (x / S) * lattice;
      const v = (y / S) * lattice;
      height[y * S + x] =
        sample(u, v) * 0.55 + sample(u * 2, v * 2) * 0.3 + sample(u * 4, v * 4) * 0.15;
    }
  }

  return toTexture(heightToNormalCanvas(height, S, 2.2), false, GROUND_ANISOTROPY);
}

/* ------------------------------------------------------------------ */
/* Close-range ground detail                                           */
/* ------------------------------------------------------------------ */

/**
 * Which surface family a detail set is authored for. The large-scale maps
 * above were drawn for an aerial camera; these are the metre-scale layer that
 * only resolves when you are standing on the stuff.
 */
export type GroundDetailKind = "concrete" | "desert";

export interface GroundDetailMaps {
  /** Tangent-space grain, tiled at ~1 m and again at ~10 m. */
  normal: THREE.CanvasTexture;
  /**
   * Packed, linear:
   *  - R  albedo grain, 0.5 neutral (aggregate flecks, sand grains)
   *  - G  surface state, 0.5 neutral: below is polished/compacted, above is
   *       loose and dusty. Sampled twice — fine for micro roughness, coarse
   *       for the metre-scale wet/dry patchwork.
   *  - B  cracks and blemishes, 0 clean.
   */
  surface: THREE.CanvasTexture;
}

interface DetailRecipe {
  /** Height-field octave weights, coarse to fine. */
  octaves: [number, number, number, number];
  /** Base lattice; higher means finer base grain. */
  lattice: number;
  /** Normal derivation strength. */
  relief: number;
  /** Round grains stamped into the height: count and radius range in px. */
  grains: { count: number; min: number; max: number; depth: number };
  /** Pits / air voids stamped as dips. */
  pits: { count: number; min: number; max: number; depth: number };
  /** How strongly height feeds the albedo grain channel. */
  albedoFromHeight: number;
  /** Extra uncorrelated albedo speckle. */
  albedoSpeckle: number;
  /** Contrast applied to the surface-state channel around 0.5. */
  stateContrast: number;
  /**
   * How much the relief drives the surface state. High spots wear smooth and
   * low spots hold dust, so this is negative-signed in use — but pushing it
   * hard also anticorrelates roughness with the albedo grain, which doubles
   * the contrast of every fleck and turns aggregate into confetti.
   */
  stateFromHeight: number;
  /** Crack polylines drawn into B. */
  cracks: { count: number; width: number; segments: number; reach: number };
  /** Anisotropic wind ripple amplitude, 0 for none. */
  ripple: number;
}

const DETAIL_RECIPES: Record<GroundDetailKind, DetailRecipe> = {
  // Poured concrete: a hard float finish over exposed aggregate. The grain is
  // fine and dense, the pits are entrained air voids, and the cracks are what
  // 40 years of freeze-thaw does to a slab.
  concrete: {
    octaves: [0.34, 0.3, 0.22, 0.14],
    lattice: 24,
    relief: 2.6,
    grains: { count: 2600, min: 0.8, max: 2.6, depth: 0.5 },
    pits: { count: 900, min: 0.7, max: 2.2, depth: -0.62 },
    albedoFromHeight: 0.55,
    albedoSpeckle: 0.1,
    stateContrast: 1.35,
    stateFromHeight: 0.08,
    cracks: { count: 9, width: 1.15, segments: 7, reach: 46 },
    ripple: 0,
  },
  // Gobi lakebed: a crusted silt surface with a scatter of desert-pavement
  // pebbles sitting proud of it, and a faint wind ripple.
  desert: {
    octaves: [0.4, 0.28, 0.2, 0.12],
    lattice: 18,
    relief: 2.0,
    grains: { count: 1500, min: 1.1, max: 4.2, depth: 0.72 },
    pits: { count: 420, min: 1.4, max: 4.0, depth: -0.3 },
    albedoFromHeight: 0.95,
    albedoSpeckle: 0.07,
    stateContrast: 1.15,
    stateFromHeight: 0.2,
    // "cracks" here are the polygonal fissures of a dried playa crust
    cracks: { count: 7, width: 1.5, segments: 9, reach: 58 },
    ripple: 0.24,
  },
};

/**
 * Stamps a soft round bump (or dip) into a wrapped heightfield.
 * Wrapping is done by taking the shortest toroidal distance, so the tile stays
 * seamless without drawing the stamp nine times. The falloff is written on the
 * squared distance so the inner loop never calls `sqrt`.
 */
function stampGrain(
  height: Float32Array,
  S: number,
  cx: number,
  cy: number,
  radius: number,
  amplitude: number,
): void {
  const r = Math.ceil(radius);
  const invR2 = 1 / Math.max(radius * radius, 1e-6);
  const bx = Math.round(cx);
  const by = Math.round(cy);
  for (let dy = -r; dy <= r; dy++) {
    let y = (by + dy) % S;
    if (y < 0) y += S;
    const row = y * S;
    for (let dx = -r; dx <= r; dx++) {
      const d2 = (dx * dx + dy * dy) * invR2;
      if (d2 >= 1) continue;
      let x = (bx + dx) % S;
      if (x < 0) x += S;
      // smooth dome; squaring keeps the rim soft so it does not alias
      const f = (1 - d2) * (1 - d2);
      const i = row + x;
      height[i] = height[i]! + amplitude * f;
    }
  }
}

/** Draws one wrapped, jagged polyline into a mask canvas. */
function strokeWrapped(
  ctx: CanvasRenderingContext2D,
  points: Array<[number, number]>,
  width: number,
): void {
  const S = ctx.canvas.width;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (let ox = -1; ox <= 1; ox++) {
    for (let oy = -1; oy <= 1; oy++) {
      ctx.beginPath();
      const first = points[0];
      if (!first) return;
      ctx.moveTo(first[0] + ox * S, first[1] + oy * S);
      for (let i = 1; i < points.length; i++) {
        const p = points[i];
        if (p) ctx.lineTo(p[0] + ox * S, p[1] + oy * S);
      }
      ctx.stroke();
    }
  }
}

/**
 * Builds the close-range detail pair for one surface family.
 *
 * Both maps are linear data, both tile seamlessly, and neither carries any
 * structure larger than a few texels' worth of the tile — the shader samples
 * them at two very different scales (see `src/gfx/groundDetail.ts`) and any
 * large blob in the source would read as an obvious repeat at the coarse one.
 */
export function makeGroundDetailMaps(
  kind: GroundDetailKind,
  seed: number,
  size = 512,
): GroundDetailMaps {
  const S = Math.max(128, Math.min(1024, size));
  const recipe = DETAIL_RECIPES[kind];
  const rand = mulberry32(seed);
  const lattice = recipe.lattice;
  const hNoise = seamlessLattice(rand, lattice);
  const aNoise = seamlessLattice(rand, lattice);
  const sNoise = seamlessLattice(rand, Math.max(8, Math.round(lattice * 0.5)));

  /* --- height -> normal ------------------------------------------- */
  const height = new Float32Array(S * S);
  const o0 = recipe.octaves[0];
  const o1 = recipe.octaves[1];
  const o2 = recipe.octaves[2];
  const o3 = recipe.octaves[3];
  const step = lattice / S;
  const ripple = recipe.ripple;
  for (let y = 0; y < S; y++) {
    const v = y * step;
    const row = y * S;
    for (let x = 0; x < S; x++) {
      const u = x * step;
      let h =
        hNoise(u, v) * o0 +
        hNoise(u * 2, v * 2) * o1 +
        hNoise(u * 4, v * 4) * o2 +
        hNoise(u * 8, v * 8) * o3;
      if (ripple > 0) {
        // wind ripple: a wrapped sine whose phase wanders with the noise, so
        // it reads as drift rather than corduroy
        h +=
          Math.sin((x / S) * Math.PI * 12 + hNoise(u * 0.5, v * 0.5) * 5) * ripple * 0.5;
      }
      height[row + x] = h;
    }
  }

  const grainScale = S / 512;
  const grainCount = Math.round(recipe.grains.count * grainScale * grainScale);
  for (let i = 0; i < grainCount; i++) {
    const r =
      (recipe.grains.min + rand() * (recipe.grains.max - recipe.grains.min)) * grainScale;
    stampGrain(height, S, rand() * S, rand() * S, Math.max(0.8, r), recipe.grains.depth);
  }
  const pitCount = Math.round(recipe.pits.count * grainScale * grainScale);
  for (let i = 0; i < pitCount; i++) {
    const r =
      (recipe.pits.min + rand() * (recipe.pits.max - recipe.pits.min)) * grainScale;
    stampGrain(height, S, rand() * S, rand() * S, Math.max(0.8, r), recipe.pits.depth);
  }

  const normalCtx = heightToNormalCanvas(height, S, recipe.relief);

  /* --- cracks, on their own mask so they do not bleed into R/G ----- */
  const crackCtx = makeCanvas(S, S);
  crackCtx.fillStyle = "#000000";
  crackCtx.fillRect(0, 0, S, S);
  crackCtx.strokeStyle = "#ffffff";
  for (let i = 0; i < recipe.cracks.count; i++) {
    const points: Array<[number, number]> = [];
    let cx = rand() * S;
    let cy = rand() * S;
    let dir = rand() * Math.PI * 2;
    points.push([cx, cy]);
    for (let s = 0; s < recipe.cracks.segments; s++) {
      dir += (rand() - 0.5) * 1.5;
      const step = recipe.cracks.reach * grainScale * (0.5 + rand() * 0.8);
      cx += Math.cos(dir) * step;
      cy += Math.sin(dir) * step;
      points.push([cx, cy]);
    }
    // taper: a crack is widest where it started
    strokeWrapped(crackCtx, points, Math.max(0.7, recipe.cracks.width * grainScale));
  }
  const crackData = crackCtx.getImageData(0, 0, S, S).data;

  /* --- packed surface map ------------------------------------------ */
  const surfaceCtx = makeCanvas(S, S);
  const img = surfaceCtx.createImageData(S, S);
  // normalise the height range so albedo/state mapping is recipe-independent
  let hMin = Infinity;
  let hMax = -Infinity;
  for (let i = 0; i < height.length; i++) {
    const h = height[i]!;
    if (h < hMin) hMin = h;
    if (h > hMax) hMax = h;
  }
  const hSpan = Math.max(1e-4, hMax - hMin);

  const invSpan = 2 / hSpan;
  const albedoK = 0.5 * recipe.albedoFromHeight;
  const stateK = recipe.stateFromHeight * recipe.stateContrast;
  const patchK = 0.42 * recipe.stateContrast;
  for (let y = 0; y < S; y++) {
    const v = y * step;
    const row = y * S;
    for (let x = 0; x < S; x++) {
      const i = row + x;
      const u = x * step;
      const hN = (height[i]! - hMin) * invSpan - 1; // -1..1

      // R: aggregate reads back through the relief — grains catch the light
      // and sit paler, voids sit darker — plus uncorrelated mineral speckle
      const speckle = (aNoise(u * 6, v * 6) - 0.5) * 2;
      const albedo = 0.5 + hN * albedoK + speckle * recipe.albedoSpeckle;

      // G: surface state. Low ground holds dust and reads loose; high ground
      // is walked/driven smooth. A slower field on top makes the metre-scale
      // patchwork the coarse sample turns into wet/polished vs powdered.
      const patch = (sNoise(u * 0.5, v * 0.5) - 0.5) * 2;
      const state = 0.5 + patch * patchK - hN * stateK;

      const o = i * 4;
      img.data[o] = albedo <= 0 ? 0 : albedo >= 1 ? 255 : (albedo * 255) | 0;
      img.data[o + 1] = state <= 0 ? 0 : state >= 1 ? 255 : (state * 255) | 0;
      img.data[o + 2] = crackData[o]!;
      img.data[o + 3] = 255;
    }
  }
  surfaceCtx.putImageData(img, 0, 0);

  return {
    normal: toTexture(normalCtx, false, GROUND_ANISOTROPY),
    surface: toTexture(surfaceCtx, false, GROUND_ANISOTROPY),
  };
}

/** Detail maps are shared by every ground material, so build each set once. */
const detailCache = new Map<string, GroundDetailMaps>();

export function getGroundDetailMaps(
  kind: GroundDetailKind,
  seed: number,
  size: number,
): GroundDetailMaps {
  const key = `${kind}:${size}`;
  const cached = detailCache.get(key);
  if (cached) return cached;
  const maps = makeGroundDetailMaps(kind, seed, size);
  detailCache.set(key, maps);
  return maps;
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
