/**
 * The garden as a film set. `GardenScene` builds the clay world for a quality
 * preset, then, for each presented instant, poses everything in it from the
 * states the server published and photographs it:
 *
 *   presented time → stop-motion frame → the published states around that
 *   frame → the fly's pose, the light, the wind, the midge and the swaying
 *   leaf → the camera → shadows → HDR render → occlusion, depth of field,
 *   grade → the canvas.
 *
 * Everything flows one way. The scene reads frozen observations through a
 * function and keeps nothing that feeds back: no camera, preset or frame
 * rate changes what the fly does, and the same presented instant gives
 * every visitor the same garden, seen through their own lens.
 */
import * as THREE from "three";
import { nearbyAt, perform, type FlyPose } from "../core/performance.js";
import type { Quality } from "../core/quality.js";
import { meterGain } from "../core/meter.js";
import { lightAt, type Light } from "../core/sky.js";
import { swayFrame } from "../core/stage.js";
import {
  clampFps,
  frameAt,
  SHUTTER,
  type Frame,
  type StopMotion,
} from "../core/stopMotion.js";
import type { Interval } from "../core/timeline.js";
import { clamp, type V3 } from "../core/vec.js";
import { buildBackdrop, type Backdrop } from "./backdrop.js";
import { GardenCamera, LEAD_S, type CameraMode } from "./camera.js";
import { ClayLibrary, WIND, type ClayMaterial } from "./clay.js";
import { Midge } from "./critters.js";
import { BODY_M, ClayFly, type FlyStatus } from "./fly.js";
import { buildGround, type GroundSet } from "./ground.js";
import { GardenLights } from "./light.js";
import { buildMaple, type MapleSet } from "./maple.js";
import { FAR_LAYER, PostChain } from "./post.js";
import { buildProps, type PropSet } from "./props.js";
import { Rain } from "./rain.js";
import { clayDetail, decalAtlas, type DecalAtlas } from "./textures.js";

/** The published states around a presented instant (frozen), or null before the first arrives. */
export type IntervalAt = (t: number) => Interval | null;

export interface SceneSettings {
  camera: CameraMode;
  stopMotion: StopMotion;
  motionBlur: boolean;
  reducedMotion: boolean;
}

export interface FlyOnScreen {
  /** CSS pixels from the canvas's top left. */
  x: number;
  y: number;
  /** Its body length on screen, CSS pixels. */
  length: number;
  inFrame: boolean;
}

export interface Picture {
  /** Whether this call drew a new picture. */
  drawn: boolean;
  pose: FlyPose | null;
  light: Light | null;
  fly: FlyOnScreen | null;
  flyStatus: FlyStatus;
  frame: Frame | null;
}

/** The server reports the wind's speed, not its direction: the picture uses one fixed direction. */
const WIND_DIR = new THREE.Vector2(0.86, 0.5).normalize();
/** Shader clocks run on float32: unix time reduced to the hour keeps them precise (a once-an-hour jump in the water's ripples). */
const shaderTime = (t: number) => t % 3600;
const vec = (v: V3) => new THREE.Vector3(v[0], v[1], v[2]);
/** Precipitation as a picture: none, or 0.15 (a drizzle) up to 1 (4 mm or more). */
const precipitation = (light: Light) =>
  light.rain > 0 ? clamp(0.15 + light.rain / 4, 0, 1) : 0;

/**
 * On Windows the browser compiles shaders to Direct3D, whose compiler notes
 * precision in three.js's own environment-prefiltering shader (`warning
 * X4122`) though it links and runs as written. three would print that as a
 * warning on every visit; it goes to the verbose level instead, still there
 * for anyone who looks. Everything else three says passes through unchanged.
 */
const DRIVER_NOTE = /^\(\d+,\d+(?:-\d+)?\): warning X\d+:/;
THREE.setConsoleFunction((type, message, ...params) => {
  const [log] = params;
  const note =
    type === "warn" &&
    message === "THREE.WebGLProgram: Program Info Log:" &&
    typeof log === "string" &&
    log
      .replace(/\0/g, "") // the driver's log keeps its C terminator
      .split("\n")
      .every((l) => !l.trim() || DRIVER_NOTE.test(l.trim()));
  console[note ? "debug" : type](message, ...params);
});

/** Everything the quality preset decides, rebuilt when it changes. */
class World {
  readonly scene = new THREE.Scene();
  readonly lib: ClayLibrary;
  readonly detail: THREE.CanvasTexture;
  readonly atlas: DecalAtlas;
  readonly lights: GardenLights;
  readonly ground: GroundSet;
  readonly props: PropSet;
  readonly maple: MapleSet;
  readonly backdrop: Backdrop;
  readonly fly: ClayFly;
  readonly midge: Midge;
  readonly rain: Rain;
  readonly post: PostChain;

