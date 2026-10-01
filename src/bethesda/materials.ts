/** Metre-scaled procedural materials. No image assets or runtime fetches. */
import * as THREE from "three";
import { mulberry32 } from "../lib/noise";
import { applyHardSurface } from "../gfx/greeble";

type Surface = "brick" | "paving" | "asphalt" | "limestone";
export function surfaceMaterial(kind: Surface, tint = "#ffffff") {
  const size = 512,
    random = mulberry32({ brick: 191, paving: 772, asphalt: 331, limestone: 82 }[kind]);
  const color = document.createElement("canvas"),
    relief = document.createElement("canvas"),
    rough = document.createElement("canvas");
  for (const c of [color, relief, rough]) c.width = c.height = size;
  const c = color.getContext("2d")!,
    b = relief.getContext("2d")!,
    r = rough.getContext("2d")!;
  c.fillStyle =
    kind === "brick"
      ? "#857b6b"
      : kind === "paving"
        ? "#8c867c"
        : kind === "asphalt"
          ? "#515352"
          : "#c0b6a2";
  c.fillRect(0, 0, size, size);
  b.fillStyle = "#777777";
  b.fillRect(0, 0, size, size);
  r.fillStyle = kind === "asphalt" ? "#e0e0e0" : "#cccccc";
  r.fillRect(0, 0, size, size);
  if (kind === "brick" || kind === "paving") {
    const w = kind === "brick" ? 64 : 128,
      h = kind === "brick" ? 24 : 64;
    for (let y = 0; y < size; y += h)
      for (let x = -w; x < size; x += w) {
        const offset = ((Math.floor(y / h) % 2) * w) / 2,
          value = random();
        c.fillStyle =
          kind === "brick"
            ? `hsl(${15 + value * 10} 27% ${34 + value * 13}%)`
            : `hsl(24 17% ${43 + value * 12}%)`;
        c.fillRect(x + offset + 1.5, y + 1.5, w - 3, h - 3);
        b.fillStyle = `rgb(${170 + value * 45},${170 + value * 45},${170 + value * 45})`;
        b.fillRect(x + offset + 1.5, y + 1.5, w - 3, h - 3);
        r.fillStyle = `rgb(${185 + value * 40},${185 + value * 40},${185 + value * 40})`;
        r.fillRect(x + offset + 1.5, y + 1.5, w - 3, h - 3);
      }
  }
  for (let i = 0; i < 42000; i++) {
    const x = random() * size,
      y = random() * size,
      v = random();
    c.fillStyle = v < 0.5 ? "rgba(24,22,19,.09)" : "rgba(240,237,222,.09)";
    c.fillRect(x, y, 1 + random(), 1);
    b.fillStyle = `rgba(50,50,50,${v * 0.12})`;
    b.fillRect(x, y, 1.4, 1.4);
  }
  const map = (canvas: HTMLCanvasElement, srgb = false) => {
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    // UVs are physical metres; brick width ≈ 24 cm, paver length ≈ 30 cm.
    t.repeat.setScalar(1 / (kind === "brick" ? 1.92 : kind === "paving" ? 1.2 : 3));
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  return new THREE.MeshStandardMaterial({
    color: tint,
    map: map(color, true),
    bumpMap: map(relief),
    bumpScale: kind === "brick" ? 0.012 : 0.008,
    roughnessMap: map(rough),
    roughness: 1,
  });
}
export function architecturalStone(color: string) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.86 });
  applyHardSurface(m, {
    plateScale: 2.4,
    plateAspect: 0.45,
    stagger: 0,
    seamWidth: 0.012,
    seamDarken: 0.78,
    seamRelief: 0.06,
    plateAlbedo: 0.06,
    plateRoughness: 0.08,
    streaks: 0.08,
    dust: 0.03,
    rimIntensity: 0,
    rivets: false,
  });
  return m;
}

/** Box UVs in metres, so a 100 m pavement never stretches a single paver. */
export function metricBoxUV(g: THREE.BufferGeometry) {
  const p = g.getAttribute("position"),
    n = g.getAttribute("normal"),
    uv = g.getAttribute("uv");
  for (let i = 0; i < p.count; i++) {
    if (Math.abs(n.getY(i)) > 0.5) uv.setXY(i, p.getX(i), p.getZ(i));
    else if (Math.abs(n.getX(i)) > 0.5) uv.setXY(i, p.getZ(i), p.getY(i));
    else uv.setXY(i, p.getX(i), p.getY(i));
  }
}

/** Alpha-tested foliage clusters keep a broken silhouette without fetched sprites. */
export function foliageTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const c = canvas.getContext("2d")!,
    random = mulberry32(77191);
  for (let i = 0; i < 420; i++) {
    const a = random() * Math.PI * 2,
      radius = Math.sqrt(random()) * 110;
    const x = 128 + Math.cos(a) * radius,
      y = 128 + Math.sin(a) * radius * 0.87;
    c.fillStyle = `hsl(${77 + random() * 21} ${22 + random() * 12}% ${28 + random() * 29}%)`;
    c.beginPath();
    c.ellipse(
      x,
      y,
      5 + random() * 6,
      2 + random() * 3,
      random() * Math.PI,
      0,
      Math.PI * 2,
    );
    c.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}
