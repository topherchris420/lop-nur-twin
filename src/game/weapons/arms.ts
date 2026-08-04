import * as THREE from "three";
import { mergeAndDispose } from "./geometry";

/**
 * First-person arms.
 *
 * The rifle used to hang in space, unheld. That object occupies the lower
 * right of every frame in the game and is the single most-looked-at thing in
 * it, so its being unheld read instantly as unfinished — and it removed the
 * only object in frame that establishes the player as a physical body, which
 * is what every other object's scale is judged against.
 *
 * These are rigidly parented to the weapon's existing hand anchors rather than
 * solved with IK. That is not a shortcut, it is the correct model: in a first
 * person view the hands never move relative to the gun, so making them
 * children of it gets recoil, sway, aim-down-sights and the reload animation
 * for free and makes an elbow pop impossible. The forearms run back past the
 * near plane and are simply never seen to end.
 *
 * Everything is warm — coyote sleeves, dark earth gloves — because the weapon
 * being cool blue-grey in a desert already reads as pasted in from another
 * game, and two cool objects would read as a set.
 */

const GLOVE = 0x6f6050;
const GLOVE_DARK = 0x54483c;
const SLEEVE = 0x9c8a66;
const CUFF = 0x7d6c50;

export interface ArmsModel {
  /** Parent this under the weapon's right-hand anchor. */
  right: THREE.Group;
  /** Parent this under the weapon's left-hand anchor. */
  left: THREE.Group;
  triangleCount: number;
  dispose(): void;
}

interface Part {
  geometry: THREE.BufferGeometry;
  color: number;
}

function box(
  w: number, h: number, d: number,
  x: number, y: number, z: number,
  color: number,
  rx = 0, ry = 0, rz = 0,
): Part {
  const geometry = new THREE.BoxGeometry(w, h, d, 1, 1, 1);
  if (rx) geometry.rotateX(rx);
  if (ry) geometry.rotateY(ry);
  if (rz) geometry.rotateZ(rz);
  geometry.translate(x, y, z);
  return { geometry, color };
}

function tube(
  rTop: number, rBottom: number, length: number,
  x: number, y: number, z: number,
  color: number,
  rx = 0, ry = 0, rz = 0,
  segments = 10,
): Part {
  const geometry = new THREE.CylinderGeometry(rTop, rBottom, length, segments, 1, false);
  if (rx) geometry.rotateX(rx);
  if (ry) geometry.rotateY(ry);
  if (rz) geometry.rotateZ(rz);
  geometry.translate(x, y, z);
  return { geometry, color };
}

function knuckle(r: number, x: number, y: number, z: number, color: number, sy = 1): Part {
  const geometry = new THREE.SphereGeometry(r, 8, 6);
  geometry.scale(1, sy, 1);
  geometry.translate(x, y, z);
  return { geometry, color };
}

/**
 * A curled finger: three tapering segments hinged around a centre, so it
 * wraps whatever it is gripping instead of pointing at it.
 */
function finger(
  parts: Part[],
  x: number, y: number, z: number,
  radius: number,
  spread: number,
  color: number,
): void {
  // Proximal runs forward, middle turns down, distal turns back under.
  parts.push(tube(radius, radius * 0.96, 0.036, x, y, z - 0.016, color, Math.PI / 2, 0, spread));
  parts.push(knuckle(radius * 1.05, x, y, z - 0.034, color, 0.9));
  parts.push(tube(radius * 0.92, radius * 0.86, 0.03, x, y - 0.014, z - 0.046, color, Math.PI / 2.6, 0, spread));
  parts.push(knuckle(radius * 0.9, x, y - 0.026, z - 0.054, color, 0.9));
  parts.push(tube(radius * 0.84, radius * 0.74, 0.024, x, y - 0.04, z - 0.05, color, Math.PI / 1.9, 0, spread));
}

/**
 * The firing hand, closed around a pistol grip.
 *
 * Built in the anchor's local space with the grip running down and slightly
 * back, which is where `rightHand` sits on every weapon in the arsenal.
 */
function buildRightArm(parts: Part[]): void {
  // Palm and the back of the hand, tilted to follow the grip angle.
  parts.push(box(0.052, 0.10, 0.078, 0.006, -0.012, 0.006, GLOVE, 0.18, 0, 0.06));
  parts.push(box(0.05, 0.052, 0.07, 0.004, 0.03, -0.004, GLOVE, 0.1, 0, 0.05));

  // Four fingers wrapping the front of the grip, tucked progressively further
  // back so the hand reads as a fist rather than a comb.
  for (let i = 0; i < 4; i += 1) {
    finger(
      parts,
      0.004,
      0.038 - i * 0.024,
      -0.026 - i * 0.004,
      0.0115 - i * 0.0009,
      -0.06 - i * 0.02,
      i === 0 ? GLOVE : GLOVE_DARK,
    );
  }

  // Thumb over the top, across the receiver side.
  parts.push(tube(0.0135, 0.0125, 0.042, -0.02, 0.03, -0.012, GLOVE, Math.PI / 2.2, 0.5, 0));
  parts.push(knuckle(0.0125, -0.03, 0.022, -0.03, GLOVE, 0.95));
  parts.push(tube(0.0115, 0.0102, 0.03, -0.036, 0.012, -0.036, GLOVE, Math.PI / 2.4, 0.9, 0));

  // Wrist, cuff, sleeve. The forearm runs back and down past the near plane.
  parts.push(tube(0.031, 0.034, 0.05, 0.006, -0.062, 0.03, GLOVE_DARK, 1.25, 0, 0.05));
  parts.push(tube(0.041, 0.039, 0.022, 0.008, -0.086, 0.052, CUFF, 1.25, 0, 0.05));
  parts.push(tube(0.038, 0.05, 0.2, 0.014, -0.14, 0.14, SLEEVE, 1.25, 0, 0.05));
  parts.push(tube(0.05, 0.056, 0.14, 0.022, -0.19, 0.29, SLEEVE, 1.25, 0, 0.05));
}

