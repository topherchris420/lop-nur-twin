/**
 * The four ways to watch, each a lens and a way of moving it. Every one of
 * them reads the presented pose and nothing writes back: a camera can never
 * change what the fly does.
 *
 * - **Observation**: the locked-off wide shot of the whole garden, composed
 *   so every place is in frame (wider on a tall screen). At this distance a
 *   3 mm fly is smaller than a pixel; the page marks where it is.
 * - **Fly tracking**: a 3/4 view from a few centimetres, on the viewer's
 *   side of whatever the fly stands on, trailing it through the air.
 * - **Macro**: a close-up lens a couple of centimetres away, the depth of
 *   field paper-thin, drifting slowly round the fly like a slider shot.
 * - **Free**: orbit, pan and zoom by hand, kept out of the soil and the walls.
 *
 * In stop-motion mode the tracking and macro rigs move on the animation's
 * frames, like a motion-control rig, so the fly holds still in the frame
 * between exposures; the free camera answers the hand at the display's rate.
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { LAYOUT, OBSERVATION, standingHeight } from "../core/layout.js";
import type { FlyPose } from "../core/performance.js";
import {
  add,
  addScaled,
  clamp,
  cross,
  dot,
  length,
  normalize,
  rotateAbout,
  scale,
  sub,
  type V3,
} from "../core/vec.js";

export const CAMERA_MODES = ["observation", "tracking", "macro", "free"] as const;
export type CameraMode = (typeof CAMERA_MODES)[number];
export const isCameraMode = (v: unknown): v is CameraMode =>
  typeof v === "string" && (CAMERA_MODES as readonly string[]).includes(v);

export const CAMERA_LABELS: Record<CameraMode, string> = {
  observation: "Observation",
  tracking: "Fly tracking",
  macro: "Macro",
  free: "Free",
};

interface Lens {
  /** Vertical field of view at 16:9 (degrees). */
  fov: number;
  near: number;
  /** Blur-disc scale for depth of field, pixels at 1080 lines per unit of relative defocus. */
  aperture: number;
  /** Seconds the rig takes to settle on a new framing. */
  settle: number;
}

const LENS: Record<CameraMode, Lens> = {
  observation: { fov: OBSERVATION.fovDeg, near: 0.05, aperture: 7, settle: 0 },
  tracking: { fov: 30, near: 0.003, aperture: 34, settle: 0.45 },
  macro: { fov: 24, near: 0.0008, aperture: 78, settle: 0.7 },
  free: { fov: 40, near: 0.002, aperture: 12, settle: 0 },
};

const UP: V3 = [0, 1, 0];

export interface Shot {
  position: V3;
  /** Where the lens points. */
  target: V3;
  /** Where it focuses: the fly. */
  subject: V3;
  /** The framing distance from the fly. */
  distance: number;
}

/** How far ahead (s) the tracking and macro rigs frame the fly: about their settling lag, so they move with it rather than after it. */
export const LEAD_S = 0.45;

/** The point the lenses look at: a little above the feet point, at the thorax. */
const subjectOf = (p: FlyPose): V3 => addScaled(p.position, p.up, 0.0013);

/**
 * Where the tracking or macro rig wants to be for a pose. Pure: the same
 * pose and time frame the same shot for everyone.
 */
