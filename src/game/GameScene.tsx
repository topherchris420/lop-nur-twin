import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Terrain } from "@/components/scene/Terrain";
import { Pavements } from "@/components/scene/Pavements";
import { Structures } from "@/components/scene/Structures";
import { Atmosphere } from "@/components/scene/Atmosphere";
import { useTwinStore } from "@/lib/store";
import { getQualityProfile } from "@/lib/quality";
import { terrainHeight, flattenFactor } from "@/lib/terrain";
import { GROUND_OVERLOOK } from "@/lib/layout";
import { CollisionWorld } from "./physics/collisionWorld";
import { PlayerRig, placePlayer } from "./player/PlayerRig";
import { FxManager } from "./fx/combatFx";
import { game, removeActor } from "./core/gameState";
import { useGameStore } from "./core/gameStore";
import { resolveDamage, tickActorState, type KillReport } from "./core/combat";
import { BotManager } from "./ai/bots";
import { CharacterManager } from "./characters/manager";
import { MatchDirector } from "./modes/match";
import { createAudio, disposeAudio } from "./audio";
import { forwardToYaw, type SurfaceType } from "./core/types";
import {
  EnvironmentLighting as EnvironmentLightingRig,
  SUN,
  sunElevationRad,
} from "./render/environment";

const CombatEffects = lazy(() => import("./render/CombatEffects"));

/**
 * The combat scene.
 *
 * It reuses the digital twin's terrain, pavement, structures and atmosphere
 * verbatim — the map *is* the reconstruction — and layers the simulation on
 * top. Collision is baked from the rendered scene graph once the structures
 * have mounted, so every wall, gear leg and fuel tank the player can see is
 * something they can also take cover behind.
 */

/* ------------------------------------------------------------------ */
/* Collision baking                                                    */
/* ------------------------------------------------------------------ */

/** Ground material lookup: pavement is concrete, everything else is desert. */
function groundSurfaceAt(x: number, z: number): SurfaceType {
  // `flattenFactor` is 0 exactly where pavement has levelled the ground, so it
  // doubles as a paved/unpaved mask without a second data source.
  const flat = flattenFactor(x, z);
  if (flat < 0.02) return "concrete";
  if (flat < 0.5) return "gravel";
  return "sand";
}

interface BakeProps {
  onBaked: (world: CollisionWorld) => void;
}

function CollisionBaker({ onBaked }: BakeProps) {
  const scene = useThree((s) => s.scene);

  // Bake in an effect, not on the frame loop. Effects run after every child
  // has mounted, so the structure meshes already exist, and it means the world
  // is ready on the first rendered frame rather than several frames later —
  // which matters because a headless capture may only advance a few frames.
  useEffect(() => {
    const world = new CollisionWorld(terrainHeight);
    world.setGroundSurfaceFn(groundSurfaceAt);
    scene.updateMatrixWorld(true);

    let baked = 0;
    scene.traverse((object) => {
      if (object.name === "structures") {
        baked += world.bakeFromObject(object, { minVolume: 0.05 });
      }
    });
    // Fall back to walking the whole scene if the structures group was not
    // found — better a slower bake than a world with no walls in it.
    if (baked === 0) {
      for (const child of scene.children) {
        if (child.type === "PerspectiveCamera" || child.name === "combat-fx") continue;
        baked += world.bakeFromObject(child, { minVolume: 0.08 });
      }
    }

    game.world = world;
    game.stats.colliders = world.staticCount;
    onBaked(world);
  }, [scene, onBaked]);

  return null;
}

/* ------------------------------------------------------------------ */
/* Combatants                                                          */
/* ------------------------------------------------------------------ */

/**
 * Spawns the opposing force and keeps their models in step with the
 * simulation. Bots own their own movement and weapons; the character manager
 * only ever reads actor state, so the two can be reasoned about separately.
 */
