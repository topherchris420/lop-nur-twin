/**
 * Streetscape geometry from mapped data: street-name blades at real
 * intersections, storefront and building names, monuments, fountains, public
 * art, bus stops, bike-share docks, mapped trees/lamps/benches and Purple Line
 * construction fencing.
 *
 * Every element sits at an OSM position. What is *not* data is said here and in
 * the field notes: sculptural forms, sign styles and typography, canopy and
 * shelter dimensions, and fence styles are procedural stand-ins. Names are
 * OSM `name` tags drawn as plain text; no logo or trade dress is reproduced.
 */
import * as THREE from "three";
import { mulberry32 } from "../lib/noise";
import type { CityBuilder, DetailMaterials } from "./detail";
import {
  buildingAt,
  buildings,
  distance,
  lerp,
  pathWays,
  places,
  roadWays,
  row,
  type Building,
  type Point,
} from "./model";
import {
  bikeshare,
  busStops,
  construction,
  mappedBenches,
  mappedLamps,
  mappedTrees,
  monuments,
  storefronts,
  storefrontBuilding,
} from "./streetscape";
import { groundAt } from "./terrain";

const downtown = places.find((p) => p.name === "Downtown Bethesda")?.point ?? row.point;
const SUFFIX: Record<string, string> = {
  // Montgomery County blades abbreviate Avenue as "Av" ("Bethesda Av").
  Avenue: "Av",
  Street: "St",
  Road: "Rd",
  Lane: "Ln",
  Boulevard: "Blvd",
  Drive: "Dr",
  Highway: "Hwy",
  Place: "Pl",
  Court: "Ct",
};
export const bladeText = (name: string) =>
  name.replace(
    /\b(Avenue|Street|Road|Lane|Boulevard|Drive|Highway|Place|Court)$/,
    (m) => SUFFIX[m]!,
  );

interface SignStyle {
  background: string;
  ink: string;
  font: string;
  border?: string;
}
/** A canvas atlas of fixed text cells, so every sign merges into one draw. */
class TextAtlas {
  readonly canvas = document.createElement("canvas");
  private context: CanvasRenderingContext2D;
  private cells = new Map<string, [number, number, number, number]>();
  private next = 0;
  readonly texture: THREE.CanvasTexture;
  constructor(
    width: number,
    height: number,
    private cellW: number,
    private cellH: number,
  ) {
    this.canvas.width = width;
    this.canvas.height = height;
    this.context = this.canvas.getContext("2d")!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
  }
  get full() {
    return (
      this.next >= (this.canvas.width / this.cellW) * (this.canvas.height / this.cellH)
    );
  }
  /** UV rectangle [u0, v0, u1, v1] for a text cell, drawn on first use. */
  cell(text: string, style: SignStyle) {
    const key = text + "|" + style.background + style.font;
    const known = this.cells.get(key);
    if (known) return known;
    if (this.full) return null;
    const cols = this.canvas.width / this.cellW;
    const x = (this.next % cols) * this.cellW,
      y = Math.floor(this.next / cols) * this.cellH;
    this.next++;
    const c = this.context;
    c.fillStyle = style.background;
    c.fillRect(x, y, this.cellW, this.cellH);
    if (style.border) {
      c.strokeStyle = style.border;
      c.lineWidth = Math.max(2, this.cellH / 16);
      c.strokeRect(x + 3, y + 3, this.cellW - 6, this.cellH - 6);
    }
    c.fillStyle = style.ink;
    c.textAlign = "center";
    c.textBaseline = "middle";
    let size = Math.floor(this.cellH * 0.62);
    c.font = style.font.replace("{size}", String(size));
    while (c.measureText(text).width > this.cellW * 0.9 && size > 8) {
      size--;
      c.font = style.font.replace("{size}", String(size));
    }
    c.fillText(text, x + this.cellW / 2, y + this.cellH / 2 + 1, this.cellW * 0.92);
    const W = this.canvas.width,
      H = this.canvas.height;
    const uv: [number, number, number, number] = [
      x / W,
      1 - (y + this.cellH) / H,
      (x + this.cellW) / W,
      1 - y / H,
    ];
    this.cells.set(key, uv);
    this.texture.needsUpdate = true;
    return uv;
  }
}
const STREET_BLADE: SignStyle = {
  background: "#1d6b46",
  ink: "#f4f6f1",
  border: "#f4f6f1",
  font: "600 {size}px 'Helvetica Neue', Arial, sans-serif",
};
const STOREFRONT_STYLES: SignStyle[] = [
  { background: "#1f2b28", ink: "#efe7d2", font: "500 {size}px Georgia, serif" },
  {
    background: "#f1ece0",
    ink: "#26302f",
    font: "600 {size}px 'Helvetica Neue', Arial, sans-serif",
  },
  { background: "#3b1f22", ink: "#f0dcc0", font: "italic 500 {size}px Georgia, serif" },
  {
    background: "#18283a",
    ink: "#e9eef2",
    font: "500 {size}px 'Helvetica Neue', Arial, sans-serif",
  },
  { background: "#2e3e2b", ink: "#f3ead5", font: "600 {size}px Georgia, serif" },
  {
    background: "#dad3c4",
    ink: "#3a2a20",
    font: "700 {size}px 'Trebuchet MS', sans-serif",
  },
];
const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};
/** A text quad, readable from the front (and, when `both`, from behind). */
function quad(
  centre: Point,
  y: number,
  width: number,
  height: number,
  angle: number,
  uv: [number, number, number, number],
  both: boolean,
) {
  const parts: THREE.BufferGeometry[] = [];
  for (const side of both ? [0, 1] : [0]) {
    const g = new THREE.PlaneGeometry(width, height);
    const a = g.getAttribute("uv");
    const [u0, v0, u1, v1] = uv;
    // PlaneGeometry uv order: (0,1) (1,1) (0,0) (1,0)
    const us = side ? [u1, u0, u1, u0] : [u0, u1, u0, u1];
    const vs = [v1, v1, v0, v0];
    for (let i = 0; i < 4; i++) a.setXY(i, us[i]!, vs[i]!);
    if (side) g.rotateY(Math.PI);
    g.translate(0, 0, side ? -0.006 : 0.006);
    g.rotateY(angle);
    g.translate(centre.x, y, centre.z);
    parts.push(g);
  }
  return parts;
}

