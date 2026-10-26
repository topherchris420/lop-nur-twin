/**
 * The maple: a trunk off to the left, one long branch reaching over the
 * lawn, twigs of turning leaves, and two leaves that matter.
 *
 * - The **shelter leaf**, which the fly rests under, is a sculpted slab of
 *   clay whose underside is flat exactly where `stage.ts` perches the fly
 *   (1.6 mm below the blade's centre plane). It turns on its stalk with the
 *   same `swayFrame("leaf")` the fly's perch rides on.
 * - The **swaying leaf** is the one the server tracks (`swaying_leaf`): it
 *   hangs from the branch and is turned on its stalk so its centre follows
 *   the server's reported offset.
 */
import * as THREE from "three";
import { LAYOUT } from "../core/layout.js";
import type { Quality } from "../core/quality.js";
import { add, distance, normalize, scale, sub, type V3 } from "../core/vec.js";
import { casterMaterial, type ClayLibrary, type WindSettings } from "./clay.js";
import { frameQuat, lathe, leafSheet, merge, noise3, rng, tube } from "./geometry.js";
import { inCell, type DecalAtlas } from "./textures.js";

const M = LAYOUT.maple;
/** The maple outline's blade centre and stalk notch, in its atlas cell (0…1, y down). */
const CELL_CENTER: [number, number] = [0.5, 0.56];
const CELL_STALK = 0.95;

const LEAF_WIND: WindSettings = { axis: "z", length: 1, amount: 0.1 };

/**
 * A maple leaf as a thick sheet of clay: two faces (cut out by the atlas
 * outline) joined by a rim along the outline. Local frame: blade centre at
 * the origin, the tip toward +z, the upper surface +y; the underside lies
 * at y = `under`, flat out to `flat` metres from the centre, the margins
 * drooping beyond.
 */
