import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { createCityGeometry } from "./geometry";
import { CityAtmosphere } from "./Atmosphere";
import { roads, green } from "./network";
import { bounds, distance, signalPoints, type Point } from "./model";
import { type CitySimulation } from "./simulation";
import { Actors } from "./Actors";
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
}
function StaticCity({ view }: { view: ViewControl }) {
  const built = useMemo(createCityGeometry, []);
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
        color.set(edges[i] && green(sim.tick, edges[i]) ? "#559c78" : "#c65239"),
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
function Events({ sim }: { sim: CitySimulation }) {
  const { camera } = useThree();
  const fire = useRef<THREE.Group>(null),
    object = useRef<THREE.Mesh>(null),
    rain = useRef<THREE.Points>(null),
    perimeter = useRef<THREE.Mesh>(null);
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry(),
      data = new Float32Array(900);
    for (let i = 0; i < 300; i++) {
      data[i * 3] = ((i * 47) % 130) - 65;
      data[i * 3 + 1] = i % 30;
      data[i * 3 + 2] = ((i * 31) % 130) - 65;
    }
    g.setAttribute("position", new THREE.BufferAttribute(data, 3));
    return g;
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useFrame(() => {
    const f = sim.events.find((e) => e.kind === "fire"),
      u = sim.events.find((e) => e.kind === "object"),
      storm = sim.events.some((e) => e.kind === "storm");
    if (fire.current) {
      fire.current.visible = !!f;
      if (f) {
        fire.current.position.set(f.point.x, groundAt(f.point), f.point.z);
        fire.current.scale.setScalar(1 + Math.sin(sim.tick * 0.3) * 0.03);
      }
    }
    if (perimeter.current) {
      perimeter.current.visible = !!f;
      if (f) {
        perimeter.current.position.set(f.point.x, groundAt(f.point) + 0.22, f.point.z);
        perimeter.current.scale.setScalar(f.radius);
      }
    }
    if (object.current) {
      object.current.visible = !!u;
      if (u) {
        object.current.position.set(
          u.point.x,
          groundAt(u.point) + 90 + Math.sin(sim.tick * 0.01) * 3,
          u.point.z,
        );
        object.current.rotation.y = sim.tick * 0.006;
      }
    }
    if (rain.current) {
      rain.current.visible = storm;
      rain.current.position.set(
        camera.position.x,
        camera.position.y - 5,
        camera.position.z,
      );
      const a = geometry.getAttribute("position");
      for (let i = 0; i < 300; i++) a.setY(i, 30 - ((sim.tick * 0.7 + i) % 30));
      a.needsUpdate = true;
    }
  });
  return (
    <>
      <group ref={fire} visible={false}>
        <mesh position={[0, 3, 0]}>
          <coneGeometry args={[3.8, 7, 9]} />
          <meshBasicMaterial color="#d87935" transparent opacity={0.85} />
        </mesh>
        {[0, 1, 2, 3].map((i) => (
          <mesh key={i} position={[i * 1.5, 9 + i * 6, i * 0.8]}>
            <sphereGeometry args={[4 + i, 10, 8]} />
            <meshStandardMaterial color="#525753" transparent opacity={0.5 - i * 0.06} />
          </mesh>
        ))}
      </group>
      <mesh ref={perimeter} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <ringGeometry args={[0.97, 1, 64]} />
        <meshBasicMaterial color="#d2a55b" side={THREE.DoubleSide} />
      </mesh>
      <mesh ref={object} scale={[10, 2.6, 10]} visible={false}>
        <sphereGeometry args={[1, 32, 12]} />
        <meshStandardMaterial color="#8b9d9e" metalness={0.9} roughness={0.25} />
      </mesh>
      <points ref={rain} geometry={geometry} visible={false}>
        <pointsMaterial color="#b9d4df" size={0.15} transparent opacity={0.6} />
      </points>
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
    const up = () => {
      dragging = false;
    };
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
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("dblclick", lock);
    };
  }, [gl, view]);
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
      <Events sim={sim} />
      <Camera sim={sim} view={view} />
    </Canvas>
  );
}
