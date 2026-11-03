/**
 * The one improvement: judge a remembered food place by what is at it, not by
 * what is in the air.
 *
 * The controller counts a return as fruitless only when the fly, back at a
 * remembered food place, has "neither food in view nor its odour"
 * (`controller.ts`). In Study B's yard the food's odour reaches almost
 * everywhere (detectable in 99% of a development life's ticks), so a fly back
 * at a place the food has left still smells the food elsewhere and never counts
 * the miss. The place keeps drawing it back, and it is never let go.
 *
 * This layer adds one rule. Whenever a hungry fly comes within reach of a
 * remembered food place (the controller's own 3 m), and no food is in view
 * there, that visit is a miss, whatever it smells, once per visit. The miss
 * goes where the navigator sends its own: to the place's valuation, so the
 * mushroom body learns the omission, and a place remembered under the
 * bookkeeping's rule is forgotten after its two misses. Nothing else changes:
 * the fly's memory, circuit, self-model and commands are the organism's, and
 * every command still passes the body's gate.
 *
 * A model choice, as every rule here is: real flies' evidence for an empty
 * patch is not known to work this way.
 */
import type { Place } from "../fly/navigation.js";
import type { AdapterStreams, DecisionInput, MotorCommand } from "../fly/neural.js";
import { OrganismAdapter } from "../life/organism.js";
import { additive, continuation, type AdditiveRelease } from "./update.js";
import type { RegisteredRelease } from "./releases.js";

/** Within this of a remembered place (by the fly's estimate), it is there: the controller's `GOAL_REACHED_M`. */
export const REACH_M = 3;
export const EVIDENCE_VERSION = "echo-place-evidence/v1";

/** What the layer holds: the visit it has judged, and how many misses it has counted. */
export class PlaceEvidence {
  /** The place the fly is at and has been judged at, until it leaves it. */
  judged: Place | null = null;
  misses = 0;
}

export class EvidenceAdapter extends OrganismAdapter {
  readonly evidence: PlaceEvidence;

  constructor(rng: () => number, streams: AdapterStreams, seed: number) {
    super(rng, streams, seed);
    this.evidence = new PlaceEvidence();
  }

  override get state() {
    return { ...super.state, evidence: { misses: this.evidence.misses } };
  }

  override decide(input: DecisionInput): MotorCommand {
    this.judge(input);
    return super.decide(input);
  }

  /** A hungry visit to a remembered food place with no food in view there is a miss. */
  private judge(input: DecisionInput): void {
    const nav = this.inner.state.nav,
      ev = this.evidence;
    const dist = (p: Place) => Math.hypot(p.at[0] - nav.est[0], p.at[1] - nav.est[1]);
    // Leaving the judged place (or its being forgotten) ends the visit.
    if (ev.judged && (!nav.places.includes(ev.judged) || dist(ev.judged) > 2 * REACH_M))
      ev.judged = null;
    let here: Place | null = null;
    for (const p of nav.places)
      if (p.kind === "food" && dist(p) < REACH_M && (!here || dist(p) < dist(here)))
        here = p;
    if (!here || here === ev.judged) return;
    if (1 - input.body.reserve <= input.params.hungerSeek) return;
    ev.judged = here;
    if (input.sites.some((s) => s.food)) return;
    ev.misses++;
    if (this.valuation.missed(here)) nav.places = nav.places.filter((p) => p !== here);
  }
}

export const EVIDENCE: AdditiveRelease = {
  name: "evidence",
  version: ["evidence", EVIDENCE_VERSION],
  event: "evidence-continuation",
  Adapter: EvidenceAdapter,
  added: ["evidence"],
  interpretation:
    "The same organism, now counting a hungry visit to a remembered food place with no food in view as a miss, whatever it smells; its memories, circuit and streams are unchanged.",
};

const { release, kind } = additive(EVIDENCE);

export const EVIDENCE_RELEASE: RegisteredRelease = {
  release,
  kind,
  updates: { from: "baseline", continueFrom: continuation(EVIDENCE, kind) },
};
