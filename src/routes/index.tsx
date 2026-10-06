import { AnomalyGate } from "@/components/AnomalyGate";
import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Scene } from "@/components/scene/Scene";
import { Hud } from "@/components/hud/Hud";
import { TopBar } from "@/components/hud/TopBar";
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
import { readSitePointParam } from "@/lib/params";
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
  validateSearch: (search: Record<string, unknown>): TwinSearch => {
    const raw = search["structure"];
    if (typeof raw !== "string") return {};
    const id = raw.trim();
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) return {};
    return STRUCTURES.some((structure) => structure.id === id) ? { structure: id } : {};
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

  return (
    <div className="relative h-full w-full select-none">
      <Scene />
      <TouchControls />
      <OrbitJoystick />
      <TimelineControl />
      <Hud />
      <TopBar />
      <Minimap />
      <Dossier />
      <SiteIndex />
      <ResearchPanel />
      <EvidenceLegend />
      <HelpOverlay />
      <CinematicCaption />
      <IntroOverlay />
    </div>
  );
}
