import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { mulberry32 } from "@/lib/noise";

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
 * game, and two cool objects would read as a set. The glove is dielectric
 * nylon and leather: a normal map carries the grain, and nothing here is
 * metal, because a specular glove next to parkerised steel reads as chrome.
 */

const GLOVE = 0x8d7862;
const GLOVE_DARK = 0x6a5848;
const PAD = 0x9a8468;
const SLEEVE = 0xb09a72;
const CUFF = 0x7d6c50;
const STRAP = 0x3c342c;

/** Rifle pistol-grip rake. The pistol is a few degrees off this and still sits in the curl. */
const GRIP_PITCH = 0.3;
const GRIP_COS = Math.cos(GRIP_PITCH);
const GRIP_SIN = Math.sin(GRIP_PITCH);
/** Half-width and half-depth of the grip the firing hand is built around. */
const GRIP_HALF_W = 0.016;
const GRIP_HALF_D = 0.02;

/**
 * Handguard axis in the support anchor's frame.
 *
 * Every long gun places `leftHand` 1 cm under the tube, so the bottom of the
 * handguard is near y = 0.01 and the axis sits near y = 0.034. Clearing 2.4 cm
 * seats the glove on an AR; a fatter sniper shroud bites a few millimetres.
 */
const RAIL_Y = 0.0335;
const RAIL_CLEAR = 0.024;

/**
 * Support fingers sit forward of the anchor. The anchor is the foregrip
 * mount, and that grip occupies about z −0.02..0.01 — a palm centred on the
 * anchor swallows it.
 */
const SUPPORT_Z = [-0.076, -0.058, -0.04, -0.022] as const;

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

export interface ArmsModel {
  /** Parent this under the weapon's right-hand anchor. */
  right: THREE.Group;
  /** Parent this under the weapon's left-hand anchor. */
  left: THREE.Group;
  triangleCount: number;
  dispose(): void;
}

type ArmMaterialId =
  "glove" | "gloveWorn" | "pad" | "cuff" | "sleeve" | "sleeveDust" | "strap";

interface ArmPart {
  geometry: THREE.BufferGeometry;
  material: ArmMaterialId;
}

/* ------------------------------------------------------------------ */
/* Glove normal — one map for every weapon that holds a pair          */
/* ------------------------------------------------------------------ */

let gloveNormal: THREE.Texture | null = null;
let gloveNormalUsers = 0;

function fallbackNormal(): THREE.Texture {
  const data = new Uint8Array([128, 128, 255, 255]);
  const texture = new THREE.DataTexture(data, 1, 1);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.anisotropy = 8;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Pebbled nylon with two rows of stitch, baked once.
 *
 * A flat coyote albedo at 40 cm looks like a toy. The grain is what makes the
 * knuckle pad and the finger shafts read as different parts of the same glove
 * instead of two painted primitives. Built at 256 because the repeat, not the
 * texel count, sets the feature size on a hand this close.
 */
function makeGloveNormal(seed: number): THREE.Texture {
  if (typeof document === "undefined") return fallbackNormal();
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return fallbackNormal();

  const rand = mulberry32(seed);
  const height = new Float32Array(size * size);
  for (let i = 0; i < height.length; i += 1) height[i] = rand();

  const blurred = new Float32Array(size * size);
  const scratch = new Float32Array(size * size);
  const radius = 1;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let sum = 0;
      for (let dx = -radius; dx <= radius; dx += 1) {
        sum += height[y * size + ((x + dx + size) % size)]!;
      }
      scratch[y * size + x] = sum / (radius * 2 + 1);
    }
  }
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let sum = 0;
      for (let dy = -radius; dy <= radius; dy += 1) {
        sum += scratch[((y + dy + size) % size) * size + x]!;
      }
      blurred[y * size + x] = sum / (radius * 2 + 1);
    }
  }

  // Two circumferential seams plus a short cross-stitch, so the repeat reads
  // as construction rather than noise.
  for (const seam of [Math.floor(size * 0.34), Math.floor(size * 0.67)]) {
    for (let x = 0; x < size; x += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const y = (seam + dy + size) % size;
        const i = y * size + x;
        blurred[i] = (blurred[i] ?? 0) - 0.28;
      }
      if (x % 6 === 0) {
        const i = seam * size + x;
        blurred[i] = (blurred[i] ?? 0) + 0.55;
        const below = ((seam + 1) % size) * size + x;
        blurred[below] = (blurred[below] ?? 0) + 0.2;
      }
    }
  }

  const image = ctx.createImageData(size, size);
  const data = image.data;
  const strength = 1.7;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const l = blurred[y * size + ((x - 1 + size) % size)]!;
      const r = blurred[y * size + ((x + 1) % size)]!;
      const d = blurred[((y - 1 + size) % size) * size + x]!;
      const u = blurred[((y + 1) % size) * size + x]!;
      const nx = (l - r) * strength;
      const ny = (d - u) * strength;
      const nz = 1;
      const inv = 1 / Math.hypot(nx, ny, nz);
      const o = (y * size + x) * 4;
      data[o] = (nx * inv * 0.5 + 0.5) * 255;
      data[o + 1] = (ny * inv * 0.5 + 0.5) * 255;
      data[o + 2] = (nz * inv * 0.5 + 0.5) * 255;
      data[o + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  texture.colorSpace = THREE.NoColorSpace;
  // One tile per primitive is a blur. A few repeats put a stitch and a pebble
  // inside a single finger segment.
  texture.repeat.set(4, 4);
  return texture;
}

