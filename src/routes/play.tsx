import { useEffect, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { FileSearch, MoveLeft } from "lucide-react";
import { GameScene } from "@/game/GameScene";
import { GameHud } from "@/game/hud/GameHud";
import { useGameStore } from "@/game/core/gameStore";
import { cn } from "@/lib/utils";
import { canCreateWebGLContext } from "@/lib/webgl";

/**
 * `/play` — Blacksite, the first-person engagement simulator, running on the
 * same measured airfield reconstruction as the twin at `/`.
 *
 * The route carries a standing disclaimer and a way back to the analytical
 * view. Both are deliberately outside the game HUD: the HUD is a canvas that
 * disappears between screens, and the one thing that must never disappear is
 * the statement that none of this is operational data.
 */
export const Route = createFileRoute("/play")({
  component: Play,
});

function Play() {
  const screen = useGameStore((s) => s.screen);
  // The crosshair replaces the cursor for a human; a spectator watching a brain
  // keeps it, to reach TAKE CONTROL.
  const brain = useGameStore((s) => s.brain);
  const [webgl] = useState(canCreateWebGLContext);

  useEffect(() => {
    document.title =
      "Blacksite — illustrative simulation on the Lop Nur public-source model";
  }, []);

  return (
    <div
      className={cn(
        "relative h-full w-full overflow-hidden bg-[#05070a] select-none",
        brain === "human" ? "cursor-none" : "cursor-auto",
      )}
    >
      {webgl ? (
        <>
          <GameScene />
          <GameHud />
        </>
      ) : (
        <div
          role="alert"
          className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-slate-200"
        >
          <div className="max-w-md space-y-3 leading-relaxed">
            <p>
              This browser could not start WebGL, which Blacksite needs to run a match.
            </p>
            <p>
              Recorded runs do not:{" "}
              <Link to="/evaluation" className="underline">
                the evaluations
              </Link>{" "}
              hold every archived episode and its decisions, and the{" "}
              <Link to="/analysis" className="underline">
                analysis table
              </Link>{" "}
              holds the model the game is built on.
            </p>
          </div>
        </div>
      )}
      <div className="pointer-events-none absolute top-3 left-3 z-40 flex flex-col items-start gap-2">
        <p
          role="note"
          className="rounded border border-amber-300/40 bg-[#0b0e14]/80 px-2.5 py-1 font-mono text-[10px] tracking-[0.14em] text-amber-100 uppercase backdrop-blur-sm"
        >
          Illustrative simulation — not operational data
        </p>
        {(screen !== "boot" || !webgl) && (
          <Link
            to="/"
            className="pointer-events-auto inline-flex cursor-pointer items-center gap-1.5 rounded border border-white/15 bg-[#0b0e14]/80 px-2.5 py-1 font-mono text-[10px] tracking-[0.14em] text-slate-200 uppercase backdrop-blur-sm hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none"
          >
            <MoveLeft className="size-3" aria-hidden="true" />
            Return to the analytical twin
          </Link>
        )}
        {screen === "menu" && (
          <Link
            to="/evaluation"
            className="pointer-events-auto inline-flex cursor-pointer items-center gap-1.5 rounded border border-white/15 bg-[#0b0e14]/80 px-2.5 py-1 font-mono text-[10px] tracking-[0.14em] text-slate-200 uppercase backdrop-blur-sm hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none"
          >
            <FileSearch className="size-3" aria-hidden="true" />
            Evaluations of the seat
          </Link>
        )}
      </div>
    </div>
  );
}
