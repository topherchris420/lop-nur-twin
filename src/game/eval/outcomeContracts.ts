import type { Axis } from "../pilot/contract.js";
import { offeredSlots, slotOf, type DecisionRecord } from "./records.js";

/**
 * Outcome contracts: what counts as a decision of a given kind, and what
 * counts as that decision having gone well — declared before the run.
 *
 * There is no universal "correct" here. Each contract names one narrow
 * decision problem, a predicate that picks those decisions out of a match, and
 * a fixed, versioned rule that classes each one's outcome window as
 * beneficial, neutral or harmful. The rules are proxies and say so; they are
 * chosen to be legible, not to be right about tactics. Changing any rule is a
 * new version (`cover-selection/v2`), never an edit, because an experiment that
 * was declared against v1 must be scored against v1.
 *
 * Thresholds are stated with their reason in `rule`, which the report prints
 * verbatim. A threshold without a reason in words does not go in.
 *
 * The contracts classify what the world did. They never read anything the
 * brain was not shown to decide *whether it should have known better*: an
 * outcome is an outcome.
 */

export type OutcomeClass = "beneficial" | "neutral" | "harmful";

export interface DecisionTypeContract {
  /** Versioned id, `name/vN`. */
  id: string;
  question: string;
  /** Which decisions count, in words. */
  applies: string;
  /** The success and harm rules, in words, printed with every result. */
  rule: string;
  /** The axis whose stated probability is calibrated against success. */
  calibrationAxis: Axis;
  /**
   * What the controller cannot do for the brain here. Printed, so a reader
   * can check the experiment isolates a choice rather than a motor skill.
   */
  controllerCannot: string;
  matches(record: DecisionRecord): boolean;
  /** Null when the outcome window is incomplete: not scored, and counted as such. */
  classify(record: DecisionRecord): OutcomeClass | null;
  /** A continuous figure per decision, for means and paired comparisons. */
  measure: { name: string; unit: string; read(record: DecisionRecord): number | null };
  /**
   * For a contract that splits its decisions into kinds with a rule each
   * (ENGAGE against DISENGAGE), the kind a decision is. Results are reported
   * per side as well as pooled.
   */
  side?: (record: DecisionRecord) => string;
}

const exposure = (r: DecisionRecord): number | null =>
  r.outcome && r.outcome.exposureSamples > 0
    ? r.outcome.exposedSamples / r.outcome.exposureSamples
    : null;

/** Executed, with a full window to judge. */
const scoreable = (r: DecisionRecord): boolean =>
  r.outcome !== null &&
  r.outcome.complete &&
  (r.validation.status === "executed" || r.validation.status === "executed_illegal");

const executed = (r: DecisionRecord): boolean =>
  r.validation.status === "executed" || r.validation.status === "executed_illegal";

/** A quarter of full health: the damage a person would call "I got hurt". */
const HURT = 25;

const FIRE = new Set(["FIRE", "ADS_FIRE"]);

export const COVER_SELECTION: DecisionTypeContract = {
  id: "cover-selection/v1",
  question: "Does the brain choose places that keep it out of enemy sight?",
  applies:
    "An executed decision whose go choice is PLACE_n, taken when at least two places were offered, and which bound a place.",
  rule: "Beneficial: in the window the seat did not die, took no damage, and was in some enemy's sight line in at most 25% of exposure samples (at most a quarter of the time seen). Harmful: it died, or took at least 25 damage (a quarter of full health). Otherwise neutral.",
  calibrationAxis: "go",
  controllerCannot:
    "The navigator walks to the place it is given and never picks one; which place, and whether to move at all, is the brain's.",
  matches: (r) =>
    executed(r) &&
    slotOf(r.frame.go) !== null &&
    offeredSlots(r.legal, "go") >= 2 &&
    r.execution.placeBound === true,
  classify: (r) => {
    if (!scoreable(r)) return null;
    const o = r.outcome!;
    if (o.died || o.damageTaken >= HURT) return "harmful";
    const e = exposure(r);
    return o.damageTaken === 0 && e !== null && e <= 0.25 ? "beneficial" : "neutral";
  },
  measure: { name: "exposure fraction in window", unit: "share", read: exposure },
};

