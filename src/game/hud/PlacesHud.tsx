import { useEffect, useRef } from "react";
import { game } from "../core/gameState";
import { pilot } from "../pilot/pilot";
import { forwardToYaw, yawDelta } from "../core/types";

/** The model's place vocabulary, available to the person without taking the controls. */
export function PlacesHud() {
  const root = useRef<HTMLElement>(null);
  const text = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const paint = (): void => {
      if (!root.current || !text.current) return;
      const notes = pilot.fieldNotes;
      const fresh = game.player.alive && game.time - notes.at <= 0.75;
      root.current.hidden = !fresh || notes.places.length === 0;
      if (!fresh) return;
      // Bearings follow the player's turn; safety facts remain those of the
      // last capture, and the entire note expires rather than inventing an update.
      text.current.textContent = notes.places
        .slice(0, 2)
        .map((p) => {
          const dx = p.x - game.player.position.x;
          const dz = p.z - game.player.position.z;
          const bearing = Math.round(
            (-yawDelta(game.player.yaw, forwardToYaw(dx, dz)) * 180) / Math.PI,
          );
          const side =
            Math.abs(bearing) < 8
              ? "ahead"
              : `${Math.abs(bearing)}° ${bearing < 0 ? "left" : "right"}`;
          return `${p.kind} · ${Math.round(Math.hypot(dx, dz))} m ${side} · ${Math.round(p.routeExposedM)} m exposed at capture`;
        })
        .join("\n");
    };
    paint();
    const timer = window.setInterval(paint, 120);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <aside
      ref={root}
      hidden
      data-place-notes=""
      aria-label="Places from the seat's perception"
      className="pointer-events-none absolute bottom-28 left-7 z-20 max-w-[calc(100vw-56px)] font-mono text-[10px] leading-relaxed text-stone-200/85 [text-shadow:0_1px_4px_black]"
    >
      <p className="mb-1 tracking-widest text-stone-400">
        FIELD NOTES · KNOWN THREATS ONLY
      </p>
      <p ref={text} className="whitespace-pre-line" />
    </aside>
  );
}
