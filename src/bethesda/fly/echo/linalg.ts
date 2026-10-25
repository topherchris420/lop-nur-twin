/**
 * The little linear algebra the self-model needs: dense row-major matrices as
 * flat arrays, sized for its nine-number state and three-number observations.
 * Plain arithmetic only, in a fixed order, so a seed replays exactly.
 */
export type Mat = number[];

export const zeros = (n: number): number[] => new Array<number>(n).fill(0);

export function identity(n: number): Mat {
  const m = zeros(n * n);
  for (let i = 0; i < n; i++) m[i * n + i] = 1;
  return m;
}

export function diag(values: readonly number[]): Mat {
  const n = values.length;
  const m = zeros(n * n);
  for (let i = 0; i < n; i++) m[i * n + i] = values[i]!;
  return m;
}

/** (r × k) · (k × c). */
export function mul(a: Mat, b: Mat, r: number, k: number, c: number): Mat {
  const out = zeros(r * c);
  for (let i = 0; i < r; i++)
    for (let j = 0; j < c; j++) {
      let s = 0;
      for (let q = 0; q < k; q++) s += a[i * k + q]! * b[q * c + j]!;
      out[i * c + j] = s;
    }
  return out;
}

export function transpose(a: Mat, r: number, c: number): Mat {
  const out = zeros(r * c);
  for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) out[j * r + i] = a[i * c + j]!;
  return out;
}

export const add = (a: Mat, b: Mat): Mat => a.map((x, i) => x + b[i]!);
export const sub = (a: Mat, b: Mat): Mat => a.map((x, i) => x - b[i]!);

/** (A + Aᵀ) / 2: keeps a covariance symmetric against rounding. */
export function symmetrize(a: Mat, n: number): Mat {
  const out = a.slice();
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const m = (a[i * n + j]! + a[j * n + i]!) / 2;
      out[i * n + j] = m;
      out[j * n + i] = m;
    }
  return out;
}

/** The inverse and determinant of a 3 × 3 matrix; null when it is singular. */
export function inverse3(m: Mat): { inv: Mat; det: number } | null {
  const [a, b, c, d, e, f, g, h, i] = m as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const A = e * i - f * h,
    B = -(d * i - f * g),
    C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!(Math.abs(det) > 1e-300) || !Number.isFinite(det)) return null;
  const k = 1 / det;
  return {
    det,
    inv: [
      A * k,
      -(b * i - c * h) * k,
      (b * f - c * e) * k,
      B * k,
      (a * i - c * g) * k,
      -(a * f - c * d) * k,
      C * k,
      -(a * h - b * g) * k,
      (a * e - b * d) * k,
    ],
  };
}

/** xᵀ M x for a 3-vector. */
export function quad3(x: readonly number[], m: Mat): number {
  let s = 0;
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) s += x[i]! * m[i * 3 + j]! * x[j]!;
  return s;
}

/** Numbers rounded to `digits` significant figures, for records people read. */
export const sig = (x: number, digits = 4) => Number(x.toPrecision(digits));
