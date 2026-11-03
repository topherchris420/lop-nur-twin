/**
 * Ranging: how widely a fly searches, learned from how well searching that way
 * has repaid the energy it costs.
 *
 * The fly has two ways of searching, its own and a wider one (ceiling.ts). For
 * an hour at a time it uses one of them, and tallies the energy that came in and
 * the energy that went out, each read from its own reserve net of what
 * maintenance put there. Each way keeps a fading account of the two. It settles
 * on the wider way only when that way has clearly returned more per joule spent,
 * goes on trying both, and so can change its mind.
 *
 * Energy in per energy out, and not the two's difference: a meal barely pays for
 * the extra flying that found it, so the difference is a faint signal that a fly
 * would need many days to read (docs/ECHO_RANGING.md has that failure measured).
 *
 * What it reads: the body's reserve and its own physiology. Never a position, a
 * food patch or the world. Assigning blocks partly at random is what lets it
 * credit a way of searching with its results, when a meal may owe something to
 * the block before: the carry-over falls on both ways alike.
 *
 * The two settings and the rule are written. Which setting a fly comes to use is
 * not: flies with the same code and seed settle differently depending on where
 * food has been. A model choice throughout, not a claim about how flies do this,
 * and nothing here is evidence of awareness.
 */
import { mulberry32 } from "../../../lib/noise.js";
import type { AdapterStreams, DecisionInput, MotorCommand } from "../../fly/neural.js";
import type { Config } from "../../simulation.js";
import { OrganismAdapter, OrganismLife } from "../organism.js";
import { SEARCH_ARMS, type SearchSetting } from "./ceiling.js";

export const RANGING_VERSION = "echo-ranging/v2";

/** Every number is a model choice, fixed before any held-out run. */
export const RANGING_PARAMS = {
  /** How long one way of searching is kept before it is judged (s). */
  blockS: 3600,
  /** Evidence fades by one part in this, per block. */
  memoryBlocks: 48,
  /** Blocks of each way before it has any opinion. */
  minBlocks: 4,
  /** Share of blocks still given to a random way once it has one. */
  tryShare: 0.2,
  /** How many standard errors clear a difference has to be. */
  clearBy: 1,
} as const;
const P = RANGING_PARAMS;

/** First the fly's own way, which it keeps without clear evidence against it. */
export const RANGING_SETTINGS: readonly SearchSetting[] = [
  SEARCH_ARMS.default,
  SEARCH_ARMS.roam,
];

export interface RangingMemory {
  /** Faded energy in, energy out, and their products over each way's blocks (J). */
  gain: number[];
  spent: number[];
  gainGain: number[];
  gainSpent: number[];
  spentSpent: number[];
  /** Blocks each way has had, unfaded. */
  blocks: number[];
}

export interface RangingState extends RangingMemory {
  version: typeof RANGING_VERSION;
  /** Learning on, or held at what it has (a test of what was learned). */
  learning: boolean;
  /** The way in force. */
  way: number;
  blockFrom: number;
  energyWas: number;
  blockGain: number;
  blockSpent: number;
  started: boolean;
}

const zeros = () => RANGING_SETTINGS.map(() => 0);

export const noRangingMemory = (): RangingMemory => ({
  gain: zeros(),
  spent: zeros(),
  gainGain: zeros(),
  gainSpent: zeros(),
  spentSpent: zeros(),
  blocks: zeros(),
});

export class Ranging {
  readonly rng: () => number;
  readonly state: RangingState = {
    version: RANGING_VERSION,
    learning: true,
    way: 0,
    blockFrom: 0,
    energyWas: 0,
    blockGain: 0,
    blockSpent: 0,
    started: false,
    ...noRangingMemory(),
  };

  constructor(seed: number) {
    // A stream of its own: it never takes a draw from the fly's others.
    this.rng = mulberry32((seed ^ 0x72616e67) >>> 0);
  }

  get setting(): SearchSetting {
    return RANGING_SETTINGS[this.state.way]!;
  }

  /** Follow the body's energy; a block's end credits its way and chooses the next. */
  observe(t: number, energyJ: number): void {
    const s = this.state;
    if (!s.started) {
      s.started = true;
      s.blockFrom = t;
      s.energyWas = energyJ;
      s.way = this.choose();
      return;
    }
    const change = energyJ - s.energyWas;
    s.energyWas = energyJ;
    if (change > 0) s.blockGain += change;
    else s.blockSpent -= change;
    if (t - s.blockFrom < P.blockS) return;
    if (s.learning) this.credit(s.way, s.blockGain, s.blockSpent);
    s.blockFrom = t;
    s.blockGain = 0;
    s.blockSpent = 0;
    s.way = this.choose();
  }

