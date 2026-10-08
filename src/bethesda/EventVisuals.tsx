/**
 * Event presentation. Reads the simulator every frame; never writes to it.
 * Positions come from the event (or a procession's occupied section) and the
 * simulator's closure sets. Fire, smoke, water, rain and the object are
 * simplified visual stand-ins, not physical models.
 */
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { roads } from "./network";
import { buildingAt, metro, distance, type Point } from "./model";
import type { CitySimulation, ProcessionState } from "./simulation";
import type { CityEvent } from "./scenarios";
import { groundAt } from "./terrain";

const SLOTS = 8;
const MARCHERS = 220;
const BARRICADES = 90;
const TENTS = 16;
const uniforms = ["#2f4d7a", "#b13a32", "#e8e2d3", "#2f6b4a", "#d6a23a"];

function along(s: ProcessionState, d: number): { p: Point; heading: number } {
  const t = Math.max(0, Math.min(s.total, d));
  let i = 1;
  while (i < s.cum.length - 1 && s.cum[i]! < t) i++;
  const a = s.points[i - 1]!,
    b = s.points[i]!,
    span = s.cum[i]! - s.cum[i - 1]!,
    u = span > 0 ? (t - s.cum[i - 1]!) / span : 0;
  return {
    p: { x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u },
    heading: Math.atan2(b.x - a.x, b.z - a.z),
  };
}

