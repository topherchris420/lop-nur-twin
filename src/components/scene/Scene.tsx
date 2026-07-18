import { lazy, Suspense, useEffect } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { useTwinStore } from "@/lib/store";
import { Terrain } from "./Terrain";
import { Pavements } from "./Pavements";
import { Structures } from "./Structures";
import { LivingScene } from "./LivingScene";
import { Atmosphere } from "./Atmosphere";
import { CameraRigs } from "./CameraRigs";
import { AdaptiveQualityManager } from "./AdaptiveQuality";

const Effects = lazy(() => import("./Effects"));

/**
 * Flips the store's `ready` flag once the GL context exists and one frame has
 * been painted, so the intro overlay can fade out at the right moment.
 */
function ReadySignal() {
  const gl = useThree((s) => s.gl);
  const setReady = useTwinStore((s) => s.setReady);
  useEffect(() => {
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(setReady);
    });
    return () => cancelAnimationFrame(raf);
  }, [gl, setReady]);
  return null;
}

export function Scene() {
  const postEnabled = useTwinStore((s) => s.qualityTier >= 3);
  const select = useTwinStore((s) => s.select);

  return (
    <Canvas
      shadows="soft"
      dpr={[1, 2]}
      camera={{ fov: 55, near: 1, far: 26000, position: [1740, 560, 2240] }}
      gl={{ powerPreference: "high-performance", antialias: true }}
      onPointerMissed={() => select(null)}
    >
      <Suspense fallback={null}>
        <Atmosphere />
        <Terrain />
        <Pavements />
        <Structures />
        <LivingScene />
        <CameraRigs />
        <AdaptiveQualityManager />
        <ReadySignal />
        {postEnabled && (
          <Suspense fallback={null}>
            <Effects />
          </Suspense>
        )}
      </Suspense>
    </Canvas>
  );
}
