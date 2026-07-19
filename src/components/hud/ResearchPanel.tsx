import { BookOpen, ExternalLink, X } from "lucide-react";
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
import { useTwinStore } from "@/lib/store";

const ROLE_LABELS: Record<PublicSource["role"], string> = {
  imagery: "Imagery",
  terrain: "Terrain",
  climate: "Climate",
  reporting: "Reporting",
  analysis: "Analysis",
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

  if (!showResearch) return null;

  const reference = SITE_PROFILE.referenceCoordinate;

  return (
    <Card id="research-panel" className="research-panel hud-side-panel absolute top-16 right-4 z-10 flex max-h-[calc(100dvh-5rem)] flex-col select-text">
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
            <Metric label="Vertical ref" value={SITE_PROFILE.terrainDatum.verticalReference} />
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
            {reference.precision}. Runway {SITE_PROFILE.runway.designation} is aligned to a
            modeled {SITE_PROFILE.runway.modeledGridBearingDeg} deg grid bearing; modeled
            endpoint uncertainty is about {SITE_PROFILE.runway.endpointUncertaintyM} m.
          </p>
          <p className="text-muted-foreground mt-1 text-[11px] leading-relaxed">
            {SITE_PROFILE.terrainDatum.product}: {SITE_PROFILE.terrainDatum.note}
          </p>
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
            <Metric label="Humidity" value={`${climate.relativeHumidityPct.toFixed(1)}%`} />
            <Metric label="Wind" value={`${climate.windSpeedMps.toFixed(1)} m/s`} />
            <Metric label="Wind from" value={`${climate.windDirectionDeg.toFixed(0)} deg`} />
            <Metric
              label="Precipitation"
              value={`${climate.precipitationMmDay.toFixed(2)} mm/day`}
            />
            <Metric label="Solar" value={`${climate.solarKwhM2Day.toFixed(2)} kWh/m2/day`} />
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
                {coordinate(place.latitude, "N", "S")}, {coordinate(place.longitude, "E", "W")}
              </p>
              <p className="text-muted-foreground mt-1 text-[11px] leading-relaxed">
                {place.note}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                {place.sourceIds.map((sourceId) => {
                  const source = getSource(sourceId);
                  return source ? (
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
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-start gap-1 text-xs font-medium leading-snug hover:text-primary hover:underline"
                  >
                    {source.title}
                    <ExternalLink className="mt-0.5 size-3 shrink-0" />
                  </a>
                  <Badge variant="outline" className="shrink-0">
                    {ROLE_LABELS[source.role]}
                  </Badge>
                </div>
                <p className="text-muted-foreground mt-1 text-[10px]">
                  {source.publisher} / {source.publishedOn}
                </p>
                <p className="text-muted-foreground mt-1 text-[11px] leading-relaxed">
                  {source.attribution}
                </p>
                {"dataUrl" in source && source.dataUrl ? (
                  <a
                    href={source.dataUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-flex items-center gap-1 text-[10px] text-primary hover:underline"
                  >
                    Open data query
                    <ExternalLink className="size-3" />
                  </a>
                ) : null}
              </li>
            ))}
          </ol>
        </section>

        <Separator className="my-4" />

        <section aria-labelledby="limits-heading" className="pb-2">
          <h2
            id="limits-heading"
            className="text-muted-foreground text-[10px] font-semibold tracking-[0.16em] uppercase"
          >
            Interpretation Limits
          </h2>
          <p className="text-muted-foreground mt-2 text-[11px] leading-relaxed">
            This deterministic scene is an interpretive model built from public sources.
            Footprints, heights, functions, parked-aircraft geometry, and terrain detail may
            be generalized. Animated aircraft, vehicle, radar, and windsock movement are
            illustrative scenarios, not observed operating patterns. The app does not
            reproduce restricted imagery or establish claims beyond the linked evidence.
          </p>
        </section>
      </CardContent>
    </Card>
  );
}
