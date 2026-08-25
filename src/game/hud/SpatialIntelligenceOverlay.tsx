import { useEffect, useRef } from "react";
import * as THREE from "three";
import { spatialIntel } from "../core/spatialIntelligence";
import { game } from "../core/gameState";

/**
 * Screen-space 3D Tactical Target Brackets & Intelligence AR Overlay.
 *
 * Projects world-space positions of entities onto screen space and renders:
 *  - Target brackets / bounding boxes
 *  - Entity IDs, classifications & detection states (detected, identified, tracked, lost)
 *  - Distance, bearing, elevation & velocity readouts
 *  - Threat level badges
 *  - Selected/locked target reticle with telemetry panel
 */

const scratchVec3 = new THREE.Vector3();

export function SpatialIntelligenceOverlay() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let handle: number;

    function render() {
      handle = requestAnimationFrame(render);
      if (!canvas) return;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;

      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const camera = game.cameraPosition;
      const forward = game.cameraForward;
      const right = game.cameraRight;
      const up = game.cameraUp;
      const fov = game.cameraFov;

      // Create matrix for projection
      const aspect = w / Math.max(1, h);
      const projCam = new THREE.PerspectiveCamera(fov, aspect, 0.1, 5000);
      projCam.position.copy(camera);
      projCam.quaternion.setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(right, up, forward.clone().negate()),
      );
      projCam.updateMatrixWorld();
      projCam.updateProjectionMatrix();

      // Render Active Sensor Mode HUD Watermark
      if (spatialIntel.sensorMode !== "normal") {
        ctx.font = "800 12px ui-monospace, monospace";
        ctx.fillStyle =
          spatialIntel.sensorMode === "flir"
            ? "#ffb648"
            : spatialIntel.sensorMode === "nvg"
              ? "#4dff88"
              : "#4df0ff";
        ctx.fillText(
          `SENSOR MODE // ${spatialIntel.sensorMode.toUpperCase()}`,
          36,
          h - 90,
        );
      }

      // Render World-Space Target Intelligence Brackets
      for (const entity of spatialIntel.entities.values()) {
        if (entity.type === "structure") continue; // Keep HUD uncluttered from static buildings

        const isPlayer = entity.actorId === game.player.id;
        if (isPlayer) continue;

        if (entity.detectionState === "lost" || entity.detectionConfidence < 0.1)
          continue;

        // Project position to screen space
        scratchVec3.copy(entity.position);
        scratchVec3.y += 1.0; // Chest height
        scratchVec3.project(projCam);

        // Check if behind camera
        if (scratchVec3.z > 1.0) continue;

        const screenX = (scratchVec3.x * 0.5 + 0.5) * w;
        const screenY = (-scratchVec3.y * 0.5 + 0.5) * h;

        // Ensure target is on screen bounds
        if (screenX < 20 || screenX > w - 20 || screenY < 20 || screenY > h - 20)
          continue;

        const isTeammate = entity.team === game.player.team;
        const isLocked = entity.isLockedTarget;

        const color = isTeammate
          ? "#4da3ff"
          : isLocked
            ? "#ffd700"
            : entity.detectionState === "tracked"
              ? "#ff5a4d"
              : "#ffb648";

        const size = Math.max(
          16,
          Math.min(48, (120 / Math.max(10, entity.distance)) * 32),
        );

        ctx.save();
        ctx.translate(screenX, screenY);

        // Bracket corners
        ctx.strokeStyle = color;
        ctx.lineWidth = isLocked ? 2.2 : 1.4;

        const half = size / 2;
        const arm = size * 0.3;

        // Top-Left
        ctx.beginPath();
        ctx.moveTo(-half, -half + arm);
        ctx.lineTo(-half, -half);
        ctx.lineTo(-half + arm, -half);
        ctx.stroke();

        // Top-Right
        ctx.beginPath();
        ctx.moveTo(half - arm, -half);
        ctx.lineTo(half, -half);
        ctx.lineTo(half, -half + arm);
        ctx.stroke();

        // Bottom-Left
        ctx.beginPath();
        ctx.moveTo(-half, half - arm);
        ctx.lineTo(-half, half);
        ctx.lineTo(-half + arm, half);
        ctx.stroke();

        // Bottom-Right
        ctx.beginPath();
        ctx.moveTo(half - arm, half);
        ctx.lineTo(half, half);
        ctx.lineTo(half, half - arm);
        ctx.stroke();

        // Center dot
        ctx.fillStyle = color;
        ctx.fillRect(-1.5, -1.5, 3, 3);

        // Label Readout
        ctx.font = "700 9px ui-monospace, monospace";
        ctx.fillStyle = color;
        ctx.fillText(`[${entity.name.toUpperCase()}]`, half + 6, -half + 8);
        ctx.font = "600 8px ui-monospace, monospace";
        ctx.fillStyle = "rgba(226, 232, 240, 0.85)";
        ctx.fillText(
          `${Math.round(entity.distance)}M | ${entity.detectionState.toUpperCase()}`,
          half + 6,
          -half + 20,
        );

        if (isLocked) {
          ctx.fillStyle = "#ffd700";
          ctx.fillText(
            `LOCKED TARGET // THREAT: ${entity.threatLevel.toUpperCase()}`,
            half + 6,
            -half + 32,
          );
        }

        ctx.restore();
      }
    }

    handle = requestAnimationFrame(render);
    return () => cancelAnimationFrame(handle);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 z-30 h-full w-full"
      aria-hidden
    />
  );
}
