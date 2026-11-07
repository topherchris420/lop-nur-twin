/**
 * A reduced connectome circuit, run in the fly's own loop: Shiu et al. 2024's
 * leaky integrate-and-fire model on a circuit cut from the whole brain by
 * the Python connectome backend's `reduce` command (its reduce.py).
 *
 * The integrator follows the backend's own engine (its lif.py) step for step, in the
 * same order, so that both give the same spikes from the same input (a test
 * replays a recording that engine made):
 *
 * 1. every neuron that has left rest and is not refractory is integrated
 *    exactly over the step: u ← (u − A g) e^(−dt/τm) + A g e^(−dt/τ), g ← g e^(−dt/τ),
 *    with u = v − v₀ and A = τ/(τ − τm);
 * 2. a neuron with v above threshold spikes;
 * 3. its spikes are queued for delivery `t_dly` later; the deliveries due now
 *    add w_syn × (signed synapse count) to each target's g, in the order the
 *    spikes and synapses come, skipping a target that is refractory; each
 *    input neuron driven this step gets w_syn × f_poi added to v, unless
 *    refractory;
 * 4. spiking neurons are reset (v = v_rst, g = 0).
 *
 * Input neurons (Poisson-driven or kicked) have no refractory period, as in
 * Shiu et al.'s `poi()`. A neuron at exactly v₀ with g = 0 stays there, so
 * only neurons that have left rest are integrated, as lif.py does. One
 * addition, for a fly off food: in floating point a decaying neuron never
 * quite reaches rest (it sticks about 10⁻¹² mV above v₀, its conductance at a
 * subnormal number), so once no input arrives, nothing is in flight and every
 * neuron is within `REST_EPS` (10⁻⁹ mV, and 10⁻⁹ in g) of rest, the circuit
 * is set to exact rest and stops integrating. That moves no membrane by more
 * than a nanovolt, and lets time off food cost nothing. lif.py does not do
 * this; the conformance test runs without it.
 *
 * This file holds no connectome: the circuit is a connectivity table derived
 * from FlyWire data, kept outside the repository and passed in.
 */

export const CIRCUIT_SCHEMA = "connectome-reduced-circuit/v1";

export interface CircuitFile {
  schema: typeof CIRCUIT_SCHEMA;
  id: string;
  source: Record<string, unknown>;
  terms: string;
  lif: {
    dt_ms: number;
    v_0_mV: number;
    v_rst_mV: number;
    v_th_mV: number;
    t_mbr_ms: number;
    tau_ms: number;
    t_rfc_ms: number;
    t_dly_ms: number;
    w_syn_mV: number;
    f_poi: number;
  };
  neurons: number;
  root_ids: string[];
  inputs: { key: string; indices: number[] };
  readout: { key: string; indices: number[] };
  indptr: number[];
  indices: number[];
  signed_count: number[];
}

/** Brian 2's `timestep`, as lif.py's `steps`: int((t + 1e-3 dt) / dt). */
export const stepsOf = (ms: number, dtMs: number): number =>
  Math.floor((ms + 1e-3 * dtMs) / dtMs);

const NEVER = -1e9;
/** How near rest every neuron must be before an idle circuit is set to exact rest (mV, and mV of g). */
export const REST_EPS = 1e-9;

export class ReducedCircuit {
  readonly file: CircuitFile;
  readonly n: number;
  readonly dtMs: number;
  readonly inputs: Int32Array;
  readonly readout: Int32Array;
  /** Spikes of each neuron since the circuit was made. */
  readonly counts: Int32Array;
  private readonly indptr: Int32Array;
  private readonly indices: Int32Array;
  private readonly weight: Float64Array;
  private readonly v: Float64Array;
  private readonly g: Float64Array;
  private readonly last: Float64Array;
  private readonly ref: Int32Array;
  private readonly touched: Uint8Array;
  /** Neurons that have left rest, in the order they did (lif.py's `active`). */
  private readonly act: Int32Array;
  private actN = 0;
  private readonly fired: Int32Array;
  private firedN = 0;
  private readonly fresh: Int32Array;
  private readonly drivenBuf: Int32Array;
  /** The delivery queue: one slot per step of delay, each its targets and weights in order. */
  private readonly qTgt: Int32Array[];
  private readonly qW: Float64Array[];
  private readonly qN: Int32Array;
  private readonly isReadout: Uint8Array;
  private readonly ev: number;
  private readonly eg: number;
  private readonly A: number;
  private readonly wPoi: number;
  private readonly delaySteps: number;
  step = 0;
  /** Readout spikes since the circuit was made. */
  readoutSpikes = 0;
  /** Recent readout spikes, by step (for a trailing-window rate); older ones are dropped. */
  private recent: number[] = [];
  private head = 0;