  constructor(
    renderer: THREE.WebGLRenderer,
    readonly q: Quality,
  ) {
    this.scene.name = "garden";
    this.detail = clayDetail(q.textureSize);
    this.atlas = decalAtlas(q.textureSize);
    this.lib = new ClayLibrary(this.detail);
    // First: Three lists shadow-casting lights in scene order, and the cascade patch expects the sun's two maps first.
    this.lights = new GardenLights(renderer, this.scene, q);
    this.ground = buildGround(this.lib, this.atlas, q);
    this.props = buildProps(this.lib, this.atlas, q);
    this.maple = buildMaple(this.lib, this.atlas, q);
    this.backdrop = buildBackdrop(this.lib, q.textureSize);
    // The sky dome sits at infinity: only the far range of a split render draws it.
    this.backdrop.group.traverse((o) => {
      if (o instanceof THREE.Mesh && o.material === this.backdrop.sky)
        o.layers.set(FAR_LAYER);
    });
    this.fly = new ClayFly(this.lib);
    this.fly.finest = q.flyLod;
    this.fly.load(1);
    this.midge = new Midge(this.lib);
    this.rain = new Rain(q.name === "high" ? 3000 : q.name === "balanced" ? 2000 : 1000);
    this.scene.add(
      this.ground.group,
      this.props.group,
      this.maple.group,
      this.backdrop.group,
    );
    this.scene.add(this.fly.root, this.fly.contact, this.midge.group, this.rain.lines);
    const high = q.name === "high";
    this.post = new PostChain(renderer, q.msaa, high ? 16 : 10, high ? 48 : 28);
  }

  dispose() {
    this.fly.dispose();
    this.midge.dispose();
    this.rain.dispose();
    this.ground.dispose();
    this.props.dispose();
    this.maple.dispose();
    this.backdrop.dispose();
    this.lights.dispose();
    this.post.dispose();
    this.lib.dispose();
    this.detail.dispose();
    this.atlas.color.dispose();
    this.atlas.relief.dispose();
    this.scene.clear();
  }
}

