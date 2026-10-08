/**
 * The mathematical substrate this runtime serves: the index of `openai/math`
 * at the commit `scripts/math-substrate.ts index` pinned, bundled as data like
 * the evidence corpus. Its checks run when the runtime starts
 * (`MathematicalSubstrate.load`), never here.
 *
 * Server only. The browser bundle never imports this module — it carries none
 * of the index — and the lab's authority test fails if a lab module does.
 */
import index from "./data/openai-math.json" with { type: "json" };

export const bundledIndex = (): unknown => index;
