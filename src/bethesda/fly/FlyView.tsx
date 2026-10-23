/**
 * Draws the Bethesda fly from FlyBody's meshes, at its true size.
 *
 * Presentation only: it reads the fly's state after each city tick and never
 * writes it. The simulated state advances in 0.1 s ticks, so the drawing runs
 * one tick behind and interpolates between the last two (position, heading,
 * pitch, roll, leg extension, wing opening); the leg and wing joints are posed
 * every frame by `pose.ts`.
 *
 * Level of detail by distance: FlyBody's mesh decimated to 40 000 triangles
 * within 25 cm, to 5 000 within 4 m, and nothing beyond (a 3 mm fly is under
 * a pixel there). Each mesh loads only when first needed. A 218 Hz wingbeat
 * cannot be shown at a display's frame rate, so a beating wing is drawn as the
 * translucent sweep the eye sees, unless slow motion is on (1/100 speed).
 *
 * The locator ring, shown while the fly's panel is open, is a marker on the
 * screen, not part of the fly; the fly itself is never enlarged.
 */
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { CityFly } from "./cityFly";
import type { FlyState } from "./fly";
import { stepPeriodS, type GaitParams } from "./gait";
import { bodyLocal, type BodyDef } from "./kinematics";
import { decodePart, parseMeshFile, type MeshFile } from "./meshCodec";
import { resolveParams } from "./params";
import { PoseSolver, type PoseInput } from "./pose";
import { SKELETON } from "./skeleton";
import { wrapAngle } from "./units";
import { strokeAt } from "./wing";

export interface FlyViewControl {
  city: CityFly;
  /** The panel is open: draw the locator ring. */
  marker: boolean;
  /** Close-up inspection camera. */
  inspect: boolean;
  /** Wings at 1/100 speed. */
  slow: boolean;
  /** Written by the renderer, read by the panel. */
  drawn:
    | "full mesh"
    | "reduced mesh"
    | "not drawn (too far to see)"
    | "loading"
    | "unavailable";
}

const CLOSE_M = 0.25;
const NEAR_M = 4;
const SLOW = 0.01;
const GHOSTS = 6;
const INSPECT_M = 0.012;
/**
 * Below this many pixels of body length no leg or wing pose can be seen (a
 * leg is a tenth of a millimetre thick), so the leg solver is skipped.
 */
const POSE_MIN_PX = 4;
const BODY_M = SKELETON.measures.bodyLengthCm / 100;

const P = resolveParams();
const GAIT: GaitParams = {
  stanceLegsAt1: P.stanceLegsAt1,
  stanceLegsAt4: P.stanceLegsAt4,
  swingMs: P.swingMs,
  stepPeriodFloorMs: P.stepPeriodFloorMs,
  walkSpeedMinCmS: P.walkSpeedMinCmS,
  walkSpeedMaxCmS: P.walkSpeedMaxCmS,
};

type Snapshot = Pick<
  FlyState,
  | "t"
  | "mode"
  | "groom"
  | "yaw"
  | "yawRate"
  | "pitch"
  | "roll"
  | "wingsOpen"
  | "legs"
  | "walkSpeed"
  | "gaitClock"
  | "wingHz"
  | "ampL"
  | "ampR"
> & { p: [number, number, number] };
const snapshot = (s: FlyState): Snapshot => ({
  t: s.t,
  mode: s.mode,
  groom: s.groom,
  p: [s.p[0], s.p[1], s.p[2]],
  yaw: s.yaw,
  yawRate: s.yawRate,
  pitch: s.pitch,
  roll: s.roll,
  wingsOpen: s.wingsOpen,
  legs: s.legs,
  walkSpeed: s.walkSpeed,
  gaitClock: s.gaitClock,
  wingHz: s.wingHz,
  ampL: s.ampL,
  ampR: s.ampR,
});

const reducedMotion = () =>
  typeof window !== "undefined" &&
  !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// As text, parsed on arrival: each level is its own chunk, fetched when first needed.
const LOADERS: Record<number, () => Promise<unknown>> = {
  0: () =>
    import("./data/flybody-lod0.json?raw").then((m) => JSON.parse(m.default) as unknown),
  1: () =>
    import("./data/flybody-lod1.json?raw").then((m) => JSON.parse(m.default) as unknown),
};
const SKELETON_BY_NAME = new Map<string, BodyDef>(
  SKELETON.bodies.map((b) => [b.name, b]),
);
const WING_RANGE = (() => {
  const j = SKELETON_BY_NAME.get("wing_left")!.joints;
  return { yaw: j[0]!.range, roll: j[1]!.range, pitch: j[2]!.range };
})();