function retainGloveNormal(): THREE.Texture {
  if (!gloveNormal) gloveNormal = makeGloveNormal(0xa11ce);
  gloveNormalUsers += 1;
  return gloveNormal;
}

function releaseGloveNormal(): void {
  gloveNormalUsers = Math.max(0, gloveNormalUsers - 1);
  if (gloveNormalUsers === 0 && gloveNormal) {
    gloveNormal.dispose();
    gloveNormal = null;
  }
}

function armMaterial(
  name: string,
  color: number,
  roughness: number,
  normal: THREE.Texture,
  normalScale: number,
): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    name,
    color,
    roughness,
    metalness: 0,
    normalMap: normal,
  });
  material.normalScale.set(normalScale, normalScale);
  return material;
}

/* ------------------------------------------------------------------ */
/* Solids                                                              */
/* ------------------------------------------------------------------ */

function alignAxis(
  geometry: THREE.BufferGeometry,
  from: THREE.Vector3,
  to: THREE.Vector3,
): void {
  const direction = new THREE.Quaternion().setFromUnitVectors(from, to);
  geometry.applyQuaternion(direction);
}

function segment(
  from: THREE.Vector3,
  to: THREE.Vector3,
  rFrom: number,
  rTo: number,
  radial = 8,
): THREE.BufferGeometry {
  const delta = new THREE.Vector3().subVectors(to, from);
  const length = Math.max(delta.length(), 1e-4);
  // Open-ended: the joint sphere covers the rim, and a cap here z-fights it.
  const geometry = new THREE.CylinderGeometry(rTo, rFrom, length, radial, 1, true);
  alignAxis(geometry, Y_AXIS, delta.multiplyScalar(1 / length));
  geometry.translate((from.x + to.x) * 0.5, (from.y + to.y) * 0.5, (from.z + to.z) * 0.5);
  return geometry;
}

function joint(
  at: THREE.Vector3,
  radius: number,
  width = 10,
  height = 8,
): THREE.BufferGeometry {
  const geometry = new THREE.SphereGeometry(radius, width, height);
  geometry.translate(at.x, at.y, at.z);
  return geometry;
}

/**
 * A short thickened ring, not a sphere.
 *
 * A sphere at every crease reads as a string of beads. A glove's joint is a
 * slight swell in the same tube, and that is what still reads at 40 cm.
 */
function band(
  at: THREE.Vector3,
  axis: THREE.Vector3,
  radius: number,
  radial = 12,
): THREE.BufferGeometry {
  const direction = axis.clone();
  const length = direction.length();
  if (length < 1e-6) direction.set(0, 1, 0);
  else direction.multiplyScalar(1 / length);
  const geometry = new THREE.CylinderGeometry(
    radius,
    radius,
    Math.max(radius * 0.55, 0.0035),
    radial,
    1,
    true,
  );
  alignAxis(geometry, Y_AXIS, direction);
  geometry.translate(at.x, at.y, at.z);
  return geometry;
}

