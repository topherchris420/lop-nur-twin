import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { Stars } from "@react-three/drei";
import { Sky } from "three/addons/objects/Sky.js";
import { useTwinStore } from "@/lib/store";
import { terrainHeight } from "@/lib/terrain";
import { mulberry32, SITE_SEED } from "@/lib/noise";
import { sunState } from "@/lib/sunState";
import { makeCloudShadowTexture } from "@/lib/textures";
import { ENVIRONMENT_ENTITY_ID, SITE_SIZE } from "@/lib/layout";
import { climateDustFactor, getClimateMonth } from "@/lib/siteData";
import { getQualityProfile } from "@/lib/quality";

const SUN_DISTANCE = 1800;
const SHADOW_FOCUS = new THREE.Vector3(1018, 0, 1410);
const FOG_DENSITY_DAY = 0.0003;
const SUN_AZIMUTH_DEG = 112;
/** Where the moon's directional light sits; its direction is `sunState.moonDirection`. */
const MOON_POSITION = sunState.moonDirection.clone().multiplyScalar(1400).toArray();

const DAY = {
  fogColor: new THREE.Color("#d8c29b"),
  hemiSky: new THREE.Color("#cfe2f8"),
  hemiGround: new THREE.Color("#b39d78"),
  sunWarm: new THREE.Color("#fff1da"),
  sunLow: new THREE.Color("#ff9448"),
};
const NIGHT = {
  fogColor: new THREE.Color("#0d1420"),
  hemiSky: new THREE.Color("#1b2839"),
  hemiGround: new THREE.Color("#14110d"),
};

/** The shared renderer-transform owner, including scenes with their own lighting. */
export function useRendererToneMapping({
  postprocessing,
  exposure = 1.05,
  restoreOnUnmount = false,
}: {
  postprocessing: boolean;
  exposure?: number;
  restoreOnUnmount?: boolean;
}) {
  const { gl } = useThree();
  useEffect(() => {
    const previousToneMapping = gl.toneMapping;
    const previousExposure = gl.toneMappingExposure;
    gl.toneMapping = postprocessing ? THREE.NoToneMapping : THREE.AgXToneMapping;
    gl.toneMappingExposure = exposure;
    return () => {
      if (!restoreOnUnmount) return;
      gl.toneMapping = previousToneMapping;
      gl.toneMappingExposure = previousExposure;
    };
  }, [gl, postprocessing, exposure, restoreOnUnmount]);
}

export interface AtmosphereProps {
  /**
   * Tune for a camera standing on the ground rather than flying over it.
   *
   * The two cameras want genuinely different light, and the difference is not
   * a matter of taste. From five kilometres up you are looking almost entirely
   * at horizontal surfaces, so the ratio between sun and sky barely shows and
   * a shadow map spanning the whole site is the right call. At eye level the
   * frame is mostly *vertical* surfaces, and the sun-to-sky ratio is the only
   * thing that gives them form — at the aerial balance a barrier's top face
   * and its front face came out one luma value apart, which is why everything
   * read as flat plastic. A site-wide shadow map is also 0.98 m per texel,
   * which cannot resolve anything smaller than a building.
   *
   * So this switches both, and only for the ground camera: the twin keeps the
   * balance and the frustum it was tuned with.
   */
  groundLevel?: boolean;
}