function Combatants({ world }: { world: CollisionWorld }) {
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const botCount = useGameStore((s) => s.botCount);
  const botSkill = useGameStore((s) => s.botSkill);
  const matchSeed = useGameStore((s) => s.matchSeed);
  const mode = useGameStore((s) => s.mode);
  const setScreen = useGameStore((s) => s.setScreen);
  const managers = useRef<{
    bots: BotManager;
    characters: CharacterManager;
    director: MatchDirector;
  } | null>(null);

  useEffect(() => {
    const characters = new CharacterManager(world);
    const bots = new BotManager(world, {
      count: botCount,
      skill: botSkill,
      seed: matchSeed,
    });
    bots.onFire = (actor) => characters.reportFire(actor.id);
    characters.syncWithActors();
    scene.add(characters.group);

    const director = new MatchDirector(mode);
    // Everyone respawns through the bot manager's geometry-checked picker.
    director.requestSpawn = (actor) =>
      bots.spawnPointFor(actor.team, actor.isPlayer ? null : game.player.position);
    director.onEnd = () => setScreen("results");
    game.matchDirector = director;

    managers.current = { bots, characters, director };
    return () => {
      game.matchDirector = null;
      scene.remove(characters.group);
      characters.dispose();
      bots.dispose();
      for (const actor of [...game.actors]) {
        if (!actor.isPlayer) removeActor(actor.id);
      }
      managers.current = null;
    };
  }, [world, scene, botCount, botSkill, matchSeed, mode, setScreen]);

  useFrame((_state, rawDelta) => {
    const held = managers.current;
    if (!held) return;
    const dt = Math.min(0.05, rawDelta);
    if (useGameStore.getState().screen === "playing") {
      held.bots.update(dt, game.time);
      held.director.update(dt);
    }
    held.characters.update(dt, camera);
  });

  return null;
}

/* ------------------------------------------------------------------ */
/* Simulation driver                                                   */
/* ------------------------------------------------------------------ */

interface SimulationProps {
  world: CollisionWorld | null;
  fx: FxManager | null;
}

/**
 * Dev-only handle so `tools/probe.mjs` and the visual-verification scripts can
 * inspect the live scene — camera placement, draw calls, collider counts —
 * without guessing from pixels. Stripped from production builds.
 */
function exposeDevHandle(state: unknown): void {
  if (!import.meta.env.DEV) return;
  (globalThis as { __combat?: { r3f: unknown; game: typeof game } }).__combat = {
    r3f: state,
    game,
  };
}

function Simulation({ world, fx }: SimulationProps) {
  const kills = useMemo<KillReport[]>(() => [], []);
  const pushKillfeed = useGameStore((s) => s.pushKillfeed);
  const pruneKillfeed = useGameStore((s) => s.pruneKillfeed);
  const frameTimes = useRef<number[]>([]);

  useFrame((state, rawDelta) => {
    exposeDevHandle(state);
    const dt = Math.min(0.05, rawDelta);
    const playing = useGameStore.getState().screen === "playing";
    if (playing) game.time += dt;
    game.dt = dt;
    game.frame += 1;

    if (playing) {
      resolveDamage(game.time, kills);
      for (const kill of kills) {
        game.matchDirector?.onKill(kill);
        pushKillfeed({
          attacker: kill.attacker?.name ?? "—",
          attackerTeam: kill.attacker?.team ?? "red",
          victim: kill.victim.name,
          victimTeam: kill.victim.team,
          weapon: kill.weaponId,
          headshot: kill.headshot,
          penetrated: kill.penetrated,
          time: game.time,
        });
      }
      tickActorState(dt, game.time);
      if (game.frame % 30 === 0) pruneKillfeed(game.time);
    }

    try {
      fx?.update(dt, world);
    } catch (error) {
      if (import.meta.env.DEV) {
        (globalThis as { __fxError?: unknown }).__fxError = String(error);
      }
    }

    // Frame statistics for the HUD's performance readout.
    const times = frameTimes.current;
    times.push(rawDelta);
    if (times.length > 40) times.shift();
    // Written every frame, not every tenth: a headless capture may only
    // advance two or three frames before it screenshots, and statistics that
    // never get written look identical to a simulation that never ran.
    {
      let sum = 0;
      for (const t of times) sum += t;
      const mean = sum / Math.max(1, times.length);
      game.stats.fps = mean > 0 ? 1 / mean : 0;
      game.stats.frameMs = mean * 1000;
      game.stats.drawCalls = state.gl.info.render.calls;
      game.stats.triangles = state.gl.info.render.triangles;
      let alive = 0;
      for (const actor of game.actors) if (actor.alive) alive += 1;
      game.stats.actorsAlive = alive;
    }
  });

  return null;
}

