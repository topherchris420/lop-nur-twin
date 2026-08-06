import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { Copy, Check, Ruler, Trash2, Undo2 } from "lucide-react";
import {
  APRONS,
  ROADS,
  RUNWAY_CENTER,
  RUNWAYS,
  STREETS,
  STRIPS,
  STRUCTURES,
  TAXIWAYS,
  SITE_SIZE,
  getStructure,
  isAircraft,
  type SegmentDef,
} from "@/lib/layout";
import {
  distanceM,
  formatBearingDeg,
  formatDistanceM,
  gridBearingDeg,
  gridEastingNorthing,
  measurementSummary,
  pathTotalM,
  snapWorldPoint,
  straightLineM,
  type MeasurePoint,
} from "@/lib/measure";
import { flyToPoint } from "@/lib/flyTo";
import { getUncertaintyForSubject } from "@/lib/evidence";
import { type EvidenceMode } from "@/lib/evidenceMode";
import { isSubjectDrawn } from "@/lib/sceneVisibility";
import { type UncertaintyLevel } from "@/lib/uncertainty";
import { useTwinStore } from "@/lib/store";
import { telemetry } from "@/lib/telemetry";
import { isCoarsePointer } from "@/lib/touchInput";
import { cn } from "@/lib/utils";

const SIZE = 240; // CSS pixels
const WORLD = SITE_SIZE; // meters covered edge to edge
const SCALE = SIZE / WORLD;
const DPR = 2;

/** A click within this many logical pixels of a modeled vertex snaps to it. */
const SNAP_LOGICAL_PX = 12;
const SNAP_DIST_M = SNAP_LOGICAL_PX / SCALE;
const MEASURE_COLOR = "#ff5ecb";

function toMap(x: number, z: number): [number, number] {
  return [(x + WORLD / 2) * SCALE, (z + WORLD / 2) * SCALE];
}

function fromMap(mx: number, my: number): [number, number] {
  return [mx / SCALE - WORLD / 2, my / SCALE - WORLD / 2];
}

const SEGMENT_STYLE: Record<SegmentDef["kind"], { color: string; minWidth: number }> = {
  runway: { color: "#d8d3c4", minWidth: 3 },
  strip: { color: "#95815c", minWidth: 2.5 },
  taxiway: { color: "#a09a8d", minWidth: 1.5 },
  street: { color: "#8f897c", minWidth: 1 },
  road: { color: "#7c6e51", minWidth: 1 },
};

/**
 * Dash pattern per identification level, in CSS pixels.
 *
 * At 240 px across 6.8 km the minimap is about 0.035 px per metre, so a ±40 m
 * envelope drawn to scale would be a pixel and a half — invisible, and worse,
 * misleadingly precise. Uncertainty is encoded here as *line texture* instead:
 * solid where identification is established, progressively broken where it is
 * not. The pattern is redundant with the shape and with the text in the dossier,
 * so nothing depends on a viewer resolving it.
 */
const IDENTIFICATION_DASH: Record<UncertaintyLevel, readonly number[]> = {
  known: [],
  probable: [4, 2],
  possible: [2, 2],
  unknown: [1, 3],
};

