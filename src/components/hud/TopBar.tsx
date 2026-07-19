import {
  BookOpen,
  Clapperboard,
  CircleHelp,
  ListTree,
  Moon,
  Orbit,
  PersonStanding,
  Sun,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useTwinStore, type CameraMode } from "@/lib/store";
import { isCoarsePointer } from "@/lib/touchInput";
import { cn } from "@/lib/utils";

const MODES: Array<{ mode: CameraMode; icon: typeof Orbit; label: string }> = [
  { mode: "orbit", icon: Orbit, label: "Free-fly orbit (1)" },
  { mode: "fps", icon: PersonStanding, label: "First person (2)" },
  { mode: "cinematic", icon: Clapperboard, label: "Cinematic (3)" },
];

export function TopBar() {
  const cameraMode = useTwinStore((s) => s.cameraMode);
  const setCameraMode = useTwinStore((s) => s.setCameraMode);
  const night = useTwinStore((s) => s.night);
  const toggleNight = useTwinStore((s) => s.toggleNight);
  const showIndex = useTwinStore((s) => s.showIndex);
  const toggleIndex = useTwinStore((s) => s.toggleIndex);
  const showResearch = useTwinStore((s) => s.showResearch);
  const toggleResearch = useTwinStore((s) => s.toggleResearch);
  const showHelp = useTwinStore((s) => s.showHelp);
  const toggleHelp = useTwinStore((s) => s.toggleHelp);

  return (
    <>
      <div className="site-title pointer-events-none absolute top-4 left-1/2 -translate-x-1/2 text-center">
        <div className="text-foreground/90 font-mono text-xs tracking-[0.35em] uppercase">
          Lop Nur
        </div>
        <div className="text-muted-foreground text-[10px] tracking-[0.25em] uppercase">
          Test Airfield · Xinjiang · Digital Twin
        </div>
      </div>
      <div className="topbar-controls hud-panel absolute top-4 right-4 z-10 flex items-center gap-1 p-1.5">
        {MODES.map(({ mode, icon: Icon, label }) => (
          <Button
            key={mode}
            variant={cameraMode === mode ? "default" : "ghost"}
            size="icon"
            title={label}
            aria-label={label}
            aria-pressed={cameraMode === mode}
            onClick={() => setCameraMode(mode)}
          >
            <Icon />
          </Button>
        ))}
        <div className="bg-border mx-1 h-5 w-px" />
        <Button
          variant="ghost"
          size="icon"
          title="Toggle day / night (N)"
          aria-label="Toggle day / night"
          aria-pressed={night}
          onClick={toggleNight}
        >
          {night ? <Sun /> : <Moon />}
        </Button>
        <Button
          variant={showIndex ? "default" : "ghost"}
          size="icon"
          title="Site index (I)"
          aria-label="Site index"
          aria-expanded={showIndex}
          aria-controls="site-index"
          onClick={toggleIndex}
        >
          <ListTree />
        </Button>
        <Button
          variant={showResearch ? "default" : "ghost"}
          size="icon"
          title="Research and public data (R)"
          aria-label="Research and public data"
          aria-expanded={showResearch}
          aria-controls="research-panel"
          onClick={toggleResearch}
        >
          <BookOpen />
        </Button>
        <Button
          variant={showHelp ? "default" : "ghost"}
          size="icon"
          title="Help (H)"
          aria-label="Help"
          aria-expanded={showHelp}
          aria-controls="help-dialog"
          onClick={toggleHelp}
        >
          <CircleHelp />
        </Button>
      </div>
      <ModeHint />
    </>
  );
}

/** Center-screen hint for the pointer-lock and cinematic modes. */
function ModeHint() {
  const cameraMode = useTwinStore((s) => s.cameraMode);
  const pointerLocked = useTwinStore((s) => s.pointerLocked);
  const coarse = useMemo(isCoarsePointer, []);
  // the orbit touch hint is onboarding-only — show it briefly, then get out of
  // the way of the pan-stick it sits above (which self-labels "PAN").
  const [orbitHintDone, setOrbitHintDone] = useState(false);
  useEffect(() => {
    setOrbitHintDone(false);
    if (cameraMode !== "orbit" || !coarse) return;
    const t = window.setTimeout(() => setOrbitHintDone(true), 6000);
    return () => window.clearTimeout(t);
  }, [cameraMode, coarse]);

  let hint: string | null = null;
  if (cameraMode === "orbit" && coarse) {
    if (orbitHintDone) return null;
    hint = "One finger to rotate · pinch to zoom";
  } else if (cameraMode === "fps" && coarse) {
    hint = "Left stick to walk · drag the right side to look · full push to sprint";
  } else if (cameraMode === "fps" && !pointerLocked) {
    hint = "Click to capture the mouse · WASD to walk · Shift to sprint · Esc to release";
  } else if (cameraMode === "cinematic") {
    hint = "Cinematic pass — press 1 or 2 to take over";
  }
  if (!hint) return null;

  return (
    <div
      className={cn(
        "pointer-events-none absolute bottom-10 left-1/2 -translate-x-1/2",
        "hud-panel px-4 py-2 font-mono text-xs",
      )}
    >
      {hint}
    </div>
  );
}