export function EventVisuals({ sim }: { sim: CitySimulation }) {
  const { camera } = useThree();
  const slots = useRef<(THREE.Group | null)[]>([]);
  const marchers = useRef<THREE.InstancedMesh>(null),
    heads = useRef<THREE.InstancedMesh>(null),
    floats = useRef<THREE.InstancedMesh>(null),
    barricades = useRef<THREE.InstancedMesh>(null),
    tents = useRef<THREE.InstancedMesh>(null),
    rain = useRef<THREE.Points>(null),
    metroTape = useRef<THREE.Mesh>(null);
  const scratch = useMemo(
    () => ({
      dummy: new THREE.Object3D(),
      color: new THREE.Color(),
      // The closure set last drawn. A simulation replaces (never mutates) its
      // set on every change, and each simulation owns its own, so identity
      // covers both a closure change and a world swap (Reset, Verify replay),
      // where a per-simulation version counter can coincide.
      closed: null as ReadonlySet<number> | null,
    }),
    [],
  );
  const rainGeometry = useMemo(() => {
    const g = new THREE.BufferGeometry(),
      data = new Float32Array(1800);
    for (let i = 0; i < 600; i++) {
      data[i * 3] = ((i * 47) % 130) - 65;
      data[i * 3 + 1] = i % 30;
      data[i * 3 + 2] = ((i * 31) % 130) - 65;
    }
    g.setAttribute("position", new THREE.BufferAttribute(data, 3));
    return g;
  }, []);
  useEffect(() => () => rainGeometry.dispose(), [rainGeometry]);

  useFrame(({ clock }) => {
    const { dummy, color } = scratch;
    const t = clock.elapsedTime;
    const events: (CityEvent | undefined)[] = sim.events.slice(0, SLOTS);
    let marching = 0,
      floatCount = 0,
      tentCount = 0;
    for (let i = 0; i < SLOTS; i++) {
      const group = slots.current[i];
      if (!group) continue;
      const e = events[i];
      group.visible = !!e;
      if (!e) continue;
      const g = groundAt(e.at);
      group.position.set(e.at.x, g, e.at.z);
      for (const child of group.children)
        child.visible =
          child.name === e.kind ||
          (child.name === "perimeter" &&
            ["fire", "gas-leak", "crash", "flood", "rally", "festival"].includes(e.kind));
      const fire = group.getObjectByName("fire");
      if (fire?.visible) {
        // A fire inside a mapped footprint burns at its roof, not inside its walls.
        const b = buildingAt(e.at);
        fire.position.y = b ? groundAt(b.center) - g + b.height : 0;
        fire.scale.setScalar((e.radius / 32) * (1 + Math.sin(t * 7 + i) * 0.04));
        fire.children.forEach((c, k) => {
          if (k > 0) c.position.y = 9 + k * 6 + ((t * 2 + k * 3) % 6);
        });
      }
      const perimeter = group.getObjectByName("perimeter");
      if (perimeter?.visible) perimeter.scale.setScalar(e.radius);
      const object = group.getObjectByName("object");
      if (object?.visible) {
        object.position.y = 90 + Math.sin(t * 0.6) * 3;
        object.rotation.y = t * 0.12;
      }
      const flood = group.getObjectByName("flood");
      if (flood?.visible && e.level !== undefined) {
        // A flat water surface at the compiled level: it only shows where the
        // bare-earth DTM is lower, which is the bathtub model and no more.
        flood.position.y = e.level - g;
        flood.scale.setScalar(e.radius);
      }
      const haze = group.getObjectByName("gas-leak");
      if (haze?.visible) haze.scale.setScalar(e.radius * 0.6);
      if (e.kind === "festival" && tents.current) {
        const r = e.radius * 0.55;
        for (let k = 0; k < 8 && tentCount < TENTS; k++) {
          const a = (k / 8) * Math.PI * 2;
          const p = { x: e.at.x + Math.cos(a) * r, z: e.at.z + Math.sin(a) * r };
          dummy.position.set(p.x, groundAt(p) + 1.5, p.z);
          dummy.rotation.set(0, a, 0);
          dummy.scale.set(3, 3, 3);
          dummy.updateMatrix();
          tents.current.setMatrixAt(tentCount, dummy.matrix);
          tents.current.setColorAt(tentCount++, color.set(k % 2 ? "#efece4" : "#c9d6d3"));
        }
      }
      const s = sim.procession(e);
      if (s && marchers.current && floats.current) {
        // Rows of marchers from tail to head, with a decorated float every 40 m.
        for (let d = s.head - 2; d > s.tail && marching < MARCHERS; d -= 1.6) {
          const { p, heading } = along(s, d);
          const row = Math.floor((s.head - d) / 1.6);
          if (row % 25 === 12 && floatCount < 6) {
            dummy.position.set(p.x, groundAt(p) + 1.3, p.z);
            dummy.rotation.set(0, heading, 0);
            dummy.scale.set(2.6, 2.2, 6);
            dummy.updateMatrix();
            floats.current.setMatrixAt(floatCount, dummy.matrix);
            floats.current.setColorAt(
              floatCount++,
              color.set(uniforms[(row + i) % uniforms.length]!),
            );
            continue;
          }
          for (let k = -2; k <= 2 && marching < MARCHERS; k++) {
            const q = {
              x: p.x + Math.cos(heading) * k * 1.1,
              z: p.z - Math.sin(heading) * k * 1.1,
            };
            const step = Math.abs(Math.sin(t * 6 + row));
            dummy.position.set(q.x, groundAt(q) + 0.9 + step * 0.06, q.z);
            dummy.rotation.set(0, heading, 0);
            dummy.scale.set(0.42, 0.85, 0.32);
            dummy.updateMatrix();
            marchers.current.setMatrixAt(marching, dummy.matrix);
            if (heads.current) {
              dummy.position.y += 1.05;
              dummy.scale.setScalar(0.22);
              dummy.updateMatrix();
              heads.current.setMatrixAt(marching, dummy.matrix);
            }
            marchers.current.setColorAt(
              marching++,
              color.set(uniforms[Math.floor(row / 6) % uniforms.length]!),
            );
          }
        }
      }
    }
    if (import.meta.env.DEV)
      Object.assign(window, { __eventVisuals: { marching, floatCount, tentCount } });
    for (const [mesh, n] of [
      [marchers.current, marching],
      [heads.current, marching],
      [floats.current, floatCount],
      [tents.current, tentCount],
    ] as const) {
      if (!mesh) continue;
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    // Barricades where an open road enters a closure; rebuilt on change only.
    if (barricades.current && scratch.closed !== sim.closedRoads) {
      scratch.closed = sim.closedRoads;
      let n = 0;
      const seen: Point[] = [];
      for (const id of sim.closedRoads) {
        const e = roads.edges[id]!;
        const open = (roads.incoming.get(e.from) ?? []).some(
          (k) => !sim.closedRoads.has(k),
        );
        if (!open || n >= BARRICADES) continue;
        const a = roads.nodes.get(e.from)!,
          b = roads.nodes.get(e.to)!;
        const p = {
          x: a.x + (b.x - a.x) * Math.min(0.5, 3 / e.length),
          z: a.z + (b.z - a.z) * Math.min(0.5, 3 / e.length),
        };
        if (seen.some((q) => distance(q, p) < 4)) continue;
        seen.push(p);
        dummy.position.set(p.x, groundAt(p) + 0.55, p.z);
        dummy.rotation.set(0, e.heading + Math.PI / 2, 0);
        dummy.scale.set(Math.min(6, e.width * 0.8), 1, 0.25);
        dummy.updateMatrix();
        barricades.current.setMatrixAt(n++, dummy.matrix);
      }
      barricades.current.count = n;
      barricades.current.instanceMatrix.needsUpdate = true;
    }
    if (metroTape.current) metroTape.current.visible = !sim.metroOpen();
    const storm = sim.events.some((e) => e.kind === "storm");
    if (rain.current) {
      rain.current.visible = storm;
      rain.current.position.set(
        camera.position.x,
        camera.position.y - 5,
        camera.position.z,
      );
      const a = rainGeometry.getAttribute("position");
      for (let i = 0; i < 600; i++) a.setY(i, 30 - ((t * 22 + i * 0.37) % 30));
      a.needsUpdate = true;
    }
  });
  return (
    <>
      {Array.from({ length: SLOTS }, (_, i) => (
        <group key={i} ref={(g) => void (slots.current[i] = g)} visible={false}>
          <group name="fire">
            <mesh position={[0, 3, 0]}>
              <coneGeometry args={[3.8, 7, 9]} />
              <meshBasicMaterial color="#e08236" transparent opacity={0.85} />
            </mesh>
            {[0, 1, 2, 3].map((k) => (
              <mesh key={k} position={[k * 1.5, 9 + k * 6, k * 0.8]}>
                <sphereGeometry args={[4 + k, 10, 8]} />
                <meshStandardMaterial
                  color="#4c514e"
                  transparent
                  opacity={0.5 - k * 0.07}
                  depthWrite={false}
                />
              </mesh>
            ))}
          </group>
          <mesh name="perimeter" rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.25, 0]}>
            <ringGeometry args={[0.97, 1, 64]} />
            <meshBasicMaterial color="#d2a55b" side={THREE.DoubleSide} />
          </mesh>
          <group name="object">
            <mesh scale={[10, 2.6, 10]}>
              <sphereGeometry args={[1, 32, 12]} />
              <meshStandardMaterial color="#8b9d9e" metalness={0.9} roughness={0.25} />
            </mesh>
            <mesh position={[0, -1.6, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[6.5, 0.35, 8, 48]} />
              <meshBasicMaterial color="#bfeef0" />
            </mesh>
            <mesh position={[0, -46, 0]}>
              <coneGeometry args={[16, 88, 32, 1, true]} />
              <meshBasicMaterial
                color="#cdf4f2"
                transparent
                opacity={0.07}
                depthWrite={false}
                side={THREE.DoubleSide}
              />
            </mesh>
          </group>
          <mesh name="flood" rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[1, 64]} />
            <meshStandardMaterial
              color="#4b5243"
              roughness={0.04}
              metalness={0.2}
              transparent
              opacity={0.93}
              envMapIntensity={1.4}
            />
          </mesh>
          <group name="crash">
            <mesh position={[-1.2, 0.75, 0]} rotation={[0, 0.5, 0.06]}>
              <boxGeometry args={[1.8, 1.4, 4.4]} />
              <meshStandardMaterial color="#6f757a" roughness={0.4} />
            </mesh>
            <mesh position={[1.6, 0.75, 1.2]} rotation={[0, -0.9, -0.04]}>
              <boxGeometry args={[1.8, 1.45, 4.5]} />
              <meshStandardMaterial color="#8c3a30" roughness={0.4} />
            </mesh>
          </group>
          <mesh name="gas-leak" position={[0, 2, 0]} scale={[1, 0.08, 1]}>
            <sphereGeometry args={[1, 24, 10]} />
            <meshBasicMaterial
              color="#d9df9a"
              transparent
              opacity={0.12}
              depthWrite={false}
            />
          </mesh>
        </group>
      ))}
      <instancedMesh
        ref={marchers}
        args={[undefined, undefined, MARCHERS]}
        frustumCulled={false}
        castShadow
      >
        <capsuleGeometry args={[0.5, 1, 3, 8]} />
        <meshStandardMaterial roughness={0.8} />
      </instancedMesh>
      <instancedMesh
        ref={heads}
        args={[undefined, undefined, MARCHERS]}
        frustumCulled={false}
      >
        <sphereGeometry args={[1, 10, 8]} />
        <meshStandardMaterial color="#a9806a" roughness={0.8} />
      </instancedMesh>
      <instancedMesh
        ref={floats}
        args={[undefined, undefined, 6]}
        frustumCulled={false}
        castShadow
      >
        <boxGeometry />
        <meshStandardMaterial roughness={0.7} />
      </instancedMesh>
      <instancedMesh
        ref={tents}
        args={[undefined, undefined, TENTS]}
        frustumCulled={false}
        castShadow
      >
        <coneGeometry args={[0.75, 0.6, 4]} />
        <meshStandardMaterial roughness={0.9} />
      </instancedMesh>
      <instancedMesh
        ref={barricades}
        args={[undefined, undefined, BARRICADES]}
        frustumCulled={false}
        castShadow
      >
        <boxGeometry />
        <meshStandardMaterial color="#d6662a" roughness={0.6} />
      </instancedMesh>
      <mesh
        ref={metroTape}
        position={[metro.point.x, groundAt(metro.point) + 1, metro.point.z]}
        visible={false}
      >
        <boxGeometry args={[7, 0.12, 7]} />
        <meshBasicMaterial color="#e6c63c" wireframe />
      </mesh>
      <points ref={rain} geometry={rainGeometry} visible={false}>
        <pointsMaterial color="#b9d4df" size={0.15} transparent opacity={0.6} />
      </points>
    </>
  );
}