function pushBand(
  parts: ArmPart[],
  at: THREE.Vector3,
  before: THREE.Vector3,
  after: THREE.Vector3,
  radius: number,
  material: ArmMaterialId,
): void {
  parts.push({
    geometry: band(at, new THREE.Vector3().subVectors(after, before), radius),
    material,
  });
}

/** A squashed sphere. `ry` is along the grip after `pitch` is applied. */
function ellipsoid(
  center: THREE.Vector3,
  rx: number,
  ry: number,
  rz: number,
  pitch: number,
  width = 10,
  height = 8,
): THREE.BufferGeometry {
  const geometry = new THREE.SphereGeometry(1, width, height);
  geometry.scale(rx, ry, rz);
  if (pitch !== 0) geometry.rotateX(pitch);
  geometry.translate(center.x, center.y, center.z);
  return geometry;
}

/**
 * Point in the firing-hand anchor.
 *
 * `along` runs up the grip toward the receiver, `front` runs out the finger
 * side (toward the trigger), `x` is the ejection side. The curl is authored
 * here so a change in grip rake moves the whole fist together.
 */
function gripPoint(x: number, along: number, front: number): THREE.Vector3 {
  return new THREE.Vector3(
    x,
    -0.006 + along * GRIP_COS + front * GRIP_SIN,
    0.002 + along * GRIP_SIN - front * GRIP_COS,
  );
}

/** Angle 0 is the top of the handguard; positive angles fall toward +X. */
function overRail(angle: number, radius: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(
    Math.sin(angle) * radius,
    RAIL_Y + Math.cos(angle) * radius,
    z,
  );
}

function pushSegment(
  parts: ArmPart[],
  from: THREE.Vector3,
  to: THREE.Vector3,
  rFrom: number,
  rTo: number,
  material: ArmMaterialId,
  radial = 8,
): void {
  parts.push({ geometry: segment(from, to, rFrom, rTo, radial), material });
}

function extend(
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  distance: number,
): THREE.Vector3 {
  return origin.clone().addScaledVector(direction, distance);
}

/* ------------------------------------------------------------------ */
/* Firing hand                                                         */
/* ------------------------------------------------------------------ */

/**
 * Closed around a pistol grip: palm on the back face, knuckles on the
 * ejection side, thumb opposing across the top.
 *
 * The fingertips tuck onto the far side instead of sticking out radially.
 * A claw reads as a mannequin; a fist reads as someone holding the rifle.
 */
function addFiringFinger(
  parts: ArmPart[],
  along: number,
  radius: number,
  reach: number,
): void {
  // Each segment stays in one outside half-plane of the grip. A straight tube
  // between the side face and the front face chords through the corner, and
  // that reads as the finger buried in the polymer.
  const side = GRIP_HALF_W + radius * 0.55;
  const ahead = GRIP_HALF_D + radius * 0.9;
  const mcp = gripPoint(side + radius * 0.45, along + 0.005, -0.01);
  const pip = gripPoint(side, along - 0.002 * reach, ahead);
  const dip = gripPoint(-side, along - 0.01 * reach, ahead);
  const tip = gripPoint(-side - radius * 0.2, along - 0.018 * reach, 0.002);

  pushSegment(parts, mcp, pip, radius, radius * 0.94, "glove", 12);
  pushBand(parts, mcp, mcp, pip, radius * 1.16, "pad");
  pushSegment(parts, pip, dip, radius * 0.94, radius * 0.84, "gloveWorn", 12);
  pushBand(parts, pip, mcp, dip, radius * 1.02, "gloveWorn");
  pushSegment(parts, dip, tip, radius * 0.82, radius * 0.7, "gloveWorn", 12);
  parts.push({ geometry: joint(tip, radius * 0.72), material: "gloveWorn" });
}

