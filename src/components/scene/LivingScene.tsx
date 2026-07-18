import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import {
  CIRCUIT_WAYPOINTS,
  PATROL_ROUTE,
  RADAR_POS,
  STRUCTURES,
  WINDSOCK_POS,
  type StructureType,
} from "@/lib/layout";
import { terrainHeight } from "@/lib/terrain";
import { useTwinStore } from "@/lib/store";

/**
 * Everything on the site that *moves*: a resident demonstrator flying the
 * runway pattern, a rotating air-search radar, a guard vehicle on patrol, a
 * windsock reading the breeze, and red obstruction beacons winking on the tall
 * structures after dark. All animation runs through `useFrame`/refs — no React
 * state on the frame loop — and every position is read from `layout.ts`.
 */
export function LivingScene() {
  const night = useTwinStore((s) => s.night);
  return (
    <group name="living-scene">
      <CircuitAircraft />
      <RotatingRadar />
      <PatrolVehicle night={night} />
      <Windsock />
      <ObstructionBeacons night={night} />
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Resident demonstrator flying the runway circuit                     */
/* ------------------------------------------------------------------ */

const LOOP_SECONDS = 62;

function CircuitAircraft() {
  const curve = useMemo(
    () =>
      new THREE.CatmullRomCurve3(
        CIRCUIT_WAYPOINTS.map((w) => new THREE.Vector3(...w)),
        true,
        "centripetal",
        0.5,
      ),
    [],
  );

  const rootRef = useRef<THREE.Group>(null);
  const rollRef = useRef<THREE.Group>(null);
  const strobeRef = useRef<THREE.MeshStandardMaterial>(null);
  const t = useRef(0);
  const bank = useRef(0);
  const pos = useMemo(() => new THREE.Vector3(), []);
  const tan = useMemo(() => new THREE.Vector3(), []);
  const tanAhead = useMemo(() => new THREE.Vector3(), []);
  const lookTarget = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, delta) => {
    const root = rootRef.current;
    if (!root) return;
    t.current = (t.current + delta / LOOP_SECONDS) % 1;
    const tt = t.current;
    curve.getPointAt(tt, pos);
    curve.getTangentAt(tt, tan);
    curve.getTangentAt((tt + 0.01) % 1, tanAhead);

    root.position.copy(pos);
    lookTarget.copy(pos).add(tan);
    root.lookAt(lookTarget); // model nose is -Z

    // bank into the turn, from the change in horizontal heading
    const cross = tan.x * tanAhead.z - tan.z * tanAhead.x;
    const bankTarget = THREE.MathUtils.clamp(cross * 7, -0.7, 0.7);
    bank.current += (bankTarget - bank.current) * Math.min(1, delta * 2);
    if (rollRef.current) rollRef.current.rotation.z = bank.current;

    // double-pulse anti-collision strobe
    if (strobeRef.current) {
      const cyc = (t.current * LOOP_SECONDS) % 1.1;
      const on = cyc < 0.06 || (cyc > 0.14 && cyc < 0.2);
      strobeRef.current.emissiveIntensity = on ? 6 : 0;
    }
  });

  const wingGeo = useMemo(() => {
    const span = 16;
    const len = 17;
    const s = new THREE.Shape();
    s.moveTo(0, len * 0.5);
    s.lineTo(span * 0.5, -len * 0.34);
    s.lineTo(span * 0.5 - 1, -len * 0.42);
    s.lineTo(span * 0.16, -len * 0.46);
    s.lineTo(0, -len * 0.36);
    s.lineTo(-span * 0.16, -len * 0.46);
    s.lineTo(-(span * 0.5 - 1), -len * 0.42);
    s.lineTo(-span * 0.5, -len * 0.34);
    s.closePath();
    const geo = new THREE.ExtrudeGeometry(s, {
      depth: 0.4,
      bevelEnabled: true,
      bevelThickness: 0.25,
      bevelSize: 0.5,
      bevelSegments: 2,
    });
    geo.rotateX(-Math.PI / 2);
    return geo;
  }, []);

  const body = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#3a3d42", roughness: 0.5, metalness: 0.35 }),
    [],
  );
  const canopy = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#16242f", roughness: 0.12, metalness: 0.85 }),
    [],
  );

  return (
    <group ref={rootRef}>
      <group ref={rollRef}>
        <mesh geometry={wingGeo} material={body} position={[0, 0, 0]} castShadow />
        {/* dorsal fairing + canopy */}
        <mesh material={body} position={[0, 0.5, -1.5]} scale={[1.3, 0.6, 2.4]} castShadow>
          <sphereGeometry args={[1.15, 18, 12]} />
        </mesh>
        <mesh material={canopy} position={[0, 0.85, -4]} scale={[0.8, 0.6, 1.9]}>
          <sphereGeometry args={[0.8, 16, 10]} />
        </mesh>
        {/* canted twin fins */}
        {[-1, 1].map((side) => (
          <mesh
            key={side}
            material={body}
            position={[side * 1.1, 1.1, 5]}
            rotation={[0.35, 0, side * -0.3]}
            castShadow
          >
            <boxGeometry args={[0.12, 2, 1.6]} />
          </mesh>
        ))}
        {/* wingtip navigation lights: red port (−x), green starboard (+x) */}
        <mesh position={[-8, 0.1, -0.5]}>
          <sphereGeometry args={[0.22, 8, 8]} />
          <meshStandardMaterial
            color="#ff2a2a"
            emissive={new THREE.Color("#ff2a2a")}
            emissiveIntensity={4}
          />
        </mesh>
        <mesh position={[8, 0.1, -0.5]}>
          <sphereGeometry args={[0.22, 8, 8]} />
          <meshStandardMaterial
            color="#22ff55"
            emissive={new THREE.Color("#22ff55")}
            emissiveIntensity={4}
          />
        </mesh>
        {/* belly anti-collision strobe */}
        <mesh position={[0, -0.4, 0]}>
          <sphereGeometry args={[0.2, 8, 8]} />
          <meshStandardMaterial
            ref={strobeRef}
            color="#ffffff"
            emissive={new THREE.Color("#ffffff")}
            emissiveIntensity={0}
          />
        </mesh>
      </group>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Rotating air-search radar                                           */
/* ------------------------------------------------------------------ */

function RotatingRadar() {
  const [x, z] = RADAR_POS;
  const y = terrainHeight(x, z);
  const dishRef = useRef<THREE.Group>(null);

  const metal = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#8b8d88", roughness: 0.5, metalness: 0.5 }),
    [],
  );
  const dish = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#d7d4c8", roughness: 0.6, metalness: 0.2, side: THREE.DoubleSide }),
    [],
  );

  useFrame((_, delta) => {
    if (dishRef.current) dishRef.current.rotation.y += delta * (Math.PI * 2) / 6; // ~10 rpm
  });

  return (
    <group position={[x, y, z]}>
      {/* pad + equipment cabin */}
      <mesh material={metal} position={[3.2, 1.1, 2]} castShadow>
        <boxGeometry args={[3, 2.2, 2.4]} />
      </mesh>
      {/* tapered mast */}
      <mesh material={metal} position={[0, 3, 0]} castShadow>
        <cylinderGeometry args={[0.5, 0.9, 6, 8]} />
      </mesh>
      <group ref={dishRef} position={[0, 6.2, 0]}>
        {/* turntable */}
        <mesh material={metal} castShadow>
          <cylinderGeometry args={[1, 1.1, 0.8, 12]} />
        </mesh>
        {/* curved reflector on a support arm */}
        <mesh material={metal} position={[0, 0.6, 0]}>
          <boxGeometry args={[0.3, 0.6, 1]} />
        </mesh>
        <mesh material={dish} position={[0, 1.5, 0.2]} rotation={[0.35, 0, 0]} castShadow>
          <boxGeometry args={[7, 1.6, 0.15]} />
        </mesh>
        {/* feed horn out front of the reflector */}
        <mesh material={metal} position={[0, 1.1, 0.9]}>
          <boxGeometry args={[0.4, 0.4, 0.6]} />
        </mesh>
      </group>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Guard vehicle on patrol                                             */
/* ------------------------------------------------------------------ */

function PatrolVehicle({ night }: { night: boolean }) {
  const groupRef = useRef<THREE.Group>(null);
  const s = useRef(0);
  const heading = useRef(0);

  // arc-length parameterization of the (open) patrol polyline
  const { pts, cum, total } = useMemo(() => {
    const pts = PATROL_ROUTE.map(([px, pz]) => new THREE.Vector2(px, pz));
    const cum = [0];
    for (let i = 1; i < pts.length; i++) {
      cum.push(cum[i - 1]! + pts[i]!.distanceTo(pts[i - 1]!));
    }
    return { pts, cum, total: cum[cum.length - 1]! };
  }, []);

  const SPEED = 18; // m/s

  const body = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#5c5643", roughness: 0.8, metalness: 0.1 }),
    [],
  );
  const cab = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#6d6650", roughness: 0.8 }),
    [],
  );
  const tyre = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#15161a", roughness: 0.95 }),
    [],
  );
  const lamp = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#ffe9c4",
        emissive: new THREE.Color("#ffe9c4"),
        emissiveIntensity: 0,
      }),
    [],
  );

  const at = useMemo(() => new THREE.Vector2(), []);
  const ahead = useMemo(() => new THREE.Vector2(), []);

  const sample = (dist: number, out: THREE.Vector2) => {
    const d = THREE.MathUtils.clamp(dist, 0, total);
    let i = 1;
    while (i < cum.length && cum[i]! < d) i++;
    const a = pts[i - 1]!;
    const b = pts[Math.min(i, pts.length - 1)]!;
    const seg = Math.max(1e-3, cum[Math.min(i, cum.length - 1)]! - cum[i - 1]!);
    const f = (d - cum[i - 1]!) / seg;
    out.lerpVectors(a, b, THREE.MathUtils.clamp(f, 0, 1));
    return out;
  };

  useFrame((_, delta) => {
    const g = groupRef.current;
    if (!g) return;
    // ping-pong along the route
    s.current += delta * SPEED;
    const period = total * 2;
    const raw = s.current % period;
    const forward = raw <= total;
    const d = forward ? raw : period - raw;
    sample(d, at);
    // look a few metres in the *actual* direction of travel for the heading
    sample(forward ? Math.min(total, d + 5) : Math.max(0, d - 5), ahead);
    const dirx = ahead.x - at.x;
    const dirz = ahead.y - at.y;
    // model front is local −z (headlights), so face −dir
    const targetHeading = Math.atan2(-dirx, -dirz);
    // shortest-arc smoothing of the yaw
    let dh = targetHeading - heading.current;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    heading.current += dh * Math.min(1, delta * 4);

    g.position.set(at.x, terrainHeight(at.x, at.y) + 0.55, at.y);
    g.rotation.y = heading.current;
    lamp.emissiveIntensity = night ? 5 : 0;
  });

  return (
    <group ref={groupRef}>
      <mesh material={body} position={[0, 0.35, 0.2]} castShadow>
        <boxGeometry args={[1.9, 0.7, 4.4]} />
      </mesh>
      <mesh material={cab} position={[0, 0.95, -0.9]} castShadow>
        <boxGeometry args={[1.8, 0.9, 1.8]} />
      </mesh>
      {/* headlights (−z is forward) */}
      {[-0.6, 0.6].map((sx) => (
        <mesh key={sx} material={lamp} position={[sx, 0.4, -2.05]}>
          <boxGeometry args={[0.35, 0.25, 0.1]} />
        </mesh>
      ))}
      {[-1, 1].map((sx) =>
        [-1.2, 1.3].map((sz) => (
          <mesh
            key={`${sx}${sz}`}
            material={tyre}
            position={[sx * 0.95, 0.35, sz]}
            rotation={[0, 0, Math.PI / 2]}
          >
            <cylinderGeometry args={[0.35, 0.35, 0.25, 10]} />
          </mesh>
        )),
      )}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Windsock                                                            */
/* ------------------------------------------------------------------ */

function Windsock() {
  const [x, z] = WINDSOCK_POS;
  const y = terrainHeight(x, z);
  const sockRef = useRef<THREE.Group>(null);

  const pole = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#9a9488", roughness: 0.6, metalness: 0.3 }),
    [],
  );
  const red = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#d64a2e", roughness: 0.85, side: THREE.DoubleSide }),
    [],
  );
  const white = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#e7e2d5", roughness: 0.85, side: THREE.DoubleSide }),
    [],
  );

  // five tapering open bands forming the cone, alternating red/white
  const bands = useMemo(() => {
    const out: { z: number; r0: number; r1: number; h: number; mat: THREE.Material }[] = [];
    const len = 3.6;
    const seg = 5;
    for (let i = 0; i < seg; i++) {
      const r0 = 0.55 - (i / seg) * 0.4;
      const r1 = 0.55 - ((i + 1) / seg) * 0.4;
      out.push({
        z: (i + 0.5) * (len / seg),
        r0,
        r1,
        h: len / seg,
        mat: i % 2 === 0 ? red : white,
      });
    }
    return out;
  }, [red, white]);

  useFrame(({ clock }) => {
    const g = sockRef.current;
    if (!g) return;
    const t = clock.elapsedTime;
    // slow wind-direction drift plus a gustier flutter
    g.rotation.y = Math.sin(t * 0.12) * 0.9 + Math.sin(t * 0.5) * 0.15;
    // lift/droop of the sleeve with the gusts
    g.rotation.x = -0.35 + Math.sin(t * 1.3) * 0.12 + Math.sin(t * 3.1) * 0.05;
  });

  return (
    <group position={[x, y, z]}>
      <mesh material={pole} position={[0, 3, 0]} castShadow>
        <cylinderGeometry args={[0.12, 0.16, 6, 8]} />
      </mesh>
      {/* pivot swivel at the top */}
      <mesh material={pole} position={[0, 6, 0]}>
        <sphereGeometry args={[0.2, 8, 8]} />
      </mesh>
      <group ref={sockRef} position={[0, 6, 0]}>
        {/* mouth ring */}
        <mesh material={pole} position={[0, 0, 0.1]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.55, 0.05, 6, 16]} />
        </mesh>
        {bands.map((b, i) => (
          <mesh key={i} material={b.mat} position={[0, 0, b.z]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[b.r1, b.r0, b.h, 14, 1, true]} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Night obstruction beacons on the tall structures                    */
/* ------------------------------------------------------------------ */

const BEACON_TOP: Partial<Record<StructureType, number>> = {
  tower: 1.18,
  "water-tower": 1.05,
  radome: 2.1,
  "guard-tower": 1.05,
};

function ObstructionBeacons({ night }: { night: boolean }) {
  const beacons = useMemo(() => {
    return STRUCTURES.flatMap((sdef) => {
      const factor = BEACON_TOP[sdef.type];
      if (factor === undefined) return [];
      const pos: [number, number, number] = [
        sdef.position[0],
        sdef.size[1] * factor + 1,
        sdef.position[1],
      ];
      return [
        {
          id: sdef.id,
          pos,
          phase: (sdef.position[0] * 0.13 + sdef.position[1] * 0.07) % (Math.PI * 2),
        },
      ];
    });
  }, []);

  const mats = useMemo(
    () =>
      beacons.map(
        () =>
          new THREE.MeshStandardMaterial({
            color: "#ff2a1a",
            emissive: new THREE.Color("#ff2a1a"),
            emissiveIntensity: 0,
          }),
      ),
    [beacons],
  );

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const base = night ? 1 : 0.25;
    for (let i = 0; i < mats.length; i++) {
      // sharp anti-collision blink, ~50/min, staggered per structure
      const p = Math.sin(t * 3 + (beacons[i]!.phase ?? 0));
      const flash = Math.pow(Math.max(0, p), 8);
      mats[i]!.emissiveIntensity = base * (0.15 + flash * 5);
    }
  });

  return (
    <group>
      {beacons.map((b, i) => (
        <mesh key={b.id} position={b.pos} material={mats[i]}>
          <sphereGeometry args={[0.5, 8, 8]} />
        </mesh>
      ))}
    </group>
  );
}
