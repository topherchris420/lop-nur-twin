import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import { seededNoise2D } from "@/lib/noise";
import { SITE_SIZE } from "@/lib/layout";

/** Illustrative basin scenery for Blacksite. A low alluvial fan and a second,
 * broken escarpment give the flat play area a distant silhouette. Their
 * materials and geometry are exclusive to the fictional scene. */
const INNER = SITE_SIZE * 0.52;
const OUTER = SITE_SIZE * 1.5;
const ANGULAR = 240;
const RADIAL = 26;

const ridge = seededNoise2D(0x1f7a);
const detail = seededNoise2D(0x4b21);

/** Ridge height at a polar position, in metres above the desert floor. */
function reliefAt(x: number, z: number, radius: number): number {
  const t = (radius - INNER) / (OUTER - INNER);
  const fold = ridge(x / 2600, z / 2600);
  const spurs = 1 - Math.abs(ridge(x / 690 + fold, z / 510));
  const outcrop = 0.55 + 0.45 * detail(x / 1350, z / 1750);
  // Unequal widths give each range a long footslope and a steeper back.
  const front = Math.max(0, 1 - Math.abs(t - 0.31 - fold * 0.09) / 0.27);
  const back = Math.max(0, 1 - Math.abs(t - 0.72 + fold * 0.12) / 0.32);
  return (
    THREE.MathUtils.smoothstep(t, 0, 0.2) *
    (front * front * (60 + 125 * spurs) + back * (155 + 195 * spurs)) *
    outcrop
  );
}

function buildRelief(): THREE.BufferGeometry {
  const vertices = (ANGULAR + 1) * (RADIAL + 1);
  const positions = new Float32Array(vertices * 3);
  const colors = new Float32Array(vertices * 3);
  const indices: number[] = [];

  const near = new THREE.Color("#907562");
  const far = new THREE.Color("#838392");
  const exposedRock = new THREE.Color("#b39a80");
  const scratch = new THREE.Color();

  for (let r = 0; r <= RADIAL; r += 1) {
    // Squared spacing: rings bunch near the viewer where the silhouette is
    // read, and stretch out where everything is fog anyway.
    const rt = r / RADIAL;
    const radius = INNER + (OUTER - INNER) * rt * rt;
    for (let a = 0; a <= ANGULAR; a += 1) {
      const angle = ((a % ANGULAR) / ANGULAR) * Math.PI * 2;
      const i = r * (ANGULAR + 1) + a;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const height = reliefAt(x, z, radius);
      positions[i * 3] = x;
      positions[i * 3 + 1] = height - 6;
      positions[i * 3 + 2] = z;
      scratch.lerpColors(near, far, THREE.MathUtils.smoothstep(rt, 0.34, 0.7));
      const bedding = height * 0.033 + detail(x / 850, z / 850) * 1.5;
      scratch.lerp(exposedRock, (0.5 + 0.5 * Math.cos(bedding)) * 0.24);
      colors[i * 3] = scratch.r;
      colors[i * 3 + 1] = scratch.g;
      colors[i * 3 + 2] = scratch.b;
    }
  }

  for (let r = 0; r < RADIAL; r += 1) {
    for (let a = 0; a < ANGULAR; a += 1) {
      const i0 = r * (ANGULAR + 1) + a;
      const i1 = i0 + 1;
      const i2 = i0 + (ANGULAR + 1);
      const i3 = i2 + 1;
      // Increasing azimuth runs toward +z at the eastern edge.
      // Wind top faces toward the sky so Three lights and draws the ridges.
      indices.push(i0, i1, i2, i1, i3, i2);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

export function DistantRelief() {
  const scene = useThree((s) => s.scene);

  const { geometry, material } = useMemo(() => {
    const g = buildRelief();
    const m = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 1,
      metalness: 0,
    });
    m.name = "distant-relief";
    return { geometry: g, material: m };
  }, []);

  useEffect(() => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = "distant-relief";
    // Far outside the shadow frustum, never collided with, and it must never
    // be picked up by the collision baker's whole-scene fallback.
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.userData["noCollide"] = true;
    mesh.renderOrder = -1;
    scene.add(mesh);
    return () => {
      scene.remove(mesh);
      geometry.dispose();
      material.dispose();
    };
  }, [scene, geometry, material]);

  return null;
}
