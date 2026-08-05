import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { useTwinStore } from "@/lib/store";
import { Terrain } from "./Terrain";
import { Pavements } from "./Pavements";
import { Structures } from "./Structures";
import { LivingScene } from "./LivingScene";
import { LiveTraffic } from "./LiveTraffic";
import { Atmosphere } from "./Atmosphere";
import { CameraRigs } from "./CameraRigs";
import { AdaptiveQualityManager } from "./AdaptiveQuality";
import { ProjectionBridge } from "./ProjectionBridge";
import { getQualityProfile } from "@/lib/quality";
import { readFlag } from "@/lib/params";

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

function WebGLFallback() {
  const setReady = useTwinStore((state) => state.setReady);
  useEffect(setReady, [setReady]);

  return (
    <div
      role="alert"
      className="absolute inset-0 z-30 grid place-items-center bg-[#1c1b18] p-6 text-center text-sm text-[#e8e4d8]"
    >
      This browser could not start WebGL. Hardware acceleration or a WebGL-capable browser is required.
    </div>
  );
}

function canCreateWebGLContext(): boolean {
  if (typeof document === "undefined") return false;
  const canvas = document.createElement("canvas");
  const context =
    canvas.getContext("webgl2") ?? canvas.getContext("webgl");
  if (!context) return false;
  context.getExtension("WEBGL_lose_context")?.loseContext();
  return true;
}

class SceneErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? <WebGLFallback /> : this.props.children;
  }
}

export function Scene() {
  const [webglSupported] = useState(canCreateWebGLContext);
  // Opt-in only: this is the one runtime request the app can make to a third
  // party, so it stays behind an explicit flag rather than a truthy value.
  const [liveTrafficRequested] = useState(() => readFlag("liveTraffic"));
  const qualityTier = useTwinStore((s) => s.qualityTier);
  const profile = getQualityProfile(qualityTier);
  const postEnabled = profile.postprocessing;
  const select = useTwinStore((s) => s.select);
  const setReducedMotion = useTwinStore((s) => s.setReducedMotion);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncPreference = () => setReducedMotion(preference.matches);
    syncPreference();
    preference.addEventListener("change", syncPreference);
    return () => preference.removeEventListener("change", syncPreference);
  }, [setReducedMotion]);

  if (!webglSupported) return <WebGLFallback />;

  return (
    <SceneErrorBoundary>
      <Canvas
        shadows={qualityTier > 0 ? "percentage" : false}
        dpr={[1, profile.dprMax]}
        camera={{ fov: 55, near: 1, far: 26000, position: [1740, 560, 2240] }}
        gl={{
          powerPreference: "high-performance",
          antialias: true,
          // the site spans ~26 km of camera range while pavement decals sit
          // 5 cm apart, so a linear depth buffer z-fights; log depth keeps
          // both ends resolvable. Custom ShaderMaterials must include the
          // logdepth chunks — see `createHardSurfaceShaderMaterial`.
          logarithmicDepthBuffer: true,
        }}
        onPointerMissed={() => select(null)}
      >
        <Suspense fallback={null}>
          <Atmosphere />
          <Terrain />
          <Pavements />
          <Structures />
          <LivingScene />
          {/* The upstream feed currently omits browser CORS headers. Keep the
              existing layer opt-in so the deterministic twin makes no failing
              runtime request by default; ?liveTraffic=1 preserves the hook for
              CORS-capable deployments or a same-origin proxy. */}
          {liveTrafficRequested ? <LiveTraffic /> : null}
          <CameraRigs />
          <ProjectionBridge />
          <AdaptiveQualityManager />
          <ReadySignal />
          {postEnabled && (
            <Suspense fallback={null}>
              <Effects />
            </Suspense>
          )}
        </Suspense>
      </Canvas>
    </SceneErrorBoundary>
  );
}
