/** New research births only; the original fly's runner never selects this kind. */
import type { LifeKind } from "../continuity.js";
import {
  ImmortalLife,
  IMMORTAL_RESEARCH_LIFE,
  researchGenesis,
  type ImmortalGenesis,
} from "../immortal/life.js";
import { ForagingAdapter } from "./adapter.js";
import { OLFACTION_VERSION } from "./olfaction.js";

export interface ForagingGenesis extends ImmortalGenesis {
  olfactoryNavigation: boolean;
}
export const foragingGenesis = (seed = 1201): ForagingGenesis => ({
  ...researchGenesis(seed),
  olfactoryNavigation: false,
});
export class ForagingLife extends ImmortalLife {
  constructor(g: ForagingGenesis) {
    if (typeof g.olfactoryNavigation !== "boolean")
      throw new Error("explicit olfactory research flag required");
    super(
      g,
      (rng, streams) =>
        new ForagingAdapter(rng, streams, g.seed, g.flags, g.olfactoryNavigation),
    );
  }
  override get adapter(): ForagingAdapter {
    const a = super.adapter;
    if (!(a instanceof ForagingAdapter)) throw new Error("wrong foraging adapter");
    return a;
  }
  override inspect() {
    return {
      ...super.inspect(),
      olfactoryNavigation: this.adapter.olfactoryNavigation,
      olfaction: { ...this.adapter.olfaction.state },
      olfactionClassification:
        "inferred behavioral filter outputs, not measured neuronal activity",
    };
  }
}
export const FORAGING_RESEARCH_LIFE: LifeKind<ForagingGenesis, ForagingLife> = {
  ...IMMORTAL_RESEARCH_LIFE,
  id: "echo-olfactory-research",
  versions: { ...IMMORTAL_RESEARCH_LIFE.versions, foraging: OLFACTION_VERSION },
  build: (g) => new ForagingLife(g),
};
