/** Real `/api/state` responses for tests (see README.md), and helpers to derive variations. */
import data from "./live-2026-10-26.json" with { type: "json" };
import { parseObservation, type Observation } from "../observation.js";

export type Raw = Record<string, unknown> & { ticks: number; updated_at: number };

export const SEQUENCES = data.sequences as unknown as Record<
  "missed-tick" | "stone-to-flowers" | "drinking" | "fence-to-stone",
  Raw[]
>;

/** A deep copy of a raw state, safe to modify. */
export const raw = (r: Raw): Raw => structuredClone(r);

export const observations = (name: keyof typeof SEQUENCES): Observation[] =>
  SEQUENCES[name].map((r) => parseObservation(raw(r)));