/* ------------------------------------------------------------------ */
/* Audio                                                               */
/* ------------------------------------------------------------------ */

/**
 * Owns the audio engine and drains `game.soundQueue`.
 *
 * The context cannot start before a user gesture, so `unlock()` is wired to
 * the first click or key rather than to mount — a context created and left
 * suspended silently swallows everything scheduled against it.
 */
function AudioHost({ world }: { world: CollisionWorld | null }) {
  const masterVolume = useGameStore((s) => s.masterVolume);

  useEffect(() => {
    const engine = createAudio({
      // Injected, so the audio layer never imports the physics module.
      hasLineOfSight: (from, to) => game.world?.hasLineOfSight(from, to) ?? true,
    });
    const unlock = (): void => void engine.unlock();
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      disposeAudio();
    };
  }, []);

  useEffect(() => {
    createAudio().setMasterVolume(masterVolume);
  }, [masterVolume]);

  useFrame((_state, rawDelta) => {
    const engine = createAudio();
    engine.syncListener();
    engine.update(Math.min(0.05, rawDelta));
  });

  void world;
  return null;
}

/* ------------------------------------------------------------------ */
/* Exposure                                                            */
/* ------------------------------------------------------------------ */

/**
 * Re-exposes the ground-level view on the tiers that have no composer.
 *
 * `Atmosphere` sets the renderer's tone mapping once, at an exposure tuned for
 * the twin's aerial camera looking down at dark lakebed. Standing on a sunlit
 * concrete apron is a completely different subject: at that exposure a tenth
 * of the frame clips, against roughly a thirtieth on the tier where the
 * composer's own AgX pass is in charge. This runs after `Atmosphere`'s effect
 * and pulls the non-composer tiers back in line with the top one.
 */
function CombatExposure({ postEnabled }: { postEnabled: boolean }) {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    if (postEnabled) return;
    gl.toneMappingExposure = 0.62;
  }, [gl, postEnabled]);
  return null;
}

/* ------------------------------------------------------------------ */
/* Image-based lighting                                                */
/* ------------------------------------------------------------------ */

/**
 * Builds a radiance map from the same analytic sky the atmosphere renders and
 * assigns it to the scene, so metals reflect a real sky instead of black. The
 * twin gets away without one because it is viewed from the air, where the sun
 * and hemisphere lights carry the image; at eye level, next to a rifle and a
 * fuel tank, the absence of environment reflections is the single most
 * "untextured" thing about the frame.
 */
function EnvironmentLighting({
  onReady,
}: {
  onReady: (texture: THREE.Texture) => void;
}) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const night = useTwinStore((s) => s.night);

  useEffect(() => {
    const lighting = new EnvironmentLightingRig(gl);
    const texture = lighting.get({
      elevationRad: sunElevationRad(night ? 0 : 1),
      azimuthRad: (SUN.azimuthDeg * Math.PI) / 180,
      dayFactor: night ? 0 : 1,
    });
    scene.environment = texture;
    // The twin's exposure was tuned with only a sun and a hemisphere light.
    // The radiance map is here for reflections and for the shape it puts on
    // metal, so it is weighted well below 1 — at parity it doubles the ambient
    // and blows the whole frame out.
    scene.environmentIntensity = night ? 0.22 : 0.38;
    onReady(texture);
    return () => {
      scene.environment = null;
      lighting.dispose();
    };
  }, [gl, scene, night, onReady]);

  return null;
}

/* ------------------------------------------------------------------ */
/* FX host                                                             */
/* ------------------------------------------------------------------ */

