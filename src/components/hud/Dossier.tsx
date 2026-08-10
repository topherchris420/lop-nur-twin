import { ExternalLink, Navigation, Table2, X } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  STRUCTURE_TYPE_LABELS,
  getMissionEntity,
  getStructure,
  isVisibleAtTimelineYear,
} from "@/lib/layout";
import { flyToStructure } from "@/lib/flyTo";
import { SITE_PROFILE } from "@/lib/siteData";
import {
  EVIDENCE_CLASSIFICATION_META,
  PRIMARY_CRS,
  getEvidenceForSubject,
  getUncertaintyForSubject,
  strongestClassification,
} from "@/lib/evidence";
import { temporalEventsForSubject } from "@/lib/temporal";
import { EXTERNAL_LINK_PROPS, safeExternalHref } from "@/lib/safeUrl";
import {
  ConfidenceValue,
  EvidenceBadge,
  ProvenanceFooter,
} from "@/components/evidence/EvidenceUi";
import { UncertaintyPanel } from "@/components/evidence/UncertaintyPanel";
import { RecordProvenance } from "@/components/evidence/ProvenanceChain";
import { DEFENSIBILITY_META, getDefensibility, survivesProveIt } from "@/lib/forensics";
import { isSubjectVisible } from "@/lib/evidenceMode";
import { useTwinStore } from "@/lib/store";

function localAxis(value: number, positive: string, negative: string): string {
  return `${Math.abs(value).toFixed(0)} m ${value >= 0 ? positive : negative}`;
}

