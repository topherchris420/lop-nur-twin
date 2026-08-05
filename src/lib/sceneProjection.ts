import * as THREE from "three";

/**
 * Mutable frame bridge between the R3F scene and DOM analysis overlays.
 * Writers mutate these fields from useFrame; readers sample them from their
 * own throttled RAF loops. No React or Zustand frame traffic is involved.
 */
export interface SceneProjectionState {
  camera: THREE.Camera | null;
  width: number;
  height: number;
  frame: number;
  circuitAircraftActive: boolean;
  circuitAircraftPosition: THREE.Vector3;
  circuitAircraftHeadingRad: number;
}

export const sceneProjection: SceneProjectionState = {
  camera: null,
  width: 0,
  height: 0,
  frame: 0,
  circuitAircraftActive: false,
  circuitAircraftPosition: new THREE.Vector3(),
  circuitAircraftHeadingRad: 0,
};
