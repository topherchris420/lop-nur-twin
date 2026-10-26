/**
 * The mushroom-body controller: the reduced-order controller with one proxy
 * replaced by a learning circuit, so the change can be compared with the
 * controller it replaced.
 *
 * The proxy is the rule that gives up a remembered food place: two returns
 * that find nothing forget it, however often the fly fed there. Here the
 * mushroom-body model (`circuit.ts`) values each remembered place by the
 * landmark it is recognized by, learns from every meal and every fruitless return,
 * and a hungry fly goes back only to places it still values. The place
 * itself (where it was, by path integration, and its landmarks) stays
 * remembered as before, recognized and forgotten after `placeMemoryS`.
 *
 * Everything else (escape, grooming, walking, flight, landing, foraging by
 * odour, path integration) is the reduced-order controller's, unchanged, and
 * every command passes the fly's gate. The circuit simulates rate units:
 * 2,000 Kenyon cells, two output neurons and two dopaminergic neurons. It is
 * not a spiking model or a connectome, and nothing in it is evidence of
 * experience or awareness.
 */
import { ReducedOrderController } from "../controller.js";
import type {
  AdapterDescriptor,
  AdapterStreams,
  BodySnapshot,
  DecisionInput,
  FlyNeuralAdapter,
  MotorCommand,
} from "../neural.js";
import { MushroomBody } from "./circuit.js";
import {
  resolveMushroomBodyParams,
  type MushroomBodyConfig,
  type ResolvedMushroomBodyParams,
} from "./params.js";

export const MUSHROOM_BODY_DESCRIPTOR: AdapterDescriptor = {
  id: "mushroom-body/v1",
  label: "Mushroom-body controller",
  fidelity:
    "The reduced-order controller with its rule for giving up a remembered food place (two fruitless returns) replaced by a rate model of the mushroom body's associative learning, Bennett, Philippides & Nowotny 2021's mixed-valence model: 2,000 Kenyon cells coding the landmark each remembered food place is recognized by, approach and avoidance output neurons, and two dopaminergic neurons whose difference is the reward prediction error that changes the Kenyon-cell synapses. A meal is a rewarded trial, a return that finds nothing an unrewarded one, and a hungry fly goes back only to places whose learned output favours approach. Rate units, not spiking neurons or a connectome; everything else is the reduced-order controller's.",
  simulatesNeurons: true,
  regions: [
    {
      module: "place value (mushroom-body associative learning)",
      vfb: ["FBbt_00007385", "VFB_00102114"],
      relation: "functional association (published)",
      note: "Kenyon cells receive their sensory input in the calyx, from olfactory and visual projection neurons; dopaminergic and output neurons meet the Kenyon cells' axons in the lobes, which the imported reference does not hold. The same dopaminergic neurons drive appetitive visual and olfactory memories there (Vogt et al. 2014), and extinction recruits them when a predicted reward does not come (Felsenberg et al. 2017, 2018). The model's units stand for those populations, not identified neurons. Its cue is a landmark's identity, a visual feature: it is not a model of place learning, which in flies needs the ellipsoid body and not the mushroom bodies (Ofstad et al. 2011); where the place is stays the navigation bookkeeping's.",
    },
  ],
};

export interface MushroomBodyOptions {
  /** The fly's seed: the circuit's weights and Kenyon-cell assignments are drawn from streams of its own. */
  seed: number;
  config?: MushroomBodyConfig;
  /** Block the dopaminergic neurons' output in fruitless returns: nothing is learned from them (a lesion). */
  blockOmission?: boolean;
}

export class MushroomBodyController implements FlyNeuralAdapter {
  readonly descriptor = MUSHROOM_BODY_DESCRIPTOR;
  readonly inner: ReducedOrderController;
  readonly circuit: MushroomBody;
  readonly params: ResolvedMushroomBodyParams;

  constructor(rng: () => number, o: MushroomBodyOptions, streams?: AdapterStreams) {
    this.params = resolveMushroomBodyParams(o.config);
    this.circuit = new MushroomBody(this.params, o.seed, o.blockOmission === true);
    this.inner = new ReducedOrderController(rng, streams?.navigation, this.circuit);
  }

  /** Everything that decides the future, for the fly's state hash. */
  get state() {
    return { inner: this.inner.state, circuit: this.circuit.state };
  }

  start(body: BodySnapshot): void {
    this.inner.start(body);
  }

  decide(input: DecisionInput): MotorCommand {
    return this.inner.decide(input);
  }

  interrupt(input: DecisionInput): MotorCommand | null {
    return this.inner.interrupt(input);
  }
}

/** The adapter factory for a fly with seed `o.seed`. */
export const mushroomBodyAdapter =
  (o: MushroomBodyOptions) =>
  (rng: () => number, streams?: AdapterStreams): MushroomBodyController =>
    new MushroomBodyController(rng, o, streams);
