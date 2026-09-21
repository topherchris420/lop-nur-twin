import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import { mulberry32, seededNoise2D, SITE_SEED } from "@/lib/noise";
import { SITE_SIZE } from "@/lib/layout";

/**
 * Low ridges at the margin of the basin.
 *
 * Every outward-facing frame ended at a perfectly flat razor line where the
 * 40 km desert floor met the sky. A shooter frame wants a foreground
 * occluder, a mid-ground read and a background silhouette; this supplies the
 * third, which the map had none of at any heading.
 *
 * Two judgements worth recording, because the obvious version of this change
 * is wrong twice over:
 *
 *  - **Not in the twin.** The reconstruction at `/` is evidence-backed, and
 *    procedural mountains are invented terrain. Clutter was kept out of it for
 *    the same reason. This mounts on the combat route only.
 *  - **Close and low, not distant and dramatic.** `FogExp2` at density 0.0003
 *    is 99.99% saturated by 10 km, so a range out there would be a solid block
 *    of fog colour — invisible, and costly. And the real Lop Nur basin *is* a
 *    vast flat lakebed; a wall of peaks would be a lie about the place. So
 *    these are 40-180 m of relief starting just beyond the detail mesh, which
 *    is enough to break the horizon and read as the basin's edge without
 *    pretending the site sits in a valley.
 */

const INNER = SITE_SIZE * 0.52;
const OUTER = SITE_SIZE * 1.5;
const ANGULAR = 240;
const RADIAL = 26;

const ridge = seededNoise2D(0x1f7a);
const detail = seededNoise2D(0x4b21);

/** Ridge height at a polar position, in metres above the desert floor. */
function reliefAt(angle: number, radius: number): number {
  // Ramp in from nothing at the inner edge so the plain does not end in a step.
  const t = THREE.MathUtils.clamp((radius - INNER) / (SITE_SIZE * 0.45), 0, 1);
  const ramp = t * t * (3 - 2 * t);
  const x = Math.cos(angle) * radius;
  const z = Math.sin(angle) * radius;
  // Broad massifs, then a ridgeline octave sharpened by folding the noise.
  const broad = ridge(x / 5200, z / 5200) * 0.6 + 0.4;
  const folded = 1 - Math.abs(ridge(x / 1900 + 11, z / 1900 - 7));
  const grain = detail(x / 620, z / 620) * 0.5 + 0.5;
  const height = broad * (0.35 + folded * 0.75) * (0.8 + grain * 0.4);
  return Math.max(0, height) * 190 * ramp;
}

function buildRelief(): THREE.BufferGeometry {
  const vertices = (ANGULAR + 1) * (RADIAL + 1);
  const positions = new Float32Array(vertices * 3);
  const colors = new Float32Array(vertices * 3);
  const indices: number[] = [];

  const near = new THREE.Color("#8e836b");
  const far = new THREE.Color("#a89b81");
  const scratch = new THREE.Color();

  for (let r = 0; r <= RADIAL; r += 1) {
    // Squared spacing: rings bunch near the viewer where the silhouette is
    // read, and stretch out where everything is fog anyway.
    const rt = r / RADIAL;
    const radius = INNER + (OUTER - INNER) * rt * rt;
    for (let a = 0; a <= ANGULAR; a += 1) {
      const angle = (a / ANGULAR) * Math.PI * 2;
      const i = r * (ANGULAR + 1) + a;
      const height = reliefAt(angle, radius);
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = height - 6;
      positions[i * 3 + 2] = Math.sin(angle) * radius;
      // Sunlit crests pale off toward the haze; the feet stay in shadow.
      scratch.lerpColors(
        near,
        far,
        THREE.MathUtils.clamp(height / 150, 0, 1) * 0.7 + rt * 0.3,
      );
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
      indices.push(i0, i2, i1, i1, i2, i3);
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

const CLOUD_COUNT = 16;

/**
 * Soft desert cloud billboard. Seeded blobs, no download, alpha only at the
 * edges so FogExp2 can eat the silhouette the way real haze does.
 */
function makeCloudSpriteMap(): THREE.CanvasTexture {
  const S = 256;
  const canvas = document.createElement("canvas");
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");
  ctx.clearRect(0, 0, S, S);
  const rand = mulberry32(SITE_SEED + 0xc10d);
  for (let i = 0; i < 18; i += 1) {
    const cx = S * (0.26 + rand() * 0.48);
    const cy = S * (0.32 + rand() * 0.36);
    const rx = S * (0.14 + rand() * 0.22);
    const ry = rx * (0.45 + rand() * 0.35);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(rx, ry));
    g.addColorStop(0, `rgba(255,246,228,${0.28 + rand() * 0.38})`);
    g.addColorStop(1, "rgba(255,246,228,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, (rand() - 0.5) * 0.6, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function buildCloudDeck(): {
  group: THREE.Group;
  dispose: () => void;
} {
  const group = new THREE.Group();
  group.name = "distant-clouds";
  group.userData["noCollide"] = true;

  const map = makeCloudSpriteMap();
  const material = new THREE.SpriteMaterial({
    map,
    color: new THREE.Color("#d4c0a0"),
    transparent: true,
    depthWrite: false,
    fog: true,
    opacity: 0.78,
  });
  material.name = "distant-cloud";

  const rand = mulberry32(SITE_SEED + 0xc10e);
  for (let i = 0; i < CLOUD_COUNT; i += 1) {
    const sprite = new THREE.Sprite(material);
    const angle = (i / CLOUD_COUNT) * Math.PI * 2 + (rand() - 0.5) * 0.28;
    const radius = 1400 + rand() * 1600;
    sprite.position.set(
      Math.cos(angle) * radius,
      220 + rand() * 420,
      Math.sin(angle) * radius,
    );
    const width = 220 + rand() * 340;
    sprite.scale.set(width, width * (0.32 + rand() * 0.22), 1);
    sprite.castShadow = false;
    sprite.receiveShadow = false;
    sprite.userData["noCollide"] = true;
    sprite.renderOrder = -2;
    sprite.frustumCulled = false;
    group.add(sprite);
  }

  return {
    group,
    dispose: () => {
      group.clear();
      material.dispose();
      map.dispose();
    },
  };
}

export function DistantRelief() {
  const scene = useThree((s) => s.scene);

  const { geometry, material, clouds } = useMemo(() => {
    const g = buildRelief();
    const m = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 1,
      metalness: 0,
    });
    m.name = "distant-relief";
    return { geometry: g, material: m, clouds: buildCloudDeck() };
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
    scene.add(clouds.group);
    return () => {
      scene.remove(mesh);
      scene.remove(clouds.group);
      geometry.dispose();
      material.dispose();
      clouds.dispose();
    };
  }, [scene, geometry, material, clouds]);

  return null;
}