  constructor(file: CircuitFile, options: { weights?: Float64Array } = {}) {
    if (file.schema !== CIRCUIT_SCHEMA) throw new Error(`not a ${CIRCUIT_SCHEMA} file`);
    const p = file.lif;
    this.file = file;
    const n = (this.n = file.neurons);
    if (file.indptr.length !== n + 1 || file.indices.length !== file.signed_count.length)
      throw new Error("the circuit's wiring does not fit its neurons");
    this.dtMs = p.dt_ms;
    this.indptr = Int32Array.from(file.indptr);
    this.indices = Int32Array.from(file.indices);
    // lif.py: (count * sign) * w_syn, in float64.
    this.weight =
      options.weights ?? Float64Array.from(file.signed_count, (c) => c * p.w_syn_mV);
    if (this.weight.length !== this.indices.length)
      throw new Error("one weight per synapse pair");
    this.inputs = Int32Array.from(file.inputs.indices);
    this.readout = Int32Array.from(file.readout.indices);
    this.isReadout = new Uint8Array(n);
    for (const i of this.readout) this.isReadout[i] = 1;
    this.counts = new Int32Array(n);
    this.v = new Float64Array(n).fill(p.v_0_mV);
    this.g = new Float64Array(n);
    this.last = new Float64Array(n).fill(NEVER);
    this.ref = new Int32Array(n).fill(stepsOf(p.t_rfc_ms, p.dt_ms));
    for (const i of this.inputs) this.ref[i] = 0;
    this.touched = new Uint8Array(n);
    this.act = new Int32Array(n);
    this.fired = new Int32Array(n);
    this.fresh = new Int32Array(n);
    this.drivenBuf = new Int32Array(this.inputs.length);
    this.delaySteps = stepsOf(p.t_dly_ms, p.dt_ms);
    const L = this.delaySteps + 1;
    this.qTgt = Array.from({ length: L }, () => new Int32Array(1024));
    this.qW = Array.from({ length: L }, () => new Float64Array(1024));
    this.qN = new Int32Array(L);
    this.ev = Math.exp(-p.dt_ms / p.t_mbr_ms);
    this.eg = Math.exp(-p.dt_ms / p.tau_ms);
    if (p.tau_ms === p.t_mbr_ms) throw new Error("τ = τm is not supported here");
    this.A = p.tau_ms / (p.tau_ms - p.t_mbr_ms);
    this.wPoi = p.w_syn_mV * p.f_poi;
  }

  /** Neurons currently integrated (those that have left rest). */
  get activeCount(): number {
    return this.actN;
  }

  /** The neurons that spiked in the last step, in the order they fired. */
  get lastFired(): number[] {
    return Array.from(this.fired.subarray(0, this.firedN));
  }

  /** Append the first `k` of `fresh` (unique, not yet active), sorted, as lif.py's `_touch` does. */
  private activate(k: number): void {
    if (!k) return;
    const f = this.fresh.subarray(0, k);
    f.sort();
    this.act.set(f, this.actN);
    this.actN += k;
  }

  /**
   * One step of `dt`. The first `drivenN` of `driven` are the input neurons
   * that receive an input event this step (a Poisson draw or a kick). Returns
   * the readout spikes.
   */
  advance(driven: ArrayLike<number> = [], drivenN = driven.length): number {
    const step = this.step;
    const p = this.file.lif;
    const { v, g, last, ref, ev, eg, A, act, fired, touched, fresh } = this;
    const v0 = p.v_0_mV;
    const vth = p.v_th_mV;
    // 1–2. integrate every neuron that has left rest and is not refractory; threshold it.
    let nf = 0;
    for (let k = 0, m = this.actN; k < m; k++) {
      const i = act[k]!;
      if (step - last[i]! < ref[i]!) continue;
      const gi = g[i]!;
      const u = v[i]! - v0;
      const vi = v0 + (u - A * gi) * ev + A * gi * eg;
      v[i] = vi;
      g[i] = gi * eg;
      if (vi > vth) fired[nf++] = i;
    }
    this.firedN = nf;
    let readoutSpikes = 0;
    // 3a. queue this step's spikes for delivery `t_dly` later, in firing then synapse order.
    if (nf) {
      const qs = (step + this.delaySteps) % this.qN.length;
      let total = this.qN[qs]!;
      for (let k = 0; k < nf; k++) {
        const i = fired[k]!;
        last[i] = step;
        this.counts[i]!++;
        if (this.isReadout[i]) {
          readoutSpikes++;
          this.readoutSpikes++;
          this.recent.push(step);
        }
        total += this.indptr[i + 1]! - this.indptr[i]!;
      }
      if (total > this.qTgt[qs]!.length) {
        const size = Math.max(total, 2 * this.qTgt[qs]!.length);
        const t = new Int32Array(size);
        const w = new Float64Array(size);
        t.set(this.qTgt[qs]!.subarray(0, this.qN[qs]));
        w.set(this.qW[qs]!.subarray(0, this.qN[qs]));
        this.qTgt[qs] = t;
        this.qW[qs] = w;
      }
      const tq = this.qTgt[qs]!;
      const wq = this.qW[qs]!;
      let q = this.qN[qs]!;
      const { indptr, indices, weight } = this;
      for (let k = 0; k < nf; k++) {
        const i = fired[k]!;
        for (let e = indptr[i]!, end = indptr[i + 1]!; e < end; e++) {
          tq[q] = indices[e]!;
          wq[q++] = weight[e]!;
        }
      }
      this.qN[qs] = q;
    }
    // 3b. deliver what is due now, to neurons that are not refractory.
    const slot = step % this.qN.length;
    const due = this.qN[slot]!;
    if (due) {
      const tq = this.qTgt[slot]!;
      const wq = this.qW[slot]!;
      let nfresh = 0;
      for (let k = 0; k < due; k++) {
        const t = tq[k]!;
        const lt = last[t]!;
        if (lt === step || step - lt < ref[t]!) continue;
        g[t] = g[t]! + wq[k]!;
        if (!touched[t]) {
          touched[t] = 1;
          fresh[nfresh++] = t;
        }
      }
      this.activate(nfresh);
      this.qN[slot] = 0;
    }
    // 3c. input events.
    if (drivenN) {
      let nfresh = 0;
      for (let k = 0; k < drivenN; k++) {
        const i = driven[k]!;
        const li = last[i]!;
        if (li === step || step - li < ref[i]!) continue;
        v[i] = v[i]! + this.wPoi;
        if (!touched[i]) {
          touched[i] = 1;
          fresh[nfresh++] = i;
        }
      }
      this.activate(nfresh);
    }
    // 4. resets.
    for (let k = 0; k < nf; k++) {
      const i = fired[k]!;
      v[i] = p.v_rst_mV;
      g[i] = 0;
    }
    this.step++;
    return readoutSpikes;
  }

