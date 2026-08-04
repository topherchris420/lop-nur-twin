import { useEffect, useMemo, useState, type ReactElement } from "react";
import * as THREE from "three";
import { Bloom, EffectComposer, N8AO, SMAA, Vignette } from "@react-three/postprocessing";
import {
  AgXToneMappingEffect,
  AnamorphicStreaksPass,
  LensArtifactsEffect,
} from "@/gfx/postfx";
import { useTwinStore } from "@/lib/store";
import { CombatScreenEffect, HdrGuardEffect, setPostExposure } from "./screenEffects";
import { useGameStore } from "../core/gameStore";

/**
 * Post-processing tuned for a first-person camera.
 *
 * The twin's stack in `src/components/scene/Effects.tsx` is built for an
 * aerial view of a 6.8 km site: a 14 m ambient-occlusion radius with a 120 m
 * falloff is right when the camera is 500 m up, and catastrophic at 1.6 m eye
 * height — every surface occludes every other one and the frame goes black.
 * This stack keeps the same look (AgX, anamorphic streaks, lens artefacts) but
 * re-scales everything spatial to human distances.
 *
 * Order is the same as the twin's and for the same reason: occlusion and bloom
 * happen while the buffer is still scene-linear HDR, AgX is the single tone
 * map, and grain goes last so nothing smears it.
 */

/*
 * A note on the thresholds below. The composer's buffer is scene-linear HDR,
 * and a sunlit concrete apron sits around 1.5–2.0 in that space — well above
 * the sub-1.0 thresholds a display-referred pipeline would use. Left at those
 * values the bloom treats the entire ground as a highlight and the frame turns
 * to milk. The thresholds are therefore set above the diffuse level, so only
 * genuine highlights — the sun, specular glints, muzzle flash, tracers —
 * actually bloom.
 */
const LOOK = {
  day: {
    exposure: 0.5,
    slope: 1.22,
    offset: -0.02,
    power: 1.16,
    saturation: 1.18,
    bloomIntensity: 0.26,
    bloomThreshold: 4.2,
    streakIntensity: 0.13,
    streakThreshold: 6.0,
    grain: 0.012,
    aberration: 0.0009,
    radialBlur: 0.0022,
    // Contact-scale occlusion: a bolt head, a magwell, a doorway reveal.
    // These were 0.85 / 2.1 back when the sun's only shadow map was a metre
    // per texel and nothing human-sized cast anything, so the occlusion pass
    // was standing in for the missing contact shadows — and doing it badly,
    // because a 0.85 m radius swallows a whole torso and darkens the lit side
    // as readily as the shadow side. The near-field cascade
    // (`render/shadowCascade.ts`) now casts those shadows properly, so this is
    // back to occluding creases instead of people.
    aoRadius: 0.55,
    aoIntensity: 1.2,
    aoFalloff: 14,
    vignette: 0.42,
  },
  night: {
    exposure: 1.35,
    slope: 1.06,
    offset: 0.014,
    power: 1.0,
    saturation: 1.12,
    bloomIntensity: 1.05,
    bloomThreshold: 0.34,
    streakIntensity: 0.9,
    streakThreshold: 0.42,
    grain: 0.017,
    aberration: 0.0014,
    radialBlur: 0.0034,
    aoRadius: 0.5,
    aoIntensity: 1.0,
    aoFalloff: 12,
    vignette: 0.5,
  },
} as const;

/** `?ao=0` / `?ao=1` overrides the occlusion pass, for A/B capture. */
function aoOverride(): boolean | null {
  if (typeof window === "undefined") return null;
  const raw = new URLSearchParams(window.location.search).get("ao");
  if (raw === "0") return false;
  if (raw === "1") return true;
  return null;
}

/**
 * `?stage=<n>` mounts only the first n passes of the chain, for bisecting a
 * misbehaving pass against a captured frame. 0 (the default) means all of them.
 */
