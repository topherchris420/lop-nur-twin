import type { ReactNode, Ref } from "react";
import {
  AXES,
  AXIS_DESCRIPTIONS,
  type Axis,
  type AxisActions,
} from "../../pilot/contract";
import type { JevObservation } from "../../pilot/observation";
import type { DecisionTypeContract } from "../outcomeContracts";
import type {
  ConfidenceSource,
  DecisionContext,
  DecisionRecord,
  ValidationStatus,
} from "../records";
import { formatValue } from "./charts";

/**
 * One decision, laid out by the record's own sections: what the seat
 * perceived, what it could choose, what it chose, how sure it said it was,
 * what it cost, whether it was still legal, what software did, and what the
 * world did next.
 *
 * Everything here is read off the record. Nothing is inferred: no reason is
 * given for a choice, because a seat returns a choice among offered options
 * and no explanation is part of the record; an unknown prints "not reported",
 * never zero; and a confidence a seat did not state is not filled in.
 */

const NOT_REPORTED = "not reported";

const VALIDATION_WORDS: Record<ValidationStatus, string> = {
  executed: "Executed. Nothing it chose had become illegal by then.",
  executed_illegal:
    "Executed although part of it had become illegal by then (the observe policy).",
  rejected_stale:
    "Refused at execution: part of it had become illegal by then (the strict policy).",
  superseded: "Superseded: a newer decision arrived before this one could start.",
  not_executed:
    "Accepted but never started: a death, a pause, a takeover or the episode's end came first.",
};

/** `staleness.ts`'s change codes, in words. An unknown code is printed as it is. */
const WORLD_CHANGE_WORDS: Record<string, string> = {
  seat_died: "the seat had died",
  health_dropped: "its health had dropped",
  stance_changed: "its stance had changed",
  enemy_appeared: "an enemy had come into view",
  enemy_left_view: "an enemy had left the view",
  target_gone: "the enemy its target slot named was gone or out of view",
  weapon_state: "the weapon's ammunition, reloading or readiness to fire had changed",
};

/** The executor's end reasons (`FrameEndReason`), in words. */
const FRAME_END_WORDS: Record<string, string> = {
  expired: "its control window ran out",
  replaced: "a newer frame took over",
  cleared: "the host released it before its window ran out",
};

/** The navigator's release reasons (`NavigatorRelease`), in words. */
const TRAVEL_END_WORDS: Record<string, string> = {
  arrived: "it arrived",
  blocked: "it stopped making progress",
  timeout: "it was not confirmed again in time",
  cleared: "the host released it",
  replaced: "another destination replaced it",
};

const CONFIDENCE_WORDS: Record<ConfidenceSource, string> = {
  "provider-probability":
    "The provider's own probability for the option chosen, and the confidence figure it reports beside it.",
  verbalized:
    "A number the model wrote in its answer when asked for one. It is not a probability.",
  none: "The seat states no confidence.",
};

const ms = (value: number | null): string =>
  value === null ? NOT_REPORTED : `${formatValue(value, 0)} ms`;
const count = (value: number | null): string =>
  value === null ? NOT_REPORTED : value.toLocaleString("en");
const text = (value: string | null): string => value ?? NOT_REPORTED;
const yesNo = (value: boolean): string => (value ? "yes" : "no");
const metres = (value: number): string => `${formatValue(value, 1)} m`;
const seconds = (value: number): string => `${formatValue(value, 1)} s`;

/** A bearing from the crosshair, clockwise-positive, in words. */
function across(deg: number): string {
  if (deg === 0) return "on the crosshair line";
  return `${formatValue(Math.abs(deg), 1)}° ${deg > 0 ? "right" : "left"}`;
}

function upDown(deg: number): string {
  if (deg === 0) return "level";
  return `${formatValue(Math.abs(deg), 1)}° ${deg > 0 ? "above" : "below"}`;
}

