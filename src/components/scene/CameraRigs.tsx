import { lazy, Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, PointerLockControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { useTwinStore } from "@/lib/store";
import { terrainHeight } from "@/lib/terrain";
import { telemetry } from "@/lib/telemetry";
import { touchInput, resetTouchInput, isCoarsePointer } from "@/lib/touchInput";
import { SITE_SIZE } from "@/lib/layout";

const CinematicRig = lazy(() => import("./CinematicRig"));

const EYE_HEIGHT = 1.7;
const WORLD_LIMIT = SITE_SIZE / 2 - 100;
const LOOK_SENS = 0.004;
const MAX_PITCH = Math.PI / 2 - 0.05;

function smootherstep(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/* ------------------------------------------------------------------ */
/* Orbit (free-fly) rig with fly-to animation                          */
/* ------------------------------------------------------------------ */

function OrbitRig() {
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const flyTo = useTwinStore((s) => s.flyTo);
  const reducedMotion = useTwinStore((s) => s.reducedMotion);
  const anim = useRef<{
    t: number;
    fromPos: THREE.Vector3;
    fromTarget: THREE.Vector3;
    toPos: THREE.Vector3;
    toTarget: THREE.Vector3;
  } | null>(null);
  const lastSeq = useRef(0);
  // scratch vectors for the on-screen pan-stick (allocated once)
  const panForward = useRef(new THREE.Vector3());
  const panRight = useRef(new THREE.Vector3());
  const panStep = useRef(new THREE.Vector3());

  useEffect(() => {
    const controls = controlsRef.current;
    if (!flyTo || !controls || flyTo.seq === lastSeq.current) return;
    lastSeq.current = flyTo.seq;
    if (reducedMotion) {
      controls.object.position.set(...flyTo.position);
      controls.target.set(...flyTo.target);
      controls.update();
      anim.current = null;
      return;
    }
    anim.current = {
      t: 0,
      fromPos: controls.object.position.clone(),
      fromTarget: controls.target.clone(),
      toPos: new THREE.Vector3(...flyTo.position),
      toTarget: new THREE.Vector3(...flyTo.target),
    };
  }, [flyTo, reducedMotion]);

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
    } else if (touchInput.moveX !== 0 || touchInput.moveY !== 0) {
      // Mobile pan-stick: glide the whole orbit rig across the ground. We move
      // camera and target together so the framing (distance / pitch / heading)
      // is preserved — this is a translation, not a rotation. A fly-to always
      // wins, hence the `else`.
      const cam = controls.object;
      panForward.current
        .set(controls.target.x - cam.position.x, 0, controls.target.z - cam.position.z);
      if (panForward.current.lengthSq() < 1e-6) panForward.current.set(0, 0, -1);
      panForward.current.normalize();
      panRight.current
        .crossVectors(panForward.current, THREE.Object3D.DEFAULT_UP)
        .normalize();

      // speed scales with zoom distance so it feels the same up close or far out
      const dist = cam.position.distanceTo(controls.target);
      const speed = THREE.MathUtils.clamp(dist * 0.6, 40, 1400) * delta;
      const step = panStep.current
        .set(0, 0, 0)
        .addScaledVector(panForward.current, touchInput.moveY)
        .addScaledVector(panRight.current, touchInput.moveX);
      const mag = Math.min(1, step.length());
      if (mag > 1e-3) {
        step.normalize().multiplyScalar(speed * mag);
        // clamp the target to the world, then shift the camera by the same
        // amount so the two never drift apart at the boundary
        const nx = THREE.MathUtils.clamp(controls.target.x + step.x, -WORLD_LIMIT, WORLD_LIMIT);
        const nz = THREE.MathUtils.clamp(controls.target.z + step.z, -WORLD_LIMIT, WORLD_LIMIT);
        cam.position.x += nx - controls.target.x;
        cam.position.z += nz - controls.target.z;
        controls.target.x = nx;
        controls.target.z = nz;
      }
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
      enableDamping={!reducedMotion}
      dampingFactor={0.08}
      rotateSpeed={0.55}
      panSpeed={0.8}
      screenSpacePanning={false}
      minDistance={15}
      maxDistance={SITE_SIZE * 0.75}
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
  const touch = useMemo(isCoarsePointer, []);
  const keys = useRef(new Set<string>());
  const velocity = useRef(new THREE.Vector3());
  // touch look is integrated here as yaw/pitch (PointerLockControls can't lock
  // the pointer on a touchscreen, so on coarse-pointer devices we drive the
  // camera orientation ourselves from the on-screen look-pad).
  const look = useRef(new THREE.Euler(0, 0, 0, "YXZ"));

  useEffect(() => {
    // drop onto the terrain wherever the previous camera was hovering
    camera.position.x = THREE.MathUtils.clamp(camera.position.x, -WORLD_LIMIT, WORLD_LIMIT);
    camera.position.z = THREE.MathUtils.clamp(camera.position.z, -WORLD_LIMIT, WORLD_LIMIT);
    camera.position.y = terrainHeight(camera.position.x, camera.position.z) + EYE_HEIGHT;

    if (touch) {
      // start looking level along the current heading
      look.current.setFromQuaternion(camera.quaternion, "YXZ");
      look.current.x = 0;
      look.current.z = 0;
      camera.quaternion.setFromEuler(look.current);
    }

    const down = (e: KeyboardEvent) => keys.current.add(e.code);
    const up = (e: KeyboardEvent) => keys.current.delete(e.code);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      resetTouchInput();
      setPointerLocked(false);
    };
  }, [camera, setPointerLocked, touch]);

  const forward = useRef(new THREE.Vector3());
  const right = useRef(new THREE.Vector3());

  useFrame((_, delta) => {
    const k = keys.current;
    const sprint = k.has("ShiftLeft") || k.has("ShiftRight") || touchInput.sprint;
    const speed = sprint ? 18 : 6;

    // apply accumulated touch-look before reading the facing direction
    if (touch && (touchInput.lookDX !== 0 || touchInput.lookDY !== 0)) {
      look.current.y -= touchInput.lookDX * LOOK_SENS;
      look.current.x = THREE.MathUtils.clamp(
        look.current.x - touchInput.lookDY * LOOK_SENS,
        -MAX_PITCH,
        MAX_PITCH,
      );
      camera.quaternion.setFromEuler(look.current);
      touchInput.lookDX = 0;
      touchInput.lookDY = 0;
    }

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
    // virtual joystick (analog): magnitude scales the step
    move.addScaledVector(forward.current, touchInput.moveY);
    move.addScaledVector(right.current, touchInput.moveX);

    const mag = Math.min(1, move.length());
    if (mag > 1e-3) {
      move.normalize().multiplyScalar(speed * delta * mag);
      camera.position.add(move);
    }
    camera.position.x = THREE.MathUtils.clamp(camera.position.x, -WORLD_LIMIT, WORLD_LIMIT);
    camera.position.z = THREE.MathUtils.clamp(camera.position.z, -WORLD_LIMIT, WORLD_LIMIT);
    // simple ground collision: stand on the analytic heightfield
    camera.position.y = terrainHeight(camera.position.x, camera.position.z) + EYE_HEIGHT;
  });

  // on a touchscreen we own the camera orientation; on desktop, pointer lock does
  if (touch) return null;
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
