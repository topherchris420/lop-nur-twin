import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { GLOW_RADIUS, LAB_DOOR } from "./rain/site";

/**
 * An unmarked door on the rear wall of an unnamed building, where the R.A.I.N.
 * Lab is. Always there, flush and dark like any service door; within a short
 * walk a faint spectral-teal light and a small waveform show that it is not
 * quite like the others. No text, no map marker, no landmark entry.
 */
export function LabDoor() {
  const glow = useRef<THREE.Group>(null);
  const { camera } = useThree();
  const mark = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 32;
    const c = canvas.getContext("2d")!;
    c.fillStyle = "#061012";
    c.fillRect(0, 0, 128, 32);
    c.strokeStyle = "#3fb6b0";
    c.lineWidth = 2;
    c.beginPath();
    for (let x = 0; x <= 128; x += 2) {
      const y = 16 + Math.sin(x / 7) * 9 * Math.exp(-(((x - 64) / 40) ** 2));
      if (x) c.lineTo(x, y);
      else c.moveTo(x, y);
    }
    c.stroke();
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
  useEffect(() => () => mark.dispose(), [mark]);
  useFrame(() => {
    if (!glow.current || !LAB_DOOR) return;
    glow.current.visible =
      Math.hypot(
        camera.position.x - LAB_DOOR.point.x,
        camera.position.z - LAB_DOOR.point.z,
      ) < GLOW_RADIUS;
  });
  if (!LAB_DOOR) return null;
  const { point, facing, ground } = LAB_DOOR;
  // The slab sits in the wall plane, 0.9 m behind the door point.
  const wall = {
    x: point.x - Math.sin(facing) * 0.84,
    z: point.z - Math.cos(facing) * 0.84,
  };
  return (
    <group position={[wall.x, ground, wall.z]} rotation={[0, facing, 0]}>
      <mesh position={[0, 1.15, 0]} castShadow>
        <boxGeometry args={[1.15, 2.3, 0.12]} />
        <meshStandardMaterial color="#1a2022" roughness={0.55} metalness={0.3} />
      </mesh>
      <group ref={glow} visible={false}>
        <mesh position={[0, 2.42, 0.08]}>
          <boxGeometry args={[1.25, 0.035, 0.04]} />
          <meshStandardMaterial
            color="#0B5D63"
            emissive="#3fb6b0"
            emissiveIntensity={1.6}
          />
        </mesh>
        <mesh position={[0.95, 1.5, 0.07]}>
          <planeGeometry args={[0.36, 0.09]} />
          <meshBasicMaterial map={mark} toneMapped={false} />
        </mesh>
        <pointLight
          position={[0, 2.2, 0.7]}
          color="#3fb6b0"
          intensity={2.2}
          distance={7}
          decay={2}
        />
      </group>
    </group>
  );
}