export class GardenScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: GardenCamera;
  /** True while the browser has taken the GPU context away (the page then waits for it back). */
  lost = false;
  private world: World;
  private settings: SceneSettings;
  private lastIndex: number | null = null;
  private lastDrawMs = -Infinity;
  private lastStepMs = 0;
  /** The close-up lens's exposure over the light's (see `meterGain`), and the shot it was metered for. */
  private gain = 1;
  private gainShot: CameraMode | null = null;
  private dirty = true;
  private css = { width: 1, height: 1 };
  private dpr = 1;
  private wet = { garden: -1, fly: -1 };
  private readonly dry = new WeakMap<
    THREE.Material,
    { roughness: number; color: THREE.Color }
  >();
  private last: Picture = {
    drawn: false,
    pose: null,
    light: null,
    fly: null,
    flyStatus: "loading",
    frame: null,
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
    this.resize(this.css.width, this.css.height, this.dpr);
  };

  /** Throws if the browser cannot give a WebGL 2 context (the page then shows the plain garden). */
  constructor(
    private readonly canvas: HTMLCanvasElement,
    quality: Quality,
    settings: SceneSettings,
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
    this.settings = { ...settings };
    this.camera = new GardenCamera(canvas);
    this.camera.setMode(settings.camera, null);
    this.world = new World(this.renderer, quality);
    canvas.addEventListener("webglcontextlost", this.onLost);
    canvas.addEventListener("webglcontextrestored", this.onRestored);
  }

  get quality(): Quality {
    return this.world.q;
  }

  /** Compiles the garden's shaders ahead of the first picture, in parallel where the browser can. */
  async prepare(): Promise<void> {
    await this.renderer.compileAsync(this.world.scene, this.camera.camera);
  }

  resize(width: number, height: number, dpr: number) {
    this.css = { width: Math.max(1, width), height: Math.max(1, height) };
    this.dpr = dpr;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(this.css.width, this.css.height, false);
    const b = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.world.post.setSize(b.x, b.y);
    this.camera.setAspect(this.css.width / this.css.height);
    this.dirty = true;
  }

  setQuality(q: Quality) {
    if (q.name === this.world.q.name) return;
    this.world.dispose();
    this.world = new World(this.renderer, q);
    this.wet = { garden: -1, fly: -1 };
    this.resize(this.css.width, this.css.height, this.dpr);
  }

  update(settings: Partial<SceneSettings>) {
    this.settings = { ...this.settings, ...settings };
    if (settings.camera) this.camera.setMode(settings.camera, this.last.pose);
    this.dirty = true;
  }

  /** Asks for a new picture on the next call even if the frame has not changed. */
  invalidate() {
    this.dirty = true;
  }

  /**
   * Draws the garden at presented time `t` if anything visible has changed:
   * a new stop-motion frame, the free camera moving, or new settings.
   * Without stop motion, it draws at up to about 60 pictures a second.
   */
  render(intervalAt: IntervalAt, t: number, nowMs: number): Picture {
    if (this.lost) return { ...this.last, drawn: false };
    const s = this.settings,
      w = this.world;
    const frame = frameAt(t, s.stopMotion);
    const moved = this.camera.frame();
    const newFrame = s.stopMotion.enabled
      ? frame.index !== this.lastIndex
      : nowMs - this.lastDrawMs >= 15;
    if (!newFrame && !moved && !this.dirty) return { ...this.last, drawn: false };
    const iv = intervalAt(frame.time);
    if (!iv) return { ...this.last, drawn: false };
    const pose = perform(iv, frame.time);
    const light = lightAt(frame.time, iv.next.weather);
    let dt = 0;
    if (newFrame || this.dirty) {
      const first = this.lastIndex === null;
      dt = first
        ? 0
        : s.stopMotion.enabled
          ? 1 / clampFps(s.stopMotion.fps)
          : Math.min(0.1, (nowMs - this.lastStepMs) / 1000);
      const leadIv =
        this.camera.mode === "tracking" || this.camera.mode === "macro"
          ? intervalAt(frame.time + LEAD_S)
          : null;
      this.camera.step(
        pose,
        leadIv ? perform(leadIv, frame.time + LEAD_S) : null,
        frame.time,
        dt,
        s.reducedMotion,
      );
      this.lastStepMs = nowMs;
    }
    this.lastIndex = frame.index;
    this.lastDrawMs = nowMs;
    this.dirty = false;
    const cam = this.camera.camera;
    cam.updateMatrixWorld();

    this.stage(w, intervalAt, iv, frame.time, light);
    w.lights.update(
      light,
      this.camera.shadowFocus.point,
      this.camera.shadowFocus.radius,
      frame.time,
    );
    // Close up, the lens meters what it frames and eases to it, as a camera's
    // automatic exposure does; a new shot meters afresh. The wide shot keeps
    // the light's exposure.
    const mode = this.camera.mode;
    if (mode !== this.gainShot || pose?.cut) {
      w.post.resetMeter();
      this.gainShot = mode;
    }
    const metered = mode === "observation" ? null : w.post.metered;
    const want =
      metered === null
        ? mode === "observation"
          ? 1
          : this.gain
        : meterGain(w.lights.exposure, metered, light.daylight);
    this.gain =
      s.reducedMotion || pose?.cut
        ? want
        : this.gain + (want - this.gain) * (1 - Math.exp(-dt / 0.6));
    const fly = this.locate(pose);
    const handmade = s.stopMotion.enabled && !s.reducedMotion;
    w.fly.update(
      pose,
      { index: frame.index, time: frame.time, handmade },
      fly.length * this.dpr,
      fly.inFrame,
    );
    this.soak(w, light, iv.next.learning?.wetness ?? null);

    const close = this.camera.mode === "macro" || this.camera.mode === "tracking";
    const samples =
      s.motionBlur && !s.reducedMotion && w.q.name !== "performance" ? 4 : 0;
    w.post.render(w.scene, cam, {
      exposure: w.lights.exposure * this.gain,
      meter: mode !== "observation",
      night: w.lights.night,
      focus: this.camera.focus,
      dof: w.q.dof === "always" || (w.q.dof === "macro" && close),
      ao: w.q.ao,
      frameIndex: s.reducedMotion ? 0 : frame.index,
      blur:
        samples > 1
          ? {
              samples,
              set: (k) => {
                // The shutter is open for part of the frame: from its instant forward in stop motion,
                // up to the present instant otherwise. The camera holds still within an exposure.
                const span =
                  SHUTTER / (s.stopMotion.enabled ? clampFps(s.stopMotion.fps) : 60);
                const ts = s.stopMotion.enabled
                  ? frame.time + k * span
                  : frame.time - (1 - k) * span;
                const sub = intervalAt(ts);
                if (!sub) return;
                this.stage(w, intervalAt, sub, ts, light);
                w.fly.update(
                  perform(sub, ts),
                  { index: frame.index, time: ts, handmade },
                  fly.length * this.dpr,
                  fly.inFrame,
                );
              },
            }
          : null,
    });
    this.last = { drawn: true, pose, light, fly, flyStatus: w.fly.status, frame };
    return this.last;
  }

  /** Everything besides the fly that moves: the wind in the plants, the swaying leaf, the midge, water, sky, rain. */
  private stage(
    w: World,
    intervalAt: IntervalAt,
    iv: Interval,
    time: number,
    light: Light,
  ) {
    const wind = iv.next.weather.windKmh;
    const leaf = swayFrame("leaf", time, wind);
    w.maple.shelter.quaternion.setFromAxisAngle(vec(leaf.axis), leaf.angle);
    const flower = swayFrame("flower", time, wind);
    w.props.hero.quaternion.setFromAxisAngle(vec(flower.axis), flower.angle);
    const near = nearbyAt(iv);
    if (near.leaf) {
      // Turn the leaf on its twig so its centre sits where the server's offset puts it.
      const arm = vec(w.maple.swayingArm);
      const to = arm.clone().add(new THREE.Vector3(near.leaf[0], near.leaf[1], 0));
      w.maple.swaying.quaternion.setFromUnitVectors(arm.normalize(), to.normalize());
    } else w.maple.swaying.quaternion.identity();
    const later = intervalAt(time + 2);
    w.midge.update(near.midge, time, later ? nearbyAt(later).midge : null);

    const strength = clamp((wind ?? 8) / 35, 0.12, 1);
    WIND.value.set(shaderTime(time), strength, WIND_DIR.x, WIND_DIR.y);
    const rain = precipitation(light);
    const water = w.props.saucer.water.userData.uniforms;
    water.uTime.value = shaderTime(time);
    water.uRain.value = light.snow ? 0 : rain;
    water.uWind.value = strength;
    w.backdrop.update(light, time, Math.floor(time * 12));

    // Rain fills a box reaching from the lens to just past what it looks at.
    const cam = this.camera.camera;
    const size = clamp(this.camera.focus.distance * 0.6, 0.03, 2.5);
    const dir = cam.getWorldDirection(new THREE.Vector3());
    const center = cam.position.clone().addScaledVector(dir, size * 0.9);
    w.rain.update({
      amount: rain,
      snow: light.snow,
      center: [center.x, center.y, center.z],
      size,
      time: shaderTime(time),
      sky: light.horizon,
      wind: light.wind,
    });
  }

  /** Where the fly is in the picture and how big. */
  private locate(pose: FlyPose): FlyOnScreen {
    const cam = this.camera.camera;
    const p = vec(pose.position).addScaledVector(vec(pose.up), 0.0013);
    const depth = -p.clone().applyMatrix4(cam.matrixWorldInverse).z;
    const ndc = p.clone().project(cam);
    const { width, height } = this.css;
    const pxPerM =
      depth > 0
        ? height / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) * depth)
        : 0;
    return {
      x: (ndc.x * 0.5 + 0.5) * width,
      y: (0.5 - ndc.y * 0.5) * height,
      length: BODY_M * pxPerM,
      inFrame: depth > cam.near && Math.abs(ndc.x) <= 1.02 && Math.abs(ndc.y) <= 1.02,
    };
  }

  /**
   * Wet clay is darker and glossier. The garden is wet while the reported
   * weather has rain; the fly is as wet as the server says it is.
   */
  private soak(w: World, light: Light, flyWetness: number | null) {
    const garden = light.rain > 0 && !light.snow ? clamp(0.45 + light.rain / 3, 0, 1) : 0;
    const fly = flyWetness ?? 0;
    if (Math.abs(garden - this.wet.garden) < 0.02 && Math.abs(fly - this.wet.fly) < 0.02)
      return;
    this.wet = { garden, fly };
    w.lib.each((m: ClayMaterial) => {
      let base = this.dry.get(m);
      if (!base) {
        base = { roughness: m.roughness, color: m.color.clone() };
        this.dry.set(m, base);
      }
      const wet = m.name.startsWith("fly-") ? fly : garden;
      m.roughness = base.roughness * (1 - 0.45 * wet);
      m.color.copy(base.color).multiplyScalar(1 - 0.2 * wet);
    });
  }

  dispose() {
    this.canvas.removeEventListener("webglcontextlost", this.onLost);
    this.canvas.removeEventListener("webglcontextrestored", this.onRestored);
    this.world.dispose();
    this.camera.dispose();
    this.renderer.dispose();
  }
}
