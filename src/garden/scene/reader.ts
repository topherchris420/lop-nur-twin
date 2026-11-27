import * as THREE from "three";
import { READER_SEAT } from "../core/layout.js";
import type { Light } from "../core/sky.js";
import type { ClayLibrary } from "./clay.js";
import pose from "./data/chrisw-reader.json";

// The original CHRISW mesh posed once at the wrist, elbow, knee and hip.
// Painted albedo is baked into the vertices so the garden needs no image files.
function bytes(encoded: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
}

const BOOK_Y = 0.4;
const BOOK_Z = 0.379;
const BOOK_TILT = 0.42;
const BOOK_OPEN = 0.32;
const COVER_EDGE = 0.19;
const LEAVES_THICKNESS = 0.018;
const LEAVES_CENTER_Z = -0.013;
function gripWeight(x: number, y: number, z: number): number {
  return (
    THREE.MathUtils.smoothstep(Math.abs(x), 0.045, 0.115) *
    THREE.MathUtils.smoothstep(z, 0.08, 0.255) *
    THREE.MathUtils.smoothstep(y, 0.19, 0.275) *
    (1 - THREE.MathUtils.smoothstep(y, 0.46, 0.62))
  );
}

// Seat both hands at the fore edges. Palms and cuffs move rigidly together;
// only the forearm transition is blended, away from the overlapping cuff faces.
export function readerGripPositions(mm: Int16Array): Float32Array {
  const positions = Float32Array.from(mm, (v) => v / 1000);
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i]!;
    const y = positions[i + 1]!;
    const z = positions[i + 2]!;
    const weight = gripWeight(x, y, z);
    positions[i] = x + Math.sign(x) * 0.027 * weight;
    positions[i + 2] = z - 0.029 * weight;
  }
  return positions;
}

function figureGeometry() {
  const g = new THREE.BufferGeometry();
  const mm = new Int16Array(bytes(pose.position).buffer);
  const positions = readerGripPositions(mm);
  g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  g.setAttribute(
    "normal",
    new THREE.BufferAttribute(new Int8Array(bytes(pose.normal).buffer), 3, true),
  );
  const srgb = bytes(pose.color);
  const linear = Float32Array.from(srgb, (v) => {
    const s = v / 255;
    // Lift the painted midtones in the shade.
    return (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4) ** 0.82;
  });
  // Relative shape keys from the posed mesh. Shoes and seated hips stay planted.
  const breath = new Float32Array(mm.length);
  const gaze = new Float32Array(mm.length);
  for (let i = 0; i < mm.length; i += 3) {
    const [x, y, z] = [mm[i]! / 1000, mm[i + 1]! / 1000, mm[i + 2]! / 1000];
    const chest = Math.max(
      THREE.MathUtils.smoothstep(y, 0.12, 0.38),
      gripWeight(x, y, z),
    );
    breath[i + 1] = chest * 0.004;
    breath[i + 2] = chest * 0.002;
    const neck = THREE.MathUtils.smoothstep(y, 0.67, 0.79);
    gaze[i] = neck * (z - 0.085) * 0.1;
    gaze[i + 2] = -neck * x * 0.1;
  }
  g.morphTargetsRelative = true;
  g.morphAttributes.position = [
    new THREE.BufferAttribute(breath, 3),
    new THREE.BufferAttribute(gaze, 3),
  ];
  g.setAttribute("color", new THREE.BufferAttribute(linear, 3));
  g.setIndex(new THREE.BufferAttribute(new Uint16Array(bytes(pose.index).buffer), 1));
  return g;
}

