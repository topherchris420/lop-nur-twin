/**
 * What the exhibit's label and observation panel say, from the state on
 * screen. Pure: it reads frozen observations and returns text, so it is
 * tested against recorded states. Every number shown is one the server
 * reported; nothing here estimates or fills in. Each kind of statement is
 * kept apart and labelled:
 *
 * - **Modelled**: the simulation's own state (what the fly does, remembers
 *   and has learned). It is a model running on the garden's server, not an
 *   observation of a real insect.
 * - **Reported**: Bethesda's weather, as the server fetched it.
 * - **Established**: published measurements of real fruit flies, each with
 *   its source, shown as context and never as this fly's data.
 *
 * The one thing said that is none of these is the fly's name: the garden's
 * keeper gave it, and the panel says so.
 */
import groomingReference from "../../bethesda/fly/data/grooming-reference.json" with { type: "json" };
import flybodySource from "../../bethesda/fly/data/flybody.source.json" with { type: "json" };
import type { Learning, Moment, Observation } from "../core/observation.js";
import { BROADCAST_DELAY_S } from "../core/timeline.js";

export const ZONE = "America/New_York";
const clock = new Intl.DateTimeFormat("en-US", {
  timeZone: ZONE,
  hour: "numeric",
  minute: "2-digit",
});
const day = new Intl.DateTimeFormat("en-US", {
  timeZone: ZONE,
  weekday: "long",
  month: "long",
  day: "numeric",
});
const date = new Intl.DateTimeFormat("en-US", {
  timeZone: ZONE,
  year: "numeric",
  month: "long",
  day: "numeric",
});

export const clockText = (unix: number) => clock.format(new Date(unix * 1000));
export const dayText = (unix: number) => day.format(new Date(unix * 1000));

// ------------------------------------------------------------------ status

export type Status =
  "connecting" | "live" | "waiting" | "reconnecting" | "offline" | "paused";

export interface Connection {
  paused: boolean;
  /** Failed requests in a row. */
  failures: number;
  /** Seconds since the last successful answer, or null before the first. */
  sinceAnswer: number | null;
  /** Server-clock seconds since the newest state's simulated instant, or null. */
  newestAge: number | null;
  /** Presented seconds past the newest state (the page is waiting for the next step). */
  late: number;
}

export interface StatusView {
  state: Status;
  text: string;
  detail: string;
}

export function statusOf(c: Connection): StatusView {
  if (c.paused)
    return {
      state: "paused",
      text: "Paused view",
      detail: "Your view is held still. The fly's life carries on on the server.",
    };
  if (c.sinceAnswer === null)
    return c.failures > 0
      ? {
          state: "reconnecting",
          text: "Reconnecting",
          detail:
            "The garden has not answered yet. Retrying automatically; its current state is unknown.",
        }
      : {
          state: "connecting",
          text: "Connecting",
          detail: "Opening a window into the garden.",
        };
  if (c.failures > 0) {
    const ago = durationText(c.sinceAnswer);
    return c.sinceAnswer > 120
      ? {
          state: "offline",
          text: "Disconnected",
          detail: `Last heard from the garden ${ago} ago. Retrying automatically; its current state is unknown.`,
        }
      : {
          state: "reconnecting",
          text: "Reconnecting",
          detail: `Last heard from the garden ${ago} ago. Retrying automatically.`,
        };
  }
  if ((c.newestAge !== null && c.newestAge > 35) || c.late > 8)
    return {
      state: "waiting",
      text: "Waiting for the garden",
      detail:
        "The server has not published its next step yet. The view holds the last one it sent.",
    };
  return {
    state: "live",
    text: "Live",
    detail: `Shown ${BROADCAST_DELAY_S} seconds behind the garden's clock: the same moment for every visitor.`,
  };
}

// --------------------------------------------------------------- behaviour

const BEHAVIOUR: Record<string, { kicker: string; line: string }> = {
  sleeping: {
    kicker: "Resting through the quiet hours",
    line: "Wings folded. Letting the quiet hours pass.",
  },
  resting: {
    kicker: "Taking its time",
    line: "A little stillness, before the next small thing.",
  },
  grooming: {
    kicker: "Tending to itself",
    line: "Cleaning its legs, then its wings. Important little work.",
  },
  feeding: {
    kicker: "Finding something sweet",
    line: "A little sweetness is plenty at this scale.",
  },
  drinking: { kicker: "A little water", line: "Taking a drink from a world-sized drop." },
  flying: {
    kicker: "Between here and there",
    line: "Following the air, with somewhere of its own to go.",
  },
  walking: {
    kicker: "Trying its legs",
    line: "Feeling its way, a small step at a time.",
  },
};

