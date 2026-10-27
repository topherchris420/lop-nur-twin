import type { AdapterStreams, DecisionInput, MotorCommand } from "../../fly/neural.js";
import { ImmortalAdapter, type ResearchFlags } from "../immortal/adapter.js";
import { OlfactoryNavigation, olfactoryView, OLFACTION_VERSION } from "./olfaction.js";

export class ForagingAdapter extends ImmortalAdapter {
  readonly olfaction: OlfactoryNavigation;
  readonly olfactoryNavigation: boolean;
  constructor(
    rng: () => number,
    streams: AdapterStreams,
    seed: number,
    flags: ResearchFlags,
    enabled: boolean,
  ) {
    super(rng, streams, seed, flags);
    this.olfactoryNavigation = enabled;
    this.olfaction = new OlfactoryNavigation(seed);
    this.descriptor.id = OLFACTION_VERSION;
    this.descriptor.label = "ECHO olfactory research composition";
    this.descriptor.fidelity +=
      " Optional published behavioral odor ON/OFF filters and model walking modulation; no additional simulated neurons.";
  }
  override get state() {
    return {
      ...super.state,
      olfactoryNavigation: this.olfactoryNavigation,
      olfaction: this.olfaction.state,
    };
  }
  protected override intention(input: DecisionInput): MotorCommand {
    if (!this.olfactoryNavigation) return super.intention(input);
    const view = olfactoryView(input);
    this.olfaction.sample(view.odour, input.dt);
    const intention = super.intention(input);
    // Tissue protection owns the body. Sense continues adapting during recovery.
    if (
      this.physiology.immortal &&
      (this.physiology.state.protective || this.physiology.state.sleeping)
    )
      return intention;
    return this.olfaction.modulate(intention, view, input.dt);
  }
}
