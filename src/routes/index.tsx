import { AnomalyGate } from "@/components/AnomalyGate";
import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Scene } from "@/components/scene/Scene";
import { Hud } from "@/components/hud/Hud";
import { ModeHint, TopBar } from "@/components/hud/TopBar";
import { Minimap } from "@/components/hud/Minimap";
import { Dossier } from "@/components/hud/Dossier";
import { SiteIndex } from "@/components/hud/SiteIndex";
import { ResearchPanel } from "@/components/hud/ResearchPanel";
import { EvidenceLegend } from "@/components/hud/EvidenceLegend";
import { HelpOverlay } from "@/components/hud/HelpOverlay";
import { CinematicCaption } from "@/components/hud/CinematicCaption";
import { IntroOverlay } from "@/components/hud/IntroOverlay";
import { TouchControls } from "@/components/hud/TouchControls";
import { OrbitJoystick } from "@/components/hud/OrbitJoystick";
import { TimelineControl } from "@/components/hud/TimelineControl";
import { useKeyboardShortcuts } from "@/lib/useKeyboardShortcuts";
import { STRUCTURES, getStructure } from "@/lib/layout";
import { flyToPoint, flyToStructure } from "@/lib/flyTo";
import { parseIdValue, readSitePointParam } from "@/lib/params";
import { useTwinStore } from "@/lib/store";

interface TwinSearch {
  /** `?structure=<id>` opens that dossier — the deep link `/analysis` hands back. */
  structure?: string;
}

export const Route = createFileRoute("/")({
  component: App,
  // The parameter arrives from a link or from whatever a visitor types. Only a
  // well-formed id that names a structure this model actually contains is
  // allowed through; anything else is dropped, not coerced.
  // The key is always returned, `undefined` when rejected, because the router
  // keeps any raw key a validator leaves out.
  validateSearch: (search: Record<string, unknown>): TwinSearch => {
    const id = parseIdValue(search["structure"]);
    return {
      structure:
        id !== null && STRUCTURES.some((structure) => structure.id === id)
          ? id
          : undefined,
    };
  },
});

function App() {
  return (
    <AnomalyGate>
      <TwinView />
    </AnomalyGate>
  );
}

function TwinView() {
  useKeyboardShortcuts();
  const { structure } = Route.useSearch();
  const select = useTwinStore((state) => state.select);

  useEffect(() => {
    document.title = "Lop Nur Twin — public-source digital twin";
  }, []);

  // Handles both a cold load of `/?structure=…` and a client-side hand-off
  // from the analysis table, so one code path covers every way in.
  useEffect(() => {
    if (structure === undefined) return;
    const def = getStructure(structure);
    if (def === undefined) return;
    select(def.id);
    flyToStructure(def);
  }, [structure, select]);

  // `?at=<x>,<z>` is the camera target a shared bookmark link carries, in
  // local metres and clamped to the site. Read once, after `?structure=`, so a
  // link naming both opens the dossier and then frames the saved view — the
  // order an in-app bookmark applies them in.
  useEffect(() => {
    const at = readSitePointParam("at");
    if (at !== null) flyToPoint(at[0], at[1]);
  }, []);

  // Without a 3D view its fallback covers the page, pointing to the routes
  // that work without one; the HUD would only be controls hidden behind it.
  const sceneUnavailable = useTwinStore((state) => state.sceneUnavailable);

  return (
    <div className="relative h-full w-full select-none">
      <Scene />
      {!sceneUnavailable && (
        <>
          <TouchControls />
          <Hud />
          <TopBar />
          {/* One grid for everything along the bottom edge (see `.hud-dock`). */}
          <div className="hud-dock">
            <div className="hud-dock-map">
              <Minimap />
            </div>
            <div className="hud-dock-center">
              <CinematicCaption />
              <ModeHint />
              <TimelineControl />
            </div>
            <div className="hud-dock-side">
              <OrbitJoystick />
              <EvidenceLegend />
            </div>
          </div>
          <Dossier />
          <SiteIndex />
          <ResearchPanel />
          <HelpOverlay />
        </>
      )}
      <IntroOverlay />
    </div>
  );
}