  /**
   * One step with every input neuron driven at `rateHz`: one draw per input
   * neuron, in order, as lif.py's Poisson group draws them.
   */
  advanceAt(rateHz: number, rng: () => number): number {
    if (rateHz <= 0) return this.advance();
    const pr = rateHz * this.dtMs * 1e-3;
    const buf = this.drivenBuf;
    const inputs = this.inputs;
    let k = 0;
    for (let j = 0; j < inputs.length; j++) if (rng() < pr) buf[k++] = inputs[j]!;
    return this.advance(buf, k);
  }

  /** True when every neuron is within `REST_EPS` of rest and nothing is in flight. */
  atRest(): boolean {
    const v0 = this.file.lif.v_0_mV;
    for (let k = 0; k < this.actN; k++) {
      const i = this.act[k]!;
      if (Math.abs(this.v[i]! - v0) > REST_EPS || Math.abs(this.g[i]!) > REST_EPS)
        return false;
    }
    for (let k = 0; k < this.qN.length; k++) if (this.qN[k]) return false;
    return true;
  }

  /**
   * Run `ms` at a constant input rate. Off input and near rest (`atRest`),
   * the circuit is set to exact rest and time passes at no cost; otherwise
   * every step is integrated.
   */
  run(ms: number, rateHz: number, rng: () => number): number {
    const n = stepsOf(ms, this.dtMs);
    let spikes = 0;
    for (let k = 0; k < n; k++) {
      if (rateHz <= 0 && (k & 255) === 0 && this.atRest()) {
        this.forget();
        this.step += n - k;
        break;
      }
      spikes += this.advanceAt(rateHz, rng);
    }
    return spikes;
  }

  /** Set an idle circuit near rest to exact rest, and stop integrating it. */
  private forget(): void {
    const v0 = this.file.lif.v_0_mV;
    for (let k = 0; k < this.actN; k++) {
      const i = this.act[k]!;
      this.touched[i] = 0;
      this.v[i] = v0;
      this.g[i] = 0;
    }
    this.actN = 0;
  }

  /** Readout spikes per readout neuron per second over the last `windowMs`. */
  readoutRateHz(windowMs: number): number {
    const from = this.step - stepsOf(windowMs, this.dtMs);
    const s = this.recent;
    while (this.head < s.length && s[this.head]! < from) this.head++;
    if (this.head > 4096) {
      this.recent = s.slice(this.head);
      this.head = 0;
    }
    return (this.recent.length - this.head) / this.readout.length / (windowMs / 1000);
  }

  /** The circuit's state, for a hash: finite numbers only. */
  hashState(): Record<string, unknown> {
    return {
      step: this.step,
      active: this.actN,
      v: Array.from(this.act.subarray(0, this.actN), (i) => this.v[i]),
      g: Array.from(this.act.subarray(0, this.actN), (i) => this.g[i]),
      readoutSpikes: this.readoutSpikes,
      recent: this.recent.slice(this.head),
    };
  }
}

/** The circuit's weights shuffled across its synapse pairs (a control: same numbers, wiring lost). */
export function shuffledWeights(file: CircuitFile, rng: () => number): Float64Array {
  const w = Float64Array.from(file.signed_count, (c) => c * file.lif.w_syn_mV);
  for (let i = w.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = w[i]!;
    w[i] = w[j]!;
    w[j] = t;
  }
  return w;
}