function addFiringThumb(parts: ArmPart[]): void {
  // Stays on the off side of the grip. Crossing the top through the volume
  // puts the thumb inside the receiver; lying along the side is the oppose.
  const base = gripPoint(-0.02, 0.0, -0.034);
  const mp = gripPoint(-0.03, 0.016, -0.006);
  const ip = gripPoint(-0.028, 0.03, 0.01);
  const tip = gripPoint(-0.024, 0.034, 0.016);
  pushSegment(parts, base, mp, 0.014, 0.0125, "glove", 12);
  pushBand(parts, mp, base, ip, 0.0132, "glove");
  pushSegment(parts, mp, ip, 0.0122, 0.011, "glove", 12);
  pushBand(parts, ip, mp, tip, 0.0114, "glove");
  pushSegment(parts, ip, tip, 0.0106, 0.0092, "gloveWorn", 12);
  parts.push({ geometry: joint(tip, 0.009), material: "gloveWorn" });
}

function addPalm(parts: ArmPart[]): void {
  // A lathe, then squashed, because a sphere is a ball and a box is a block.
  // The profile is a palm: narrow at the wrist, full through the heel, tapering
  // into the knuckle row. Ends stay just open of zero so the lathe normals
  // don't collapse.
  const profile = [
    new THREE.Vector2(0.005, -0.056),
    new THREE.Vector2(0.016, -0.044),
    new THREE.Vector2(0.026, -0.024),
    new THREE.Vector2(0.03, -0.004),
    new THREE.Vector2(0.027, 0.018),
    new THREE.Vector2(0.018, 0.036),
    new THREE.Vector2(0.008, 0.048),
  ];
  const palm = new THREE.LatheGeometry(profile, 14);
  palm.scale(1.18, 1, 0.7);
  palm.rotateX(GRIP_PITCH);
  const center = gripPoint(0.002, -0.004, -0.05);
  palm.translate(center.x, center.y, center.z);
  parts.push({ geometry: palm, material: "glove" });

  // Thenar and heel break the turned silhouette. Without them the palm is a
  // spindle with fingers glued on.
  parts.push({
    geometry: ellipsoid(
      gripPoint(-0.022, 0.008, -0.036),
      0.015,
      0.02,
      0.012,
      GRIP_PITCH,
      8,
      6,
    ),
    material: "glove",
  });
  parts.push({
    geometry: ellipsoid(
      gripPoint(0.02, -0.03, -0.036),
      0.013,
      0.018,
      0.011,
      GRIP_PITCH,
      8,
      6,
    ),
    material: "gloveWorn",
  });
  // Dorsal mass sits on the knuckle side of the grip, not in it. A volume
  // centred on the back face disappears into the polymer.
  parts.push({
    geometry: ellipsoid(
      gripPoint(0.028, 0.006, -0.02),
      0.012,
      0.03,
      0.011,
      GRIP_PITCH,
      8,
      6,
    ),
    material: "glove",
  });
}

function addFiringForearm(parts: ArmPart[], wrist: THREE.Vector3): void {
  // Back and down, not out to the side: the firing elbow stays under the
  // stock. The second segment turns further back so the mesh crosses the
  // near plane instead of ending in frame as a stump.
  const upper = new THREE.Vector3(0.07, -0.74, 0.67).normalize();
  const lower = new THREE.Vector3(0.12, -0.5, 0.86).normalize();
  const cuff0 = extend(wrist, upper, 0.012);
  const cuff1 = extend(cuff0, upper, 0.024);
  const sleeve0 = extend(cuff1, upper, 0.02);
  const bend = extend(sleeve0, upper, 0.2);
  const end = extend(bend, lower, 0.34);

  pushSegment(parts, wrist, cuff0, 0.026, 0.024, "gloveWorn", 12);
  pushSegment(parts, cuff0, cuff1, 0.033, 0.035, "cuff", 12);
  pushSegment(parts, cuff1, sleeve0, 0.038, 0.036, "cuff", 12);
  pushSegment(parts, sleeve0, bend, 0.034, 0.044, "sleeve", 12);
  // The elbow changes direction. Two open tubes meet on a mitre and leave a
  // wedge of sky; a ball the same radius closes it without a new silhouette.
  parts.push({ geometry: joint(bend, 0.046, 12, 8), material: "sleeve" });
  pushSegment(parts, bend, end, 0.044, 0.054, "sleeveDust", 10);

  const strapAt = extend(cuff0, upper, 0.012);
  const strap = new THREE.TorusGeometry(0.03, 0.0038, 4, 12);
  alignAxis(strap, Z_AXIS, upper);
  strap.translate(strapAt.x, strapAt.y, strapAt.z);
  parts.push({ geometry: strap, material: "strap" });

  // Case sits on the dorsal wrist. Flattened and dielectric — a glass disc
  // here becomes a mirror under the viewmodel key.
  const watchAt = strapAt.clone().add(new THREE.Vector3(0.018, 0.004, -0.004));
  parts.push({
    geometry: ellipsoid(watchAt, 0.011, 0.007, 0.009, 0.4, 8, 6),
    material: "strap",
  });
}

