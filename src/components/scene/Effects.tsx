import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { Bloom, EffectComposer, N8AO, SMAA, Vignette } from "@react-three/postprocessing";
import {
  AgXToneMappingEffect,
  AnamorphicStreaksPass,
  LensArtifactsEffect,
} from "@/gfx/postfx";
import { useTwinStore } from "@/lib/store";

/**
 * Full post-processing stack, only mounted on the top quality tier.
 * Lazy-loaded so the composer (and the custom GLSL in `@/gfx/postfx`) stays
 * out of the initial bundle.
 *
 * Pass order matters:
 *
 *   N8AO      occlusion while the buffer is still scene-linear HDR
 *   Bloom     mipmap (dual-filter) chain, so highlights bleed in HDR
 *   Streaks   multi-pass anamorphic lens streaks, also in HDR
 *   AgX       HDR -> display. Everything above must come first or the
 *             highlights are already clamped and there is nothing to bloom.
 *   Vignette  merged into the AgX pass (both are non-convolution effects)
 *   SMAA      antialiasing on display-referred values, where its luma
 *             thresholds are actually calibrated
 *   Lens      chromatic aberration + radial blur + film grain, last so the
 *             grain is not smeared by anything downstream
 *
 * The renderer is `NoToneMapping` while this is mounted (`Atmosphere.tsx`
 * decides, and `EffectComposer` enforces it) — AgX here is the only tone map.
 */

/** Day and night want different exposure and lens character. */
const LOOK = {
  day: {
    exposure: 1.08,
    slope: 1.09,
    offset: -0.008,
    power: 1.05,
    saturation: 1.2,
    bloomIntensity: 0.5,
    bloomThreshold: 0.62,
    streakIntensity: 0.4,
    streakThreshold: 0.78,
    grain: 0.014,
    aberration: 0.0013,
    radialBlur: 0.0032,
  },
  night: {
    // a night frame is mostly shadow, so it needs the exposure and the lift
    // to stay off the floor — the probe reported 17% crushed pixels before
    // this, against a target of a few per cent
    exposure: 1.6,
    slope: 1.02,
    offset: 0.01,
    power: 1.0,
    saturation: 1.12,
    bloomIntensity: 0.9,
    bloomThreshold: 0.3,
    streakIntensity: 1,
    streakThreshold: 0.4,
    // grain is strongest in shadow, which at night is the whole frame
    grain: 0.014,
    aberration: 0.0018,
    radialBlur: 0.0044,
  },
} as const;

export default function Effects() {
  const night = useTwinStore((s) => s.night);
  const look = night ? LOOK.night : LOOK.day;

  const agx = useMemo(() => new AgXToneMappingEffect(), []);
  const lens = useMemo(() => new LensArtifactsEffect(), []);
  const streaks = useMemo(
    () =>
      new AnamorphicStreaksPass({
        // 4 iterations at quarter res reach roughly a thousand full-res
        // pixels, which is what makes a streak read as anamorphic glass
        iterations: 4,
        resolutionScale: 4,
        tint: "#93b6ff",
      }),
    [],
  );

  useEffect(() => () => agx.dispose(), [agx]);
  useEffect(() => () => lens.dispose(), [lens]);
  useEffect(() => () => streaks.dispose(), [streaks]);

  // Retuning is a uniform write, not a recompile, so the day/night switch
  // costs nothing.
  useEffect(() => {
    agx.exposure = look.exposure;
    agx.slope = look.slope;
    agx.offset = look.offset;
    agx.power = look.power;
    agx.saturation = look.saturation;

    streaks.intensity = look.streakIntensity;
    streaks.threshold = look.streakThreshold;

    lens.grainIntensity = look.grain;
    lens.aberration = look.aberration;
    lens.blurStrength = look.radialBlur;
  }, [agx, lens, streaks, look]);

  return (
    <EffectComposer multisampling={0} frameBufferType={THREE.HalfFloatType}>
      <N8AO aoRadius={14} intensity={2.4} distanceFalloff={120} halfRes />
      <Bloom
        mipmapBlur
        intensity={look.bloomIntensity}
        luminanceThreshold={look.bloomThreshold}
        luminanceSmoothing={0.22}
        radius={0.86}
      />
      <primitive object={streaks} />
      <primitive object={agx} />
      <Vignette eskil={false} offset={0.26} darkness={0.5} />
      <SMAA />
      <primitive object={lens} />
    </EffectComposer>
  );
}
