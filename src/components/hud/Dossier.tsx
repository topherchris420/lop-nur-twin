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
  strongestClassification,
} from "@/lib/evidence";
import { EXTERNAL_LINK_PROPS, safeExternalHref } from "@/lib/safeUrl";
import {
  ConfidenceValue,
  EvidenceBadge,
  ProvenanceFooter,
} from "@/components/evidence/EvidenceUi";
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
  const def = selectedId ? getStructure(selectedId) : undefined;
  if (
    !def ||
    !isVisibleAtTimelineYear(def, activeTimelineYear) ||
    showIndex ||
    showResearch
  ) {
    return null;
  }

  const [w, h, d] = def.size;
  const localPosition = `${localAxis(def.position[0], "E", "W")} / ${localAxis(-def.position[1], "N", "S")}`;
  const records = getEvidenceForSubject(def.id);
  const classification = strongestClassification(records) ?? def.evidence.status;
  const missionEntity = getMissionEntity(def.id);

  return (
    <Card className="hud-side-panel absolute top-16 right-4 z-10 w-80 select-text">
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
            Evidence record{records.length === 1 ? "" : "s"} ({records.length})
          </div>
          {/*
            One block per record in the shared ledger, rather than the old
            single free-text note: a reviewer can see which specific source
            supports which claim, how confident the project is in it, when the
            source was published and when it was last consulted.
          */}
          <ul className="mt-2 space-y-2.5">
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
                  <p className="text-muted-foreground mt-1 text-[11px] leading-relaxed">
                    {record.claim}
                  </p>
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
                        <ExternalLink className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                        <span className="sr-only">(opens in a new tab)</span>
                      </a>
                    )}
                  </p>
                  <p className="text-muted-foreground mt-0.5 font-mono text-[10px]">
                    {record.sourcePublisher ?? "publisher unknown"} · published{" "}
                    {record.sourceDate ?? "unknown"} · accessed {record.accessedAt ?? "unknown"}
                  </p>
                  {record.measurementUncertaintyM !== undefined ||
                  record.sourceResolutionM !== undefined ? (
                    <p className="text-muted-foreground mt-0.5 font-mono text-[10px]">
                      {record.measurementUncertaintyM !== undefined
                        ? `uncertainty ±${record.measurementUncertaintyM} m`
                        : null}
                      {record.measurementUncertaintyM !== undefined &&
                      record.sourceResolutionM !== undefined
                        ? " · "
                        : null}
                      {record.sourceResolutionM !== undefined
                        ? `source resolution ${record.sourceResolutionM} m`
                        : null}
                    </p>
                  ) : null}
                  {record.analystNotes ? (
                    <p className="text-muted-foreground mt-1 text-[10px] leading-relaxed">
                      {record.analystNotes}
                    </p>
                  ) : null}
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
                <dd className="text-right">{missionEntity.observation.timestamp ?? "unknown"}</dd>
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
                Tasks: {missionEntity.taskableBehaviors.map((behavior) => behavior.label).join(" · ")}
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
