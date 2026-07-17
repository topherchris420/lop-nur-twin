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
  ["1", "Free-fly orbit camera"],
  ["2", "First-person walk (click to capture mouse)"],
  ["3", "Cinematic flythrough"],
  ["W A S D", "Walk (first-person) · Shift to sprint"],
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
            Click any structure to open its dossier. Click the minimap to fly there.
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
        </CardContent>
      </Card>
    </div>
  );
}
