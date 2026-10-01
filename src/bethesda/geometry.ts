import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { TessellateModifier } from "three/addons/modifiers/TessellateModifier.js";
import { mulberry32 } from "../lib/noise";
import { metricBoxUV, surfaceMaterial, foliageTexture } from "./materials";
import {
  createDetailMaterials,
  detailedBuildings,
  detailBuilding,
  detailStreet,
} from "./detail";
import {
  bounds,
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
  row,
  signalPoints,
  type Point,
} from "./model";
import { groundAt } from "./terrain";
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
  let buildingBase: number | null = null;
  // Spatial tiles allow actual GPU frustum culling instead of drawing the whole city.
  const buckets = new Map<
    string,
    { material: THREE.Material; parts: THREE.BufferGeometry[] }
  >();
  const detail = createDetailMaterials();
  const rng = mulberry32(393977);
  const material = (color: string, roughness = 1) =>
    new THREE.MeshStandardMaterial({ color, roughness });
  const ground = material("#929984"),
    asphalt = surfaceMaterial("asphalt"),
    concrete = material("#b1ada0"),
    paint = material("#e4dfc2"),
    grass = material("#647c55"),
    roof = surfaceMaterial("limestone", "#888982"),
    metal = material("#38413e", 0.7),
    trunk = material("#685043"),
    leaf = material("#4b6740");
  const foliage = [leaf, material("#657a48"), material("#3e5d3c")];
  const leafCards = new THREE.MeshStandardMaterial({
    map: foliageTexture(),
    alphaTest: 0.45,
    side: THREE.DoubleSide,
    roughness: 0.94,
  });
  const brick = new THREE.MeshStandardMaterial({
      map: texture("brick"),
      roughness: 0.94,
    }),
    stone = new THREE.MeshStandardMaterial({ map: texture("stone"), roughness: 0.88 }),
    glass = new THREE.MeshStandardMaterial({ map: texture("glass"), roughness: 0.48 });
  function add(g: THREE.BufferGeometry, m: THREE.Material, drape = false) {
    if (g.index) {
      const old = g;
      g = g.toNonIndexed();
      old.dispose();
    }
    for (const key of Object.keys(g.attributes))
      if (!["position", "normal", "uv"].includes(key)) g.deleteAttribute(key);
    g.computeBoundingBox();
    const center = g.boundingBox!.getCenter(new THREE.Vector3());
    const positions = g.getAttribute("position");
    const base = buildingBase ?? groundAt({ x: center.x, z: center.z });
    for (let i = 0; i < positions.count; i++)
      positions.setY(
        i,
        positions.getY(i) +
          (drape ? groundAt({ x: positions.getX(i), z: positions.getZ(i) }) : base),
      );
    if (drape) g.computeVertexNormals();
    const key = `${m.uuid}:${Math.floor(center.x / 100)}:${Math.floor(center.z / 100)}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { material: m, parts: [] };
      buckets.set(key, bucket);
    }
    bucket.parts.push(g);
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
    metricBoxUV(g);
    g.rotateY(angle);
    g.translate(p.x, y, p.z);
    add(g, m);
  }
  function strip(a: Point, b: Point, width: number, y: number, m: THREE.Material) {
    const length = distance(a, b),
      p = lerp(a, b, 0.5);
    const g = new THREE.BoxGeometry(
      width,
      0.055,
      length,
      Math.max(1, Math.ceil(width / 4)),
      1,
      Math.max(1, Math.ceil(length / 8)),
    );
    metricBoxUV(g);
    g.rotateY(Math.atan2(b.x - a.x, b.z - a.z));
    g.translate(p.x, y, p.z);
    add(g, m, true);
  }
  function polygon(ring: Point[], y: number, m: THREE.Material) {
    const shape = new THREE.Shape(ring.map((p) => new THREE.Vector2(p.x, -p.z)));
    const original = new THREE.ShapeGeometry(shape);
    const g = new TessellateModifier(12, 7).modify(original);
    original.dispose();
    g.rotateX(-Math.PI / 2);
    g.translate(0, y, 0);
    add(g, m, true);
  }
  const terrain = new THREE.PlaneGeometry(
    bounds.max.x - bounds.min.x,
    bounds.max.z - bounds.min.z,
    64,
    64,
  );
  terrain.rotateX(-Math.PI / 2);
  terrain.translate(
    (bounds.min.x + bounds.max.x) / 2,
    -0.04,
    (bounds.min.z + bounds.max.z) / 2,
  );
  add(terrain, ground, true);
  for (const p of parks) polygon(p.ring, 0.04, grass);
  for (const w of roadWays)
    for (let i = 1; i < w.points.length; i++) {
      const a = w.points[i - 1]!,
        b = w.points[i]!;
      strip(a, b, w.width + 2, 0.06, concrete);
      strip(a, b, w.width, 0.1, asphalt);
      if (distance(lerp(a, b, 0.5), row.point) < 240 && distance(a, b) > 12) {
        const length = distance(a, b),
          angle = Math.atan2(b.x - a.x, b.z - a.z);
        for (const side of [-1, 1])
          for (let t = 4; t < length - 4; t += 3) {
            const p = lerp(a, b, t / length);
            p.x += Math.cos(angle) * (w.width / 2 + 0.16) * side;
            p.z -= Math.sin(angle) * (w.width / 2 + 0.16) * side;
            if (crossings.some((c) => distance(c.point, p) < 5)) continue;
            box(p, 0.2, 0.24, 0.22, 2.94, detail.trim, angle);
          }
      }
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
      if (!w.crossing) {
        const a = w.points[i - 1]!,
          b = w.points[i]!;
        const close = distance(lerp(a, b, 0.5), row.point) < 225;
        const width = w.name === "Bethesda Lane" ? 8 : w.width;
        strip(a, b, width + 0.18, 0.13, concrete);
        strip(a, b, width - 0.14, 0.17, close ? detail.paving : concrete);
      }
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
    buildingBase = groundAt(b.center);
    const shape = new THREE.Shape(b.ring.map((p) => new THREE.Vector2(p.x, -p.z)));
    for (const hole of b.holes)
      shape.holes.push(new THREE.Path(hole.map((p) => new THREE.Vector2(p.x, -p.z))));
    const g = new THREE.ExtrudeGeometry(shape, { depth: b.height, bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    // Flat floor/roof datum; a simplified foundation skirt reaches the sampled
    // ground instead of bending entire buildings with the bare-earth raster.
    const positions = g.getAttribute("position");
    for (let i = 0; i < positions.count; i++)
      if (positions.getY(i) < 0.001)
        positions.setY(
          i,
          Math.min(
            -0.2,
            groundAt({ x: positions.getX(i), z: positions.getZ(i) }) - buildingBase - 0.2,
          ),
        );
    g.computeVertexNormals();
    const detailed = detailedBuildings.has(b.id);
    const facade = detailed
      ? b.height > 35
        ? detail.stone
        : Number(b.id) % 4 === 0
          ? detail.paleBrick
          : detail.brick
      : b.height > 28
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
      if (detailed && i === 1) {
        const p = s.getAttribute("position"),
          n = s.getAttribute("normal"),
          uv = s.getAttribute("uv");
        for (let v = 0; v < p.count; v++)
          uv.setXY(v, n.getZ(v) * p.getX(v) - n.getX(v) * p.getZ(v), p.getY(v));
      }
      add(s, m);
    }
    g.dispose();
    if (b.height > 14 && buildingAt(b.center)?.id === b.id)
      box(b.center, b.height + 0.6, 3.5, 1.2, 2.5, metal);
    if (detailed) detailBuilding(b, { add, box }, detail);
    if (!detailed && b.height < 18 && !["house", "detached"].includes(b.type))
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
  buildingBase = null;
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
        const close = distance(p, row.point) < 240;
        for (let branch = 0; branch < (close ? 7 : 3); branch++) {
          const angle = branch * 2.4,
            radius = close ? 1.6 : 1;
          const x = p.x + Math.cos(angle) * radius,
            z = p.z + Math.sin(angle) * radius;
          const crown = new THREE.IcosahedronGeometry(close ? 1.1 : 1.6 + rng() * 0.8, 1);
          crown.scale(1, 0.85 + rng() * 0.3, 1);
          crown.translate(x, h + 0.6 + rng() * 1.2, z);
          add(crown, foliage[branch % foliage.length]!);
          if (close)
            for (let k = 0; k < 3; k++) {
              const leaves = new THREE.PlaneGeometry(4.8, 4.1);
              leaves.rotateX((rng() - 0.5) * 0.8);
              leaves.rotateY((k * Math.PI) / 3 + branch);
              leaves.translate(x, h + 1, z);
              add(leaves, leafCards);
            }
          if (close) {
            const direction = new THREE.Vector3(x - p.x, 1.5, z - p.z);
            const limb = new THREE.CylinderGeometry(0.04, 0.1, direction.length(), 5);
            limb.applyQuaternion(
              new THREE.Quaternion().setFromUnitVectors(
                new THREE.Vector3(0, 1, 0),
                direction.normalize(),
              ),
            );
            limb.translate((p.x + x) / 2, h - 0.05, (p.z + z) / 2);
            add(limb, trunk);
          }
        }
        if (close) {
          box(p, 0.18, 1.8, 0.08, 1.8, detail.dark);
          box(p, 0.225, 1.55, 0.025, 1.55, detail.soil);
        }
      }
    }
  }
  detailStreet({ add, box }, detail);
  for (const p of signalPoints) {
    box(p.point, 3.5, 0.13, 7, 0.13, metal);
    box(p.point, 0.25, 0.28, 0.5, 0.28, metal);
    box(p.point, 5, 0.48, 1.15, 0.38, detail.dark);
  }
  for (const p of parks) {
    const v = p.ring[0]!;
    box(v, 0.65, 2, 0.2, 0.5, trunk);
    box({ x: v.x, z: v.z + 0.2 }, 1.05, 2, 0.7, 0.1, trunk);
  }
  box(metro.point, 1.6, 0.7, 3.2, 0.7, metal);
  for (const { material: m, parts: list } of buckets.values()) {
    const g = mergeGeometries(list, false);
    list.forEach((x) => x.dispose());
    if (!g) continue;
    const mesh = new THREE.Mesh(g, m);
    mesh.castShadow = ![
      asphalt,
      concrete,
      paint,
      grass,
      detail.paving,
      detail.soil,
      ground,
    ].includes(m as THREE.MeshStandardMaterial);
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
    mesh.position.set(p.x, groundAt(p) + 3, p.z);
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
    mesh.position.set(p.point.x, groundAt(p.point) + 4, p.point.z);
    group.add(mesh);
  }
  return {
    group,
    dispose() {
      group.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
            if (m instanceof THREE.MeshStandardMaterial) {
              m.map?.dispose();
              m.bumpMap?.dispose();
              m.roughnessMap?.dispose();
            }
            m.dispose();
          }
        }
      });
    },
  };
}
