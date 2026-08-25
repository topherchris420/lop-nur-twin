import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
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
import { SensorModeEffect } from "@/gfx/sensorFx";
import { spatialIntel } from "../core/spatialIntelligence";
import { useTwinStore } from "@/lib/store";
import { readEnumParam, readFlag, readIntParam } from "@/lib/params";
import { sunState } from "@/lib/sunState";
import { CombatScreenEffect, HdrGuardEffect, setPostExposure } from "./screenEffects";
import { game } from "../core/gameState";
import { useGameStore } from "../core/gameStore";

/**
 * Post-processing tuned for Call of Duty Modern Warfare-level AAA visuals.
 *
 * Full optical rendering pipeline:
 *   Scene (HDR linear)
 *     -> HdrGuard               finite radiance clamp (NaN/Inf protection)
 *     -> N8AO                   contact ambient occlusion
 *     -> Bloom                  dual-filter mipmap highlight bloom
 *     -> AnamorphicStreaks      anamorphic horizontal lens flares
 *     -> OpticalLensDirtFlare   optical ghost flares + illuminated glass micro-scratches & dust
 *     -> AgXToneMapping         Modern Warfare ASC-CDL + AgX sigmoid
 *     -> CombatScreenFeedback   directional hit flash, suppression, low-health vignette
 *     -> CameraMotionBlur       dynamic velocity-driven rotation/slide/sprint motion blur
 *     -> Vignette               natural optical corner falloff
 *     -> SMAA                   subpixel morphological antialiasing
 *     -> LensArtifacts          spectral dispersion chromatic aberration + 35mm film grain
 */

const LOOK = {
  day: {
    exposure: 0.82,
    slope: 1.15,
    offset: -0.015,
    power: 1.12,
    saturation: 1.2,
    bloomIntensity: 0.22,
    bloomThreshold: 2.8,
    streakIntensity: 0.12,
    streakThreshold: 4.5,
    sunFlareIntensity: 0.25,
    dirtIntensity: 0.22,
    grain: 0.008,
    aberration: 0.0008,
    radialBlur: 0.0016,
    aoRadius: 0.55,
    aoIntensity: 1.35,
    aoFalloff: 14,
    vignette: 0.35,
    motionBlurIntensity: 0.75,
  },
  night: {
    exposure: 1.38,
    slope: 1.08,
    offset: 0.012,
    power: 1.02,
    saturation: 1.14,
    bloomIntensity: 1.15,
    bloomThreshold: 0.32,
    streakIntensity: 0.95,
    streakThreshold: 0.38,
    sunFlareIntensity: 0.08,
    dirtIntensity: 0.45,
    grain: 0.016,
    aberration: 0.0016,
    radialBlur: 0.0036,
    aoRadius: 0.5,
    aoIntensity: 1.05,
    aoFalloff: 12,
    vignette: 0.48,
    motionBlurIntensity: 0.9,
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
  const [stage] = useState(stageLimit);
  const filmGrain = useGameStore((s) => s.filmGrain);
  const look = night ? LOOK.night : LOOK.day;

  const camera = useThree((s) => s.camera);

  const guard = useMemo(() => new HdrGuardEffect({ ceiling: 40 }), []);
  const combat = useMemo(() => new CombatScreenEffect(), []);
  const agx = useMemo(() => new AgXToneMappingEffect(), []);
  const opticalFlare = useMemo(() => new OpticalLensDirtAndFlareEffect(), []);
  const motionBlur = useMemo(() => new CameraMotionBlurEffect(), []);
  const lens = useMemo(() => new LensArtifactsEffect(), []);
  const sensorFx = useMemo(() => new SensorModeEffect(), []);
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
  useEffect(() => () => opticalFlare.dispose(), [opticalFlare]);
  useEffect(() => () => motionBlur.dispose(), [motionBlur]);
  useEffect(() => () => lens.dispose(), [lens]);
  useEffect(() => () => sensorFx.dispose(), [sensorFx]);
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

    opticalFlare.sunFlareIntensity = look.sunFlareIntensity;
    opticalFlare.dirtIntensity = look.dirtIntensity;

    motionBlur.intensity = look.motionBlurIntensity;

    lens.grainIntensity = filmGrain ? look.grain : 0;
    lens.aberration = look.aberration;
    lens.blurStrength = look.radialBlur;
  }, [agx, lens, streaks, opticalFlare, motionBlur, look, filmGrain]);

  // Track previous camera angles for velocity motion blur
  const lastState = useRef({
    yaw: 0,
    pitch: 0,
    roll: 0,
    initialized: false,
  });

  useFrame((_state, delta) => {
    const dt = Math.max(0.001, Math.min(0.1, delta));

    // 1. Calculate screen-space sun position for optical flare & lens dirt
    _scratchVec3.copy(camera.position).addScaledVector(sunState.direction, 1000);
    _scratchVec3.project(camera);

    const inFront = _scratchVec3.z < 1.0;
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

    // 4. Update Sensor Mode Shader
    sensorFx.setSensorMode(spatialIntel.sensorMode);
  });

  if (minimal) {
    return (
      <EffectComposer multisampling={0} frameBufferType={THREE.HalfFloatType}>
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
    passes.push(<primitive key="sensor" object={sensorFx} />);
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
