import * as THREE from "three";

/**
 * The sun, as a mutable singleton.
 *
 * `Atmosphere` eases the sun through the day/night sweep on the frame loop, so
 * anything that needs to point at the same sun — the near-field shadow cascade,
 * a viewmodel key light — cannot re-derive it from the `night` toggle without
 * drifting during the transition. It writes here instead, and readers pick the
 * value up on the same frame. No React state on the frame loop.
 */
export interface SunState {
  /** Unit vector from the ground toward the sun. */
  direction: THREE.Vector3;
  /** 1 = full day, 0 = full night; eased, not the raw toggle. */
  dayFactor: number;
  /** Current intensity of the sun's directional light. */
  intensity: number;
}

export const sunState: SunState = {
  direction: new THREE.Vector3(0, 1, 0),
  dayFactor: 1,
  intensity: 0,
};
