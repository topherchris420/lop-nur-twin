import { ExternalLink, Navigation, X } from "lucide-react";
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
import {
  EVIDENCE_LABELS,
  SITE_PROFILE,
  getSource,
  type EvidenceStatus,
} from "@/lib/siteData";
import { useTwinStore } from "@/lib/store";

const EVIDENCE_STYLES: Record<EvidenceStatus, string> = {
  observed: "border-emerald-400/35 text-emerald-200",
  reported: "border-sky-400/35 text-sky-200",
  interpreted: "border-amber-400/35 text-amber-200",
  illustrative: "border-zinc-400/35 text-zinc-200",
};

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
  const sources = def.evidence.sourceIds
    .map((sourceId) => getSource(sourceId))
    .filter((source) => source !== undefined);
  const missionEntity = getMissionEntity(def.id);

  return (
    <Card className="hud-side-panel absolute top-16 right-4 z-10 w-80 select-text">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle>{def.name}</CardTitle>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <Badge variant="secondary">{STRUCTURE_TYPE_LABELS[def.type]}</Badge>
              <Badge
                variant="outline"
                className={EVIDENCE_STYLES[def.evidence.status]}
              >
                {EVIDENCE_LABELS[def.evidence.status]}
              </Badge>
            </div>
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
        </dl>
        <Separator />
        <div>
          <div className="text-muted-foreground text-[10px] font-semibold tracking-[0.14em] uppercase">
            Evidence
          </div>
          <p className="text-muted-foreground mt-1 text-[11px] leading-relaxed">
            {def.evidence.note}
          </p>
          {def.evidence.observedOn ? (
            <p className="text-muted-foreground mt-1 font-mono text-[10px]">
              Reference date: {def.evidence.observedOn}
            </p>
          ) : null}
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[10px]">
            <dt className="text-muted-foreground">Confidence</dt>
            <dd className="text-right capitalize">{def.evidence.confidence}</dd>
            {def.evidence.resolutionM ? (
              <>
                <dt className="text-muted-foreground">Source resolution</dt>
                <dd className="text-right">{def.evidence.resolutionM} m</dd>
              </>
            ) : null}
          </dl>
          {def.evidence.method ? (
            <p className="text-muted-foreground mt-2 text-[10px] leading-relaxed">
              Method: {def.evidence.method}
            </p>
          ) : null}
          {def.evidence.uncertainty ? (
            <p className="text-muted-foreground mt-1 text-[10px] leading-relaxed">
              Uncertainty: {def.evidence.uncertainty}
            </p>
          ) : null}
          {sources.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
              {sources.map((source) => (
                <a
                  key={source.id}
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline"
                >
                  {source.publisher}
                  <ExternalLink className="size-3" />
                </a>
              ))}
            </div>
          ) : null}
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
      </CardContent>
    </Card>
  );
}
