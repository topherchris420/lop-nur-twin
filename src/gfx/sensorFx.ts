import * as THREE from "three";
import { BlendFunction, Effect } from "postprocessing";
import type { SensorMode } from "@/game/core/spatialIntelligence";

/**
 * Multi-mode Tactical Sensor GLSL Shader.
 * Supports:
 *  - 0: Normal (Pass-through)
 *  - 1: FLIR / Thermal (Radiometric false-color heat map)
 *  - 2: NVG (Green phosphor night-vision tube + noise + vignette)
 *  - 3: CRT / Surveillance (Crt curvature, scanlines, video noise, time code)
 *  - 4: Recon Monochrome (High contrast tactical reconnaissance B&W)
 */

const SENSOR_MODE_FRAGMENT = /* glsl */ `
uniform int mode; // 0=normal, 1=flir, 2=nvg, 3=crt, 4=recon
uniform float time;
uniform float intensity;

float sensorHash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

// Thermal palette mapping (ironbow / FLIR false color)
vec3 flirThermalMap(float luma) {
  // Deep cold blue -> Purple -> Red -> Orange -> Yellow -> White hot
  vec3 c0 = vec3(0.02, 0.05, 0.22);
  vec3 c1 = vec3(0.35, 0.05, 0.55);
  vec3 c2 = vec3(0.85, 0.12, 0.08);
  vec3 c3 = vec3(0.98, 0.55, 0.05);
  vec3 c4 = vec3(0.98, 0.95, 0.65);
  vec3 c5 = vec3(1.00, 1.00, 1.00);

  if (luma < 0.2) return mix(c0, c1, luma / 0.2);
  if (luma < 0.4) return mix(c1, c2, (luma - 0.2) / 0.2);
  if (luma < 0.6) return mix(c2, c3, (luma - 0.4) / 0.2);
  if (luma < 0.8) return mix(c3, c4, (luma - 0.6) / 0.2);
  return mix(c4, c5, (luma - 0.8) / 0.2);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  if (mode == 0 || intensity <= 0.001) {
    outputColor = inputColor;
    return;
  }

  vec3 col = inputColor.rgb;
  float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
  vec2 centered = uv - 0.5;
  float r2 = dot(centered, centered);

  vec3 sensorColor = col;

  if (mode == 1) {
    // 1. FLIR / Thermal Heatmap
    // High contrast thermal mapping with edge sharpness boost
    float heat = pow(luma, 0.85);
    vec3 thermal = flirThermalMap(heat);
    // Add high-frequency noise for sensor granularity
    float grain = (sensorHash13(vec3(uv * 800.0, fract(time * 30.0))) - 0.5) * 0.04;
    sensorColor = clamp(thermal + grain, 0.0, 1.0);

  } else if (mode == 2) {
    // 2. Night Vision (NVG Green Phosphor)
    float nvgLuma = pow(luma, 0.75) * 1.85;
    vec3 phosphor = vec3(0.12 * nvgLuma, 0.95 * nvgLuma, 0.28 * nvgLuma);

    // Phosphor noise / snow
    float noise = (sensorHash13(vec3(uv * 1024.0, fract(time * 60.0))) - 0.5) * 0.18;
    phosphor += vec3(0.04, 0.22, 0.08) * noise;

    // Heavy optical tube vignette
    float tubeVignette = smoothstep(0.48, 0.22, length(centered));
    sensorColor = phosphor * tubeVignette;

  } else if (mode == 3) {
    // 3. CRT Surveillance Camera
    // Scanlines
    float scanline = sin(uv.y * 700.0 + time * 10.0) * 0.12 + 0.88;

    // Slight barrel distortion simulation color shift
    float mono = pow(luma, 1.1);
    vec3 crtColor = vec3(mono * 0.82, mono * 0.95, mono * 0.88) * scanline;

    // CRT static noise
    float staticNoise = (sensorHash13(vec3(uv * 512.0, fract(time * 24.0))) - 0.5) * 0.08;
    crtColor += staticNoise;

    // Outer boundary mask
    float edgeMask = 1.0 - smoothstep(0.38, 0.5, max(abs(centered.x), abs(centered.y)));
    sensorColor = crtColor * edgeMask;

  } else if (mode == 4) {
    // 4. Recon Monochrome
    // High-contrast tactical black-and-white satellite/UAV feed
    float contrastLuma = clamp((luma - 0.15) / 0.7, 0.0, 1.0);
    contrastLuma = pow(contrastLuma, 1.25);
    vec3 recon = vec3(contrastLuma * 0.9, contrastLuma * 0.95, contrastLuma * 1.0);

    // Grid lines accent
    vec2 grid = abs(fract(uv * 20.0 - 0.5) - 0.5);
    float gridLine = smoothstep(0.48, 0.5, max(grid.x, grid.y));
    recon = mix(recon, vec3(0.3, 0.7, 1.0), gridLine * 0.15);

    sensorColor = recon;
  }

  outputColor = vec4(mix(inputColor.rgb, sensorColor, intensity), inputColor.a);
}
`;

export interface SensorModeEffectOptions {
  mode?: SensorMode;
  intensity?: number;
}

export class SensorModeEffect extends Effect {
  constructor({ mode = "normal", intensity = 1.0 }: SensorModeEffectOptions = {}) {
    super("SensorModeEffect", SENSOR_MODE_FRAGMENT, {
      blendFunction: BlendFunction.SRC,
      uniforms: new Map<string, THREE.Uniform>([
        ["mode", new THREE.Uniform(0)],
        ["time", new THREE.Uniform(0)],
        ["intensity", new THREE.Uniform(intensity)],
      ]),
    });
    this.setSensorMode(mode);
  }

  setSensorMode(mode: SensorMode): void {
    const modeInt =
      mode === "flir"
        ? 1
        : mode === "nvg"
          ? 2
          : mode === "crt"
            ? 3
            : mode === "recon"
              ? 4
              : 0;
    const uniform = this.uniforms.get("mode");
    if (uniform) uniform.value = modeInt;
  }

  set intensity(val: number) {
    const uniform = this.uniforms.get("intensity");
    if (uniform) uniform.value = val;
  }

  update(
    _renderer: THREE.WebGLRenderer,
    _input: THREE.WebGLRenderTarget,
    deltaTime: number,
  ): void {
    const uniform = this.uniforms.get("time");
    if (uniform) uniform.value = (uniform.value as number) + deltaTime;
  }
}