/**
 * The support hand, wrapped over a handguard.
 *
 * The anchor sits just under the handguard, so the fingers come up the far
 * side and the thumb lies along the near one.
 */
function buildLeftArm(parts: Part[]): void {
  parts.push(box(0.05, 0.072, 0.10, -0.004, -0.018, 0.004, GLOVE, 0.06, 0, -0.1));
  parts.push(box(0.048, 0.04, 0.092, -0.004, 0.018, 0.002, GLOVE, 0.04, 0, -0.08));

  // Fingers reach up and over the handguard, splayed along its length.
  for (let i = 0; i < 4; i += 1) {
    const z = 0.036 - i * 0.026;
    parts.push(tube(0.0135, 0.0126, 0.046, 0.014, 0.02, z, GLOVE_DARK, 0, 0, Math.PI / 2 - 0.5));
    parts.push(knuckle(0.0132, 0.034, 0.036, z, GLOVE_DARK, 0.92));
    parts.push(tube(0.0124, 0.0112, 0.034, 0.038, 0.052, z, GLOVE_DARK, 0, 0, Math.PI / 3.4));
  }

  // Thumb along the near side, pointing forward.
  parts.push(tube(0.0135, 0.0125, 0.05, -0.026, 0.006, -0.014, GLOVE, Math.PI / 2.1, -0.32, 0));
  parts.push(tube(0.0115, 0.0104, 0.032, -0.034, 0.014, -0.05, GLOVE, Math.PI / 2.2, -0.5, 0));

  // Wrist and sleeve, running back, down and outboard to the left.
  parts.push(tube(0.03, 0.033, 0.05, -0.014, -0.052, 0.038, GLOVE_DARK, 1.0, 0, -0.42));
  parts.push(tube(0.04, 0.038, 0.022, -0.026, -0.07, 0.058, CUFF, 1.0, 0, -0.42));
  parts.push(tube(0.037, 0.048, 0.2, -0.07, -0.115, 0.15, SLEEVE, 1.0, 0, -0.42));
  parts.push(tube(0.048, 0.054, 0.14, -0.115, -0.15, 0.3, SLEEVE, 1.0, 0, -0.42));
}

/**
 * Merge a part list into one mesh per colour.
 *
 * Colour groups rather than vertex colours because the weapon module's merge
 * helper strips every attribute except position, normal and uv — and one draw
 * call per material across both arms is four in total, which is not worth
 * working around it for.
 */
function assemble(parts: Part[], materials: Map<number, THREE.MeshStandardMaterial>): {
  group: THREE.Group;
  triangles: number;
} {
  const group = new THREE.Group();
  let triangles = 0;
  const byColor = new Map<number, THREE.BufferGeometry[]>();
  for (const part of parts) {
    const list = byColor.get(part.color);
    if (list) list.push(part.geometry);
    else byColor.set(part.color, [part.geometry]);
  }
  for (const [color, geometries] of byColor) {
    const merged = mergeAndDispose(geometries);
    let material = materials.get(color);
    if (!material) {
      material = new THREE.MeshStandardMaterial({
        color,
        // Gloves are worn nylon and leather; sleeves are dusty ripstop.
        roughness: color === SLEEVE || color === CUFF ? 0.94 : 0.78,
        metalness: 0,
      });
      material.name = `arm-${color.toString(16)}`;
      materials.set(color, material);
    }
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = "viewmodel-arm";
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    group.add(mesh);
    const index = merged.getIndex();
    triangles += (index ? index.count : merged.attributes["position"]!.count) / 3;
  }
  return { group, triangles };
}

/** Build a pair of gloved arms for a weapon's hand anchors. */
export function buildArms(): ArmsModel {
  const materials = new Map<number, THREE.MeshStandardMaterial>();

  const rightParts: Part[] = [];
  buildRightArm(rightParts);
  const right = assemble(rightParts, materials);

  const leftParts: Part[] = [];
  buildLeftArm(leftParts);
  const left = assemble(leftParts, materials);

  return {
    right: right.group,
    left: left.group,
    triangleCount: right.triangles + left.triangles,
    dispose(): void {
      for (const group of [right.group, left.group]) {
        group.traverse((object) => {
          if (object instanceof THREE.Mesh) object.geometry.dispose();
        });
        group.clear();
      }
      for (const material of materials.values()) material.dispose();
      materials.clear();
    },
  };
}
