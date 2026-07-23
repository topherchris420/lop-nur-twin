import { SITE_PROFILE } from "./siteData";
import {
  MISSION_SITE_ID,
  RUNWAY_CENTER,
  type MissionEntityDef,
} from "./layout";

/**
 * Live ADS-B traffic over the airfield, pulled from ADSB.lol's open API.
 *
 * This is the project's one deliberate exception to the "no runtime
 * downloads" rule (see AGENTS.md): the site model itself stays procedural and
 * deterministic, but aircraft positions are, by definition, live external
 * data. Nothing here is cached to disk and a failed fetch simply leaves the
 * previous frame's traffic in place.
 */

/** A parsed aircraft, reduced to the fields the scene needs. */
export interface Aircraft {
  /** ICAO 24-bit address, unique and stable — used as the React key. */
  hex: string;
  /** Callsign/flight number, trimmed; falls back to the hex when absent. */
  callsign: string;
  lat: number;
  lon: number;
  /** Barometric (or geometric) altitude in feet; 0 while on the ground. */
  altFeet: number;
  /** True track over ground in degrees (0 = north, clockwise); 0 if unknown. */
  track: number;
  /** True for state/military aircraft, from `mil` or the dbFlags bit-0 flag. */
  military: boolean;
  /** Feed-reported age of the last position in seconds; null when omitted. */
  seenSecondsAgo: number | null;
  /** Absolute feed snapshot time, sourced from the response body/header when available. */
  observedAt: string | null;
}

export function getLiveTrafficMissionEntityId(hex: string): string {
  return `live-aircraft-${hex.toLowerCase()}`;
}

/** Build the ephemeral mission record that travels with a live render entity. */
export function createLiveTrafficMissionEntity(aircraft: Aircraft): MissionEntityDef {
  return {
    id: getLiveTrafficMissionEntityId(aircraft.hex),
    kind: "aircraft",
    label: aircraft.callsign,
    observation: {
      timestamp: aircraft.observedAt,
      timestampKind: "live-feed",
      status: "reported",
      confidence: "low",
      sourceIds: ["adsb-lol-live"],
      note:
        aircraft.seenSecondsAgo === null
          ? "Ephemeral ADSB.lol position report; identity, position, altitude, classification, and source age are unverified live-feed fields."
          : `Ephemeral ADSB.lol position report, feed-reported position age ${aircraft.seenSecondsAgo.toFixed(1)} s; identity, position, altitude, and classification remain unverified.`,
    },
    capabilities: ["telemetry-position"],
    relationships: [{ kind: "part-of", targetId: MISSION_SITE_ID }],
    taskableBehaviors: [
      {
        id: "track-live-position",
        label: "Track reported position",
        execution: "reactive",
      },
    ],
  };
}

/** Reference point of the local grid: the modeled runway center. */
const REF_LAT = SITE_PROFILE.referenceCoordinate.latitude;
const REF_LON = SITE_PROFILE.referenceCoordinate.longitude;

const METERS_PER_DEGREE = 111_320;
const FEET_TO_METERS = 0.3048;
const cosLat = Math.cos(REF_LAT * (Math.PI / 180));

/**
 * Map a global (lat, lon, altitude-ft) position into the scene's local metric
 * grid (`+x` east, `+z` south, `y` up), returning `[x, y, z]`.
 *
 * The reference coordinate is the runway center, which lives at
 * `RUNWAY_CENTER` in the local frame rather than the origin, so the equirect-
 * angular offset from the reference point is added onto `RUNWAY_CENTER`. This
 * keeps live aircraft registered to the modeled runway they overfly.
 */
export function gpsTo3DCanvas(
  planeLat: number,
  planeLon: number,
  planeAltFeet: number | string | null | undefined,
): [number, number, number] {
  const x = (planeLon - REF_LON) * METERS_PER_DEGREE * cosLat + RUNWAY_CENTER[0];
  const z = (REF_LAT - planeLat) * METERS_PER_DEGREE + RUNWAY_CENTER[1];
  const y =
    (typeof planeAltFeet === "number" ? planeAltFeet : 0) * FEET_TO_METERS;
  return [x, y, z];
}