function buildRightArm(parts: ArmPart[]): void {
  addPalm(parts);
  const fingers = [
    { along: 0.018, radius: 0.0112, reach: 1 },
    { along: 0.0, radius: 0.0108, reach: 1.05 },
    { along: -0.016, radius: 0.0101, reach: 0.96 },
    { along: -0.032, radius: 0.0092, reach: 0.84 },
  ] as const;
  for (const finger of fingers) {
    addFiringFinger(parts, finger.along, finger.radius, finger.reach);
  }
  // A darker cord in each valley. Same-colour tubes that touch become one
  // mitten; the crease is what lets four fingers read at viewmodel size.
  for (let i = 0; i < fingers.length - 1; i += 1) {
    const mid = (fingers[i]!.along + fingers[i + 1]!.along) * 0.5;
    pushSegment(
      parts,
      gripPoint(GRIP_HALF_W + 0.014, mid, -0.004),
      gripPoint(-GRIP_HALF_W * 0.2, mid, GRIP_HALF_D + 0.012),
      0.0036,
      0.0028,
      "gloveWorn",
      6,
    );
  }
  // One ridge tying the four pads together. Separate bumps read as warts;
  // a ridge reads as the rubber knuckle guard on a tactical glove.
  pushSegment(
    parts,
    gripPoint(GRIP_HALF_W + 0.02, 0.024, -0.008),
    gripPoint(GRIP_HALF_W + 0.016, -0.034, -0.01),
    0.0072,
    0.0058,
    "pad",
    7,
  );
  addFiringThumb(parts);
  addFiringForearm(parts, gripPoint(0.006, -0.05, -0.03));
}

/* ------------------------------------------------------------------ */
/* Support hand                                                        */
/* ------------------------------------------------------------------ */

function addSupportFinger(parts: ArmPart[], z: number, radius: number): void {
  const skin = RAIL_CLEAR + radius;
  // Two short outside chords. One segment from under the rail to the knuckle
  // cuts through the tube; the bridge stays in the free air beside it.
  const bridge = new THREE.Vector3(0.03, RAIL_Y - RAIL_CLEAR + 0.001, z);
  const root = overRail(1.5, skin, z);
  const mcp = overRail(1.05, skin, z);
  const pip = overRail(0.22, skin, z);
  const dip = overRail(-0.48, skin * 0.98, z);
  const tip = overRail(-1.05, skin * 0.9, z);

  pushSegment(parts, bridge, root, radius * 1.05, radius, "glove", 12);
  pushSegment(parts, root, mcp, radius, radius, "glove", 12);
  pushBand(parts, mcp, root, pip, radius * 1.14, "pad");
  pushSegment(parts, mcp, pip, radius, radius * 0.92, "glove", 12);
  pushBand(parts, pip, mcp, dip, radius * 1.02, "gloveWorn");
  pushSegment(parts, pip, dip, radius * 0.92, radius * 0.82, "gloveWorn", 12);
  pushBand(parts, dip, pip, tip, radius * 0.88, "gloveWorn");
  pushSegment(parts, dip, tip, radius * 0.8, radius * 0.68, "gloveWorn", 12);
  parts.push({ geometry: joint(tip, radius * 0.66), material: "gloveWorn" });
}