export const THREAT_PRIORITY: DecisionTypeContract = {
  id: "threat-priority/v1",
  question: "Given several enemies in view, does the brain pick one it can neutralise?",
  applies:
    "An executed decision whose target choice is TARGET_n, taken with at least two enemies in view, and which bound a living enemy.",
  rule: "Beneficial: the chosen enemy was eliminated within the window and the seat survived it. Harmful: the seat died within the window. Otherwise neutral.",
  calibrationAxis: "target",
  controllerCannot:
    "The aiming controller tracks the enemy it is given and never picks one; which enemy is the brain's.",
  matches: (r) =>
    executed(r) &&
    slotOf(r.frame.target) !== null &&
    offeredSlots(r.legal, "target") >= 2 &&
    r.execution.targetBound === true,
  classify: (r) => {
    if (!scoreable(r)) return null;
    const o = r.outcome!;
    if (o.died) return "harmful";
    return o.target?.killed ? "beneficial" : "neutral";
  },
  measure: {
    name: "damage taken in window",
    unit: "hp",
    read: (r) => r.outcome?.damageTaken ?? null,
  },
};

/**
 * v1 describes an ENGAGE/DISENGAGE split and then applies one fighting rule to
 * every decision, so breaking off could be scored a success only by out-dealing
 * the enemy. It stays exactly as it was: experiments declared against it are
 * scored against it. `engage-disengage/v2` gives each side its own rule.
 */
export const ENGAGE_DISENGAGE: DecisionTypeContract = {
  id: "engage-disengage/v1",
  question:
    "With an enemy in view, does the brain fight when fighting pays and break off when it does not?",
  applies:
    "An executed decision taken with at least one enemy in view. ENGAGE is a fire choice with a target (or, under direct control, any fire choice); everything else is DISENGAGE.",
  rule: "Beneficial: the seat survived the window and dealt more damage than it took. Harmful: it died in the window. Otherwise neutral.",
  calibrationAxis: "weapon",
  controllerCannot:
    "The fire gate only withholds rounds from a permission already given; it never grants permission, and never moves the seat.",
  matches: (r) => executed(r) && r.context.visibleEnemies >= 1,
  classify: (r) => {
    if (!scoreable(r)) return null;
    const o = r.outcome!;
    if (o.died) return "harmful";
    return o.damageDealt > o.damageTaken ? "beneficial" : "neutral";
  },
  measure: {
    name: "damage dealt minus taken in window",
    unit: "hp",
    read: (r) => (r.outcome ? r.outcome.damageDealt - r.outcome.damageTaken : null),
  },
};

/**
 * ENGAGE: a fire choice that names a target, or — when precision control is not
 * in effect, so no target is ever named — any fire choice. Everything else with
 * an enemy in view is DISENGAGE.
 */
const engages = (r: DecisionRecord): boolean =>
  FIRE.has(r.frame.weapon) &&
  (offeredSlots(r.legal, "target") === 0 || slotOf(r.frame.target) !== null);

export const ENGAGE_DISENGAGE_V2: DecisionTypeContract = {
  id: "engage-disengage/v2",
  question:
    "With an enemy in view, does the brain fight when fighting pays and break off when it does not?",
  applies:
    "An executed decision taken with at least one enemy in view. ENGAGE is a fire choice that names a target (or, under direct control, where no target is named, any fire choice); everything else is DISENGAGE. Each side has its own rule.",
  rule: "ENGAGE — beneficial: the seat survived the window and dealt more damage than it took (the fight paid); harmful: it died in the window; otherwise neutral. DISENGAGE — beneficial: the seat survived the window untouched (breaking off kept it safe); harmful: it died, or took at least 25 damage, a quarter of full health (breaking off did not get it out of harm's way); otherwise neutral.",
  calibrationAxis: "weapon",
  controllerCannot:
    "The fire gate only withholds rounds from a permission already given; it never grants permission, and never moves the seat. Which side a decision is on is the brain's choice alone.",
  matches: (r) => executed(r) && r.context.visibleEnemies >= 1,
  side: (r) => (engages(r) ? "ENGAGE" : "DISENGAGE"),
  classify: (r) => {
    if (!scoreable(r)) return null;
    const o = r.outcome!;
    if (o.died) return "harmful";
    if (engages(r)) return o.damageDealt > o.damageTaken ? "beneficial" : "neutral";
    if (o.damageTaken >= HURT) return "harmful";
    return o.damageTaken === 0 ? "beneficial" : "neutral";
  },
  measure: {
    name: "damage dealt minus taken in window",
    unit: "hp",
    read: (r) => (r.outcome ? r.outcome.damageDealt - r.outcome.damageTaken : null),
  },
};

