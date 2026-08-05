import { useEffect, useRef } from "react";
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
  ["R", "Toggle research and climate"],
  ["M", "Measure distances / bearings on the map"],
  ["H", "Toggle this help"],
  ["Esc", "Close panels / clear measurement / release mouse"],
];

export function HelpOverlay() {
  const showHelp = useTwinStore((s) => s.showHelp);
  const toggleHelp = useTwinStore((s) => s.toggleHelp);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const overlay = overlayRef.current;
    if (!showHelp || !overlay) return;

    const previousFocus = document.activeElement as HTMLElement | null;
    const background = [...(overlay.parentElement?.children ?? [])]
      .filter(
        (element): element is HTMLElement =>
          element instanceof HTMLElement && element !== overlay,
      )
      .map((element) => ({
        element,
        inert: element.inert,
        ariaHidden: element.getAttribute("aria-hidden"),
      }));

    for (const { element } of background) {
      element.inert = true;
      element.setAttribute("aria-hidden", "true");
    }

    const focusable = () =>
      [
        ...overlay.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((element) => !element.hasAttribute("disabled"));

    focusable()[0]?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        toggleHelp();
        return;
      }
      if (event.key !== "Tab") return;
      const elements = focusable();
      if (elements.length === 0) {
        event.preventDefault();
        overlay.focus();
        return;
      }
      const first = elements[0]!;
      const last = elements[elements.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    overlay.addEventListener("keydown", handleKeyDown);

    return () => {
      overlay.removeEventListener("keydown", handleKeyDown);
      for (const { element, inert, ariaHidden } of background) {
        element.inert = inert;
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
      }
      previousFocus?.focus();
    };
  }, [showHelp, toggleHelp]);

  if (!showHelp) return null;

  return (
    <div
      ref={overlayRef}
      id="help-dialog"
      tabIndex={-1}
      className="absolute inset-0 z-20 flex items-center justify-center bg-black/40 p-3"
      role="dialog"
      aria-modal="true"
      aria-labelledby="help-title"
    >
      <Card className="max-h-[calc(100vh-1.5rem)] w-[26rem] max-w-full overflow-y-auto">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle id="help-title">Controls</CardTitle>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Close help"
              onClick={toggleHelp}
            >
              <X />
            </Button>
          </div>
          <CardDescription>
            Click any structure to open its dossier. Click the minimap to fly there, or
            press <kbd className="kbd">M</kbd> to measure distances and grid bearings
            across the site — clicks snap to the runway, strips and compound. Watch for
            the demonstrator flying the runway pattern, the service vehicle, the turning
            radar-like prop and — after dark (<kbd className="kbd">N</kbd>) — the winking
            obstruction beacons.
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
            On touch devices, orbit mode adds a bottom-right pan joystick to glide across
            the site — one finger still rotates and a pinch zooms. First-person mode shows
            a left thumb-stick to walk and a right-side drag area to look — push the stick
            to its edge to sprint.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