function addSupportThumb(parts: ArmPart[]): void {
  // Below and outboard of the tube. The old line ran through the handguard
  // because the thumb base sat on the centreline under the rail.
  const base = new THREE.Vector3(-0.028, 0.004, -0.036);
  const mid = new THREE.Vector3(-0.034, 0.01, -0.054);
  const tip = new THREE.Vector3(-0.03, 0.014, -0.076);
  pushSegment(parts, base, mid, 0.013, 0.0115, "glove", 12);
  pushBand(parts, mid, base, tip, 0.012, "glove");
  pushSegment(parts, mid, tip, 0.011, 0.0094, "gloveWorn", 12);
  parts.push({ geometry: joint(tip, 0.009), material: "gloveWorn" });
}

function addSupportForearm(parts: ArmPart[]): void {
  // Outboard as well as back and down: the support arm comes from the
  // player's left, and a forearm that only drops clips the magazine.
  const reach = new THREE.Vector3(-0.7, -0.5, 0.51).normalize();
  const back = new THREE.Vector3(-0.42, -0.46, 0.78).normalize();
  const wrist = new THREE.Vector3(-0.008, RAIL_Y - RAIL_CLEAR - 0.016, -0.034);
  const cuff0 = extend(wrist, reach, 0.014);
  const cuff1 = extend(cuff0, reach, 0.022);
  const sleeve0 = extend(cuff1, reach, 0.018);
  const bend = extend(sleeve0, reach, 0.18);
  const end = extend(bend, back, 0.34);

  pushSegment(parts, wrist, cuff0, 0.025, 0.023, "gloveWorn", 12);
  pushSegment(parts, cuff0, cuff1, 0.032, 0.034, "cuff", 12);
  pushSegment(parts, cuff1, sleeve0, 0.037, 0.034, "sleeve", 12);
  pushSegment(parts, sleeve0, bend, 0.033, 0.044, "sleeve", 12);
  parts.push({ geometry: joint(bend, 0.046, 12, 8), material: "sleeve" });
  pushSegment(parts, bend, end, 0.044, 0.054, "sleeveDust", 10);
}

function buildLeftArm(parts: ArmPart[]): void {
  const palm = new THREE.SphereGeometry(1, 12, 9);
  palm.scale(0.034, 0.014, 0.026);
  palm.translate(0.006, RAIL_Y - RAIL_CLEAR - 0.012, -0.049);
  parts.push({ geometry: palm, material: "glove" });

  // Heel, so the palm isn't a single ellipsoid floating under the rail.
  parts.push({
    geometry: ellipsoid(
      new THREE.Vector3(0.004, RAIL_Y - RAIL_CLEAR - 0.02, -0.03),
      0.02,
      0.012,
      0.016,
      0.15,
      8,
      6,
    ),
    material: "gloveWorn",
  });

  const radii = [0.011, 0.0106, 0.01, 0.009] as const;
  for (let i = 0; i < SUPPORT_Z.length; i += 1) {
    const z = SUPPORT_Z[i];
    const radius = radii[i];
    if (z === undefined || radius === undefined) continue;
    addSupportFinger(parts, z, radius);
  }
  const z0 = SUPPORT_Z[0];
  const z3 = SUPPORT_Z[3];
  if (z0 !== undefined && z3 !== undefined) {
    pushSegment(
      parts,
      overRail(0.7, RAIL_CLEAR + 0.014, z0),
      overRail(0.78, RAIL_CLEAR + 0.011, z3),
      0.0068,
      0.0054,
      "pad",
      7,
    );
  }
  addSupportThumb(parts);
  addSupportForearm(parts);
}

/* ------------------------------------------------------------------ */
/* Assembly                                                            */
/* ------------------------------------------------------------------ */

function normalizeNormals(geometry: THREE.BufferGeometry): void {
  const normal = geometry.getAttribute("normal");
  if (!normal) return;
  for (let i = 0; i < normal.count; i += 1) {
    const x = normal.getX(i);
    const y = normal.getY(i);
    const z = normal.getZ(i);
    const length = Math.hypot(x, y, z);
    if (length > 1e-8) normal.setXYZ(i, x / length, y / length, z / length);
  }
  normal.needsUpdate = true;
}

