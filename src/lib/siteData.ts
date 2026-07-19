export interface PublicSource {
  id: string;
  title: string;
  publisher: string;
  publishedOn: string;
  accessedOn: string;
  url: string;
  dataUrl?: string;
  role: "imagery" | "terrain" | "climate" | "reporting" | "analysis";
  attribution: string;
}

export const PUBLIC_SOURCES = [
  {
    id: "sentinel-2-scene-2025",
    title: "Sentinel-2 L2A scene T45TXF, 2025-09-28",
    publisher: "Copernicus Data Space Ecosystem",
    publishedOn: "2025-09-28",
    accessedOn: "2026-07-19",
    url: "https://stac.dataspace.copernicus.eu/v1/collections/sentinel-2-l2a/items/S2A_MSIL2A_20250928T050231_N0511_R119_T45TXF_20250928T074723",
    role: "imagery",
    attribution:
      "Contains modified Copernicus Sentinel data (2025). The runway was measured from this public scene; endpoints and width are not an aeronautical survey.",
  },
  {
    id: "sentinel-2-handbook",
    title: "Sentinel-2 User Handbook",
    publisher: "European Space Agency",
    publishedOn: "2015-07-24",
    accessedOn: "2026-07-19",
    url: "https://sentinels.copernicus.eu/documents/247904/685211/Sentinel-2_User_Handbook",
    role: "imagery",
    attribution:
      "Sentinel-2 MSI supplies 10 m visible/NIR, 20 m red-edge/SWIR, and 60 m atmospheric bands. Layout measurements remain interpretations of public imagery.",
  },
  {
    id: "copernicus-dem",
    title: "Copernicus DEM GLO-30",
    publisher: "Copernicus Data Space Ecosystem",
    publishedOn: "2024-07-01",
    accessedOn: "2026-07-19",
    url: "https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM",
    role: "terrain",
    attribution:
      "GLO-30 is a global 30 m digital surface model. Produced using Copernicus WorldDEM-30 (c) DLR e.V. 2010-2014 and (c) Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA; all rights reserved. The approximate reference elevation was sampled near the published runway-center coordinate on 2026-07-19; the rendered terrain is a deterministic proxy, not a redistributed DEM tile.",
  },
  {
    id: "nasa-power-climatology",
    title: "NASA POWER point climatology, 2001-2020",
    publisher: "NASA Langley Research Center",
    publishedOn: "2021-01-01",
    accessedOn: "2026-07-19",
    url: "https://power.larc.nasa.gov/docs/services/api/temporal/climatology/",
    dataUrl:
      "https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=T2M%2CWS10M%2CPRECTOTCORR%2CALLSKY_SFC_SW_DWN%2CRH2M%2CWD10M&community=RE&longitude=89.281218&latitude=40.772521&format=JSON",
    role: "climate",
    attribution:
      "Monthly values are 2001-2020 climatological means from POWER's MERRA-2/SYN1DEG-derived products at the reference point.",
  },
  {
    id: "npr-airfield-expansion",
    title: "Satellite Photos Show China Expanding Its Mysterious Desert Airfield",
    publisher: "NPR, mirrored by KPBS",
    publishedOn: "2021-06-30",
    accessedOn: "2026-07-19",
    url: "https://www.kpbs.org/news/2021/06/30/satellite-photos-show-china-expanding-its",
    role: "reporting",
    attribution:
      "Public reporting describes a roughly three-mile runway and visible facility expansion; building functions remain uncertain.",
  },
  {
    id: "twz-aircraft-2025",
    title: "China's New Tailless Stealth Fighters Both Appear At Secretive Test Base",
    publisher: "The War Zone",
    publishedOn: "2025-11-04",
    accessedOn: "2026-07-19",
    url: "https://www.twz.com/air/chinas-6th-generation-stealth-fighters-both-appear-at-secretive-test-base",
    role: "reporting",
    attribution:
      "Reports Planet imagery observations of aircraft commonly called J-36 and J-XDS on 2025-08-27 and 2025-09-13. Names and capabilities are not official.",
  },
  {
    id: "swf-spacecraft-2026",
    title: "Chinese Reusable Experimental Spacecraft Fact Sheet",
    publisher: "Secure World Foundation",
    publishedOn: "2026-06-12",
    accessedOn: "2026-07-19",
    url: "https://www.swfound.org/publications-and-reports/chinese-reusable-experimental-spacecraft-fact-sheet",
    role: "analysis",
    attribution:
      "Summarizes likely Lop Nur runway landings while separating demonstrated behavior from unsupported speculation.",
  },
  {
    id: "csis-lop-nur-2020",
    title: "Satellite Imagery Analysis of China's Alleged 2020 Nuclear Test at Lop Nur",
    publisher: "CSIS Project on Nuclear Issues",
    publishedOn: "2026-02-13",
    accessedOn: "2026-07-19",
    url: "https://nuclearnetwork.csis.org/satellite-imagery-analysis-of-chinas-alleged-2020-nuclear-test-at-lop-nur/",
    role: "analysis",
    attribution:
      "CSIS found no significant visible change between its March and June 2020 images and no conclusive open-source indicator of a test.",
  },
  {
    id: "lop-nur-test-site-study",
    title: "Nuclear-test preparation at the Lop Nur nuclear test site, 2020-24",
    publisher: "Journal for Peace and Nuclear Disarmament",
    publishedOn: "2025-05-20",
    accessedOn: "2026-07-19",
    url: "https://doi.org/10.1080/10736700.2025.2497201",
    role: "analysis",
    attribution:
      "Provides regional context and approximate coordinates for the Northern Tunnel Test Area, which is about 127 km from the airfield reference point.",
  },
] as const satisfies readonly PublicSource[];