function buildStaticLayer(
  activeTimelineYear: number,
  evidenceMode: EvidenceMode,
  showUncertainty: boolean,
): HTMLCanvasElement {
  const isDrawn = (subject: { id: string; observedDate?: string }) =>
    isSubjectDrawn(subject, activeTimelineYear, evidenceMode);

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
  const gridLimit = Math.floor(WORLD / 2000) * 1000;
  for (let m = -gridLimit; m <= gridLimit; m += 1000) {
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
      if (!isDrawn(seg)) continue;
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
    if (!isDrawn(apron)) continue;
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
    if (!isDrawn(s)) continue;
    const [sx, sy] = toMap(s.position[0], s.position[1]);
    const identification = getUncertaintyForSubject(s.id)?.identification ?? "unknown";
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
    } else if (showUncertainty && identification !== "known") {
      // Outline rather than fill: a hollow, broken square reads as "modeled,
      // not established" at a glance and still reads in greyscale.
      ctx.strokeStyle = "#e8a33d";
      ctx.lineWidth = 1;
      ctx.setLineDash([...IDENTIFICATION_DASH[identification]]);
      ctx.strokeRect(sx - 2.5, sy - 2.5, 5, 5);
      ctx.setLineDash([]);
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

/** Small pill-backed label used for measurement leg distances. */
function drawPillLabel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
): void {
  ctx.font = "8px monospace";
  const width = ctx.measureText(text).width;
  ctx.fillStyle = "rgba(18,16,12,0.82)";
  ctx.fillRect(x - width / 2 - 2, y - 5.5, width + 4, 11);
  ctx.fillStyle = "#ffd7f0";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

function drawMeasurement(
  ctx: CanvasRenderingContext2D,
  points: readonly MeasurePoint[],
  measureMode: boolean,
  hover: { mx: number; my: number } | null,
  year: number,
): void {
  const mapped = points.map((point) => toMap(point.x, point.z));

  // connecting legs
  if (mapped.length >= 2) {
    ctx.strokeStyle = MEASURE_COLOR;
    ctx.lineWidth = 1.8;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    mapped.forEach(([mx, my], index) => {
      if (index === 0) ctx.moveTo(mx, my);
      else ctx.lineTo(mx, my);
    });
    ctx.stroke();
  }

  // live preview from the last point to the (snapped) cursor
  if (measureMode && hover) {
    const [wx, wz] = fromMap(hover.mx, hover.my);
    const snap = snapWorldPoint(wx, wz, SNAP_DIST_M, year);
    const [hx, hy] = toMap(snap ? snap.x : wx, snap ? snap.z : wz);
    const last = mapped[mapped.length - 1];
    if (last) {
      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = "rgba(255,94,203,0.6)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(last[0], last[1]);
      ctx.lineTo(hx, hy);
      ctx.stroke();
      ctx.restore();
    }
    if (snap) {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(hx, hy, 5, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = snap ? "#ffffff" : "rgba(255,94,203,0.9)";
    ctx.beginPath();
    ctx.arc(hx, hy, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

  // per-leg distance labels at each leg midpoint
  for (let index = 1; index < points.length; index += 1) {
    const from = mapped[index - 1]!;
    const to = mapped[index]!;
    drawPillLabel(
      ctx,
      (from[0] + to[0]) / 2,
      (from[1] + to[1]) / 2,
      formatDistanceM(distanceM(points[index - 1]!, points[index]!)),
    );
  }

  // vertices (snapped nodes get a white ring)
  points.forEach((point, index) => {
    const [mx, my] = mapped[index]!;
    if (point.snappedTo) {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(mx, my, 4.5, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = MEASURE_COLOR;
    ctx.beginPath();
    ctx.arc(mx, my, 2.6, 0, Math.PI * 2);
    ctx.fill();
  });
}

export function Minimap() {
  // On phones the minimap sits exactly where the movement thumb-stick lives, so
  // hide it in first-person mode on touch devices to free the bottom-left.
  const cameraMode = useTwinStore((s) => s.cameraMode);
  const activeTimelineYear = useTwinStore((s) => s.activeTimelineYear);
  const evidenceMode = useTwinStore((s) => s.evidenceMode);
  const showUncertainty = useTwinStore((s) => s.showUncertainty);
  const measureMode = useTwinStore((s) => s.measureMode);
  const toggleMeasureMode = useTwinStore((s) => s.toggleMeasureMode);
  const hasMeasurePoints = useTwinStore((s) => s.measurePoints.length > 0);
  const hidden = useMemo(isCoarsePointer, []) && cameraMode === "fps";
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hoverRef = useRef<{ mx: number; my: number } | null>(null);
  const staticLayer = useMemo(
    () => buildStaticLayer(activeTimelineYear, evidenceMode, showUncertainty),
    [activeTimelineYear, evidenceMode, showUncertainty],
  );

  useEffect(() => {
    if (hidden) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    let raf = 0;
    let lastPaint = 0;
    const loop = (now: number) => {
      if (now - lastPaint < 50) {
        raf = requestAnimationFrame(loop);
        return;
      }
      lastPaint = now;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(staticLayer, 0, 0);
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

      const state = useTwinStore.getState();

      // selected structure highlight
      const def = state.selectedId ? getStructure(state.selectedId) : undefined;
      if (def && isSubjectDrawn(def, activeTimelineYear, evidenceMode)) {
        const [sx, sy] = toMap(def.position[0], def.position[1]);
        ctx.strokeStyle = "#ffb64d";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(sx, sy, 6, 0, Math.PI * 2);
        ctx.stroke();
      }

      drawMeasurement(
        ctx,
        state.measurePoints,
        state.measureMode,
        state.measureMode ? hoverRef.current : null,
        activeTimelineYear,
      );

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
  }, [staticLayer, hidden, activeTimelineYear, evidenceMode]);

  const pointToWorld = (
    event: ReactMouseEvent<HTMLCanvasElement> | ReactPointerEvent<HTMLCanvasElement>,
  ): [number, number] => {
    const rect = event.currentTarget.getBoundingClientRect();
    const mx = ((event.clientX - rect.left) / rect.width) * SIZE;
    const my = ((event.clientY - rect.top) / rect.height) * SIZE;
    return [mx, my];
  };

  const addPoint = (wx: number, wz: number) => {
    // Snapping follows the same filter as the drawing: a measurement must not
    // lock onto a vertex the active mode is withholding from the map.
    const snap = snapWorldPoint(wx, wz, SNAP_DIST_M, activeTimelineYear, evidenceMode);
    useTwinStore
      .getState()
      .addMeasurePoint(
        snap
          ? { x: snap.x, z: snap.z, snappedTo: snap.label }
          : { x: wx, z: wz, snappedTo: null },
      );
  };

  const handleClick = (event: ReactMouseEvent<HTMLCanvasElement>) => {
    const [mx, my] = pointToWorld(event);
    const [wx, wz] = fromMap(mx, my);
    if (measureMode) addPoint(wx, wz);
    else flyToPoint(wx, wz);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLCanvasElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    if (measureMode) addPoint(RUNWAY_CENTER[0], RUNWAY_CENTER[1]);
    else flyToPoint(RUNWAY_CENTER[0], RUNWAY_CENTER[1]);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!measureMode) return;
    const [mx, my] = pointToWorld(event);
    hoverRef.current = { mx, my };
  };

  const handlePointerLeave = () => {
    hoverRef.current = null;
  };

  if (hidden) return null;

  return (
    <div className="minimap-panel hud-panel absolute bottom-4 left-4 max-w-[calc(100vw-2rem)] p-1.5">
      <div className="mb-1 flex items-center justify-between gap-2 pl-1">
        <span className="text-muted-foreground font-mono text-[10px] tracking-[0.18em]">
          {measureMode ? "MEASURE" : "SITE MAP"}
        </span>
        <button
          type="button"
          onClick={toggleMeasureMode}
          aria-pressed={measureMode}
          title="Measure distances and bearings (M)"
          className={cn(
            "inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] tracking-wide transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary",
            measureMode
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
          )}
        >
          <Ruler className="size-3" />
          Measure
        </button>
      </div>
      <canvas
        ref={canvasRef}
        width={SIZE * DPR}
        height={SIZE * DPR}
        style={{ height: "auto" }}
        className="minimap-canvas cursor-crosshair rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        tabIndex={0}
        role="button"
        aria-label={
          measureMode
            ? "Measurement mode: click the map to drop distance points; clicks near a modeled feature snap to it."
            : "Interactive airfield map. Click a location to move the orbit camera; press Enter for the runway center."
        }
        title={
          measureMode
            ? "Click to add a measurement point"
            : "Click to fly the orbit camera"
        }
      />
      {(measureMode || hasMeasurePoints) && <MeasureReadout />}
    </div>
  );
}

function MeasureReadout() {
  const points = useTwinStore((s) => s.measurePoints);
  const undo = useTwinStore((s) => s.undoMeasurePoint);
  const clear = useTwinStore((s) => s.clearMeasure);
  const [copied, setCopied] = useState(false);

  const stats = useMemo(() => {
    if (points.length === 0) return null;
    const last = points[points.length - 1]!;
    const grid = gridEastingNorthing(last.x, last.z);
    const total = pathTotalM(points);
    const straight = straightLineM(points);
    const bearing =
      points.length >= 2 ? gridBearingDeg(points[points.length - 2]!, last) : null;
    return { grid, total, straight, bearing, last };
  }, [points]);

  const copy = () => {
    const clipboard = navigator.clipboard;
    if (!clipboard) return;
    void clipboard
      .writeText(measurementSummary(points))
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        /* clipboard unavailable — silently ignore */
      });
  };

  return (
    <div className="border-border/70 mt-1.5 border-t pt-1.5 font-mono text-[10px]">
      {stats ? (
        <div className="space-y-0.5">
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground">TOTAL</span>
            <span className="text-foreground tabular-nums">
              {formatDistanceM(stats.total)}
            </span>
          </div>
          {points.length >= 2 && (
            <>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">STRAIGHT</span>
                <span className="text-foreground tabular-nums">
                  {formatDistanceM(stats.straight)}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">LAST BRG</span>
                <span className="text-foreground tabular-nums">
                  {stats.bearing !== null ? formatBearingDeg(stats.bearing) : "—"}
                </span>
              </div>
            </>
          )}
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground">P{points.length}</span>
            <span className="text-foreground tabular-nums">
              {stats.grid.easting.toFixed(0)}E {stats.grid.northing.toFixed(0)}N
            </span>
          </div>
          {stats.last.snappedTo && (
            <div className="text-primary truncate" title={stats.last.snappedTo}>
              ↳ {stats.last.snappedTo}
            </div>
          )}
        </div>
      ) : (
        <p className="text-muted-foreground leading-snug">
          Click the map to drop points. Clicks near the runway, strips or compound snap to
          the modeled vertex.
        </p>
      )}
      <div className="mt-1.5 flex items-center gap-1">
        <ReadoutButton
          onClick={undo}
          disabled={points.length === 0}
          label="Undo last point"
        >
          <Undo2 className="size-3" />
          Undo
        </ReadoutButton>
        <ReadoutButton
          onClick={clear}
          disabled={points.length === 0}
          label="Clear measurement"
        >
          <Trash2 className="size-3" />
          Clear
        </ReadoutButton>
        <ReadoutButton
          onClick={copy}
          disabled={points.length === 0}
          label="Copy measurement summary"
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? "Copied" : "Copy"}
        </ReadoutButton>
      </div>
    </div>
  );
}

function ReadoutButton({
  onClick,
  disabled,
  label,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground inline-flex flex-1 items-center justify-center gap-1 rounded border px-1 py-1 font-mono text-[10px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
    >
      {children}
    </button>
  );
}
