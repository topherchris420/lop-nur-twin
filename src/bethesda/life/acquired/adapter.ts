/**
 * The organism with acquired search: the same controller, memories and
 * physiology, and one addition its gains start at zero in. See search.ts.
 *
 * The layer sits where the controller's intention is on its way to the
 * self-model, so ECHO predicts from the command the body really gets. A layer
 * wrapped around the finished command would look to the self-model like a
 * fault in its own body.
 */
import type { AdapterStreams, DecisionInput, MotorCommand } from "../../fly/neural.js";
import type { ReducedOrderController } from "../../fly/controller.js";
import type { Navigator } from "../../fly/navigation.js";
import { OrganismAdapter, OrganismLife } from "../organism.js";
import type { Config } from "../../simulation.js";
import { AcquiredSearch, type ControllerView } from "./search.js";

export class AcquiredAdapter extends OrganismAdapter {
  readonly search: AcquiredSearch;

  constructor(rng: () => number, streams: AdapterStreams, seed: number) {
    super(rng, streams, seed);
    this.search = new AcquiredSearch(seed);
  }

  override get state() {
    return { ...super.state, search: this.search.state };
  }

  override decide(input: DecisionInput): MotorCommand {
    // Before the controller, so a meal it begins now counts from the next
    // decision, whatever the physiology holds the fly to in between.
    this.search.observe(input);
    return super.decide(input);
  }

  protected override shape(input: DecisionInput, intention: MotorCommand): MotorCommand {
    const inner = (
      this as unknown as {
        inner: { state: ReducedOrderController["state"]; nav: Navigator };
      }
    ).inner;
    const S = inner.state;
    const nav = inner.nav;
    const view: ControllerView = {
      busy: S.nav.goal?.kind === "return" || S.nav.search !== null,
      exploring: S.nav.goal?.kind === "explore",
      turnLongFlight(yaw) {
        const goal = S.nav.goal;
        if (!goal) return;
        const [x, z] = S.nav.est;
        const left = Math.hypot(goal.at[0] - x, goal.at[1] - z);
        const heading = yaw + S.nav.headingErr;
        // The point at this heading, in the yaw convention of units.ts.
        goal.at = [x + Math.cos(heading) * left, z - Math.sin(heading) * left];
        goal.nearest = left;
        goal.progressAt = input.body.t;
      },
      setOff(body) {
        return (
          nav.chooseGoal(
            true,
            body.home,
            input.params,
            body.t,
            { x: body.p[0], z: body.p[2] },
            true,
          )?.kind === "explore"
        );
      },
    };
    return this.search.shape(input, intention, view);
  }
}

export class AcquiredLife extends OrganismLife {
  constructor(config: Config) {
    super(config, (rng, streams, seed) => new AcquiredAdapter(rng, streams, seed));
  }

  get acquired(): AcquiredAdapter {
    const a = this.organism;
    if (!(a instanceof AcquiredAdapter)) throw new Error("expected the acquired adapter");
    return a;
  }
}
