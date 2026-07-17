import {
  Clapperboard,
  CircleHelp,
  ListTree,
  Moon,
  Orbit,
  PersonStanding,
  Sun,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTwinStore, type CameraMode } from "@/lib/store";
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
  const toggleIndex = useTwinStore((s) => s.toggleIndex);
  const toggleHelp = useTwinStore((s) => s.toggleHelp);

  return (
    <>
      <div className="pointer-events-none absolute top-4 left-1/2 -translate-x-1/2 text-center">
        <div className="text-foreground/90 font-mono text-xs tracking-[0.35em] uppercase">
          Desert Airfield
        </div>
        <div className="text-muted-foreground text-[10px] tracking-[0.25em] uppercase">
          Digital Twin · procedural reconstruction
        </div>
      </div>
      <div className="hud-panel absolute top-4 right-4 flex items-center gap-1 p-1.5">
        {MODES.map(({ mode, icon: Icon, label }) => (
          <Button
            key={mode}
            variant={cameraMode === mode ? "default" : "ghost"}
            size="icon"
            title={label}
            aria-label={label}
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
          onClick={toggleNight}
        >
          {night ? <Sun /> : <Moon />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          title="Site index (I)"
          aria-label="Site index"
          onClick={toggleIndex}
        >
          <ListTree />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          title="Help (H)"
          aria-label="Help"
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

  let hint: string | null = null;
  if (cameraMode === "fps" && !pointerLocked) {
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