export function shotFor(
  mode: "tracking" | "macro",
  pose: FlyPose,
  t: number,
  still: boolean,
): Shot {
  const subject = subjectOf(pose);
  const perched = pose.support > 0.5;
  const n = perched ? normalize(pose.ground.normal) : UP;
  // Toward the observation camera, across the surface: the visitor's side of the fence, the wall, the leaf.
  const toViewer = sub(OBSERVATION.position, subject);
  let side = sub(toViewer, scale(n, dot(toViewer, n)));
  side = length(side) > 1e-6 ? normalize(side) : normalize(cross(n, [1, 0, 0]));
  if (mode === "macro" && !still)
    side = rotateAbout(side, n, 0.55 * Math.sin((2 * Math.PI * t) / 46));
  const fwd = normalize(pose.forward);
  let dir: V3;
  let dist: number;
  if (perched) {
    // Low over the surface, as a macro photographer lies down beside an insect:
    // the garden beyond shows, soft, behind the fly.
    dir = normalize(
      add(
        add(scale(n, mode === "macro" ? 0.17 : 0.2), scale(side, 0.85)),
        scale(fwd, 0.3),
      ),
    );
    dist = mode === "macro" ? 0.017 : 0.03;
  } else {
    // In the air: behind and above, a little to the viewer's side.
    const back = pose.speed > 0.02 ? scale(fwd, -1) : side;
    dir = normalize(add(add(scale(back, 0.8), scale(UP, 0.35)), scale(side, 0.35)));
    dist = mode === "macro" ? 0.03 : 0.075;
  }
  const position = keepOutOfClay(addScaled(subject, dir, dist));
  // Perched, the lens looks a little above the fly, so it sits low in the
  // picture with the garden behind it rather than a wall of what it stands on.
  const lift = perched ? dist * (mode === "macro" ? 0.06 : 0.1) : 0;
  return { position, target: addScaled(subject, n, lift), subject, distance: dist };
}

/** Nudges a camera position out of the soil, the fence and the house. */
export function keepOutOfClay(p: V3): V3 {
  const out: V3 = [...p];
  const f = LAYOUT.fence,
    w = LAYOUT.wall;
  if (out[0] < f.x1 && out[2] < f.front + 0.004) out[2] = f.front + 0.004;
  if (out[0] >= w.x0 && out[2] < w.front + w.siding + 0.004)
    out[2] = w.front + w.siding + 0.004;
  const floor = standingHeight(out[0], out[2]) + 0.003;
  if (out[1] < floor) out[1] = floor;
  return out;
}

/** Vertical field of view that keeps a lens's 16:9 horizontal coverage on any screen shape. */
export function fitFov(fov16x9: number, aspect: number, maxFov = 80): number {
  if (aspect >= 16 / 9) return fov16x9;
  const h = 2 * Math.atan(Math.tan((fov16x9 * Math.PI) / 360) * (16 / 9));
  const v = (2 * Math.atan(Math.tan(h / 2) / aspect) * 180) / Math.PI;
  return Math.min(maxFov, v);
}

export class GardenCamera {
  readonly camera: THREE.PerspectiveCamera;
  mode: CameraMode = "observation";
  /** Depth of field for the finishing pass: focus distance (m) and blur scale (px at 1080 lines). */
  focus = { distance: 4, aperture: LENS.observation.aperture };
  /** Where the near shadow cascade should sit, and how wide. */
  shadowFocus: { point: V3; radius: number } = { point: [0, 0.4, 0], radius: 0.4 };
  /** True while the free camera is being handled (the renderer then draws at display rate). */
  moving = false;
  private readonly controls: OrbitControls;
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private snapNext = true;
  private aspect = 16 / 9;

  constructor(dom: HTMLElement) {
    this.camera = new THREE.PerspectiveCamera(
      OBSERVATION.fovDeg,
      16 / 9,
      LENS.observation.near,
      40,
    );
    this.camera.position.set(...OBSERVATION.position);
    this.camera.lookAt(...OBSERVATION.target);
    this.controls = new OrbitControls(this.camera, dom);
    this.controls.enabled = false;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.minDistance = 0.006;
    this.controls.maxDistance = 9;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.zoomToCursor = true;
    this.controls.addEventListener("start", () => (this.moving = true));
    this.controls.addEventListener("end", () => (this.moving = false));
  }

  setAspect(aspect: number) {
    this.aspect = aspect;
    this.camera.aspect = aspect;
    this.applyLens();
  }

  private applyLens() {
    const lens = LENS[this.mode];
    this.camera.fov = fitFov(
      lens.fov,
      this.aspect,
      this.mode === "observation" ? 72 : 60,
    );
    this.camera.near = lens.near;
    this.camera.far = 40;
    this.camera.updateProjectionMatrix();
  }

