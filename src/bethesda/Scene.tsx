import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { createCityGeometry } from "./geometry";
import { CityAtmosphere } from "./Atmosphere";
import { roads, green } from "./network";
import {
  bounds,
  buildingAt,
  buildings,
  distance,
  signalPoints,
  type Point,
} from "./model";
import { type CitySimulation } from "./simulation";
import { Actors } from "./Actors";
import { EventVisuals } from "./EventVisuals";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { buildingClass, EVIDENCE_TINT, type EvidenceClassification } from "./evidence";
import { groundAt, minimumGround } from "./terrain";
export interface ViewControl {
  mode: "orbit" | "walk" | "seat";
  target: Point;
  relocate: boolean;
  yaw: number;
  pitch: number;
  keys: Set<string>;
  tier: number;
  quality: "auto" | "detail" | "economy";
  fps: number;
  ready: boolean;
  failed: boolean;
  /** Evidence view: massing tinted by evidence class instead of detailing. */
  evidence: boolean;
  selected: string | null;
  onSelect?: (id: string | null) => void;
  /** What the streetscape builder actually placed, for the field notes. */
  placed?: Record<string, number>;
  samples?: Record<string, Point>;
}
function StaticCity({ view }: { view: ViewControl }) {
  const built = useMemo(createCityGeometry, []);
  view.placed = built.placed;
  view.samples = built.samples;
  const { camera } = useThree();
  const tiles = useMemo(
    () =>
      built.group.children
        .filter((o): o is THREE.Mesh => o instanceof THREE.Mesh)
        .map((mesh) => {
          mesh.geometry.computeBoundingSphere();
          const sphere = mesh.geometry.boundingSphere!;
          return {
            mesh,
            center: sphere.center.clone().add(mesh.position),
            radius: sphere.radius,
          };
        }),
    [built],
  );
  useFrame(() => {
    const range = view.tier === 0 ? 600 : 1200;
    for (const tile of tiles)
      tile.mesh.visible =
        (!view.evidence || tile.mesh.userData.ground === true) &&
        Math.hypot(tile.center.x - camera.position.x, tile.center.z - camera.position.z) -
          tile.radius <
          range;
  });
  useEffect(() => () => built.dispose(), [built]);
  return <primitive object={built.group} />;
}
function Signals({ sim }: { sim: CitySimulation }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []),
    color = useMemo(() => new THREE.Color(), []);
  const edges = useMemo(
    () =>
      signalPoints.map((p) =>
        roads.edges.find((e) => distance(roads.nodes.get(e.to)!, p.point) < 13),
      ),
    [],
  );
  useFrame(() => {
    if (!mesh.current) return;
    signalPoints.forEach((p, i) => {
      dummy.position.set(p.point.x, groundAt(p.point) + 5, p.point.z);
      dummy.scale.set(0.35, 0.9, 0.3);
      dummy.updateMatrix();
      mesh.current!.setMatrixAt(i, dummy.matrix);
      mesh.current!.setColorAt(
        i,
        color.set(
          sim.signalDark(p.point)
            ? "#161818"
            : edges[i] && green(sim.tick, edges[i])
              ? "#559c78"
              : "#c65239",
        ),
      );
    });
    mesh.current.instanceMatrix.needsUpdate = true;
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true;
  });
  return (
    <instancedMesh
      ref={mesh}
      args={[undefined, undefined, signalPoints.length]}
      frustumCulled={false}
    >
      <boxGeometry />
      <meshBasicMaterial />
    </instancedMesh>
  );
}
/** Simple massing per evidence class, built only when the view is first used. */
function EvidenceCity({ view }: { view: ViewControl }) {
  const group = useRef<THREE.Group>(null);
  const outline = useRef<THREE.LineSegments>(null);
  const built = useRef<{ meshes: THREE.Mesh[]; selected: string | null } | null>(null);
  useFrame(() => {
    if (!group.current) return;
    group.current.visible = view.evidence;
    if (view.evidence && !built.current) {
      const parts = new Map<EvidenceClassification, THREE.BufferGeometry[]>();
      for (const b of buildings) {
        const shape = new THREE.Shape(b.ring.map((p) => new THREE.Vector2(p.x, -p.z)));
        for (const hole of b.holes)
          shape.holes.push(new THREE.Path(hole.map((p) => new THREE.Vector2(p.x, -p.z))));
        const g = new THREE.ExtrudeGeometry(shape, {
          depth: b.height,
          bevelEnabled: false,
        });
        g.rotateX(-Math.PI / 2);
        g.translate(0, groundAt(b.center), 0);
        const c = buildingClass(b);
        parts.set(c, [...(parts.get(c) ?? []), g]);
      }
      const meshes: THREE.Mesh[] = [];
      for (const [c, list] of parts) {
        const merged = mergeGeometries(list, false);
        list.forEach((g) => g.dispose());
        if (!merged) continue;
        const mesh = new THREE.Mesh(
          merged,
          new THREE.MeshStandardMaterial({ color: EVIDENCE_TINT[c], roughness: 0.9 }),
        );
        mesh.castShadow = mesh.receiveShadow = true;
        meshes.push(mesh);
        group.current.add(mesh);
      }
      built.current = { meshes, selected: null };
    }
    if (outline.current && built.current?.selected !== view.selected) {
      if (built.current) built.current.selected = view.selected;
      outline.current.geometry.dispose();
      const b = buildings.find((x) => x.id === view.selected);
      if (b) {
        const shape = new THREE.Shape(b.ring.map((p) => new THREE.Vector2(p.x, -p.z)));
        const solid = new THREE.ExtrudeGeometry(shape, {
          depth: b.height + 0.3,
          bevelEnabled: false,
        });
        solid.rotateX(-Math.PI / 2);
        solid.translate(0, groundAt(b.center) - 0.1, 0);
        outline.current.geometry = new THREE.EdgesGeometry(solid, 20);
        solid.dispose();
      } else outline.current.geometry = new THREE.BufferGeometry();
    }
  });
  useEffect(
    () => () => {
      for (const m of built.current?.meshes ?? []) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    },
    [],
  );
  return (
    <>
      <group ref={group} visible={false} />
      <lineSegments ref={outline} frustumCulled={false}>
        <bufferGeometry />
        <lineBasicMaterial color="#f3d36b" />
      </lineSegments>
    </>
  );
}
function Camera({ sim, view }: { sim: CitySimulation; view: ViewControl }) {
  const { camera, gl, setDpr, scene } = useThree();
  function setShadows(enabled: boolean) {
    gl.shadowMap.enabled = enabled;
    // Three's cached programs must be rebuilt when shadow support changes.
    const materials = new Set<THREE.Material>();
    scene.traverse((o) => {
      if (o instanceof THREE.Mesh)
        for (const m of Array.isArray(o.material) ? o.material : [o.material])
          materials.add(m);
    });
    for (const material of materials) material.needsUpdate = true;
  }
  const stats = useRef({ elapsed: 0, frames: 0 });
  const quality = useRef(view.quality);
  useEffect(() => {
    view.ready = true;
    const canvas = gl.domElement;
    let dragging = false;
    const down = (e: PointerEvent) => {
      if (view.mode === "orbit") return;
      dragging = true;
      canvas.setPointerCapture(e.pointerId);
    };
    let press: { x: number; y: number } | null = null;
    const raycaster = new THREE.Raycaster(),
      ndc = new THREE.Vector2();
    const select = (e: PointerEvent) => {
      if (!press || Math.hypot(e.clientX - press.x, e.clientY - press.y) > 5) return;
      if (document.pointerLockElement === canvas) return;
      const rect = canvas.getBoundingClientRect();
      ndc.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
      const hit = raycaster
        .intersectObjects(scene.children, true)
        .find(
          (h) =>
            h.object instanceof THREE.Mesh &&
            h.object.visible &&
            !(h.object instanceof THREE.InstancedMesh),
        );
      if (!hit) return;
      // Nudge through the surface: a facade hit lies on the footprint boundary.
      const d = raycaster.ray.direction;
      const b = buildingAt({ x: hit.point.x + d.x * 0.4, z: hit.point.z + d.z * 0.4 });
      view.selected = b?.id ?? null;
      view.onSelect?.(view.selected);
    };
    const up = (e: PointerEvent) => {
      dragging = false;
      select(e);
      press = null;
    };
    const press0 = (e: PointerEvent) => {
      press = { x: e.clientX, y: e.clientY };
    };
    canvas.addEventListener("pointerdown", press0);
    const move = (e: PointerEvent) => {
      if (view.mode !== "orbit" && (dragging || document.pointerLockElement === canvas)) {
        view.yaw -= e.movementX * 0.002;
        view.pitch = Math.max(-1.3, Math.min(1.3, view.pitch - e.movementY * 0.002));
      }
    };
    const lock = () => {
      if (view.mode !== "orbit") void canvas.requestPointerLock()?.catch(() => {});
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("dblclick", lock);
    return () => {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointerdown", press0);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("dblclick", lock);
    };
  }, [gl, view, camera, scene]);
  useFrame((_, dt) => {
    if (quality.current !== view.quality) {
      quality.current = view.quality;
      view.tier = view.quality === "economy" ? 0 : 1;
      setDpr(view.tier ? Math.min(devicePixelRatio, 1.5) : 0.85);
      setShadows(view.tier > 0);
      stats.current = { elapsed: 0, frames: 0 };
    }
    stats.current.elapsed += dt;
    stats.current.frames++;
    if (stats.current.elapsed >= 3) {
      view.fps = Math.round(stats.current.frames / stats.current.elapsed);
      if (view.quality === "auto" && view.fps < 25 && view.tier > 0) {
        view.tier = 0;
        setDpr(0.75);
        setShadows(false);
      }
      stats.current = { elapsed: 0, frames: 0 };
    }
    if (view.mode !== "orbit") {
      const p = view.mode === "seat" ? sim.agents[0]!.point : sim.player;
      camera.position.set(p.x, groundAt(p) + (view.mode === "seat" ? 2.5 : 1.88), p.z);
      camera.rotation.order = "YXZ";
      camera.rotation.set(view.pitch, view.yaw, 0);
      view.target = { ...p };
    } else if (view.relocate) {
      camera.position.set(
        view.target.x + 130,
        groundAt(view.target) + 110,
        view.target.z + 155,
      );
      camera.lookAt(view.target.x, groundAt(view.target), view.target.z);
      view.relocate = false;
    }
  });
  return view.mode === "orbit" ? (
    <OrbitControls
      makeDefault
      target={[view.target.x, groundAt(view.target), view.target.z]}
      maxPolarAngle={Math.PI / 2 - 0.02}
      minDistance={8}
      maxDistance={1500}
      enableDamping
    />
  ) : null;
}
export function CityScene({ sim, view }: { sim: CitySimulation; view: ViewControl }) {
  // R3F configures its renderer asynchronously; a missing WebGL context can
  // reject before a React boundary sees it. Probe and release one context.
  const supported = useMemo(() => {
    try {
      const context = document.createElement("canvas").getContext("webgl2");
      if (!context) return false;
      context.getExtension("WEBGL_lose_context")?.loseContext();
      return true;
    } catch {
      return false;
    }
  }, []);
  if (!supported || view.failed)
    return (
      <p role="status" className="absolute top-44 left-5 max-w-sm text-sm text-teal-100">
        3D rendering is unavailable. The map, rules, scenarios, field notes and replay
        remain available.
      </p>
    );
  return (
    <Canvas
      shadows={view.tier > 0}
      dpr={view.tier > 0 ? [1, 1.5] : 1}
      camera={{
        fov: 60,
        near: 0.15,
        far: 3500,
        position: [view.target.x + 130, 110, view.target.z + 155],
      }}
      gl={{
        antialias: true,
        powerPreference: "high-performance",
        logarithmicDepthBuffer: true,
      }}
      onCreated={({ gl }) => {
        gl.domElement.addEventListener("webglcontextlost", () => {
          view.failed = true;
        });
      }}
    >
      <fog attach="fog" args={["#c2ced0", 220, 1750]} />
      <CityAtmosphere sim={sim} view={view} />
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[
          (bounds.min.x + bounds.max.x) / 2,
          minimumGround - 2,
          (bounds.min.z + bounds.max.z) / 2,
        ]}
        receiveShadow
      >
        <planeGeometry args={[5000, 5000]} />
        <meshStandardMaterial color="#929984" roughness={1} />
      </mesh>
      <StaticCity view={view} />
      <Actors sim={sim} view={view} />
      <Signals sim={sim} />
      <EventVisuals sim={sim} />
      <EvidenceCity view={view} />
      <Camera sim={sim} view={view} />
    </Canvas>
  );
}