export function Atmosphere({ groundLevel = false }: AtmosphereProps = {}) {
  const night = useTwinStore((s) => s.night);
  const qualityTier = useTwinStore((s) => s.qualityTier);
  const environmentMonth = useTwinStore((s) => s.environmentMonth);
  const reducedMotion = useTwinStore((s) => s.reducedMotion);
  const climate = getClimateMonth(environmentMonth);
  const dustFactor = climateDustFactor(climate);
  const quality = getQualityProfile(qualityTier);
  const { scene } = useThree();

  // A box around the built-up area rather than the whole site: 300 m at 2048
  // is a 0.29 m texel against 0.98 m, and the near cascade covers what is
  // still too small for that.
  const shadowExtent = groundLevel ? 300 : 1000;
  // Clear-sky desert is a hard key and a comparatively weak sky. Shadowed sand
  // measured 0.54 of lit sand, where it should sit nearer 0.2 — the key was
  // being swamped, so nothing had a lit side and a shade side.
  const SUN_KEY = groundLevel ? 5.6 : 3.4;
  const HEMI_SCALE = groundLevel ? 0.36 : 1;

  const sky = useMemo(() => {
    const s = new Sky();
    s.scale.setScalar(30000);
    const u = s.material.uniforms;
    if (u.turbidity) u.turbidity.value = groundLevel ? 9.5 : 6;
    if (u.rayleigh) u.rayleigh.value = groundLevel ? 2.05 : 2.8;
    if (u.mieCoefficient) u.mieCoefficient.value = groundLevel ? 0.012 : 0.008;
    if (u.mieDirectionalG) u.mieDirectionalG.value = groundLevel ? 0.8 : 0.85;
    return s;
  }, [groundLevel]);

  const sunRef = useRef<THREE.DirectionalLight>(null);
  const moonRef = useRef<THREE.DirectionalLight>(null);
  const hemiRef = useRef<THREE.HemisphereLight>(null);
  const starsRef = useRef<THREE.Group>(null);
  /** 1 = full day, 0 = full night; eased toward the toggle each frame */
  const dayFactor = useRef(1);

  const fog = useMemo(() => new THREE.FogExp2("#d8c29b", 0.0003), []);
  useEffect(() => {
    scene.fog = fog;
    return () => {
      scene.fog = null;
    };
  }, [scene, fog]);

  // Tone mapping lives in exactly one place. On the top tier the composer's
  // AgX pass owns it and the renderer must stay linear (`Effects.tsx`);
  // below that the renderer applies AgX itself so every tier shares a look.
  useRendererToneMapping({ postprocessing: quality.postprocessing });

  // aim the sun's shadow frustum at the built-up area
  useEffect(() => {
    const sun = sunRef.current;
    if (!sun) return;
    sun.target.position.copy(SHADOW_FOCUS);
    scene.add(sun.target);
    return () => {
      scene.remove(sun.target);
    };
  }, [scene]);

  // adaptive quality: shrink the shadow map on the lowest tier
  useEffect(() => {
    const sun = sunRef.current;
    if (!sun) return;
    const size = quality.shadowMapSize;
    if (sun.shadow.mapSize.x !== size) {
      sun.shadow.mapSize.set(size, size);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
  }, [quality.shadowMapSize]);

  const scratchColor = useMemo(() => new THREE.Color(), []);
  const sunDir = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, delta) => {
    const target = night ? 0 : 1;
    const d = dayFactor.current;
    const next =
      reducedMotion || Math.abs(target - d) < 1e-4
        ? target
        : d + Math.sign(target - d) * Math.min(Math.abs(target - d), delta * 0.45);
    dayFactor.current = next;

    const elev = THREE.MathUtils.degToRad(THREE.MathUtils.lerp(-26, 29, next));
    const az = THREE.MathUtils.degToRad(SUN_AZIMUTH_DEG);
    sunDir.set(
      Math.sin(az) * Math.cos(elev),
      Math.sin(elev),
      -Math.cos(az) * Math.cos(elev),
    );

    const skyUniforms = sky.material.uniforms;
    skyUniforms.sunPosition?.value.copy(sunDir);

    const sun = sunRef.current;
    if (sun) {
      sun.position.copy(SHADOW_FOCUS).addScaledVector(sunDir, SUN_DISTANCE);
      const strength = THREE.MathUtils.clamp(Math.sin(elev), 0, 1);
      const seasonalSolar = THREE.MathUtils.clamp(
        (climate.solarKwhM2Day - 2) / 5.5,
        0,
        1,
      );
      sun.intensity =
        SUN_KEY *
        Math.pow(strength, 0.65) *
        THREE.MathUtils.lerp(0.82, 1.08, seasonalSolar);
      sun.color.lerpColors(
        DAY.sunLow,
        DAY.sunWarm,
        THREE.MathUtils.clamp(strength * 2.2, 0, 1),
      );
      sunState.intensity = sun.intensity;
    }
    // Published for anything that has to aim at the same sun mid-transition —
    // the near-field shadow cascade in `src/game/render/shadowCascade.ts`
    // cannot re-derive this from the `night` toggle without lagging the ease.
    sunState.direction.copy(sunDir);
    sunState.dayFactor = next;
    const moon = moonRef.current;
    if (moon) moon.intensity = (1 - next) * 0.5;

    const hemi = hemiRef.current;
    if (hemi) {
      hemi.intensity = (0.16 + 0.46 * next) * HEMI_SCALE;
      hemi.color.lerpColors(NIGHT.hemiSky, DAY.hemiSky, next);
      hemi.groundColor.lerpColors(NIGHT.hemiGround, DAY.hemiGround, next);
    }

    fog.color.copy(scratchColor.lerpColors(NIGHT.fogColor, DAY.fogColor, next));
    fog.density = THREE.MathUtils.lerp(
      groundLevel ? 0.00045 : 0.00022,
      groundLevel ? 0.00095 : FOG_DENSITY_DAY * (0.72 + dustFactor * 0.5),
      next,
    );

    if (starsRef.current) starsRef.current.visible = next < 0.4;
  });

  return (
    <group name="atmosphere" userData={{ entityId: ENVIRONMENT_ENTITY_ID }}>
      <primitive object={sky} />
      <directionalLight
        ref={sunRef}
        castShadow={qualityTier > 0}
        position={[600, 1100, -600]}
        shadow-mapSize={[quality.shadowMapSize, quality.shadowMapSize]}
        shadow-camera-left={-shadowExtent}
        shadow-camera-right={shadowExtent}
        shadow-camera-top={shadowExtent}
        shadow-camera-bottom={-shadowExtent}
        shadow-camera-near={200}
        shadow-camera-far={4200}
        shadow-bias={-0.0004}
        // Normal bias exists to hide self-shadowing across one texel, so it
        // has to shrink with the texel or it detaches a shadow from its
        // caster. At the site-wide extent a texel is nearly a metre.
        shadow-normalBias={(shadowExtent / quality.shadowMapSize) * 1.2}
      />
      <directionalLight
        ref={moonRef}
        position={MOON_POSITION}
        color="#9db4d8"
        intensity={0}
      />
      <hemisphereLight
        ref={hemiRef}
        intensity={0.6}
        color="#cfe2f8"
        groundColor="#b39d78"
      />
      <group ref={starsRef} visible={false}>
        <Stars
          radius={4000}
          depth={100}
          count={3500}
          factor={14}
          saturation={0}
          fade
          speed={reducedMotion ? 0 : 0.4}
        />
      </group>
      <CloudShadows />
      <DustLayer />
    </group>
  );
}

