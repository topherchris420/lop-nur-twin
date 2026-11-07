/**
 * A research fly living in the ecology, or the ecology with no fly at all.
 *
 * Two clocks: the ecosystem steps once a second, the fly ten times a second
 * (its body 200 times). Whatever the fly does to the world in a second is
 * gathered (the sugar its body took while feeding, from the item under its
 * feet, and, on fruit, the seconds it fed there) and applied as recorded
 * interactions at the end of that second, before the ecosystem lives the
 * next. So the ecosystem is a function of its seed and those records alone:
 * one stepped bare and handed the records reproduces it exactly, and with no
 * fly it steps exactly as it does beside one that never feeds (tests check).
 * The fly sees the item as it was at the start of the second it feeds in.
 *
 * The fly is the deployed configuration (`OrganismAdapter`), stepped as the
 * adaptation suite's research lives step it: its maintenance physiology
 * first, then the body. Every subject is built from a seed and named
 * `research-…`; none is Eva or ECHO.
 */
import { refuseOriginal } from "../firstContact/originals.js";
import { DigitalFly } from "../fly/fly.js";
import { OrganismAdapter } from "../life/organism.js";
import { Ecosystem, type EcosystemSpec, type Interaction } from "./ecosystem.js";
import { P } from "./params.js";
import { EcologyWorld } from "./world.js";

export const TICK_S = 0.1;

export interface FlyGenesis {
  /** The research subject's id: `research-…`. */
  subject: string;
  seed: number;
  start: [number, number];
  yaw: number;
  startReserve: number;
}

export class EcologicalLife {
  readonly eco: Ecosystem;
  readonly world: EcologyWorld;
  readonly fly: DigitalFly | null;
  readonly subject: string | null;
  tick = 0;
  private fedJ = 0;
  private feedS = 0;
  /** This second's feeding, by item: sugar the body took (mg) and seconds fed. */
  private readonly pending = new Map<string, { mg: number; s: number; fruit: boolean }>();
  /** Energy the maintenance physiology supplied (J): artificial, kept apart from food. */
  maintenanceJ = 0;
  constructor(spec: EcosystemSpec, fly: FlyGenesis | null) {
    this.eco = new Ecosystem(spec);
    this.world = new EcologyWorld(this.eco);
    if (!fly) {
      this.fly = null;
      this.subject = null;
      return;
    }
    refuseOriginal(fly.subject, "ecology subject");
    if (!fly.subject.startsWith("research-"))
      throw new Error("an ecology subject's id starts with research-");
    this.subject = fly.subject;
    this.fly = new DigitalFly({
      seed: fly.seed,
      world: this.world,
      start: { p: [fly.start[0], 0.0011, fly.start[1]], yaw: fly.yaw },
      config: { startReserve: fly.startReserve },
      adapter: (rng, streams) => new OrganismAdapter(rng, streams, fly.seed),
    });
  }

  get organism(): OrganismAdapter | null {
    return this.fly ? (this.fly.adapter as OrganismAdapter) : null;
  }

  /** Simulated time (s). */
  get t(): number {
    return Number((this.tick * TICK_S).toFixed(6));
  }

  step(ticks: number): void {
    for (let k = 0; k < ticks; k++) {
      const t = this.t;
      // The ecosystem lives the second this tick falls in, after the last one's interactions.
      while (this.eco.t <= t + 1e-9) {
        this.flush();
        this.eco.step();
      }
      const fly = this.fly;
      if (fly) {
        const a = this.organism!;
        const capacity = fly.params.reserveJ;
        const supplied = a.physiology.advance(TICK_S, {
          mode: fly.state.mode,
          reserve: Math.min(fly.state.reserve, capacity),
          capacity,
        });
        if (supplied > 0) {
          const before = fly.state.reserve;
          fly.state.reserve = Math.min(capacity, fly.state.reserve + supplied);
          this.maintenanceJ += fly.state.reserve - before;
        }
        fly.advance(TICK_S);
        this.interact(fly);
      }
      this.tick++;
    }
  }

  /** What the fly did to the world this tick, applied as recorded interactions. */
  private interact(fly: DigitalFly): void {
    const c = fly.state.counts;
    const dJ = c.fedJ - this.fedJ,
      dS = c.feedS - this.feedS;
    this.fedJ = c.fedJ;
    this.feedS = c.feedS;
    if (!(dJ > 0)) return;
    const s = fly.state;
    // Food lies on the yard's ground (y = 0), under the standing body.
    const item = this.world.foodAt([s.p[0], 0, s.p[2]]);
    // The body fed on what it entered feeding on; if that is gone the intake is unbacked.
    const id = item?.id ?? "nothing";
    const p = this.pending.get(id) ?? { mg: 0, s: 0, fruit: item?.kind === "fruit" };
    p.mg += dJ / P("sugarJPerMg");
    p.s += dS;
    this.pending.set(id, p);
  }

  /** Apply the gathered second's interactions, in a fixed order (by item id). */
  private flush(): void {
    if (!this.pending.size) return;
    const who = this.subject!;
    for (const id of [...this.pending.keys()].sort()) {
      const p = this.pending.get(id)!;
      this.eco.consume(id, p.mg, who);
      if (p.fruit) this.eco.inoculate(id, p.s, who);
    }
    this.pending.clear();
  }
}

/**
 * An ecosystem stepped bare for `steps` seconds with recorded interactions
 * applied where a life applied them: at the end of the second they fell in.
 */
export function replay(
  spec: EcosystemSpec,
  interactions: readonly Interaction[],
  steps: number,
): Ecosystem {
  const eco = new Ecosystem(spec);
  let k = 0;
  for (let i = 0; i < steps; i++) {
    while (k < interactions.length && interactions[k]!.t === eco.t)
      eco.apply(interactions[k++]!);
    eco.step();
  }
  return eco;
}
