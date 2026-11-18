/** Metre-scaled procedural materials. No image assets or runtime fetches. */
import * as THREE from "three";
import { mulberry32, seededNoise2D } from "../lib/noise";
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
/** A repeating four-storey elevation for the distant massing. Panes, frames
 * and masonry share UVs, so the reflected sky ends at the reveal. */
export function facadeMaterial(style: "brick" | "stone" | "glass") {
  const size = 256;
  const random = mulberry32(style === "brick" ? 63 : style === "glass" ? 88 : 94);
  const layer = (base: string) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);
    return ctx;
  };
  const color = layer(
    style === "brick" ? "#856b59" : style === "stone" ? "#b9b3a6" : "#56656a",
  );
  const rough = layer("#dadada");
  const height = layer("#aaaaaa");
  const course = style === "brick" ? 4 : 16;
  const block = style === "brick" ? 12 : 64;
  if (style !== "glass") {
    for (let y = 0; y < size; y += course)
      for (let x = -block; x < size; x += block) {
        color.fillStyle = `rgba(40,31,25,${0.05 + random() * 0.17})`;
        color.fillRect(x + (((y / course) % 2) * block) / 2, y, block - 1, course - 0.8);
      }
  }
  for (let y = 0; y < size; y += 64)
    for (let x = 0; x < size; x += 64) {
      const w = style === "glass" ? 57 : 33;
      const h = style === "glass" ? 55 : 37;
      const left = x + (64 - w) / 2,
        top = y + 8;
      color.fillStyle = "#4e4c46";
      color.fillRect(left - 2, top - 2, w + 4, h + 5);
      const reflection = color.createLinearGradient(0, top, 0, top + h);
      const shade = random();
      reflection.addColorStop(0, shade < 0.25 ? "#687d82" : "#50666f");
      reflection.addColorStop(1, shade < 0.25 ? "#3f5052" : "#2e3a3c");
      color.fillStyle = reflection;
      color.fillRect(left, top, w, h);
      rough.fillStyle = "#383838";
      rough.fillRect(left, top, w, h);
      height.fillStyle = "#626262";
      height.fillRect(left, top, w, h);
      if (shade > 0.58) {
        color.fillStyle = "rgba(174,164,145,.55)";
        color.fillRect(left, top + 1, w, h * (0.2 + (shade - 0.58) * 1.4));
      }
      for (const ctx of [color, rough, height]) {
        ctx.fillStyle = ctx === color ? "#7d827f" : "#b6b6b6";
        ctx.fillRect(left + w / 2 - 0.8, top, 1.6, h);
        ctx.fillRect(left - 2, top + h, w + 4, 2);
      }
    }
  const map = (ctx: CanvasRenderingContext2D, srgb = false) => {
    const texture = new THREE.CanvasTexture(ctx.canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(0.06, 0.07);
    texture.anisotropy = 4;
    if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  };
  return new THREE.MeshStandardMaterial({
    map: map(color, true),
    roughness: 1,
    roughnessMap: map(rough),
    bumpMap: map(height),
    bumpScale: 0.035,
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
  // Small sprays share a stem and leaf angle. Gaps between them survive
  // mipmapping, while a lighter upper surface catches the sky.
  c.lineCap = "round";
  for (let twig = 0; twig < 32; twig++) {
    const angle = random() * Math.PI * 2;
    const reach = 50 + 65 * Math.sqrt(random());
    const bx = 128 + Math.cos(angle) * reach * 0.36;
    const by = 137 + Math.sin(angle) * reach * 0.3;
    const dx = Math.cos(angle) * reach * 0.73;
    const dy = Math.sin(angle) * reach * 0.66 - 7;
    c.strokeStyle = "#555339";
    c.lineWidth = 1.6;
    c.beginPath();
    c.moveTo(bx, by);
    c.lineTo(bx + dx, by + dy);
    c.stroke();
    const light = 28 + random() * 15 + (1 - (by + dy) / 256) * 9;
    for (let pair = 1; pair <= 8; pair++) {
      const t = pair / 9;
      for (const side of [-1, 1]) {
        const a = angle + side * (0.55 + random() * 0.6);
        const length = 4 + random() * 4;
        const lx = bx + dx * t + Math.cos(a) * length;
        const ly = by + dy * t + Math.sin(a) * length;
        c.fillStyle = `hsl(${77 + random() * 14} 27% ${light + random() * 8}%)`;
        c.beginPath();
        c.ellipse(lx, ly, length, length * 0.4, a, 0, Math.PI * 2);
        c.fill();
      }
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

const canopyNoise = seededNoise2D(0x6272616e);

/** Dense inner leaves, with light lost towards the underside and the centres
 * of clusters. Crown centres and radii still come from the city's tree model. */
export function crownGeometry(
  x: number,
  y: number,
  z: number,
  radius: number,
  stretch: number,
) {
  const geometry = new THREE.IcosahedronGeometry(1, 1);
  const p = geometry.getAttribute("position");
  const colors = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const nx = p.getX(i),
      ny = p.getY(i),
      nz = p.getZ(i);
    const breakup = canopyNoise(x + nx * 2.1 + ny, z + nz * 2.1 - ny);
    const r = radius * (0.7 + 0.12 * breakup);
    p.setXYZ(i, x + nx * r, y + ny * r * stretch, z + nz * r);
    const light = 0.62 + 0.21 * ny + 0.18 * breakup;
    colors.set([light * 0.52, light * 0.68, light * 0.29], i * 3);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}

export function leafSpray(
  x: number,
  y: number,
  z: number,
  radius: number,
  stretch: number,
  angle: number,
  tilt: number,
) {
  const spray = new THREE.PlaneGeometry(radius * 2.55, radius * 2.55 * stretch);
  spray.rotateX(tilt);
  spray.rotateY(angle);
  spray.translate(x, y, z);
  return spray;
}
