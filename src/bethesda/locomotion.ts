/** Presentation only. Distance-driven foot trajectories, no world-state writes. */
export const CITY_STRIDE = 1.1;
export const CITY_DUTY = 0.6;
export interface FootTarget {
  y: number;
  z: number;
  planted: boolean;
}
export function cityFoot(travel: number, side: number, moving: boolean, out: FootTarget) {
  if (!moving) {
    out.y = 0.08;
    out.z = 0;
    out.planted = true;
    return;
  }
  const phase = (((travel / CITY_STRIDE + (side > 0 ? 0.5 : 0)) % 1) + 1) % 1;
  out.planted = phase < CITY_DUTY;
  if (out.planted) {
    // Body travels +d; planted ankle moves -d relative to the body.
    out.z = CITY_STRIDE * (CITY_DUTY / 2 - phase);
    out.y = 0.08;
  } else {
    const s = (phase - CITY_DUTY) / (1 - CITY_DUTY);
    const smooth = s * s * (3 - 2 * s);
    out.z = CITY_STRIDE * CITY_DUTY * (smooth - 0.5);
    out.y = 0.08 + Math.sin(Math.PI * s) * 0.14;
  }
}
