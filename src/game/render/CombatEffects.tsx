import {
  type ComponentRef,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, N8AO, SMAA, Vignette } from "@react-three/postprocessing";
import {
  AgXToneMappingEffect,
  AnamorphicStreaksPass,
  CameraMotionBlurEffect,
  LensArtifactsEffect,
  OpticalLensDirtAndFlareEffect,
} from "@/gfx/postfx";
import { useTwinStore } from "@/lib/store";
import { readEnumParam, readFlag, readIntParam } from "@/lib/params";
import { sunState } from "@/lib/sunState";
import { CombatScreenEffect, HdrGuardEffect, setPostExposure } from "./screenEffects";
import { ViewmodelCompositePass, setViewmodelPassMounted } from "./viewmodelPass";
import { HeatHazeEffect } from "./heatHaze";
import { mirageState } from "../world/mirage";
import { game } from "../core/gameState";
import { useGameStore } from "../core/gameStore";
import { AerialPerspectiveEffect } from "./aerialPerspective";
import { groundAmbientOcclusion } from "./groundedAO";
import {
  compileComposerFrame,
  warmProgramsThenRender,
} from "@/components/scene/programWarmup";

/**
 * The top tier's post stack: a camera looking across a hot, bright lakebed.
 *
 *   Scene (HDR linear)
 *     -> HdrGuard               finite radiance clamp (NaN/Inf protection)
 *     -> N8AO                   metre-scale occlusion, weighted to ambient light
 *     -> HeatHaze               distant air wavers (the visible face of world/mirage.ts)
 *     -> AerialPerspective      height fog toward the sky's own horizon, sun shafts
 *     -> Viewmodel              the weapon, composited unfogged and unoccluded
 *     -> Bloom                  dual-filter mipmap highlight bloom
 *     -> AnamorphicStreaks      anamorphic horizontal lens flares
 *     -> OpticalLensDirtFlare   restrained solar ghosts, lens dust under glare
 *     -> AgXToneMapping         log-contrast AgX, CDL and split tone
 *     -> CombatScreenFeedback   directional hit flash, suppression, low-health vignette
 *     -> CameraMotionBlur       dynamic velocity-driven rotation/slide/sprint motion blur
 *     -> Vignette               natural optical corner falloff
 *     -> SMAA                   subpixel morphological antialiasing
 *     -> LensArtifacts          light chromatic aberration + film grain
 *
 * The grade is a confident one on purpose. Scene-linear sunlit sand is ~0.25
 * and its shade ~0.05: exposure puts the sand at ~0.6 display, and contrast in
 * log space around mid-grey gives the shade a real black point without
 * crushing it, where the old neutral curve left every frame between 20 and
 * 225 of 255 — milky, with no black and no highlight. Bloom and streak
 * thresholds sit well above anything diffuse (clouds peak near 1.5), so only
 * the sun, its aureole and real emitters glow.
 */

const LOOK = {
  day: {
    exposure: 1.4,
    slope: 1.0,
    offset: -0.012,
    power: 1.12,
    saturation: 1.14,
    logContrast: 1.25,
    shadowTint: new THREE.Color(0.93, 0.98, 1.07),
    highlightTint: new THREE.Color(1.05, 1.0, 0.93),
    bloomIntensity: 0.22,
    bloomThreshold: 2.6,
    streakIntensity: 0.1,
    streakThreshold: 6.0,
    sunFlareIntensity: 0.12,
    dirtIntensity: 0.12,
    grain: 0.014,
    aberration: 0.0006,
    radialBlur: 0.0008,
    aoRadius: 1.1,
    aoIntensity: 2.6,
    aoFalloff: 2.0,
    vignette: 0.32,
    motionBlurIntensity: 0.75,
    fogDensity: 0.00022,
    fogFalloff: 1 / 900,
    fogStart: 160,
    shafts: 0.5,
  },
  night: {
    // Moonlight is a twentieth of the sun here; exposure brings the moonlit
    // lakebed up to a readable, still clearly nocturnal level.
    exposure: 4.2,
    slope: 1.0,
    offset: -0.01,
    power: 1.1,
    saturation: 0.86,
    logContrast: 1.15,
    shadowTint: new THREE.Color(0.9, 0.97, 1.12),
    highlightTint: new THREE.Color(1.0, 1.0, 1.02),
    bloomIntensity: 0.9,
    bloomThreshold: 0.45,
    streakIntensity: 0.6,
    streakThreshold: 0.6,
    sunFlareIntensity: 0,
    dirtIntensity: 0.25,
    grain: 0.02,
    aberration: 0.0009,
    radialBlur: 0.0012,
    aoRadius: 1.1,
    aoIntensity: 2.2,
    aoFalloff: 2.0,
    vignette: 0.42,
    motionBlurIntensity: 0.9,
    fogDensity: 0.00016,
    fogFalloff: 1 / 900,
    fogStart: 160,
    shafts: 0,
  },
} as const;

