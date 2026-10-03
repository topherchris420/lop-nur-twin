import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { groundAt } from "../terrain";
import { EMBODIMENT } from "./embodiment";
import type { Perspective } from "./contracts";
import type { PresenceMark } from "./presence";

const WHO = Object.keys(EMBODIMENT) as Perspective[];

/**
 * The lab's perspectives on outings, drawn in the city. Presentation only:
 * the marks come from the lab's store (`presenceSnapshot`), which derives
 * them from the city tick. Nothing here is a simulation agent — no pedestrian
 * sees, avoids or reacts to these figures, and where one stands is never
 * evidence. A faint ring at the feet means the simulator is being asked to
 * observe the place; it is not a measurement.
 *
 * Kept light enough for the city bundle: it imports no lab store or panel.
 */
export function CityPresence({ read }: { read: () => readonly PresenceMark[] }) {
  const figures = useRef<Partial<Record<Perspective, THREE.Group | null>>>({});
  const halos = useRef<Partial<Record<Perspective, THREE.Mesh | null>>>({});
  const state = useRef<
    Partial<Record<Perspective, { x: number; z: number; yaw: number }>>
  >({});
  const materials = useMemo(
    () =>
      Object.fromEntries(
        WHO.map((who) => [
          who,
          {
            body: new THREE.MeshStandardMaterial({
              color: EMBODIMENT[who].body,
              roughness: 0.6,
            }),
            head: new THREE.MeshStandardMaterial({
              color: EMBODIMENT[who].skin,
              roughness: 0.55,
            }),
            hair: new THREE.MeshStandardMaterial({
              color: EMBODIMENT[who].hair,
              roughness: 0.8,
            }),
          },
        ]),
      ) as Record<
        Perspective,
        Record<"body" | "head" | "hair", THREE.MeshStandardMaterial>
      >,
    [],
  );
  useEffect(
    () => () => {
      for (const set of Object.values(materials))
        for (const m of Object.values(set)) m.dispose();
    },
    [materials],
  );
  useFrame((_, dt) => {
    const marks = read();
    for (const who of WHO) {
      const g = figures.current[who],
        halo = halos.current[who];
      if (!g || !halo) continue;
      const mark = marks.find((m) => m.who === who);
      if (!mark) {
        g.visible = halo.visible = false;
        delete state.current[who];
        continue;
      }
      // Ease toward the 10 Hz position so the walk reads as a walk.
      const s = (state.current[who] ??= { x: mark.x, z: mark.z, yaw: 0 });
      const k = Math.min(1, dt * 8);
      const dx = mark.x - s.x,
        dz = mark.z - s.z;
      if (Math.hypot(dx, dz) > 0.05) s.yaw = Math.atan2(dx, dz);
      s.x += dx * k;
      s.z += dz * k;
      const ground = groundAt(s);
      g.visible = true;
      g.position.set(s.x, ground, s.z);
      g.rotation.y = s.yaw;
      halo.visible = mark.phase === "observing";
      halo.position.set(s.x, ground + 0.04, s.z);
    }
  });
  return (
    <group name="rain-lab-presence">
      {WHO.map((who) => (
        <group key={who}>
          <group ref={(g) => void (figures.current[who] = g)} visible={false}>
            <mesh position={[0, 0.82, 0]} material={materials[who].body} castShadow>
              <cylinderGeometry args={[0.2, 0.26, 1.2, 12]} />
            </mesh>
            <mesh position={[0, 1.58, 0]} material={materials[who].head} castShadow>
              <sphereGeometry args={[0.17, 14, 12]} />
            </mesh>
            <mesh position={[0, 1.66, -0.02]} material={materials[who].hair}>
              <sphereGeometry args={[0.175, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
            </mesh>
          </group>
          <mesh
            ref={(h) => void (halos.current[who] = h)}
            rotation={[-Math.PI / 2, 0, 0]}
            visible={false}
          >
            <ringGeometry args={[0.55, 0.68, 32]} />
            <meshBasicMaterial
              color="#3fb6b0"
              transparent
              opacity={0.65}
              depthWrite={false}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}
