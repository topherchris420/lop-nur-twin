import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import {
  CIRCUIT_AIRCRAFT_ID,
  PATROL_ENTITY_IDS,
  PERIMETER_PATROL_ROUTE,
  RADAR_ENTITY_ID,
  RADAR_POS,
  STRUCTURES,
  WINDSOCK_ENTITY_ID,
  WINDSOCK_POS,
  isVisibleAtTimelineYear,
  type StructureType,
} from "@/lib/layout";
import { terrainHeight } from "@/lib/terrain";
import { useTwinStore } from "@/lib/store";
import { getClimateMonth } from "@/lib/siteData";
import { getQualityProfile } from "@/lib/quality";
import { createCircuitCurve } from "@/lib/flightPath";
import { mulberry32, SITE_SEED } from "@/lib/noise";
import { sceneProjection } from "@/lib/sceneProjection";

/**
 * Everything on the site that *moves*: a resident demonstrator flying the
 * runway pattern, a rotating radar-like prop, a seeded patrol fleet on an illustrative route, a
 * windsock reading the breeze, and red obstruction beacons winking on the tall
 * structures after dark. All animation runs through `useFrame`/refs — no React
 * state on the frame loop — and every position is read from `layout.ts`.
 */
export function LivingScene() {
  const night = useTwinStore((s) => s.night);
  const qualityTier = useTwinStore((s) => s.qualityTier);
  const reducedMotion = useTwinStore((s) => s.reducedMotion);
  const evidenceMode = useTwinStore((s) => s.evidenceMode);
  const animate = !reducedMotion;
  const profile = getQualityProfile(qualityTier);

  // Every prop in here is classified illustrative in the ledger: a procedural
  // aircraft that represents no sortie, a radar that asserts no coverage,
  // patrol vehicles that were never observed. They belong to the full
  // simulation and to nothing weaker, so the whole subtree unmounts below it
  // rather than each prop testing the mode for itself.
  if (evidenceMode !== "full-simulation") return null;

  return (
    <group name="living-scene">
      <CircuitAircraft animate={animate && profile.animateCircuit} />
      <RotatingRadar animate={animate} />
      <PatrolFleet
        night={night}
        animate={animate}
        vehicleCount={profile.patrolVehicleCount}
        realHeadlight={profile.patrolHeadlightLights}
      />
      <Windsock animate={animate} />
      <ObstructionBeacons night={night} animate={animate} />
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Resident demonstrator flying the runway circuit                     */
/* ------------------------------------------------------------------ */

const LOOP_SECONDS = 62;

function CircuitAircraft({ animate }: { animate: boolean }) {
  const curve = useMemo(createCircuitCurve, []);
  const select = useTwinStore((state) => state.select);

  const rootRef = useRef<THREE.Group>(null);
  const rollRef = useRef<THREE.Group>(null);
  const strobeRef = useRef<THREE.MeshStandardMaterial>(null);
  const bank = useRef(0);
  const pos = useMemo(() => new THREE.Vector3(), []);
  const tan = useMemo(() => new THREE.Vector3(), []);
  const tanAhead = useMemo(() => new THREE.Vector3(), []);
  const lookTarget = useMemo(() => new THREE.Vector3(), []);

  useEffect(
    () => () => {
      sceneProjection.circuitAircraftActive = false;
    },
    [],
  );

  useFrame(({ clock }, delta) => {
    const root = rootRef.current;
    if (!root) return;
    const tt = animate ? (clock.elapsedTime / LOOP_SECONDS) % 1 : 0;
    curve.getPointAt(tt, pos);
    curve.getTangentAt(tt, tan);
    curve.getTangentAt((tt + 0.01) % 1, tanAhead);

    sceneProjection.circuitAircraftActive = true;
    sceneProjection.circuitAircraftPosition.copy(pos);
    sceneProjection.circuitAircraftHeadingRad = Math.atan2(-tan.x, -tan.z);

    root.position.copy(pos);
    lookTarget.copy(pos).add(tan);
    root.lookAt(lookTarget);
    root.rotateY(Math.PI); // Object3D.lookAt points +Z; the authored model nose is -Z.

    // bank into the turn, from the change in horizontal heading
    const cross = tan.x * tanAhead.z - tan.z * tanAhead.x;
    const bankTarget = THREE.MathUtils.clamp(-cross * 7, -0.7, 0.7);
    bank.current += (bankTarget - bank.current) * Math.min(1, delta * 2);
    if (rollRef.current) rollRef.current.rotation.z = bank.current;

    // double-pulse anti-collision strobe
    if (strobeRef.current) {
      const cyc = (tt * LOOP_SECONDS) % 1.1;
      const on = animate && (cyc < 0.06 || (cyc > 0.14 && cyc < 0.2));
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
    () =>
      new THREE.MeshStandardMaterial({
        color: "#3a3d42",
        roughness: 0.5,
        metalness: 0.35,
      }),
    [],
  );
  const canopy = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#16242f",
        roughness: 0.12,
        metalness: 0.85,
      }),
    [],
  );

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    select(CIRCUIT_AIRCRAFT_ID);
  };

  return (
    <group
      ref={rootRef}
      userData={{ entityId: CIRCUIT_AIRCRAFT_ID, sceneEntityId: CIRCUIT_AIRCRAFT_ID }}
      onClick={handleClick}
      onPointerOver={(event) => {
        event.stopPropagation();
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        document.body.style.cursor = "auto";
      }}
    >
      <group ref={rollRef}>
        <mesh geometry={wingGeo} material={body} position={[0, 0, 0]} castShadow />
        {/* dorsal fairing + canopy */}
        <mesh
          material={body}
          position={[0, 0.5, -1.5]}
          scale={[1.3, 0.6, 2.4]}
          castShadow
        >
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

function RotatingRadar({ animate }: { animate: boolean }) {
  const [x, z] = RADAR_POS;
  const y = terrainHeight(x, z);
  const dishRef = useRef<THREE.Group>(null);

  const metal = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#8b8d88",
        roughness: 0.5,
        metalness: 0.5,
      }),
    [],
  );
  const dish = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#d7d4c8",
        roughness: 0.6,
        metalness: 0.2,
        side: THREE.DoubleSide,
      }),
    [],
  );

  useFrame((_, delta) => {
    if (!animate) return;
    if (dishRef.current) dishRef.current.rotation.y += (delta * (Math.PI * 2)) / 6; // ~10 rpm
  });

  return (
    <group position={[x, y, z]} userData={{ entityId: RADAR_ENTITY_ID }}>
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
/* Deterministic perimeter patrol fleet                                */
/* ------------------------------------------------------------------ */

const MAX_PATROL_VEHICLES = 3;
const PATROL_SPEED_MPS = 12;
const PATROL_LOOK_AHEAD_M = 6;
const PATROL_SEED_OFFSET = 0x50415452;

interface PatrolProfile {
  phaseM: number;
  direction: -1 | 1;
  speedMultiplier: number;
  scale: number;
}

interface PatrolFleetProps {
  night: boolean;
  animate: boolean;
  vehicleCount: number;
  realHeadlight: boolean;
}

function PatrolFleet({ night, animate, vehicleCount, realHeadlight }: PatrolFleetProps) {
  const groupRefs = useRef<Array<THREE.Group | null>>([]);
  const headings = useMemo(() => new Float64Array(MAX_PATROL_VEHICLES), []);
  const headingReady = useMemo(() => new Uint8Array(MAX_PATROL_VEHICLES), []);

  const { points, segmentLengths, cumulative, total, profiles } = useMemo(() => {
    const routePoints = PERIMETER_PATROL_ROUTE.map(([x, z]) => new THREE.Vector2(x, z));
    const lengths = new Float64Array(routePoints.length - 1);
    const cumulativeLengths = new Float64Array(routePoints.length);
    let totalLength = 0;
    for (let index = 0; index < lengths.length; index += 1) {
      const start = routePoints[index]!;
      const end = routePoints[index + 1]!;
      const length = start.distanceTo(end);
      lengths[index] = length;
      totalLength += length;
      cumulativeLengths[index + 1] = totalLength;
    }

    const random = mulberry32(SITE_SEED + PATROL_SEED_OFFSET);
    const patrolProfiles: PatrolProfile[] = [];
    for (let index = 0; index < MAX_PATROL_VEHICLES; index += 1) {
      patrolProfiles.push({
        phaseM: random() * totalLength,
        direction: random() < 0.5 ? -1 : 1,
        speedMultiplier: 0.9 + random() * 0.2,
        scale: 0.94 + random() * 0.12,
      });
    }

    return {
      points: routePoints,
      segmentLengths: lengths,
      cumulative: cumulativeLengths,
      total: totalLength,
      profiles: patrolProfiles,
    };
  }, []);

  const body = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#5c5643",
        roughness: 0.8,
        metalness: 0.1,
      }),
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
  const bodyGeometry = useMemo(() => new THREE.BoxGeometry(1.9, 0.7, 4.4), []);
  const cabGeometry = useMemo(() => new THREE.BoxGeometry(1.8, 0.9, 1.8), []);
  const lampGeometry = useMemo(() => new THREE.BoxGeometry(0.35, 0.25, 0.1), []);
  const tyreGeometry = useMemo(
    () => new THREE.CylinderGeometry(0.35, 0.35, 0.25, 10),
    [],
  );

  useEffect(() => {
    lamp.emissiveIntensity = night ? 5 : 0;
  }, [lamp, night]);

  const at = useMemo(() => new THREE.Vector2(), []);
  const ahead = useMemo(() => new THREE.Vector2(), []);

  const sample = (distanceM: number, out: THREE.Vector2) => {
    const wrapped = ((distanceM % total) + total) % total;
    let segmentIndex = 0;
    while (
      segmentIndex < segmentLengths.length - 1 &&
      cumulative[segmentIndex + 1]! <= wrapped
    ) {
      segmentIndex += 1;
    }
    const start = points[segmentIndex]!;
    const end = points[segmentIndex + 1]!;
    const fraction =
      (wrapped - cumulative[segmentIndex]!) / segmentLengths[segmentIndex]!;
    out.lerpVectors(start, end, fraction);
  };

  useFrame(({ clock }, delta) => {
    const elapsedSeconds = animate ? clock.elapsedTime : 0;
    const count = Math.min(vehicleCount, profiles.length);
    for (let index = 0; index < count; index += 1) {
      const group = groupRefs.current[index];
      const profile = profiles[index];
      if (!group || !profile) continue;

      const distanceM =
        profile.phaseM +
        profile.direction * elapsedSeconds * PATROL_SPEED_MPS * profile.speedMultiplier;
      sample(distanceM, at);
      sample(distanceM + profile.direction * PATROL_LOOK_AHEAD_M, ahead);

      const targetHeading = Math.atan2(-(ahead.x - at.x), -(ahead.y - at.y));
      if (headingReady[index] === 0) {
        headings[index] = targetHeading;
        headingReady[index] = 1;
      } else {
        let deltaHeading = targetHeading - headings[index]!;
        deltaHeading = Math.atan2(Math.sin(deltaHeading), Math.cos(deltaHeading));
        headings[index] = headings[index]! + deltaHeading * Math.min(1, delta * 4);
      }

      group.position.set(at.x, terrainHeight(at.x, at.y) + 0.04, at.y);
      group.rotation.y = headings[index]!;
    }
  });

  return (
    <group name="perimeter-patrol-fleet">
      {profiles.map((profile, index) =>
        index < vehicleCount ? (
          <group
            key={`patrol-${index}`}
            ref={(node) => {
              groupRefs.current[index] = node;
              if (node === null) headingReady[index] = 0;
            }}
            scale={profile.scale}
            userData={{ entityId: PATROL_ENTITY_IDS[index] }}
          >
            <mesh
              geometry={bodyGeometry}
              material={body}
              position={[0, 0.35, 0.2]}
              castShadow
            />
            <mesh
              geometry={cabGeometry}
              material={cab}
              position={[0, 0.95, -0.9]}
              castShadow
            />
            {[-0.6, 0.6].map((x) => (
              <mesh
                key={x}
                geometry={lampGeometry}
                material={lamp}
                position={[x, 0.4, -2.05]}
              />
            ))}
            {[-1, 1].map((x) =>
              [-1.2, 1.3].map((z) => (
                <mesh
                  key={`${x}:${z}`}
                  geometry={tyreGeometry}
                  material={tyre}
                  position={[x * 0.95, 0.35, z]}
                  rotation={[0, 0, Math.PI / 2]}
                />
              )),
            )}
            {realHeadlight && index === 0 ? (
              <pointLight
                color="#ffe2b0"
                intensity={night ? 22 : 0}
                distance={24}
                decay={2}
                position={[0, 0.55, -2.25]}
                castShadow={false}
              />
            ) : null}
          </group>
        ) : null,
      )}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Windsock                                                            */
/* ------------------------------------------------------------------ */

function Windsock({ animate }: { animate: boolean }) {
  const [x, z] = WINDSOCK_POS;
  const y = terrainHeight(x, z);
  const sockRef = useRef<THREE.Group>(null);
  const environmentMonth = useTwinStore((state) => state.environmentMonth);
  const climate = getClimateMonth(environmentMonth);
  const windFrom = THREE.MathUtils.degToRad(climate.windDirectionDeg);
  const windStrength = THREE.MathUtils.clamp(climate.windSpeedMps / 7, 0, 1);

  const pole = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#9a9488",
        roughness: 0.6,
        metalness: 0.3,
      }),
    [],
  );
  const red = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#d64a2e",
        roughness: 0.85,
        side: THREE.DoubleSide,
      }),
    [],
  );
  const white = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#e7e2d5",
        roughness: 0.85,
        side: THREE.DoubleSide,
      }),
    [],
  );

  // five tapering open bands forming the cone, alternating red/white
  const bands = useMemo(() => {
    const out: { z: number; r0: number; r1: number; h: number; mat: THREE.Material }[] =
      [];
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
    const t = animate ? clock.elapsedTime : 0;
    // POWER supplies climatological wind-from direction; the sleeve points downwind.
    g.rotation.y = -windFrom + Math.sin(t * 0.5) * 0.08;
    g.rotation.x = -0.12 - windStrength * 0.34 + Math.sin(t * 1.3) * 0.06;
  });

  return (
    <group position={[x, y, z]} userData={{ entityId: WINDSOCK_ENTITY_ID }}>
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
          <mesh
            key={i}
            material={b.mat}
            position={[0, 0, b.z]}
            rotation={[Math.PI / 2, 0, 0]}
          >
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

function ObstructionBeacons({ night, animate }: { night: boolean; animate: boolean }) {
  const activeTimelineYear = useTwinStore((state) => state.activeTimelineYear);
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
          observedDate: sdef.observedDate,
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
      const p = animate ? Math.sin(t * 3 + (beacons[i]!.phase ?? 0)) : 1;
      const flash = Math.pow(Math.max(0, p), 8);
      mats[i]!.emissiveIntensity = base * (0.15 + flash * 5);
    }
  });

  return (
    <group>
      {beacons.map((b, i) => (
        <mesh
          key={b.id}
          position={b.pos}
          material={mats[i]}
          userData={{ entityId: b.id }}
          visible={isVisibleAtTimelineYear(b, activeTimelineYear)}
        >
          <sphereGeometry args={[0.5, 8, 8]} />
        </mesh>
      ))}
    </group>
  );
}
