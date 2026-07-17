import { useEffect, useRef, type ReactNode } from "react";
import { useTwinStore } from "@/lib/store";
import { telemetry } from "@/lib/telemetry";
import { GRID_EASTING_ORIGIN, GRID_NORTHING_ORIGIN } from "@/lib/layout";

const CARDINALS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

const MODE_LABELS = {
  orbit: "1 · FREE-FLY ORBIT",
  fps: "2 · FIRST PERSON",
  cinematic: "3 · CINEMATIC PASS",
} as const;

const TIER_LABELS = ["MIN", "LOW", "MED", "FULL"] as const;

/**
 * Live telemetry readout. Values are poked straight into DOM nodes from a
 * requestAnimationFrame loop — this component itself only re-renders when
 * the camera mode or quality tier changes (see the render counter it shows).
 */
export function Hud() {
  const mode = useTwinStore((s) => s.cameraMode);
  const tier = useTwinStore((s) => s.qualityTier);

  const eastRef = useRef<HTMLSpanElement>(null);
  const northRef = useRef<HTMLSpanElement>(null);
  const altRef = useRef<HTMLSpanElement>(null);
  const hdgRef = useRef<HTMLSpanElement>(null);
  const fpsRef = useRef<HTMLSpanElement>(null);
  const renderCount = useRef(0);
  renderCount.current += 1;

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      if (eastRef.current) {
        eastRef.current.textContent = (GRID_EASTING_ORIGIN + telemetry.x)
          .toFixed(0)
          .padStart(6, "0");
      }
      if (northRef.current) {
        northRef.current.textContent = (GRID_NORTHING_ORIGIN - telemetry.z)
          .toFixed(0)
          .padStart(6, "0");
      }
      if (altRef.current) {
        altRef.current.textContent = `${telemetry.y.toFixed(0)} m`;
      }
      if (hdgRef.current) {
        const h = telemetry.heading;
        const cardinal = CARDINALS[Math.round(h / 45) % 8] ?? "N";
        hdgRef.current.textContent = `${h.toFixed(0).padStart(3, "0")}° ${cardinal}`;
      }
      if (fpsRef.current) {
        fpsRef.current.textContent = telemetry.fps.toFixed(0);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="hud-panel pointer-events-none absolute top-4 left-4 w-52 p-3 font-mono text-xs">
      <div className="text-muted-foreground mb-2 text-[10px] tracking-[0.2em]">
        SITE TELEMETRY
      </div>
      <Row label="EASTING" value={<span ref={eastRef}>—</span>} />
      <Row label="NORTHING" value={<span ref={northRef}>—</span>} />
      <Row label="ALTITUDE" value={<span ref={altRef}>—</span>} />
      <Row label="HEADING" value={<span ref={hdgRef}>—</span>} />
      <Row label="FPS" value={<span ref={fpsRef}>—</span>} />
      <div className="border-border text-muted-foreground mt-2 flex justify-between border-t pt-2 text-[10px]">
        <span>{MODE_LABELS[mode]}</span>
        <span>Q:{TIER_LABELS[tier]}</span>
      </div>
      <div className="text-muted-foreground/60 mt-1 text-right text-[9px]">
        panel renders: {renderCount.current}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between leading-5">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground tabular-nums">{value}</span>
    </div>
  );
}
