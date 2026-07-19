import * as THREE from "three";
import { CIRCUIT_WAYPOINTS } from "./layout";

/** Build the exact closed spline used by both the scene and data validator. */
export function createCircuitCurve(): THREE.CatmullRomCurve3 {
  return new THREE.CatmullRomCurve3(
    CIRCUIT_WAYPOINTS.map((waypoint) => new THREE.Vector3(...waypoint)),
    true,
    "centripetal",
    0.5,
  );
}
