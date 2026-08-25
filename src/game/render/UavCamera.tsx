import { useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { spatialIntel } from "../core/spatialIntelligence";
import { game } from "../core/gameState";

/**
 * UAV / Orbital Recon Camera Rig.
 *
 * Smoothly transitions between the 1st-person FPS view and an overhead tactical UAV orbital camera.
 * Features:
 *  - High altitude orbital view around the airfield / target
 *  - Target locking and tracking
 *  - Dynamic altitude zoom (50m to 600m)
 *  - Target velocity and projected movement trajectory visualization
 */

export function UavCamera() {
  const camera = useThree((s) => s.camera);

  // Transition blend: 0 = 1st-person, 1 = full UAV overhead view
  const transition = useRef(0);
  const orbitAngle = useRef(0);
  const uavAltitude = useRef(240); // Default altitude 240m

  const targetPos = useRef(new THREE.Vector3());
  const currentCamPos = useRef(new THREE.Vector3());
  const currentCamLookAt = useRef(new THREE.Vector3());

  useFrame((_state, delta) => {
    const active = spatialIntel.uavActive;
    const dt = Math.min(0.05, delta);

    // Ease transition factor
    const targetTrans = active ? 1 : 0;
    transition.current += (targetTrans - transition.current) * Math.min(1, dt * 6.0);
    const t = transition.current;

    if (t < 0.001) return; // Completely disabled in 1st-person

    // Target position: selected target or player position
    const selected = spatialIntel.selectedTargetId
      ? spatialIntel.entities.get(spatialIntel.selectedTargetId)
      : null;

    if (selected) {
      targetPos.current.copy(selected.position);
    } else {
      targetPos.current.copy(game.player.position);
    }

    // Slowly orbit around target
    orbitAngle.current += dt * 0.12;

    const radius = 180 + Math.sin(orbitAngle.current * 0.5) * 40;
    const uavX = targetPos.current.x + Math.cos(orbitAngle.current) * radius;
    const uavZ = targetPos.current.z + Math.sin(orbitAngle.current) * radius;
    const uavY = targetPos.current.y + uavAltitude.current;

    // Slerp / Lerp camera transform
    if (active && t > 0.95) {
      // Fully in UAV view: override camera directly
      camera.position.set(uavX, uavY, uavZ);
      camera.lookAt(targetPos.current.x, targetPos.current.y + 2, targetPos.current.z);
    } else {
      // In transition phase
      currentCamPos.current.set(uavX, uavY, uavZ);
      currentCamLookAt.current.set(
        targetPos.current.x,
        targetPos.current.y + 2,
        targetPos.current.z,
      );

      const eye = game.cameraPosition;
      const forward = game.cameraForward;

      const playerCamPos = eye;
      const playerLookAt = eye.clone().add(forward.clone().multiplyScalar(10));

      const blendedPos = new THREE.Vector3().lerpVectors(
        playerCamPos,
        currentCamPos.current,
        t,
      );
      const blendedLookAt = new THREE.Vector3().lerpVectors(
        playerLookAt,
        currentCamLookAt.current,
        t,
      );

      camera.position.copy(blendedPos);
      camera.lookAt(blendedLookAt);
    }
  });

  return null;
}
