import { useCallback } from "react";
import { BookOpen, Download, ExternalLink, X } from "lucide-react";
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
  CLIMATE_MONTHS,
  OFFSITE_CONTEXT,
  PUBLIC_SOURCES,
  SITE_PROFILE,
  getClimateMonth,
  getSource,
  type PublicSource,
} from "@/lib/siteData";
import {
  CONFIDENCE_SCALE_NOTE,
  EVIDENCE_LEDGER,
  GEOGRAPHIC_CRS,
  KNOWN_LIMITATIONS,
  PRIMARY_CRS,
} from "@/lib/evidence";
import { MODEL_MANIFEST_PATH, shortHash, useModelManifest } from "@/lib/modelManifest";
import { BookmarkPanel } from "@/components/evidence/BookmarkPanel";
import { flyToPoint } from "@/lib/flyTo";
import type { Bookmark } from "@/lib/bookmarks";
import { EvidenceLegendList } from "@/components/evidence/EvidenceUi";
import { EXTERNAL_LINK_PROPS, safeExternalHref } from "@/lib/safeUrl";
import { useTwinStore } from "@/lib/store";

const ROLE_LABELS: Record<PublicSource["role"], string> = {
  imagery: "Imagery",
  terrain: "Terrain",
  climate: "Climate",
  reporting: "Reporting",
  analysis: "Analysis",
  telemetry: "Telemetry",
};

function coordinate(value: number, positive: string, negative: string): string {
  return `${Math.abs(value).toFixed(4)} ${value >= 0 ? positive : negative}`;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground text-[10px] tracking-[0.12em] uppercase">
        {label}
      </dt>
      <dd className="mt-0.5 font-mono text-xs tabular-nums">{value}</dd>
    </div>
  );
}