function material(name: string, ghost = false): THREE.Material {
  const def = SKELETON.materials.find((m) => m.name === name);
  const [r, g, b, a] = def?.rgba ?? [0.5, 0.5, 0.5, 1];
  const m = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace),
    roughness: Math.min(0.9, Math.max(0.15, 1 - (def?.shininess ?? 0.5))),
    metalness: 0,
  });
  if (a < 1 || ghost) {
    m.transparent = true;
    m.opacity = ghost ? 0.07 : a;
    m.depthWrite = false;
    m.side = THREE.DoubleSide;
  }
  return m;
}

const toThree = (q: readonly number[], out: THREE.Quaternion) =>
  out.set(q[1]!, q[2]!, q[3]!, q[0]!);

/** The FlyBody hierarchy as Three groups, with no meshes yet. */
function skeletonGroups() {
  const root = new THREE.Group();
  root.name = "digital fly";
  root.scale.setScalar(0.01); // FlyBody centimetres → city metres
  root.visible = false;
  const groups = new Map<string, THREE.Group>();
  for (const b of SKELETON.bodies) {
    const g = new THREE.Group();
    g.name = b.name;
    const f = bodyLocal(b, []);
    g.position.set(f.p[0], f.p[1], f.p[2]);
    toThree(f.q, g.quaternion);
    (b.parent ? groups.get(b.parent)! : root).add(g);
    groups.set(b.name, g);
  }
  return { root, groups };
}