/** `?ao=0` / `?ao=1` overrides the occlusion pass, for A/B capture. */
function aoOverride(): boolean | null {
  const raw = readEnumParam("ao", ["0", "1"] as const);
  return raw === null ? null : raw === "1";
}

/**
 * `?stage=<n>` mounts only the first n passes of the chain, for bisecting a
 * misbehaving pass against a captured frame. 0 (the default) means all of them.
 */
function stageLimit(): number {
  return readIntParam("stage", 0, 16) ?? 0;
}

/** `?aoview=1` shows the occlusion buffer alone, for tuning it. */
function aoView(): boolean {
  return readFlag("aoview");
}

/** `?minpost=1` mounts only the tone mapper, for bisecting the chain. */
function minimalPost(): boolean {
  return readFlag("minpost");
}

/** Shared handle so the game layer can drive the combat feedback pass. */
let activeCombatEffect: CombatScreenEffect | null = null;

export function getCombatScreenEffect(): CombatScreenEffect | null {
  return activeCombatEffect;
}

const _scratchVec3 = new THREE.Vector3();
const _prevEuler = new THREE.Euler(0, 0, 0, "YXZ");

export function CombatEffects() {
  const night = useTwinStore((s) => s.night);
  const [aoEnabled] = useState(() => aoOverride() ?? true);
  const [minimal] = useState(minimalPost);
  const [showAo] = useState(aoView);
  const [stage] = useState(stageLimit);
  const filmGrain = useGameStore((s) => s.filmGrain);
  const look = night ? LOOK.night : LOOK.day;

  const camera = useThree((s) => s.camera);

  const guard = useMemo(() => new HdrGuardEffect({ ceiling: 40 }), []);
  const aerial = useMemo(() => new AerialPerspectiveEffect(), []);
  const haze = useMemo(() => new HeatHazeEffect(), []);
  const combat = useMemo(() => new CombatScreenEffect(), []);
  const agx = useMemo(() => new AgXToneMappingEffect(), []);
  const opticalFlare = useMemo(() => new OpticalLensDirtAndFlareEffect(), []);
  const motionBlur = useMemo(() => new CameraMotionBlurEffect(), []);
  const lens = useMemo(() => new LensArtifactsEffect(), []);
  const viewmodelPass = useMemo(() => new ViewmodelCompositePass(), []);
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
  useEffect(() => () => aerial.dispose(), [aerial]);

  // Linking this stack on its first frame held the page; warm it inside the
  // commit, after the composer has added its passes, the same way the twin's
  // post stack does. The composer frame compiles the scene, the occlusion and
  // bloom chains, the new sky and fog, and the weapon pass in one walk.
  const get = useThree((s) => s.get);
  const composer = useRef<ComponentRef<typeof EffectComposer>>(null);
  useLayoutEffect(() => {
    void warmProgramsThenRender(
      get(),
      composer.current ? compileComposerFrame(composer.current) : undefined,
    );
  }, [get]);

  // N8AO multiplies sunlight too; make it occlude the ambient share only.
  const occlusion = useRef<unknown>(null);
  useLayoutEffect(() => {
    groundAmbientOcclusion(occlusion.current);
  });
  useEffect(() => () => combat.dispose(), [combat]);
  useEffect(() => () => agx.dispose(), [agx]);
  useEffect(() => () => opticalFlare.dispose(), [opticalFlare]);
  useEffect(() => () => motionBlur.dispose(), [motionBlur]);
  useEffect(() => () => lens.dispose(), [lens]);
  useEffect(() => () => streaks.dispose(), [streaks]);
  useEffect(() => {
    setViewmodelPassMounted(true);
    return () => setViewmodelPassMounted(false);
  }, []);

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
    agx.logContrast = look.logContrast;
    agx.setSplitTone(look.shadowTint, look.highlightTint);

    aerial.configure({
      density: look.fogDensity,
      falloff: look.fogFalloff,
      start: look.fogStart,
      shafts: look.shafts,
    });

    streaks.intensity = look.streakIntensity;
    streaks.threshold = look.streakThreshold;

    opticalFlare.sunFlareIntensity = look.sunFlareIntensity;
    opticalFlare.dirtIntensity = look.dirtIntensity;

    motionBlur.intensity = look.motionBlurIntensity;

    lens.grainIntensity = filmGrain ? look.grain : 0;
    lens.aberration = look.aberration;
    lens.blurStrength = look.radialBlur;
  }, [agx, aerial, lens, streaks, opticalFlare, motionBlur, look, filmGrain]);

  // Track previous camera angles for velocity motion blur
  const lastState = useRef({
    yaw: 0,
    pitch: 0,
    roll: 0,
    initialized: false,
  });

  useFrame((_state, delta) => {
    haze.drive(game.time, night ? 0 : mirageState.strength);
    const dt = Math.max(0.001, Math.min(0.1, delta));

    // 1. Calculate screen-space sun position for optical flare & lens dirt
    _scratchVec3.copy(camera.position).addScaledVector(sunState.direction, 1000);
    _scratchVec3.project(camera);

    const inFront = _scratchVec3.z < 1.0 && sunState.direction.y > 0;
    const sunUvX = _scratchVec3.x * 0.5 + 0.5;
    const sunUvY = _scratchVec3.y * 0.5 + 0.5;
    opticalFlare.setSunScreenPos(sunUvX, sunUvY, inFront);

    // 2. Muzzle flash flare burst
    const timeSinceFire = game.time - game.player.lastFireTime;
    const flashEnergy =
      timeSinceFire >= 0 && timeSinceFire < 0.09 ? 1.0 - timeSinceFire / 0.09 : 0;
    opticalFlare.muzzleFlashIntensity = flashEnergy;

    // 3. Dynamic camera velocity motion blur
    _prevEuler.setFromQuaternion(camera.quaternion, "YXZ");
    const curYaw = _prevEuler.y;
    const curPitch = _prevEuler.x;
    const curRoll = _prevEuler.z;

    if (!lastState.current.initialized) {
      lastState.current = {
        yaw: curYaw,
        pitch: curPitch,
        roll: curRoll,
        initialized: true,
      };
    }

    let dYaw = curYaw - lastState.current.yaw;
    // Normalize angular wrapping across +/- PI
    while (dYaw > Math.PI) dYaw -= Math.PI * 2;
    while (dYaw < -Math.PI) dYaw += Math.PI * 2;

    const dPitch = curPitch - lastState.current.pitch;
    const dRoll = curRoll - lastState.current.roll;

    lastState.current.yaw = curYaw;
    lastState.current.pitch = curPitch;
    lastState.current.roll = curRoll;

    // Screen velocity: yaw turns create horizontal sweep, pitch tilts create vertical sweep
    const rotVelX = (-dYaw / dt) * 0.016;
    const rotVelY = (-dPitch / dt) * 0.016;
    const rollVel = (dRoll / dt) * 0.02;

    // Linear motion (sprint / sliding expansion blur)
    const playerSpeed = game.player.speed ?? 0;
    const forwardVel = Math.min(
      0.045,
      (playerSpeed / 8.0) * (game.player.state === "slide" ? 0.035 : 0.018),
    );

    motionBlur.setVelocity(rotVelX, rotVelY);
    motionBlur.setRollVelocity(rollVel);
    motionBlur.setForwardVelocity(forwardVel);
  });

  if (minimal) {
    return (
      <EffectComposer
        ref={composer}
        multisampling={0}
        frameBufferType={THREE.HalfFloatType}
      >
        <primitive object={viewmodelPass} />
        <primitive object={agx} />
      </EffectComposer>
    );
  }

  const upTo = stage === 0 ? 99 : stage;
  const passes: ReactElement[] = [];

  // Always first: finite radiance guard
  passes.push(<primitive key="guard" object={guard} />);
  if (upTo >= 7) {
    passes.push(
      <N8AO
        key="ao"
        ref={occlusion}
        aoRadius={look.aoRadius}
        intensity={aoEnabled ? look.aoIntensity : 0}
        distanceFalloff={look.aoFalloff}
        renderMode={showAo ? 1 : 0}
        halfRes
      />,
    );
  }
  // Heat haze on the world only: before the first-person weapon is composited,
  // because the depth it reads is the world's, not the rifle's.
  if (upTo >= 2) passes.push(<primitive key="haze" object={haze} />);
  // After the haze, which samples its input at an offset and would otherwise
  // undo the fog; before the weapon, which must never be fogged.
  if (upTo >= 2) passes.push(<primitive key="aerial" object={aerial} />);
  // After occlusion, before bloom, so the rifle shares the world's glare
  // and AgX without being darkened by the ambient-occlusion pass.
  passes.push(<primitive key="viewmodel" object={viewmodelPass} />);
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
  if (upTo >= 3) {
    passes.push(<primitive key="streaks" object={streaks} />);
    passes.push(<primitive key="opticalFlare" object={opticalFlare} />);
  }
  passes.push(<primitive key="agx" object={agx} />);
  if (upTo >= 4) {
    passes.push(<primitive key="combat" object={combat} />);
    passes.push(<primitive key="motionBlur" object={motionBlur} />);
    passes.push(
      <Vignette key="vignette" eskil={false} offset={0.3} darkness={look.vignette} />,
    );
  }
  if (upTo >= 5) passes.push(<SMAA key="smaa" />);
  if (upTo >= 6) passes.push(<primitive key="lens" object={lens} />);

  return (
    <EffectComposer
      ref={composer}
      multisampling={0}
      frameBufferType={THREE.HalfFloatType}
    >
      {passes}
    </EffectComposer>
  );
}

export default CombatEffects;