export function createLandmarkMaterials() {
  const fence = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const x = c.getContext("2d")!;
    x.strokeStyle = "rgba(168,172,170,1)";
    x.lineWidth = 2;
    for (let i = -64; i < 128; i += 8) {
      x.beginPath();
      x.moveTo(i, 0);
      x.lineTo(i + 64, 64);
      x.moveTo(i + 64, 0);
      x.lineTo(i, 64);
      x.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshStandardMaterial({
      map: t,
      alphaTest: 0.4,
      transparent: false,
      side: THREE.DoubleSide,
      roughness: 0.6,
      metalness: 0.5,
    });
  })();
  return {
    pole: new THREE.MeshStandardMaterial({
      color: "#3f4a46",
      roughness: 0.55,
      metalness: 0.4,
    }),
    statue: new THREE.MeshStandardMaterial({ color: "#b69c8a", roughness: 0.85 }),
    granite: new THREE.MeshStandardMaterial({ color: "#8f8a84", roughness: 0.7 }),
    water: new THREE.MeshStandardMaterial({
      color: "#6f8f9a",
      roughness: 0.05,
      metalness: 0.1,
      transparent: true,
      opacity: 0.82,
      envMapIntensity: 1.6,
    }),
    steel: new THREE.MeshStandardMaterial({
      color: "#9aa2a3",
      roughness: 0.32,
      metalness: 0.85,
    }),
    rust: new THREE.MeshStandardMaterial({
      color: "#7d4b35",
      roughness: 0.7,
      metalness: 0.3,
    }),
    bronze: new THREE.MeshStandardMaterial({
      color: "#4f3a2a",
      roughness: 0.6,
      metalness: 0.3,
    }),
    redLine: new THREE.MeshStandardMaterial({ color: "#bf2a2a", roughness: 0.6 }),
    shelterGlass: new THREE.MeshStandardMaterial({
      color: "#9fb2b6",
      roughness: 0.08,
      transparent: true,
      opacity: 0.35,
      envMapIntensity: 1.4,
    }),
    dock: new THREE.MeshStandardMaterial({
      color: "#a8322b",
      roughness: 0.5,
      metalness: 0.2,
    }),
    barrier: new THREE.MeshStandardMaterial({ color: "#c9c4b7", roughness: 0.9 }),
    orange: new THREE.MeshStandardMaterial({ color: "#d4621f", roughness: 0.6 }),
    fence,
  };
}
export type LandmarkMaterials = ReturnType<typeof createLandmarkMaterials>;

