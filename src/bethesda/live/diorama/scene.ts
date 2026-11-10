/**
 * The clay model of the city as a film set, photographed for `/live` the way
 * Eva's garden is (`src/garden/scene/`): the same plasticine material, the
 * same two-cascade key light, the same camera chain (HDR, ambient occlusion,
 * depth of field, film grade and grain), and stop motion on twelve frames a
 * second.
 *
 *   an observation arrives → the fly's presented pose at this frame → the
 *   puppet, the figures near it and its path → the lens follows → shadows →
 *   HDR render → occlusion, depth of field, grade → the canvas.
 *
 * Everything flows one way. The scene reads what the witness served and keeps
 * nothing that feeds back: no lens, zoom or frame rate changes what the fly
 * does, and without an observation no fly is drawn at all.
 */
import * as THREE from "three";
import type { Quality } from "../../../garden/core/quality.js";
import { ClayLibrary } from "../../../garden/scene/clay.js";
import { PostChain } from "../../../garden/scene/post.js";
import { clayDetail } from "../../../garden/scene/textures.js";
import type { LifeObservation } from "../../life/observation.js";
import { bounds } from "../../model.js";
import { groundAt } from "../../terrain.js";
import {
  PRESENT_DELAY_MS,
  presentPose,
  type PresentedPose,
  type Sample,
} from "../witnessFeed.js";
import { Figures, Puppet, Trail } from "./cast.js";
import { buildCity, type CityModel } from "./city.js";
import {
  buildingInTheWay,
  cameraDistance,
  clampZoom,
  LENS,
  MODEL_SCALE,
  ZOOM,
} from "./stage.js";
import { StudioLights } from "./studio.js";

/** The picture is taken on twelve frames a second, as the garden's is. */
export const FRAMES_PER_SECOND = 12;
/** Seconds the lens takes to settle on the fly, and on a new zoom. */
const FOLLOW_SETTLE = 0.45;
const ZOOM_SETTLE = 0.16;
/** The lens stays between a low three-quarter view and nearly overhead (radians above the horizon). */
const PITCH = { min: 0.3, max: 1.36, start: 0.66 } as const;
/** Radians east of south the camera starts at: the sun over its left shoulder. */
const START_AZIMUTH = 0.42;
/** Seconds the lens takes to come round to a new angle. */
const TURN_SETTLE = 0.5;
/** A building in the way for this long (s) and the lens looks for a clear angle. */
const BLOCKED_FOR = 0.4;
/** After a turn by hand the lens is left where it was put for this long (s). */
const HAND_HOLD = 8;
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Blur-disc scale for depth of field (pixels at 1080 lines per unit of relative defocus): a miniature's shallow focus. */
const APERTURE = 30;

export interface View {
  /** Whether this call drew a new picture. */
  drawn: boolean;
  /** Where the puppet is in the picture (CSS pixels), or null when no fly is drawn. */
  fly: { x: number; y: number; length: number; inFrame: boolean } | null;
  /** CSS pixels per city metre where the lens is focused. */
  pxPerM: number;
  /** Degrees clockwise from up the picture that north lies. */
  northDeg: number;
  /** Where the edge of the model is in the picture (CSS pixels), when it is in view. */
  edge: { x: number; y: number } | null;
  /** The puppet's mesh has arrived (until then only its place is marked). */
  flyReady: boolean;
  /** A building hides the puppet from this angle (its place is marked instead). */
  flyHidden: boolean;
}

class World {
  readonly scene = new THREE.Scene();
  readonly detail: THREE.CanvasTexture;
  readonly lib: ClayLibrary;
  readonly lights: StudioLights;
  readonly city: CityModel;
  readonly puppet: Puppet;
  readonly figures: Figures;
  readonly trail: Trail;
  /** Everything that moves: left out of the wide shadow map, which is drawn once. */
  readonly cast = new THREE.Group();
  readonly post: PostChain;

  constructor(
    renderer: THREE.WebGLRenderer,
    readonly q: Quality,
  ) {
    this.scene.name = "bethesda in clay";
    this.detail = clayDetail(q.textureSize);
    this.lib = new ClayLibrary(this.detail);
    // First: Three lists shadow-casting lights in scene order, and the cascade patch expects the sun's two maps first.
    this.lights = new StudioLights(renderer, this.scene, q);
    this.city = buildCity(this.lib, q.textureSize);
    this.puppet = new Puppet(this.lib);
    this.puppet.finest = q.flyLod;
    this.figures = new Figures(this.lib);
    this.trail = new Trail(this.lib);
    this.cast.name = "cast";
    this.cast.add(this.puppet.rig, this.figures.group, this.trail.group);
    this.scene.add(this.city.group, this.cast);
    const high = q.name === "high";
    this.post = new PostChain(renderer, q.msaa, high ? 16 : 10, high ? 48 : 28);
  }

