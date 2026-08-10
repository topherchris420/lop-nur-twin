import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Images,
  Pause,
  Play,
  SkipBack,
  SkipForward,
} from "lucide-react";
import { TIMELINE_BOUNDS, getVisibleDatedAdditionCount } from "@/lib/layout";
import {
  SCRUB_AVAILABLE,
  SCRUB_FIRST_DATE,
  SCRUB_LAST_DATE,
  SCRUB_MIN_DAY,
  SCRUB_SPAN_DAYS,
  SCRUB_STOPS,
  describeScrubState,
  scrubStateAtDay,
} from "@/lib/timeScrubber";
import { EVIDENCE_CLASSIFICATIONS, EVIDENCE_CLASSIFICATION_META } from "@/lib/evidence";
import { XRAY_MODES, XRAY_MODE_META, describeXrayMode, type XrayMode } from "@/lib/xray";
import { PROVE_IT_REPORT } from "@/lib/forensics";
import { forensicDiff, DIFF_CHANNEL_META, DIFF_CHANNELS } from "@/lib/forensicDiff";
import { TEMPORAL_SNAPSHOT_DATES } from "@/lib/temporal";
import { frameEvidenceStrata } from "@/lib/flyTo";
import { isCoarsePointer } from "@/lib/touchInput";
import { useTwinStore } from "@/lib/store";
import { cn } from "@/lib/utils";

/**
 * The forensic console: every instrument that changes what the scene is
 * claiming, in one place.
 *
 * Four controls live here and they answer four different questions, which is
 * why they are not one control with four settings:
 *
 * - the **evidence timeline**, scrubbed by date — *what had been publicly
 *   evidenced by then?*
 * - the **construction timeline**, filtered by year — *was this here yet?*
 * - **X-ray** — *how certain is this allowed to look?*
 * - **PROVE IT** — *what survives a strict reading?*
 *
 * Every one of them subtracts from the scene, and each states what it is
 * subtracting in words next to itself. A filter that silently removes things is
 * a way to mislead yourself, and four of them stacked without readouts would be
 * four ways at once.
 *
 * Playback advances the scrubber on a timer rather than on the render loop.
 * The playhead is discrete store state that decides which subjects exist, so
 * stepping it sixty times a second would rebuild the scene graph sixty times a
 * second for a picture that only changes on ledger dates.
 */

/** Whole-span playback duration, in milliseconds, and the tick interval. */
const PLAY_DURATION_MS = 17_000;
const PLAY_TICK_MS = 120;

function ScrubTrack() {
  const scrubDay = useTwinStore((state) => state.scrubDay);
  const setScrubDay = useTwinStore((state) => state.setScrubDay);
  const state = useMemo(
    () => (scrubDay === null ? null : scrubStateAtDay(scrubDay)),
    [scrubDay],
  );
  // Parked and pre-evidence are different positions and must not read alike:
  // parked means no temporal filter at all, while the left end of the axis
  // means a real date at which nothing had been published yet.
  const parked = scrubDay === null;
  // Three positions, not two: parked (no temporal filter at all), the reserved
  // slot before the first source, and a real ledger date.
  const preEvidence = !parked && state === null;
  const readout = parked
    ? "Reading the model's current state. Scrub to a date to see what had been publicly evidenced by then."
    : describeScrubState(state);

  if (!SCRUB_AVAILABLE) {
    return (
      <p className="text-muted-foreground text-[9px] leading-relaxed">
        The temporal ledger holds fewer than two dated events, so there is nothing to
        scrub between.
      </p>
    );
  }

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <label
          htmlFor="evidence-scrub"
          className="text-muted-foreground text-[9px] tracking-[0.18em] uppercase"
        >
          Evidence timeline
        </label>
        <output
          htmlFor="evidence-scrub"
          className="text-foreground font-mono text-[11px] tabular-nums"
        >
          {parked
            ? "current state"
            : preEvidence
              ? `before ${SCRUB_FIRST_DATE ?? "the first source"}`
              : (state?.date ?? "—")}
        </output>
      </div>

      <div className="relative mt-1">
        <input
          id="evidence-scrub"
          type="range"
          min={SCRUB_MIN_DAY}
          max={SCRUB_SPAN_DAYS}
          step={1}
          value={scrubDay ?? SCRUB_SPAN_DAYS}
          aria-valuetext={readout}
          onChange={(event) => setScrubDay(Number(event.target.value))}
          className="accent-primary h-4 w-full cursor-ew-resize touch-pan-x"
        />
        {/* Ticks mark the dates the ledger can actually be read at. Between them
            nothing changes, because between them this project learned nothing. */}
        <div aria-hidden="true" className="pointer-events-none relative mt-0.5 h-1.5">
          {SCRUB_STOPS.map((stop) => (
            <span
              key={stop.date}
              className="bg-muted-foreground/70 absolute top-0 h-1.5 w-px"
              style={{
                left: `${
                  SCRUB_SPAN_DAYS === 0
                    ? 0
                    : ((stop.day - SCRUB_MIN_DAY) / (SCRUB_SPAN_DAYS - SCRUB_MIN_DAY)) *
                      100
                }%`,
              }}
            />
          ))}
        </div>
      </div>

      <div className="text-muted-foreground flex justify-between text-[8px] tabular-nums">
        <span>pre-evidence · {SCRUB_FIRST_DATE ?? "—"}</span>
        <span>{SCRUB_LAST_DATE ?? "—"}</span>
      </div>
      <p role="status" className="text-muted-foreground mt-1 text-[9px] leading-relaxed">
        {readout}
      </p>
    </div>
  );
}

