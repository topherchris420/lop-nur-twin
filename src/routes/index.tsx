import { createFileRoute } from "@tanstack/react-router";
import { Leva } from "leva";
import { Scene } from "@/components/scene/Scene";
import { Hud } from "@/components/hud/Hud";
import { TopBar } from "@/components/hud/TopBar";
import { Minimap } from "@/components/hud/Minimap";
import { Dossier } from "@/components/hud/Dossier";
import { SiteIndex } from "@/components/hud/SiteIndex";
import { HelpOverlay } from "@/components/hud/HelpOverlay";
import { useKeyboardShortcuts } from "@/lib/useKeyboardShortcuts";

export const Route = createFileRoute("/")({
  component: App,
});

function App() {
  useKeyboardShortcuts();
  return (
    <div className="relative h-full w-full select-none">
      <Scene />
      <Hud />
      <TopBar />
      <Minimap />
      <Dossier />
      <SiteIndex />
      <HelpOverlay />
      {/* dev-only tweaks panel */}
      <Leva collapsed hidden={!import.meta.env.DEV} />
    </div>
  );
}
