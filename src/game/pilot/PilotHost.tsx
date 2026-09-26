import { useEffect } from "react";
import { readFlag, readIdParam } from "@/lib/params";
import { damageObservers, type AppliedDamage } from "../core/combat";
import { useGameStore } from "../core/gameStore";
import { aggregateEpisodes } from "./metrics";
import { pilot } from "./pilot";
import { parseTrace } from "./recorder";
import { readStoredTrace, storeTraceLocally } from "./traceStorage";

/**
 * Keeps the pilot seat in step with the discrete game state. Renders nothing.
 *
 * - Puts the brain the store names into the seat, with its seed, fallback and
 *   trace, whenever any of those change.
 * - Feeds the pilot's statistics from the damage resolver's read-only tap.
 * - Binds `H` to TAKE CONTROL during a match.
 * - Loads `?trace=last` for the replay brain, and with `?record=1` keeps the
 *   last trace in local storage when a match ends.
 */

export function PilotHost() {
  const brain = useGameStore((s) => s.brain);
  const seed = useGameStore((s) => s.brainSeed);
  const fallback = useGameStore((s) => s.brainFallback);
  const trace = useGameStore((s) => s.replayTrace);
  const screen = useGameStore((s) => s.screen);

  // `?brain=replay&trace=last` replays the trace this browser last kept.
  useEffect(() => {
    if (readIdParam("trace") !== "last") return;
    const text = readStoredTrace();
    if (!text) return;
    const parsed = parseTrace(text);
    if (parsed.ok) useGameStore.getState().setReplayTrace(parsed.trace);
  }, []);

  useEffect(() => {
    pilot.setBrain(brain, { seed, fallback, trace });
  }, [brain, seed, fallback, trace]);

  useEffect(() => {
    const observe = (report: AppliedDamage): void =>
      pilot.onDamage(
        report.attacker?.isPlayer === true,
        report.victim.isPlayer,
        report.amount,
      );
    damageObservers.push(observe);
    return () => {
      const index = damageObservers.indexOf(observe);
      if (index >= 0) damageObservers.splice(index, 1);
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.code !== "KeyH" || event.repeat) return;
      if (!pilot.active) return;
      const current = useGameStore.getState().screen;
      if (current !== "playing") return;
      event.preventDefault();
      pilot.takeover();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (screen === "results" && readFlag("record"))
      storeTraceLocally(pilot.exportTrace());
  }, [screen]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    // Dev-only, like `__combat`: the benchmark and the browser checks read the
    // pilot's counters and trace through this rather than scraping the HUD.
    (globalThis as { __jev?: unknown }).__jev = {
      pilot,
      telemetry: pilot.telemetry,
      episode: () => pilot.episode(),
      samples: () => pilot.metrics.samples(),
      exportTrace: () => pilot.exportTrace(),
      loadTrace: (text: string) => {
        const parsed = parseTrace(text);
        if (parsed.ok) useGameStore.getState().setReplayTrace(parsed.trace);
        return parsed.ok ? { ok: true, records: parsed.trace.records.length } : parsed;
      },
      takeover: () => pilot.takeover(),
      aggregate: aggregateEpisodes,
      /** Start the statistics over, so a benchmark measures only its own window. */
      resetMetrics: () => pilot.resetMetrics(),
    };
    return () => {
      (globalThis as { __jev?: unknown }).__jev = undefined;
    };
  }, []);

  return null;
}
