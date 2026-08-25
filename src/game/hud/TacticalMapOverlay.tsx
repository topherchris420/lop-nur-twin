import { useEffect, useRef } from "react";
import { spatialIntel } from "../core/spatialIntelligence";
import { game } from "../core/gameState";
import { RUNWAYS, TAXIWAYS, APRONS, STRUCTURES } from "@/lib/layout";

export function TacticalMapOverlay() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let handle: number;
    function render() {
      handle = requestAnimationFrame(render);
      if (!canvas || !spatialIntel.tacticalMapActive) return;

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

      const player = game.player;
      const mapCenter = player.position;

      // Full screen tactical map background
      ctx.fillStyle = "rgba(4, 7, 12, 0.94)";
      ctx.fillRect(0, 0, w, h);

      // Border and grid frame
      const cx = w / 2;
      const cy = h / 2;
      const scale = 0.35; // Pixels per meter

      const worldToMap = (wx: number, wz: number): [number, number] => {
        const dx = wx - mapCenter.x;
        const dz = wz - mapCenter.z;
        return [cx + dx * scale, cy + dz * scale];
      };

      // 1. Grid lines and EPSG:32645 coordinate labels
      ctx.strokeStyle = "rgba(77, 163, 255, 0.12)";
      ctx.lineWidth = 1;
      const gridSize = 100 * scale;
      for (let x = cx % gridSize; x < w; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = cy % gridSize; y < h; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      // 2. Airfield Runways & Pavements
      ctx.strokeStyle = "rgba(148, 163, 184, 0.35)";
      ctx.lineWidth = 14 * scale;
      for (const rwy of RUNWAYS) {
        const [x1, y1] = worldToMap(rwy.from[0], rwy.from[1]);
        const [x2, y2] = worldToMap(rwy.to[0], rwy.to[1]);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }

      ctx.lineWidth = 10 * scale;
      for (const twy of TAXIWAYS) {
        const [x1, y1] = worldToMap(twy.from[0], twy.from[1]);
        const [x2, y2] = worldToMap(twy.to[0], twy.to[1]);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }

      // Aprons
      ctx.fillStyle = "rgba(77, 163, 255, 0.08)";
      for (const apron of APRONS) {
        const [ax, ay] = worldToMap(apron.center[0], apron.center[1]);
        const aw = apron.size[0] * scale;
        const ah = apron.size[1] * scale;
        ctx.fillRect(ax - aw / 2, ay - ah / 2, aw, ah);
      }

      // 3. Structures
      ctx.fillStyle = "rgba(148, 163, 184, 0.28)";
      ctx.strokeStyle = "rgba(148, 163, 184, 0.6)";
      ctx.lineWidth = 1;
      for (const s of STRUCTURES) {
        const [sx, sy] = worldToMap(s.position[0], s.position[1]);
        const sw = Math.max(4, s.size[0] * scale);
        const sd = Math.max(4, s.size[2] * scale);

        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(s.rotation);
        ctx.fillRect(-sw / 2, -sd / 2, sw, sd);
        ctx.strokeRect(-sw / 2, -sd / 2, sw, sd);
        ctx.restore();
      }

      // 4. Intelligence Entities (Actors & Targets)
      for (const entity of spatialIntel.entities.values()) {
        if (entity.type === "structure") continue;

        const [ex, ey] = worldToMap(entity.position.x, entity.position.z);
        const isPlayer = entity.actorId === player.id;
        const isTeammate = entity.team === player.team;

        // Trajectory Trail
        if (entity.trajectory.length > 1) {
          ctx.strokeStyle = isTeammate
            ? "rgba(77, 163, 255, 0.4)"
            : "rgba(255, 90, 77, 0.4)";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          for (let i = 0; i < entity.trajectory.length; i++) {
            const pt = entity.trajectory[i]!;
            const [tx, ty] = worldToMap(pt.x, pt.z);
            if (i === 0) ctx.moveTo(tx, ty);
            else ctx.lineTo(tx, ty);
          }
          ctx.stroke();
        }

        // Entity Marker
        ctx.save();
        ctx.translate(ex, ey);

        if (isPlayer) {
          ctx.fillStyle = "#4df0ff";
          ctx.beginPath();
          ctx.arc(0, 0, 7, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 2;
          ctx.stroke();
        } else if (isTeammate) {
          ctx.fillStyle = "#4da3ff";
          ctx.beginPath();
          ctx.arc(0, 0, 5, 0, Math.PI * 2);
          ctx.fill();
        } else {
          // Hostile Entity
          const state = entity.detectionState;
          const color =
            state === "tracked"
              ? "#ff5a4d"
              : state === "identified"
                ? "#ffb648"
                : "rgba(255, 90, 77, 0.5)";

          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(0, 0, 5, 0, Math.PI * 2);
          ctx.fill();

          // Selection/Lock Bracket
          if (entity.isLockedTarget) {
            ctx.strokeStyle = "#ffd700";
            ctx.lineWidth = 2;
            ctx.strokeRect(-10, -10, 20, 20);
          }

          // Entity Label
          ctx.font = "700 10px ui-monospace, monospace";
          ctx.fillStyle = color;
          ctx.fillText(
            `[${entity.name.toUpperCase()}] ${Math.round(entity.distance)}M`,
            8,
            4,
          );
        }

        ctx.restore();
      }

      // HUD Overlay Frame Details
      ctx.font = "800 13px ui-monospace, monospace";
      ctx.fillStyle = "#4df0ff";
      ctx.fillText("TACTICAL MAP // SENSOR FUSION OPERATIONAL VIEW", 24, 36);

      ctx.font = "600 11px ui-monospace, monospace";
      ctx.fillStyle = "rgba(148, 163, 184, 0.8)";
      ctx.fillText(
        `GRID CENTER: ${Math.round(mapCenter.x)}E, ${Math.round(mapCenter.z)}N | ALT: ${Math.round(mapCenter.y)}M`,
        24,
        54,
      );
      ctx.fillText(
        `MODE: ${spatialIntel.sensorMode.toUpperCase()} | UAV: ${spatialIntel.uavActive ? "ACTIVE" : "STANDBY"}`,
        24,
        72,
      );

      ctx.textAlign = "right";
      ctx.fillText(
        "PRESS [M] CLOSE | [N] SENSOR | [U] UAV | [O] LOCK TARGET",
        w - 24,
        36,
      );
    }

    handle = requestAnimationFrame(render);
    return () => cancelAnimationFrame(handle);
  }, []);

  if (!spatialIntel.tacticalMapActive) return null;

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md">
      <canvas ref={canvasRef} className="h-full w-full cursor-crosshair" />
    </div>
  );
}
