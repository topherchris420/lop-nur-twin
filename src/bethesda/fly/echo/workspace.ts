/**
 * Project ECHO's workspace: a functional analogue of a global workspace
 * (Baars 1988; Dehaene & Naccache 2001), indicator properties GWT-1 to GWT-4
 * of Butlin, Long et al. 2023.
 *
 * The fly's processes run side by side and each bids, every decision, with
 * what it carries and how much it matters now: the self-model asking why its
 * predictions fail, the legs' touch, the antennae, and the reduced-order
 * controller's intention (an efference copy of what it means to do, with the
 * fly's hunger behind its pursuit of food). One content holds the workspace
 * at a time. A rival enters only when it clearly outbids what holds it, and
 * what holds it keeps it while it still matters. What holds it is broadcast
 * to everything that acts (selfModel.ts): while the fly's own inquiry holds
 * it, the controller's routine changes of activity wait and the inquiry asks
 * the body its questions in turn; while anything else holds it, the
 * inquiry's questions wait.
 *
 * These are functional terms for a few lines of arithmetic over a
 * reduced-order simulator. Nothing here is a claim that the fly experiences
 * anything (docs/PROJECT_ECHO.md).
 */
import type { MotorCommand } from "../neural.js";
import { EP } from "./params.js";
import type { SelfModelView } from "./view.js";

export const SOURCES = ["self", "touch", "air", "hazard", "pursuit", "routine"] as const;
export type Source = (typeof SOURCES)[number];

/** What each source is, for anyone reading the fly's state. */
export const SOURCE_LABELS: Readonly<Record<Source, string>> = {
  self: "its own movement",
  touch: "something its legs met",
  air: "the air",
  hazard: "a hazard",
  pursuit: "a pursuit",
  routine: "what it was doing",
};

/** Contents the fly never holds off, whatever it is attending to: its safety and its senses' news. */
export const UNSHIELDED: ReadonlySet<Source> = new Set<Source>([
  "hazard",
  "touch",
  "air",
]);

export interface Bid {
  source: Source;
  salience: number;
  /** What the content is, in a few words. */
  what: string;
}

export interface Holding {
  source: Source;
  what: string;
  from: number;
  until: number;
}

export interface Workspace {
  holder: { source: Source; what: string; since: number; salience: number } | null;
  ignitions: number;
  /** The last holdings, oldest first. */
  past: Holding[];
  /** Seconds each source has held the workspace since the fly was placed. */
  held: Record<Source, number>;
  /** The last walking intention, which a held walk keeps to. */
  lastWalk: { walkSpeed: number; yawRate: number } | null;
}

const PAST_KEPT = 16;

export function freshWorkspace(): Workspace {
  return {
    holder: null,
    ignitions: 0,
    past: [],
    held: { self: 0, touch: 0, air: 0, hazard: 0, pursuit: 0, routine: 0 },
    lastWalk: null,
  };
}

/** The controller's intention as a bid: what it means to do, and how urgent that is. */
export function intentionBid(intention: MotorCommand, view: SelfModelView): Bid {
  const r = intention.reason;
  const hunger = Math.max(0, Math.min(1, 1 - view.reserve));
  if (
    intention.mode === "escape" ||
    intention.saccade !== undefined ||
    /escape|evasive|surface ahead/.test(r)
  )
    return { source: "hazard", salience: EP.hazardSalience, what: "avoiding a surface" };
  if (intention.mode === "land")
    return { source: "pursuit", salience: EP.landSalience, what: "landing" };
  if (intention.mode === "feed" || /food|odour|scent/.test(r))
    return { source: "pursuit", salience: EP.foodSalience + hunger, what: "food" };
  if (intention.mode === "takeoff" && (view.mode === "rest" || view.mode === "walk"))
    return { source: "routine", salience: EP.takeoffSalience, what: "taking off" };
  if (intention.mode === "groom")
    return { source: "routine", salience: EP.groomSalience, what: "grooming" };
  if (intention.mode === "flight" || intention.mode === "takeoff")
    return { source: "routine", salience: EP.flightSalience, what: "flying" };
  return {
    source: "routine",
    salience: EP.idleSalience,
    what: intention.mode === "walk" ? "walking" : "resting",
  };
}

/**
 * One decision's competition. The holder's salience is its own bid now (none
 * if it no longer bids). The strongest rival takes the workspace if it
 * clears the entry level and outbids the holder by the margin (the larger
 * one while `shield` holds off what it may), or if the holder has let go.
 * Returns the content that entered, if any.
 */
export function compete(
  ws: Workspace,
  bids: readonly Bid[],
  t: number,
  dt: number,
  shield: boolean,
): Bid | null {
  const bidOf = (s: Source) =>
    bids.filter((b) => b.source === s).sort((a, b) => b.salience - a.salience)[0];
  const h = ws.holder;
  if (h) {
    const own = bidOf(h.source);
    h.salience = own ? own.salience : 0;
    if (own) h.what = own.what;
  }
  const rival = bids
    .filter((b) => !h || b.source !== h.source)
    .sort((a, b) => b.salience - a.salience)[0];
  const released = h !== null && h.salience < EP.releaseSalience;
  let entered: Bid | null = null;
  if (rival && rival.salience >= EP.igniteSalience) {
    const margin =
      shield && !UNSHIELDED.has(rival.source) ? EP.shieldMargin : EP.workspaceMargin;
    if (!h || released || rival.salience > h.salience * (1 + margin)) entered = rival;
  }
  if (entered || released) {
    if (h) end(ws, h, t);
    ws.holder = entered ? { ...entered, since: t } : null;
    if (entered) ws.ignitions++;
  }
  if (ws.holder) ws.held[ws.holder.source] += dt;
  return entered;
}

function end(ws: Workspace, h: NonNullable<Workspace["holder"]>, t: number): void {
  ws.past.push({ source: h.source, what: h.what, from: h.since, until: t });
  if (ws.past.length > PAST_KEPT) ws.past.splice(0, ws.past.length - PAST_KEPT);
}

/** Whether the fly's own inquiry holds the workspace. */
export const selfHolds = (ws: Workspace): boolean => ws.holder?.source === "self";
