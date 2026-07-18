import { lazy, Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { useTwinStore } from "@/lib/store";
import { Terrain } from "./Terrain";
import { Pavements } from "./Pavements";
import { Structures } from "./Structures";
import { Atmosphere } from "./Atmosphere";
import { CameraRigs } from "./CameraRigs";
import { AdaptiveQualityManager } from "./AdaptiveQuality";

const Effects = lazy(() => import("./Effects"));

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
        <CameraRigs />
        <AdaptiveQualityManager />
        {postEnabled && (
          <Suspense fallback={null}>
            <Effects />
          </Suspense>
        )}
      </Suspense>
    </Canvas>
  );
}