export function ResearchPanel() {
  const showResearch = useTwinStore((s) => s.showResearch);
  const toggleResearch = useTwinStore((s) => s.toggleResearch);
  const environmentMonth = useTwinStore((s) => s.environmentMonth);
  const setEnvironmentMonth = useTwinStore((s) => s.setEnvironmentMonth);
  const climate = getClimateMonth(environmentMonth);
  // Only fetched once the panel is actually opened; the twin still makes no
  // network request in its default state.
  const manifest = useModelManifest(showResearch);

  /**
   * The current analytical position, read straight from the store rather than
   * subscribed to: this runs on a click, and subscribing would re-render the
   * panel on every camera-adjacent state change for no benefit.
   */
  const captureView = useCallback(() => {
    const state = useTwinStore.getState();
    return {
      cameraMode: state.cameraMode,
      timelineYear: state.activeTimelineYear,
      snapshotDate: state.snapshotDate,
      comparisonDate: state.comparisonDate,
      evidenceMode: state.evidenceMode,
      selectedId: state.selectedId,
      measurePoints: state.measurePoints,
      showUncertainty: state.showUncertainty,
      environmentMonth: state.environmentMonth,
      night: state.night,
      qualityTier: state.qualityTier,
    };
  }, []);

  /**
   * Restores a saved view. The camera is moved through the existing `flyToPoint`
   * request rather than by writing to the camera directly, so a bookmark uses
   * the same path a minimap click does and the active rig stays in charge.
   */
  const applyBookmark = useCallback((bookmark: Bookmark) => {
    const state = useTwinStore.getState();
    const { view } = bookmark;
    state.setEvidenceMode(view.evidenceMode);
    state.setActiveTimelineYear(view.timelineYear);
    state.setSnapshotDate(view.snapshotDate);
    state.setComparisonDate(view.comparisonDate);
    state.setEnvironmentMonth(view.environmentMonth);
    if (state.showUncertainty !== view.showUncertainty) state.toggleUncertainty();
    if (state.night !== view.night) state.toggleNight();
    state.clearMeasure();
    for (const point of view.measurePoints) state.addMeasurePoint(point);
    // Selection last: setting the evidence mode clears a selection the new mode
    // withholds, so restoring it before the mode would drop it again.
    state.select(view.selectedId);
    const target = view.cameraTarget;
    if (target !== undefined) flyToPoint(target[0], target[2]);
  }, []);

  if (!showResearch) return null;

  const reference = SITE_PROFILE.referenceCoordinate;

  return (
    <Card
      id="research-panel"
      className="research-panel hud-side-panel absolute top-16 right-4 z-10 flex max-h-[calc(100dvh-5rem)] flex-col select-text"
    >
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <BookOpen className="size-4 text-primary" />
              Research &amp; Data
            </CardTitle>
            <CardDescription className="mt-1">
              Public sources, modeled inputs, and confidence boundaries.
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close research panel"
            onClick={toggleResearch}
          >
            <X />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="overflow-y-auto pr-3">
        <section aria-labelledby="site-reference-heading">
          <h2
            id="site-reference-heading"
            className="text-muted-foreground text-[10px] font-semibold tracking-[0.16em] uppercase"
          >
            Site Reference
          </h2>
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2.5">
            <Metric
              label="Coordinate"
              value={`${coordinate(reference.latitude, "N", "S")}, ${coordinate(reference.longitude, "E", "W")}`}
            />
            <Metric
              label="Site datum"
              value={`${SITE_PROFILE.terrainDatum.elevationM.toFixed(0)} m AMSL`}
            />
            <Metric label="Local CRS" value={SITE_PROFILE.localCrs.code} />
            <Metric
              label="Vertical ref"
              value={SITE_PROFILE.terrainDatum.verticalReference}
            />
            <Metric
              label="Scene extent"
              value={`${(SITE_PROFILE.worldExtentM / 1000).toFixed(1)} km square`}
            />
            <Metric
              label="Modeled runway"
              value={`${SITE_PROFILE.runway.modeledLengthM} x ${SITE_PROFILE.runway.modeledWidthM} m`}
            />
          </dl>
          <p className="text-muted-foreground mt-2 text-[11px] leading-relaxed">
            {reference.precision}. Runway {SITE_PROFILE.runway.designation} is aligned to
            a modeled {SITE_PROFILE.runway.modeledGridBearingDeg} deg grid bearing;
            modeled endpoint uncertainty is about{" "}
            {SITE_PROFILE.runway.endpointUncertaintyM} m.
          </p>
          <p className="text-muted-foreground mt-1 text-[11px] leading-relaxed">
            {SITE_PROFILE.terrainDatum.product}: {SITE_PROFILE.terrainDatum.note}
          </p>
          <p className="text-muted-foreground mt-1 font-mono text-[10px]">
            Projected frame {PRIMARY_CRS} · geographic reference {GEOGRAPHIC_CRS}
          </p>
        </section>

        <Separator className="my-4" />

        <section aria-labelledby="evidence-legend-heading">
          <h2
            id="evidence-legend-heading"
            className="text-muted-foreground text-[10px] font-semibold tracking-[0.16em] uppercase"
          >
            Evidence Status Legend
          </h2>
          <p className="text-muted-foreground mt-1 text-[11px] leading-relaxed">
            Status is carried by a symbol and a word as well as a colour. Source
            observation and simulation are never merged: anything the model adds is marked
            interpreted or illustrative.
          </p>
          <div className="mt-2">
            <EvidenceLegendList />
          </div>
          <p className="text-muted-foreground mt-2 text-[10px] leading-relaxed">
            {CONFIDENCE_SCALE_NOTE}
          </p>
          <p className="text-muted-foreground mt-1 font-mono text-[10px]">
            {EVIDENCE_LEDGER.length} evidence records across {PUBLIC_SOURCES.length}{" "}
            public sources
          </p>
          <Button asChild variant="outline" size="sm" className="mt-2 w-full">
            <Link to="/analysis">Open the accessible analysis table</Link>
          </Button>
        </section>

        <Separator className="my-4" />

        <section aria-labelledby="climate-heading">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2
                id="climate-heading"
                className="text-muted-foreground text-[10px] font-semibold tracking-[0.16em] uppercase"
              >
                NASA POWER Climate
              </h2>
              <p className="text-muted-foreground mt-0.5 text-[10px]">
                Monthly means, {SITE_PROFILE.climatePeriod}
              </p>
            </div>
            <label className="sr-only" htmlFor="environment-month">
              Environment month
            </label>
            <select
              id="environment-month"
              value={environmentMonth}
              onChange={(event) => setEnvironmentMonth(Number(event.target.value))}
              className="border-input bg-secondary text-secondary-foreground h-8 rounded-md border px-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {CLIMATE_MONTHS.map((month, index) => (
                <option key={month.month} value={index}>
                  {month.month}
                </option>
              ))}
            </select>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2.5">
            <Metric label="Temperature" value={`${climate.temperatureC.toFixed(1)} C`} />
            <Metric
              label="Humidity"
              value={`${climate.relativeHumidityPct.toFixed(1)}%`}
            />
            <Metric label="Wind" value={`${climate.windSpeedMps.toFixed(1)} m/s`} />
            <Metric
              label="Wind from"
              value={`${climate.windDirectionDeg.toFixed(0)} deg`}
            />
            <Metric
              label="Precipitation"
              value={`${climate.precipitationMmDay.toFixed(2)} mm/day`}
            />
            <Metric
              label="Solar"
              value={`${climate.solarKwhM2Day.toFixed(2)} kWh/m2/day`}
            />
          </dl>
          <p className="text-muted-foreground mt-2 text-[11px] leading-relaxed">
            These are climatological means used to drive the simulator environment, not
            observations or live weather.
          </p>
        </section>

        <Separator className="my-4" />

        <section aria-labelledby="offsite-heading">
          <h2
            id="offsite-heading"
            className="text-muted-foreground text-[10px] font-semibold tracking-[0.16em] uppercase"
          >
            Offsite Context
          </h2>
          {OFFSITE_CONTEXT.map((place) => (
            <div key={place.id} className="mt-2">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-xs font-semibold">{place.name}</h3>
                <span className="text-muted-foreground shrink-0 font-mono text-[10px]">
                  ~{place.distanceFromAirfieldKm} km away
                </span>
              </div>
              <p className="text-muted-foreground mt-1 font-mono text-[10px]">
                {coordinate(place.latitude, "N", "S")},{" "}
                {coordinate(place.longitude, "E", "W")}
              </p>
              <p className="text-muted-foreground mt-1 text-[11px] leading-relaxed">
                {place.note}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                {place.sourceIds.map((sourceId) => {
                  const source = getSource(sourceId);
                  const href = safeExternalHref(source?.url);
                  return source && href ? (
                    <a
                      key={source.id}
                      href={href}
                      {...EXTERNAL_LINK_PROPS}
                      className="text-primary inline-flex items-center gap-1 text-[10px] hover:underline"
                    >
                      {source.publisher}
                      <ExternalLink className="size-3" aria-hidden="true" />
                      <span className="sr-only">(opens in a new tab)</span>
                    </a>
                  ) : null;
                })}
              </div>
            </div>
          ))}
        </section>

        <Separator className="my-4" />

        <section aria-labelledby="sources-heading">
          <h2
            id="sources-heading"
            className="text-muted-foreground text-[10px] font-semibold tracking-[0.16em] uppercase"
          >
            Public Source Register
          </h2>
          <ol className="mt-2 space-y-3">
            {PUBLIC_SOURCES.map((source) => (
              <li key={source.id} className="border-border border-l-2 pl-3">
                <div className="flex items-start justify-between gap-2">
                  <a
                    href={safeExternalHref(source.url) ?? "#"}
                    {...EXTERNAL_LINK_PROPS}
                    className="hover:text-primary inline-flex items-start gap-1 text-xs leading-snug font-medium hover:underline"
                  >
                    {source.title}
                    <ExternalLink className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                    <span className="sr-only">(opens in a new tab)</span>
                  </a>
                  <Badge variant="outline" className="shrink-0">
                    {ROLE_LABELS[source.role]}
                  </Badge>
                </div>
                <p className="text-muted-foreground mt-1 font-mono text-[10px]">
                  {source.publisher} · published {source.publishedOn ?? "unknown"} ·
                  accessed {source.accessedOn}
                </p>
                <p className="text-muted-foreground mt-1 text-[11px] leading-relaxed">
                  {source.attribution}
                </p>
                {"dataUrl" in source && source.dataUrl ? (
                  <a
                    href={safeExternalHref(source.dataUrl) ?? "#"}
                    {...EXTERNAL_LINK_PROPS}
                    className="text-primary mt-1 inline-flex items-center gap-1 text-[10px] hover:underline"
                  >
                    Open data query
                    <ExternalLink className="size-3" aria-hidden="true" />
                    <span className="sr-only">(opens in a new tab)</span>
                  </a>
                ) : null}
              </li>
            ))}
          </ol>
        </section>

        <Separator className="my-4" />

        <section aria-labelledby="manifest-heading">
          <h2
            id="manifest-heading"
            className="text-muted-foreground text-[10px] font-semibold tracking-[0.16em] uppercase"
          >
            Model Manifest
          </h2>
          <p className="text-muted-foreground mt-1 text-[11px] leading-relaxed">
            Written before each build from the committed model data. The hashes identify
            the exact geometry and evidence ledger this session is rendering.
          </p>
          {manifest.status === "ready" ? (
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-[10px]">
              <dt className="text-muted-foreground">Version</dt>
              <dd className="text-right">{manifest.manifest.modelVersion}</dd>
              <dt className="text-muted-foreground">Generated</dt>
              <dd className="text-right">{manifest.manifest.generatedAt}</dd>
              <dt className="text-muted-foreground">Validation</dt>
              <dd className="text-right">{manifest.manifest.validationStatus}</dd>
              <dt className="text-muted-foreground">Geometry</dt>
              <dd className="truncate text-right" title={manifest.manifest.geometryHash}>
                {shortHash(manifest.manifest.geometryHash)}
              </dd>
              <dt className="text-muted-foreground">Evidence</dt>
              <dd
                className="truncate text-right"
                title={manifest.manifest.evidenceLedgerHash}
              >
                {shortHash(manifest.manifest.evidenceLedgerHash)}
              </dd>
            </dl>
          ) : (
            <p className="text-muted-foreground mt-2 text-[10px] leading-relaxed">
              {manifest.status === "loading"
                ? "Reading the manifest…"
                : "Manifest not generated for this build. Run `bun run manifest` (or `npm run manifest`)."}
            </p>
          )}
          <Button asChild variant="outline" size="sm" className="mt-2 w-full">
            <a href={MODEL_MANIFEST_PATH} download>
              <Download />
              Download model-manifest.json
            </a>
          </Button>
        </section>

        <Separator className="my-4" />

        <section aria-labelledby="bookmarks-heading">
          <h2
            id="bookmarks-heading"
            className="text-muted-foreground text-[10px] font-semibold tracking-[0.16em] uppercase"
          >
            Bookmarks
          </h2>
          <p className="text-muted-foreground mt-1 text-[11px] leading-relaxed">
            Saves the whole analytical position — camera, date, evidence mode, selection
            and measurement path — with the hashes of the model it was taken against, so
            reopening it on a changed build says so. Stored in this browser only. Full
            management, including import and export, is on the analysis page.
          </p>
          <BookmarkPanel
            captureView={captureView}
            provenance={
              manifest.status === "ready"
                ? {
                    geometryHash: manifest.manifest.geometryHash,
                    evidenceLedgerHash: manifest.manifest.evidenceLedgerHash,
                    modelVersion: manifest.manifest.modelVersion,
                  }
                : {}
            }
            currentModel={
              manifest.status === "ready"
                ? {
                    geometryHash: manifest.manifest.geometryHash,
                    evidenceLedgerHash: manifest.manifest.evidenceLedgerHash,
                  }
                : null
            }
            onOpen={applyBookmark}
            density="compact"
            className="mt-2"
          />
        </section>

        <Separator className="my-4" />

        <section aria-labelledby="limits-heading" className="pb-2">
          <h2
            id="limits-heading"
            className="text-muted-foreground text-[10px] font-semibold tracking-[0.16em] uppercase"
          >
            Known Limitations
          </h2>
          <p className="text-muted-foreground mt-1 text-[11px] leading-relaxed">
            The same list the release manifest publishes, so a downstream consumer of the
            data receives it with the data.
          </p>
          <ul className="mt-2 space-y-1.5">
            {KNOWN_LIMITATIONS.map((limitation) => (
              <li
                key={limitation}
                className="border-border text-muted-foreground border-l-2 pl-2 text-[11px] leading-relaxed"
              >
                {limitation}
              </li>
            ))}
          </ul>
        </section>
      </CardContent>
    </Card>
  );
}