  credit(way: number, gainJ: number, spentJ: number): void {
    const s = this.state;
    const fade = 1 - 1 / P.memoryBlocks;
    for (let i = 0; i < s.gain.length; i++) {
      s.gain[i]! *= fade;
      s.spent[i]! *= fade;
      s.gainGain[i]! *= fade;
      s.gainSpent[i]! *= fade;
      s.spentSpent[i]! *= fade;
    }
    s.gain[way]! += gainJ;
    s.spent[way]! += spentJ;
    s.gainGain[way]! += gainJ * gainJ;
    s.gainSpent[way]! += gainJ * spentJ;
    s.spentSpent[way]! += spentJ * spentJ;
    s.blocks[way]! += 1;
  }

  /** What a way has returned per joule spent, or null before it has spent any. */
  average(way: number): number | null {
    const s = this.state;
    return s.spent[way]! > 0 ? s.gain[way]! / s.spent[way]! : null;
  }

  /** How many standard errors the wider way's return stands above the fly's own. */
  clearance(): number {
    const s = this.state;
    if (s.blocks.some((b) => b < P.minBlocks)) return 0;
    const returns: number[] = [];
    let variance = 0;
    for (let i = 0; i < s.gain.length; i++) {
      const spent = s.spent[i]!;
      if (spent <= 0) return 0;
      const r = s.gain[i]! / spent;
      returns.push(r);
      // The variance of a ratio of totals, from each block's departure from it.
      variance +=
        Math.max(0, s.gainGain[i]! - 2 * r * s.gainSpent[i]! + r * r * s.spentSpent[i]!) /
        (spent * spent);
    }
    if (variance <= 0) return 0;
    return (returns[1]! - returns[0]!) / Math.sqrt(variance);
  }

  /** The way its evidence favors. */
  best(): number {
    return this.clearance() >= P.clearBy ? 1 : 0;
  }

  private choose(): number {
    const s = this.state;
    if (!s.learning) return this.best();
    const open = s.blocks.flatMap((b, i) => (b < P.minBlocks ? [i] : []));
    if (open.length) return open[Math.floor(this.rng() * open.length)]!;
    if (this.rng() < P.tryShare) return Math.floor(this.rng() * s.blocks.length);
    return this.best();
  }

  /** Hold what it has (or nothing) and act on it at once: a test of what was learned. */
  hold(memory: RangingMemory): void {
    const s = this.state;
    s.learning = false;
    s.gain = [...memory.gain];
    s.spent = [...memory.spent];
    s.gainGain = [...memory.gainGain];
    s.gainSpent = [...memory.gainSpent];
    s.spentSpent = [...memory.spentSpent];
    s.blocks = [...memory.blocks];
    s.way = this.best();
  }

  memory(): RangingMemory {
    const s = this.state;
    return {
      gain: [...s.gain],
      spent: [...s.spent],
      gainGain: [...s.gainGain],
      gainSpent: [...s.gainSpent],
      spentSpent: [...s.spentSpent],
      blocks: [...s.blocks],
    };
  }
}

/** The organism, ranging as it has learned to. Everything else is unchanged. */
export class RangingAdapter extends OrganismAdapter {
  readonly ranging: Ranging;

  constructor(rng: () => number, streams: AdapterStreams, seed: number) {
    super(rng, streams, seed);
    this.ranging = new Ranging(seed);
  }

  override get state() {
    return { ...super.state, ranging: this.ranging.state };
  }

  override decide(input: DecisionInput): MotorCommand {
    const energyJ =
      input.body.reserve * input.params.reserveJ - this.physiology.state.maintenanceJ;
    this.ranging.observe(input.body.t, energyJ);
    return super.decide({
      ...input,
      params: { ...input.params, ...this.ranging.setting },
    });
  }
}

export class RangingLife extends OrganismLife {
  constructor(config: Config) {
    super(config, (rng, streams, seed) => new RangingAdapter(rng, streams, seed));
  }

  get learner(): Ranging {
    const a = this.organism;
    if (!(a instanceof RangingAdapter)) throw new Error("expected the ranging adapter");
    return a.ranging;
  }
}
