/**
 * Odour transport near the ground: a conservative finite-volume solver for
 * advection by the wind, turbulent diffusion and first-order loss, on a square
 * grid with blocked cells (obstacles odour does not cross) and an open edge.
 *
 * Mass is held per cell (µg). Each sub-step moves mass only between cells, or
 * out through the open edge (clean air comes in), so the books close exactly
 * up to rounding: stock now = stock before + emitted − lost − out + rounding,
 * where `rounding` is what was added back when rounding left a cell a hair
 * below zero. The scheme
 * is first-order upwind for advection and explicit for diffusion, sub-stepped
 * so that no cell can send out more than 90% of what it holds (the Courant
 * numbers of both axes plus four diffusion numbers at most 0.9), which keeps
 * every cell non-negative. It
 * adds numerical diffusion of about |u|·h/2 along the wind; the reference test
 * measures it against the exact solution for a puff.
 *
 * The wind is taken as uniform across the grid at each step (the yard is small
 * against the weather's scales), and odour is one near-ground layer with no
 * height: approximations named here, not validated fluid transport.
 */

/** Mass below this in a cell (µg, or mm of vapour) counts as lost. */
const MASS_FLOOR = 1e-30;

export interface GridSpec {
  /** Cells along x and z. */
  nx: number;
  nz: number;
  /** Cell side (m). */
  h: number;
  /** World position of the grid's corner of least x and z (m). */
  x0: number;
  z0: number;
}

export interface Books {
  emitted: number;
  lost: number;
  out: number;
  /** Mass added where rounding left a cell a hair below zero (it is set to zero). */
  rounding: number;
}

export class OdourField {
  readonly spec: Readonly<GridSpec>;
  /** Mass per cell (µg), row-major: index = iz·nx + ix. */
  readonly mass: Float64Array;
  /** 1 where odour cannot be (an obstacle's footprint). */
  readonly blocked: Uint8Array;
  /** Running totals since the field was made. */
  readonly books: Books = { emitted: 0, lost: 0, out: 0, rounding: 0 };
  private readonly delta: Float64Array;
  /** Sub-steps taken by the last step, for tests and cost. */
  lastSubsteps = 0;
  constructor(spec: GridSpec, blocked?: Uint8Array) {
    if (!(spec.nx > 1 && spec.nz > 1 && spec.h > 0))
      throw new Error("a grid needs cells");
    this.spec = Object.freeze({ ...spec });
    this.mass = new Float64Array(spec.nx * spec.nz);
    this.delta = new Float64Array(spec.nx * spec.nz);
    this.blocked = blocked ? Uint8Array.from(blocked) : new Uint8Array(spec.nx * spec.nz);
    if (this.blocked.length !== this.mass.length)
      throw new Error("a mask covers every cell");
  }

  /** The cell holding world point (x, z), or −1 outside the grid. */
  cellAt(x: number, z: number): number {
    const S = this.spec;
    const ix = Math.floor((x - S.x0) / S.h),
      iz = Math.floor((z - S.z0) / S.h);
    if (ix < 0 || iz < 0 || ix >= S.nx || iz >= S.nz) return -1;
    return iz * S.nx + ix;
  }

  total(): number {
    let s = 0;
    for (let i = 0; i < this.mass.length; i++) s += this.mass[i]!;
    return s;
  }

  /**
   * Concentration (µg/m²) at a world point, bilinear between cell centres;
   * blocked cells and the outside count as empty.
   */
  concentrationAt(x: number, z: number): number {
    const S = this.spec;
    const fx = (x - S.x0) / S.h - 0.5,
      fz = (z - S.z0) / S.h - 0.5;
    const ix = Math.floor(fx),
      iz = Math.floor(fz);
    const ux = fx - ix,
      uz = fz - iz;
    const at = (i: number, k: number) => {
      if (i < 0 || k < 0 || i >= S.nx || k >= S.nz) return 0;
      const c = k * S.nx + i;
      return this.blocked[c] ? 0 : this.mass[c]! / (S.h * S.h);
    };
    return (
      (1 - uz) * ((1 - ux) * at(ix, iz) + ux * at(ix + 1, iz)) +
      uz * ((1 - ux) * at(ix, iz + 1) + ux * at(ix + 1, iz + 1))
    );
  }