export interface LabelView {
  kicker: string;
  place: string;
  line: string;
  /** The server's activity word, as sent. */
  activity: string;
}

export function labelOf(o: Observation): LabelView {
  const b = BEHAVIOUR[o.activity] ?? {
    kicker: "A small life, in progress",
    line: "Going about its day.",
  };
  return {
    kicker: b.kicker,
    place: o.travel
      ? `Crossing the garden, toward the ${placeWord(o.travel.destination)}`
      : o.placeName,
    line: b.line,
    activity: o.activity,
  };
}

const PLACE_WORDS: Record<string, string> = {
  leaf: "maple leaf",
  window: "windowsill",
  flowers: "asters",
  pear: "fallen pear",
  water: "rain saucer",
  fence: "cedar fence",
  stone: "stepping stones",
};
export const placeWord = (id: string) => PLACE_WORDS[id] ?? "garden";

// ------------------------------------------------------------- this life

export function durationText(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
  const d = Math.floor(s / 86400);
  return `${d} ${d === 1 ? "day" : "days"} ${Math.floor((s % 86400) / 3600)} h`;
}

export interface LifeView {
  age: string;
  born: string;
  journeys: string;
  places: string;
  memories: string;
  identity: string;
}

/** `now` is the server clock (s). */
export function lifeOf(o: Observation, now: number): LifeView {
  return {
    age: durationText(now - o.bornAt),
    born: date.format(new Date(o.bornAt * 1000)),
    journeys: o.journeys.toLocaleString("en-US"),
    places: `${o.placesVisited} of 7`,
    memories: o.momentsCount === null ? "—" : o.momentsCount.toLocaleString("en-US"),
    identity: o.lifeId.slice(0, 8),
  };
}

/**
 * Names the garden's keeper has given, by the `life_id` each belongs to. The
 * simulation has no names (and no sex), so a name is shown only for the life
 * it was given to, with a note saying whose it is: another individual is
 * shown by its id until it is named here.
 */
const NAMES = new Map([
  // Named on 2026-10-26: Eva, as FlyBody's body, which draws this fly, was
  // imaged from an adult female (Vaxenburg et al. 2025).
  ["5cf42cd6-fd0a-474d-882c-4cb70e0357e8", "Eva"],
]);

export const NAME_NOTE =
  "Named by the garden's keeper. The simulation itself has no names.";

/** The keeper's name for an individual, or null if it has none. */
export const nameOf = (o: Pick<Observation, "lifeId">): string | null =>
  NAMES.get(o.lifeId) ?? null;

/** An individual as the page refers to it: by name and id, or by id alone. */
export function whoOf(o: Pick<Observation, "lifeId">): string {
  const name = nameOf(o);
  const id = o.lifeId.slice(0, 8);
  return name ? `${name} (${id})` : id;
}

export interface MemoryView {
  key: string;
  time: string;
  iso: string;
  title: string;
  text: string;
}

/** The newest few of the memories the server sends with a state, newest first. */
export function memoriesOf(moments: readonly Moment[], count = 5): MemoryView[] {
  return moments.slice(0, count).map((m) => {
    const d = new Date(m.at * 1000);
    return {
      key: String(m.id),
      time: clock.format(d),
      iso: d.toISOString(),
      title: day.format(d),
      text: m.text,
    };
  });
}

// ------------------------------------------------------------ learning

const percent = (v: number | null) =>
  v === null ? "not reported" : `${Math.round(v * 100)}%`;

export interface LearnedView {
  movement: string[];
  trials: string;
  error: string;
  surprises: string;
  condition: string;
  last: string | null;
  body: string;
  others: string;
}