/** Outward-facing footprint edges, longest first. */
function facadeEdges(b: Building) {
  const edges: {
    a: Point;
    b: Point;
    length: number;
    nx: number;
    nz: number;
    angle: number;
  }[] = [];
  for (let i = 1; i < b.ring.length; i++) {
    const a = b.ring[i - 1]!,
      e = b.ring[i]!,
      length = distance(a, e);
    if (length < 3) continue;
    const dx = (e.x - a.x) / length,
      dz = (e.z - a.z) / length;
    let nx = -dz,
      nz = dx;
    const mid = lerp(a, e, 0.5);
    if (buildingAt({ x: mid.x + nx * 0.4, z: mid.z + nz * 0.4 })?.id === b.id) {
      nx = -nx;
      nz = -nz;
    }
    if (buildingAt({ x: mid.x + nx * 1.2, z: mid.z + nz * 1.2 })) continue;
    edges.push({ a, b: e, length, nx, nz, angle: Math.atan2(nx, nz) });
  }
  return edges.sort((p, q) => q.length - p.length);
}

export interface LandmarkResult {
  atlases: THREE.Texture[];
  /** Counts, so the field notes can say what was actually placed. */
  placed: Record<string, number>;
  /** One placed position per category, for look-development captures. */
  samples: Record<string, Point>;
}
export function buildLandmarks(
  builder: CityBuilder,
  m: DetailMaterials,
  l: LandmarkMaterials,
): LandmarkResult {
  const { add, box } = builder;
  const placed: Record<string, number> = {};
  const samples: Record<string, Point> = {};
  let last: Point = { x: 0, z: 0 };
  const count = (k: string) => {
    placed[k] = (placed[k] ?? 0) + 1;
    samples[k] ??= { ...last };
  };
  const cylinder = (
    p: Point,
    y: number,
    r0: number,
    r1: number,
    h: number,
    mat: THREE.Material,
    seg = 10,
  ) => {
    const g = new THREE.CylinderGeometry(r1, r0, h, seg);
    g.translate(p.x, y + h / 2, p.z);
    add(g, mat);
  };

  // --- Street-name blades at real intersections ------------------------------
  const streets = new TextAtlas(1024, 1024, 256, 32);
  const streetMaterial = new THREE.MeshStandardMaterial({
    map: streets.texture,
    roughness: 0.5,
    emissive: "#ffffff",
    emissiveMap: streets.texture,
    emissiveIntensity: 0.12,
  });
  const atNode = new Map<string, { name: string; dir: Point; width: number }[]>();
  for (const w of roadWays) {
    if (!w.name || w.highway === "service") continue;
    w.nodeIds.forEach((id, i) => {
      const here = w.points[i]!,
        other = w.points[i + 1] ?? w.points[i - 1]!;
      const d = distance(here, other) || 1;
      const list = atNode.get(id) ?? [];
      if (!list.some((s) => s.name === w.name))
        list.push({
          name: w.name,
          dir: { x: (other.x - here.x) / d, z: (other.z - here.z) / d },
          width: w.width,
        });
      atNode.set(id, list);
    });
  }
  const poles: Point[] = [];
  for (const [id, list] of [...atNode].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (list.length < 2) continue;
    const w = roadWays.find((w) => w.nodeIds.includes(id))!;
    const node = w.points[w.nodeIds.indexOf(id)]!;
    if (distance(node, downtown) > 700) continue;
    const [s1, s2] = list as [(typeof list)[0], (typeof list)[0]];
    // The corner between the two streets, clear of both carriageways.
    let corner: Point | undefined;
    for (const [a, b] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ] as const) {
      const p = {
        x:
          node.x -
          s1.dir.z * a * (s1.width / 2 + 1.4) -
          s2.dir.z * b * (s2.width / 2 + 1.4),
        z:
          node.z +
          s1.dir.x * a * (s1.width / 2 + 1.4) +
          s2.dir.x * b * (s2.width / 2 + 1.4),
      };
      if (!buildingAt(p) && Math.hypot(p.x - node.x, p.z - node.z) < 25) {
        corner = p;
        break;
      }
    }
    if (!corner || poles.some((p) => distance(p, corner) < 12)) continue;
    poles.push(corner);
    last = corner;
    const pole = new THREE.CylinderGeometry(0.045, 0.055, 3.7, 8);
    pole.translate(corner.x, 1.85, corner.z);
    add(pole, l.pole);
    [s1, s2].forEach((s, k) => {
      const uv = streets.cell(bladeText(s.name), STREET_BLADE);
      if (!uv) return;
      // A blade is parallel to the street it names: read from the cross street.
      const angle = Math.atan2(s.dir.x, s.dir.z) + Math.PI / 2;
      for (const g of quad(corner, 3.45 + k * 0.27, 1.55, 0.22, angle, uv, true))
        add(g, streetMaterial);
    });
    count("street blades");
  }

  // --- Storefront and building names ----------------------------------------
  const names = new TextAtlas(2048, 2048, 512, 64);
  const nameMaterial = new THREE.MeshStandardMaterial({
    map: names.texture,
    roughness: 0.55,
    emissive: "#ffffff",
    emissiveMap: names.texture,
    emissiveIntensity: 0.08,
  });
  const used = new Map<string, [number, number][]>();
  const signOn = (
    b: Building,
    text: string,
    near: Point,
    y: number,
    height: number,
    style: SignStyle,
  ) => {
    for (const edge of facadeEdges(b)) {
      const along =
        ((near.x - edge.a.x) * (edge.b.x - edge.a.x) +
          (near.z - edge.a.z) * (edge.b.z - edge.a.z)) /
        edge.length;
      const width = Math.min(edge.length * 0.8, 1 + text.length * 0.17, 7.5);
      const centre = Math.max(
        width / 2 + 0.3,
        Math.min(edge.length - width / 2 - 0.3, along),
      );
      if (width < 1.6) continue;
      const key = `${b.id}:${edge.a.x.toFixed(2)},${edge.a.z.toFixed(2)}:${Math.round(y)}`;
      const spans = used.get(key) ?? [];
      if (spans.some(([s, e]) => centre + width / 2 > s && centre - width / 2 < e))
        continue;
      const p = lerp(edge.a, edge.b, centre / edge.length);
      const uv = names.cell(text, style);
      if (!uv) return false;
      spans.push([centre - width / 2, centre + width / 2]);
      used.set(key, spans);
      const signHeight = Math.min(height, width / 4);
      const at = { x: p.x + edge.nx * 0.14, z: p.z + edge.nz * 0.14 };
      last = { x: at.x + edge.nx * 12, z: at.z + edge.nz * 12 };
      // Building floors are level at the footprint centre; signs follow them.
      const lift = groundAt(b.center) - groundAt(at);
      for (const g of quad(at, y + lift, width, signHeight, edge.angle, uv, false))
        add(g, nameMaterial);
      return true;
    }
    return false;
  };
  for (const b of buildings) {
    if (!b.name || b.height < 24) continue;
    if (
      signOn(b, b.name, b.center, b.height - 2.2, 1.4, {
        background: "#22302f",
        ink: "#f2efe4",
        font: "600 {size}px 'Helvetica Neue', Arial, sans-serif",
      })
    )
      count("building names");
  }
  const shops = storefronts
    .map((s) => ({
      s,
      d: Math.min(distance(s.point, row.point), distance(s.point, downtown)),
    }))
    .filter(({ d }) => d < 420)
    .sort((a, b) => a.d - b.d || (a.s.osmId < b.s.osmId ? -1 : 1));
  for (const { s } of shops) {
    if (names.full) break;
    const b = storefrontBuilding(s);
    if (!b || b.height < 5) continue;
    const style = STOREFRONT_STYLES[hash(s.name) % STOREFRONT_STYLES.length]!;
    if (
      signOn(
        b,
        s.name,
        s.point,
        b.height < 9 ? Math.min(3.9, b.height - 1) : 4.03,
        0.42,
        style,
      )
    )
      count("storefront names");
  }
  const theatre = places.find((p) => p.name === "Bethesda Theatre");
  if (theatre) {
    const b = storefrontBuilding({
      osmId: "0",
      name: "",
      category: "",
      street: "",
      point: theatre.point,
    });
    if (
      b &&
      signOn(b, "BETHESDA THEATRE", theatre.point, 4.6, 1.1, {
        background: "#2b2118",
        ink: "#f6dc9a",
        font: "700 {size}px Georgia, serif",
        border: "#f6dc9a",
      })
    )
      count("theatre marquee");
  }

  // --- Monuments, art and fountains -------------------------------------------
  for (const mon of monuments) {
    const p = mon.point,
      r = mulberry32(Number(mon.osmId) % 2147483647);
    if (mon.name === "Madonna of the Trail") {
      // Procedural massing of the mapped monument: a stepped base, a shaft and a
      // robed pioneer mother with children. Not a scan or a sculpted likeness.
      box(p, 0.3, 3.1, 0.6, 3.1, l.granite);
      box(p, 1.5, 2.2, 1.8, 2.2, l.granite);
      box(p, 2.55, 2.5, 0.3, 2.5, l.granite);
      const skirt = new THREE.CylinderGeometry(0.42, 0.85, 2.6, 14);
      skirt.translate(p.x, 2.7 + 1.3, p.z);
      add(skirt, l.statue);
      const torso = new THREE.CylinderGeometry(0.34, 0.42, 1.1, 12);
      torso.translate(p.x, 4.0 + 0.55, p.z);
      add(torso, l.statue);
      const head = new THREE.SphereGeometry(0.27, 12, 10);
      head.translate(p.x, 5.42, p.z);
      add(head, l.statue);
      const bonnet = new THREE.SphereGeometry(
        0.33,
        12,
        8,
        0,
        Math.PI * 2,
        0,
        Math.PI * 0.55,
      );
      bonnet.translate(p.x, 5.46, p.z - 0.04);
      add(bonnet, l.statue);
      const infant = new THREE.SphereGeometry(0.22, 10, 8);
      infant.scale(1, 1.4, 1);
      infant.translate(p.x + 0.32, 4.7, p.z + 0.28);
      add(infant, l.statue);
      const child = new THREE.CylinderGeometry(0.2, 0.36, 1.5, 10);
      child.translate(p.x - 0.75, 2.7 + 0.75, p.z + 0.25);
      add(child, l.statue);
      const childHead = new THREE.SphereGeometry(0.17, 10, 8);
      childHead.translate(p.x - 0.75, 4.35, p.z + 0.25);
      add(childHead, l.statue);
      const rifle = new THREE.CylinderGeometry(0.03, 0.04, 2.1, 6);
      rifle.rotateZ(0.12);
      rifle.translate(p.x - 0.55, 3.9, p.z - 0.05);
      add(rifle, l.statue);
      count("Madonna of the Trail");
    } else if (mon.kind === "fountain") {
      cylinder(p, 0, 1.6, 1.55, 0.45, l.granite, 20);
      cylinder(p, 0.3, 1.4, 1.4, 0.1, l.water, 20);
      cylinder(p, 0.4, 0.05, 0.03, 0.9 + r(), l.water, 6);
      count("fountains");
    } else if (mon.kind === "artwork") {
      // Generic steel sculpture at the mapped point; form is illustrative.
      box(p, 0.25, 1.1, 0.5, 1.1, l.granite);
      const turns = 9 + Math.floor(r() * 6),
        twist = 0.2 + r() * 0.3,
        mat = mon.material === "steel" ? l.steel : r() < 0.5 ? l.rust : l.steel;
      for (let k = 0; k < turns; k++) {
        const g = new THREE.BoxGeometry(0.9 - k * 0.03, 0.22, 0.14);
        g.rotateY(k * twist);
        g.translate(p.x, 0.65 + k * 0.27, p.z);
        add(g, mat);
      }
      count("public artworks");
    } else {
      box(p, 0.5, 1.2, 1, 0.4, l.granite);
      count("memorials");
    }
  }

  // --- Metro: the mapped Red Line entrance and elevator -----------------------
  const metroUv = names.cell("M", {
    background: "#5a3d28",
    ink: "#ffffff",
    font: "700 {size}px 'Helvetica Neue', Arial, sans-serif",
  });
  for (const p of places.filter((p) => p.kind === "metro")) {
    const path = pathWays
      .flatMap((w) => w.points.slice(1).map((b, i) => [w.points[i]!, b] as const))
      .reduce((best, seg) =>
        distance(lerp(seg[0], seg[1], 0.5), p.point) <
        distance(lerp(best[0], best[1], 0.5), p.point)
          ? seg
          : best,
      );
    const angle = Math.atan2(path[1].x - path[0].x, path[1].z - path[0].z);
    const dx = Math.sin(angle),
      dz = Math.cos(angle);
    if (/Elevator/.test(p.name)) {
      box(p.point, 1.5, 2.6, 3, 2.6, l.shelterGlass, angle);
      box(p.point, 3.05, 2.9, 0.15, 2.9, l.pole, angle);
      count("Metro elevator");
      continue;
    }
    // Canopy over the escalator well: dimensions and orientation inferred.
    for (const s of [-1, 1])
      for (let k = 0; k < 4; k++) {
        const q = {
          x: p.point.x + dx * (k * 4 - 6) + dz * s * 3,
          z: p.point.z + dz * (k * 4 - 6) - dx * s * 3,
        };
        cylinder(q, 0, 0.09, 0.09, 4.2, l.pole, 8);
      }
    for (let k = 0; k <= 8; k++) {
      const t = k / 8,
        across = -3.2 + t * 6.4,
        y = 4.2 + Math.cos((across / 3.2) * (Math.PI / 2)) * 1.1;
      const q = { x: p.point.x + dz * across, z: p.point.z - dx * across };
      box(q, y, 0.65, 0.04, 13, l.shelterGlass, angle);
      if (k % 2 === 0) box(q, y + 0.04, 0.06, 0.08, 13, l.pole, angle);
    }
    // The pylon: brown column, Red Line band, an "M" on each face.
    const pylon = { x: p.point.x + dx * 9 + dz * 3.6, z: p.point.z + dz * 9 - dx * 3.6 };
    box(pylon, 2.2, 0.55, 4.4, 0.55, l.bronze);
    box(pylon, 3.2, 0.57, 0.18, 0.57, l.redLine);
    if (metroUv)
      for (let f = 0; f < 4; f++) {
        const a = (f * Math.PI) / 2;
        const at = { x: pylon.x + Math.sin(a) * 0.29, z: pylon.z + Math.cos(a) * 0.29 };
        for (const g of quad(
          at,
          3.95,
          0.42,
          0.42,
          a,
          [
            metroUv[0] + (metroUv[2] - metroUv[0]) * 0.44,
            metroUv[1],
            metroUv[0] + (metroUv[2] - metroUv[0]) * 0.56,
            metroUv[3],
          ],
          false,
        ))
          add(g, nameMaterial);
      }
    count("Metro entrance");
  }

  // --- Transit stops and bike share --------------------------------------------
  const busUv = streets.cell("BUS STOP", {
    background: "#e8e6df",
    ink: "#1f3340",
    font: "700 {size}px 'Helvetica Neue', Arial, sans-serif",
  });
  for (const s of busStops) {
    if (buildingAt(s.point)) continue;
    cylinder(s.point, 0, 0.04, 0.04, 2.9, l.pole, 6);
    if (busUv)
      for (const g of quad(s.point, 2.55, 0.5, 0.36, 0, busUv, true))
        add(g, streetMaterial);
    if (s.shelter) {
      const at = { x: s.point.x + 1.2, z: s.point.z };
      box(at, 1.2, 3, 2.3, 0.04, l.shelterGlass);
      box({ x: at.x - 1.5, z: at.z + 0.7 }, 1.2, 0.04, 2.3, 1.4, l.shelterGlass);
      box({ x: at.x + 1.5, z: at.z + 0.7 }, 1.2, 0.04, 2.3, 1.4, l.shelterGlass);
      box({ x: at.x, z: at.z + 0.7 }, 2.4, 3.2, 0.1, 1.6, l.pole);
      count("bus shelters");
    }
    count("bus stops");
  }
  for (const d of bikeshare) {
    if (buildingAt(d.point)) continue;
    box(d.point, 0.08, 6, 0.16, 0.5, l.dock);
    for (let k = 0; k < 5; k++) {
      const q = { x: d.point.x - 2.4 + k * 1.2, z: d.point.z };
      box(q, 0.45, 0.14, 0.9, 0.2, l.dock);
      for (const off of [-0.45, 0.45]) {
        const wheel = new THREE.TorusGeometry(0.33, 0.03, 5, 14);
        wheel.rotateY(Math.PI / 2);
        wheel.translate(q.x, 0.36, q.z + 0.4 + off);
        add(wheel, l.pole);
      }
      box({ x: q.x, z: q.z + 0.4 }, 0.72, 0.05, 0.05, 0.9, l.dock);
    }
    count("bike-share docks");
  }

  // --- Mapped trees, lamps and benches ---------------------------------------
  for (const t of mappedTrees) {
    if (buildingAt(t.point)) continue;
    const r = mulberry32(Number(t.osmId) % 2147483647);
    const h = 4 + r() * 3;
    cylinder(t.point, 0, 0.28, 0.16, h, m.wood, 6);
    for (let k = 0; k < 5; k++) {
      const crown = new THREE.IcosahedronGeometry(1.4 + r() * 0.7, 1);
      crown.translate(
        t.point.x + Math.cos(k * 1.3) * 1.1,
        h + 0.4 + r(),
        t.point.z + Math.sin(k * 1.3) * 1.1,
      );
      add(crown, m.awning);
    }
    count("mapped trees");
  }
  for (const lamp of mappedLamps) {
    if (buildingAt(lamp.point)) continue;
    cylinder(lamp.point, 0, 0.09, 0.055, 4.6, m.dark, 8);
    const globe = new THREE.SphereGeometry(0.23, 8, 6);
    globe.scale(1, 1.45, 1);
    globe.translate(lamp.point.x, 4.9, lamp.point.z);
    add(globe, m.canvas);
    count("mapped lamps");
  }
  for (const bench of mappedBenches) {
    if (buildingAt(bench.point)) continue;
    if (bench.kind === "picnic_table") {
      box(bench.point, 0.75, 1.8, 0.06, 0.8, m.wood);
      for (const s of [-1, 1])
        box(
          { x: bench.point.x, z: bench.point.z + s * 0.65 },
          0.45,
          1.8,
          0.05,
          0.3,
          m.wood,
        );
    } else {
      box(bench.point, 0.48, 1.6, 0.07, 0.45, m.wood);
      box({ x: bench.point.x, z: bench.point.z - 0.22 }, 0.8, 1.6, 0.45, 0.06, m.wood);
    }
    count("mapped benches");
  }

  // --- Purple Line construction: fencing along surface portions -------------
  for (const work of construction) {
    if (work.tunnel) continue;
    const pts = work.points;
    const sides = work.kind === "rail" ? [-5.5, 5.5] : [0];
    for (const off of sides)
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1]!,
          b = pts[i]!,
          length = distance(a, b);
        if (length < 1) continue;
        const angle = Math.atan2(b.x - a.x, b.z - a.z);
        const nx = Math.cos(angle) * off,
          nz = -Math.sin(angle) * off;
        for (let t = 0; t < length; t += 3) {
          const s = Math.min(3, length - t);
          const p = lerp(a, b, (t + s / 2) / length);
          const q = { x: p.x + nx, z: p.z + nz };
          if (buildingAt(q)) continue;
          const panel = new THREE.PlaneGeometry(s, 2.1);
          const uv = panel.getAttribute("uv");
          for (let k = 0; k < uv.count; k++)
            uv.setXY(k, uv.getX(k) * s * 1.2, uv.getY(k) * 2.5);
          panel.rotateY(angle + Math.PI / 2);
          panel.translate(q.x, 1.05, q.z);
          add(panel, l.fence);
          cylinder(
            { x: q.x - Math.sin(angle) * s * 0.5, z: q.z - Math.cos(angle) * s * 0.5 },
            0,
            0.035,
            0.035,
            2.15,
            l.pole,
            6,
          );
        }
      }
    count(work.kind === "rail" ? "construction alignments" : "construction sites");
  }
  return { atlases: [streets.texture, names.texture], placed, samples };
}
