import { useEffect, useMemo, useRef, type MouseEvent as ReactMouseEvent } from "react";
import {
  APRONS,
  ROADS,
  RUNWAYS,
  STREETS,
  STRIPS,
  STRUCTURES,
  TAXIWAYS,
  getStructure,
  isAircraft,
  type SegmentDef,
} from "@/lib/layout";
import { flyToPoint } from "@/lib/flyTo";
import { useTwinStore } from "@/lib/store";
import { telemetry } from "@/lib/telemetry";

const SIZE = 240; // CSS pixels
const WORLD = 4200; // meters covered edge to edge
const SCALE = SIZE / WORLD;
const DPR = 2;

function toMap(x: number, z: number): [number, number] {
  return [(x + WORLD / 2) * SCALE, (z + WORLD / 2) * SCALE];
}

const SEGMENT_STYLE: Record<SegmentDef["kind"], { color: string; minWidth: number }> = {
  runway: { color: "#d8d3c4", minWidth: 3 },
  strip: { color: "#95815c", minWidth: 2.5 },
  taxiway: { color: "#a09a8d", minWidth: 1.5 },
  street: { color: "#8f897c", minWidth: 1 },
  road: { color: "#7c6e51", minWidth: 1 },
};

function buildStaticLayer(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE * DPR;
  canvas.height = SIZE * DPR;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.scale(DPR, DPR);

  ctx.fillStyle = "#1b1813";
  ctx.fillRect(0, 0, SIZE, SIZE);
  // faint 1 km grid
  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  ctx.lineWidth = 1;
  for (let m = -2000; m <= 2000; m += 1000) {
    const [gx] = toMap(m, 0);
    const [, gz] = toMap(0, m);
    ctx.beginPath();
    ctx.moveTo(gx, 0);
    ctx.lineTo(gx, SIZE);
    ctx.moveTo(0, gz);
    ctx.lineTo(SIZE, gz);
    ctx.stroke();
  }

  const drawSegments = (segments: SegmentDef[]) => {
    for (const seg of segments) {
      const style = SEGMENT_STYLE[seg.kind];
      ctx.strokeStyle = style.color;
      ctx.lineWidth = Math.max(style.minWidth, seg.width * SCALE);
      ctx.lineCap = "round";
      const [x1, y1] = toMap(seg.from[0], seg.from[1]);
      const [x2, y2] = toMap(seg.to[0], seg.to[1]);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
  };
  drawSegments(ROADS);
  drawSegments(STRIPS);
  drawSegments(STREETS);
  drawSegments(TAXIWAYS);
  drawSegments(RUNWAYS);

  for (const apron of APRONS) {
    const [ax, ay] = toMap(apron.center[0], apron.center[1]);
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(apron.rotation);
    ctx.fillStyle = "#a8a294";
    ctx.fillRect(
      -(apron.size[0] * SCALE) / 2,
      -(apron.size[1] * SCALE) / 2,
      apron.size[0] * SCALE,
      apron.size[1] * SCALE,
    );
    ctx.restore();
  }

  for (const s of STRUCTURES) {
    const [sx, sy] = toMap(s.position[0], s.position[1]);
    if (isAircraft(s.type)) {
      // aircraft: cyan triangle pointing along its parked heading
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(-s.rotation);
      ctx.fillStyle = "#7ee0d0";
      ctx.beginPath();
      ctx.moveTo(0, -3.2);
      ctx.lineTo(2.3, 2.6);
      ctx.lineTo(-2.3, 2.6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    } else {
      ctx.fillStyle = "#e8a33d";
      ctx.fillRect(sx - 2, sy - 2, 4, 4);
    }
  }

  // north arrow (north is up: -z)
  ctx.strokeStyle = "#e8e4d8";
  ctx.fillStyle = "#e8e4d8";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(SIZE - 16, 26);
  ctx.lineTo(SIZE - 16, 10);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(SIZE - 16, 8);
  ctx.lineTo(SIZE - 20, 16);
  ctx.lineTo(SIZE - 12, 16);
  ctx.closePath();
  ctx.fill();
  ctx.font = "9px monospace";
  ctx.fillText("N", SIZE - 19, 36);

  // scale bar: 1 km with 100 m divisions
  const barY = SIZE - 12;
  const barX = 10;
  const kmPx = 1000 * SCALE;
  ctx.strokeStyle = "#e8e4d8";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(barX, barY);
  ctx.lineTo(barX + kmPx, barY);
  ctx.stroke();
  for (let i = 0; i <= 10; i++) {
    const x = barX + i * (kmPx / 10);
    ctx.beginPath();
    ctx.moveTo(x, barY);
    ctx.lineTo(x, barY - (i % 5 === 0 ? 5 : 3));
    ctx.stroke();
  }
  ctx.fillText("1 km · 100 m div", barX, barY - 8);

  return canvas;
}

export function Minimap() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const staticLayer = useMemo(buildStaticLayer, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    let raf = 0;
    const loop = () => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(staticLayer, 0, 0);
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

      // selected structure highlight
      const selectedId = useTwinStore.getState().selectedId;
      const def = selectedId ? getStructure(selectedId) : undefined;
      if (def) {
        const [sx, sy] = toMap(def.position[0], def.position[1]);
        ctx.strokeStyle = "#ffb64d";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(sx, sy, 6, 0, Math.PI * 2);
        ctx.stroke();
      }

      // camera marker with heading wedge
      const [cx, cy] = toMap(telemetry.x, telemetry.z);
      const heading = (telemetry.heading * Math.PI) / 180;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(heading);
      ctx.fillStyle = "rgba(120, 200, 255, 0.15)";
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, 26, -Math.PI / 2 - 0.45, -Math.PI / 2 + 0.45);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#7ec8ff";
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.lineTo(4.2, 5);
      ctx.lineTo(-4.2, 5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [staticLayer]);

  const handleClick = (e: ReactMouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * SIZE;
    const my = ((e.clientY - rect.top) / rect.height) * SIZE;
    const wx = mx / SCALE - WORLD / 2;
    const wz = my / SCALE - WORLD / 2;
    flyToPoint(wx, wz);
  };

  return (
    <div className="hud-panel absolute bottom-4 left-4 overflow-hidden p-1.5">
      <canvas
        ref={canvasRef}
        width={SIZE * DPR}
        height={SIZE * DPR}
        style={{ width: SIZE, height: SIZE }}
        className="cursor-crosshair rounded"
        onClick={handleClick}
        title="Click to fly the orbit camera"
      />
    </div>
  );
}