export type SourceId = (typeof PUBLIC_SOURCES)[number]["id"];
export type EvidenceStatus =
  | "observed"
  | "reported"
  | "interpreted"
  | "illustrative";
export type EvidenceConfidence = "low" | "medium" | "high";

export interface Evidence {
  status: EvidenceStatus;
  confidence: EvidenceConfidence;
  sourceIds: readonly SourceId[];
  observedOn?: string;
  resolutionM?: number;
  method?: string;
  uncertainty?: string;
  note: string;
}

export const EVIDENCE_LABELS: Record<EvidenceStatus, string> = {
  observed: "Observed",
  reported: "Public reporting",
  interpreted: "Interpreted",
  illustrative: "Illustrative",
};

const SOURCE_INDEX = new Map<SourceId, (typeof PUBLIC_SOURCES)[number]>(
  PUBLIC_SOURCES.map((source) => [source.id, source]),
);

export function getSource(id: SourceId) {
  return SOURCE_INDEX.get(id);
}

export interface ClimateMonth {
  month: string;
  temperatureC: number;
  relativeHumidityPct: number;
  precipitationMmDay: number;
  solarKwhM2Day: number;
  windSpeedMps: number;
  windDirectionDeg: number;
}

export const CLIMATE_MONTHS: readonly ClimateMonth[] = [
  { month: "January", temperatureC: -7.48, relativeHumidityPct: 55.87, precipitationMmDay: 0.03, solarKwhM2Day: 2.5846, windSpeedMps: 3.32, windDirectionDeg: 11.4 },
  { month: "February", temperatureC: -2.16, relativeHumidityPct: 42.33, precipitationMmDay: 0.02, solarKwhM2Day: 3.6336, windSpeedMps: 4.03, windDirectionDeg: 18.9 },
  { month: "March", temperatureC: 5.96, relativeHumidityPct: 26.3, precipitationMmDay: 0.02, solarKwhM2Day: 4.9224, windSpeedMps: 4.94, windDirectionDeg: 23.5 },
  { month: "April", temperatureC: 14.05, relativeHumidityPct: 22.82, precipitationMmDay: 0.1, solarKwhM2Day: 6.0727, windSpeedMps: 5.74, windDirectionDeg: 25.8 },
  { month: "May", temperatureC: 20.28, relativeHumidityPct: 21.71, precipitationMmDay: 0.14, solarKwhM2Day: 7.0913, windSpeedMps: 5.7, windDirectionDeg: 27.3 },
  { month: "June", temperatureC: 26.12, relativeHumidityPct: 23.91, precipitationMmDay: 0.28, solarKwhM2Day: 7.2715, windSpeedMps: 5.24, windDirectionDeg: 25.2 },
  { month: "July", temperatureC: 28.71, relativeHumidityPct: 23.68, precipitationMmDay: 0.24, solarKwhM2Day: 6.9874, windSpeedMps: 4.98, windDirectionDeg: 27.1 },
  { month: "August", temperatureC: 27.38, relativeHumidityPct: 22.44, precipitationMmDay: 0.15, solarKwhM2Day: 6.4867, windSpeedMps: 5.15, windDirectionDeg: 32.8 },
  { month: "September", temperatureC: 20.86, relativeHumidityPct: 23.42, precipitationMmDay: 0.06, solarKwhM2Day: 5.5601, windSpeedMps: 4.98, windDirectionDeg: 27.9 },
  { month: "October", temperatureC: 11.87, relativeHumidityPct: 27.61, precipitationMmDay: 0.06, solarKwhM2Day: 4.237, windSpeedMps: 4.46, windDirectionDeg: 11.6 },
  { month: "November", temperatureC: 2.23, relativeHumidityPct: 40.25, precipitationMmDay: 0.03, solarKwhM2Day: 2.9314, windSpeedMps: 3.89, windDirectionDeg: 357.2 },
  { month: "December", temperatureC: -5.77, relativeHumidityPct: 53.73, precipitationMmDay: 0.03, solarKwhM2Day: 2.287, windSpeedMps: 3.36, windDirectionDeg: 6.8 },
];