export function FlyView({ control }: { control: FlyViewControl }) {
  const { camera, gl } = useThree();
  const controls = useThree((s) => s.controls) as unknown as { enabled: boolean } | null;
  const built = useMemo(() => {
    const { root, groups } = skeletonGroups();
    const ringCanvas = document.createElement("canvas");
    ringCanvas.width = ringCanvas.height = 64;
    const ctx = ringCanvas.getContext("2d");
    if (ctx) {
      ctx.strokeStyle = "rgba(190,250,240,0.95)";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(32, 32, 26, 0, Math.PI * 2);
      ctx.stroke();
    }
    const ringTexture = new THREE.CanvasTexture(ringCanvas);
    const ring = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: ringTexture, depthTest: false, transparent: true }),
    );
    ring.scale.setScalar(0.045);
    ring.renderOrder = 10;
    ring.visible = false;
    ring.material.sizeAttenuation = false;
    return {
      root,
      groups,
      ring,
      ringTexture,
      lods: new Map<number, THREE.Group[]>(),
      ghosts: { left: [] as THREE.Group[], right: [] as THREE.Group[] },
      realWings: [] as THREE.Object3D[],
      geometries: [] as THREE.BufferGeometry[],
      materials: [] as THREE.Material[],
    };
  }, []);
  const solver = useMemo(() => new PoseSolver(GAIT), []);
  const live = useRef({
    /** The control the interpolation below belongs to; a new one (a new city) restarts it. */
    control,
    a: snapshot(control.city.fly.state),
    b: snapshot(control.city.fly.state),
    at: 0,
    wingPhase: 0,
    loading: new Set<number>(),
    failed: false,
    /** Set once this view is unmounted: a mesh that arrives later is dropped, not attached. */
    disposed: false,
    inspecting: null as null | {
      position: THREE.Vector3;
      quaternion: THREE.Quaternion;
      near: number;
      controls: boolean;
    },
    az: 0.6,
    el: 0.35,
    dragged: false,
    reduced: reducedMotion(),
  });

  const attach = (file: MeshFile) => {
    const level = Number(file.lod.slice(3));
    const containers: THREE.Group[] = [];
    const mats = new Map<string, THREE.Material>();
    const ghostMat = material("membrane", true);
    built.materials.push(ghostMat);
    for (const part of file.parts) {
      const d = decodePart(part, file.quantumCm);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(d.positions, 3));
      geo.setIndex(new THREE.BufferAttribute(d.indices, 1));
      geo.computeVertexNormals();
      built.geometries.push(geo);
      let m = mats.get(part.material);
      if (!m) {
        m = material(part.material);
        mats.set(part.material, m);
        built.materials.push(m);
      }
      const body = built.groups.get(part.body);
      if (!body) throw new Error(`mesh part for unknown body ${part.body}`);
      let holder = body.children.find((c) => c.userData.lod === level) as
        THREE.Group | undefined;
      if (!holder) {
        holder = new THREE.Group();
        holder.userData.lod = level;
        holder.visible = false;
        body.add(holder);
        containers.push(holder);
      }
      holder.add(new THREE.Mesh(geo, m));
      // The beating-wing sweep reuses the reduced wing mesh.
      if (level === 1 && (part.body === "wing_left" || part.body === "wing_right")) {
        const side = part.body === "wing_left" ? "left" : "right";
        const list = built.ghosts[side];
        if (list.length === 0) {
          const thorax = built.groups.get("thorax")!;
          for (let k = 0; k < GHOSTS; k++) {
            const g = new THREE.Group();
            g.position.copy(built.groups.get(part.body)!.position);
            g.visible = false;
            thorax.add(g);
            list.push(g);
          }
        }
        for (const g of list) g.add(new THREE.Mesh(geo, ghostMat));
      }
    }
    built.lods.set(level, containers);
  };

  const load = (lod: number) => {
    const L = live.current;
    if (L.loading.has(lod) || L.failed) return;
    L.loading.add(lod);
    LOADERS[lod]!()
      .then((raw) => {
        if (!L.disposed) attach(parseMeshFile(raw));
      })
      .catch(() => {
        L.failed = true;
      });
  };

  useEffect(() => {
    const { root, ring } = built;
    const L = live.current;
    // Mounted (again, under StrictMode): meshes may attach.
    L.disposed = false;
    return () => {
      L.disposed = true;
      // The frame loop adds both to the scene, after this effect ran: remove
      // them from wherever they are now.
      root.removeFromParent();
      ring.removeFromParent();
      for (const g of built.geometries) g.dispose();
      for (const m of built.materials) m.dispose();
      ring.material.dispose();
      built.ringTexture.dispose();
    };
  }, [built]);

  // Drag to turn the close-up view.
  useEffect(() => {
    const canvas = gl.domElement;
    let last: { x: number; y: number } | null = null;
    const down = (e: PointerEvent) => {
      if (control.inspect) last = { x: e.clientX, y: e.clientY };
    };
    const move = (e: PointerEvent) => {
      if (!last || !control.inspect) return;
      const L = live.current;
      L.az -= (e.clientX - last.x) * 0.008;
      L.el = Math.max(-1.2, Math.min(1.4, L.el + (e.clientY - last.y) * 0.008));
      L.dragged = true;
      last = { x: e.clientX, y: e.clientY };
    };
    const up = () => {
      last = null;
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [gl, control]);

  const q = useMemo(
    () => ({
      basis: new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(1, 0, 0),
        -Math.PI / 2,
      ),
      yaw: new THREE.Quaternion(),
      pitch: new THREE.Quaternion(),
      roll: new THREE.Quaternion(),
      tmp: new THREE.Quaternion(),
      X: new THREE.Vector3(1, 0, 0),
      Y: new THREE.Vector3(0, 1, 0),
      Z: new THREE.Vector3(0, 0, 1),
      at: new THREE.Vector3(),
    }),
    [],
  );

  useFrame((state, dt) => {
    const L = live.current;
    const c = control;
    const fly = c.city.fly;
    const now = state.clock.elapsedTime;
    if (L.control !== c) {
      // A new city and fly: start the interpolation at the new fly, so the
      // drawing does not slide over from where the old one was.
      L.control = c;
      L.a = L.b = snapshot(fly.state);
      L.at = now;
      L.wingPhase = 0;
    }
    if (fly.state.t !== L.b.t) {
      L.a = L.b;
      L.b = snapshot(fly.state);
      L.at = now;
    }
    const paused = c.city.paused;
    const alpha = Math.min(1, Math.max(0, (now - L.at) / 0.1));
    const { a, b } = L;
    const lerp = (x: number, y: number) => x + (y - x) * alpha;
    const p = q.at.set(lerp(a.p[0], b.p[0]), lerp(a.p[1], b.p[1]), lerp(a.p[2], b.p[2]));
    const yaw = a.yaw + wrapAngle(b.yaw - a.yaw) * alpha;

    // Close-up inspection: take the camera, give it back on leaving.
    if (c.inspect && !L.inspecting) {
      L.inspecting = {
        position: camera.position.clone(),
        quaternion: camera.quaternion.clone(),
        near: camera.near,
        controls: controls?.enabled ?? false,
      };
      if (controls) controls.enabled = false;
      // The close-up turns by pointer movement, which a pointer lock would freeze.
      if (document.pointerLockElement === gl.domElement) document.exitPointerLock();
      L.az = yaw + Math.PI * 0.75;
      L.dragged = false;
      camera.near = 0.0008;
      camera.updateProjectionMatrix();
    } else if (!c.inspect && L.inspecting) {
      camera.position.copy(L.inspecting.position);
      camera.quaternion.copy(L.inspecting.quaternion);
      camera.near = L.inspecting.near;
      camera.updateProjectionMatrix();
      if (controls) controls.enabled = L.inspecting.controls;
      L.inspecting = null;
    }
    if (c.inspect) {
      if (!L.dragged && !L.reduced && !paused) L.az += dt * 0.25;
      camera.position.set(
        p.x + INSPECT_M * Math.cos(L.el) * Math.cos(L.az),
        p.y + INSPECT_M * Math.sin(L.el),
        p.z - INSPECT_M * Math.cos(L.el) * Math.sin(L.az),
      );
      camera.lookAt(p);
    }

    const { root, ring } = built;
    if (!root.parent) state.scene.add(root);
    if (!ring.parent) state.scene.add(ring);
    ring.visible = c.marker && !c.inspect;
    ring.position.set(p.x, p.y + 0.002, p.z);

    const distance = camera.position.distanceTo(p);
    const want = c.inspect || distance < CLOSE_M ? 0 : distance < NEAR_M ? 1 : -1;
    if (want >= 0) {
      load(1);
      if (want === 0) load(0);
    }
    const shown =
      want === 0 && built.lods.has(0) ? 0 : want >= 0 && built.lods.has(1) ? 1 : -1;
    c.drawn = L.failed
      ? "unavailable"
      : want < 0
        ? "not drawn (too far to see)"
        : shown < 0
          ? "loading"
          : shown === 0
            ? "full mesh"
            : "reduced mesh";
    root.visible = shown >= 0;
    if (!root.visible) return;
    for (const [lod, holders] of built.lods)
      for (const h of holders) h.visible = lod === shown;

    root.position.copy(p);
    q.yaw.setFromAxisAngle(q.Z, yaw);
    q.pitch.setFromAxisAngle(q.Y, -lerp(a.pitch, b.pitch));
    q.roll.setFromAxisAngle(q.X, lerp(a.roll, b.roll));
    root.quaternion.copy(q.basis).multiply(q.yaw).multiply(q.pitch).multiply(q.roll);
    const fov = camera instanceof THREE.PerspectiveCamera ? camera.fov : 50;
    const pixels =
      (BODY_M / (distance * 2 * Math.tan((fov * Math.PI) / 360))) * state.size.height;
    if (!c.inspect && pixels < POSE_MIN_PX) return;

    const beating =
      (b.mode === "flight" || b.mode === "land") &&
      lerp(a.wingsOpen, b.wingsOpen) > 0.999;
    if (!paused)
      L.wingPhase =
        (L.wingPhase + 2 * Math.PI * b.wingHz * dt * (c.slow ? SLOW : 1)) % (2 * Math.PI);
    const walkSpeed = lerp(a.walkSpeed, b.walkSpeed);
    const gaitClock =
      b.mode === "walk" && a.mode === "walk" && walkSpeed > 0.05
        ? (a.gaitClock + (alpha * 0.1) / stepPeriodS(walkSpeed, GAIT)) % 1
        : b.gaitClock;
    const input: PoseInput = {
      mode: b.mode,
      groom: b.groom,
      legs: lerp(a.legs, b.legs),
      wingsOpen: lerp(a.wingsOpen, b.wingsOpen),
      walkSpeed,
      gaitClock,
      yawRate: b.yawRate,
      wingPhase: L.wingPhase,
      ampL: b.ampL,
      ampR: b.ampR,
      time: paused ? L.b.t : now,
    };
    const angles = solver.solve(input);
    for (const [name, values] of angles) {
      const body = SKELETON_BY_NAME.get(name)!;
      toThree(bodyLocal(body, values).q, built.groups.get(name)!.quaternion);
    }
    // A beating wing is a blur at display rates: draw the sweep instead.
    const sweep = beating && !c.slow;
    for (const side of ["left", "right"] as const) {
      const wing = built.groups.get(`wing_${side}`)!;
      for (const h of wing.children) h.visible = !sweep && h.userData.lod === shown;
      const ghosts = built.ghosts[side];
      const body = SKELETON_BY_NAME.get(`wing_${side}`)!;
      const amp = side === "left" ? b.ampL : b.ampR;
      ghosts.forEach((g, k) => {
        g.visible = sweep;
        if (!sweep) return;
        const s = strokeAt((2 * Math.PI * (k + 0.5)) / GHOSTS, amp || 1, WING_RANGE);
        toThree(bodyLocal(body, [s.yaw, s.roll, s.pitch]).q, g.quaternion);
      });
    }
  });
  return null;
}