/**
 * Soft cloud shadows drifting across the plain. A single ground-hugging plane
 * just above the flattened site scrolls a seamless coverage texture; it fades
 * out at night when there is no sun to cast them.
 */
function CloudShadows() {
  const night = useTwinStore((s) => s.night);
  const reducedMotion = useTwinStore((s) => s.reducedMotion);
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  const tex = useMemo(() => {
    const t = makeCloudShadowTexture(SITE_SEED + 770);
    t.repeat.set(2.2, 2.2);
    return t;
  }, []);
  const opacity = useRef(0);

  useFrame((_, delta) => {
    if (!reducedMotion) {
      tex.offset.x += delta * 0.0016;
      tex.offset.y += delta * 0.0006;
    }
    const target = night ? 0 : 0.9;
    opacity.current = reducedMotion
      ? target
      : opacity.current + (target - opacity.current) * Math.min(1, delta * 0.6);
    if (matRef.current) matRef.current.opacity = opacity.current;
  });

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 2, 0]} frustumCulled={false}>
      <planeGeometry args={[SITE_SIZE * 1.65, SITE_SIZE * 1.65]} />
      <meshBasicMaterial
        ref={matRef}
        map={tex}
        transparent
        opacity={0}
        depthWrite={false}
      />
    </mesh>
  );
}

