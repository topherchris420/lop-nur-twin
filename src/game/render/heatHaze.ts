import * as THREE from "three";
import { BlendFunction, Effect, EffectAttribute } from "postprocessing";
import { MIRAGE } from "../world/mirage";

/**
 * Heat haze: the visible face of `world/mirage.ts`.
 *
 * The rule that matters is the mirage module's — a body at range is drawn,
 * reported and aimed at displaced across the line of sight. This pass only
 * makes the air look like the reason: distant pixels waver up and down by at
 * most a pixel and a half, starting at the same onset range and growing with
 * distance, so the far end of the apron and the horizon shimmer while nothing
 * near the player moves. It is decoration; it decides nothing, and at that
 * size it cannot move a body's image by anything a crosshair would notice.
 *
 * The canvas uses a logarithmic depth buffer. `postprocessing` converts it to
 * perspective depth before `mainImage` sees it (its `readDepth`), so the
 * distance comes from its `getViewZ`. Decoding the log encoding again here
 * was a bug a debug frame caught: every pixel read as far and the whole
 * image wavered.
 */

const HEAT_HAZE_FRAGMENT = /* glsl */ `
uniform float strength;
uniform float time;
uniform float onsetM;
uniform vec2 texel;

float hazeNoise(vec2 p) {
  return sin(p.x * 1.7 + time * 2.3) * 0.5 + sin(p.y * 2.9 - time * 3.1 + p.x * 0.4) * 0.35
    + sin((p.x + p.y) * 4.3 + time * 5.2) * 0.15;
}

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  if (strength <= 0.0) {
    outputColor = inputColor;
    return;
  }
  // The effect pass has already turned the logarithmic depth buffer into
  // perspective depth; getViewZ turns that into metres along the view.
  float distance = -getViewZ(depth);
  float beyond = max(0.0, distance - onsetM);
  // Up to 1.5 px, reached around 400 m; the sky beyond the far plane counts as far.
  float amount = strength * min(1.5, 0.004 * beyond);
  if (amount < 0.02) {
    outputColor = inputColor;
    return;
  }
  vec2 p = uv / texel * vec2(0.035, 0.12);
  vec2 offset = vec2(0.25 * hazeNoise(p.yx), hazeNoise(p)) * amount * texel;
  outputColor = vec4(texture2D(inputBuffer, uv + offset).rgb, inputColor.a);
}
`;

export class HeatHazeEffect extends Effect {
  constructor() {
    super("HeatHazeEffect", HEAT_HAZE_FRAGMENT, {
      blendFunction: BlendFunction.SRC,
      attributes: EffectAttribute.DEPTH | EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, THREE.Uniform>([
        ["strength", new THREE.Uniform(1)],
        ["time", new THREE.Uniform(0)],
        ["onsetM", new THREE.Uniform(MIRAGE.onsetM)],
        ["texel", new THREE.Uniform(new THREE.Vector2(1 / 1920, 1 / 1080))],
      ]),
    });
  }

  override setSize(width: number, height: number): void {
    const texel = this.uniforms.get("texel");
    if (texel)
      (texel.value as THREE.Vector2).set(1 / Math.max(1, width), 1 / Math.max(1, height));
  }

  /** Per frame: simulation time, and 0 at night. */
  drive(time: number, strength: number): void {
    const t = this.uniforms.get("time");
    const s = this.uniforms.get("strength");
    if (t) t.value = time;
    if (s) s.value = strength;
  }
}
