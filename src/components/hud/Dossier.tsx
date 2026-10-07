import { useMemo } from "react";
import { Navigation, Table2, X } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { getStructure, type StructureDef } from "@/lib/layout";
import { flyToStructure } from "@/lib/flyTo";
import { SITE_PROFILE } from "@/lib/siteData";
import { PRIMARY_CRS } from "@/lib/evidence";
import { inspectClaim, isClaimSubject } from "@/lib/claims";
import { temporalEventsForSubject } from "@/lib/temporal";
import { EvidenceBadge, ProvenanceFooter } from "@/components/evidence/EvidenceUi";
import { ClaimInspector } from "@/components/evidence/ClaimInspector";
import { subjectDrawState } from "@/lib/sceneVisibility";
import { useTwinStore } from "@/lib/store";

function localAxis(value: number, positive: string, negative: string): string {
  return `${Math.abs(value).toFixed(0)} m ${value >= 0 ? positive : negative}`;
}

/**
 * The structure dossier: the claim inspector for whatever is selected.
 *
 * It answers the reviewer's questions in order — what this is, how much is
 * known, when, and what supports it — from `inspectClaim`, the same derivation
 * `/analysis` renders. At a past evidence-timeline date it opens with what
 * could be said on that date, and it stays open for an outlined ghost, because
 * "why is this only an outline?" is exactly the question worth answering.
 */
export function Dossier() {
  const selectedId = useTwinStore((s) => s.selectedId);
  const select = useTwinStore((s) => s.select);
  const showIndex = useTwinStore((s) => s.showIndex);
  const showResearch = useTwinStore((s) => s.showResearch);
  const snapshotDate = useTwinStore((s) => s.snapshotDate);
  const evidenceMode = useTwinStore((s) => s.evidenceMode);
  const def = selectedId ? getStructure(selectedId) : undefined;
  // Anything the ledger makes a claim about can be inspected, not only a
  // building: selecting the circuit aircraft once opened nothing at all.
  const subjectId = selectedId !== null && isClaimSubject(selectedId) ? selectedId : null;
  const claim = useMemo(
    () => (subjectId === null ? undefined : inspectClaim(subjectId, snapshotDate)),
    [subjectId, snapshotDate],
  );
  const events = useMemo(
    () => (subjectId === null ? [] : temporalEventsForSubject(subjectId)),
    [subjectId],
  );

  if (
    subjectId === null ||
    !claim ||
    subjectDrawState(subjectId, snapshotDate, evidenceMode) === "hidden" ||
    showIndex ||
    showResearch
  ) {
    return null;
  }

  return (
    <Card
      className="hud-side-panel dossier-panel absolute top-16 right-4 z-10 w-80 select-text"
      role="region"
      aria-label={`Claim inspector: ${claim.label}`}
    >
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle>{claim.label}</CardTitle>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {claim.typeLabel === undefined ? null : (
                <Badge variant="secondary">{claim.typeLabel}</Badge>
              )}
              <EvidenceBadge classification={claim.classification} />
            </div>
            <p className="text-muted-foreground mt-1.5 text-[10px] leading-relaxed">
              {claim.statement}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close dossier"
            onClick={() => select(null)}
          >
            <X />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <ClaimInspector claim={claim} events={events} idPrefix="dossier" />
        {def === undefined ? (
          <Button asChild variant="outline" className="w-full">
            <Link to="/analysis" search={{ claim: subjectId }}>
              <Table2 />
              Open in the analysis page
            </Link>
          </Button>
        ) : (
          <StructureFacts def={def} />
        )}
        <Separator />
        <ProvenanceFooter />
      </CardContent>
    </Card>
  );
}

/** What only a structure has: modeled size and position, and somewhere to fly to. */
function StructureFacts({ def }: { def: StructureDef }) {
  const [w, h, d] = def.size;
  const localPosition = `${localAxis(def.position[0], "E", "W")} / ${localAxis(-def.position[1], "N", "S")}`;
  return (
    <>
      <Separator />
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 font-mono text-[10px]">
        <dt className="text-muted-foreground">Modeled size</dt>
        <dd className="text-right">
          {w} x {d} x {h} m
        </dd>
        <dt className="text-muted-foreground">Local position</dt>
        <dd className="text-right">{localPosition}</dd>
        <dt className="text-muted-foreground">Site datum</dt>
        <dd className="text-right">
          {SITE_PROFILE.terrainDatum.elevationM.toFixed(0)} m AMSL
        </dd>
        <dt className="text-muted-foreground">Coordinate system</dt>
        <dd className="text-right">{PRIMARY_CRS}</dd>
      </dl>
      <Button className="w-full" onClick={() => flyToStructure(def)}>
        <Navigation />
        Fly to structure
      </Button>
      <Button asChild variant="outline" className="w-full">
        <Link to="/analysis" search={{ structure: def.id }}>
          <Table2 />
          Open in the analysis table
        </Link>
      </Button>
    </>
  );
}
