import { lazy, Suspense, useEffect, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, PointerLockControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { useTwinStore } from "@/lib/store";
import { terrainHeight } from "@/lib/terrain";
import { telemetry } from "@/lib/telemetry";

const CinematicRig = lazy(() => import("./CinematicRig"));

const EYE_HEIGHT = 1.7;
const WORLD_LIMIT = 3300;

function smootherstep(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/* ------------------------------------------------------------------ */
/* Orbit (free-fly) rig with fly-to animation                          */
/* ------------------------------------------------------------------ */

function OrbitRig() {
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const flyTo = useTwinStore((s) => s.flyTo);
  const anim = useRef<{
    t: number;
    fromPos: THREE.Vector3;
    fromTarget: THREE.Vector3;
    toPos: THREE.Vector3;
    toTarget: THREE.Vector3;
  } | null>(null);
  const lastSeq = useRef(0);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!flyTo || !controls || flyTo.seq === lastSeq.current) return;
    lastSeq.current = flyTo.seq;
    anim.current = {
      t: 0,
      fromPos: controls.object.position.clone(),
      fromTarget: controls.target.clone(),
      toPos: new THREE.Vector3(...flyTo.position),
      toTarget: new THREE.Vector3(...flyTo.target),
    };
  }, [flyTo]);

  useFrame((state, delta) => {
    const controls = controlsRef.current;
    if (!controls) return;
    const a = anim.current;
    if (a) {
      a.t = Math.min(1, a.t + delta / 1.5);
      const k = smootherstep(a.t);
      controls.object.position.lerpVectors(a.fromPos, a.toPos, k);
      controls.target.lerpVectors(a.fromTarget, a.toTarget, k);
      if (a.t >= 1) anim.current = null;
    }
    controls.update();
    // never sink below the ground
    const cam = state.camera;
    const floor = terrainHeight(cam.position.x, cam.position.z) + 2;
    if (cam.position.y < floor) cam.position.y = floor;
  });

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      rotateSpeed={0.55}
      panSpeed={0.8}
      screenSpacePanning={false}
      minDistance={15}
      maxDistance={4800}
      maxPolarAngle={Math.PI * 0.49}
      target={[1018, 0, 1410]}
    />
  );
}

/* ------------------------------------------------------------------ */
/* First-person walk rig                                               */
/* ------------------------------------------------------------------ */

function FpsRig() {
  const camera = useThree((s) => s.camera);
  const setPointerLocked = useTwinStore((s) => s.setPointerLocked);
  const keys = useRef(new Set<string>());
  const velocity = useRef(new THREE.Vector3());

  useEffect(() => {
    // drop onto the terrain wherever the previous camera was hovering
    camera.position.x = THREE.MathUtils.clamp(camera.position.x, -WORLD_LIMIT, WORLD_LIMIT);
    camera.position.z = THREE.MathUtils.clamp(camera.position.z, -WORLD_LIMIT, WORLD_LIMIT);
    camera.position.y = terrainHeight(camera.position.x, camera.position.z) + EYE_HEIGHT;

    const down = (e: KeyboardEvent) => keys.current.add(e.code);
    const up = (e: KeyboardEvent) => keys.current.delete(e.code);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      setPointerLocked(false);
    };
  }, [camera, setPointerLocked]);

  const forward = useRef(new THREE.Vector3());
  const right = useRef(new THREE.Vector3());

  useFrame((_, delta) => {
    const k = keys.current;
    const speed = k.has("ShiftLeft") || k.has("ShiftRight") ? 18 : 6;
    camera.getWorldDirection(forward.current);
    forward.current.y = 0;
    if (forward.current.lengthSq() < 1e-6) forward.current.set(0, 0, -1);
    forward.current.normalize();
    right.current.crossVectors(forward.current, THREE.Object3D.DEFAULT_UP).normalize();

    const move = velocity.current.set(0, 0, 0);
    if (k.has("KeyW") || k.has("ArrowUp")) move.add(forward.current);
    if (k.has("KeyS") || k.has("ArrowDown")) move.sub(forward.current);
    if (k.has("KeyD") || k.has("ArrowRight")) move.add(right.current);
    if (k.has("KeyA") || k.has("ArrowLeft")) move.sub(right.current);
    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(speed * delta);
      camera.position.add(move);
    }
    camera.position.x = THREE.MathUtils.clamp(camera.position.x, -WORLD_LIMIT, WORLD_LIMIT);
    camera.position.z = THREE.MathUtils.clamp(camera.position.z, -WORLD_LIMIT, WORLD_LIMIT);
    // simple ground collision: stand on the analytic heightfield
    camera.position.y = terrainHeight(camera.position.x, camera.position.z) + EYE_HEIGHT;
  });

  return (
    <PointerLockControls
      makeDefault
      onLock={() => setPointerLocked(true)}
      onUnlock={() => setPointerLocked(false)}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Telemetry writer (imperative — no React state)                      */
/* ------------------------------------------------------------------ */

function TelemetryTracker() {
  const dir = useRef(new THREE.Vector3());
  useFrame((state) => {
    const cam = state.camera;
    telemetry.x = cam.position.x;
    telemetry.y = cam.position.y;
    telemetry.z = cam.position.z;
    cam.getWorldDirection(dir.current);
    // compass heading: 0° = north (-z), clockwise positive
    telemetry.heading =
      (THREE.MathUtils.radToDeg(Math.atan2(dir.current.x, -dir.current.z)) + 360) % 360;
  });
  return null;
}

/* ------------------------------------------------------------------ */

export function CameraRigs() {
  const mode = useTwinStore((s) => s.cameraMode);
  return (
    <>
      {mode === "orbit" && <OrbitRig />}
      {mode === "fps" && <FpsRig />}
      {mode === "cinematic" && (
        <Suspense fallback={null}>
          <CinematicRig />
        </Suspense>
      )}
      <TelemetryTracker />
    </>
  );
}
