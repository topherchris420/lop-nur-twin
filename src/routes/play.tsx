import { createFileRoute } from "@tanstack/react-router";
import { GameScene } from "@/game/GameScene";
import { GameHud } from "@/game/hud/GameHud";

/**
 * `/play` — the first-person engagement simulator, running on the same
 * measured airfield reconstruction as the twin at `/`.
 */
export const Route = createFileRoute("/play")({
  component: Play,
});

function Play() {
  return (
    <div className="relative h-full w-full cursor-none select-none overflow-hidden bg-[#05070a]">
      <GameScene />
      <GameHud />
    </div>
  );
}