  /**
   * Advance by `dt` (s) in a uniform wind (ux, uz) (m/s) with diffusivity `D`
   * (m²/s), loss rate `k` (1/s) and sources `emit` (µg/s per cell; null for
   * none). Sources in blocked cells are refused.
   */
  step(
    dt: number,
    ux: number,
    uz: number,
    D: number,
    k: number,
    emit: Float64Array | null,
  ): void {
    const S = this.spec;
    const { nx, nz, h } = S;
    const m = this.mass,
      d = this.delta,
      blk = this.blocked;
    if (!(dt > 0) || !(D >= 0) || !(k >= 0))
      throw new Error("a step needs dt > 0, D ≥ 0, k ≥ 0");
    const cx = (Math.abs(ux) * dt) / h,
      cz = (Math.abs(uz) * dt) / h,
      dn = (D * dt) / (h * h);
    // No cell may send out more than it holds: upwind out through one face per
    // axis plus diffusion through four, at most 90% of its mass per sub-step.
    const n = Math.max(1, Math.ceil((cx + cz + 4 * dn) / 0.9));
    this.lastSubsteps = n;
    const sdt = dt / n;
    const ax = (ux * sdt) / h,
      az = (uz * sdt) / h,
      df = (D * sdt) / (h * h);
    const keep = Math.exp(-k * sdt);
    for (let s = 0; s < n; s++) {
      if (emit) {
        for (let i = 0; i < m.length; i++) {
          const e = emit[i]!;
          if (e === 0) continue;
          if (blk[i]) throw new Error("an odour source cannot lie inside an obstacle");
          m[i] = m[i]! + e * sdt;
          this.books.emitted += e * sdt;
        }
      }
      d.fill(0);
      let out = 0;
      // Interior faces along x, then along z: upwind advection plus diffusion.
      const pxPos = ax > 0,
        axAbs = Math.abs(ax),
        pzPos = az > 0,
        azAbs = Math.abs(az);
      for (let iz = 0; iz < nz; iz++) {
        const row = iz * nx;
        for (let ix = 0; ix < nx - 1; ix++) {
          const i = row + ix,
            j = i + 1;
          if (blk[i]! | blk[j]!) continue;
          const mi = m[i]!,
            mj = m[j]!;
          const f = (pxPos ? axAbs * mi : -axAbs * mj) + df * (mi - mj);
          d[i] = d[i]! - f;
          d[j] = d[j]! + f;
        }
      }
      for (let iz = 0; iz < nz - 1; iz++) {
        const row = iz * nx;
        for (let ix = 0; ix < nx; ix++) {
          const i = row + ix,
            j = i + nx;
          if (blk[i]! | blk[j]!) continue;
          const mi = m[i]!,
            mj = m[j]!;
          const f = (pzPos ? azAbs * mi : -azAbs * mj) + df * (mi - mj);
          d[i] = d[i]! - f;
          d[j] = d[j]! + f;
        }
      }
      // The open edge: what leaves is gone; clean air comes in.
      const edge = (i: number, outward: number) => {
        if (blk[i]) return;
        const f = (outward > 0 ? outward * m[i]! : 0) + df * m[i]!;
        d[i] = d[i]! - f;
        out += f;
      };
      for (let iz = 0; iz < nz; iz++) {
        edge(iz * nx, -ax);
        edge(iz * nx + nx - 1, ax);
      }
      for (let ix = 0; ix < nx; ix++) {
        edge(ix, -az);
        edge((nz - 1) * nx + ix, az);
      }
      this.books.out += out;
      let lost = 0;
      for (let i = 0; i < m.length; i++) {
        const v = m[i]! + d[i]!;
        // Rounding can leave −1e-18 where a cell emptied: nothing below zero is real.
        const pos = v > 0 ? v : 0;
        if (v < 0) this.books.rounding -= v;
        // Below the floor, mass counts as lost: subnormal numbers are slow and meaningless.
        const kept = pos * keep < MASS_FLOOR ? 0 : pos * keep;
        lost += pos - kept;
        m[i] = kept;
      }
      this.books.lost += lost;
    }
  }
}
