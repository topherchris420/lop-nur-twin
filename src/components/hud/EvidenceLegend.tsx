import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Table2 } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { EvidenceLegendList } from "@/components/evidence/EvidenceUi";
import { EvidenceModeControl } from "@/components/evidence/EvidenceModeControl";
import { PRIMARY_CRS, evidenceClassificationCounts } from "@/lib/evidence";
import { describeLens, lensTally } from "@/lib/evidenceLens";
import { EVIDENCE_MODE_META } from "@/lib/evidenceMode";
import { SITE_PROFILE } from "@/lib/siteData";
import { isCoarsePointer } from "@/lib/touchInput";
import { useTwinStore } from "@/lib/store";
import { cn } from "@/lib/utils";

/**
 * The standing evidence legend.
 *
 * A reviewer who opens the twin and clicks one building sees a status badge
 * with no key to read it against. This panel is that key, and it stays on
 * screen: what "observed" means here, what the model considers illustrative,
 * which coordinate system the numbers are in, and the standing statement that
 * none of it is operational data.
 *
 * It starts folded to its header, because opened it is a panel the height of a
 * laptop screen sitting on the thing it describes. The header is the part that must
 * stay: it keeps the heading, the evidence mode in force and the statement that none
 * of this is operational data on screen, one click from the rest, and on a phone the
 * heading and the record count. The full legend also lives in the research panel and
 * on `/analysis`, so the information is never only in one place.
 *
 * It opens by itself when something paints evidence onto the scene, since the paint
 * cannot be read without its key, except on touch devices, where the orbit pan-stick
 * sits above it, and on phone-width screens, where opened it is a sheet over the
 * bottom of the view.
 */
function hasRoomToOpen(): boolean {
  return !isCoarsePointer() && !window.matchMedia?.("(max-width: 639px)").matches;
}

