import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import {
  createLiveTrafficMissionEntity,
  gpsTo3DCanvas,
  type Aircraft,
} from "@/lib/flightData";
import { useFlightData } from "@/lib/useFlightData";
import { useTwinStore } from "@/lib/store";

/**
 * Live ADS-B traffic layer. Polls ADSB.lol on a ~12 s cadence (see
 * `useFlightData`) and renders each aircraft as a cheap procedural jet at its
 * transformed grid position, oriented by its ground track. Military aircraft
 * beacon red, civilian traffic warm white. A callsign/altitude label appears
 * only for aircraft near the camera.
 *
 * Positions come in on a discrete cadence — no per-frame React state. The one
 * `useFrame` per aircraft only reads a ref (camera distance) and flips a label
 * boolean on threshold crossings, keeping the frame loop state-free per
 * AGENTS.md. Runs alongside the scripted demonstrator in `LivingScene`.
 */
export function LiveTraffic() {
  const aircraft = useFlightData();
  return (
    <group name="live-traffic">
      {aircraft.map((ac) => (
        <LiveAircraft key={ac.hex} aircraft={ac} />
      ))}
    </group>
  );
}

/* Distance (m) within which an aircraft shows its callsign/altitude label. */
const LABEL_RANGE_M = 4200;

/* Shared geometry — one dart-shaped jet reused across every instance. */
const MIL_COLOR = "#ff2f24";
const CIV_COLOR = "#f4e9c8";

function LiveAircraft({ aircraft }: { aircraft: Aircraft }) {
  const reducedMotion = useTwinStore((s) => s.reducedMotion);
  const missionEntity = useMemo(
    () => createLiveTrafficMissionEntity(aircraft),
    [aircraft],
  );

  const [x, y, z] = useMemo(
    () => gpsTo3DCanvas(aircraft.lat, aircraft.lon, aircraft.altFeet),
    [aircraft.lat, aircraft.lon, aircraft.altFeet],
  );
  // Ground track: 0 = north (−z), clockwise. Model nose is authored toward −z.
  const rotationY = -aircraft.track * (Math.PI / 180);
  const color = aircraft.military ? MIL_COLOR : CIV_COLOR;

  const bodyMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.45,
        metalness: 0.4,
      }),
    [color],
  );
  const groupRef = useRef<THREE.Group>(null);
  const beaconRef = useRef<THREE.MeshStandardMaterial>(null);
  const nearRef = useRef(false);
  const labelRef = useRef<HTMLDivElement>(null);
  const worldPos = useMemo(() => new THREE.Vector3(), []);

  useFrame(({ camera, clock }) => {
    const g = groupRef.current;
    if (!g) return;
    g.getWorldPosition(worldPos);
    const near = camera.position.distanceTo(worldPos) < LABEL_RANGE_M;
    // Mutate the already-mounted label only on a near/far threshold crossing.
    if (near !== nearRef.current) {
      nearRef.current = near;
      if (labelRef.current) labelRef.current.style.display = near ? "block" : "none";
    }
    // Slow anti-collision blink on the beacon (steady if reduced motion).
    if (beaconRef.current) {
      const pulse = reducedMotion
        ? 4
        : 2.5 + 3.5 * Math.pow(Math.max(0, Math.sin(clock.elapsedTime * 3)), 6);
      beaconRef.current.emissiveIntensity = pulse;
    }
  });

  const altLabel =
    aircraft.altFeet > 0
      ? `${Math.round(aircraft.altFeet).toLocaleString()} ft`
      : "ground";

  return (
    <group
      ref={groupRef}
      position={[x, y, z]}
      rotation={[0, rotationY, 0]}
      userData={{ entityId: missionEntity.id, missionEntity }}
    >
      {/* Fuselage — nose toward −z. */}
      <mesh material={bodyMat} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <coneGeometry args={[3.2, 26, 12]} />
      </mesh>
      {/* Swept delta wings. */}
      <mesh material={bodyMat} position={[0, 0, 2]} castShadow>
        <boxGeometry args={[34, 0.8, 8]} />
      </mesh>
      {/* Vertical tail. */}
      <mesh material={bodyMat} position={[0, 2.6, 10]} castShadow>
        <boxGeometry args={[0.8, 5, 5]} />
      </mesh>
      {/* Always-on beacon so distant traffic reads as a colored dot. */}
      <mesh position={[0, 0, -2]}>
        <sphereGeometry args={[1.6, 10, 10]} />
        <meshStandardMaterial
          ref={beaconRef}
          color={color}
          emissive={new THREE.Color(color)}
          emissiveIntensity={4}
        />
      </mesh>

      <Html
        position={[0, 14, 0]}
        center
        distanceFactor={900}
        zIndexRange={[20, 0]}
        style={{ pointerEvents: "none" }}
      >
        <div
          ref={labelRef}
          style={{
              display: "none",
              padding: "4px 8px",
              borderRadius: 6,
              whiteSpace: "nowrap",
              font: "600 13px/1.25 ui-monospace, monospace",
              color: "#f5f1e6",
              background: "rgba(20, 22, 26, 0.78)",
              border: `1px solid ${aircraft.military ? "#ff5b52" : "#c9bd97"}`,
              boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
              textAlign: "center",
          }}
        >
          <div>{aircraft.callsign}</div>
          <div style={{ opacity: 0.75, fontWeight: 400 }}>{altLabel}</div>
        </div>
      </Html>
    </group>
  );
}
