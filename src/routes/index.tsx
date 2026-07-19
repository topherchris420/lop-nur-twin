import { createFileRoute } from "@tanstack/react-router";
import { Scene } from "@/components/scene/Scene";
import { Hud } from "@/components/hud/Hud";
import { TopBar } from "@/components/hud/TopBar";
import { Minimap } from "@/components/hud/Minimap";
import { Dossier } from "@/components/hud/Dossier";
import { SiteIndex } from "@/components/hud/SiteIndex";
import { ResearchPanel } from "@/components/hud/ResearchPanel";
import { HelpOverlay } from "@/components/hud/HelpOverlay";
import { CinematicCaption } from "@/components/hud/CinematicCaption";
import { IntroOverlay } from "@/components/hud/IntroOverlay";
import { TouchControls } from "@/components/hud/TouchControls";
import { OrbitJoystick } from "@/components/hud/OrbitJoystick";
import { useKeyboardShortcuts } from "@/lib/useKeyboardShortcuts";

export const Route = createFileRoute("/")({
  component: App,
});

function App() {
  useKeyboardShortcuts();
  return (
    <div className="relative h-full w-full select-none">
      <Scene />
      <TouchControls />
      <OrbitJoystick />
      <Hud />
      <TopBar />
      <Minimap />
      <Dossier />
      <SiteIndex />
      <ResearchPanel />
      <HelpOverlay />
      <CinematicCaption />
      <IntroOverlay />
    </div>
  );
}
