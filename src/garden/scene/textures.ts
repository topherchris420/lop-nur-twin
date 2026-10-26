/**
 * Every texture in the garden is drawn here, at load time, on a canvas: no
 * image files to fetch, nothing outside the page's own origin.
 *
 * - `clayDetail`: one tiling texture of the marks hands and tools leave in
 *   plasticine (fingerprint ridges, thumb smears, the drag of a loop tool,
 *   small pits), sampled tri-planarly by every clay material.
 * - The **decal atlas**: one canvas holding the cut-out surfaces (a maple
 *   leaf with its veins, an aster leaf, a ray petal, a fallen leaf), each in
 *   its own cell, so the garden binds one texture for all of them.
 * - `boardGrain`: the cedar grain scored into the fence boards, tall and
 *   narrow like the boards themselves.
 * - `paintedSky`: the cloud backdrop behind the garden, painted soft as
 *   a scenic artist would, tinted by the hour in the shader.
 *
 * Patterns are seeded, so the garden is the same garden on every visit.
 */
import * as THREE from "three";
import { mulberry32 } from "../../lib/noise.js";

type Ctx = CanvasRenderingContext2D;

function canvas(size: number): { c: HTMLCanvasElement; g: Ctx } {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d", { willReadFrequently: true });
  if (!g) throw new Error("2D canvas unavailable");
  return { c, g };
}

/** Tileable value noise on an n×n lattice, sampled at (x, y) in lattice units. */
function tileNoise(seed: number, n: number) {
  const r = mulberry32(seed);
  const v = Array.from({ length: n * n }, () => r());
  const at = (i: number, j: number) => v[(((j % n) + n) % n) * n + (((i % n) + n) % n)]!;
  return (x: number, y: number) => {
    const i = Math.floor(x),
      j = Math.floor(y);
    const fx = x - i,
      fy = y - j;
    const sx = fx * fx * (3 - 2 * fx),
      sy = fy * fy * (3 - 2 * fy);
    const a = at(i, j) + (at(i + 1, j) - at(i, j)) * sx;
    const b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * sx;
    return a + (b - a) * sy;
  };
}

/** Draws `draw` at every wrapped copy needed for a seamless tile. */
function wrapped(
  size: number,
  x: number,
  y: number,
  r: number,
  draw: (x: number, y: number) => void,
) {
  for (const dx of [-size, 0, size])
    for (const dy of [-size, 0, size]) {
      const px = x + dx,
        py = y + dy;
      if (px + r < 0 || px - r > size || py + r < 0 || py - r > size) continue;
      draw(px, py);
    }
}

/**
 * The clay surface texture: R height (ridges, smears, tool drags, pits),
 * G slow colour variation (thumb-warmed patches, a little dirt), B fine grit.
 * Tiles seamlessly; mipmapped; sampled at each object's own sculpting scale.
 */
