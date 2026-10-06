/**
 * Natural-language scenario telemetry → typed, bounded simulation events.
 *
 * This is a deterministic rule compiler, not a language model. It recognises
 * event families by vocabulary and places by a gazetteer built only from the
 * real OSM data (street names, intersections, named buildings, parks,
 * storefronts, monuments). Anything it cannot resolve fails visibly; it never
 * guesses a location for a place name it does not know.
 *
 * An event says *what happened where*. What the world does about it is not
 * scripted here: `EVENT_EFFECTS` declares generic effects (an area to avoid,
 * something to look at, closed edges, a reason to shelter, units to send), and
 * the agents' ordinary rules respond to effects, not to event names.
 */
import { EVENT_KINDS, type EventKind } from "./contract";
import {
  buildings,
  distance,
  inBounds,
  lerp,
  metro,
  parks,
  pathWays,
  places,
  rescue,
  roadWays,
  row,
  type Point,
} from "./model";
import { roads } from "./network";
import { construction, monuments, storefronts } from "./streetscape";
import { groundAt } from "./terrain";

export type Intensity = 1 | 2 | 3;
export interface Scenario {
  kind: EventKind;
  point: Point;
  radius: number;
  durationTicks: number;
  intensity: Intensity;
  label: string;
  /** The resolved place, as the gazetteer named it. */
  place: string;
  /** A real OSM street name, for closures along a street. */
  street?: string;
  /** Road-graph node IDs a procession follows, in order. */
  route?: string[];
  /** Flood water surface in the rendering datum (DTM metres − 100). */
  level?: number;
}
export interface CityEvent extends Scenario {
  id: number;
  startTick: number;
  /** Where the event currently is (moves with a procession). */
  at: Point;
}

