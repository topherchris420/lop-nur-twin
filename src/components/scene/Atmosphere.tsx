import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { Stars } from "@react-three/drei";
import { Sky } from "three/addons/objects/Sky.js";
import { useControls } from "leva";
import { useTwinStore } from "@/lib/store";
import { terrainHeight } from "@/lib/terrain";
import { mulberry32, SITE_SEED } from "@/lib/noise";

const SUN_DISTANCE = 1800;
const SHADOW_FOCUS = new THREE.Vector3(380, 0, -220);

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

export function Atmosphere() {
  const night = useTwinStore((s) => s.night);
  const qualityTier = useTwinStore((s) => s.qualityTier);
  const { scene, gl } = useThree();

  const { fogDensityDay, sunAzimuth } = useControls(
    "atmosphere",
    {
      fogDensityDay: { value: 0.0003, min: 0, max: 0.002, step: 0.00004 },
      sunAzimuth: { value: 112, min: 0, max: 360, step: 1 },
    },
    { collapsed: true },
  );

  const sky = useMemo(() => {
    const s = new Sky();
    s.scale.setScalar(30000);
    const u = s.material.uniforms;
    if (u.turbidity) u.turbidity.value = 6;
    if (u.rayleigh) u.rayleigh.value = 2.8;
    if (u.mieCoefficient) u.mieCoefficient.value = 0.008;
    if (u.mieDirectionalG) u.mieDirectionalG.value = 0.85;
    return s;
  }, []);

  const sunRef = useRef<THREE.DirectionalLight>(null);
  const moonRef = useRef<THREE.DirectionalLight>(null);
  const hemiRef = useRef<THREE.HemisphereLight>(null);
  const starsRef = useRef<THREE.Group>(null);
  /** 1 = full day, 0 = full night; eased toward the toggle each frame */
  const dayFactor = useRef(1);

  const fog = useMemo(() => new THREE.FogExp2("#d8c29b", 0.0003), []);
  useEffect(() => {
    scene.fog = fog;
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = 1.05;
    return () => {
      scene.fog = null;
    };
  }, [scene, gl, fog]);

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
    const size = qualityTier === 0 ? 1024 : 2048;
    if (sun.shadow.mapSize.x !== size) {
      sun.shadow.mapSize.set(size, size);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
  }, [qualityTier]);

  const scratchColor = useMemo(() => new THREE.Color(), []);
  const sunDir = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, delta) => {
    const target = night ? 0 : 1;
    const d = dayFactor.current;
    const next =
      Math.abs(target - d) < 1e-4
        ? target
        : d + Math.sign(target - d) * Math.min(Math.abs(target - d), delta * 0.45);
    dayFactor.current = next;

    const elev = THREE.MathUtils.degToRad(THREE.MathUtils.lerp(-26, 38, next));
    const az = THREE.MathUtils.degToRad(sunAzimuth);
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
      sun.intensity = 3.4 * Math.pow(strength, 0.65);
      sun.color.lerpColors(DAY.sunLow, DAY.sunWarm, THREE.MathUtils.clamp(strength * 2.2, 0, 1));
    }
    const moon = moonRef.current;
    if (moon) moon.intensity = (1 - next) * 0.5;

    const hemi = hemiRef.current;
    if (hemi) {
      hemi.intensity = 0.16 + 0.46 * next;
      hemi.color.lerpColors(NIGHT.hemiSky, DAY.hemiSky, next);
      hemi.groundColor.lerpColors(NIGHT.hemiGround, DAY.hemiGround, next);
    }

    fog.color.copy(scratchColor.lerpColors(NIGHT.fogColor, DAY.fogColor, next));
    fog.density = THREE.MathUtils.lerp(0.00022, fogDensityDay, next);

    if (starsRef.current) starsRef.current.visible = next < 0.4;
  });

  return (
    <group name="atmosphere">
      <primitive object={sky} />
      <directionalLight
        ref={sunRef}
        castShadow
        position={[600, 1100, -600]}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-1000}
        shadow-camera-right={1000}
        shadow-camera-top={1000}
        shadow-camera-bottom={-1000}
        shadow-camera-near={200}
        shadow-camera-far={4200}
        shadow-bias={-0.0004}
        shadow-normalBias={0.6}
      />
      <directionalLight ref={moonRef} position={[-900, 950, 500]} color="#9db4d8" intensity={0} />
      <hemisphereLight ref={hemiRef} intensity={0.6} color="#cfe2f8" groundColor="#b39d78" />
      <group ref={starsRef} visible={false}>
        <Stars radius={4000} depth={100} count={3500} factor={14} saturation={0} fade speed={0.4} />
      </group>
      <DustLayer />
    </group>
  );
}

/** Thin drifting dust field hugging the ground. */
function DustLayer() {
  const pointsRef = useRef<THREE.Points>(null);

  const { base, speeds, span } = useMemo(() => {
    const rand = mulberry32(SITE_SEED + 900);
    const count = 1500;
    const span = 3200;
    const base = new Float32Array(count * 3);
    const speeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const x = (rand() - 0.5) * span;
      const z = (rand() - 0.5) * span;
      base[i * 3] = x;
      base[i * 3 + 1] = terrainHeight(x, z) + 0.4 + rand() * rand() * 5;
      base[i * 3 + 2] = z;
      speeds[i] = 2 + rand() * 6;
    }
    return { base, speeds, span };
  }, []);

  const positions = useMemo(() => base.slice(), [base]);

  useFrame(({ clock }) => {
    const points = pointsRef.current;
    if (!points) return;
    const t = clock.elapsedTime;
    const attr = points.geometry.attributes.position;
    if (!attr) return;
    const arr = attr.array as Float32Array;
    for (let i = 0; i < speeds.length; i++) {
      const bx = base[i * 3] ?? 0;
      const s = speeds[i] ?? 3;
      let x = bx + t * s;
      x = ((((x + span / 2) % span) + span) % span) - span / 2;
      arr[i * 3] = x;
    }
    attr.needsUpdate = true;
  });

  return (
    <points ref={pointsRef} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={2.4}
        sizeAttenuation
        color="#d8c393"
        transparent
        opacity={0.14}
        depthWrite={false}
      />
    </points>
  );
}