/** ADSB.lol `/v2` response shape, kept loose — every field is optional. */
interface AdsbAircraftRaw {
  hex?: string;
  flight?: string;
  lat?: number;
  lon?: number;
  /** number of feet, or the literal string "ground". */
  alt_baro?: number | "ground";
  alt_geom?: number;
  track?: number;
  /** Seconds since the latest position update, supplied by the feed. */
  seen_pos?: number;
  seen?: number;
  /** ADSB.lol sets this to 1 for military aircraft. */
  mil?: boolean;
  /** Bitfield; bit 0 (value 1) marks military in the ADSB.lol database. */
  dbFlags?: number;
}

interface AdsbResponse {
  /** Feed snapshot epoch, supplied in seconds or milliseconds depending on backend version. */
  now?: number;
  ac?: AdsbAircraftRaw[];
}

function parseSnapshotObservedAt(data: AdsbResponse, response: Response): string | null {
  const epoch = data.now;
  if (typeof epoch === "number" && Number.isFinite(epoch) && epoch > 0) {
    const date = new Date(epoch < 1_000_000_000_000 ? epoch * 1000 : epoch);
    if (Number.isFinite(date.getTime())) return date.toISOString();
  }
  const responseDate = response.headers.get("date");
  if (responseDate !== null) {
    const date = new Date(responseDate);
    if (Number.isFinite(date.getTime())) return date.toISOString();
  }
  return null;
}

/** Coerce `alt_baro`/`alt_geom` to feet; the string "ground" becomes 0. */
function parseAltitude(raw: AdsbAircraftRaw): number {
  const baro = raw.alt_baro;
  if (typeof baro === "number") return baro;
  if (typeof raw.alt_geom === "number") return raw.alt_geom;
  // "ground" (or missing) → sit on the deck.
  return 0;
}

function isMilitary(raw: AdsbAircraftRaw): boolean {
  if (raw.mil === true) return true;
  return typeof raw.dbFlags === "number" && (raw.dbFlags & 1) === 1;
}

/** ADSB.lol open API, centered on the airfield reference point (150 nm). */
export const ADSB_ENDPOINT =
  "https://api.adsb.lol/v2/lat/40.77/lon/89.28/dist/150";

/**
 * Fetch and parse the current traffic snapshot. Aircraft without a usable
 * position or hex are dropped. Throws on network/parse failure so the caller
 * can decide whether to keep the last good snapshot.
 */
export async function fetchAircraft(signal?: AbortSignal): Promise<Aircraft[]> {
  const res = await fetch(ADSB_ENDPOINT, {
    signal,
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`ADSB.lol responded ${res.status}`);
  const data = (await res.json()) as AdsbResponse;
  const list = Array.isArray(data.ac) ? data.ac : [];
  const observedAt = parseSnapshotObservedAt(data, res);

  const out: Aircraft[] = [];
  for (const raw of list) {
    if (
      typeof raw.hex !== "string" ||
      typeof raw.lat !== "number" ||
      typeof raw.lon !== "number"
    ) {
      continue;
    }
    const callsign =
      typeof raw.flight === "string" && raw.flight.trim().length > 0
        ? raw.flight.trim()
        : raw.hex.toUpperCase();
    out.push({
      hex: raw.hex,
      callsign,
      lat: raw.lat,
      lon: raw.lon,
      altFeet: parseAltitude(raw),
      track: typeof raw.track === "number" ? raw.track : 0,
      military: isMilitary(raw),
      seenSecondsAgo:
        typeof raw.seen_pos === "number"
          ? raw.seen_pos
          : typeof raw.seen === "number"
            ? raw.seen
            : null,
      observedAt,
    });
  }
  return out;
}