  setMode(mode: CameraMode, pose: FlyPose | null) {
    if (mode === this.mode) return;
    const was = this.mode;
    this.mode = mode;
    this.controls.enabled = mode === "free";
    if (mode === "free") {
      // Take over from wherever the camera is, orbiting what it was looking at.
      const target =
        was === "observation" || !pose
          ? new THREE.Vector3(...OBSERVATION.target)
          : new THREE.Vector3(...subjectOf(pose));
      this.controls.target.copy(target);
      this.controls.update();
    }
    this.snapNext = true;
    this.applyLens();
  }

  /**
   * Moves the tracking and macro rigs one step toward their framing of
   * `pose` (`dt` seconds: one animation frame in stop motion). The rig
   * travels toward where it will want to be `LEAD_S` later (`lead`, the
   * pose then: the presented past is already known), while the lens stays
   * on the fly now, never letting it into the lens or out of reach. A cut,
   * a new mode or reduced motion places them at once.
   */
  step(
    pose: FlyPose | null,
    lead: FlyPose | null,
    t: number,
    dt: number,
    still: boolean,
  ) {
    const m = this.mode;
    if (m === "observation") {
      this.camera.position.set(...OBSERVATION.position);
      this.camera.lookAt(...OBSERVATION.target);
      this.focus = {
        distance: pose
          ? this.camera.position.distanceTo(new THREE.Vector3(...pose.position))
          : 4,
        aperture: LENS.observation.aperture,
      };
      this.shadowFocus = pose
        ? { point: pose.position, radius: 0.35 }
        : { point: OBSERVATION.target, radius: 0.6 };
      return;
    }
    if (m === "free") return;
    if (!pose) return;
    const shot = shotFor(m, pose, t, still);
    const ahead =
      lead && !lead.cut && !still ? shotFor(m, lead, t + LEAD_S, still) : shot;
    const snap = this.snapNext || pose.cut || still;
    this.snapNext = false;
    const k = snap ? 1 : 1 - Math.exp(-dt / LENS[m].settle);
    this.pos.lerp(new THREE.Vector3(...ahead.position), k);
    if (snap) this.pos.set(...shot.position);
    const subject = new THREE.Vector3(...shot.subject);
    const away = this.pos.clone().sub(subject);
    const d = away.length();
    const reach = clamp(d, shot.distance * 0.5, shot.distance * 2.5);
    if (d > 1e-9 && reach !== d) this.pos.copy(subject).addScaledVector(away, reach / d);
    this.pos.set(...keepOutOfClay([this.pos.x, this.pos.y, this.pos.z]));
    this.look.lerp(
      new THREE.Vector3(...shot.target),
      snap ? 1 : 1 - Math.exp(-dt / 0.06),
    );
    this.camera.position.copy(this.pos);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.look);
    this.focus = {
      distance: this.pos.distanceTo(new THREE.Vector3(...shot.subject)),
      aperture: LENS[m].aperture,
    };
    this.shadowFocus = { point: pose.position, radius: m === "macro" ? 0.018 : 0.045 };
  }

  /** Every display frame: the free camera's damping and limits. Returns true if it moved. */
  frame(): boolean {
    if (this.mode !== "free") return false;
    const before = this.camera.matrixWorld.clone();
    this.controls.update();
    const p = keepOutOfClay([
      this.camera.position.x,
      this.camera.position.y,
      this.camera.position.z,
    ]);
    this.camera.position.set(...p);
    const t = this.controls.target;
    t.x = clamp(t.x, -3.4, 3.6);
    t.y = clamp(t.y, 0, 2.6);
    t.z = clamp(t.z, -1.29, 3.2);
    const d = this.camera.position.distanceTo(t);
    this.camera.near = clamp(d * 0.03, 0.0008, 0.05);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    this.focus = { distance: d, aperture: LENS.free.aperture };
    this.shadowFocus = { point: [t.x, t.y, t.z], radius: clamp(d * 0.35, 0.02, 0.8) };
    return !before.equals(this.camera.matrixWorld);
  }

  dispose() {
    this.controls.dispose();
  }
}