  dispose() {
    this.puppet.dispose();
    this.figures.dispose();
    this.trail.dispose();
    this.city.dispose();
    this.lights.dispose();
    this.post.dispose();
    this.lib.dispose();
    this.detail.dispose();
    this.scene.clear();
  }
}

export class DioramaScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera = new THREE.PerspectiveCamera(LENS.fovDeg, 1, LENS.near, LENS.far);
  /** True while the browser has taken the GPU context away. */
  lost = false;
  private world: World;
  private css = { width: 1, height: 1 };
  private dpr = 1;
  private zoom: number = ZOOM.start;
  private distance = 0;
  private azimuth = START_AZIMUTH;
  private pitch: number = PITCH.start;
  /** Where the lens is coming round to, and the pitch it was last put at by hand. */
  private goal = { azimuth: START_AZIMUTH, pitch: PITCH.start as number };
  private chosenPitch: number = PITCH.start;
  private handAt = -Infinity;
  private blockedSince: number | null = null;
  private clearSince: number | null = null;
  private hidden = false;
  private readonly depths = new WeakMap<THREE.Material, number>();
  private readonly target = new THREE.Vector3();
  private hasTarget = false;
  private observation: LifeObservation | null = null;
  private storm = 0;
  private lastIndex: number | null = null;
  private lastStepMs = 0;
  private lastMs = 0;
  private dirty = true;
  private wideDrawn = false;
  private last: View = {
    drawn: false,
    fly: null,
    pxPerM: ZOOM.start,
    northDeg: 0,
    edge: null,
    flyReady: false,
    flyHidden: false,
  };
  private readonly onLost = (e: Event) => {
    e.preventDefault();
    this.lost = true;
  };
  private readonly onRestored = () => {
    this.lost = false;
    const q = this.world.q;
    this.world.dispose();
    this.world = new World(this.renderer, q);
    this.wideDrawn = false;
    this.resize(this.css.width, this.css.height, this.dpr);
  };

  /** Throws if the browser cannot give a WebGL 2 context (the page then shows the flat map). */
  constructor(
    private readonly canvas: HTMLCanvasElement,
    quality: Quality,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      stencil: false,
      powerPreference: "default",
    });
    this.renderer.autoClear = false;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.setClearColor(0x000000, 1);
    this.world = new World(this.renderer, quality);
    // Until the first observation the lens rests on the middle of the model.
    const middle = {
      x: (bounds.min.x + bounds.max.x) / 2,
      z: (bounds.min.z + bounds.max.z) / 2,
    };
    this.target.set(middle.x, groundAt(middle), middle.z).multiplyScalar(MODEL_SCALE);
    canvas.addEventListener("webglcontextlost", this.onLost);
    canvas.addEventListener("webglcontextrestored", this.onRestored);
  }

  get quality(): Quality {
    return this.world.q;
  }

  /**
   * Compiles the model's shaders ahead of the first picture, in parallel where
   * the browser can. Three asks every material in the scene whether it is
   * ready, hidden ones included, so everything is shown while it compiles.
   */
  async prepare(): Promise<void> {
    this.place();
    const scene = this.world.scene;
    const hidden: THREE.Object3D[] = [];
    scene.traverse((o) => {
      if (!o.visible) {
        hidden.push(o);
        o.visible = true;
      }
    });
    try {
      await this.renderer.compileAsync(scene, this.camera);
    } finally {
      for (const o of hidden) o.visible = false;
    }
  }

  resize(width: number, height: number, dpr: number) {
    this.css = { width: Math.max(1, width), height: Math.max(1, height) };
    this.dpr = dpr;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(this.css.width, this.css.height, false);
    const b = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.world.post.setSize(b.x, b.y);
    this.camera.aspect = this.css.width / this.css.height;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  setQuality(q: Quality) {
    if (q.name === this.world.q.name) return;
    this.world.dispose();
    this.world = new World(this.renderer, q);
    this.wideDrawn = false;
    this.resize(this.css.width, this.css.height, this.dpr);
  }

  /** CSS pixels per city metre at the fly. */
  setZoom(zoom: number) {
    this.zoom = clampZoom(zoom);
    this.dirty = true;
  }

  /**
   * Turns the lens round the fly by hand: `dAzimuth` clockwise seen from
   * above, `dPitch` up, radians. A drag is followed at once; a button's turn
   * (`ease`) is come round to.
   */
  orbit(dAzimuth: number, dPitch: number, ease = false) {
    this.goal.azimuth += dAzimuth;
    this.goal.pitch = Math.min(PITCH.max, Math.max(PITCH.min, this.goal.pitch + dPitch));
    this.chosenPitch = this.goal.pitch;
    if (!ease) {
      this.azimuth = this.goal.azimuth;
      this.pitch = this.goal.pitch;
    }
    this.handAt = performance.now();
    this.dirty = true;
  }

  /**
   * Keeps the fly in sight. When a building has stood between the lens and
   * the fly for a moment, the lens comes round to the nearest angle with a
   * clear view (raising itself if it must); when the view from the height it
   * was put at is clear again, it comes back down. A turn by hand is left
   * alone for a while first.
   */
  private keepInSight(pose: PresentedPose, nowMs: number) {
    const reach = this.distance / MODEL_SCALE;
    // What the lens looks at: a little above the fly's feet.
    const p = { x: pose.x, y: pose.y + 0.6, z: pose.z };
    const seen = (azimuth: number, pitch: number) =>
      !buildingInTheWay(p, azimuth, pitch, reach);
    // The whole puppet in view, not only its middle: both its sides as the lens sees them, and its back.
    const side = (0.35 * this.world.puppet.length) / MODEL_SCALE;
    const whole = (azimuth: number, pitch: number) => {
      if (!seen(azimuth, pitch)) return false;
      const rx = Math.cos(azimuth) * side,
        rz = -Math.sin(azimuth) * side;
      return [-1, 1].every(
        (k) =>
          !buildingInTheWay(
            { x: p.x + rx * k, y: p.y + side, z: p.z + rz * k },
            azimuth,
            pitch,
            reach,
          ),
      );
    };
    this.hidden = !seen(this.azimuth, this.pitch);
    const held = nowMs - this.handAt < HAND_HOLD * 1000;
    if (!whole(this.goal.azimuth, this.goal.pitch)) {
      this.clearSince = null;
      this.blockedSince ??= nowMs;
      if (held || nowMs - this.blockedSince < BLOCKED_FOR * 1000) return;
      // The nearest angle that shows all of it; failing that, the nearest that shows its middle.
      for (const clear of [whole, seen]) {
        let best: { azimuth: number; pitch: number } | null = null,
          cost = Infinity;
        for (let k = -8; k <= 8; k++)
          for (const up of [0, 0.22, 0.44, PITCH.max]) {
            const azimuth = this.goal.azimuth + (k * Math.PI) / 8;
            const pitch =
              up === PITCH.max ? PITCH.max : Math.min(PITCH.max, this.goal.pitch + up);
            const c = Math.abs(k) * (Math.PI / 8) + 1.6 * (pitch - this.goal.pitch);
            if (c < cost && clear(azimuth, pitch)) {
              cost = c;
              best = { azimuth, pitch };
            }
          }
        if (best) {
          this.goal = best;
          break;
        }
        // If the lens already shows its middle, it stays: nothing better is to be had.
        if (clear === whole && seen(this.goal.azimuth, this.goal.pitch)) break;
      }
      // No angle is clear when the fly is under a roof: the page marks its place instead.
      this.blockedSince = null;
      return;
    }
    this.blockedSince = null;
    if (this.goal.pitch <= this.chosenPitch + 1e-3 || held) return;
    if (!whole(this.goal.azimuth, this.chosenPitch)) {
      this.clearSince = null;
      return;
    }
    this.clearSince ??= nowMs;
    if (nowMs - this.clearSince > 3000) this.goal.pitch = this.chosenPitch;
  }

  /**
   * What the witness last served: the observation to draw (null: no fly, no
   * figures and no path are drawn), received at `at` on the viewer's clock.
   */
  observe(o: LifeObservation | null, at: number) {
    const changed = o?.tick !== this.observation?.tick || !o !== !this.observation;
    this.observation = o;
    if (!changed) return;
    this.world.figures.observe(o ? o.nearby : null, at);
    this.dirty = true;
  }

  /**
   * Draws the model at `nowMs` (the viewer's clock) if anything visible has
   * changed: a new stop-motion frame, the lens moving, or a new size. The
   * fly's pose is read from `samples`, the delay behind the newest that the
   * flat map uses.
   */
  render(samples: readonly Sample[], nowMs: number, reducedMotion: boolean): View {
    if (this.lost) return { ...this.last, drawn: false };
    const w = this.world;
    const index = Math.floor((nowMs / 1000) * FRAMES_PER_SECOND);
    const frameMs = (index / FRAMES_PER_SECOND) * 1000;
    const newFrame = index !== this.lastIndex;

    // The zoom answers the hand at the display's rate.
    const want = cameraDistance(this.zoom, this.css.height);
    const dtDisplay = Math.min(0.1, Math.max(0, (nowMs - this.lastMs) / 1000));
    this.lastMs = nowMs;
    const before = this.distance;
    this.distance =
      this.distance === 0 || reducedMotion
        ? want
        : want *
          Math.exp(Math.log(this.distance / want) * Math.exp(-dtDisplay / ZOOM_SETTLE));
    if (Math.abs(this.distance / want - 1) < 0.002) this.distance = want;
    const zooming = this.distance !== before;
    // So does the lens coming round to a new angle.
    const dAzimuth = wrapAngle(this.goal.azimuth - this.azimuth),
      dPitch = this.goal.pitch - this.pitch;
    const turning = Math.abs(dAzimuth) > 0.002 || Math.abs(dPitch) > 0.002;
    if (turning) {
      const k = reducedMotion ? 1 : 1 - Math.exp(-dtDisplay / TURN_SETTLE);
      this.azimuth += dAzimuth * k;
      this.pitch += dPitch * k;
    } else {
      this.azimuth = this.goal.azimuth = wrapAngle(this.goal.azimuth);
      this.pitch = this.goal.pitch;
    }
    if (!newFrame && !zooming && !turning && !this.dirty)
      return { ...this.last, drawn: false };

    const o = this.observation;
    let pose: PresentedPose | null = null;
    if (newFrame || this.dirty) {
      const first = this.lastIndex === null;
      const dt = first ? 0 : Math.min(0.5, (nowMs - this.lastStepMs) / 1000);
      this.lastStepMs = nowMs;
      pose = o ? presentPose(samples, frameMs) : null;
      const pxPerModelM = this.pxPerModelM();
      const handmade = !reducedMotion;
      w.puppet.update(
        pose,
        {
          mode: o?.fly.mode ?? "rest",
          speedMS: o ? Math.hypot(...o.fly.velocity) : 0,
        },
        this.zoom,
        { index, time: frameMs / 1000, handmade },
        dt,
        pxPerModelM * this.dpr,
        { distance: this.distance, near: Math.max(LENS.near, this.distance * 0.12) },
      );
      this.soften(w);
      w.figures.update(frameMs - PRESENT_DELAY_MS);
      w.trail.update(pose, this.zoom);
      // The lens follows on the animation's frames, like a motion-control rig.
      if (pose) {
        const goal = w.puppet.centre;
        const far = this.target.distanceTo(goal) > 20 * MODEL_SCALE;
        if (!this.hasTarget || far || reducedMotion || dt === 0) this.target.copy(goal);
        else this.target.lerp(goal, 1 - Math.exp(-dt / FOLLOW_SETTLE));
        this.hasTarget = true;
        this.keepInSight(pose, nowMs);
      } else this.hidden = false;
      const storm = o?.weather?.regime === "storm" ? 1 : 0;
      this.storm =
        dt === 0 || reducedMotion
          ? storm
          : storm + (this.storm - storm) * Math.exp(-dt / 4);
      w.lights.setStorm(this.storm);
    }
    this.lastIndex = index;
    this.dirty = false;

    this.place();
    const visible =
      (this.css.height / this.pxPerModelM()) * Math.max(1, this.camera.aspect);
    w.lights.fitNear(this.target, Math.min(2.4, Math.max(0.04, visible * 0.85)));

    const frame = {
      exposure: w.lights.exposure,
      night: 0,
      // From far off the whole model is the subject: the lens is stopped down.
      focus: {
        distance: this.distance,
        aperture:
          APERTURE * Math.min(1, Math.max(0.3, Math.sqrt(this.zoom / ZOOM.start))),
      },
      dof: w.q.dof === "always" || (w.q.dof === "macro" && this.zoom >= 24),
      ao: w.q.ao,
      frameIndex: reducedMotion ? 0 : index,
      blur: null,
      meter: false,
    };
    if (!this.wideDrawn) {
      // The board's shadow map is drawn once, without the cast: they move, it does not.
      w.cast.visible = false;
      w.lights.redrawWide();
      w.post.render(w.scene, this.camera, frame);
      w.cast.visible = true;
      this.wideDrawn = true;
    }
    w.post.render(w.scene, this.camera, frame);

    this.last = {
      drawn: true,
      fly: this.locate(),
      pxPerM: this.pxPerModelM() * MODEL_SCALE,
      northDeg: THREE.MathUtils.radToDeg(this.azimuth),
      edge: this.edge(),
      flyReady: w.puppet.ready,
      flyHidden: this.hidden,
    };
    return this.last;
  }

  /**
   * Close up, the model's hand marks are pressed less deep: a thumbprint the
   * depth of a kerb reads as clay from across the table and as rubble from a
   * hand's width.
   */
  private soften(w: World) {
    const ease = Math.min(1, Math.max(0.35, 12 / this.zoom));
    w.lib.each((m) => {
      if (!m.name.startsWith("city-clay") && !m.name.startsWith("city-facade")) return;
      const u = m.userData.clay;
      let base = this.depths.get(m);
      if (base === undefined) {
        base = u.uClayDepth.value;
        this.depths.set(m, base);
      }
      u.uClayDepth.value = base * ease;
    });
  }

  /** CSS pixels per model metre at the focus. */
  private pxPerModelM(): number {
    const d = this.distance || cameraDistance(this.zoom, this.css.height);
    return (
      this.css.height / (2 * Math.tan(THREE.MathUtils.degToRad(LENS.fovDeg) / 2) * d)
    );
  }

  /** Stands the camera on its orbit round the target. */
  private place() {
    const d = this.distance || cameraDistance(this.zoom, this.css.height);
    const c = Math.cos(this.pitch);
    this.camera.position.set(
      this.target.x + d * Math.sin(this.azimuth) * c,
      this.target.y + d * Math.sin(this.pitch),
      this.target.z + d * Math.cos(this.azimuth) * c,
    );
    this.camera.near = Math.max(LENS.near, d * 0.12);
    this.camera.far = LENS.far;
    this.camera.lookAt(this.target);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  private project(p: THREE.Vector3): { x: number; y: number; inFrame: boolean } {
    const depth = -p.clone().applyMatrix4(this.camera.matrixWorldInverse).z;
    const ndc = p.clone().project(this.camera);
    return {
      x: (ndc.x * 0.5 + 0.5) * this.css.width,
      y: (0.5 - ndc.y * 0.5) * this.css.height,
      inFrame:
        depth > this.camera.near && Math.abs(ndc.x) <= 1.02 && Math.abs(ndc.y) <= 1.02,
    };
  }

  /** Where the puppet is in the picture and how long. */
  private locate(): View["fly"] {
    const w = this.world;
    if (!w.puppet.rig.visible) return null;
    const p = this.project(w.puppet.centre);
    const depth = w.puppet.centre.distanceTo(this.camera.position);
    const pxPerM =
      this.css.height / (2 * Math.tan(THREE.MathUtils.degToRad(LENS.fovDeg) / 2) * depth);
    return { ...p, length: w.puppet.length * pxPerM };
  }

  /** The nearest point of the model's edge to what the lens looks at, if it is in the picture. */
  private edge(): View["edge"] {
    const x = this.target.x / MODEL_SCALE,
      z = this.target.z / MODEL_SCALE;
    const cx = Math.min(bounds.max.x, Math.max(bounds.min.x, x)),
      cz = Math.min(bounds.max.z, Math.max(bounds.min.z, z));
    const sides = [
      { d: cx - bounds.min.x, p: { x: bounds.min.x, z: cz } },
      { d: bounds.max.x - cx, p: { x: bounds.max.x, z: cz } },
      { d: cz - bounds.min.z, p: { x: cx, z: bounds.min.z } },
      { d: bounds.max.z - cz, p: { x: cx, z: bounds.max.z } },
    ].sort((a, b) => a.d - b.d);
    const near = sides[0]!.p;
    const s = this.project(
      new THREE.Vector3(near.x, groundAt(near), near.z).multiplyScalar(MODEL_SCALE),
    );
    const margin = 24;
    return s.inFrame &&
      s.x > margin &&
      s.x < this.css.width - margin &&
      s.y > margin &&
      s.y < this.css.height - margin
      ? { x: s.x, y: s.y }
      : null;
  }

  dispose() {
    this.canvas.removeEventListener("webglcontextlost", this.onLost);
    this.canvas.removeEventListener("webglcontextrestored", this.onRestored);
    this.world.dispose();
    this.renderer.dispose();
  }
}
