/**
 * Claims 14, 17 and 18: the physics benchmark, the encounter study and the
 * Noeterra experiment.
 *
 * Records: the lag-compensated traces in docs/benchmarks/fly-physics/,
 * docs/benchmarks/first-contact/encounter.json, and the registered run under
 * docs/benchmarks/noeterra-civilization/.
 */
import type { Binding } from "../check.js";
import { REGISTER } from "../documents.js";
import { at, list, num, only, readJson, str } from "../records.js";
import { fixed, percent, says } from "../statement.js";

const trace = (plan: string) =>
  at(readJson(`docs/benchmarks/fly-physics/${plan}--lag-compensated.json`), "metrics");
const encounter = () => readJson("docs/benchmarks/first-contact/encounter.json");
const NOETERRA = "docs/benchmarks/noeterra-civilization/CV-11b7adb76f31fa3d4307bd0b";

/** The share of sessions with any escape, alone and as each live partner. */
function escapeShares() {
  const alone = num(encounter(), "conditions.solitary.escapes.any.estimate");
  const over = (id: string) =>
    num(
      only(list(encounter(), "contrasts"), (c) => str(c, "id") === id, `contrast ${id}`),
      "anyEscape.estimate",
    );
  // E1 and E2 are each live partner's share less the solitary one.
  return { alone, live: [over("E1") + alone, over("E2") + alone] };
}

export const worlds: Binding[] = [
  {
    id: "14.walking",
    doc: REGISTER,
    section: "14",
    statement: () => {
      const walk = trace("walk-2cms");
      const turn = trace("turn-on-the-spot");
      return says`the 2 cm/s plan achieved ${fixed(num(walk, "progress_ratio"), 4)} of its forward progress with ${fixed(num(walk, "heading_drift_deg"), 2)}° heading drift; turning on the spot about ${fixed(num(turn, "physical_turn_rate_dps"), 0)}°/s against ${fixed(num(turn, "planned_turn_rate_dps"), 0)}°/s commanded`;
    },
  },
  {
    id: "17.encounters",
    doc: REGISTER,
    section: "17",
    statement: () => {
      const { alone, live } = escapeShares();
      return says`escaped from each other in ${percent(Math.min(...live))}–${percent(Math.max(...live))}% of sessions against ${percent(alone)}% alone`;
    },
  },
  {
    id: "18.noeterra",
    doc: REGISTER,
    section: "18",
    statement: () => {
      const run = readJson(`${NOETERRA}/registry-run.json`);
      const turns = num(readJson(`${NOETERRA}/plan.json`), "design.parameters.turns");
      if (str(run, "hypothesis_verdict") !== "supported")
        throw new Error("the registry no longer records it as supported");
      return says`cut mean wars declared from ${fixed(num(run, "measurements.control_mean"), 2)} to ${fixed(num(run, "measurements.treatment_mean"), 2)} over ${turns} seasons`;
    },
  },
];
