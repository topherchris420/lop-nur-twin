import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useTwinStore } from "@/lib/store";

const SHORTCUTS: Array<[string, string]> = [
  ["1", "Free-fly orbit camera (mouse drag to rotate)"],
  ["2", "First-person walk (click to capture mouse)"],
  ["3", "Cinematic flythrough"],
  ["W A S D", "Walk (first-person mode) · Shift to sprint"],
  ["Arrow Keys", "Pan camera (orbit mode)"],
  ["Mouse Drag", "Rotate view (orbit mode)"],
  ["Scroll", "Zoom in/out"],
  ["N", "Toggle day / night"],
  ["I", "Toggle site index"],
  ["H", "Toggle this help"],
  ["Esc", "Close panels / release mouse"],
];

export function HelpOverlay() {
  const showHelp = useTwinStore((s) => s.showHelp);
  const toggleHelp = useTwinStore((s) => s.toggleHelp);
  if (!showHelp) return null;

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/40">
      <Card className="w-[26rem]">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Controls</CardTitle>
            <Button variant="ghost" size="icon" aria-label="Close help" onClick={toggleHelp}>
              <X />
            </Button>
          </div>
          <CardDescription>
            Click any structure to open its dossier. Click the minimap to fly
            there. Watch for the demonstrator flying the runway pattern, the
            patrol vehicle, the turning radar and — after dark (<kbd className="kbd">N</kbd>) —
            the winking obstruction beacons.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1.5">
            {SHORTCUTS.map(([key, desc]) => (
              <li key={key} className="flex items-center gap-3 text-xs">
                <span className="flex w-20 shrink-0 justify-end gap-1">
                  {key.split(" ").map((k) => (
                    <kbd key={k} className="kbd">
                      {k}
                    </kbd>
                  ))}
                </span>
                <span className="text-muted-foreground">{desc}</span>
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground mt-3 border-t border-border pt-3 text-xs">
            On touch devices, orbit mode adds a bottom-right pan joystick to
            glide across the site — one finger still rotates and a pinch zooms.
            First-person mode shows a left thumb-stick to walk and a right-side
            drag area to look — push the stick to its edge to sprint.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
