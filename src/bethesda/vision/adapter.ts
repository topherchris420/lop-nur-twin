/**
 * A research fly that sees looming through the compound eye.
 *
 * `EyeAdapter` wraps a decision maker (the deployed configuration,
 * `OrganismAdapter`, in every study here) and puts the image-forming eye in
 * front of it. With every sensory sample it renders an image from the body's
 * own pose (the eye is a sensor on the body: it is given where it is to know
 * what it sees), runs the motion pipeline, and holds the result for the
 * fly's visual latency. In `drive` mode the frame the wrapped controller
 * receives has its `looming` replaced by what the eye computed: the drive is
 * `gain` × the eye's giant-fiber drive and the bearing is the most active
 * looming unit's; the eye does not know what the object is or how far away,
 * so `id` is "eye", `kind` is "stimulus" and `distance` is NaN (only the
 * decision log prints them). The controller's own giant-fiber reflex then
 * decides, and its commands pass the body's gate as always. In `observe` mode
 * the frame is passed on unchanged and the eye is only recorded.
 *
 * Research only: the subject must be a research subject (`refuseOriginal`),
 * and nothing in production imports this module (the isolation test).
 */
import { refuseOriginal } from "../firstContact/originals.js";
import type {
  AdapterDescriptor,
  BodySnapshot,
  DecisionInput,
  FlyNeuralAdapter,
  MotorCommand,
} from "../fly/neural.js";
import { PARAMS } from "../fly/params.js";
import type { Looming, SenseFrame } from "../fly/senses.js";
import { LATTICE, LOOMING_UNITS } from "./lattice.js";
import { MotionVision, shuffledWiring, type MotionOutput } from "./motion.js";
import {
  VISION_PARAMS,
  VISION_VERSION,
  VISION_VERSIONS,
  type VisionVersion,
} from "./params.js";
import { photoreceptorStream, Renderer, type VisionScene } from "./scene.js";
import { mulberry32 } from "../../lib/noise.js";

export type EyeReadout = "lplc2" | "expansion";

export interface EyeOptions {
  /** The research subject's id (must not name an original). */
  subject: string;
  /** Seeds the photoreceptor noise and, for the shuffled control, the wiring. */
  seed: number;
  scene: VisionScene;
  /** `drive`: the eye's looming replaces the frame's; `observe`: recorded only. */
  mode: "drive" | "observe";
  readout: EyeReadout;
  /** Escape drive per unit of the eye's giant-fiber drive. */
  gain: number;
  /** The shuffled-retinotopy control. */
  shuffled?: boolean;
  /** Called with every image's output and the frame's own (geometric) looming. */
  record?: (r: EyeRecord) => void;
  /** Called with every rendered image, for a control that processes the same images. */
  image?: (luminance: Float64Array, t: number) => void;
  /** Photoreceptor noise on (the default) or off. */
  noise?: boolean;
  /** Which version of the eye; the current one unless set. */
  version?: VisionVersion;
}

export interface EyeRecord {
  t: number;
  mode: BodySnapshot["mode"];
  out: MotionOutput;
  /** The geometric giant-fiber proxy the fly's senses computed for the frame this call carries, or 0. */
  geometricDrive: number;
  /** That frame's looming as the fly's senses computed it (from the world's geometry), or null. */
  geometric: Looming | null;
  /** The frame time the controller decides on at this call. */
  frameT: number;
}

const HISTORY = 16;