function TransportControls() {
  const scrubPlaying = useTwinStore((state) => state.scrubPlaying);
  const toggleScrubPlaying = useTwinStore((state) => state.toggleScrubPlaying);
  const setScrubPlaying = useTwinStore((state) => state.setScrubPlaying);
  const setScrubDay = useTwinStore((state) => state.setScrubDay);
  const stepScrub = useTwinStore((state) => state.stepScrub);
  const reducedMotion = useTwinStore((state) => state.reducedMotion);

  /**
   * Playback. Under reduced motion the playhead jumps stop to stop with a long
   * dwell instead of gliding, because the glide is the part that is motion —
   * the information is in the stops.
   */
  useEffect(() => {
    if (!scrubPlaying || !SCRUB_AVAILABLE) return;

    if (reducedMotion) {
      const timer = window.setInterval(() => {
        const { scrubDay, stepScrub: step } = useTwinStore.getState();
        if (scrubDay !== null && scrubDay >= SCRUB_SPAN_DAYS) {
          setScrubPlaying(false);
          return;
        }
        step(1);
      }, 1600);
      return () => window.clearInterval(timer);
    }

    const increment = Math.max(1, (SCRUB_SPAN_DAYS * PLAY_TICK_MS) / PLAY_DURATION_MS);
    const timer = window.setInterval(() => {
      const { scrubDay } = useTwinStore.getState();
      const next = (scrubDay ?? SCRUB_MIN_DAY) + increment;
      if (next >= SCRUB_SPAN_DAYS) {
        setScrubDay(SCRUB_SPAN_DAYS);
        setScrubPlaying(false);
        return;
      }
      setScrubDay(next);
    }, PLAY_TICK_MS);
    return () => window.clearInterval(timer);
  }, [scrubPlaying, reducedMotion, setScrubDay, setScrubPlaying]);

  const buttonClass =
    "border-border hover:bg-accent focus-visible:ring-ring inline-flex size-6 items-center justify-center rounded border focus-visible:ring-2 focus-visible:outline-none disabled:opacity-40";

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => stepScrub(-1)}
        disabled={!SCRUB_AVAILABLE}
        title="Previous evidence date ([)"
        aria-label="Step to the previous evidence date"
        className={buttonClass}
      >
        <SkipBack className="size-3" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={toggleScrubPlaying}
        disabled={!SCRUB_AVAILABLE}
        title={
          scrubPlaying ? "Pause the evidence timeline" : "Play the evidence timeline"
        }
        aria-label={
          scrubPlaying ? "Pause the evidence timeline" : "Play the evidence timeline"
        }
        aria-pressed={scrubPlaying}
        className={buttonClass}
      >
        {scrubPlaying ? (
          <Pause className="size-3" aria-hidden="true" />
        ) : (
          <Play className="size-3" aria-hidden="true" />
        )}
      </button>
      <button
        type="button"
        onClick={() => stepScrub(1)}
        disabled={!SCRUB_AVAILABLE}
        title="Next evidence date (])"
        aria-label="Step to the next evidence date"
        className={buttonClass}
      >
        <SkipForward className="size-3" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={() => setScrubDay(null)}
        title="Park the scrubber at the model's current state"
        className="border-border hover:bg-accent focus-visible:ring-ring rounded border px-1.5 py-0.5 text-[9px] focus-visible:ring-2 focus-visible:outline-none"
      >
        Now
      </button>
    </div>
  );
}