const DUST_DAY = new THREE.Color("#d8c393");
const DUST_NIGHT = new THREE.Color("#222a36");

/**
 * A soft round mote. Points drawn without a map are hard-edged squares,
 * which is what floated over the horizon in every frame.
 */
function makeDustMoteTexture(): THREE.CanvasTexture {
  const S = 64;
  const canvas = document.createElement("canvas");
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.45, "rgba(255,255,255,0.4)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Thin drifting dust field hugging the ground. */
function DustLayer() {
  const pointsRef = useRef<THREE.Points>(null);
  const materialRef = useRef<THREE.PointsMaterial>(null);
  const mote = useMemo(makeDustMoteTexture, []);
  useEffect(() => () => mote.dispose(), [mote]);
  const qualityTier = useTwinStore((state) => state.qualityTier);
  const environmentMonth = useTwinStore((state) => state.environmentMonth);
  const reducedMotion = useTwinStore((state) => state.reducedMotion);
  const climate = getClimateMonth(environmentMonth);
  const dustFactor = climateDustFactor(climate);
  const count = getQualityProfile(qualityTier).dustParticles;

  const { base, speeds, span } = useMemo(() => {
    const rand = mulberry32(SITE_SEED + 900);
    const span = SITE_SIZE * 0.82;
    const base = new Float32Array(count * 3);
    const speeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const x = (rand() - 0.5) * span;
      const z = (rand() - 0.5) * span;
      base[i * 3] = x;
      base[i * 3 + 1] = terrainHeight(x, z) + 0.4 + rand() * rand() * 5;
      base[i * 3 + 2] = z;
      speeds[i] = 0.65 + rand() * 0.7;
    }
    return { base, speeds, span };
  }, [count]);

  const positions = useMemo(() => base.slice(), [base]);
  const windFrom = THREE.MathUtils.degToRad(climate.windDirectionDeg);
  const driftX = -Math.sin(windFrom) * climate.windSpeedMps;
  const driftZ = Math.cos(windFrom) * climate.windSpeedMps;

  const baseOpacity = 0.05 + dustFactor * 0.14;
  useFrame(({ clock }) => {
    // Dust is lit by whatever lights the plain: sunlit tan by day, and by
    // night nearly invisible. A fixed colour glowed tan against the stars.
    const material = materialRef.current;
    if (material) {
      const day = sunState.dayFactor;
      material.color.lerpColors(DUST_NIGHT, DUST_DAY, day);
      material.opacity = baseOpacity * (0.35 + 0.65 * day);
    }
    if (reducedMotion) return;
    const points = pointsRef.current;
    if (!points) return;
    const t = clock.elapsedTime;
    const attr = points.geometry.attributes.position;
    if (!attr) return;
    const arr = attr.array as Float32Array;
    for (let i = 0; i < speeds.length; i++) {
      const bx = base[i * 3] ?? 0;
      const bz = base[i * 3 + 2] ?? 0;
      const s = speeds[i] ?? 3;
      let x = bx + t * s * driftX;
      let z = bz + t * s * driftZ;
      x = ((((x + span / 2) % span) + span) % span) - span / 2;
      z = ((((z + span / 2) % span) + span) % span) - span / 2;
      arr[i * 3] = x;
      arr[i * 3 + 2] = z;
    }
    attr.needsUpdate = true;
  });

  return (
    <points ref={pointsRef} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        ref={materialRef}
        map={mote}
        size={2.4}
        sizeAttenuation
        color={DUST_DAY}
        transparent
        opacity={baseOpacity}
        depthWrite={false}
      />
    </points>
  );
}
