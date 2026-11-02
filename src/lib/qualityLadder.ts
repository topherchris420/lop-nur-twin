import type { QualityTier } from "./store";

const STEP_DOWN_BELOW_FPS = 50;
const STEP_UP_ABOVE_FPS = 55;
const STEP_DOWN_AFTER_SECONDS = 1;
const STEP_UP_AFTER_SECONDS = 2;
/** After a load or a step, frames pay for uploads and first draws: don't judge them. */
const SETTLE_SECONDS = 1.5;
/**
 * A frame this long says nothing about the GPU's sustained rate, because it is
 * almost always something else: a shader link, a collection, a tab coming back. A
 * run of them is the GPU, so they count once there have been this many in a row.
 */
const STALL_SECONDS = 0.25;
const STALLS_IN_A_ROW = 4;
/** How long to stay off a tier that could not hold its frame rate; doubles each time. */
const RETRY_AFTER_SECONDS = 60;
const RETRY_AFTER_LIMIT_SECONDS = 480;

/**
 * Decides when the adaptive ladder steps, from nothing but frame times, so the
 * decision can be tested without a renderer.
 *
 * Two things this has to get right that a plain threshold does not. A single stall
 * must not cost a tier: one 3 s shader link used to read as three seconds below
 * 50 FPS, and the links that followed each step then walked every machine down to
 * the bottom regardless of its GPU. And a machine that holds 60 FPS on one tier and
 * 40 on the next must not bounce between them forever, each climb a visible hitch,
 * so a tier that failed waits before it is tried again.
 */
export class QualityLadder {
  /** Smoothed frame rate, as shown on the HUD. */
  fps = 60;

  private elapsed = 0;
  private settle = SETTLE_SECONDS;
  private stalls = 0;
  private lowFor = 0;
  private highFor = 0;
  private readonly retryAt = [0, 0, 0, 0];
  private readonly retryDelay = [
    RETRY_AFTER_SECONDS,
    RETRY_AFTER_SECONDS,
    RETRY_AFTER_SECONDS,
    RETRY_AFTER_SECONDS,
  ];

  /** Takes one frame's duration; returns the tier to step to, or null to stay. */
  sample(delta: number, tier: QualityTier): QualityTier | null {
    const dt = Math.max(delta, 1e-4);
    if (dt > STALL_SECONDS) {
      this.stalls++;
      if (this.stalls < STALLS_IN_A_ROW) return null;
    } else {
      this.stalls = 0;
    }

    this.elapsed += dt;
    this.fps += (1 / dt - this.fps) * Math.min(1, dt * 4);

    if (this.settle > 0) {
      this.settle -= dt;
      return null;
    }

    if (this.fps < STEP_DOWN_BELOW_FPS) {
      this.lowFor += dt;
      this.highFor = 0;
    } else if (this.fps > STEP_UP_ABOVE_FPS) {
      this.highFor += dt;
      this.lowFor = 0;
    } else {
      this.lowFor = 0;
      this.highFor = 0;
    }

    if (this.lowFor > STEP_DOWN_AFTER_SECONDS && tier > 0) {
      const delay = this.retryDelay[tier] ?? RETRY_AFTER_SECONDS;
      this.retryAt[tier] = this.elapsed + delay;
      this.retryDelay[tier] = Math.min(delay * 2, RETRY_AFTER_LIMIT_SECONDS);
      return this.stepped((tier - 1) as QualityTier);
    }

    if (this.highFor > STEP_UP_AFTER_SECONDS && tier < 3) {
      const next = (tier + 1) as QualityTier;
      if (this.elapsed >= (this.retryAt[next] ?? 0)) return this.stepped(next);
    }
    return null;
  }

  private stepped(tier: QualityTier): QualityTier {
    this.settle = SETTLE_SECONDS;
    this.lowFor = 0;
    this.highFor = 0;
    return tier;
  }
}
