/**
 * The other small life the server reports: a midge drifting over the lawn.
 * The server tracks only where it is (one of `learning.nearby`, an object
 * the fly can learn about but not change). Its body here is a non-biting
 * midge's (Chironomidae, about 2.5 mm, long-legged, wings held back over the
 * abdomen), in the same clay as the fly. The slow hover around the reported
 * position is presentation, the same for every visitor at the same instant.
 */
import * as THREE from "three";
import type { V3 } from "../core/vec.js";
import { withCascade, type ClayLibrary } from "./clay.js";
import { blob, compose, merge, placed, tube } from "./geometry.js";

/** Body frame: +x forward, +y up, +z to its right; metres. */
function midgeBody(): THREE.BufferGeometry {
  const q = new THREE.Quaternion();
  const parts: THREE.BufferGeometry[] = [
    placed(
      blob(1, { seed: 11, lumps: 0.06, detail: 2 }),
      compose([0.00062, 0.00002, 0], q, 0.00021),
    ),
    placed(
      blob(1, { seed: 12, lumps: 0.05, detail: 2, squash: [1.25, 1, 0.9] }),
      compose([0.00018, 0.00008, 0], q, 0.00034),
    ),
    tube(
      [
        [-0.00012, 0.00002, 0],
        [-0.0009, -0.00008, 0],
        [-0.0018, -0.00028, 0],
      ],
      [0.00019, 0.00016, 0.00009],
      { radial: 8, density: 4000, seed: 13, wobble: 0.05, caps: true },
    ),
  ];
  // Six long legs, hanging and splayed as a hovering midge holds them.
  const legs: [number, number][] = [
    [0.00038, 0.35],
    [0.00016, -0.05],
    [-0.00006, -0.45],
  ];
  for (const side of [-1, 1])
    for (const [x, sweep] of legs) {
      const root: V3 = [x, -0.0002, side * 0.00012];
      const knee: V3 = [x + sweep * 0.0009, -0.00035, side * 0.0011];
      const foot: V3 = [x + sweep * 0.0016, -0.0017, side * 0.0015];
      parts.push(
        tube([root, knee, foot], [0.000035, 0.000028, 0.00002], {
          radial: 4,
          density: 4000,
          seed: 20 + x * 1e5,
        }),
      );
    }
  // Antennae.
  for (const side of [-1, 1])
    parts.push(
      tube(
        [
          [0.0008, 0.00006, side * 0.00006],
          [0.0011, 0.00018, side * 0.00022],
          [0.00135, 0.00022, side * 0.0003],
        ],
        [0.00002, 0.000016, 0.00001],
        { radial: 4, density: 4000 },
      ),
    );
  return merge(parts.map((p) => (p.index ? p.toNonIndexed() : p)));
}

/** One wing, root at the origin, lying along −x. */
function wingShape(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.absellipse(-0.00075, 0, 0.00075, 0.00021, 0, Math.PI * 2, false, 0);
  return new THREE.ShapeGeometry(s, 16).rotateX(-Math.PI / 2);
}

export class Midge {
  readonly group = new THREE.Group();
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly heading = new THREE.Vector3(1, 0, 0);
  private readonly sweep: THREE.Mesh[] = [];

  constructor(lib: ClayLibrary) {
    this.group.name = "midge";
    this.group.visible = false;
    const clay = lib.get("midge", {
      color: 0x3a312a,
      roughness: 0.4,
      scale: 0.0012,
      relief: 0.02,
      smudge: 0.1,
      wrap: 0.4,
      scatter: 0x6a4228,
      objectSpace: true,
    });
    const body = midgeBody();
    const mesh = new THREE.Mesh(body, clay);
    mesh.castShadow = true;
    this.group.add(mesh);
    const film = lib.keep(
      withCascade(
        new THREE.MeshPhysicalMaterial({
          color: 0xe4e8ea,
          roughness: 0.45,
          transparent: true,
          opacity: 0.08,
          depthWrite: false,
          side: THREE.DoubleSide,
          iridescence: 0.6,
          iridescenceIOR: 1.35,
        }),
      ),
    );
    const wing = wingShape();
    this.geometries.push(body, wing);
    // Its wings beat several hundred times a second: drawn as the blur of the stroke.
    for (const side of [-1, 1])
      for (let k = 0; k < 4; k++) {
        const w = new THREE.Mesh(wing, film);
        w.position.set(0.00022, 0.00028, side * 0.00014);
        w.rotation.set(0, side * (0.35 + k * 0.32), side * (0.25 - k * 0.12));
        this.sweep.push(w);
        this.group.add(w);
      }
  }

  /** Places the midge at the reported point (or hides it), hovering a little about it. */
  update(at: V3 | null, t: number, ahead: V3 | null) {
    this.group.visible = at !== null;
    if (!at) return;
    const tau = 2 * Math.PI;
    const hover = new THREE.Vector3(
      0.004 * Math.sin(tau * 0.31 * t + 1.1) + 0.0015 * Math.sin(tau * 1.7 * t),
      0.003 * Math.sin(tau * 0.47 * t + 0.4) + 0.001 * Math.sin(tau * 2.3 * t + 2),
      0.004 * Math.sin(tau * 0.23 * t + 2.5) + 0.0015 * Math.sin(tau * 1.3 * t + 1),
    );
    this.group.position.set(...at).add(hover);
    // Face the way it is drifting, else keep the last heading.
    if (ahead) {
      const d = new THREE.Vector3(...ahead).sub(new THREE.Vector3(...at));
      d.y = 0;
      if (d.lengthSq() > 1e-8) this.heading.copy(d.normalize());
    }
    this.group.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), this.heading);
  }

  dispose() {
    this.group.removeFromParent();
    for (const g of this.geometries) g.dispose();
  }
}