function XrayControls() {
  const xrayMode = useTwinStore((state) => state.xrayMode);
  const setXrayMode = useTwinStore((state) => state.setXrayMode);
  const xrayFocus = useTwinStore((state) => state.xrayFocus);
  const setXrayFocus = useTwinStore((state) => state.setXrayFocus);

  return (
    <div>
      <fieldset>
        <legend className="text-muted-foreground text-[9px] tracking-[0.18em] uppercase">
          Evidence X-ray
        </legend>
        <div className="mt-1 flex flex-wrap gap-1">
          {XRAY_MODES.map((mode) => {
            const meta = XRAY_MODE_META[mode];
            const active = mode === xrayMode;
            return (
              <label
                key={mode}
                title={meta.description}
                className={cn(
                  "focus-within:ring-ring inline-flex cursor-pointer items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] focus-within:ring-2",
                  active
                    ? "border-primary/70 bg-accent/60 text-foreground"
                    : "border-border text-muted-foreground hover:bg-accent/40",
                )}
              >
                <input
                  type="radio"
                  name="xray-mode"
                  value={mode}
                  checked={active}
                  onChange={() => setXrayMode(mode)}
                  className="sr-only"
                />
                <span aria-hidden="true">{meta.glyph}</span>
                <span>{meta.shortLabel}</span>
                {/* The check mark is the redundant, non-colour cue. */}
                <span aria-hidden="true">{active ? "✓" : ""}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="mt-1.5" disabled={xrayMode === "off"}>
        <legend className="text-muted-foreground text-[9px] tracking-[0.18em] uppercase">
          Isolate layer
        </legend>
        <div className="mt-1 flex flex-wrap gap-1">
          <label
            className={cn(
              "focus-within:ring-ring inline-flex cursor-pointer items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] focus-within:ring-2",
              xrayFocus === null
                ? "border-primary/70 bg-accent/60 text-foreground"
                : "border-border text-muted-foreground hover:bg-accent/40",
              xrayMode === "off" && "opacity-50",
            )}
          >
            <input
              type="radio"
              name="xray-focus"
              checked={xrayFocus === null}
              onChange={() => setXrayFocus(null)}
              className="sr-only"
            />
            <span>All four</span>
            <span aria-hidden="true">{xrayFocus === null ? "✓" : ""}</span>
          </label>
          {EVIDENCE_CLASSIFICATIONS.map((classification) => {
            const meta = EVIDENCE_CLASSIFICATION_META[classification];
            const active = xrayFocus === classification;
            return (
              <label
                key={classification}
                title={meta.description}
                className={cn(
                  "focus-within:ring-ring inline-flex cursor-pointer items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] focus-within:ring-2",
                  active
                    ? "border-primary/70 bg-accent/60 text-foreground"
                    : "border-border text-muted-foreground hover:bg-accent/40",
                  xrayMode === "off" && "opacity-50",
                )}
              >
                <input
                  type="radio"
                  name="xray-focus"
                  checked={active}
                  onChange={() => setXrayFocus(classification)}
                  className="sr-only"
                />
                <span aria-hidden="true">{meta.glyph}</span>
                <span>{meta.label}</span>
                <span aria-hidden="true">{active ? "✓" : ""}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <p
        role="status"
        className="text-muted-foreground mt-1.5 text-[9px] leading-relaxed"
      >
        {describeXrayMode(xrayMode, xrayFocus)}
      </p>
    </div>
  );
}

function CompareControls() {
  const snapshotDate = useTwinStore((state) => state.snapshotDate);
  const comparisonDate = useTwinStore((state) => state.comparisonDate);
  const setComparisonDate = useTwinStore((state) => state.setComparisonDate);

  const diff = useMemo(
    () =>
      snapshotDate === null || comparisonDate === null
        ? null
        : forensicDiff(snapshotDate, comparisonDate),
    [snapshotDate, comparisonDate],
  );

  return (
    <div>
      <label
        htmlFor="comparison-date"
        className="text-muted-foreground block text-[9px] tracking-[0.18em] uppercase"
      >
        Compare with
      </label>
      <select
        id="comparison-date"
        value={comparisonDate ?? ""}
        onChange={(event) => setComparisonDate(event.target.value || null)}
        disabled={snapshotDate === null}
        className="border-border bg-secondary/60 focus-visible:ring-ring mt-1 w-full rounded border px-1 py-0.5 text-[10px] focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
      >
        <option value="">none</option>
        {TEMPORAL_SNAPSHOT_DATES.map((date) => (
          <option key={date} value={date}>
            {date}
          </option>
        ))}
      </select>

      <p role="status" className="text-muted-foreground mt-1 text-[9px] leading-relaxed">
        {snapshotDate === null ? (
          "Scrub to a date first — a comparison needs two of them."
        ) : diff === null ? (
          "Pick a second date to mark what changed, on the ground and in the tables."
        ) : diff.empty ? (
          `Nothing differs between ${diff.from} and ${diff.to}.`
        ) : (
          <>
            {DIFF_CHANNELS.filter((channel) => diff.byChannel[channel].length > 0)
              .map(
                (channel) =>
                  `${DIFF_CHANNEL_META[channel].label.toLowerCase()} ${diff.byChannel[channel].length}`,
              )
              .join(" · ")}
            {" — marked on the ground; full comparison on the analysis page."}
          </>
        )}
      </p>
    </div>
  );
}

function ConstructionYear() {
  const activeTimelineYear = useTwinStore((state) => state.activeTimelineYear);
  const setActiveTimelineYear = useTwinStore((state) => state.setActiveTimelineYear);
  const visible = getVisibleDatedAdditionCount(activeTimelineYear);
  const total = getVisibleDatedAdditionCount(TIMELINE_BOUNDS.maxYear);

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <label
          htmlFor="timeline-year"
          className="text-muted-foreground text-[9px] tracking-[0.18em] uppercase"
        >
          Construction timeline
        </label>
        <output
          htmlFor="timeline-year"
          className="text-foreground font-mono text-[11px] tabular-nums"
        >
          {activeTimelineYear} · {visible}/{total}
        </output>
      </div>
      <input
        id="timeline-year"
        type="range"
        min={TIMELINE_BOUNDS.minYear}
        max={TIMELINE_BOUNDS.maxYear}
        step={1}
        value={activeTimelineYear}
        aria-valuetext={`${activeTimelineYear}; ${visible} of ${total} dated additions visible`}
        onChange={(event) => setActiveTimelineYear(Number(event.target.value))}
        className="accent-primary mt-1 h-4 w-full cursor-ew-resize touch-pan-x"
      />
    </div>
  );
}

/**
 * Frame the exploded diagram whenever stratified X-ray is entered.
 *
 * Lives here rather than in the store action because the store must not import
 * the camera helpers — `flyTo.ts` reads the store, and the cycle would be real.
 * An effect on the mode also covers the keyboard shortcut, which a click
 * handler would miss.
 */
function useStrataFraming(): void {
  const xrayMode = useTwinStore((state) => state.xrayMode);
  // Seeded to "off" rather than to the current mode, so a cold load of
  // `?xray=stratified` frames the diagram too. Someone who deep-linked into the
  // exploded view asked to see it.
  const previous = useRef<XrayMode>("off");
  useEffect(() => {
    if (xrayMode === "stratified" && previous.current !== "stratified") {
      frameEvidenceStrata();
    }
    previous.current = xrayMode;
  }, [xrayMode]);
}

export function ForensicConsole() {
  const [open, setOpen] = useState(() => !isCoarsePointer());
  useStrataFraming();
  const proveIt = useTwinStore((state) => state.proveIt);
  const toggleProveIt = useTwinStore((state) => state.toggleProveIt);
  const showReference = useTwinStore((state) => state.showReference);
  const toggleReference = useTwinStore((state) => state.toggleReference);
  const showUncertainty = useTwinStore((state) => state.showUncertainty);
  const toggleUncertainty = useTwinStore((state) => state.toggleUncertainty);

  return (
    <section
      aria-labelledby="forensic-console-heading"
      className={cn(
        "hud-panel pointer-events-auto absolute bottom-4 left-1/2 z-20 -translate-x-1/2",
        "w-[41rem] max-w-[calc(100vw-1.5rem)] px-3 py-2 font-mono",
        "max-sm:bottom-2",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <h2
          id="forensic-console-heading"
          className="text-muted-foreground text-[9px] tracking-[0.2em] uppercase"
        >
          Forensic console
        </h2>
        <div className="flex items-center gap-1.5">
          {/*
            The hero control. It is a single button rather than a mode in a list
            because what it does is not a viewing preference: it removes every
            claim the cited evidence does not carry, which is the one question
            this whole model exists to be able to answer honestly.
          */}
          <button
            type="button"
            onClick={toggleProveIt}
            aria-pressed={proveIt}
            title={`Draw only what cited public evidence defends — ${PROVE_IT_REPORT.survivingSubjects} of ${PROVE_IT_REPORT.totalSubjects} subjects (P)`}
            className={cn(
              "focus-visible:ring-ring rounded border px-2.5 py-1 text-[10px] tracking-[0.18em] uppercase focus-visible:ring-2 focus-visible:outline-none",
              proveIt
                ? "border-primary bg-primary text-primary-foreground"
                : "border-primary/60 text-foreground hover:bg-accent",
            )}
          >
            {proveIt ? "Restore" : "Prove it"}
          </button>
          <button
            type="button"
            onClick={toggleReference}
            aria-pressed={showReference}
            title="Register public reference imagery beside the model (V)"
            aria-label="Reference imagery"
            className={cn(
              "border-border hover:bg-accent focus-visible:ring-ring inline-flex size-6 items-center justify-center rounded border focus-visible:ring-2 focus-visible:outline-none",
              showReference && "bg-accent",
            )}
          >
            <Images className="size-3" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls="forensic-console-body"
            className="border-border hover:bg-accent focus-visible:ring-ring inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] focus-visible:ring-2 focus-visible:outline-none"
          >
            {open ? (
              <ChevronDown className="size-3" aria-hidden="true" />
            ) : (
              <ChevronUp className="size-3" aria-hidden="true" />
            )}
            {open ? "Hide" : "Show"}
          </button>
        </div>
      </div>

      <div id="forensic-console-body" hidden={!open} className="mt-2">
        <div className="grid grid-cols-[1fr_auto] items-end gap-2">
          <ScrubTrack />
          <TransportControls />
        </div>

        <div className="border-border mt-2 grid grid-cols-2 gap-3 border-t pt-2 max-sm:grid-cols-1">
          <ConstructionYear />
          <CompareControls />
        </div>

        <div className="border-border mt-2 border-t pt-2">
          <XrayControls />
        </div>

        <label className="mt-2 flex cursor-pointer items-start gap-2 text-[9px] leading-relaxed">
          <input
            type="checkbox"
            checked={showUncertainty}
            onChange={toggleUncertainty}
            className="accent-primary focus-visible:ring-ring mt-0.5 size-3 focus-visible:ring-2 focus-visible:outline-none"
          />
          <span>
            Draw uncertainty in space
            <span className="text-muted-foreground block">
              Halos at the documented positional radius, bands at the extent tolerance,
              and open-ended columns above every roof — because no cited source states the
              height of anything here. Nothing is drawn where no figure is stated. Needs
              quality tier 2.
            </span>
          </span>
        </label>
      </div>
    </section>
  );
}
