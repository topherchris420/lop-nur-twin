import { useEffect, useState } from "react";
import { fetchAircraft, type Aircraft } from "./flightData";

/** How often to re-poll ADSB.lol, in milliseconds (12 s). */
const POLL_INTERVAL_MS = 12_000;

/**
 * Runs a periodic ADS-B fetch loop and returns the most recent traffic
 * snapshot. This is a discrete-event React state update on a ~12 s cadence,
 * not frame-loop state — the render layer reads it once per refresh and drives
 * all per-frame motion from refs, per the house rules in AGENTS.md.
 *
 * A failed poll keeps the previous snapshot rather than blanking the sky.
 */
export function useFlightData(): Aircraft[] {
  const [aircraft, setAircraft] = useState<Aircraft[]>([]);

  useEffect(() => {
    let cancelled = false;
    let controller: AbortController | null = null;

    const poll = async () => {
      controller?.abort();
      controller = new AbortController();
      try {
        const next = await fetchAircraft(controller.signal);
        if (!cancelled) setAircraft(next);
      } catch {
        // Network hiccup or abort: keep the last good snapshot.
      }
    };

    void poll();
    const id = window.setInterval(() => void poll(), POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      controller?.abort();
      window.clearInterval(id);
    };
  }, []);

  return aircraft;
}
