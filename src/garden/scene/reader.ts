import * as THREE from "three";
import { READER_SEAT } from "../core/layout.js";
import type { ClayLibrary } from "./clay.js";
import pose from "./data/chrisw-reader.json";

// The original CHRISW mesh posed once at the wrist, elbow, knee and hip.
// Painted albedo is baked into the vertices so the garden needs no image files.
function bytes(encoded: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
}

function figureGeometry() {
  const g = new THREE.BufferGeometry();
  const mm = new Int16Array(bytes(pose.position).buffer);
  g.setAttribute(
    "position",
    new THREE.BufferAttribute(
      Float32Array.from(mm, (v) => v / 1000),
      3,
    ),
  );
  g.setAttribute(
    "normal",
    new THREE.BufferAttribute(new Int8Array(bytes(pose.normal).buffer), 3, true),
  );
  const srgb = bytes(pose.color);
  const linear = Float32Array.from(srgb, (v) => {
    const s = v / 255;
    // Lift the painted midtones for the shaded window recess.
    return (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4) ** 0.82;
  });
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
  group.name = "CHRISW on the windowsill";
  group.position.set(...READER_SEAT.position);
  group.scale.setScalar(READER_SEAT.scale);
  group.rotation.y = READER_SEAT.yaw;
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
  book.position.set(0, 0.4, 0.379);
  book.rotation.x = 0.42;
  group.add(book);
  const cloth = lib.get("reader-cloth", { color: 0x17473e });
  const paper = lib.get("reader-paper", { color: 0xe8d9ab });
  const gilt = lib.get("reader-title", { color: 0xffffff, map: jacket });
  for (const side of [-1, 1]) {
    const half = new THREE.Group();
    half.rotation.y = -side * 0.32;
    book.add(half);
    const leaves = new THREE.Mesh(new THREE.BoxGeometry(0.184, 0.267, 0.018), paper);
    leaves.position.set(side * 0.092, 0, -0.013);
    half.add(leaves);
    const cover = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.279, 0.008), cloth);
    cover.position.x = side * 0.095;
    half.add(cover);
    if (side === 1) {
      const title = new THREE.Mesh(new THREE.PlaneGeometry(0.188, 0.277), gilt);
      title.position.set(0.095, 0, 0.0042);
      half.add(title);
    }
  }
  group.traverse((part) => {
    if (part instanceof THREE.Mesh) part.castShadow = part.receiveShadow = true;
  });
  return {
    group,
    dispose() {
      group.traverse((part) => {
        if (part instanceof THREE.Mesh) part.geometry.dispose();
      });
      jacket.dispose();
    },
  };
}
