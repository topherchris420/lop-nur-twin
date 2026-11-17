/**
 * Closed-form steady-state response of m x'' + b x' + k x = F cos(w t).
 *
 * Independent of the numerical backend's RK4 integrator: these formulas are
 * the ground truth the evaluation scores against and the physics a critic
 * may cite. Only + - * / and sqrt.
 */
export interface Oscillator {
  mass: number;
  damping: number;
  stiffness: number;
  force: number;
}
export const omega0 = (s: Oscillator) => Math.sqrt(s.stiffness / s.mass);
/** Amplitude decay rate of the free response, 1/s. */
export const gamma = (s: Oscillator) => s.damping / (2 * s.mass);
export const dampingRatio = (s: Oscillator) => gamma(s) / omega0(s);
/** Steady-state displacement amplitude at drive frequency w. */
export function steadyAmplitude(s: Oscillator, w: number): number {
  const w0 = omega0(s),
    g = gamma(s);
  const detuning = w0 * w0 - w * w;
  return s.force / s.mass / Math.sqrt(detuning * detuning + 4 * g * g * w * w);
}
/** Drive frequency of peak steady displacement: sqrt(w0^2 - 2 gamma^2), or 0. */
export function displacementPeak(s: Oscillator): number {
  const w0 = omega0(s),
    g = gamma(s);
  const inside = w0 * w0 - 2 * g * g;
  return inside > 0 ? Math.sqrt(inside) : 0;
}
/** Time for the start-up transient to fall to e^-n of its size. */
export const transientTime = (s: Oscillator, n: number) => n / gamma(s);