export function learnedOf(l: Learning | null): LearnedView | null {
  if (!l) return null;
  const capability = (label: string, c: Learning["fly"]) =>
    c
      ? `${label}: ${c.samples.toLocaleString("en-US")} attempts, ${Math.round(c.successRate * 100)}% successful`
      : `${label}: untried in these conditions`;
  const independent = l.nearby
    .filter((n) => n.independent)
    .map((n) => n.name.replaceAll("_", " "));
  const last = l.last;
  const verbs: Record<string, string> = {
    fly: "flew",
    walk: "walked",
    rest: "rested",
    groom: "groomed",
  };
  return {
    movement: [capability("Flying", l.fly), capability("Walking", l.walk)],
    trials: l.trials.toLocaleString("en-US"),
    error: l.predictionError === null ? "—" : `${(l.predictionError * 100).toFixed(2)}%`,
    surprises: l.surprises === null ? "—" : l.surprises.toLocaleString("en-US"),
    condition: l.condition ? l.condition.split(":").join(", ") : "not reported",
    last: last
      ? `${verbs[last.action] ?? last.action} at ${clockText(last.at)}${last.success === null ? "" : last.success ? ", as expected" : ", short of what it expected"}`
      : null,
    body: `Wings ${percent(l.wingIntegrity)} · legs ${percent(l.legIntegrity)} · wetness ${percent(l.wetness)}`,
    others: independent.length
      ? `Beyond its own movement, it has noticed motion of its own in the ${independent.join(" and the ")}.`
      : "Still separating its own movement from the midge and the swaying leaf.",
  };
}

// ----------------------------------------------------------- established

export interface Citation {
  text: string;
  href: string;
}

export interface Established {
  title: string;
  text: string;
  source: Citation;
}

const FLYBODY: Citation = {
  text: flybodySource.citation.text,
  href: `https://doi.org/${flybodySource.citation.doi}`,
};

/** The body's provenance: shown always. */
export const BODY_NOTE: Established = {
  title: "The body",
  text: "The fly's proportions and joints are FlyBody's anatomical model of the fruit fly Drosophila melanogaster, built from microscope images of one adult female, and its form is FlyBody's mesh with fewer triangles. Its clay surface, colours and fingerprints are an artist's rendering.",
  source: FLYBODY,
};

/** Shares of time real, dust-covered flies spent on each grooming action (Zhang, Guo & Simpson 2020). */
function groomingNote(): Established {
  const d = groomingReference.conditions.dusted;
  const share = (k: "1" | "2" | "3" | "4" | "5") =>
    Math.round(d.summary.timeFraction[k].mean * 100);
  const minutes = Math.round((d.frames / groomingReference.frameHz / 60) * 10) / 10;
  return {
    title: "Grooming in real flies",
    text:
      `In a laboratory study, ${d.flies} dust-covered fruit flies filmed for ${minutes} minutes spent on average ` +
      `${share("2")}% of the time cleaning the head, ${share("1")}% rubbing the front legs together, ` +
      `${share("4")}% rubbing the back legs, ${share("3")}% cleaning the abdomen and ${share("5")}% the wings. ` +
      "This fly's grooming is modelled; these are measurements of real flies, for comparison.",
    source: {
      text: groomingReference.paper.short,
      href: `https://doi.org/${groomingReference.paper.doi}`,
    },
  };
}

/** Context notes for what the fly is doing now (only where a published measurement is in the repository). */
export function establishedFor(activity: string): Established[] {
  return activity === "grooming" ? [groomingNote(), BODY_NOTE] : [BODY_NOTE];
}

// ------------------------------------------------------------ weather

export function weatherOf(o: Observation): string {
  const w = o.weather;
  const f = Math.round((w.temperatureC * 9) / 5 + 32);
  const parts = [`${Math.round(w.temperatureC)}°C / ${f}°F`, w.description.toLowerCase()];
  if (w.windKmh !== null) parts.push(`wind ${Math.round(w.windKmh)} km/h`);
  return parts.join(" · ") + (w.source === "seasonal" ? " (seasonal estimate)" : "");
}

/** One sentence for the canvas's text alternative. */
export function sceneDescription(o: Observation, paused: boolean): string {
  if (paused) return "The garden view is paused. The fly's life continues on the server.";
  const where = o.travel
    ? `crossing the garden toward the ${placeWord(o.travel.destination)}`
    : `at the ${placeWord(o.place ?? "")}`;
  const name = nameOf(o);
  return `A clay model of a Bethesda garden ${o.weather.isDay ? "by day" : "at night"}. ${name ? `${name}, the fly,` : "The fly"} is ${o.activity}, ${where}.`;
}
