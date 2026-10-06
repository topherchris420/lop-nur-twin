/**
 * The SOUL files that define the four perspectives, as imported from
 * `topherchris420/james_library` (hashes and commit in `../data/source.json`).
 * Loaded on the server only: a soul is the system prompt of a model meeting
 * and is shown nowhere else.
 */
import perspectives from "../data/perspectives.json" with { type: "json" };
import type { Perspective } from "./perspectives.js";

/** The SOUL file's text for one perspective, exactly as imported. */
export function soulText(name: Perspective): string {
  const soul = perspectives.souls.find((s) => s.name === name);
  if (!soul) throw new Error(`no SOUL file bundled for ${name}`);
  return soul.text;
}
