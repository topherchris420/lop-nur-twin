/** Metre-scaled procedural materials. No image assets or runtime fetches. */
import * as THREE from "three";
import { mulberry32, seededNoise2D } from "../lib/noise";
import { applyHardSurface } from "../gfx/greeble";

type Surface = "brick" | "paving" | "asphalt" | "limestone" | "concrete";
export function surfaceMaterial(kind: Surface, tint = "#ffffff") {
  const size = 512,
    random = mulberry32(
      { brick: 191, paving: 772, asphalt: 331, limestone: 82, concrete: 394 }[kind],
    );
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
          : kind === "concrete"
            ? "#ada99d"
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
  if (kind === "asphalt" || kind === "concrete") {
    // Overlap stains across tile edges so the same metres can span a whole street.
    for (let patch = 0; patch < 70; patch++) {
      const cx = random() * size,
        cy = random() * size,
        radius = 7 + random() * 61;
      const tone = random() > 0.38 ? "40,37,29" : "218,210,186";
      for (const x of [cx - size, cx, cx + size])
        for (const y of [cy - size, cy, cy + size]) {
          if (x + radius < 0 || x - radius > size || y + radius < 0 || y - radius > size)
            continue;
          const stain = c.createRadialGradient(x, y, 0, x, y, radius);
          stain.addColorStop(0, `rgba(${tone},0.19)`);
          stain.addColorStop(1, `rgba(${tone},0)`);
          c.fillStyle = stain;
          c.fillRect(x - radius, y - radius, radius * 2, radius * 2);
        }
    }
    if (kind === "concrete") {
      // The recessed expansion joints sit in the same texels in colour and relief.
      c.fillStyle = "#736f63";
      b.fillStyle = "#303030";
      for (const ctx of [c, b]) {
        ctx.fillRect(0, 0, 2, size);
        ctx.fillRect(0, 0, size, 2);
      }
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

/** Colour and shallow relief share the same seams, so bark catches raking
 * light on the raised side of a plate. Cylinder UVs wrap once around a stem. */
export function barkMaterial() {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const c = canvas.getContext("2d")!;
  const pixels = c.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    const v = (2 * Math.PI * y) / size;
    for (let x = 0; x < size; x++) {
      const u = (2 * Math.PI * x) / size;
      const warp = 0.65 * Math.sin(v + 3 * u) + 0.38 * Math.sin(2 * v - 2 * u);
      const cut = Math.pow(0.5 + 0.5 * Math.cos(15 * u + warp), 7);
      const grain = Math.cos(37 * u + 3 * warp) * 3 + Math.sin(4 * u - v) * 9;
      const light = grain - cut * 32;
      const i = (y * size + x) * 4;
      pixels.data[i] = 109 + light;
      pixels.data[i + 1] = 98 + light;
      pixels.data[i + 2] = 82 + light;
      pixels.data[i + 3] = 255;
    }
  }
  c.putImageData(pixels, 0, 0);
  const map = new THREE.CanvasTexture(canvas);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  return new THREE.MeshStandardMaterial({
    map,
    bumpMap: map,
    bumpScale: 0.025,
    roughness: 0.94,
  });
}

/** Alpha-tested foliage clusters keep a broken silhouette without fetched sprites. */
export function foliageTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const c = canvas.getContext("2d")!,
    random = mulberry32(77191);
  // One branch tip, from the bottom of the card to its crown. Side shoots
  // share that stem; the sky shows through between the sprays.
  c.lineCap = "round";
  c.strokeStyle = "#5c5841";
  c.lineWidth = 3.2;
  c.beginPath();
  c.moveTo(119, 252);
  c.quadraticCurveTo(149, 163, 127, 24);
  c.stroke();
  for (let tier = 0; tier < 9; tier++) {
    const t = (tier + 0.45) / 9;
    const rootX = 119 + 42 * t - 34 * t * t,
      rootY = 240 - 211 * t;
    for (const side of [-1, 1]) {
      const span = (48 + 58 * Math.sin(Math.PI * t)) * (0.76 + random() * 0.24);
      const rise = 18 + 26 * random();
      c.lineWidth = 1.8 - 0.6 * t;
      c.strokeStyle = "#625e42";
      c.beginPath();
      c.moveTo(rootX, rootY);
      c.quadraticCurveTo(
        rootX + side * span * 0.56,
        rootY - 4,
        rootX + side * span,
        rootY - rise,
      );
      c.stroke();
      const hue = 79 + 21 * random(),
        light = 24 + 13 * random() + 9 * t;
      for (let pair = 1; pair <= 6; pair++) {
        const u = pair / 7;
        const lx = rootX + side * span * u;
        const ly = rootY - 8 * (1 - u) * u - rise * u * u;
        for (const face of [-1, 1]) {
          const length = (11 + 7 * random()) * (1 - 0.32 * u);
          c.save();
          c.translate(lx, ly);
          c.rotate(Math.atan2(-0.35 - u * 0.4, side) + face * (0.65 + 0.37 * random()));
          c.fillStyle = `hsl(${hue} 35% ${light}%)`;
          c.beginPath();
          c.moveTo(0, 0);
          c.quadraticCurveTo(length * 0.53, -length * 0.49, length, -0.7);
          c.quadraticCurveTo(length * 0.51, length * 0.4, 0, 0);
          c.fill();
          c.fillStyle = `hsl(${hue - 8} 38% ${light + 10}%)`;
          c.beginPath();
          c.moveTo(0, 0);
          c.quadraticCurveTo(length * 0.53, -length * 0.49, length, -0.7);
          c.closePath();
          c.fill();
          c.restore();
        }
      }
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** Layer the same branch sprays across the crown. The cutout between twigs
 * survives around its silhouette, with progressively darker leaves behind. */
export function canopyTexture(spray: THREE.CanvasTexture) {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const random = mulberry32(0x63726f77);
  const tile = document.createElement("canvas");
  tile.width = tile.height = size;
  const layer = tile.getContext("2d")!;
  // Reuse the branch centres across depth layers. Independent layers filled
  // every gap with leaves, turning the shell into an opaque green ellipsoid.
  const boughs = Array.from({ length: 12 }, () => ({
    x: random() * size,
    y: random() * size,
    span: 90 + 52 * random(),
  }));
  for (const shade of [0.5, 0.73, 1]) {
    // Tint once per layer. Atlas offsets and orientations wrap without a seam.
    layer.clearRect(0, 0, size, size);
    layer.drawImage(spray.image, 0, 0);
    layer.globalCompositeOperation = "source-atop";
    layer.fillStyle = `rgba(13,28,17,${1 - shade})`;
    layer.fillRect(0, 0, size, size);
    layer.globalCompositeOperation = "source-over";
    for (const bough of boughs) {
      const x = bough.x + (random() - 0.5) * 32,
        y = bough.y + (random() - 0.5) * 32;
      const width = bough.span * (0.92 + 0.15 * random()),
        angle = random() * Math.PI * 2;
      for (const dx of [-size, 0, size])
        for (const dy of [-size, 0, size]) {
          const px = x + dx,
            py = y + dy;
          if (px < -width || py < -width || px > size + width || py > size + width)
            continue;
          ctx.save();
          ctx.translate(px, py);
          ctx.rotate(angle);
          ctx.drawImage(tile, -width / 2, -width / 2, width, width);
          ctx.restore();
        }
    }
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(2, 1.5);
  map.anisotropy = 4;
  return map;
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
  const uv = geometry.getAttribute("uv");
  const offset = canopyNoise(x, z);
  for (let i = 0; i < p.count; i++) {
    const nx = p.getX(i),
      ny = p.getY(i),
      nz = p.getZ(i);
    const breakup = canopyNoise(x + nx * 2.1 + ny, z + nz * 2.1 - ny);
    // The same ellipsoid is a landing surface in BethesdaFlyWorld.
    p.setXYZ(i, x + nx * radius, y + ny * radius * stretch, z + nz * radius);
    const sky = THREE.MathUtils.smoothstep(ny + breakup * 0.38, -0.85, 0.85);
    colors.set([0.48 + sky * 0.61, 0.64 + sky * 0.44, 0.61 + sky * 0.25], i * 3);
    uv.setXY(i, uv.getX(i) + offset, uv.getY(i) + offset);
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
  // Three small outward-growing sprays describe the edge instead of two
  // intersecting sheets through the centre. All are merged into the same
  // street tile by the existing builder.
  const vertices: number[] = [],
    uv: number[] = [],
    indices: number[] = [];
  const phase = canopyNoise(x * 0.37, z * 0.37);
  for (let k = 0; k < 3; k++) {
    const heading = angle + phase + k * ((Math.PI * 2) / 3);
    const dx = Math.sin(heading),
      dz = Math.cos(heading);
    const level = 0.4 * Math.sin(heading * 2 + phase) + tilt * 0.26;
    const first = vertices.length / 3;
    for (let end = 0; end <= 1; end++) {
      for (let side = -1; side <= 1; side++) {
        const reach = (0.25 + 0.91 * end - 0.19 * Math.abs(side)) * radius;
        const spread = side * radius * 0.54;
        vertices.push(
          x + dx * reach + dz * spread,
          y + (level - 0.36 + end * (0.64 + 0.34 * tilt)) * radius * stretch,
          z + dz * reach - dx * spread,
        );
        uv.push((side + 1) * 0.5, end);
      }
    }
    for (const j of [0, 1, 3, 1, 4, 3, 1, 2, 4, 2, 5, 4]) indices.push(first + j);
  }
  const spray = new THREE.BufferGeometry();
  spray.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  spray.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  spray.setIndex(indices);
  spray.computeVertexNormals();
  return spray;
}

/** Taper a limb between the existing trunk and crown centres. */
export function treeLimb(
  x: number,
  z: number,
  y: number,
  crownX: number,
  crownZ: number,
  crownY: number,
) {
  const direction = new THREE.Vector3(crownX - x, crownY - y, crownZ - z);
  const limb = new THREE.CylinderGeometry(0.037, 0.11, direction.length(), 5, 1, true);
  limb.applyQuaternion(
    new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      direction.normalize(),
    ),
  );
  limb.translate((x + crownX) / 2, (y + crownY) / 2, (z + crownZ) / 2);
  return limb;
}
