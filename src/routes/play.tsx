import { useEffect } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { MoveLeft } from "lucide-react";
import { GameScene } from "@/game/GameScene";
import { GameHud } from "@/game/hud/GameHud";

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
  useEffect(() => {
    document.title =
      "Blacksite — illustrative simulation on the Lop Nur public-source model";
  }, []);

  return (
    <div className="relative h-full w-full cursor-none overflow-hidden bg-[#05070a] select-none">
      <GameScene />
      <GameHud />
      <div className="pointer-events-none absolute top-3 left-3 z-40 flex flex-col items-start gap-2">
        <p
          role="note"
          className="rounded border border-amber-300/40 bg-[#0b0e14]/80 px-2.5 py-1 font-mono text-[10px] tracking-[0.14em] text-amber-100 uppercase backdrop-blur-sm"
        >
          Illustrative simulation — not operational data
        </p>
        <Link
          to="/"
          className="pointer-events-auto inline-flex cursor-pointer items-center gap-1.5 rounded border border-white/15 bg-[#0b0e14]/80 px-2.5 py-1 font-mono text-[10px] tracking-[0.14em] text-slate-200 uppercase backdrop-blur-sm hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none"
        >
          <MoveLeft className="size-3" aria-hidden="true" />
          Return to the analytical twin
        </Link>
      </div>
    </div>
  );
}
