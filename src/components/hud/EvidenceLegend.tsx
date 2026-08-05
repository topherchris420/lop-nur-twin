import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Table2 } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { EvidenceLegendList } from "@/components/evidence/EvidenceUi";
import { PRIMARY_CRS, evidenceClassificationCounts } from "@/lib/evidence";
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
 * It collapses to its header on touch devices, where the orbit joystick owns
 * the same corner, and the full legend also lives in the research panel and on
 * `/analysis` so the information is never only in one place.
 */
export function EvidenceLegend() {
  const [open, setOpen] = useState(() => !isCoarsePointer());
  const toggleResearch = useTwinStore((state) => state.toggleResearch);
  const counts = useMemo(evidenceClassificationCounts, []);
  const total =
    counts.observed + counts.reported + counts.interpreted + counts.illustrative;

  return (
    <section
      aria-labelledby="evidence-legend-heading"
      className={cn(
        "hud-panel absolute right-4 bottom-4 z-10 w-[19rem] max-w-[calc(100vw-2rem)] p-3",
        "max-sm:right-2 max-sm:bottom-2 max-sm:w-[15rem]",
      )}
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
        </div>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
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
        <EvidenceLegendList compact />
        <p className="text-muted-foreground mt-3 text-[10px] leading-relaxed">
          Public-source analytical reconstruction. Modeled geometry in {PRIMARY_CRS}
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