export function EvidenceLegend() {
  const toggleResearch = useTwinStore((state) => state.toggleResearch);
  const evidenceMode = useTwinStore((state) => state.evidenceMode);
  const setEvidenceMode = useTwinStore((state) => state.setEvidenceMode);
  const showUncertainty = useTwinStore((state) => state.showUncertainty);
  const toggleUncertainty = useTwinStore((state) => state.toggleUncertainty);
  const showLens = useTwinStore((state) => state.showLens);
  const toggleLens = useTwinStore((state) => state.toggleLens);
  const paintsEvidence = showLens || showUncertainty;

  // The legend and the dossier share the right-hand column. A dossier folds the
  // legend to its header so the claim being read is not painted over, and closing it
  // puts the legend back as it was. It can still be reopened by hand over a dossier.
  const dossierOpen = useTwinStore((state) => state.selectedId !== null);
  const [wanted, setWanted] = useState(() => paintsEvidence && hasRoomToOpen());
  const [overDossier, setOverDossier] = useState(false);
  const open = dossierOpen ? overDossier : wanted;
  const toggleOpen = dossierOpen ? setOverDossier : setWanted;

  useEffect(() => {
    if (!dossierOpen) setOverDossier(false);
  }, [dossierOpen]);
  useEffect(() => {
    if (paintsEvidence && hasRoomToOpen()) setWanted(true);
  }, [paintsEvidence]);

  const snapshotDate = useTwinStore((state) => state.snapshotDate);
  const counts = useMemo(evidenceClassificationCounts, []);
  // What the lens paints, counted from the same predicate the scene draws by.
  const tally = useMemo(
    () => lensTally(snapshotDate, evidenceMode),
    [snapshotDate, evidenceMode],
  );
  const total =
    counts.observed + counts.reported + counts.interpreted + counts.illustrative;

  return (
    <section
      aria-labelledby="evidence-legend-heading"
      data-open={open ? "" : undefined}
      className="evidence-legend hud-panel pointer-events-auto p-3"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2
            id="evidence-legend-heading"
            className="text-muted-foreground text-[10px] font-semibold tracking-[0.18em] uppercase"
          >
            Evidence status
          </h2>
          <p className="text-muted-foreground mt-0.5 font-mono text-[10px]">
            {total} records · {PRIMARY_CRS}
          </p>
          {/* The one line that stays when the rest folds away. Which subjects are being
              drawn, and that it is a reconstruction, are not details to open a panel for.
              A phone's column is too narrow to hold it without becoming a tower. */}
          <p className="text-muted-foreground mt-1 hidden text-[10px] leading-relaxed sm:block">
            <span aria-hidden="true">{EVIDENCE_MODE_META[evidenceMode].glyph}</span>{" "}
            {EVIDENCE_MODE_META[evidenceMode].label}. Reconstruction, not operational
            data.
          </p>
        </div>
        <button
          type="button"
          onClick={() => toggleOpen((value) => !value)}
          aria-expanded={open}
          aria-controls="evidence-legend-body"
          className="border-border hover:bg-accent focus-visible:ring-ring inline-flex items-center gap-1 rounded border px-2 py-1 text-[10px] focus-visible:ring-2 focus-visible:outline-none"
        >
          {open ? (
            <ChevronDown className="size-3" aria-hidden="true" />
          ) : (
            <ChevronUp className="size-3" aria-hidden="true" />
          )}
          {open ? "Hide" : "Show"}
        </button>
      </div>

      <div id="evidence-legend-body" hidden={!open} className="mt-3">
        <EvidenceModeControl
          mode={evidenceMode}
          onChange={setEvidenceMode}
          density="compact"
          idPrefix="hud-evidence-mode"
          className="border-border mb-3 border-b pb-3"
        />
        <label className="mb-2 flex cursor-pointer items-start gap-2 text-[10px] leading-relaxed">
          <input
            type="checkbox"
            checked={showLens}
            onChange={toggleLens}
            className="accent-primary focus-visible:ring-ring mt-0.5 size-3.5 focus-visible:ring-2 focus-visible:outline-none"
          />
          <span>
            Paint by evidence status <kbd className="kbd">L</kbd>
            <span className="text-muted-foreground block">
              Tints every building and pavement in the scene and on the map by the status
              below, with its glyph on the map and its line pattern on every edge &mdash;
              solid for observed, more broken down the ranks. At a past timeline date, the
              status that was knowable then.
            </span>
          </span>
        </label>
        {/* A live region that stays mounted, so switching the lens on is announced. */}
        <p
          role="status"
          className={cn(
            "text-muted-foreground text-[10px] leading-relaxed",
            showLens && "mb-3",
          )}
        >
          {showLens ? describeLens(tally, snapshotDate) : null}
        </p>
        <label className="mb-3 flex cursor-pointer items-start gap-2 text-[10px] leading-relaxed">
          <input
            type="checkbox"
            checked={showUncertainty}
            onChange={toggleUncertainty}
            className="accent-primary focus-visible:ring-ring mt-0.5 size-3.5 focus-visible:ring-2 focus-visible:outline-none"
          />
          <span>
            Show spatial uncertainty
            <span className="text-muted-foreground block">
              Rings where the model documents a distance, broken by how well the subject
              is identified. Nothing is drawn where no figure is stated — most of the
              model is in that position. Needs quality tier 2 or above.
            </span>
          </span>
        </label>
        <EvidenceLegendList compact tally={tally} />
        <p className="text-muted-foreground mt-3 text-[10px] leading-relaxed">
          Public-source analytical reconstruction. Modeled geometry in {PRIMARY_CRS}{" "}
          around an approximate {SITE_PROFILE.terrainDatum.elevationM} m{" "}
          {SITE_PROFILE.terrainDatum.verticalReference} datum. Not operational data;
          building functions are not verified interior uses.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={toggleResearch}
            className="border-border hover:bg-accent focus-visible:ring-ring rounded border px-2 py-1 text-[10px] focus-visible:ring-2 focus-visible:outline-none"
          >
            Sources, limitations &amp; manifest
          </button>
          <Link
            to="/analysis"
            className="border-border hover:bg-accent focus-visible:ring-ring inline-flex items-center gap-1 rounded border px-2 py-1 text-[10px] focus-visible:ring-2 focus-visible:outline-none"
          >
            <Table2 className="size-3" aria-hidden="true" />
            Accessible analysis table
          </Link>
        </div>
      </div>
    </section>
  );
}
