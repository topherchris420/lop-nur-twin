import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { mulberry32 } from "../lib/noise";
import {
  buildings,
  buildingAt,
  crossings,
  distance,
  lerp,
  metro,
  parks,
  pathWays,
  places,
  roadWays,
  signalPoints,
  type Point,
} from "./model";
function texture(style: "brick" | "stone" | "glass") {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const c = canvas.getContext("2d")!;
  const rng = mulberry32(style === "brick" ? 63 : style === "glass" ? 88 : 94);
  c.fillStyle = style === "brick" ? "#846757" : style === "stone" ? "#b5afa0" : "#6b7b82";
  c.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 8)
    for (let x = 0; x < 256; x += 22) {
      c.fillStyle = `rgba(25,25,25,${0.06 + rng() * 0.14})`;
      c.fillRect(x + (y % 16 ? 11 : 0), y, 21, 7);
    }
  for (let y = 18; y < 256; y += 64)
    for (let x = 16; x < 256; x += 64) {
      c.fillStyle = "#3c4649";
      c.fillRect(x - 3, y - 3, 38, 43);
      c.fillStyle = rng() < 0.13 ? "#afa88a" : rng() < 0.5 ? "#49636d" : "#647d86";
      c.fillRect(x, y, 32, 36);
      c.fillStyle = "#a5a79e";
      c.fillRect(x + 15, y, 2, 36);
      c.fillRect(x, y + 18, 32, 2);
      c.fillStyle = "rgba(15,25,30,.25)";
      c.fillRect(x, y, 32, 8);
    }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(0.06, 0.07);
  map.anisotropy = 4;
  return map;
}
function sign(text: string, bg = "#244b4b") {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const x = c.getContext("2d")!;
  x.fillStyle = bg;
  x.fillRect(0, 0, 512, 128);
  x.strokeStyle = "#c9d9cd";
  x.lineWidth = 3;
  x.strokeRect(5, 5, 502, 118);
  x.fillStyle = "#f4f0df";
  x.font = "bold 30px sans-serif";
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.fillText(text.slice(0, 38), 256, 64, 482);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
export function createCityGeometry() {
  const group = new THREE.Group();
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const rng = mulberry32(393977);
  const material = (color: string, roughness = 1) =>
    new THREE.MeshStandardMaterial({ color, roughness });
  const asphalt = material("#535b5b"),
    concrete = material("#b1ada0"),
    paint = material("#e4dfc2"),
    grass = material("#647c55"),
    roof = material("#827e73"),
    metal = material("#38413e", 0.7),
    trunk = material("#685043"),
    leaf = material("#537452");
  const brick = new THREE.MeshStandardMaterial({
      map: texture("brick"),
      roughness: 0.94,
    }),
    stone = new THREE.MeshStandardMaterial({ map: texture("stone"), roughness: 0.88 }),
    glass = new THREE.MeshStandardMaterial({ map: texture("glass"), roughness: 0.48 });
  function add(g: THREE.BufferGeometry, m: THREE.Material) {
    if (g.index) {
      const old = g;
      g = g.toNonIndexed();
      old.dispose();
    }
    for (const key of Object.keys(g.attributes))
      if (!["position", "normal", "uv"].includes(key)) g.deleteAttribute(key);
    let list = buckets.get(m);
    if (!list) {
      list = [];
      buckets.set(m, list);
    }
    list.push(g);
  }
  function box(
    p: Point,
    y: number,
    w: number,
    h: number,
    d: number,
    m: THREE.Material,
    angle = 0,
  ) {
    const g = new THREE.BoxGeometry(w, h, d);
    g.rotateY(angle);
    g.translate(p.x, y, p.z);
    add(g, m);
  }
  function strip(a: Point, b: Point, width: number, y: number, m: THREE.Material) {
    box(
      lerp(a, b, 0.5),
      y,
      width,
      0.055,
      distance(a, b),
      m,
      Math.atan2(b.x - a.x, b.z - a.z),
    );
  }
  function polygon(ring: Point[], y: number, m: THREE.Material) {
    const shape = new THREE.Shape(ring.map((p) => new THREE.Vector2(p.x, -p.z)));
    const g = new THREE.ShapeGeometry(shape);
    g.rotateX(-Math.PI / 2);
    g.translate(0, y, 0);
    add(g, m);
  }
  for (const p of parks) polygon(p.ring, 0.04, grass);
  for (const w of roadWays)
    for (let i = 1; i < w.points.length; i++) {
      const a = w.points[i - 1]!,
        b = w.points[i]!;
      strip(a, b, w.width + 2, 0.06, concrete);
      strip(a, b, w.width, 0.1, asphalt);
      if (w.width > 7 && distance(a, b) > 10) {
        const d = distance(a, b);
        for (let t = 2; t < d - 4; t += 12)
          strip(
            lerp(a, b, t / d),
            lerp(a, b, Math.min(1, (t + 4) / d)),
            0.13,
            0.14,
            paint,
          );
      }
    }
  for (const w of pathWays)
    for (let i = 1; i < w.points.length; i++)
      if (!w.crossing) strip(w.points[i - 1]!, w.points[i]!, w.width, 0.13, concrete);
  for (const p of crossings) {
    let best: { a: Point; b: Point; width: number } | undefined,
      near = Infinity;
    for (const w of roadWays)
      for (let i = 1; i < w.points.length; i++) {
        const a = w.points[i - 1]!,
          b = w.points[i]!,
          q = distance(p.point, lerp(a, b, 0.5));
        if (q < near) {
          near = q;
          best = { a, b, width: w.width };
        }
      }
    if (!best || near > 30) continue;
    const angle = Math.atan2(best.b.x - best.a.x, best.b.z - best.a.z);
    for (let t = -best.width / 2 + 1; t < best.width / 2; t += 1.3)
      box(
        { x: p.point.x + Math.cos(angle) * t, z: p.point.z - Math.sin(angle) * t },
        0.18,
        0.65,
        0.025,
        2.8,
        paint,
        angle,
      );
  }
  for (const b of buildings) {
    const shape = new THREE.Shape(b.ring.map((p) => new THREE.Vector2(p.x, -p.z)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: b.height, bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    const facade =
      b.height > 28
        ? glass
        : b.type === "house" || b.type === "detached" || Number(b.id) % 3 === 0
          ? brick
          : stone;
    for (const [i, m] of [roof, facade].entries()) {
      const part = g.groups[i];
      if (!part) continue;
      const s = new THREE.BufferGeometry();
      for (const key of ["position", "normal", "uv"]) {
        const a = g.getAttribute(key);
        s.setAttribute(
          key,
          new THREE.BufferAttribute(
            new Float32Array(
              Array.from(a.array).slice(
                part.start * a.itemSize,
                (part.start + part.count) * a.itemSize,
              ),
            ),
            a.itemSize,
          ),
        );
      }
      add(s, m);
    }
    g.dispose();
    if (b.height > 14 && buildingAt(b.center)?.id === b.id)
      box(b.center, b.height + 0.6, 3.5, 1.2, 2.5, metal);
    if (b.height < 18 && !["house", "detached"].includes(b.type))
      for (let i = 1; i < b.ring.length; i++) {
        const a = b.ring[i - 1]!,
          e = b.ring[i]!,
          d = distance(a, e);
        if (d > 10 && d < 65)
          box(
            lerp(a, e, 0.5),
            3.3,
            d * 0.65,
            0.18,
            1.2,
            metal,
            Math.atan2(e.x - a.x, e.z - a.z) + Math.PI / 2,
          );
      }
  }
  const planted: Point[] = [];
  for (const w of pathWays) {
    if (w.crossing) continue;
    for (let i = 1; i < w.points.length; i++) {
      const a = w.points[i - 1]!,
        b = w.points[i]!,
        d = distance(a, b),
        heading = Math.atan2(b.x - a.x, b.z - a.z);
      for (let t = 10; t < d; t += 30) {
        const p = lerp(a, b, t / d);
        p.x += Math.cos(heading) * 2.5;
        p.z -= Math.sin(heading) * 2.5;
        if (buildingAt(p) || planted.some((v) => distance(v, p) < 14)) continue;
        planted.push(p);
        const h = 4.5 + rng() * 3;
        const stem = new THREE.CylinderGeometry(0.15, 0.25, h, 5);
        stem.translate(p.x, h / 2, p.z);
        add(stem, trunk);
        for (const offset of [-1, 1]) {
          const crown = new THREE.IcosahedronGeometry(2.3 + rng(), 1);
          crown.scale(1, 1.15, 1);
          crown.translate(p.x + offset, h + 1, p.z);
          add(crown, leaf);
        }
      }
    }
  }
  for (const p of signalPoints) box(p.point, 3.5, 0.13, 7, 0.13, metal);
  for (const p of parks) {
    const v = p.ring[0]!;
    box(v, 0.65, 2, 0.2, 0.5, trunk);
    box({ x: v.x, z: v.z + 0.2 }, 1.05, 2, 0.7, 0.1, trunk);
  }
  box(metro.point, 1.6, 0.7, 3.2, 0.7, metal);
  for (const [m, list] of buckets) {
    const g = mergeGeometries(list, false);
    list.forEach((x) => x.dispose());
    if (!g) continue;
    const mesh = new THREE.Mesh(g, m);
    mesh.castShadow = [roof, brick, stone, glass, leaf].includes(
      m as THREE.MeshStandardMaterial,
    );
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  const named = new Set<string>();
  for (const w of roadWays) {
    if (!w.name || named.has(w.name)) continue;
    named.add(w.name);
    const p = w.points[0]!,
      mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(3.5, 0.85),
        new THREE.MeshStandardMaterial({ map: sign(w.name), side: THREE.DoubleSide }),
      );
    mesh.position.set(p.x, 3, p.z);
    group.add(mesh);
  }
  for (const p of places.filter(
    (p) => p.kind === "metro" || /Row|Theatre/.test(p.name),
  )) {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(5, 1.25),
      new THREE.MeshStandardMaterial({
        map: sign(p.kind === "metro" ? "M · BETHESDA" : p.name, "#3d4742"),
        side: THREE.DoubleSide,
      }),
    );
    mesh.position.set(p.point.x, 4, p.point.z);
    group.add(mesh);
  }
  return {
    group,
    dispose() {
      group.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
            if (m instanceof THREE.MeshStandardMaterial) m.map?.dispose();
            m.dispose();
          }
        }
      });
    },
  };
}