export interface Effects {
  /** Agents avoid this area; radius multiplier. */
  avoid: number;
  /** Agents may look at it from up to this many metres beyond its radius. */
  attract: number;
  closesRoads: "radius" | "street" | "flood" | "procession" | null;
  /** Fraction of the radius whose roads close, under a `radius` closure. */
  roadRadius: number;
  /** Fraction of the radius whose sidewalks close. */
  closesWalks: number;
  /**
   * Agents drawn to it join a crowd — gathering, or watching as spectators —
   * rather than recording it or watching from a distance.
   */
  gathers: boolean;
  shelter: boolean;
  slowdown: number;
  signalsDark: boolean;
  metroClosed: boolean;
  dispatch: (i: Intensity) => { engine: number; ambulance: number; police: number };
}
const none = () => ({ engine: 0, ambulance: 0, police: 0 });
export const EVENT_EFFECTS: Record<EventKind, Effects> = {
  fire: {
    avoid: 1.6,
    attract: 140,
    closesRoads: "radius",
    roadRadius: 1,
    closesWalks: 0.8,
    gathers: false,
    shelter: false,
    slowdown: 1,
    signalsDark: false,
    metroClosed: false,
    // Three engines are modelled at the station; a request never exceeds them.
    dispatch: (i) => ({ engine: i > 1 ? 3 : 2, ambulance: i > 1 ? 1 : 0, police: 1 }),
  },
  storm: {
    avoid: 0,
    attract: 0,
    closesRoads: null,
    roadRadius: 1,
    closesWalks: 0,
    gathers: false,
    shelter: true,
    slowdown: 0.65,
    signalsDark: false,
    metroClosed: false,
    dispatch: none,
  },
  "metro-closure": {
    avoid: 0,
    attract: 40,
    closesRoads: null,
    roadRadius: 1,
    closesWalks: 0,
    gathers: false,
    shelter: false,
    slowdown: 1,
    signalsDark: false,
    metroClosed: true,
    dispatch: (i) => ({ engine: 0, ambulance: 0, police: i > 2 ? 1 : 0 }),
  },
  parade: {
    avoid: 0,
    attract: 70,
    closesRoads: "procession",
    roadRadius: 1,
    closesWalks: 0,
    gathers: true,
    shelter: false,
    slowdown: 1,
    signalsDark: false,
    metroClosed: false,
    dispatch: () => ({ engine: 0, ambulance: 0, police: 2 }),
  },
  object: {
    avoid: 0,
    attract: 260,
    closesRoads: null,
    roadRadius: 1,
    closesWalks: 0,
    gathers: false,
    shelter: false,
    slowdown: 0.85,
    signalsDark: false,
    metroClosed: false,
    dispatch: (i) => ({ engine: 0, ambulance: 0, police: i }),
  },
  crash: {
    avoid: 1.2,
    attract: 70,
    closesRoads: "radius",
    roadRadius: 1,
    closesWalks: 0,
    gathers: false,
    shelter: false,
    slowdown: 1,
    signalsDark: false,
    metroClosed: false,
    dispatch: (i) => ({ engine: i > 2 ? 1 : 0, ambulance: 1, police: 1 }),
  },
  outage: {
    avoid: 0,
    attract: 0,
    closesRoads: null,
    roadRadius: 1,
    closesWalks: 0,
    gathers: false,
    shelter: false,
    slowdown: 0.9,
    signalsDark: true,
    metroClosed: false,
    dispatch: (i) => ({ engine: 0, ambulance: 0, police: i > 1 ? 1 : 0 }),
  },
  "gas-leak": {
    avoid: 1.5,
    attract: 30,
    closesRoads: "radius",
    roadRadius: 1,
    closesWalks: 1,
    gathers: false,
    shelter: false,
    slowdown: 1,
    signalsDark: false,
    metroClosed: false,
    dispatch: (i) => ({ engine: i > 2 ? 2 : 1, ambulance: 0, police: i > 1 ? 2 : 1 }),
  },
  rally: {
    avoid: 0,
    attract: 90,
    closesRoads: "radius",
    roadRadius: 0.8,
    closesWalks: 0,
    gathers: true,
    shelter: false,
    slowdown: 1,
    signalsDark: false,
    metroClosed: false,
    dispatch: (i) => ({ engine: 0, ambulance: 0, police: i > 1 ? 2 : 1 }),
  },
  festival: {
    avoid: 0,
    attract: 110,
    closesRoads: "radius",
    roadRadius: 0.8,
    closesWalks: 0,
    gathers: true,
    shelter: false,
    slowdown: 1,
    signalsDark: false,
    metroClosed: false,
    dispatch: (i) => ({ engine: 0, ambulance: 0, police: i > 2 ? 1 : 0 }),
  },
  "road-closure": {
    avoid: 0,
    attract: 0,
    closesRoads: "street",
    roadRadius: 1,
    closesWalks: 0,
    gathers: false,
    shelter: false,
    slowdown: 1,
    signalsDark: false,
    metroClosed: false,
    dispatch: none,
  },
  flood: {
    avoid: 1,
    attract: 60,
    closesRoads: "flood",
    roadRadius: 1,
    closesWalks: 1,
    gathers: false,
    shelter: false,
    slowdown: 0.8,
    signalsDark: false,
    metroClosed: false,
    dispatch: (i) => ({ engine: i > 1 ? 1 : 0, ambulance: 0, police: 1 }),
  },
};

/** Ticks per simulated minute at the fixed 0.1 s step. */
const MINUTE = 600;
const MAX_TICKS = 10 * MINUTE;
const RADII: Record<EventKind, [number, number, number]> = {
  fire: [22, 32, 48],
  storm: [700, 700, 700],
  "metro-closure": [90, 90, 90],
  parade: [20, 20, 20],
  object: [90, 120, 160],
  crash: [12, 18, 26],
  outage: [150, 250, 400],
  "gas-leak": [40, 60, 90],
  rally: [30, 45, 70],
  festival: [40, 60, 90],
  "road-closure": [60, 120, 250],
  flood: [120, 180, 260],
};
const DURATION: Record<EventKind, number> = {
  fire: 4 * MINUTE,
  storm: 3 * MINUTE,
  "metro-closure": 2 * MINUTE,
  parade: 10 * MINUTE,
  object: 2 * MINUTE,
  crash: 3 * MINUTE,
  outage: 3 * MINUTE,
  "gas-leak": 4 * MINUTE,
  rally: 3 * MINUTE,
  festival: 5 * MINUTE,
  "road-closure": 5 * MINUTE,
  flood: 4 * MINUTE,
};
export const LABELS: Record<EventKind, string> = {
  fire: "Fire",
  storm: "Thunderstorm",
  "metro-closure": "Metro closure",
  parade: "Parade",
  object: "Unidentified object",
  crash: "Vehicle collision",
  outage: "Power outage",
  "gas-leak": "Gas leak",
  rally: "Rally",
  festival: "Street festival",
  "road-closure": "Road closure",
  flood: "Flash flooding",
};
/** Procession speed (m/s) and body length (m) by intensity. */
export const PROCESSION = { speed: 1.3, body: [60, 110, 170] as const };

