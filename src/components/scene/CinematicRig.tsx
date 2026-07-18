import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { CINEMATIC_WAYPOINTS } from "@/lib/layout";
import { telemetry } from "@/lib/telemetry";

const LOOP_SECONDS = 95;

/**
 * Automated flythrough: a closed Catmull-Rom spline through the waypoints
 * defined in the site layout. Lazy-loaded so the spline code stays out of
 * the initial bundle.
 */
export default function CinematicRig() {
  const curve = useMemo(() => {
    const points = CINEMATIC_WAYPOINTS.map((w) => new THREE.Vector3(...w.position));
    return new THREE.CatmullRomCurve3(points, true, "centripetal", 0.5);
  }, []);

  const progress = useRef(0);
  const lookAhead = useRef(new THREE.Vector3());
  const position = useRef(new THREE.Vector3());

  // publish which leg is in frame for the lower-third caption; clear on exit
  useEffect(() => {
    return () => {
      telemetry.cinematicLeg = -1;
    };
  }, []);

  useFrame((state, delta) => {
    progress.current = (progress.current + delta / LOOP_SECONDS) % 1;
    const t = progress.current;
    curve.getPointAt(t, position.current);
    curve.getPointAt((t + 0.025) % 1, lookAhead.current);
    // bias the gaze toward the ground so the site stays in frame
    lookAhead.current.y *= 0.45;

    state.camera.position.lerp(position.current, Math.min(1, delta * 5));
    state.camera.lookAt(lookAhead.current);

    telemetry.cinematicLeg = Math.floor(t * CINEMATIC_WAYPOINTS.length) % CINEMATIC_WAYPOINTS.length;
  });

  return null;
}