function stageLimit(): number {
  if (typeof window === "undefined") return 0;
  const raw = Number(new URLSearchParams(window.location.search).get("stage"));
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

/** `?minpost=1` mounts only the tone mapper, for bisecting the chain. */
function minimalPost(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("minpost") === "1";
}

/** Shared handle so the game layer can drive the combat feedback pass. */
let activeCombatEffect: CombatScreenEffect | null = null;

export function getCombatScreenEffect(): CombatScreenEffect | null {
  return activeCombatEffect;
}

export function CombatEffects() {
  const night = useTwinStore((s) => s.night);
  const [aoEnabled] = useState(() => aoOverride() ?? true);
  const [minimal] = useState(minimalPost);
  const [stage] = useState(stageLimit);
  const filmGrain = useGameStore((s) => s.filmGrain);
  const look = night ? LOOK.night : LOOK.day;

  const guard = useMemo(() => new HdrGuardEffect({ ceiling: 40 }), []);
  const combat = useMemo(() => new CombatScreenEffect(), []);
  const agx = useMemo(() => new AgXToneMappingEffect(), []);
  const lens = useMemo(() => new LensArtifactsEffect(), []);
  const streaks = useMemo(
    () =>
      new AnamorphicStreaksPass({
        iterations: 4,
        resolutionScale: 4,
        tint: "#93b6ff",
      }),
    [],
  );

  useEffect(() => () => guard.dispose(), [guard]);
  useEffect(() => () => combat.dispose(), [combat]);
  useEffect(() => () => agx.dispose(), [agx]);
  useEffect(() => () => lens.dispose(), [lens]);
  useEffect(() => () => streaks.dispose(), [streaks]);

  useEffect(() => {
    activeCombatEffect = combat;
    return () => {
      if (activeCombatEffect === combat) activeCombatEffect = null;
    };
  }, [combat]);

  useEffect(() => {
    setPostExposure(look.exposure);
    agx.exposure = look.exposure;
    agx.slope = look.slope;
    agx.offset = look.offset;
    agx.power = look.power;
    agx.saturation = look.saturation;

    streaks.intensity = look.streakIntensity;
    streaks.threshold = look.streakThreshold;

    lens.grainIntensity = filmGrain ? look.grain : 0;
    lens.aberration = look.aberration;
    lens.blurStrength = look.radialBlur;
  }, [agx, lens, streaks, look, filmGrain]);

  if (minimal) {
    return (
      <EffectComposer multisampling={0} frameBufferType={THREE.HalfFloatType}>
        <primitive object={agx} />
      </EffectComposer>
    );
  }

  // The composer's children are typed as elements, not nullable, so the chain
  // is assembled as an array. This also makes the bisect flag trivial.
  const upTo = stage === 0 ? 99 : stage;
  const passes: ReactElement[] = [];
  // Always first: everything downstream assumes finite radiance.
  passes.push(<primitive key="guard" object={guard} />);
  if (upTo >= 7) {
    passes.push(
      <N8AO
        key="ao"
        aoRadius={look.aoRadius}
        intensity={aoEnabled ? look.aoIntensity : 0}
        distanceFalloff={look.aoFalloff}
        halfRes
      />,
    );
  }
  if (upTo >= 2) {
    passes.push(
      <Bloom
        key="bloom"
        mipmapBlur
        intensity={look.bloomIntensity}
        luminanceThreshold={look.bloomThreshold}
        luminanceSmoothing={0.2}
        radius={0.84}
      />,
    );
  }
  if (upTo >= 3) passes.push(<primitive key="streaks" object={streaks} />);
  passes.push(<primitive key="agx" object={agx} />);
  if (upTo >= 4) {
    passes.push(<primitive key="combat" object={combat} />);
    passes.push(
      <Vignette key="vignette" eskil={false} offset={0.3} darkness={look.vignette} />,
    );
  }
  if (upTo >= 5) passes.push(<SMAA key="smaa" />);
  if (upTo >= 6) passes.push(<primitive key="lens" object={lens} />);

  return (
    <EffectComposer multisampling={0} frameBufferType={THREE.HalfFloatType}>
      {passes}
    </EffectComposer>
  );
}

export default CombatEffects;