export function getClimateMonth(index: number): ClimateMonth {
  const normalized = ((Math.round(index) % 12) + 12) % 12;
  return CLIMATE_MONTHS[normalized] ?? CLIMATE_MONTHS[5]!;
}

export function climateDustFactor(profile: ClimateMonth): number {
  const aridity = 1 - Math.min(1, profile.relativeHumidityPct / 70);
  const wind = Math.min(1, Math.max(0, (profile.windSpeedMps - 3) / 3));
  const rainSuppression = Math.min(1, profile.precipitationMmDay / 0.35);
  return Math.min(1, Math.max(0.25, aridity * 0.65 + wind * 0.3 - rainSuppression * 0.15));
}

export const SITE_PROFILE = {
  name: "Lop Nur test airfield",
  referenceCoordinate: {
    latitude: 40.772521,
    longitude: 89.281218,
    precision: "Public-imagery runway center",
  },
  localCrs: {
    code: "EPSG:32645",
    name: "WGS 84 / UTM zone 45N",
    runwayCenterEastingM: 692_519.6,
    runwayCenterNorthingM: 4_516_008.8,
  },
  terrainDatum: {
    elevationM: 981,
    verticalReference: "EGM2008 orthometric height",
    product: "Copernicus DEM GLO-30",
    note:
      "Approximate public DEM sample near the runway center; the rendered heightfield is a deterministic proxy around this datum, not a redistributed DEM tile.",
  },
  worldExtentM: 6800,
  runway: {
    designation: "05/23",
    modeledLengthM: 5000,
    modeledWidthM: 60,
    modeledGridBearingDeg: 46,
    endpointUncertaintyM: 40,
  },
  climatePeriod: "2001-2020",
} as const;

export const OFFSITE_CONTEXT = [
  {
    id: "northern-tunnel-test-area",
    name: "Northern Tunnel Test Area",
    latitude: 41.7051,
    longitude: 88.3751,
    distanceFromAirfieldKm: 127,
    sourceIds: ["lop-nur-test-site-study", "csis-lop-nur-2020"] as const satisfies readonly SourceId[],
    note:
      "Regional context only. It is not rendered inside the 6.8 km airfield scene, and this project does not claim an exact reconstruction of the remote tunnel complex.",
  },
] as const;
