/** Instanced civilian presentation. Observes the simulator; never writes to it. */
import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mulberry32 } from "../lib/noise";
import { solveTwoBone } from "../game/characters/ik";
import { B, BONE_LENGTH, REST_AXIS } from "../game/characters/rig";
import { roads, sidewalks } from "./network";
import { distance } from "./model";
import { DT, type CitySimulation } from "./simulation";
import type { ViewControl } from "./Scene";
import { groundAt } from "./terrain";
import { cityFoot, type FootTarget } from "./locomotion";

const clothes = [
  "#354759",
  "#70584b",
  "#59654c",
  "#89939b",
  "#b9ac97",
  "#81554d",
  "#c7c3b6",
  "#3d454c",
];
const skins = ["#bd9679", "#996e55", "#6c5042", "#d0ac8b", "#89654e"];
const hairColors = ["#393029", "#655244", "#a18c68", "#9b9d94"];
const carColors = [
  "#deddd4",
  "#293945",
  "#5c6367",
  "#97594e",
  "#8a8c85",
  "#39434a",
  "#526373",
  "#b8ada0",
];

/** A sloped windshield and rear screen, rather than a rectangular glass box. */
function cabinGeometry() {
  const rings = [
    [-1.2, 0, 0.78],
    [-0.73, 0.53, 0.65],
    [0.57, 0.53, 0.65],
    [1.22, 0, 0.78],
  ];
  const vertices: number[] = [],
    indices: number[] = [];
  for (const [z, y, width] of rings) {
    vertices.push(-width!, 0, z!, width!, 0, z!, width!, y!, z!, -width!, y!, z!);
  }
  for (let r = 0; r < rings.length - 1; r++)
    for (let side = 0; side < 4; side++) {
      const a = r * 4 + side,
        b = r * 4 + ((side + 1) % 4),
        c = b + 4,
        d = a + 4;
      indices.push(a, b, d, b, c, d);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}
/** Concave wheel openings remove the solid body across the upper tires. */
function carBodyGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(-2.2, 0.34);
  shape.lineTo(-2.2, 0.81);
  shape.quadraticCurveTo(-1.94, 0.94, -1.58, 0.94);
  shape.lineTo(1.62, 0.9);
  shape.quadraticCurveTo(2.18, 0.88, 2.2, 0.72);
  shape.lineTo(2.2, 0.34);
  for (const centre of [1.38, -1.38]) {
    shape.lineTo(centre + 0.4, 0.34);
    for (let i = 0; i <= 12; i++) {
      const angle = (i * Math.PI) / 12;
      shape.lineTo(centre + Math.cos(angle) * 0.4, 0.34 + Math.sin(angle) * 0.4);
    }
  }
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: 1.74,
    bevelEnabled: true,
    bevelThickness: 0.03,
    bevelSize: 0.035,
    bevelSegments: 2,
    steps: 1,
    curveSegments: 8,
  });
  g.rotateY(-Math.PI / 2);
  g.translate(0.87, -0.61, 0);
  return g;
}
function createActors() {
  const group = new THREE.Group();
  const shirt = new THREE.MeshStandardMaterial({ roughness: 0.94 });
  const skin = new THREE.MeshStandardMaterial({ roughness: 0.82 });
  const paint = new THREE.MeshStandardMaterial({ roughness: 0.29, envMapIntensity: 1.3 });
  const glass = new THREE.MeshStandardMaterial({
    color: "#36454c",
    roughness: 0.13,
    envMapIntensity: 1.5,
  });
  const dark = new THREE.MeshStandardMaterial({ color: "#303333", roughness: 0.91 });
  const chrome = new THREE.MeshStandardMaterial({
    color: "#b4b9b7",
    metalness: 0.95,
    roughness: 0.31,
  });
  const lamp = new THREE.MeshStandardMaterial({
    color: "#e2dac0",
    emissive: "#a89c77",
    emissiveIntensity: 0.16,
    roughness: 0.2,
  });
  const tail = new THREE.MeshStandardMaterial({ color: "#913c32", roughness: 0.23 });
  const sphere = new THREE.SphereGeometry(0.5, 10, 8);
  const capsule = new THREE.CapsuleGeometry(0.5, 1, 3, 8);
  const box = new RoundedBoxGeometry(1, 1, 1, 2, 0.12);
  const tire = new THREE.CylinderGeometry(0.33, 0.33, 0.22, 16);
  tire.rotateZ(Math.PI / 2);
  const rim = new THREE.CylinderGeometry(0.2, 0.2, 0.235, 12);
  rim.rotateZ(Math.PI / 2);
  const hair = new THREE.SphereGeometry(0.5, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.6);
  const car = carBodyGeometry();
  const cabin = cabinGeometry();
  const meshes = {
    torso: new THREE.InstancedMesh(box, shirt, 640),
    hips: new THREE.InstancedMesh(box, dark, 640),
    head: new THREE.InstancedMesh(sphere, skin, 640),
    hair: new THREE.InstancedMesh(hair, shirt, 640),
    face: new THREE.InstancedMesh(sphere, dark, 1280),
    skin: new THREE.InstancedMesh(capsule, skin, 1920),
    sleeve: new THREE.InstancedMesh(capsule, shirt, 1280),
    hand: new THREE.InstancedMesh(sphere, skin, 1280),
    pants: new THREE.InstancedMesh(capsule, dark, 2560),
    shoe: new THREE.InstancedMesh(box, dark, 1280),
    bag: new THREE.InstancedMesh(box, shirt, 640),
    phone: new THREE.InstancedMesh(box, dark, 640),
    car: new THREE.InstancedMesh(car, paint, 113),
    cabin: new THREE.InstancedMesh(cabin, glass, 113),
    roof: new THREE.InstancedMesh(box, paint, 113),
    trim: new THREE.InstancedMesh(box, chrome, 113 * 14),
    wheel: new THREE.InstancedMesh(tire, dark, 452),
    rim: new THREE.InstancedMesh(rim, chrome, 452),
    lamp: new THREE.InstancedMesh(box, lamp, 226),
    tail: new THREE.InstancedMesh(box, tail, 226),
    beacon: new THREE.InstancedMesh(box, new THREE.MeshBasicMaterial(), 3),
  };
  for (const [name, mesh] of Object.entries(meshes)) {
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = ["torso", "car", "roof", "pants"].includes(name);
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return {
    group,
    meshes,
    dispose() {
      const geometries = new Set(Object.values(meshes).map((m) => m.geometry));
      const materials = new Set(Object.values(meshes).map((m) => m.material));
      for (const m of Object.values(meshes)) m.dispose();
      for (const g of geometries) g.dispose();
      for (const m of materials) (m as THREE.Material).dispose();
    },
  };
}
type Part = keyof ReturnType<typeof createActors>["meshes"];

export function Actors({ sim, view }: { sim: CitySimulation; view: ViewControl }) {
  const built = useMemo(createActors, []);
  // Per-renderer state, separate from authoritative agents and experiment hashes.
  const motions = useMemo(
    () =>
      sim.agents.map((a) => ({
        x: a.point.x,
        z: a.point.z,
        fromX: a.point.x,
        fromZ: a.point.z,
        time: 0,
        tick: sim.tick,
        travel: 0,
        moving: false,
      })),
    [sim],
  );
  const variations = useMemo(
    () =>
      sim.agents.map((a) => {
        const random = mulberry32(sim.config.seed + a.id * 7919);
        return {
          height: 0.94 + random() * 0.12,
          width: 0.92 + random() * 0.2,
          skin: skins[Math.floor(random() * skins.length)]!,
          hair: hairColors[Math.floor(random() * hairColors.length)]!,
          suv: random() < 0.32,
          phase: random() * 1.1,
        };
      }),
    [sim],
  );
  const scratch = useMemo(
    () => ({
      dummy: new THREE.Object3D(),
      color: new THREE.Color(),
      origin: new THREE.Vector3(),
      target: new THREE.Vector3(),
      pole: new THREE.Vector3(0, 0, 1),
      knee: new THREE.Vector3(),
      axis: new THREE.Vector3(),
      vector: new THREE.Vector3(),
      orientation: new THREE.Quaternion(),
      angles: new THREE.Euler(0, 0, 0, "YXZ"),
      root: new THREE.Bone(),
      mid: new THREE.Bone(),
      up: new THREE.Vector3(0, 1, 0),
      feet: [
        { y: 0.08, z: 0, planted: true },
        { y: 0.08, z: 0, planted: true },
      ] as [FootTarget, FootTarget],
    }),
    [],
  );
  useEffect(() => () => built.dispose(), [built]);
  useFrame(({ clock }) => {
    const {
      dummy,
      color,
      origin,
      target,
      knee,
      root,
      mid,
      vector,
      up,
      feet,
      axis,
      pole,
      orientation,
      angles,
    } = scratch;
    const counts = Object.fromEntries(
      Object.keys(built.meshes).map((k) => [k, 0]),
    ) as Record<Part, number>;
    const eye =
      view.mode === "walk"
        ? sim.player
        : view.mode === "seat"
          ? sim.agents[0]!.point
          : view.target;
    const range = view.tier === 0 ? 220 : 600;
    const now = clock.elapsedTime;
    for (const a of sim.agents) {
      const motion = motions[a.id]!,
        variation = variations[a.id]!;
      if (motion.tick !== sim.tick) {
        const delta = Math.hypot(a.point.x - motion.x, a.point.z - motion.z);
        motion.fromX = motion.x;
        motion.fromZ = motion.z;
        motion.x = a.point.x;
        motion.z = a.point.z;
        motion.moving = delta > 0.002 && !a.inside;
        motion.travel += delta;
        motion.tick = sim.tick;
        motion.time = now;
      }
      if (a.inside || distance(a.point, eye) > range) continue;
      // At most one tick of visual lag. Large jumps/slow frames settle immediately.
      const alpha = sim.paused ? 1 : Math.min(1, Math.max(0, (now - motion.time) / DT));
      const x = THREE.MathUtils.lerp(motion.fromX, motion.x, alpha),
        z = THREE.MathUtils.lerp(motion.fromZ, motion.z, alpha);
      const edge = (a.kind === "pedestrian" ? sidewalks : roads).edges[a.edge]!;
      const surface = a.kind === "pedestrian" ? (edge.crossing ? 0.14 : 0.2) : 0.13;
      const ground = groundAt({ x, z }) + surface;
      let heading = edge.heading;
      if (a.kind === "pedestrian" && ["watch", "record"].includes(a.action)) {
        const event = sim.events.find(
          (e) => e.kind !== "storm" && distance(e.point, a.point) < 100,
        );
        if (event) heading = Math.atan2(event.point.x - x, event.point.z - z);
      }
      const sin = Math.sin(heading),
        cos = Math.cos(heading);
      let pitch = 0,
        roll = 0;
      if (a.kind !== "pedestrian") {
        const front = groundAt({ x: x + sin * 1.38, z: z + cos * 1.38 });
        const back = groundAt({ x: x - sin * 1.38, z: z - cos * 1.38 });
        const right = groundAt({ x: x + cos * 0.85, z: z - sin * 0.85 });
        const left = groundAt({ x: x - cos * 0.85, z: z + sin * 0.85 });
        pitch = -Math.atan2(front - back, 2.76);
        roll = Math.atan2(right - left, 1.7);
      }
      orientation.setFromEuler(angles.set(pitch, heading, roll, "YXZ"));
      const local = (
        part: Part,
        lx: number,
        y: number,
        lz: number,
        sx: number,
        sy: number,
        sz: number,
        tint?: string,
      ) => {
        const mesh = built.meshes[part],
          i = counts[part]++;
        vector.set(lx, y, lz).applyQuaternion(orientation);
        dummy.position.set(x + vector.x, ground + vector.y, z + vector.z);
        dummy.scale.set(sx, sy, sz);
        dummy.quaternion.copy(orientation);
        if (part === "wheel" || part === "rim") dummy.rotateX(motion.travel / 0.33);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        if (tint) mesh.setColorAt(i, color.set(tint));
      };
      const segment = (
        part: Part,
        ax: number,
        ay: number,
        az: number,
        bx: number,
        by: number,
        bz: number,
        radius: number,
        tint?: string,
      ) => {
        const mesh = built.meshes[part],
          i = counts[part]++;
        dummy.position.set(
          x + (cos * (ax + bx)) / 2 + (sin * (az + bz)) / 2,
          ground + (ay + by) / 2,
          z - (sin * (ax + bx)) / 2 + (cos * (az + bz)) / 2,
        );
        vector.set(
          cos * (bx - ax) + sin * (bz - az),
          by - ay,
          -sin * (bx - ax) + cos * (bz - az),
        );
        const length = vector.length();
        dummy.quaternion.setFromUnitVectors(up, vector.normalize());
        // Rounded segments overlap at joints instead of meeting at pinched tips.
        dummy.scale.set(radius * 2, (length + radius * 1.5) / 2, radius * 2);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        if (tint) mesh.setColorAt(i, color.set(tint));
      };
      if (a.kind === "pedestrian") {
        const height = variation.height,
          width = variation.width,
          detailed = distance(a.point, eye) < (view.tier === 0 ? 35 : 80),
          shirt = clothes[a.color]!;
        const travel =
          (motion.travel -
            (1 - alpha) * Math.hypot(motion.x - motion.fromX, motion.z - motion.fromZ)) /
            height +
          variation.phase;
        for (let i = 0; i < 2; i++) {
          const foot = feet[i]!;
          cityFoot(travel, i ? 1 : -1, motion.moving, foot);
          const lateral = (i ? 1 : -1) * 0.105 * width;
          foot.y +=
            (groundAt({
              x: x + cos * lateral + sin * foot.z * height,
              z: z - sin * lateral + cos * foot.z * height,
            }) +
              surface -
              ground) /
            height;
        }
        const thigh = BONE_LENGTH[B.thighL]!,
          shin = BONE_LENGTH[B.shinL]!,
          reach = (thigh + shin) * 0.984;
        let hip = 0.88;
        for (const foot of feet)
          hip = Math.min(
            hip,
            foot.y + Math.sqrt(Math.max(0.1, reach * reach - foot.z * foot.z)),
          );
        local("hips", 0, hip * height, 0, 0.32 * width, 0.2 * height, 0.23 * width);
        local(
          "torso",
          0,
          (hip + 0.29) * height,
          0,
          0.4 * width,
          0.5 * height,
          0.24 * width,
          shirt,
        );
        local(
          "head",
          0,
          (hip + 0.75) * height,
          0.005,
          0.21 * height,
          0.27 * height,
          0.22 * height,
          variation.skin,
        );
        if (detailed) {
          local(
            "hair",
            0,
            (hip + 0.8) * height,
            -0.012,
            0.222 * height,
            0.24 * height,
            0.235 * height,
            variation.hair,
          );
          segment(
            "skin",
            0,
            (hip + 0.5) * height,
            0,
            0,
            (hip + 0.62) * height,
            0,
            0.055 * height,
            variation.skin,
          );
          for (const side of [-1, 1])
            local(
              "face",
              side * 0.041 * height,
              (hip + 0.785) * height,
              0.099 * height,
              0.016,
              0.012,
              0.009,
            );
        }
        for (let i = 0; i < 2; i++) {
          const side = i ? 1 : -1,
            foot = feet[i]!,
            lx = side * 0.105;
          origin.set(lx, hip, 0);
          target.set(lx, foot.y, foot.z);
          if (detailed) {
            // Reuse the project's clamped analytic IK, with a civilian forward pole.
            solveTwoBone(root, mid, B.thighL, B.shinL, origin, target, pole, thigh, shin);
            axis.set(
              REST_AXIS[B.thighL * 3]!,
              REST_AXIS[B.thighL * 3 + 1]!,
              REST_AXIS[B.thighL * 3 + 2],
            );
            knee
              .copy(axis)
              .applyQuaternion(root.quaternion)
              .multiplyScalar(thigh)
              .add(origin);
            segment(
              "pants",
              lx * width,
              hip * height,
              0,
              knee.x * width,
              knee.y * height,
              knee.z * height,
              0.075 * width,
            );
            segment(
              "pants",
              knee.x * width,
              knee.y * height,
              knee.z * height,
              lx * width,
              foot.y * height,
              foot.z * height,
              0.061 * width,
            );
          } else
            segment(
              "pants",
              lx * width,
              hip * height,
              0,
              lx * width,
              foot.y * height,
              foot.z * height,
              0.07 * width,
            );
          local(
            "shoe",
            lx * width,
            (0.045 + foot.y - 0.08) * height,
            (foot.z + 0.045) * height,
            0.13 * width,
            0.075 * height,
            0.25 * height,
          );
          const swing = motion.moving
            ? Math.sin((travel / 1.1) * Math.PI * 2) * 0.16 * side
            : 0;
          const recording = a.action === "record" && side > 0;
          const shoulderX = side * 0.235 * width,
            elbowY = (hip + (recording ? 0.31 : 0.15)) * height,
            handY = (hip + (recording ? 0.46 : -0.08)) * height,
            elbowZ = recording ? 0.18 : -swing,
            handZ = recording ? 0.35 : -swing * 1.4;
          segment(
            "sleeve",
            shoulderX,
            (hip + 0.49) * height,
            0,
            shoulderX,
            elbowY,
            elbowZ,
            0.055 * width,
            shirt,
          );
          segment(
            "skin",
            shoulderX,
            elbowY,
            elbowZ,
            shoulderX,
            handY,
            handZ,
            0.04 * width,
            variation.skin,
          );
          if (detailed)
            local("hand", shoulderX, handY, handZ, 0.075, 0.105, 0.07, variation.skin);
          if (recording && detailed)
            local("phone", shoulderX, handY + 0.04, handZ + 0.01, 0.075, 0.14, 0.014);
        }
        if (detailed && a.id % 3 === 0)
          local(
            "bag",
            -0.04,
            (hip + 0.26) * height,
            -0.2,
            0.28,
            0.35,
            0.13,
            clothes[(a.color + 2) % clothes.length],
          );
      } else {
        const emergency = a.kind === "emergency",
          tall = emergency ? 1.65 : variation.suv ? 1.22 : 1,
          length = emergency ? 1.35 : variation.suv ? 1.06 : 1,
          width = emergency ? 1.2 : 1,
          tint = emergency ? "#953b30" : carColors[a.color]!;
        local("car", 0, 0.61 * tall, 0, width, tall, length, tint);
        local("cabin", 0, 0.93 * tall, -0.08, width, tall, length);
        local(
          "roof",
          0,
          1.47 * tall,
          -0.17 * length,
          1.33 * width,
          0.065,
          1.34 * length,
          tint,
        );
        for (const side of [-1, 1]) {
          local("trim", side * 0.895 * width, 0.43 * tall, 0, 0.025, 0.06, 3.4 * length);
          // B-pillars, handles and mirrors break up each continuous side window.
          local(
            "trim",
            side * 0.704 * width,
            1.17 * tall,
            -0.06,
            0.048,
            0.5 * tall,
            0.052,
          );
          local("trim", side * 0.92 * width, 0.85 * tall, -0.28, 0.02, 0.025, 0.14);
          local(
            "trim",
            side * 0.98 * width,
            1.02 * tall,
            0.77 * length,
            0.15,
            0.12,
            0.22,
          );
          for (const end of [-1, 1]) {
            local("wheel", side * 0.85 * width, 0.34, end * 1.38 * length, 1, 1, 1);
            if (distance(a.point, eye) < 80)
              local("rim", side * 0.87 * width, 0.34, end * 1.38 * length, 1, 1, 1);
          }
          local(
            "lamp",
            side * 0.59 * width,
            0.76 * tall,
            2.25 * length,
            0.43,
            0.17,
            0.07,
          );
          local(
            "tail",
            side * 0.61 * width,
            0.76 * tall,
            -2.25 * length,
            0.34,
            0.18,
            0.065,
          );
        }
        local("trim", 0, 0.51 * tall, 2.25 * length, 1.45 * width, 0.05, 0.045);
        local("trim", 0, 0.54 * tall, -2.25 * length, 1.45 * width, 0.04, 0.045);
        local("trim", 0, 0.7 * tall, 2.25 * length, 0.58, 0.16, 0.045);
        if (emergency && a.action === "respond")
          local(
            "beacon",
            0,
            1.56 * tall,
            -0.1,
            1.3,
            0.14,
            0.25,
            sim.tick % 8 < 4 ? "#d7503b" : "#5680ff",
          );
      }
    }
    for (const [name, mesh] of Object.entries(built.meshes)) {
      mesh.count = counts[name as Part];
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  });
  return <primitive object={built.group} />;
}