/**
 * Merge position/normal/uv only, and keep the index.
 *
 * Tangents need an index. The weapon helper de-indexes and drops every other
 * attribute, which is right for the gun and wrong for a normal-mapped glove.
 */
function mergeArmGeometries(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
  if (geometries.length === 0) return new THREE.BufferGeometry();
  const merged =
    geometries.length === 1 ? geometries[0]! : mergeGeometries(geometries, false);
  if (geometries.length > 1) {
    for (const geometry of geometries) geometry.dispose();
  }
  if (!merged) return new THREE.BufferGeometry();
  normalizeNormals(merged);
  if (merged.getIndex() && merged.getAttribute("uv") && merged.getAttribute("position")) {
    merged.computeTangents();
  }
  return merged;
}

function triangleCountOf(geometry: THREE.BufferGeometry): number {
  const index = geometry.getIndex();
  const count = index ? index.count : geometry.getAttribute("position").count;
  return count / 3;
}

function assemble(
  parts: ArmPart[],
  materials: Map<ArmMaterialId, THREE.MeshStandardMaterial>,
): { group: THREE.Group; triangles: number } {
  const group = new THREE.Group();
  let triangles = 0;
  const byMaterial = new Map<ArmMaterialId, THREE.BufferGeometry[]>();
  for (const part of parts) {
    const list = byMaterial.get(part.material);
    if (list) list.push(part.geometry);
    else byMaterial.set(part.material, [part.geometry]);
  }
  for (const [id, geometries] of byMaterial) {
    const material = materials.get(id);
    if (!material || geometries.length === 0) continue;
    const merged = mergeArmGeometries(geometries);
    const mesh = new THREE.Mesh(merged, material);
    // The name is what the viewmodel traversal keys on. Hiding it was the
    // old "weapon-only" silhouette; the mesh has to stay findable and drawn.
    mesh.name = "viewmodel-arm";
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    // The sleeve crosses the near plane. A bounds test culls the whole arm
    // once its centre sits behind the camera.
    mesh.frustumCulled = false;
    group.add(mesh);
    triangles += triangleCountOf(merged);
  }
  group.userData["triangles"] = triangles;
  return { group, triangles };
}

/** Build a pair of gloved arms for a weapon's hand anchors. */
export function buildArms(): ArmsModel {
  const normal = retainGloveNormal();
  const materials = new Map<ArmMaterialId, THREE.MeshStandardMaterial>([
    ["glove", armMaterial("arm-glove", GLOVE, 0.7, normal, 0.7)],
    ["gloveWorn", armMaterial("arm-glove-worn", GLOVE_DARK, 0.77, normal, 0.75)],
    ["pad", armMaterial("arm-knuckle-pad", PAD, 0.64, normal, 0.85)],
    ["cuff", armMaterial("arm-cuff", CUFF, 0.74, normal, 0.6)],
    ["sleeve", armMaterial("arm-sleeve", SLEEVE, 0.9, normal, 0.32)],
    ["sleeveDust", armMaterial("arm-sleeve-dust", SLEEVE, 0.93, normal, 0.28)],
    ["strap", armMaterial("arm-strap", STRAP, 0.88, normal, 0.4)],
  ]);

  const rightParts: ArmPart[] = [];
  buildRightArm(rightParts);
  const right = assemble(rightParts, materials);

  const leftParts: ArmPart[] = [];
  buildLeftArm(leftParts);
  const left = assemble(leftParts, materials);

  let released = false;
  return {
    right: right.group,
    left: left.group,
    triangleCount: right.triangles + left.triangles,
    dispose(): void {
      if (released) return;
      released = true;
      // Geometry stays on the meshes. The weapon root frees it when it
      // traverses children; freeing it here as well double-disposes, and the
      // unparented pistol support arm is released by the caller instead.
      for (const material of materials.values()) material.dispose();
      materials.clear();
      releaseGloveNormal();
    },
  };
}