function FxHost({ onReady }: { onReady: (fx: FxManager) => void }) {
  const scene = useThree((s) => s.scene);
  const qualityTier = useTwinStore((s) => s.qualityTier);

  const manager = useMemo(() => new FxManager(), []);

  useEffect(() => {
    scene.add(manager.group);
    onReady(manager);
    return () => {
      scene.remove(manager.group);
      manager.dispose();
    };
  }, [scene, manager, onReady]);

  useEffect(() => {
    manager.setQuality({
      particleScale: qualityTier >= 3 ? 1 : qualityTier >= 2 ? 0.7 : 0.4,
      decals: qualityTier >= 1,
      casings: qualityTier >= 2,
      flashLights: qualityTier >= 2 ? 4 : qualityTier >= 1 ? 2 : 0,
    });
  }, [manager, qualityTier]);

  return null;
}

/* ------------------------------------------------------------------ */
/* Scene                                                               */
/* ------------------------------------------------------------------ */

function CombatWorld() {
  const [world, setWorld] = useState<CollisionWorld | null>(null);
  const [fx, setFx] = useState<FxManager | null>(null);
  const [environment, setEnvironment] = useState<THREE.Texture | null>(null);
  const handleBaked = useCallback((baked: CollisionWorld) => setWorld(baked), []);
  const handleFx = useCallback((manager: FxManager) => setFx(manager), []);
  const handleEnvironment = useCallback((texture: THREE.Texture) => setEnvironment(texture), []);
  const qualityTier = useTwinStore((s) => s.qualityTier);
  const post = getQualityProfile(qualityTier).postprocessing;

  useEffect(() => {
    if (!world) return;
    const defaultYaw = forwardToYaw(
      GROUND_OVERLOOK.target[0] - GROUND_OVERLOOK.position[0],
      GROUND_OVERLOOK.target[1] - GROUND_OVERLOOK.position[1],
    );
    // `?look=<deg>` aims the spawn heading, so a captured frame can be taken
    // from a chosen direction without driving the camera by hand.
    const raw = Number(new URLSearchParams(window.location.search).get("look"));
    const yaw = Number.isFinite(raw) && raw !== 0 ? (raw * Math.PI) / 180 : defaultYaw;
    placePlayer(world, GROUND_OVERLOOK.position[0], GROUND_OVERLOOK.position[1], yaw);
  }, [world]);

  return (
    <>
      <Atmosphere />
      <CombatExposure postEnabled={post} />
      <Terrain />
      <Pavements />
      <Structures />
      <EnvironmentLighting onReady={handleEnvironment} />
      <CollisionBaker onBaked={handleBaked} />
      <FxHost onReady={handleFx} />
      <AudioHost world={world} />
      <PlayerRig world={world} fx={fx} postEnabled={post} environment={environment} />
      {world ? <Combatants world={world} /> : null}
      <Simulation world={world} fx={fx} />
      {post && (
        <Suspense fallback={null}>
          <CombatEffects />
        </Suspense>
      )}
    </>
  );
}

/** `?near=<m>` overrides the world camera's near plane, for A/B capture. */
function nearOverride(): number {
  if (typeof window === "undefined") return 0.12;
  const raw = Number(new URLSearchParams(window.location.search).get("near"));
  return Number.isFinite(raw) && raw > 0 ? raw : 0.12;
}

export function GameScene() {
  const qualityTier = useTwinStore((s) => s.qualityTier);
  const profile = getQualityProfile(qualityTier);
  const fov = useGameStore((s) => s.fov);

  return (
    <Canvas
      shadows={qualityTier > 0 ? "percentage" : false}
      dpr={[1, profile.dprMax]}
      camera={{
        fov,
        // The viewmodel has its own pass now, so the world camera only has to
        // resolve the world. `?near=` overrides it for capture experiments.
        near: nearOverride(),
        far: 26000,
        position: [1018, 3, 1410],
      }}
      gl={{
        powerPreference: "high-performance",
        antialias: true,
        logarithmicDepthBuffer: true,
      }}
      onCreated={({ camera }) => {
        camera.rotation.order = "YXZ";
        if (camera instanceof THREE.PerspectiveCamera) camera.updateProjectionMatrix();
      }}
    >
      <Suspense fallback={null}>
        <CombatWorld />
      </Suspense>
    </Canvas>
  );
}
