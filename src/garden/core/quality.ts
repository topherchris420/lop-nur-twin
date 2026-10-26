/**
 * Rendering presets and the adaptive resolution that keeps the garden smooth.
 * Nothing here touches the simulation; a slower device sees fewer grass
 * blades and softer shadows of the same moment.
 */
export const QUALITY_NAMES = ["high", "balanced", "performance"] as const;
export type QualityName = (typeof QUALITY_NAMES)[number];

export interface Quality {
  name: QualityName;
  label: string;
  /** Device-pixel-ratio range the adaptive resolution moves within. */
  maxDpr: number;
  minDpr: number;
  shadowMapSize: number;
  /** Ambient occlusion (screen space) on or off. */
  ao: boolean;
  /** Depth of field: everywhere, only in the macro lens, or never. */
  dof: "always" | "macro" | "off";
  /** Grass blades on the lawn (instanced). */
  grass: number;
  /** Fallen leaves, pebbles and other scattered small things. */
  scatter: number;
  /** Multisampling of the HDR render, samples per pixel (0 off). */
  msaa: number;
  /** FlyBody mesh level: 0 the 40 000-triangle mesh, 1 the 5 000-triangle one. */
  flyLod: 0 | 1;
  /** Procedural texture resolution (px). */
  textureSize: number;
  /** Frame-time budget the adaptive resolution aims for (ms). */
  budgetMs: number;
}

export const QUALITY: Record<QualityName, Quality> = {
  high: {
    name: "high",
    label: "High",
    maxDpr: 2,
    minDpr: 1,
    shadowMapSize: 2048,
    ao: true,
    dof: "always",
    grass: 64000,
    scatter: 900,
    msaa: 4,
    flyLod: 0,
    textureSize: 1024,
    budgetMs: 17,
  },
  balanced: {
    name: "balanced",
    label: "Balanced",
    maxDpr: 1.5,
    minDpr: 0.85,
    shadowMapSize: 1536,
    ao: true,
    dof: "always",
    grass: 36000,
    scatter: 520,
    msaa: 4,
    flyLod: 0,
    textureSize: 1024,
    budgetMs: 22,
  },
  performance: {
    name: "performance",
    label: "Performance",
    maxDpr: 1.25,
    minDpr: 0.7,
    shadowMapSize: 1024,
    ao: false,
    dof: "macro",
    grass: 15000,
    scatter: 240,
    msaa: 2,
    flyLod: 1,
    textureSize: 512,
    budgetMs: 30,
  },
};

export interface DeviceHints {
  /** A phone or tablet (coarse pointer, small screen). */
  mobile: boolean;
  /** `navigator.hardwareConcurrency`, if known. */
  cores: number | null;
  /** `navigator.deviceMemory` (GB), if known. */
  memoryGb: number | null;
  /** The browser asked for less data (`Save-Data`). */
  saveData: boolean;
}

/** The preset a device starts on before any frame has been measured. */
export function defaultQuality(d: DeviceHints): QualityName {
  if (d.saveData) return "performance";
  if (d.mobile)
    return (d.memoryGb ?? 4) >= 6 && (d.cores ?? 4) >= 8 ? "balanced" : "performance";
  if ((d.cores ?? 8) <= 4 || (d.memoryGb ?? 8) <= 4) return "balanced";
  return "high";
}

export const isQualityName = (v: unknown): v is QualityName =>
  typeof v === "string" && (QUALITY_NAMES as readonly string[]).includes(v);

/**
 * Moves the render resolution between a preset's limits to keep frame time
 * within budget: down quickly when frames are slow, up slowly when there is
 * room. Frame times while the tab is hidden or the camera is still and the
 * stop-motion frame unchanged are not samples (nothing was drawn).
 */
export class AdaptiveResolution {
  private samples: number[] = [];
  private cooldown = 0;
  dpr: number;

  constructor(
    private q: Quality,
    private readonly deviceDpr: number,
  ) {
    this.dpr = this.ceiling();
  }

  private ceiling() {
    return Math.min(this.q.maxDpr, Math.max(1, this.deviceDpr));
  }

  setQuality(q: Quality) {
    this.q = q;
    this.dpr = this.ceiling();
    this.samples = [];
  }

  /** Records one drawn frame's duration (ms). Returns true when the resolution changed. */
  sample(ms: number): boolean {
    if (!(ms > 0) || ms > 250) return false;
    this.samples.push(ms);
    if (this.samples.length > 30) this.samples.shift();
    if (this.cooldown > 0) {
      this.cooldown--;
      return false;
    }
    if (this.samples.length < 20) return false;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const typical = sorted[Math.floor(sorted.length * 0.7)]!;
    const budget = this.q.budgetMs;
    let next = this.dpr;
    if (typical > budget * 1.15)
      next = this.dpr * Math.max(0.75, Math.sqrt(budget / typical));
    else if (typical < budget * 0.6) next = this.dpr * 1.08;
    next = Math.min(this.ceiling(), Math.max(this.q.minDpr, Math.round(next * 20) / 20));
    if (Math.abs(next - this.dpr) < 0.01) return false;
    this.dpr = next;
    this.samples = [];
    this.cooldown = 30;
    return true;
  }
}
