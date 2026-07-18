import { useEffect, useRef } from "react";
import { useTwinStore } from "@/lib/store";
import { telemetry } from "@/lib/telemetry";
import { CINEMATIC_WAYPOINTS } from "@/lib/layout";

/**
 * Lower-third caption naming the site feature currently in frame during the
 * cinematic pass. The label is driven imperatively from the animation loop
 * (telemetry.cinematicLeg) — this component only re-renders when the camera
 * mode changes, never per frame.
 */
export function CinematicCaption() {
  const cinematic = useTwinStore((s) => s.cameraMode === "cinematic");
  const labelRef = useRef<HTMLSpanElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const shown = useRef(-1);

  useEffect(() => {
    if (!cinematic) return;
    let raf = 0;
    const loop = () => {
      const leg = telemetry.cinematicLeg;
      if (leg !== shown.current) {
        shown.current = leg;
        const wp = CINEMATIC_WAYPOINTS[leg];
        if (labelRef.current && wp) labelRef.current.textContent = wp.label;
        if (rootRef.current) rootRef.current.style.opacity = wp ? "1" : "0";
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [cinematic]);

  if (!cinematic) return null;

  return (
    <div
      ref={rootRef}
      className="pointer-events-none absolute bottom-24 left-1/2 -translate-x-1/2 opacity-0 transition-opacity duration-500"
    >
      <div className="hud-panel flex items-center gap-3 px-4 py-2">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive/70" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-destructive" />
        </span>
        <div className="font-mono">
          <div className="text-muted-foreground text-[9px] tracking-[0.3em] uppercase">
            Cinematic Pass
          </div>
          <span ref={labelRef} className="text-foreground text-sm" />
        </div>
      </div>
    </div>
  );
}
