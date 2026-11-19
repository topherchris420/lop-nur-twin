import * as THREE from "three";
import { patchShader } from "../gfx/shaderPatch";
import { bounds, buildings, type Point } from "./model";
import { groundAt } from "./terrain";
import { SUN, streetTrees, treeShape } from "./furniture";
import { mappedTrees } from "./streetscape";

const spanX = bounds.max.x - bounds.min.x;
const spanZ = bounds.max.z - bounds.min.z;

/** Intersection of a ray away from the city's sun with the sampled ground.
 * Two terrain refinements account for the slope between a roof and its shadow. */
export function projectSunShadow(p: Point, elevation: number, terrain = groundAt): Point {
  let hit = p;
  for (let i = 0; i < 3; i++) {
    const drop = Math.max(0, elevation - terrain(hit)) / SUN.offset.y;
    hit = { x: p.x - SUN.offset.x * drop, z: p.z - SUN.offset.z * drop };
  }
  return hit;
}

/** Two light masks for static ground. Red measures contact occlusion, green the
 * clear line to the sun. Coordinates and heights come from the render model. */
export function bakeStreetLight(): THREE.CanvasTexture {
  const size = 1024;
  const surface = () => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    return canvas.getContext("2d")!;
  };
  const contact = surface(),
    sun = surface();
  for (const ctx of [contact, sun])
    ctx.setTransform(
      size / spanX,
      0,
      0,
      size / spanZ,
      (-bounds.min.x * size) / spanX,
      (-bounds.min.z * size) / spanZ,
    );
  function trace(ctx: CanvasRenderingContext2D, ring: readonly Point[]) {
    if (!ring.length) return;
    ctx.moveTo(ring[0]!.x, ring[0]!.z);
    for (let i = 1; i < ring.length; i++) ctx.lineTo(ring[i]!.x, ring[i]!.z);
    ctx.closePath();
  }

  contact.strokeStyle = "#58ffff";
  contact.lineWidth = 3;
  contact.lineJoin = "round";
  sun.fillStyle = "#ff16ff";
  for (const b of buildings) {
    const top = groundAt(b.center) + b.height;
    const rings = [b.ring, ...b.holes];
    contact.beginPath();
    for (const ring of rings) trace(contact, ring);
    contact.stroke();

    // Project the roof, preserving courtyard holes, then close the silhouette
    // between roof and footing. Each opaque wall joins the same shadow.
    const projected = rings.map((ring) => ring.map((p) => projectSunShadow(p, top)));
    sun.beginPath();
    for (const ring of projected) trace(sun, ring);
    sun.fill("evenodd");
    for (const [r, ring] of rings.entries()) {
      const roof = projected[r]!;
      for (let i = 1; i < ring.length; i++) {
        sun.beginPath();
        trace(sun, [ring[i - 1]!, ring[i]!, roof[i]!, roof[i - 1]!]);
        sun.fill();
      }
    }
  }

  // Each overlapping crown transmits some light. The trunks have a separate
  // contact patch at their foot, so the two cues keep their proper direction.
  sun.fillStyle = "rgba(255,76,255,0.44)";
  contact.fillStyle = "#79ffff";
  const crown = (p: Point, elevation: number, radius: number) => {
    const q = projectSunShadow(p, elevation);
    sun.beginPath();
    sun.ellipse(
      q.x,
      q.z,
      radius * Math.hypot(1, Math.hypot(SUN.offset.x, SUN.offset.z) / SUN.offset.y),
      radius,
      Math.atan2(SUN.offset.z, SUN.offset.x),
      0,
      2 * Math.PI,
    );
    sun.fill();
  };
  const foot = (p: Point) => {
    contact.beginPath();
    contact.arc(p.x, p.z, 1.2, 0, 2 * Math.PI);
    contact.fill();
  };
  for (const t of streetTrees()) {
    foot(t.point);
    const base = groundAt(t.point);
    for (const c of t.crowns) crown(c, base + c.y, c.r);
  }
  for (const t of mappedTrees) {
    foot(t.point);
    const base = groundAt(t.point);
    for (const c of treeShape(t.osmId).crowns)
      crown({ x: t.point.x + c.dx, z: t.point.z + c.dz }, base + c.y, c.r);
  }

  const out = surface();
  out.fillStyle = "#fff";
  out.fillRect(0, 0, size, size);
  out.globalCompositeOperation = "multiply";
  out.filter = "blur(1.5px)";
  out.drawImage(contact.canvas, 0, 0);
  out.filter = "blur(0.6px)";
  out.drawImage(sun.canvas, 0, 0);
  const map = new THREE.CanvasTexture(out.canvas);
  // Canvas row zero and shader v=0 both represent the northern edge.
  map.flipY = false;
  return map;
}

export function applyStreetLight(
  material: THREE.MeshStandardMaterial,
  map: THREE.Texture,
  amount: THREE.IUniform<number>,
) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.cityStreetLight = { value: map };
    shader.uniforms.cityStreetLightAmount = amount;
    shader.uniforms.cityStreetBounds = {
      value: new THREE.Vector4(bounds.min.x, bounds.min.z, 1 / spanX, 1 / spanZ),
    };
    shader.vertexShader = patchShader(
      "Bethesda street light (vertex)",
      shader.vertexShader,
      [
        [
          "#include <common>",
          "#include <common>\nuniform vec4 cityStreetBounds;\nvarying vec2 vCityStreetUv;",
        ],
        [
          "#include <project_vertex>",
          `#include <project_vertex>
       vCityStreetUv = ((modelMatrix * vec4(transformed,1.0)).xz - cityStreetBounds.xy) * cityStreetBounds.zw;`,
        ],
      ],
    );
    shader.fragmentShader = patchShader(
      "Bethesda street light (fragment)",
      shader.fragmentShader,
      [
        [
          "#include <common>",
          "#include <common>\nuniform sampler2D cityStreetLight;\nuniform float cityStreetLightAmount;\nvarying vec2 vCityStreetUv;",
        ],
        [
          "#include <aomap_fragment>",
          `#include <aomap_fragment>
       vec2 streetVisibility = mix(vec2(1.0), texture2D(cityStreetLight, vCityStreetUv).rg, cityStreetLightAmount);
       reflectedLight.indirectDiffuse *= streetVisibility.r;
       #ifndef USE_SHADOWMAP
         reflectedLight.directDiffuse *= streetVisibility.g;
         reflectedLight.directSpecular *= streetVisibility.g;
       #endif`,
        ],
      ],
    );
  };
  material.customProgramCacheKey = () => "bethesda-street-light-v1";
  return material;
}