function Pairs({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-3 gap-y-1">
      {rows.map(([term, value]) => (
        <div key={term} className="contents">
          <dt className="text-muted-foreground">{term}</dt>
          <dd className="font-mono break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Part({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="min-w-0">
      <h5 id={id} className="text-sm font-semibold">
        {title}
      </h5>
      <div className="mt-2 space-y-2">{children}</div>
    </section>
  );
}

function Sub({ children }: { children: ReactNode }) {
  return <h6 className="text-muted-foreground mt-3 font-semibold">{children}</h6>;
}

function Bullets({ items, empty }: { items: ReactNode[]; empty: string }) {
  if (items.length === 0) return <p>{empty}</p>;
  return (
    <ul className="list-disc space-y-1 pl-4">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

function Perceived({ o }: { o: JevObservation }) {
  const p = o.perception;
  const obstacles = (["forwardM", "leftM", "rightM", "backM"] as const).map((key) => {
    const where = { forwardM: "ahead", leftM: "left", rightM: "right", backM: "behind" }[
      key
    ];
    const value = p.obstacles[key];
    return value === null
      ? `${where} clear`
      : `${where} ${metres(value)}${key === "forwardM" && p.obstacles.forwardClimbable ? " (climbable)" : ""}`;
  });
  return (
    <>
      <Pairs
        rows={[
          ["Health", formatValue(o.player.health, 0)],
          [
            "Weapon",
            `${o.weapon.slot} ${o.weapon.weaponClass}, ${o.weapon.fireMode} · ${o.weapon.ammo}/${o.weapon.magSize} in the magazine, ${o.weapon.reserve} in reserve${o.weapon.reloading ? " · reloading" : ""}${o.weapon.canFire ? "" : " · cannot fire"}`,
          ],
          [
            "Body",
            `${o.player.stance}, ${o.player.motion}, ${formatValue(o.player.speedMps, 1)} m/s${o.player.grounded ? "" : ", off the ground"} · sights ${formatValue(o.player.adsProgress * 100, 0)}%`,
          ],
          [
            "View",
            `heading ${formatValue(o.player.headingDeg, 1)}°, pitch ${formatValue(o.player.pitchDeg, 1)}°`,
          ],
          [
            "Match",
            `${o.match.mode}, ${o.match.phase}, ${seconds(o.match.timeRemainingS)} left · ${o.match.team} ${o.match.ownScore}–${o.match.enemyScore}`,
          ],
          ["Interface", `${o.control} control, ${o.navigation} navigation`],
        ]}
      />
      <Sub>Enemies in view</Sub>
      <Bullets
        empty="None in view."
        items={p.visibleEnemies.map((e, i) => (
          <>
            <span className="font-mono">TARGET_{i}</span>: {metres(e.distanceM)},{" "}
            {across(e.bearingDeg)} and {upDown(e.elevationDeg)} the crosshair;{" "}
            {e.headVisible && e.chestVisible
              ? "head and chest visible"
              : e.headVisible
                ? "head visible, chest hidden"
                : e.chestVisible
                  ? "chest visible, head hidden"
                  : "neither head nor chest visible"}
            ; firing: {yesNo(e.firing)}; on the crosshair: {yesNo(e.onCrosshair)}; moving{" "}
            {formatValue(Math.abs(e.lateralMps), 1)} m/s{" "}
            {e.lateralMps === 0
              ? "across the view"
              : e.lateralMps > 0
                ? "rightward"
                : "leftward"}
            ; tracked: {yesNo(e.tracked)}
          </>
        ))}
      />
      <Sub>Cues</Sub>
      <Bullets
        empty=""
        items={[
          ...p.contacts.map(
            (c) =>
              `${c.source === "gunfire" ? "Gunfire heard" : "Last seen"} ${metres(c.distanceM)} away, ${across(c.bearingDeg)} of the crosshair, ${seconds(c.ageS)} ago`,
          ),
          p.contacts.length === 0 ? "No gunfire heard and no remembered contact." : null,
          p.damage
            ? `Hit from ${across(p.damage.bearingDeg)} of the crosshair, ${seconds(p.damage.ageS)} ago`
            : "No recent hit.",
          p.allies.length === 0
            ? "No teammate on the radar."
            : `Teammates on the radar: ${p.allies.map((a) => `${metres(a.distanceM)} ${across(a.bearingDeg)}`).join("; ")}`,
          `Obstacles within the probe: ${obstacles.join(", ")}`,
          o.travel
            ? `Travelling to ${o.travel.kind}, ${across(o.travel.bearingDeg)}, ${metres(o.travel.remainingM)} to go`
            : null,
          o.objective.kind === "none"
            ? null
            : `Objective (${o.objective.kind}): ${o.objective.distanceM === null ? "distance not reported" : metres(o.objective.distanceM)}${o.objective.bearingDeg === null ? "" : `, ${across(o.objective.bearingDeg)}`}${o.objective.state ? `, ${o.objective.state}` : ""}`,
          o.previous.outcome
            ? `Previous frame: ${o.previous.outcome.shotsFired} shot${o.previous.outcome.shotsFired === 1 ? "" : "s"} fired; hit confirmed: ${yesNo(o.previous.outcome.hitConfirmed)}; kill confirmed: ${yesNo(o.previous.outcome.killConfirmed)}; damage taken: ${yesNo(o.previous.outcome.damageTaken)}; movement blocked: ${yesNo(o.previous.outcome.movementBlocked)}`
            : null,
        ].filter((item): item is string => item !== null)}
      />
      {p.places.length > 0 ? (
        <>
          <Sub>Places listed</Sub>
          <Bullets
            empty=""
            items={p.places.map((place, i) => (
              <>
                <span className="font-mono">PLACE_{i}</span>: {place.kind},{" "}
                {metres(place.distanceM)}, {across(place.bearingDeg)}; hidden from known
                threats: {yesNo(place.hidden)}; {metres(place.routeExposedM)} of the
                straight route in a known threat&rsquo;s sight; nearest known threat{" "}
                {place.threatDistanceM === null
                  ? "none known"
                  : `${metres(place.threatDistanceM)} from it`}
              </>
            ))}
          />
        </>
      ) : null}
    </>
  );
}

function Context({ c }: { c: DecisionContext }) {
  return (
    <>
      <Pairs
        rows={[
          ["Health", formatValue(c.health, 0)],
          [
            "Weapon",
            `${c.ammo}/${c.magSize} in the magazine, ${c.reserve} in reserve${c.reloading ? " · reloading" : ""}`,
          ],
          ["Body", `${c.stance}, ${c.motion}`],
          [
            "Enemies",
            `${c.visibleEnemies} in view, ${c.enemiesFiring} firing · ${c.contacts} contact${c.contacts === 1 ? "" : "s"} · recent hit: ${yesNo(c.damageRecent)}`,
          ],
          [
            "Objective",
            c.objectiveDistanceM === null ? NOT_REPORTED : metres(c.objectiveDistanceM),
          ],
        ]}
      />
      <Sub>Enemies in view</Sub>
      <Bullets
        empty="None in view."
        items={c.targets.map(
          (t, i) =>
            `TARGET_${i}: ${metres(t.distanceM)}; fully exposed: ${yesNo(t.fullyExposed)}; firing: ${yesNo(t.firing)}; on the crosshair: ${yesNo(t.onCrosshair)}; tracked: ${yesNo(t.tracked)}`,
        )}
      />
      {c.places.length > 0 ? (
        <>
          <Sub>Places listed</Sub>
          <Bullets
            empty=""
            items={c.places.map(
              (place, i) =>
                `PLACE_${i}: ${place.kind}, ${metres(place.distanceM)}; hidden from known threats: ${yesNo(place.hidden)}; ${metres(place.routeExposedM)} of the route in a known threat's sight`,
            )}
          />
        </>
      ) : null}
    </>
  );
}

/** Axes whose choice differs from the previous executed decision's. */
export function changedAxes(
  record: DecisionRecord,
  previous: DecisionRecord | null,
): ReadonlySet<Axis> {
  if (!previous) return new Set();
  return new Set(AXES.filter((axis) => previous.frame[axis] !== record.frame[axis]));
}

function meaning<A extends Axis>(axis: A, option: AxisActions[A]): string {
  return (AXIS_DESCRIPTIONS[axis] as Readonly<Record<string, string>>)[option] ?? "";
}

export interface InspectorProps {
  record: DecisionRecord;
  /** The executed decision before this one, the baseline for "changed". */
  previous: DecisionRecord | null;
  /** Other decisions whose outcome windows share time with this one's. */
  overlap: number | null;
  contract: DecisionTypeContract | null;
  /** Its place among the rows the table shows, when it is one of them. */
  position: { index: number; total: number } | null;
  onPrevious: (() => void) | null;
  onNext: (() => void) | null;
  onClose: () => void;
  headingRef: Ref<HTMLHeadingElement>;
  id: string;
}

const control =
  "border-border hover:bg-accent focus-visible:ring-ring inline-flex cursor-pointer items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs focus-visible:ring-2 focus-visible:outline-none aria-disabled:cursor-not-allowed aria-disabled:opacity-50";

export function DecisionInspector({
  record: r,
  previous,
  overlap,
  contract,
  position,
  onPrevious,
  onNext,
  onClose,
  headingRef,
  id,
}: InspectorProps) {
  const changed = changedAxes(r, previous);
  const o = r.outcome;
  const a = r.accounting;
  const v = r.validation;
  const x = r.execution;
  const checked = v.status !== "superseded" && v.status !== "not_executed";
  const part = (name: string): string => `${id}-${name}`;
  const asked = AXES.filter(
    (axis) =>
      (r.legal[axis] as readonly string[]).length >= 2 || r.confidence.perAxis[axis],
  );
  return (
    <section
      id={id}
      aria-labelledby={part("title")}
      className="border-border mt-4 rounded-md border p-4 text-xs leading-relaxed"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h4
            id={part("title")}
            ref={headingRef}
            tabIndex={-1}
            className="focus-visible:ring-ring w-fit rounded-sm text-base font-semibold focus:outline-none focus-visible:ring-2"
          >
            Decision {r.sequence}
          </h4>
          <p className="text-muted-foreground">
            {position
              ? `Row ${position.index + 1} of the ${position.total} the table shows`
              : "Not among the rows the table shows now"}{" "}
            · source <span className="font-mono">{r.source}</span> · brain{" "}
            <span className="font-mono">{r.brain}</span> · issued at{" "}
            {seconds(r.issuedAtSim)}, accepted at {seconds(r.acceptedAtSim)} of simulation
            time
          </p>
        </div>
        <div role="group" aria-label="Step through decisions" className="flex gap-2">
          {/* aria-disabled rather than disabled: stepping onto the last row
              must not drop the focus of the button that got it there. */}
          <button
            type="button"
            className={control}
            onClick={() => onPrevious?.()}
            aria-disabled={onPrevious === null}
          >
            <span aria-hidden="true">←</span> Previous decision
          </button>
          <button
            type="button"
            className={control}
            onClick={() => onNext?.()}
            aria-disabled={onNext === null}
          >
            Next decision <span aria-hidden="true">→</span>
          </button>
          <button type="button" className={control} onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      <p className="border-border mt-3 border-l-2 pl-3">
        <strong>Why:</strong> not recorded. A seat returns a choice among offered options;
        no explanation is part of this record.
      </p>

      <div className="mt-4 grid gap-x-8 gap-y-6 xl:grid-cols-2">
        <Part id={part("perceived")} title="What the seat perceived">
          {r.observation ? (
            <>
              <p className="text-muted-foreground">
                Observation {r.observation.sequence}, hash{" "}
                <span className="font-mono">{r.observationHash}</span>,{" "}
                <span className="font-mono">{r.observation.schemaVersion}</span>. Bearings
                are from the crosshair.
              </p>
              <Perceived o={r.observation} />
            </>
          ) : (
            <>
              <p>
                The observation was not kept for this record. What the record copied from
                it (its context, hash{" "}
                <span className="font-mono">{r.observationHash}</span>) follows.
              </p>
              <Context c={r.context} />
            </>
          )}
        </Part>

        <Part id={part("options")} title="What it could choose">
          <ul className="space-y-2">
            {AXES.map((axis) => {
              const options = r.legal[axis] as readonly string[];
              return (
                <li key={axis}>
                  <span className="font-mono font-semibold">{axis}</span>
                  {options.length < 2 ? (
                    <span className="text-muted-foreground">
                      {" "}
                      — only <span className="font-mono">{options[0]}</span> was offered;
                      not a choice
                    </span>
                  ) : (
                    <>
                      <span className="text-muted-foreground">
                        {" "}
                        — {options.length} options
                      </span>
                      <ul className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 font-mono">
                        {options.map((option) =>
                          option === r.frame[axis] ? (
                            <li key={option}>
                              <strong className="bg-accent rounded px-1">
                                <span aria-hidden="true">✓ </span>
                                {option} (chosen)
                              </strong>
                            </li>
                          ) : (
                            <li key={option} className="text-muted-foreground">
                              {option}
                            </li>
                          ),
                        )}
                      </ul>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </Part>

        <Part id={part("chose")} title="What it chose">
          <p className="text-muted-foreground">
            {previous
              ? `Every axis of the frame. Δ marks an axis whose choice differs from the previous executed decision (${previous.sequence}).`
              : "Every axis of the frame. No earlier executed decision in this file to compare it with."}
          </p>
          <dl className="grid grid-cols-[minmax(4.5rem,auto)_1fr] gap-x-3 gap-y-1.5">
            {AXES.map((axis) => (
              <div key={axis} className="contents">
                <dt className="font-mono font-semibold">
                  {changed.has(axis) ? <span aria-hidden="true">Δ </span> : null}
                  {axis}
                </dt>
                <dd>
                  <span
                    className={
                      changed.has(axis) ? "font-mono font-semibold" : "font-mono"
                    }
                  >
                    {r.frame[axis]}
                  </span>
                  {changed.has(axis) && previous ? (
                    <span>
                      {" "}
                      — changed from{" "}
                      <span className="font-mono">{previous.frame[axis]}</span>
                    </span>
                  ) : null}
                  {(r.legal[axis] as readonly string[]).length < 2 ? (
                    <span className="text-muted-foreground"> (the only option)</span>
                  ) : null}
                  <span className="text-muted-foreground block">
                    {meaning(axis, r.frame[axis])}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        </Part>

        <Part id={part("confidence")} title="How sure it said it was">
          <p>{CONFIDENCE_WORDS[r.confidence.source]}</p>
          {r.confidence.source === "none" ? null : (
            <Pairs
              rows={asked.map((axis): [string, ReactNode] => {
                const c = r.confidence.perAxis[axis];
                if (!c) return [axis, "not stated for this axis"];
                const parts = [
                  c.probability === null
                    ? "probability not stated"
                    : `probability ${formatValue(c.probability, 2)}`,
                  c.confidence === null
                    ? `${r.confidence.source === "verbalized" ? "stated confidence" : "confidence"} not stated`
                    : `${r.confidence.source === "verbalized" ? "stated confidence" : "confidence"} ${formatValue(c.confidence, 2)}`,
                ];
                return [axis, parts.join(" · ")];
              })}
            />
          )}
        </Part>

        <Part id={part("cost")} title="What it cost">
          <Pairs
            rows={[
              ["Provider", a.provider],
              ["Model", text(a.model)],
              ["Round trip", ms(a.wallLatencyMs)],
              ["Provider latency", ms(a.providerLatencyMs)],
              ["Injected delay", ms(a.injectedLatencyMs)],
              [
                "Bytes sent / received",
                `${count(a.requestBytes)} / ${count(a.responseBytes)}`,
              ],
              ["Tokens in / out", `${count(a.inputTokens)} / ${count(a.outputTokens)}`],
              [
                "Cost",
                a.reportedCostUsd === null
                  ? NOT_REPORTED
                  : `$${a.reportedCostUsd}, as the provider reported it`,
              ],
              ["Retries", count(a.retries)],
              ["Trace id", text(a.traceId)],
              ["Question hash", text(a.questionHash)],
            ]}
          />
        </Part>

        <Part id={part("legal")} title="Was it still legal">
          <p>{VALIDATION_WORDS[v.status]}</p>
          <Pairs
            rows={[
              [
                "Age at execution",
                v.ageAtExecutionMs === null
                  ? "none: it never reached execution"
                  : ms(v.ageAtExecutionMs),
              ],
              [
                "World changed",
                !checked
                  ? "not checked: it never reached execution"
                  : v.worldChanged.length === 0
                    ? "nothing the host checks had changed"
                    : v.worldChanged.map((c) => WORLD_CHANGE_WORDS[c] ?? c).join("; "),
              ],
              [
                "Illegal at execution",
                !checked
                  ? "not checked"
                  : v.illegalAtExecution.length === 0
                    ? "nothing it chose"
                    : v.illegalAtExecution.join(", "),
              ],
            ]}
          />
        </Part>

        <Part id={part("software")} title="What software did">
          <Pairs
            rows={[
              [
                "Executed",
                x.actionStart === null
                  ? "never started"
                  : `from ${seconds(x.actionStart)} to ${x.actionEnd === null ? "the end of the file" : seconds(x.actionEnd)} of simulation time`,
              ],
              [
                "Frame ended",
                x.endReason === null
                  ? NOT_REPORTED
                  : `${x.endReason}${FRAME_END_WORDS[x.endReason] ? `: ${FRAME_END_WORDS[x.endReason]}` : ""}`,
              ],
              [
                "Target slot",
                x.targetBound === null
                  ? "no target slot chosen"
                  : x.targetBound
                    ? "bound a living enemy"
                    : "bound nothing: the slot's enemy was no longer there",
              ],
              [
                "Place slot",
                x.placeBound === null
                  ? "no place slot chosen"
                  : x.placeBound
                    ? `bound a place (${x.placeKind ?? "kind not reported"})`
                    : "bound nothing: the slot's place was no longer known",
              ],
            ]}
          />
        </Part>

        <Part
          id={part("outcome")}
          title={`What happened in the next ${o ? formatValue(o.windowS, 0) : "few"} s`}
        >
          {o === null ? (
            <p>No outcome window: the decision never executed.</p>
          ) : (
            <>
              <Pairs
                rows={[
                  [
                    "Observed",
                    o.complete
                      ? `${seconds(o.elapsedS)} of ${seconds(o.windowS)}`
                      : `${seconds(o.elapsedS)} of ${seconds(o.windowS)}: incomplete, the episode or the file ended first`,
                  ],
                  [
                    "Dealt / taken",
                    `${formatValue(o.damageDealt, 0)} / ${formatValue(o.damageTaken, 0)} damage`,
                  ],
                  [
                    "Shots, hits, kills",
                    `${o.shotsFired} fired, ${o.hits} hit, ${o.kills} kill${o.kills === 1 ? "" : "s"}`,
                  ],
                  [
                    "Died",
                    o.died
                      ? `yes${o.timeToDeathS === null ? "" : `, after ${seconds(o.timeToDeathS)}`}`
                      : "no",
                  ],
                  [
                    "In an enemy's sight line",
                    o.exposureSamples === 0
                      ? "not sampled"
                      : `${o.exposedSamples} of ${o.exposureSamples} samples (${formatValue(o.exposedSamples / o.exposureSamples, 2)})`,
                  ],
                  ["Enemy rounds while in sight", String(o.enemyShotsInSight)],
                  ["Moved", metres(o.movedM)],
                  [
                    "Objective distance",
                    o.objectiveStartM === null && o.objectiveEndM === null
                      ? "none recorded"
                      : `${o.objectiveStartM === null ? "none recorded" : metres(o.objectiveStartM)} → ${o.objectiveEndM === null ? "none recorded" : metres(o.objectiveEndM)}`,
                  ],
                  [
                    "Its target",
                    o.target === null
                      ? "no target bound"
                      : `hit: ${yesNo(o.target.hit)}; eliminated: ${yesNo(o.target.killed)}; ${formatValue(o.target.damage, 0)} damage`,
                  ],
                  [
                    "Its place",
                    o.place === null
                      ? "no place bound"
                      : `reached: ${yesNo(o.place.reached)}${o.place.endReason === null ? "" : `; travel ended ${o.place.endReason}${TRAVEL_END_WORDS[o.place.endReason] ? ` (${TRAVEL_END_WORDS[o.place.endReason]})` : ""}`}`,
                  ],
                ]}
              />
              <p>
                {overlap === null || overlap === 0
                  ? "No other decision's window in this file shares time with this one."
                  : `This window shares time with ${overlap} other decision${overlap === 1 ? "'s" : "s'"} windows. An event inside it — a hit, a kill, a death — is counted in each of those windows too, so these figures are not an outcome of this decision alone.`}
              </p>
              {contract?.matches(r) ? (
                <p>
                  The experiment&rsquo;s declared contract{" "}
                  <span className="font-mono">{contract.id}</span> classes this window as{" "}
                  <strong>{contract.classify(r) ?? "unscored"}</strong>, by its rule as
                  declared before the run.
                </p>
              ) : null}
            </>
          )}
        </Part>
      </div>
    </section>
  );
}