function leafSlab(
  atlas: DecalAtlas,
  size: number,
  under: number,
  thickness: number,
  flat: number,
  seed: number,
) {
  const n = noise3(seed);
  const droop = (x: number, z: number) => {
    const d = Math.hypot(x, z);
    const e = Math.max(0, d - flat);
    return -9 * e * e + (e > 0 ? 0.0006 * n(x * 60, z * 60, 0) : 0);
  };
  const toLocal = (u: number, v: number): [number, number] => [
    (u - CELL_CENTER[0]) * size,
    (CELL_CENTER[1] - v) * size,
  ];
  const grid = 44;
  const positions: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  for (const [y0, sign] of [
    [under + thickness, 1],
    [under, -1],
  ] as const) {
    const start = positions.length / 3;
    for (let j = 0; j <= grid; j++)
      for (let i = 0; i <= grid; i++) {
        const u = i / grid,
          v = j / grid;
        const [x, z] = toLocal(u, v);
        positions.push(x, y0 + droop(x, z), z);
        uvs.push(...inCell(atlas.cells.maple, u, v));
      }
    for (let j = 0; j < grid; j++)
      for (let i = 0; i < grid; i++) {
        const a = start + j * (grid + 1) + i,
          b = a + 1,
          c = a + grid + 1,
          d = c + 1;
        // Upper face toward +y, lower toward −y.
        if (sign > 0) index.push(a, c, b, b, c, d);
        else index.push(a, b, c, b, d, c);
      }
  }
  // The rim: a ribbon round the outline from the underside to the top, its
  // texture sampled just inside the edge where the cut-out is opaque.
  const outline = atlas.mapleOutline;
  const rimStart = positions.length / 3;
  for (const [u, v] of outline) {
    const [x, z] = toLocal(u, v);
    const iu = CELL_CENTER[0] + (u - CELL_CENTER[0]) * 0.96,
      iv = CELL_CENTER[1] + (v - CELL_CENTER[1]) * 0.96;
    for (const y of [under, under + thickness]) {
      positions.push(x, y + droop(x, z), z);
      uvs.push(...inCell(atlas.cells.maple, iu, iv));
    }
  }
  const count = outline.length;
  for (let k = 0; k < count; k++) {
    const a = rimStart + 2 * k,
      b = rimStart + 2 * ((k + 1) % count);
    index.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** A leaf's local frame in the world: centre, upper-surface normal and tip direction. */
function leafMatrix(center: V3, normal: V3, tip: V3): THREE.Matrix4 {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(...center),
    frameQuat(normalize(normal), normalize(tip)),
    new THREE.Vector3(1, 1, 1),
  );
  return m;
}

export interface MapleSet {
  group: THREE.Group;
  /** Pivots at its stalk's twig; turned by `swayFrame("leaf")`. */
  shelter: THREE.Group;
  /** Pivots at its twig; turned so its centre follows the server's offset. */
  swaying: THREE.Group;
  /** The swaying leaf's centre relative to its pivot, at rest. */
  swayingArm: V3;
  dispose(): void;
}

export function buildMaple(lib: ClayLibrary, atlas: DecalAtlas, q: Quality): MapleSet {
  const r = rng(0x3a91);
  const group = new THREE.Group();
  group.name = "maple";
  const bark = lib.get("bark", {
    color: 0x6b5e52,
    roughness: 0.8,
    scale: 0.05,
    relief: 0.08,
    smudge: 0.12,
  });
  // --- trunk and limbs
  const t = M.trunk;
  const trunk = lathe(
    [
      [0.001, -0.06],
      [t.radius * 1.5, -0.06],
      [t.radius * 1.3, 0.08],
      [t.radius * 1.12, 0.35],
      [t.radius, 1.0],
      [t.radius * 0.94, 2.0],
      [t.radius * 0.84, 3.4],
      [0.001, 3.42],
    ],
    { segments: 40, seed: 0x3a92, wobble: 0.07, lumps: 6, lean: 0.03, leanDir: 2.4 },
  );
  trunk.translate(t.x, 0, t.z);
  const limbs = [
    tube(
      [
        [t.x + 0.02, 2.2, t.z],
        [t.x + 0.25, 2.9, t.z - 0.2],
        [t.x + 0.5, 3.6, t.z - 0.45],
      ],
      [0.1, 0.07, 0.04],
      { radial: 12, density: 12, seed: 0x3a93, wobble: 0.12 },
    ),
    tube(
      [
        [t.x, 2.6, t.z + 0.02],
        [t.x - 0.2, 3.2, t.z + 0.35],
        [t.x - 0.25, 3.8, t.z + 0.6],
      ],
      [0.08, 0.05, 0.03],
      { radial: 12, density: 12, seed: 0x3a94, wobble: 0.12 },
    ),
  ];
  // The long branch over the lawn, from the points in the layout.
  const branch = tube(
    M.branch.map((b) => b.p),
    M.branch.map((b) => b.r),
    { radial: 14, density: 45, seed: 0x3a95, wobble: 0.1 },
  );
  const curve = new THREE.CatmullRomCurve3(
    M.branch.map((b) => new THREE.Vector3(...b.p)),
    false,
    "centripetal",
  );
  const branchAt = (u: number): V3 => {
    const p = curve.getPointAt(u);
    return [p.x, p.y, p.z];
  };
  const radiusAt = (u: number) => {
    const x = u * (M.branch.length - 1);
    const i = Math.min(M.branch.length - 2, Math.floor(x));
    return M.branch[i]!.r + (M.branch[i + 1]!.r - M.branch[i]!.r) * (x - i);
  };
  const twigs: THREE.BufferGeometry[] = [];
  // The two special leaves' stalks: twig and petiole.
  const shelter = M.shelter;
  const shelterBase = add(
    shelter.center,
    scale(normalize(shelter.tip), -(CELL_STALK - CELL_CENTER[1]) * shelter.size),
  );
  const branchNearShelter = branchAt(0.86);
  twigs.push(
    tube(
      [
        add(branchNearShelter, [0, -radiusAt(0.86) * 0.5, 0]),
        [shelter.twig[0] - 0.01, shelter.twig[1] + 0.004, shelter.twig[2] + 0.03],
        shelter.twig,
      ],
      [0.007, 0.005, 0.0035],
      {
        radial: 8,
        density: 120,
        seed: 0x3a96,
        wobble: 0.1,
      },
    ),
  );
  // Leaves along the branch: clusters at the ends of side twigs.
  const leafMats: THREE.Matrix4[] = [];
  const leafColors: THREE.Color[] = [];
  const avoid: V3[] = [shelter.center, M.swaying.center];
  const tints = [0xffffff, 0xffc890, 0xff9a70, 0xe8d070, 0xd6e090, 0xffb070].map(
    (h) => new THREE.Color(h),
  );
  // Most of them on the stretch that reaches into the picture, so the branch
  // reads as a bough of turning leaves over the lawn rather than a bare stick.
  const clusters = q.name === "performance" ? 20 : 38;
  for (let c = 0; c < clusters; c++) {
    const u = 0.36 + (0.62 * (c + r() * 0.6)) / clusters;
    const base = branchAt(u);
    const around = r() * Math.PI * 2;
    const dir = normalize([
      Math.cos(around) * 0.6,
      -0.55 + r() * 0.5,
      Math.sin(around) * 0.8,
    ]);
    const len = 0.07 + r() * 0.13;
    const end = add(base, scale(dir, len));
    if (avoid.some((a) => distance(a, end) < 0.11)) continue;
    const mid = add(add(base, scale(dir, len * 0.5)), [0, 0.02, 0]);
    twigs.push(
      tube([base, mid, end], [radiusAt(u) * 0.35, 0.004, 0.0025], {
        radial: 6,
        density: 120,
        seed: 0x3b00 + c,
        wobble: 0.1,
      }),
    );
    const leaves = 4 + Math.floor(r() * 4);
    for (let k = 0; k < leaves; k++) {
      const spread = (k / (leaves - 1 || 1) - 0.5) * 2.2 + (r() - 0.5) * 0.4;
      const tip = normalize(
        add(dir, [
          Math.cos(around + spread) * 0.8,
          -0.6 - r() * 0.5,
          Math.sin(around + spread) * 0.8,
        ]),
      );
      // Hanging blades turn their faces out toward the light and the lawn, not flat to the sky.
      const up: V3 = normalize([(r() - 0.5) * 0.9, 0.3 + r() * 0.5, 0.5 + r() * 0.7]);
      const size = 0.07 + r() * 0.04;
      const stalk = add(end, scale(tip, 0.02 + r() * 0.02));
      if (avoid.some((a) => distance(a, stalk) < 0.09)) continue;
      leafMats.push(
        new THREE.Matrix4().compose(
          new THREE.Vector3(...stalk),
          frameQuat(up, tip),
          new THREE.Vector3(size, size, size),
        ),
      );
      leafColors.push(tints[Math.floor(r() * tints.length)]!);
    }
  }
  const woody = new THREE.Mesh(merge([trunk, ...limbs, branch, ...twigs]), bark);
  woody.name = "maple wood";
  woody.castShadow = woody.receiveShadow = true;
  group.add(woody);
  // Canopy above the frame: masses of turning leaves that throw dappled shade on the lawn.
  const canopy: THREE.Mesh[] = [];
  const canopyColors = [0xb4652e, 0xc78a3a, 0xa2482a, 0x9a8a3a];
  for (let k = 0; k < 7; k++) {
    const g = new THREE.IcosahedronGeometry(1, 3);
    const nn = noise3(0x3c00 + k);
    const pos = g.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i),
        y = pos.getY(i),
        z = pos.getZ(i);
      const kk = 1 + 0.28 * nn(x * 1.8, y * 1.8, z * 1.8);
      pos.setXYZ(i, x * kk, y * kk * 0.7, z * kk);
    }
    g.computeVertexNormals();
    const s = 0.6 + r() * 0.5;
    g.scale(s, s, s);
    g.translate(t.x + 0.3 + (r() - 0.3) * 1.6, 3.3 + r() * 0.8, t.z + (r() - 0.5) * 1.4);
    const color = canopyColors[k % canopyColors.length]!;
    const mesh = new THREE.Mesh(
      g,
      lib.get(`canopy-${color}`, {
        color,
        roughness: 0.85,
        scale: 0.4,
        relief: 0.08,
        smudge: 0.2,
        wrap: 0.6,
        scatter: 0xa04010,
      }),
    );
    mesh.castShadow = true;
    canopy.push(mesh);
  }
  group.add(...canopy);
  // --- leaves on the twigs (instanced, fluttering)
  const leafGeo = leafSheet({
    length: 1,
    width: 1,
    along: 6,
    across: 6,
    curl: -0.35,
    cup: 0.12,
    buckle: 0.01,
    seed: 21,
  });
  const luv = leafGeo.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 0; i < luv.count; i++)
    luv.setXY(i, ...inCell(atlas.cells.maple, luv.getX(i), luv.getY(i)));
  // The stalk notch sits 5 % up the cell: put it at the origin.
  leafGeo.translate(0, 0, -(1 - CELL_STALK));
  const leafMat = lib.get("maple-leaf", {
    color: 0xffffff,
    map: atlas.color,
    reliefMap: atlas.relief,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
    roughness: 0.6,
    scale: 0.012,
    relief: 0.03,
    wrap: 0.65,
    scatter: 0xb0501a,
    wind: LEAF_WIND,
  });
  const leaves = new THREE.InstancedMesh(leafGeo, leafMat, leafMats.length);
  leafMats.forEach((m, i) => leaves.setMatrixAt(i, m));
  leafColors.forEach((c, i) => leaves.setColorAt(i, c));
  leaves.castShadow = leaves.receiveShadow = true;
  leaves.customDepthMaterial = lib.keep(
    casterMaterial({ wind: LEAF_WIND, map: atlas.color, alphaTest: 0.5 }),
  );
  leaves.name = "maple leaves";
  group.add(leaves);
  // --- the shelter leaf, pivoting at its twig
  const slabMat = lib.get("maple-slab", {
    color: 0xffffff,
    map: atlas.color,
    reliefMap: atlas.relief,
    alphaTest: 0.5,
    side: THREE.FrontSide,
    roughness: 0.55,
    scale: 0.012,
    relief: 0.035,
    wrap: 0.65,
    scatter: 0xb0501a,
  });
  const slabCaster = lib.keep(casterMaterial({ map: atlas.color, alphaTest: 0.5 }));
  const shelterGroup = new THREE.Group();
  shelterGroup.name = "shelter leaf";
  shelterGroup.position.set(...shelter.twig);
  const blade = leafSlab(atlas, shelter.size, -0.0016, 0.0022, 0.032, 0x5e1f);
  blade.applyMatrix4(
    leafMatrix(sub(shelter.center, shelter.twig), shelter.normal, shelter.tip),
  );
  const shelterBlade = new THREE.Mesh(blade, slabMat);
  shelterBlade.castShadow = shelterBlade.receiveShadow = true;
  shelterBlade.customDepthMaterial = slabCaster;
  const shelterStalk = new THREE.Mesh(
    tube(
      [[0, 0, 0], [0.006, -0.05, 0.004], sub(shelterBase, shelter.twig)],
      [0.0022, 0.0018, 0.0015],
      { radial: 6, density: 200, seed: 0x3a97, wobble: 0.08 },
    ),
    lib.get("leaf-stalk", {
      color: 0x9a5a2a,
      roughness: 0.6,
      scale: 0.006,
      relief: 0.05,
    }),
  );
  shelterStalk.castShadow = true;
  shelterGroup.add(shelterBlade, shelterStalk);
  group.add(shelterGroup);
  // --- the swaying leaf, pivoting at its twig
  const sw = M.swaying;
  const swayGroup = new THREE.Group();
  swayGroup.name = "swaying leaf";
  swayGroup.position.set(...sw.twig);
  const swBlade = leafSlab(atlas, sw.size, -0.0008, 0.0014, 0.02, 0x5e20);
  swBlade.applyMatrix4(leafMatrix(sub(sw.center, sw.twig), sw.normal, sw.tip));
  const swMesh = new THREE.Mesh(swBlade, slabMat);
  swMesh.castShadow = swMesh.receiveShadow = true;
  swMesh.customDepthMaterial = slabCaster;
  const swBase = add(
    sw.center,
    scale(normalize(sw.tip), -(CELL_STALK - CELL_CENTER[1]) * sw.size),
  );
  const swStalk = new THREE.Mesh(
    tube([[0, 0, 0], [0.01, -0.02, 0], sub(swBase, sw.twig)], [0.002, 0.0017, 0.0014], {
      radial: 6,
      density: 200,
      seed: 0x3a98,
      wobble: 0.08,
    }),
    lib.get("leaf-stalk", {
      color: 0x9a5a2a,
      roughness: 0.6,
      scale: 0.006,
      relief: 0.05,
    }),
  );
  swStalk.castShadow = true;
  swayGroup.add(swMesh, swStalk);
  group.add(swayGroup);
  return {
    group,
    shelter: shelterGroup,
    swaying: swayGroup,
    swayingArm: sub(sw.center, sw.twig),
    dispose() {
      group.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
        // Instanced meshes also hold their per-instance buffers on the GPU.
        if (o instanceof THREE.InstancedMesh) o.dispose();
      });
    },
  };
}