export function clayDetail(size: number, seed = 0xc1a7): THREE.CanvasTexture {
  const { c, g } = canvas(size);
  const rand = mulberry32(seed);
  // Height starts mid-grey; marks press in (darker) and push up (lighter).
  g.fillStyle = "rgb(128,128,128)";
  g.fillRect(0, 0, size, size);
  g.lineCap = "round";
  // Fingerprints: sets of concentric, slightly irregular ridges, here and
  // there (a sculptor's prints are where the clay was last pressed, not everywhere).
  const prints = Math.max(2, Math.round(size / 230));
  for (let k = 0; k < prints; k++) {
    const x = rand() * size,
      y = rand() * size;
    const rx = size * (0.07 + rand() * 0.05),
      ry = rx * (0.6 + rand() * 0.3);
    const rot = rand() * Math.PI;
    const ridges = 9 + Math.floor(rand() * 5);
    const fade = 0.22 + rand() * 0.3;
    wrapped(size, x, y, rx * 1.2, (px, py) => {
      g.save();
      g.translate(px, py);
      g.rotate(rot);
      for (let i = 1; i <= ridges; i++) {
        const s = i / ridges;
        g.strokeStyle = `rgba(${i % 2 ? 160 : 100},${i % 2 ? 160 : 100},${i % 2 ? 160 : 100},${fade * (1 - s * 0.7)})`;
        g.lineWidth = Math.max(1, size / 512) * (1.1 + rand() * 0.5);
        g.beginPath();
        // A whorl breaks open on one side, like a real print.
        const gap = 0.3 + rand() * 0.6;
        g.ellipse(0, 0, rx * s, ry * s, 0, gap, Math.PI * 2 - gap * 0.3);
        g.stroke();
      }
      g.restore();
    });
  }
  // Tool drags: long shallow grooves with a raised lip.
  for (let k = 0; k < size / 40; k++) {
    const x = rand() * size,
      y = rand() * size,
      a = rand() * Math.PI,
      len = size * (0.08 + rand() * 0.18);
    wrapped(size, x, y, len, (px, py) => {
      const ex = px + Math.cos(a) * len,
        ey = py + Math.sin(a) * len;
      g.strokeStyle = "rgba(92,92,92,0.35)";
      g.lineWidth = size / 300;
      g.beginPath();
      g.moveTo(px, py);
      g.quadraticCurveTo(
        (px + ex) / 2 + (rand() - 0.5) * 12,
        (py + ey) / 2 + (rand() - 0.5) * 12,
        ex,
        ey,
      );
      g.stroke();
      g.strokeStyle = "rgba(170,170,170,0.22)";
      g.lineWidth = size / 900;
      g.beginPath();
      g.moveTo(px + 2, py + 2);
      g.quadraticCurveTo((px + ex) / 2 + 2, (py + ey) / 2 + 2, ex + 2, ey + 2);
      g.stroke();
    });
  }
  // Small pits and crumbs.
  for (let k = 0; k < size * 1.5; k++) {
    const x = rand() * size,
      y = rand() * size,
      r = (0.4 + rand() * 1.6) * (size / 512);
    g.fillStyle = rand() < 0.75 ? "rgba(70,70,70,0.45)" : "rgba(190,190,190,0.4)";
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  // Soften into clay rather than engraving.
  g.filter = `blur(${Math.max(0.6, size / 900)}px)`;
  g.drawImage(c, 0, 0);
  g.filter = "none";
  const img = g.getImageData(0, 0, size, size);
  const d = img.data;
  const slow = tileNoise(seed + 1, 6),
    mid = tileNoise(seed + 2, 24),
    grit = tileNoise(seed + 3, 128);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const u = x / size,
        v = y / size;
      // Broad undulation adds to the marks: no surface is flat.
      const h = d[i]! + (mid(u * 24, v * 24) - 0.5) * 34;
      d[i] = Math.max(0, Math.min(255, h));
      d[i + 1] = Math.round(
        255 * (0.55 * slow(u * 6, v * 6) + 0.45 * mid(u * 24 + 7, v * 24 + 3)),
      );
      d[i + 2] = Math.round(255 * grit(u * 128, v * 128));
      d[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

// ------------------------------------------------------------------- atlas

/** Cells of the decal atlas, in UV space: [u0, v0, u1, v1]. */
export type Cell = [number, number, number, number];
export interface DecalAtlas {
  /** RGB colour (sRGB), A alpha cut-out. */
  color: THREE.CanvasTexture;
  /** R height (veins, grain), G thickness (translucency), B unused. */
  relief: THREE.CanvasTexture;
  cells: {
    maple: Cell;
    asterLeaf: Cell;
    petal: Cell;
    fallen: Cell;
  };
  /** The maple leaf's outline in its cell, 0…1 coordinates, base at (0.5, 0.95). */
  mapleOutline: [number, number][];
}

const CELLS = {
  maple: [0, 0, 0.5, 0.5] as Cell,
  asterLeaf: [0.5, 0, 0.75, 0.5] as Cell,
  petal: [0.75, 0, 0.875, 0.25] as Cell,
  fallen: [0, 0.5, 0.5, 1] as Cell,
};

/** A maple leaf: five lobes, toothed, in a unit square with its stalk at the bottom. */
export function mapleOutline(seed: number): [number, number][] {
  const r = mulberry32(seed);
  const pts: [number, number][] = [];
  // Lobe tips at these angles (from up, clockwise), with their lengths.
  const lobes = [
    [-2.2, 0.28],
    [-1.25, 0.42],
    [0, 0.47],
    [1.25, 0.42],
    [2.2, 0.28],
  ];
  const cx = 0.5,
    cy = 0.56;
  const n = 220;
  for (let i = 0; i < n; i++) {
    const a = -Math.PI + (i / n) * 2 * Math.PI;
    let rad = 0.1;
    for (const [la, ll] of lobes) {
      const d = Math.abs(a - la!);
      rad = Math.max(rad, ll! * Math.exp(-(d * d) / 0.11));
    }
    // Teeth along the margin, and the notch at the stalk.
    rad *= 1 + 0.06 * Math.sin(a * 30 + r() * 0.4) * (rad > 0.18 ? 1 : 0);
    if (Math.abs(Math.abs(a) - Math.PI) < 0.35)
      rad *= 0.35 + Math.abs(Math.abs(a) - Math.PI) * 1.8;
    pts.push([cx + Math.sin(a) * rad, cy - Math.cos(a) * rad]);
  }
  return pts;
}

/**
 * The decal atlas. Every surface is drawn as a sculptor would press it:
 * veins are grooves (dark in height), margins thicken slightly.
 */
export function decalAtlas(size: number, seed = 0x1eaf): DecalAtlas {
  const color = canvas(size),
    relief = canvas(size);
  const C = color.g,
    R = relief.g;
  R.fillStyle = "rgb(128,0,0)";
  R.fillRect(0, 0, size, size);
  const rand = mulberry32(seed);
  const cellRect = (cell: Cell) => ({
    x: cell[0] * size,
    y: cell[1] * size,
    w: (cell[2] - cell[0]) * size,
    h: (cell[3] - cell[1]) * size,
  });

  // --- Maple leaf: palmate veins from the stalk to each lobe, with branching.
  const outline = mapleOutline(seed);
  const leaf = (cell: Cell, base: string, edge: string) => {
    const b = cellRect(cell);
    const P = (p: [number, number]) => [b.x + p[0] * b.w, b.y + p[1] * b.h] as const;
    for (const g of [C, R]) {
      g.save();
      g.beginPath();
      outline.forEach((p, i) => (i ? g.lineTo(...P(p)) : g.moveTo(...P(p))));
      g.closePath();
      g.clip();
    }
    const grad = C.createRadialGradient(
      ...P([0.5, 0.6]),
      0,
      ...P([0.5, 0.6]),
      b.w * 0.55,
    );
    grad.addColorStop(0, base);
    grad.addColorStop(1, edge);
    C.fillStyle = grad;
    C.fillRect(b.x, b.y, b.w, b.h);
    // Mottling: autumn arrives in patches.
    for (let k = 0; k < 60; k++) {
      C.fillStyle = `rgba(${150 + rand() * 60},${60 + rand() * 50},${20 + rand() * 20},${0.05 + rand() * 0.1})`;
      C.beginPath();
      C.arc(
        b.x + rand() * b.w,
        b.y + rand() * b.h,
        b.w * (0.02 + rand() * 0.07),
        0,
        Math.PI * 2,
      );
      C.fill();
    }
    R.fillStyle = "rgb(138,190,0)";
    R.fillRect(b.x, b.y, b.w, b.h);
    const stalk = P([0.5, 0.62]);
    const tips: [number, number][] = [
      [0.2, 0.42],
      [0.13, 0.27],
      [0.5, 0.1],
      [0.87, 0.27],
      [0.8, 0.42],
    ];
    for (const tip of tips) {
      const t = P(tip);
      for (const [g, style, w] of [
        [R, "rgba(70,190,0,1)", b.w * 0.012],
        [C, "rgba(220,200,140,0.35)", b.w * 0.006],
      ] as const) {
        g.strokeStyle = style;
        g.lineWidth = w;
        g.beginPath();
        g.moveTo(...stalk);
        g.lineTo(...t);
        g.stroke();
        // Side veins, alternating, toward the margin.
        for (let s = 0.2; s < 0.9; s += 0.14) {
          const mx = stalk[0] + (t[0] - stalk[0]) * s,
            my = stalk[1] + (t[1] - stalk[1]) * s;
          const ang = Math.atan2(t[1] - stalk[1], t[0] - stalk[0]);
          for (const side of [-1, 1]) {
            const a2 = ang + side * (0.75 + rand() * 0.2);
            const len = b.w * 0.07 * (1 - s * 0.6);
            g.lineWidth = w * 0.45;
            g.beginPath();
            g.moveTo(mx, my);
            g.lineTo(mx + Math.cos(a2) * len, my + Math.sin(a2) * len);
            g.stroke();
          }
        }
      }
    }
    // Margin: a little thicker, a little darker.
    R.strokeStyle = "rgba(170,255,0,0.8)";
    R.lineWidth = b.w * 0.012;
    R.beginPath();
    outline.forEach((p, i) => (i ? R.lineTo(...P(p)) : R.moveTo(...P(p))));
    R.closePath();
    R.stroke();
    C.restore();
    R.restore();
  };
  leaf(CELLS.maple, "#9a8a3c", "#b5532a");
  leaf(CELLS.fallen, "#a5652c", "#6e3b1c");

  // --- Aster leaf: lance-shaped, a midrib and faint pinnate veins.
  {
    const b = cellRect(CELLS.asterLeaf);
    const path = (g: Ctx) => {
      g.beginPath();
      g.moveTo(b.x + b.w * 0.5, b.y + b.h * 0.98);
      g.bezierCurveTo(
        b.x + b.w * 0.05,
        b.y + b.h * 0.6,
        b.x + b.w * 0.25,
        b.y + b.h * 0.15,
        b.x + b.w * 0.5,
        b.y + b.h * 0.02,
      );
      g.bezierCurveTo(
        b.x + b.w * 0.75,
        b.y + b.h * 0.15,
        b.x + b.w * 0.95,
        b.y + b.h * 0.6,
        b.x + b.w * 0.5,
        b.y + b.h * 0.98,
      );
      g.closePath();
    };
    C.save();
    path(C);
    C.clip();
    const grad = C.createLinearGradient(b.x, b.y + b.h, b.x, b.y);
    grad.addColorStop(0, "#4c5a2c");
    grad.addColorStop(1, "#6f7a3a");
    C.fillStyle = grad;
    C.fillRect(b.x, b.y, b.w, b.h);
    C.restore();
    R.save();
    path(R);
    R.clip();
    R.fillStyle = "rgb(140,200,0)";
    R.fillRect(b.x, b.y, b.w, b.h);
    R.strokeStyle = "rgb(80,200,0)";
    R.lineWidth = b.w * 0.03;
    R.beginPath();
    R.moveTo(b.x + b.w * 0.5, b.y + b.h * 0.98);
    R.lineTo(b.x + b.w * 0.5, b.y + b.h * 0.05);
    R.stroke();
    for (let s = 0.15; s < 0.9; s += 0.09)
      for (const side of [-1, 1]) {
        R.lineWidth = b.w * 0.012;
        R.beginPath();
        R.moveTo(b.x + b.w * 0.5, b.y + b.h * (1 - s));
        R.lineTo(b.x + b.w * (0.5 + side * 0.3), b.y + b.h * (1 - s - 0.12));
        R.stroke();
      }
    R.restore();
  }

  // --- Petal: an aster's ray, a strap with a narrow claw at the base (the
  // bottom of the cell) and a blunt, notched tip; violet paling toward the
  // base, two grooves. Filling most of its cell, it keeps its alpha above the
  // cut in distant mip levels, so far flowers do not lose their rays.
  {
    const b = cellRect(CELLS.petal);
    const P = (x: number, y: number): [number, number] => [b.x + b.w * x, b.y + b.h * y];
    const path = (g: Ctx) => {
      g.beginPath();
      g.moveTo(...P(0.36, 0.995));
      g.bezierCurveTo(...P(0.1, 0.94), ...P(0.07, 0.86), ...P(0.07, 0.78));
      g.lineTo(...P(0.06, 0.1));
      g.bezierCurveTo(...P(0.07, 0.03), ...P(0.3, 0.0), ...P(0.42, 0.02));
      g.quadraticCurveTo(...P(0.5, 0.06), ...P(0.58, 0.02));
      g.bezierCurveTo(...P(0.7, 0.0), ...P(0.93, 0.03), ...P(0.94, 0.1));
      g.lineTo(...P(0.93, 0.78));
      g.bezierCurveTo(...P(0.93, 0.86), ...P(0.9, 0.94), ...P(0.64, 0.995));
      g.closePath();
    };
    C.save();
    path(C);
    C.clip();
    const grad = C.createLinearGradient(b.x, b.y + b.h, b.x, b.y);
    grad.addColorStop(0, "#c2a8db");
    grad.addColorStop(0.25, "#a68acb");
    grad.addColorStop(1, "#7d5dac");
    C.fillStyle = grad;
    C.fillRect(b.x, b.y, b.w, b.h);
    C.restore();
    R.save();
    path(R);
    R.clip();
    R.fillStyle = "rgb(140,120,0)";
    R.fillRect(b.x, b.y, b.w, b.h);
    R.strokeStyle = "rgb(105,120,0)";
    R.lineWidth = b.w * 0.05;
    for (const x of [0.4, 0.6]) {
      R.beginPath();
      R.moveTo(b.x + b.w * 0.5, b.y + b.h * 0.95);
      R.lineTo(b.x + b.w * x, b.y + b.h * 0.12);
      R.stroke();
    }
    R.restore();
  }

  const tex = (c: HTMLCanvasElement, srgb: boolean) => {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 4;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    // Canvas row 0 is the top; keep UV v=0 at the top to match the cells.
    t.flipY = false;
    return t;
  };
  return {
    color: tex(color.c, true),
    relief: tex(relief.c, false),
    cells: CELLS,
    mapleOutline: outline,
  };
}

/** Maps a unit-square UV into an atlas cell. */
export const inCell = (cell: Cell, u: number, v: number): [number, number] => [
  cell[0] + (cell[2] - cell[0]) * u,
  cell[1] + (cell[3] - cell[1]) * v,
];

/**
 * Cedar grain for the fence boards: long wavy lines pressed with a tool,
 * a few knots with the grain swirling round them, and grey weathering
 * streaks running down from the tops where rain falls. Colour (sRGB) and
 * relief (R) canvases, one board tall; boards sample it at different
 * offsets so no two match.
 */
export function boardGrain(
  width: number,
  seed = 0xced4,
): { color: THREE.CanvasTexture; relief: THREE.CanvasTexture } {
  const height = width * 8;
  const mk = () => {
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    const g = c.getContext("2d");
    if (!g) throw new Error("2D canvas unavailable");
    return { c, g };
  };
  const col = mk(),
    rel = mk();
  const r = mulberry32(seed);
  col.g.fillStyle = "#94643f";
  col.g.fillRect(0, 0, width, height);
  rel.g.fillStyle = "rgb(128,128,128)";
  rel.g.fillRect(0, 0, width, height);
  const knots = Array.from({ length: 5 }, () => ({
    x: width * (0.2 + 0.6 * r()),
    y: height * r(),
    s: width * (0.05 + 0.06 * r()),
  }));
  const lines = Math.round(width / 5);
  for (let i = 0; i < lines; i++) {
    const x0 = (i / lines) * width + r() * 3;
    const shade = 0.75 + 0.5 * r();
    for (const [g, style, lw] of [
      [
        col.g,
        `rgba(${Math.round(80 * shade)},${Math.round(46 * shade)},${Math.round(28 * shade)},0.5)`,
        0.8 + r() * 1.6,
      ],
      [rel.g, "rgba(70,70,70,0.75)", 1.4],
    ] as const) {
      g.strokeStyle = style;
      g.lineWidth = lw;
      g.beginPath();
      for (let y = 0; y <= height; y += 6) {
        let x = x0 + Math.sin(y * 0.004 + i) * 2.5;
        for (const k of knots) {
          const d = Math.hypot(x - k.x, (y - k.y) * 0.35);
          if (d < k.s * 4) x += Math.sign(x - k.x || 1) * (k.s * 4 - d) * 0.45;
        }
        if (y === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }
  }
  for (const k of knots) {
    col.g.fillStyle = "rgba(58,30,18,0.85)";
    col.g.beginPath();
    col.g.ellipse(k.x, k.y, k.s, k.s * 1.6, 0, 0, Math.PI * 2);
    col.g.fill();
    rel.g.fillStyle = "rgba(60,60,60,0.9)";
    rel.g.beginPath();
    rel.g.ellipse(k.x, k.y, k.s * 0.8, k.s * 1.3, 0, 0, Math.PI * 2);
    rel.g.fill();
  }
  // Weathering: silver-grey streaks from the top, where rain runs off.
  for (let i = 0; i < width / 6; i++) {
    const x = r() * width,
      len = height * (0.08 + 0.3 * r());
    const grad = col.g.createLinearGradient(0, 0, 0, len);
    grad.addColorStop(0, "rgba(150,140,128,0.55)");
    grad.addColorStop(1, "rgba(150,140,128,0)");
    col.g.fillStyle = grad;
    col.g.fillRect(x, 0, 2 + r() * 6, len);
  }
  const tex = (c: HTMLCanvasElement, srgb: boolean) => {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    return t;
  };
  return { color: tex(col.c, true), relief: tex(rel.c, false) };
}

/**
 * The painted sky: soft cumulus brushed on a wide canvas, white on clear
 * (alpha carries the cloud, so the shader tints sky and cloud by the hour).
 * Wraps horizontally around the backdrop.
 */
export function paintedSky(width: number, seed = 0x5c1e): THREE.CanvasTexture {
  const height = width / 4;
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const g = c.getContext("2d");
  if (!g) throw new Error("2D canvas unavailable");
  const r = mulberry32(seed);
  g.clearRect(0, 0, width, height);
  // Clouds sit in a band above the horizon, smaller and flatter toward it.
  for (let k = 0; k < 26; k++) {
    const cx = r() * width,
      band = r();
    const cy = height * (0.35 + 0.45 * band);
    const scale = width * (0.02 + 0.035 * (1 - band)) * (0.7 + 0.6 * r());
    const puffs = 6 + Math.floor(r() * 9);
    for (let p = 0; p < puffs; p++) {
      const px = cx + (r() - 0.5) * scale * 4,
        py = cy - Math.abs(r() - 0.3) * scale * 1.2;
      const pr = scale * (0.5 + 0.8 * r());
      for (const dx of [-width, 0, width]) {
        const grad = g.createRadialGradient(px + dx, py, 0, px + dx, py, pr);
        grad.addColorStop(0, "rgba(255,255,255,0.55)");
        grad.addColorStop(0.6, "rgba(255,255,255,0.25)");
        grad.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = grad;
        g.beginPath();
        g.ellipse(px + dx, py, pr, pr * 0.62, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}