function bookJacket() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 704;
  const c = canvas.getContext("2d")!;
  c.fillStyle = "#266955";
  c.fillRect(0, 0, 512, 704);
  c.strokeStyle = c.fillStyle = "#ffe6af";
  c.lineWidth = 3;
  c.strokeRect(18, 18, 476, 668);
  c.strokeRect(26, 26, 460, 652);
  c.textAlign = "center";
  c.font = "bold 62px Georgia, serif";
  c.fillText("Beelzebub’s", 256, 161);
  c.fillText("Tales to His", 256, 232);
  c.fillText("Grandson", 256, 303);
  // A little foil-stamped eye over three concentric orbits.
  c.beginPath();
  c.ellipse(256, 446, 76, 31, 0, 0, 2 * Math.PI);
  for (const r of [17, 43, 59]) {
    c.moveTo(256 + r, 446);
    c.arc(256, 446, r, 0, 2 * Math.PI);
  }
  c.stroke();
  c.font = "bold 46px Georgia, serif";
  c.fillText("G. I. Gurdjieff", 256, 590);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function buildReader(lib: ClayLibrary) {
  const group = new THREE.Group();
  group.name = "CHRISW reading by the cedar fence";
  group.position.set(...READER_SEAT.position);
  group.scale.setScalar(READER_SEAT.scale);
  group.rotation.y = READER_SEAT.yaw;
  const cedar = lib.get("reader-bench-cedar", { color: 0x855537 });
  const iron = lib.get("reader-bench-iron", { color: 0x32413c });
  function slat(
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
    depth: number,
    material: THREE.Material,
  ) {
    const part = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    part.position.set(x, y, z);
    group.add(part);
  }
  for (const z of [-0.14, -0.035, 0.07, 0.175])
    slat(0, -0.008, z, 1.5, 0.044, 0.096, cedar);
  for (const y of [0.19, 0.36]) slat(0, y, -0.21, 1.5, 0.12, 0.038, cedar);
  for (const x of [-0.56, 0.56]) {
    slat(x, -0.22, 0.155, 0.045, 0.47, 0.045, iron);
    slat(x, -0.02, -0.21, 0.045, 0.87, 0.045, iron);
    slat(x, -0.055, 0, 0.055, 0.055, 0.46, iron);
  }
  const jacket = bookJacket();
  const figure = new THREE.Mesh(
    figureGeometry(),
    lib.get("chrisw-painted-clay", {
      color: 0xffffff,
      vertexColors: true,
      scale: 0.002,
      relief: 0.025,
      smudge: 0.03,
    }),
  );
  group.add(figure);
  const book = new THREE.Group();
  book.name = "Beelzebub’s Tales to His Grandson — G. I. Gurdjieff";
  // Local +Z faces the garden; the cream pages face the reader.
  book.position.set(0, BOOK_Y, BOOK_Z);
  book.rotation.x = BOOK_TILT;
  group.add(book);
  // The cream paper reflects daylight toward the reader's brow and cheeks.
  const pageBounce = new THREE.SpotLight(0xffdfb6, 0, 0.63, Math.PI / 6, 1);
  pageBounce.position.set(0.025, 0.095, -0.035);
  book.add(pageBounce);
  pageBounce.target.position.set(0, 0.78, 0.24);
  group.add(pageBounce.target);
  const cloth = lib.get("reader-cloth", { color: 0x17473e });
  const paper = lib.get("reader-paper", { color: 0xe8d9ab });
  const gilt = lib.get("reader-title", { color: 0xffffff, map: jacket });
  for (const side of [-1, 1]) {
    const half = new THREE.Group();
    half.rotation.y = -side * BOOK_OPEN;
    book.add(half);
    const leaves = new THREE.Mesh(
      new THREE.BoxGeometry(0.184, 0.267, LEAVES_THICKNESS),
      paper,
    );
    leaves.position.set(side * 0.092, 0, LEAVES_CENTER_Z);
    half.add(leaves);
    const cover = new THREE.Mesh(new THREE.BoxGeometry(COVER_EDGE, 0.279, 0.008), cloth);
    cover.position.x = (side * COVER_EDGE) / 2;
    half.add(cover);
    if (side === 1) {
      const title = new THREE.Mesh(new THREE.PlaneGeometry(0.188, 0.277), gilt);
      title.position.set(0.095, 0, 0.0042);
      half.add(title);
    }
  }
  // A single leaf turns about the binding, on the side facing the reader.
  const leafPivot = new THREE.Group();
  leafPivot.position.z = -0.024;
  const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.179, 0.26, 0.0008), paper);
  leaf.position.x = 0.0895;
  leafPivot.add(leaf);
  book.add(leafPivot);
  group.traverse((part) => {
    if (part instanceof THREE.Mesh) part.castShadow = part.receiveShadow = true;
  });
  return {
    group,
    update(time: number, reducedMotion: boolean, light: Light) {
      pageBounce.intensity =
        light.daylight * (0.055 * light.fill + 0.015 * light.sun.intensity);
      const breath = reducedMotion ? 0 : Math.sin(time * 1.41);
      figure.morphTargetInfluences![0] = breath;
      figure.morphTargetInfluences![1] = reducedMotion
        ? 0
        : Math.sin(time * 0.83) * 0.35 + Math.sin(time * 0.22) * 0.65;
      book.position.y = BOOK_Y + breath * 0.004;
      book.position.z = BOOK_Z + breath * 0.002;
      const page = THREE.MathUtils.smoothstep(time % 37, 34.4, 36.2);
      leafPivot.visible = !reducedMotion && page > 0 && page < 1;
      leafPivot.rotation.y = -0.32 + page * (Math.PI + 0.64);
    },
    dispose() {
      group.traverse((part) => {
        if (part instanceof THREE.Mesh) part.geometry.dispose();
      });
      pageBounce.dispose();
      jacket.dispose();
    },
  };
}