export function Dossier() {
  const selectedId = useTwinStore((s) => s.selectedId);
  const select = useTwinStore((s) => s.select);
  const showIndex = useTwinStore((s) => s.showIndex);
  const showResearch = useTwinStore((s) => s.showResearch);
  const activeTimelineYear = useTwinStore((s) => s.activeTimelineYear);
  const evidenceMode = useTwinStore((s) => s.evidenceMode);
  const proveIt = useTwinStore((s) => s.proveIt);
  const showReference = useTwinStore((s) => s.showReference);
  const setProveIt = useTwinStore((s) => s.setProveIt);
  const def = selectedId ? getStructure(selectedId) : undefined;
  if (
    !def ||
    !isVisibleAtTimelineYear(def, activeTimelineYear) ||
    !isSubjectVisible(def.id, evidenceMode) ||
    // A dossier for a building PROVE IT has just removed would be a panel of
    // detail about something no longer on screen — the exact confusion the
    // strict readings exist to prevent.
    (proveIt && !survivesProveIt(def.id)) ||
    showIndex ||
    showResearch ||
    showReference
  ) {
    return null;
  }

  const [w, h, d] = def.size;
  const localPosition = `${localAxis(def.position[0], "E", "W")} / ${localAxis(-def.position[1], "N", "S")}`;
  const records = getEvidenceForSubject(def.id);
  const classification = strongestClassification(records) ?? def.evidence.status;
  const uncertainty = getUncertaintyForSubject(def.id);
  const temporalEvents = temporalEventsForSubject(def.id);
  const missionEntity = getMissionEntity(def.id);
  const verdict = getDefensibility(def.id);

  return (
    <Card className="hud-side-panel absolute top-16 right-4 z-10 max-h-[calc(100vh-13rem)] w-80 overflow-y-auto select-text">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle>{def.name}</CardTitle>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Badge variant="secondary">{STRUCTURE_TYPE_LABELS[def.type]}</Badge>
              <EvidenceBadge classification={classification} />
            </div>
            <p className="text-muted-foreground mt-1.5 text-[10px] leading-relaxed">
              {EVIDENCE_CLASSIFICATION_META[classification].statement}
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
        <CardDescription>{def.description}</CardDescription>
        <Separator />
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 font-mono text-xs">
          <dt className="text-muted-foreground">Dimensions</dt>
          <dd className="text-right">
            {w} x {d} x {h} m
          </dd>
          <dt className="text-muted-foreground">Model basis</dt>
          <dd className="text-right">{def.modelBasis}</dd>
          <dt className="text-muted-foreground">Local position</dt>
          <dd className="text-right">{localPosition}</dd>
          <dt className="text-muted-foreground">Site datum</dt>
          <dd className="text-right">
            {SITE_PROFILE.terrainDatum.elevationM.toFixed(0)} m AMSL
          </dd>
          <dt className="text-muted-foreground">Coordinate system</dt>
          <dd className="text-right">{PRIMARY_CRS}</dd>
        </dl>
        <Separator />
        <div>
          <div className="text-muted-foreground text-[10px] font-semibold tracking-[0.14em] uppercase">
            Uncertainty
          </div>
          <UncertaintyPanel
            envelope={uncertainty}
            events={temporalEvents}
            className="mt-2"
          />
        </div>
        <Separator />
        {/*
          What survives a strict reading, before the sources that support it.
          A reviewer's first question about a modeled building is not which
          scene it came from — it is which parts of what they are looking at
          the citation actually carries.
        */}
        {verdict ? (
          <div>
            <div className="text-muted-foreground text-[10px] font-semibold tracking-[0.14em] uppercase">
              Defensibility
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span
                className="border-border inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] leading-tight font-medium"
                title={DEFENSIBILITY_META[verdict.level].description}
              >
                <span aria-hidden="true">{DEFENSIBILITY_META[verdict.level].glyph}</span>
                <span>{DEFENSIBILITY_META[verdict.level].label}</span>
              </span>
              <span className="text-muted-foreground font-mono text-[10px]">
                {verdict.defended.length}/
                {verdict.defended.length + verdict.stripped.length} attributes defended
              </span>
            </div>
            <p className="text-muted-foreground mt-1.5 text-[10px] leading-relaxed">
              {verdict.statement}
            </p>
            <button
              type="button"
              onClick={() => setProveIt(true)}
              className="border-border hover:bg-accent focus-visible:ring-ring mt-2 rounded border px-2 py-1 text-[10px] focus-visible:ring-2 focus-visible:outline-none"
            >
              Show me only what is defended
            </button>
          </div>
        ) : null}
        <Separator />
        <div>
          <div className="text-muted-foreground text-[10px] font-semibold tracking-[0.14em] uppercase">
            {/*
              The record is still the noun; the chain is how it is presented.
              "Evidence record" is the term the ledger, the analysis table and
              the manifest all use for this same thing, so the dossier keeps it.
            */}
            Evidence record{records.length === 1 ? "" : "s"} ({records.length})
          </div>
          <p className="text-muted-foreground mt-1 text-[10px] leading-relaxed">
            Each one as a provenance chain: claim, evidence, source, date, uncertainty,
            model decision — in that order, with the links this project holds nothing for
            left open.
          </p>
          {/*
            One chain per record in the shared ledger. It carries everything the
            old flat record block did — which source supports which claim, the
            confidence, the publication and access dates — and adds the two
            things a flat block could not show: where the reasoning has gaps,
            and what this project supplied that no source carries.
          */}
          <ul className="mt-2 space-y-3">
            {records.map((record) => {
              const href = safeExternalHref(record.sourceUrl);
              return (
                <li key={record.id} className="border-border border-l-2 pl-2.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <EvidenceBadge classification={record.classification} />
                    <ConfidenceValue
                      confidence={record.confidence}
                      className="text-muted-foreground text-[10px]"
                    />
                  </div>
                  <p className="mt-1 text-[10px] leading-relaxed">
                    {href === undefined ? (
                      <span className="text-muted-foreground">{record.sourceTitle}</span>
                    ) : (
                      <a
                        href={href}
                        {...EXTERNAL_LINK_PROPS}
                        className="text-primary inline-flex items-start gap-1 hover:underline"
                      >
                        {record.sourceTitle}
                        <ExternalLink
                          className="mt-0.5 size-3 shrink-0"
                          aria-hidden="true"
                        />
                        <span className="sr-only">(opens in a new tab)</span>
                      </a>
                    )}
                  </p>
                  <RecordProvenance record={record} compact className="mt-2" />
                </li>
              );
            })}
          </ul>
        </div>
        {missionEntity ? (
          <>
            <Separator />
            <div>
              <div className="text-muted-foreground text-[10px] font-semibold tracking-[0.14em] uppercase">
                Mission entity
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[10px]">
                <dt className="text-muted-foreground">Entity ID</dt>
                <dd className="truncate text-right" title={missionEntity.id}>
                  {missionEntity.id}
                </dd>
                <dt className="text-muted-foreground">Observation</dt>
                <dd className="text-right">
                  {missionEntity.observation.timestamp ?? "unknown"}
                </dd>
                <dt className="text-muted-foreground">Relationships</dt>
                <dd className="text-right">{missionEntity.relationships.length}</dd>
              </dl>
              <div className="mt-2 flex flex-wrap gap-1">
                {missionEntity.capabilities.map((capability) => (
                  <Badge key={capability} variant="outline" className="text-[9px]">
                    {capability}
                  </Badge>
                ))}
              </div>
              <p className="text-muted-foreground mt-2 text-[10px] leading-relaxed">
                Tasks:{" "}
                {missionEntity.taskableBehaviors
                  .map((behavior) => behavior.label)
                  .join(" · ")}
              </p>
            </div>
          </>
        ) : null}
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
        <Separator />
        <ProvenanceFooter />
      </CardContent>
    </Card>
  );
}
