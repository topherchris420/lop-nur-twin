/** Illustrative Row architecture, derived from footprint edges, never a survey. */
import * as THREE from "three";
import { mulberry32 } from "../lib/noise";
import {
  buildingAt,
  buildings,
  distance,
  lerp,
  pathWays,
  row,
  type Building,
  type Point,
} from "./model";
import { architecturalStone, surfaceMaterial } from "./materials";
export interface CityBuilder {
  add(g: THREE.BufferGeometry, material: THREE.Material): void;
  box(
    p: Point,
    y: number,
    w: number,
    h: number,
    d: number,
    m: THREE.Material,
    angle?: number,
  ): void;
}
// Keep the expensive silhouette and frame geometry local to the arrival blocks.
export const detailedBuildings = new Set(
  buildings
    .filter(
      (b) =>
        distance(b.center, row.point) < 205 && !["house", "detached"].includes(b.type),
    )
    .map((b) => b.id),
);
export function createDetailMaterials() {
  return {
    brick: surfaceMaterial("brick"),
    paleBrick: surfaceMaterial("brick", "#e5d2bf"),
    redBrick: surfaceMaterial("brick", "#ca9581"),
    lightStone: architecturalStone("#d0c5ad"),
    stone: architecturalStone("#baac94"),
    trim: new THREE.MeshStandardMaterial({ color: "#c4b69e", roughness: 0.82 }),
    dark: new THREE.MeshStandardMaterial({ color: "#303636", roughness: 0.67 }),
    glass: new THREE.MeshStandardMaterial({
      color: "#506975",
      roughness: 0.19,
      metalness: 0,
      envMapIntensity: 1.25,
    }),
    warmGlass: new THREE.MeshStandardMaterial({
      color: "#615b4c",
      roughness: 0.24,
      envMapIntensity: 0.9,
    }),
    blind: new THREE.MeshStandardMaterial({ color: "#b3a88e", roughness: 0.94 }),
    awning: new THREE.MeshStandardMaterial({ color: "#304b46", roughness: 0.95 }),
    canvas: new THREE.MeshStandardMaterial({ color: "#c4b397", roughness: 0.98 }),
    wood: new THREE.MeshStandardMaterial({ color: "#715240", roughness: 0.9 }),
    paving: surfaceMaterial("paving"),
    soil: new THREE.MeshStandardMaterial({ color: "#534d3d", roughness: 1 }),
  };
}
export type DetailMaterials = ReturnType<typeof createDetailMaterials>;
export function detailBuilding(b: Building, builder: CityBuilder, m: DetailMaterials) {
  const random = mulberry32(Number(b.id) + 617),
    { box } = builder;
  for (const ring of [b.ring, ...b.holes])
    for (let i = 1; i < ring.length; i++) {
      const a = ring[i - 1]!,
        e = ring[i]!,
        length = distance(a, e);
      if (length < 2.5) continue;
      const dx = (e.x - a.x) / length,
        dz = (e.z - a.z) / length;
      const mid = lerp(a, e, 0.5);
      let nx = -dz,
        nz = dx;
      if (buildingAt({ x: mid.x + nx * 0.2, z: mid.z + nz * 0.2 })?.id === b.id) {
        nx = -nx;
        nz = -nz;
      }
      if (buildingAt({ x: mid.x + nx * 0.7, z: mid.z + nz * 0.7 })) continue;
      const angle = Math.atan2(-dz, dx);
      const point = (along: number, depth: number) => ({
        x: a.x + dx * along + nx * depth,
        z: a.z + dz * along + nz * depth,
      });
      const ledge = (y: number, h: number, depth: number, mat = m.trim) =>
        box(point(length / 2, 0.04), y, length, h, depth, mat, angle);
      ledge(0.4, 0.55, 0.3); // plinth
      ledge(3.65, 0.28, 0.42);
      ledge(b.height - 0.2, 0.34, 0.5); // coping and shadow line
      ledge(b.height + 0.18, 0.38, 0.22, m.stone);
      const bays = Math.min(24, Math.max(1, Math.floor(length / 3.6))),
        step = length / bays;
      const floors = Math.min(12, Math.max(1, Math.round(b.height / 3.3)));
      for (let j = 0; j < bays; j++) {
        const along = (j + 0.5) * step,
          width = Math.min(2.6, step - 0.6);
        // The architect describes a block with several facade themes. These
        // modules are illustrative, not surveyed or identified tenant facades.
        const theme = (Math.floor(j / 3) + i + (Number(b.id) % 5)) % 4;
        if (b.height < 35) {
          const face =
            theme === 0
              ? m.lightStone
              : theme === 1
                ? m.redBrick
                : theme === 2
                  ? m.paleBrick
                  : m.brick;
          box(
            point(along, 0.025),
            (b.height + 3.85) / 2,
            step - 0.025,
            Math.max(0.1, b.height - 3.85),
            0.08,
            face,
            angle,
          );
        }
        // Dark reveals stand behind projecting frames; window panes sit within them.
        for (let f = 0; f < floors; f++) {
          const y =
            f === 0 ? 1.9 : 4.9 + ((f - 1) * (b.height - 5.5)) / Math.max(1, floors - 1);
          if (y + 1.05 > b.height - 0.4) continue;
          const h = f === 0 ? 2.7 : theme === 0 ? 2.1 : 1.8,
            w =
              f === 0
                ? width
                : Math.min(theme === 0 ? 2.1 : theme === 2 ? 1.45 : 1.7, width);
          box(point(along, 0.035), y, w + 0.22, h + 0.22, 0.08, m.dark, angle);
          box(
            point(along, 0.095),
            y,
            w,
            h,
            0.05,
            random() < 0.18 ? m.warmGlass : m.glass,
            angle,
          );
          for (const side of [-1, 1])
            box(
              point(along + side * (w / 2 + 0.06), 0.17),
              y,
              0.1,
              h + 0.2,
              0.22,
              f === 0 ? m.dark : m.trim,
              angle,
            );
          box(point(along, 0.2), y - h / 2, w + 0.35, 0.12, 0.34, m.trim, angle);
          box(point(along, 0.19), y + h / 2, w + 0.22, 0.11, 0.26, m.trim, angle);
          box(point(along, 0.18), y, 0.05, h, 0.13, m.dark, angle);
          box(point(along, 0.18), y + h * 0.22, w, 0.045, 0.13, m.dark, angle);
          if (f > 0 && random() < 0.35)
            box(
              point(along, 0.124),
              y + h * 0.32,
              w - 0.04,
              h * 0.3,
              0.02,
              m.blind,
              angle,
            );
          if (f > 0 && theme === 1 && length > 10) {
            // Shallow Juliet rail and sill, inspired by the architect's photo.
            box(point(along, 0.41), y - h * 0.38, w + 0.38, 0.06, 0.06, m.dark, angle);
            for (let rail = -w / 2; rail <= w / 2; rail += 0.22)
              box(
                point(along + rail, 0.41),
                y - h * 0.15,
                0.025,
                0.64,
                0.035,
                m.dark,
                angle,
              );
            box(point(along, 0.41), y + h * 0.02, w + 0.38, 0.045, 0.055, m.dark, angle);
          }
          if (f === 0 && j % 3 === 1) {
            // Entry transom / handle. Visual portal only; no claimed interior geometry.
            box(point(along + w * 0.18, 0.25), 1.15, 0.04, 0.42, 0.08, m.trim, angle);
          }
        }
        if (j % 3 === 0 && step > 2.8 && b.height < 30) {
          box(
            point(along, 0.55),
            3.08,
            width + 0.4,
            0.16,
            1.3,
            j % 2 ? m.canvas : m.awning,
            angle,
          );
          box(
            point(along, 1.14),
            2.96,
            width + 0.4,
            0.23,
            0.08,
            j % 2 ? m.canvas : m.awning,
            angle,
          );
        }
        if (j % 3 === 0)
          box(
            point(j * step + 0.12, 0.09),
            b.height / 2,
            0.27,
            b.height - 0.4,
            0.25,
            m.stone,
            angle,
          );
      }
    }
  // Roof hardware remains within its host footprint, inset from the silhouette.
  if (buildingAt(b.center)?.id === b.id && b.height > 8) {
    for (const shift of [-2, 2]) {
      const p = { x: b.center.x + shift, z: b.center.z };
      if (
        ![
          [-2, -2],
          [2, 2],
          [-2, 2],
          [2, -2],
        ].every(([x, z]) => buildingAt({ x: p.x + x!, z: p.z + z! })?.id === b.id)
      )
        continue;
      box(p, b.height + 0.65, 2.2, 1.3, 3, m.trim);
      box(p, b.height + 1.32, 1.7, 0.08, 2.4, m.dark);
      for (let k = 0; k < 5; k++)
        box({ x: p.x, z: p.z - 0.8 + k * 0.4 }, b.height + 1.4, 1.6, 0.06, 0.1, m.dark);
    }
  }
}
export function detailStreet(builder: CityBuilder, m: DetailMaterials) {
  const { box, add } = builder,
    placed: Point[] = [];
  for (const way of pathWays) {
    if (way.crossing) continue;
    for (let i = 1; i < way.points.length; i++) {
      const a = way.points[i - 1]!,
        b = way.points[i]!,
        length = distance(a, b);
      if (distance(lerp(a, b, 0.5), row.point) > 220 || length < 8) continue;
      const angle = Math.atan2(b.x - a.x, b.z - a.z);
      for (let t = 6; t < length; t += 24) {
        const p = lerp(a, b, t / length);
        p.x += Math.cos(angle) * (way.width / 2 + 0.35);
        p.z -= Math.sin(angle) * (way.width / 2 + 0.35);
        if (buildingAt(p) || placed.some((q) => distance(p, q) < 17)) continue;
        placed.push(p);
        // Slim, fluted street lamp with an enclosed globe; no per-lamp light draw.
        const pole = new THREE.CylinderGeometry(0.055, 0.09, 4.6, 8);
        pole.translate(p.x, 2.3, p.z);
        add(pole, m.dark);
        box(p, 0.22, 0.26, 0.44, 0.26, m.dark);
        box(p, 4.55, 0.46, 0.12, 0.46, m.dark);
        const globe = new THREE.SphereGeometry(0.23, 8, 6);
        globe.scale(1, 1.45, 1);
        globe.translate(p.x, 4.91, p.z);
        add(globe, m.canvas);
        box(p, 5.23, 0.35, 0.1, 0.35, m.dark);
        if (placed.length % 2 === 0) {
          const q = { x: p.x + Math.sin(angle) * 2.1, z: p.z + Math.cos(angle) * 2.1 };
          if (buildingAt(q)) continue;
          // Slatted bench aligned to the sidewalk, kept out of its walking centre.
          for (let k = 0; k < 4; k++) {
            box(
              {
                x: q.x + Math.cos(angle) * (k - 0.5) * 0.09,
                z: q.z - Math.sin(angle) * (k - 0.5) * 0.09,
              },
              0.51,
              0.075,
              0.055,
              1.65,
              m.wood,
              angle,
            );
          }
          for (const side of [-1, 1])
            box(
              {
                x: q.x + Math.sin(angle) * 0.63 * side,
                z: q.z + Math.cos(angle) * 0.63 * side,
              },
              0.26,
              0.38,
              0.48,
              0.07,
              m.dark,
              angle,
            );
          box(
            { x: q.x + Math.cos(angle) * 0.23, z: q.z - Math.sin(angle) * 0.23 },
            0.85,
            0.07,
            0.5,
            1.65,
            m.wood,
            angle,
          );
          const planter = {
            x: q.x + Math.sin(angle) * 1.75,
            z: q.z + Math.cos(angle) * 1.75,
          };
          if (!buildingAt(planter)) {
            box(planter, 0.42, 0.7, 0.7, 0.7, m.dark, angle);
            box(planter, 0.79, 0.72, 0.08, 0.72, m.trim, angle);
            box(planter, 0.82, 0.6, 0.02, 0.6, m.soil, angle);
            const shrub = new THREE.SphereGeometry(0.38, 10, 7);
            shrub.scale(1, 0.8, 1);
            shrub.translate(planter.x, 1.02, planter.z);
            add(shrub, m.awning);
          }
        }
      }
    }
  }
  // Signature ring-light concept documented by The Lighting Practice.
  // Span, sag, diameter and placement are inferred from the mapped Lane.
  const lane = pathWays.find((w) => w.name === "Bethesda Lane");
  if (lane) {
    const a = lane.points[0]!,
      b = lane.points.at(-1)!,
      length = distance(a, b);
    const dx = (b.x - a.x) / length,
      dz = (b.z - a.z) / length;
    for (let t = 12; t < length - 8; t += 15) {
      const p = lerp(a, b, t / length),
        curve: THREE.Vector3[] = [];
      for (let k = 0; k <= 16; k++) {
        const across = -7 + (k * 14) / 16;
        curve.push(
          new THREE.Vector3(
            p.x - dz * across,
            6.2 + 0.017 * across * across,
            p.z + dx * across,
          ),
        );
      }
      add(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(curve), 16, 0.012, 4, false),
        m.dark,
      );
      const ring = new THREE.TorusGeometry(0.68, 0.035, 6, 24);
      ring.rotateX(Math.PI / 2);
      ring.translate(p.x, 5.9, p.z);
      add(ring, m.canvas);
    }
  }
}