export class EyeAdapter implements FlyNeuralAdapter {
  readonly descriptor: AdapterDescriptor;
  readonly inner: FlyNeuralAdapter;
  readonly vision: MotionVision;
  readonly options: Readonly<EyeOptions>;
  private readonly renderer: Renderer;
  private readonly image: Float64Array;
  private readonly rng: (() => number) | null;
  /** Outputs by image time, newest last, for the latency. */
  private readonly history: MotionOutput[] = [];
  /** Samples whose looming the eye replaced, and how many it reported. */
  replaced = 0;
  reported = 0;
  constructor(inner: FlyNeuralAdapter, options: EyeOptions) {
    refuseOriginal(options.subject, "eye subject");
    if (!options.subject.startsWith("research-"))
      throw new Error("an eye subject's id starts with research-");
    if (!(options.gain >= 0) || !Number.isFinite(options.gain))
      throw new Error("the eye's gain is a finite non-negative number");
    this.inner = inner;
    this.options = Object.freeze({ ...options });
    this.renderer = new Renderer(options.scene, LATTICE, PARAMS.visualRangeM.value);
    this.image = new Float64Array(LATTICE.n);
    this.rng = options.noise === false ? null : photoreceptorStream(options.seed);
    const shuffle = options.shuffled
      ? shuffledWiring(LATTICE, mulberry32((options.seed ^ 0x51ab1e) >>> 0))
      : null;
    const version = options.version ?? VISION_VERSION;
    this.vision = new MotionVision(LATTICE, LOOMING_UNITS, {
      shuffle,
      adaptation: VISION_VERSIONS[version],
    });
    const d = inner.descriptor;
    this.descriptor = {
      ...d,
      id: `${d.id} + ${version} (${options.readout}${options.shuffled ? ", shuffled" : ""}, ${options.mode})`,
      label: `${d.label}, seeing looming through a research compound eye`,
      fidelity: `${d.fidelity}; looming from an image-forming eye: Hassenstein–Reichardt motion detectors and LPLC2-like looming units (rate model, not spiking neurons, not a connectome)`,
    };
  }

  /** How many images the eye rendered, and how many had to cast the static scene again. */
  renderStats(): { images: number; casts: number } {
    return { images: this.renderer.images, casts: this.renderer.casts };
  }

  start(body: BodySnapshot): void {
    this.inner.start?.(body);
  }

  /** Render and process the image at the body's current pose. */
  private see(input: DecisionInput): void {
    const body = input.body;
    if (this.history.length && this.history[this.history.length - 1]!.t >= body.t) return;
    this.renderer.render(body.p, body.yaw, body.t, this.image, this.rng);
    this.options.image?.(this.image, body.t);
    const out = this.vision.step(this.image, body.t);
    this.history.push(out);
    if (this.history.length > HISTORY) this.history.shift();
    this.options.record?.({
      t: body.t,
      mode: body.mode,
      out,
      geometricDrive: input.frame.looming?.drive ?? 0,
      geometric: input.frame.looming,
      frameT: input.frame.t,
    });
  }

  /** The eye's output for the frame's sample time, or null before the eye has one. */
  private atFrame(frame: SenseFrame): MotionOutput | null {
    for (let k = this.history.length - 1; k >= 0; k--) {
      const h = this.history[k]!;
      if (Math.abs(h.t - frame.t) < 1e-9) return h;
      if (h.t < frame.t) break;
    }
    return null;
  }

  /** The looming the eye reports for an output, or null below the floor. */
  looming(out: MotionOutput | null): Looming | null {
    if (!out) return null;
    const lplc2 = this.options.readout === "lplc2";
    const drive = this.options.gain * (lplc2 ? out.lplc2 : out.expansion);
    const best = lplc2 ? out.lplc2Best : out.expansionBest;
    if (best < 0 || drive < VISION_PARAMS.loomingFloor.value * PARAMS.gfThreshold.value)
      return null;
    return {
      id: "eye",
      kind: "stimulus",
      distance: NaN,
      sizeDeg: NaN,
      expansionDegS: NaN,
      bearing: LOOMING_UNITS.azimuth[best]!,
      elevation: LOOMING_UNITS.elevation[best]!,
      drive,
    };
  }

  private through(input: DecisionInput): DecisionInput {
    this.see(input);
    if (this.options.mode !== "drive") return input;
    const looming = this.looming(this.atFrame(input.frame));
    this.replaced++;
    if (looming) this.reported++;
    const frame: SenseFrame = Object.freeze({ ...input.frame, looming });
    const body = input.body;
    return {
      body,
      frame,
      sites: input.sites,
      params: input.params,
      dt: input.dt,
      ...(input.self !== undefined ? { self: input.self } : {}),
    };
  }

  decide(input: DecisionInput): MotorCommand {
    return this.inner.decide(this.through(input));
  }

  interrupt(input: DecisionInput): MotorCommand | null {
    const next = this.through(input);
    return this.inner.interrupt ? this.inner.interrupt(next) : null;
  }
}