export const NAVIGATION: DecisionTypeContract = {
  id: "navigation/v1",
  question: "Does the brain choose destinations it can reach, and keep to them?",
  applies: "An executed decision whose go choice is PLACE_n and which bound a place.",
  rule: "Beneficial: the navigator reported arrival at the chosen place within the window and the seat survived. Harmful: the seat died in the window. Otherwise neutral (including a travel replaced by a later choice — counted separately as a reversal).",
  calibrationAxis: "go",
  controllerCannot:
    "The navigator walks a straight line and gives up when blocked; it does not re-plan, choose, or abandon a place for a better one.",
  matches: (r) =>
    executed(r) && slotOf(r.frame.go) !== null && r.execution.placeBound === true,
  classify: (r) => {
    if (!scoreable(r)) return null;
    const o = r.outcome!;
    if (o.died) return "harmful";
    return o.place?.reached ? "beneficial" : "neutral";
  },
  measure: {
    name: "exposure fraction in window",
    unit: "share",
    read: exposure,
  },
};

export const RELOAD: DecisionTypeContract = {
  id: "reload/v1",
  question: "Does the brain spend the time a reload costs when it can afford to?",
  applies: "An executed decision whose weapon choice is RELOAD.",
  rule: "Beneficial: the seat took no damage in the window. Harmful: it died in the window. Otherwise neutral.",
  calibrationAxis: "weapon",
  controllerCannot:
    "Nothing reloads for a brain; the rig only reloads on the brain's RELOAD or on an empty trigger pull.",
  matches: (r) => executed(r) && r.frame.weapon === "RELOAD",
  classify: (r) => {
    if (!scoreable(r)) return null;
    const o = r.outcome!;
    if (o.died) return "harmful";
    return o.damageTaken === 0 ? "beneficial" : "neutral";
  },
  measure: {
    name: "magazine fill at decision",
    unit: "share",
    read: (r) => (r.context.magSize > 0 ? r.context.ammo / r.context.magSize : null),
  },
};

export const SHOT: DecisionTypeContract = {
  id: "shot/v1",
  question:
    "When the brain gives permission to fire at a visible enemy, does a round land?",
  applies:
    "An executed fire decision (FIRE or ADS_FIRE) taken with at least one enemy in view.",
  rule: "Beneficial: at least one round struck an enemy in the window. Harmful: the seat died in the window without landing one. Otherwise neutral. Under precision control this is the brain's permission and the controller's aim together, and the report says so.",
  calibrationAxis: "weapon",
  controllerCannot:
    "Under direct control, nothing: the brain aims. Under precision control the controller aims and gates; the brain only permits and names the target.",
  matches: (r) =>
    executed(r) && FIRE.has(r.frame.weapon) && r.context.visibleEnemies >= 1,
  classify: (r) => {
    if (!scoreable(r)) return null;
    const o = r.outcome!;
    if (o.hits > 0) return "beneficial";
    return o.died ? "harmful" : "neutral";
  },
  measure: {
    name: "hits per round in window",
    unit: "share",
    read: (r) =>
      r.outcome && r.outcome.shotsFired > 0
        ? r.outcome.hits / r.outcome.shotsFired
        : null,
  },
};

/** Every executed decision. Unscored: it exists for staleness and ledger views. */
export const ANY_DECISION: DecisionTypeContract = {
  id: "any/v1",
  question: "Every executed decision, unscored.",
  applies: "Every executed decision.",
  rule: "No success rule: this view is for staleness, latency and cost, which are not outcomes.",
  calibrationAxis: "move",
  controllerCannot: "n/a",
  matches: executed,
  classify: () => null,
  measure: { name: "exposure fraction in window", unit: "share", read: exposure },
};

export const DECISION_TYPES: readonly DecisionTypeContract[] = [
  COVER_SELECTION,
  THREAT_PRIORITY,
  ENGAGE_DISENGAGE,
  ENGAGE_DISENGAGE_V2,
  NAVIGATION,
  RELOAD,
  SHOT,
  ANY_DECISION,
];

export function decisionType(id: string): DecisionTypeContract | null {
  return DECISION_TYPES.find((t) => t.id === id) ?? null;
}