// ---------------------------------------------------------------------------
// Gazetteer
// ---------------------------------------------------------------------------
const WORDS: Record<string, string> = {
  ave: "avenue",
  av: "avenue",
  st: "street",
  rd: "road",
  ln: "lane",
  blvd: "boulevard",
  dr: "drive",
  hwy: "highway",
  pkwy: "parkway",
  ct: "court",
  pl: "place",
  theater: "theatre",
  womens: "women's",
  veterans: "veteran's",
};
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\bst\.?\s+elmo\b/g, "saint elmo")
    .replace(/[^a-z0-9'&\- ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => WORDS[w] ?? w)
    .join(" ");
}
export type PlaceKind =
  | "street"
  | "intersection"
  | "building"
  | "park"
  | "landmark"
  | "metro"
  | "monument"
  | "storefront"
  | "construction"
  | "trail";
export interface Place {
  name: string;
  kind: PlaceKind;
  point: Point;
  street?: string;
  /** Multi-word and distinctive aliases may match without a preposition. */
  strong: boolean;
}
const GENERIC = new Set([
  "bethesda",
  "downtown",
  "downtown bethesda",
  "town",
  "the city",
  "city",
  "the area",
  "area",
  "here",
  "maryland",
  "bethesda maryland",
  "the sky",
  "sky",
  "the street",
  "the streets",
  "everywhere",
  "the neighborhood",
  "neighborhood",
]);
const NOT_PLACES =
  /^(?:a |the |an )?(?:\d+|few|several|minute|minutes|hour|hours|second|seconds|moment|moments|morning|afternoon|evening|night|noon|rush hour|while|hurry|time|now|front|middle|progress|response|panic|silence|daylight|broad daylight|seconds)\b/;
const centroid = (pts: Point[]) => ({
  x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
  z: pts.reduce((s, p) => s + p.z, 0) / pts.length,
});
const downtown = places.find((p) => p.name === "Downtown Bethesda")?.point ?? {
  x: 0,
  z: 0,
};
function streetAnchor(name: string): Point | undefined {
  let best: Point | undefined,
    d = Infinity;
  for (const w of roadWays)
    if (w.name === name)
      for (const p of w.points) {
        const q = distance(p, downtown);
        if (q < d) {
          d = q;
          best = p;
        }
      }
  return best;
}
let cache: Map<string, Place> | null = null;
export function gazetteer(): Map<string, Place> {
  if (cache) return cache;
  const g = new Map<string, Place>();
  const add = (alias: string, place: Place) => {
    const key = normalize(alias);
    if (key.length < 3 || GENERIC.has(key) || g.has(key)) return;
    g.set(key, place);
  };
  // Explicit aliases first: each points at a real mapped feature, never a guess.
  const building = (name: string) => {
    const matches = buildings.filter((b) => b.name === name);
    if (!matches.length) return undefined;
    const b = matches.reduce((a, c) => (c.ring.length > a.ring.length ? c : a));
    return b.center;
  };
  const metroPlace: Place = {
    name: "Bethesda Metro (Red Line) entrance",
    kind: "metro",
    point: metro.point,
    strong: true,
  };
  for (const a of [
    "metro",
    "the metro",
    "metro station",
    "the metro station",
    "bethesda metro",
    "bethesda metro station",
    "bethesda station",
    "red line",
    "subway",
    "subway station",
  ])
    add(a, metroPlace);
  const rowPlace: Place = {
    name: "Bethesda Row",
    kind: "landmark",
    point: row.point,
    strong: true,
  };
  for (const a of ["bethesda row", "the row"]) add(a, rowPlace);
  const named: [string[], string][] = [
    [
      ["farm women's market", "farmers market", "the farmers market", "farm market"],
      "Montgomery Farm Women’s Co-operative Market",
    ],
    [["library", "the library", "bethesda library"], "Bethesda Regional Library"],
    [["post office", "the post office"], "Bethesda Post Office"],
    [
      ["marriott", "marriott headquarters", "marriott hq"],
      "Marriott International Headquarters",
    ],
    [["hyatt", "the hyatt"], "Hyatt Regency Bethesda"],
    [["metro center", "bethesda metro center"], "Bethesda Metro Center"],
  ];
  for (const [aliases, name] of named) {
    const p = building(name);
    if (p)
      for (const a of aliases)
        add(a, { name, kind: "building", point: p, strong: a.includes(" ") });
  }
  const rescuePlace: Place = {
    name: "Bethesda-Chevy Chase Rescue Squad",
    kind: "building",
    point: rescue.point,
    strong: true,
  };
  for (const a of [
    "rescue squad",
    "the rescue squad",
    "fire station",
    "the fire station",
  ])
    add(a, rescuePlace);
  const purple = construction.filter((c) => c.kind === "rail").flatMap((c) => c.points);
  if (purple.length) {
    const p: Place = {
      name: "Purple Line construction",
      kind: "construction",
      point: centroid(purple),
      strong: true,
    };
    for (const a of ["purple line", "the purple line", "purple line construction"])
      add(a, p);
  }
  for (const trail of ["Capital Crescent Trail", "Bethesda Trolley Trail"]) {
    const pts = pathWays.filter((w) => w.name === trail).flatMap((w) => w.points);
    if (pts.length) {
      const p: Place = { name: trail, kind: "trail", point: centroid(pts), strong: true };
      add(trail, p);
      add(trail.replace(/ Trail$/, " trail").replace(/^Capital /, ""), p);
    }
  }
  for (const m of monuments)
    if (m.name) {
      const p: Place = {
        name: m.name,
        kind: "monument",
        point: m.point,
        strong: m.name.includes(" "),
      };
      add(m.name, p);
      if (m.name === "Madonna of the Trail")
        for (const a of ["madonna", "the madonna", "madonna statue"]) add(a, p);
    }
  for (const p of places)
    if (p.kind === "landmark" && p.name && p.name !== "Bethesda")
      add(p.name, { name: p.name, kind: "landmark", point: p.point, strong: true });
  for (const p of parks) {
    const place: Place = {
      name: p.name,
      kind: "park",
      point: centroid(p.ring),
      strong: true,
    };
    add(p.name, place);
    add(p.name.replace(/ Urban Park$/, " Park"), place);
    add(p.name.replace(/ Urban Park$/, ""), place);
  }
  // Streets: the full name, and the bare name where it is unambiguous.
  const streets = [...new Set(roadWays.map((w) => w.name).filter(Boolean))];
  const bare = new Map<string, string[]>();
  for (const s of streets) {
    const anchor = streetAnchor(s);
    if (!anchor) continue;
    add(s, { name: s, kind: "street", point: anchor, street: s, strong: true });
    const short = normalize(s).replace(
      / (avenue|street|road|lane|boulevard|drive|highway|parkway|court|place)$/,
      "",
    );
    if (short !== normalize(s)) bare.set(short, [...(bare.get(short) ?? []), s]);
  }
  for (const [short, names] of bare)
    if (names.length === 1 && !GENERIC.has(short) && !/^\d/.test(short))
      add(short, {
        name: names[0]!,
        kind: "street",
        point: streetAnchor(names[0]!)!,
        street: names[0]!,
        strong: short.includes(" ") || short.length > 6,
      });
  // Named buildings, then storefront name tags. Single words need a preposition.
  for (const b of buildings)
    if (b.name)
      add(b.name, {
        name: b.name,
        kind: "building",
        point: b.center,
        strong: b.name.includes(" "),
      });
  for (const s of storefronts)
    add(s.name, { name: s.name, kind: "storefront", point: s.point, strong: false });
  cache = g;
  return g;
}
const PREPOSITION =
  /\b(?:near|at|on|in|above|over|along|by|outside|around|across|behind|beside|next to|in front of|from|down|up|through|throughout|inside|close to|opposite|toward|towards|into|onto|under)\s+(?:the\s+)?/g;
interface Match {
  place: Place;
  start: number;
  end: number;
}
function longestAt(text: string, start: number, g: Map<string, Place>): Match | null {
  const words = text.slice(start).split(" ");
  for (let n = Math.min(7, words.length); n >= 1; n--) {
    const key = words.slice(0, n).join(" ");
    const place = g.get(key) ?? g.get("the " + key);
    if (place) return { place, start, end: start + key.length };
  }
  return null;
}
/** Two streets that share a mapped node, or come within 25 m of each other. */
export function intersection(a: string, b: string): Point | undefined {
  const na = roadWays.filter((w) => w.name === a),
    nb = roadWays.filter((w) => w.name === b);
  const ids = new Set(na.flatMap((w) => w.nodeIds));
  for (const w of nb)
    for (let i = 0; i < w.nodeIds.length; i++)
      if (ids.has(w.nodeIds[i]!)) return w.points[i];
  let best: Point | undefined,
    d = 25;
  for (const p of na.flatMap((w) => w.points))
    for (const q of nb.flatMap((w) => w.points))
      if (distance(p, q) < d) {
        d = distance(p, q);
        best = lerp(p, q, 0.5);
      }
  return best;
}
export interface Resolution {
  place: Place | null;
  /** A place-like phrase that the gazetteer could not resolve. */
  unknown: string | null;
  /** A street named anywhere in the phrase, even when a more specific place anchors it. */
  street: string | null;
}
export function resolvePlace(text: string): Resolution {
  const g = gazetteer(),
    t = normalize(text);
  let unknown: string | null = null;
  const found: Match[] = [];
  for (const m of t.matchAll(PREPOSITION)) {
    const start = m.index + m[0].length;
    const hit = longestAt(t, start, g);
    if (hit) {
      found.push(hit);
      continue;
    }
    const rest = t.slice(start);
    const generic = [...GENERIC].some((w) => rest === w || rest.startsWith(w + " "));
    if (!generic && !NOT_PLACES.test(rest) && rest.length) {
      // The original casing tells a proper noun ("in Paris") from prose ("in panic").
      const original = text.replace(/[’‘]/g, "'");
      const head = rest.split(" ").slice(0, 3).join(" ");
      const re = new RegExp(
        "\\b" + head.split(" ")[0]!.replace(/[^a-z0-9]/g, "") + "\\b",
        "i",
      );
      const at = original.search(re);
      const capital = at >= 0 && /[A-Z]/.test(original[at]!);
      const lower = text === text.toLowerCase();
      if ((capital || lower) && !unknown) unknown = head;
    }
  }
  if (!found.length) {
    // Strong aliases may appear without a preposition ("The Metro station closes").
    for (let i = 0; i < t.length; i = t.indexOf(" ", i) + 1 || t.length) {
      const hit = longestAt(t, i, g);
      if (hit && hit.place.strong) {
        found.push(hit);
        break;
      }
    }
  }
  if (!found.length) return { place: null, unknown, street: null };
  // "X and Y" after a resolved street: try the intersection.
  const first = found[0]!;
  let street = found.find((f) => f.place.kind === "street")?.place.street ?? null;
  if (!street)
    // "Close Woodmont Avenue near the Row": a street named without a preposition.
    for (let i = 0; i < t.length && !street; i = t.indexOf(" ", i) + 1 || t.length) {
      const hit = longestAt(t, i, g);
      if (hit?.place.kind === "street" && hit.place.strong) street = hit.place.street!;
    }
  if (first.place.kind === "street") {
    const tail = t.slice(first.end).match(/^\s+(?:and|&|at|\/)\s+(?:the\s+)?(.*)$/);
    if (tail) {
      const other = longestAt(tail[1]!, 0, g);
      if (other?.place.kind === "street" && other.place.street !== first.place.street) {
        const p = intersection(first.place.street!, other.place.street!);
        if (p)
          return {
            place: {
              name: `${first.place.name} & ${other.place.name}`,
              kind: "intersection",
              point: p,
              street: first.place.street,
              strong: true,
            },
            unknown: null,
            street,
          };
      }
    }
  }
  // "On Woodmont Avenue near the library": the specific place anchors the
  // event; the street is kept for closures and processions along it.
  const specific = found.find((f) => f.place.kind !== "street");
  return { place: (specific ?? first).place, unknown: null, street };
}

// ---------------------------------------------------------------------------
// Event vocabulary
// ---------------------------------------------------------------------------
/** Ordered: the first family to claim a phrase wins it. */
const VOCABULARY: [EventKind, RegExp][] = [
  [
    "outage",
    /\b(?:power (?:outage|cut|failure)|blackout|lights? (?:go|went|are) out|signals? (?:go|went|are)? ?(?:out|dark|down)|traffic lights? (?:fail|out|down|go dark)|electricity)/,
  ],
  [
    "metro-closure",
    /\b(?:metro|subway|red line|station)\b[^.]*\b(?:clos(?:e|es|ed|ing|ure)\b(?! to)|shut|suspend|evacuat|halt|stop)|\b(?:clos(?:e|es|ed|ing|ure)\b(?! to)|shut|suspend)\w*\b[^.]*\b(?:metro|subway|red line)\b/,
  ],
  [
    "gas-leak",
    /\b(?:gas leak|smell of gas|smells? like gas|chemical spill|hazmat|toxic|suspicious package|leak)/,
  ],
  ["flood", /\b(?:flood|flooding|flooded|inundat|water main)/],
  [
    "crash",
    /\b(?:crash|collision|accident|wreck|pile-?up|fender bender|collide|car hits)/,
  ],
  ["fire", /\b(?:fire|blaze|burning|flames?|on fire|explosion|explodes|smoke)\b/],
  [
    "storm",
    /\b(?:thunderstorm|storm|downpour|heavy rain|rain|hail|lightning|thunder|tornado|hurricane|squall|deluge|cloudburst)/,
  ],
  [
    "parade",
    /\b(?:parade|procession|marching band|motorcade|marathon|fun run|5k|10k|race)\b/,
  ],
  [
    "object",
    /\b(?:ufo|u\.f\.o|unidentified|strange (?:\w+ )?object|alien|spaceship|spacecraft|flying saucer|saucer|mothership|orb|meteor|monolith|anomal)/,
  ],
  [
    "rally",
    /\b(?:rally|protest|demonstration|march|vigil|crowd gathers|flash mob|sit-in|strike)\b/,
  ],
  [
    "festival",
    /\b(?:festival|street fair|block party|concert|fair|celebration|farmers market opens|market day|carnival|street party|art walk)\b/,
  ],
  [
    "road-closure",
    /\b(?:road ?work|lane closure|closed|closes|closure|blocked|sinkhole|detour|construction|shut down|shut|close(?! to))\b/,
  ],
];
const MAJOR =
  /\b(?:huge|massive|major|large|severe|enormous|giant|catastrophic|violent|multi-alarm|three-alarm|four-alarm|big|serious|intense|giant|gigantic)\b/;
const MINOR = /\b(?:small|minor|little|brief|tiny|light|slight|short)\b/;
export interface Compiled {
  events: Scenario[];
  notes: string[];
  error: string | null;
}
/**
 * A procession path along one named street: the longest walk through that
 * street's own mapped edges, then trimmed to the ~650 m centred on the anchor so
 * a procession completes inside the event cap.
 */
function streetRoute(street: string, anchor: Point): string[] | undefined {
  // Undirected adjacency restricted to the named street's own road edges.
  const adjacency = new Map<string, string[]>();
  for (const e of roads.edges)
    if (e.name === street) {
      adjacency.set(e.from, [...(adjacency.get(e.from) ?? []), e.to]);
      adjacency.set(e.to, [...(adjacency.get(e.to) ?? []), e.from]);
    }
  const ids = [...adjacency.keys()].sort();
  if (ids.length < 3) return undefined;
  const p = (id: string) => roads.nodes.get(id)!;
  const spread = (a: string) => {
    const parent = new Map<string, string>([[a, a]]),
      queue = [a];
    for (let i = 0; i < queue.length; i++)
      for (const n of adjacency.get(queue[i]!) ?? [])
        if (!parent.has(n)) {
          parent.set(n, queue[i]!);
          queue.push(n);
        }
    let far = a;
    for (const n of parent.keys())
      if (distance(p(n), p(a)) > distance(p(far), p(a))) far = n;
    return { parent, far };
  };
  // Start at the northernmost node (smallest z), walk to the farthest reached.
  const start = ids.reduce((a, b) => (p(b).z < p(a).z ? b : a));
  const { parent, far } = spread(start);
  const route = [far];
  while (route.at(-1) !== start) route.push(parent.get(route.at(-1)!)!);
  route.reverse();
  const cum = [0];
  for (let i = 1; i < route.length; i++)
    cum.push(cum[i - 1]! + distance(p(route[i - 1]!), p(route[i]!)));
  let centre = 0;
  route.forEach((id, i) => {
    if (distance(p(id), anchor) < distance(p(route[centre]!), anchor)) centre = i;
  });
  const total = cum.at(-1)!,
    span = Math.min(650, total);
  const from = Math.max(0, Math.min(total - span, cum[centre]! - span / 2));
  const trimmed = route.filter(
    (_, i) => cum[i]! >= from - 1e-6 && cum[i]! <= from + span + 1e-6,
  );
  return trimmed.length >= 3 ? trimmed : undefined;
}
function lowestNear(p: Point, radius: number): { point: Point; ground: number } {
  let best = { point: p, ground: groundAt(p) };
  for (const e of roads.edges) {
    const a = roads.nodes.get(e.from)!;
    if (distance(a, p) > radius) continue;
    const g = groundAt(a);
    if (g < best.ground) best = { point: { x: a.x, z: a.z }, ground: g };
  }
  return best;
}
const DEFAULT_PLACE: Partial<Record<EventKind, () => Place>> = {
  fire: () => ({
    name: "Bethesda Row",
    kind: "landmark",
    point: row.point,
    strong: true,
  }),
  storm: () => ({
    name: "Downtown Bethesda",
    kind: "landmark",
    point: downtown,
    strong: true,
  }),
  "metro-closure": () => ({
    name: "Bethesda Metro (Red Line) entrance",
    kind: "metro",
    point: metro.point,
    strong: true,
  }),
  parade: () => ({
    name: "Wisconsin Avenue",
    kind: "street",
    point: streetAnchor("Wisconsin Avenue")!,
    street: "Wisconsin Avenue",
    strong: true,
  }),
  object: () => ({
    name: "Downtown Bethesda",
    kind: "landmark",
    point: downtown,
    strong: true,
  }),
  outage: () => ({
    name: "Downtown Bethesda",
    kind: "landmark",
    point: downtown,
    strong: true,
  }),
  "gas-leak": () => ({
    name: "Bethesda Row",
    kind: "landmark",
    point: row.point,
    strong: true,
  }),
  festival: () => ({
    name: "Bethesda Row",
    kind: "landmark",
    point: row.point,
    strong: true,
  }),
  flood: () => ({
    name: "Downtown Bethesda",
    kind: "landmark",
    point: downtown,
    strong: true,
  }),
};
export function compileScenario(text: string): Compiled {
  const fail = (error: string): Compiled => ({ events: [], notes: [], error });
  if (text.length > 240) return fail("Telemetry is limited to 240 characters.");
  const t = normalize(text);
  if (!t) return fail("Describe an event and, optionally, a place.");
  const kinds: EventKind[] = [];
  let rest = " " + t + " ";
  for (const [kind, re] of VOCABULARY) {
    const m = rest.match(re);
    if (!m || kinds.length >= 3) continue;
    // A closure of the Metro is not also a road closure, and so on.
    if (kind === "road-closure" && kinds.length) continue;
    kinds.push(kind);
    rest = rest.replace(m[0], " ");
  }
  if (!kinds.length)
    return fail(
      "No supported event recognised. Try fire, storm, Metro closure, parade, unidentified object, crash, power outage, gas leak, rally, festival, road closure or flood.",
    );
  const resolved = resolvePlace(text);
  if (!resolved.place && resolved.unknown)
    return fail(
      `“${resolved.unknown}” is not a place in the mapped Bethesda extract. Use a street, intersection, building, park or landmark inside it.`,
    );
  const intensity: Intensity = MAJOR.test(t) ? 3 : MINOR.test(t) ? 1 : 2;
  const minutes = t.match(/\bfor (\d{1,3}) (minute|minutes|min|mins|hour|hours)\b/);
  const notes: string[] = [];
  const events: Scenario[] = [];
  for (const kind of kinds) {
    let place = resolved.place;
    let defaulted = false;
    if (!place) {
      const fallback = DEFAULT_PLACE[kind];
      if (!fallback) {
        if (kind === "road-closure")
          return fail("Which street? For example: “Close Woodmont Avenue.”");
        if (kind === "crash")
          place = {
            name: "Wisconsin Avenue & Bethesda Avenue",
            kind: "intersection",
            point:
              intersection("Wisconsin Avenue", "Bethesda Avenue") ??
              streetAnchor("Wisconsin Avenue")!,
            street: "Wisconsin Avenue",
            strong: true,
          };
        else
          place = {
            name: "Veteran's Park",
            kind: "park",
            point: centroid(parks.find((p) => /Veteran/.test(p.name))!.ring),
            strong: true,
          };
      } else place = fallback();
      defaulted = true;
    }
    if (!inBounds(place.point))
      return fail(`${place.name} lies outside the mapped extract.`);
    const radius = RADII[kind][intensity - 1]!;
    let duration = DURATION[kind] * (intensity === 3 ? 1.5 : intensity === 1 ? 0.6 : 1);
    if (minutes) {
      const n = Number(minutes[1]) * (minutes[2]!.startsWith("h") ? 60 : 1);
      duration = Math.min(MAX_TICKS, Math.max(1, n) * MINUTE);
      if (n * MINUTE > MAX_TICKS) notes.push("Duration capped at 10 simulated minutes.");
    }
    const event: Scenario = {
      kind,
      point: { x: place.point.x, z: place.point.z },
      radius,
      durationTicks: Math.round(Math.min(MAX_TICKS, Math.max(10, duration))),
      intensity,
      label: `${LABELS[kind]} · ${place.name}`.slice(0, 100),
      place: place.name.slice(0, 80),
    };
    if (kind === "storm" || kind === "outage") {
      // Weather and grid failures are areal; a named street is only the centre.
      event.point = { ...place.point };
    }
    if (kind === "road-closure") {
      const street = place.street ?? resolved.street;
      if (!street)
        return fail(`${place.name} is not a street. Name the street to close.`);
      event.street = street;
    }
    const procession =
      kind === "parade" ||
      (kind === "rally" && /\bmarch/.test(t) && !!(place.street ?? resolved.street));
    if (procession) {
      const street = place.street ?? resolved.street ?? "Wisconsin Avenue";
      const route = streetRoute(street, place.point);
      if (!route)
        return fail(`${street} has no continuous mapped route for a procession.`);
      event.route = route;
      event.street = street;
      event.point = { ...roads.nodes.get(route[0]!)! };
      event.radius = 20;
      const length = route
        .slice(1)
        .reduce(
          (s, id, i) => s + distance(roads.nodes.get(route[i]!)!, roads.nodes.get(id)!),
          0,
        );
      const travel = (length + PROCESSION.body[intensity - 1]!) / PROCESSION.speed / 0.1;
      event.durationTicks = Math.min(MAX_TICKS, Math.ceil(travel) + 60);
      if (travel > MAX_TICKS)
        notes.push("The procession is cut off at 10 simulated minutes.");
      notes.push(
        `Procession route: ${route.length} mapped ${street} nodes, ${Math.round(length)} m.`,
      );
    }
    if (kind === "flood") {
      // A bathtub fill of the real bare-earth DTM; not a hydrological model.
      const low = lowestNear(place.point, radius);
      event.point = low.point;
      event.level =
        Math.round((low.ground + [0.5, 0.9, 1.4][intensity - 1]!) * 100) / 100;
      notes.push(
        `Water surface ${(event.level + 100).toFixed(1)} m NAVD88 around the lowest mapped road node within ${radius} m (bare-earth DTM; no drainage model).`,
      );
    }
    notes.push(
      `${LABELS[kind]} at ${place.name}${defaulted ? " (default location)" : ` (${place.kind})`}, intensity ${["minor", "moderate", "major"][intensity - 1]}, ${Math.round((event.durationTicks / MINUTE) * 10) / 10} min.`,
    );
    events.push(event);
  }
  return { events, notes, error: null };
}
/** Compatibility: the first compiled event, or null. */
export function parseScenario(text: string): Scenario | null {
  return compileScenario(text).events[0] ?? null;
}
export function validScenario(v: unknown): v is Scenario {
  if (!v || typeof v !== "object") return false;
  const s = v as Scenario;
  const keys = new Set([
    "kind",
    "point",
    "radius",
    "durationTicks",
    "intensity",
    "label",
    "place",
    "street",
    "route",
    "level",
  ]);
  if (Object.keys(s).some((k) => !keys.has(k))) return false;
  return (
    EVENT_KINDS.includes(s.kind) &&
    !!s.point &&
    inBounds(s.point) &&
    Number.isFinite(s.radius) &&
    s.radius >= 8 &&
    s.radius <= 700 &&
    Number.isInteger(s.durationTicks) &&
    s.durationTicks >= 10 &&
    s.durationTicks <= MAX_TICKS &&
    [1, 2, 3].includes(s.intensity) &&
    typeof s.label === "string" &&
    s.label.length <= 100 &&
    typeof s.place === "string" &&
    s.place.length <= 80 &&
    (s.street === undefined ||
      (typeof s.street === "string" && roadWays.some((w) => w.name === s.street))) &&
    (s.route === undefined ||
      (Array.isArray(s.route) &&
        s.route.length >= 2 &&
        s.route.length <= 800 &&
        s.route.every((id) => typeof id === "string" && roads.nodes.has(id)))) &&
    (s.level === undefined ||
      (typeof s.level === "number" && Number.isFinite(s.level) && Math.abs(s.level) < 40))
  );
}
