import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useRendererToneMapping } from "@/components/scene/Atmosphere";
import type { CitySimulation } from "./simulation";
import type { ViewControl } from "./Scene";
import { groundAt } from "./terrain";

/** A local analytic sky, not a downloaded HDRI or a measured Bethesda light probe. */
export function CityAtmosphere({
  sim,
  view,
}: {
  sim: CitySimulation;
  view: ViewControl;
}) {
  const { gl, scene, camera } = useThree();
  const sun = useRef<THREE.DirectionalLight>(null),
    fill = useRef<THREE.HemisphereLight>(null);
  const target = useMemo(() => new THREE.Object3D(), []);
  useRendererToneMapping({
    postprocessing: false,
    exposure: 1,
    restoreOnUnmount: true,
  });
  useEffect(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 256;
    const c = canvas.getContext("2d")!,
      gradient = c.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, "#638eaf");
    gradient.addColorStop(0.35, "#adc4d3");
    gradient.addColorStop(0.49, "#d2d8d8");
    gradient.addColorStop(0.51, "#a1a494");
    gradient.addColorStop(1, "#655f51");
    c.fillStyle = gradient;
    c.fillRect(0, 0, 512, 256);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.mapping = THREE.EquirectangularReflectionMapping;
    const pmrem = new THREE.PMREMGenerator(gl),
      environment = pmrem.fromEquirectangular(texture);
    const previous = {
      background: scene.background,
      environment: scene.environment,
      intensity: scene.environmentIntensity,
    };
    scene.background = new THREE.Color("#bacbd4");
    scene.environment = environment.texture;
    scene.environmentIntensity = 0.55;
    return () => {
      scene.background = previous.background;
      scene.environment = previous.environment;
      scene.environmentIntensity = previous.intensity;
      environment.dispose();
      texture.dispose();
      pmrem.dispose();
    };
  }, [gl, scene]);
  useFrame(() => {
    const storm = sim.events.some((e) => e.kind === "storm");
    if (scene.background instanceof THREE.Color)
      scene.background.set(storm ? "#727f85" : "#bacbd4");
    scene.environmentIntensity = storm ? 0.32 : 0.55;
    if (scene.fog instanceof THREE.Fog) {
      scene.fog.color.set(storm ? "#727f85" : "#bacbd4");
      scene.fog.near = view.tier === 0 ? 180 : 280;
      scene.fog.far = view.tier === 0 ? 550 : 1150;
    }
    if (fill.current) fill.current.intensity = storm ? 0.7 : 0.85;
    if (!sun.current) return;
    sun.current.intensity = storm ? 0.7 : 3.2;
    // Shadow texels cover the viewed block, not the entire 1.4 km city.
    // Quantisation avoids crawling under small camera motion.
    const p = view.mode === "orbit" ? view.target : camera.position;
    const x = Math.round(p.x / 4) * 4,
      z = Math.round(p.z / 4) * 4;
    const extent = view.mode === "orbit" ? 230 : 75;
    const y = groundAt({ x, z });
    sun.current.position.set(x - 160, y + 230, z + 100);
    target.position.set(x, y, z);
    target.updateMatrixWorld();
    const shadow = sun.current.shadow.camera;
    if (shadow.right !== extent) {
      shadow.left = shadow.bottom = -extent;
      shadow.right = shadow.top = extent;
      shadow.updateProjectionMatrix();
    }
  });
  return (
    <>
      <primitive object={target} />
      <hemisphereLight ref={fill} args={["#c1d5e4", "#8d816b", 0.85]} />
      <directionalLight
        ref={sun}
        target={target}
        color="#fff0d9"
        intensity={3.2}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-near={1}
        shadow-camera-far={650}
        shadow-bias={-0.00008}
        shadow-normalBias={0.08}
      />
    </>
  );
}
