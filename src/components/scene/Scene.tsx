import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Link } from "@tanstack/react-router";
import { useTwinStore } from "@/lib/store";
import { prebuildTerrainAssets, Terrain } from "./Terrain";
import { Pavements } from "./Pavements";
import { Structures } from "./Structures";
import { EvidenceGhosts } from "./EvidenceGhosts";
import { EvidenceLens } from "./EvidenceLens";
import { LivingScene } from "./LivingScene";
import { UncertaintyLayer } from "./UncertaintyLayer";
import { LiveTraffic } from "./LiveTraffic";
import { Atmosphere } from "./Atmosphere";
import { CameraRigs } from "./CameraRigs";
import { AdaptiveQualityManager } from "./AdaptiveQuality";
import { pauseRendering, warmProgramsThenRender } from "./programWarmup";
import { getQualityProfile } from "@/lib/quality";
import { readFlag } from "@/lib/params";
import { canCreateWebGLContext } from "@/lib/webgl";
import { isChunkLoadError, reloadPage, STALE_BUILD_NOTICE } from "@/lib/staleBuild";

const Effects = lazy(() => import("./Effects"));

/**
 * Flips the store's `ready` flag once the scene has actually rendered, so the
 * intro overlay fades out onto a picture. It counts frames from `useFrame`, which
 * does not run while the programs are still linking, and waits for the second so
 * the first has reached the screen.
 */
function ReadySignal() {
  const setReady = useTwinStore((s) => s.setReady);
  const frames = useRef(0);
  useFrame(() => {
    if (frames.current < 2 && ++frames.current === 2) setReady();
  });
  return null;
}

/**
 * Keeps a quality step off the main thread too: see `warmProgramsThenRender`.
 *
 * Rendering stops the moment the tier changes, because a frame could otherwise land
 * before the new materials do. The warmup starts from a layout effect, so inside the
 * commit that swapped them in. Started any earlier it compiles the outgoing tier's
 * materials, which are then disposed while it waits for them.
 *
 * A tier with the post stack stays paused for `Effects` to do this when it mounts, as
 * only it knows what a composer frame draws with.
 */
function QualityStepWarmup() {
  const get = useThree((s) => s.get);
  const qualityTier = useTwinStore((s) => s.qualityTier);
  const warmedTier = useRef(qualityTier);

  useLayoutEffect(
    () =>
      useTwinStore.subscribe((state, previous) => {
        if (state.qualityTier !== previous.qualityTier) pauseRendering(get());
      }),
    [get],
  );

  useLayoutEffect(() => {
    if (warmedTier.current === qualityTier) return;
    warmedTier.current = qualityTier;
    if (!getQualityProfile(qualityTier).postprocessing)
      void warmProgramsThenRender(get());
  }, [qualityTier, get]);

  return null;
}

/**
 * How long a tier with the post stack waits for that stack's chunk. Long enough that
 * a usual load links its programs once, for the frame it will really draw.
 */
const POST_STACK_PATIENCE_MS = 1000;

/**
 * Takes over from `Effects` while its chunk is on the way. That chunk is the one thing
 * rendering waits for that the warmup's own timeouts do not cover, so without this a
 * slow or hung request holds the canvas paused for as long as the request stays open:
 * the boot screen for good, on a load. The scene draws without the stack until it comes.
 */
function DrawWithoutPostStack() {
  const get = useThree((s) => s.get);
  useEffect(() => {
    const timeout = setTimeout(
      () => void warmProgramsThenRender(get()),
      POST_STACK_PATIENCE_MS,
    );
    return () => clearTimeout(timeout);
  }, [get]);
  return null;
}

/** Where `SceneContents` stops adding pieces and starts on the shaders. */
const LAST_STAGE = 4;

/**
 * The scene's contents, committed a piece at a time. Mounted together they were one
 * task of about half a second that nothing could interrupt, and nothing is on screen
 * yet for the pieces to be seen arriving: rendering stays paused until the last stage
 * is in and its programs have linked.
 */
function SceneContents({
  liveTraffic,
  postprocessing,
}: {
  liveTraffic: boolean;
  postprocessing: boolean;
}) {
  const get = useThree((s) => s.get);
  const [stage, setStage] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void prebuildTerrainAssets(useTwinStore.getState().qualityTier)
      // A failure here is the terrain's to report. Its render builds the same things
      // again and throws to the error boundary, which a promise cannot reach: stopping
      // here would leave the boot screen up for good, with nothing said.
      .catch(() => undefined)
      .then(() => {
        if (!cancelled) setStage((current) => Math.max(current, 1));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (stage === 0) return;
    if (stage === LAST_STAGE) {
      // With the post stack, `Effects` does this when its chunk has loaded.
      if (!postprocessing) void warmProgramsThenRender(get());
      return;
    }
    const timeout = setTimeout(() => setStage(stage + 1), 0);
    return () => clearTimeout(timeout);
  }, [stage, postprocessing, get]);

  return (
    <>
      <Atmosphere />
      <CameraRigs />
      <AdaptiveQualityManager />
      <QualityStepWarmup />
      <ReadySignal />
      {stage >= 1 && <Terrain />}
      {stage >= 2 && <Pavements />}
      {stage >= 3 && <Structures />}
      {stage >= 4 && (
        <>
          <EvidenceGhosts />
          <EvidenceLens />
          <UncertaintyLayer />
          <LivingScene />
          {/* The upstream feed currently omits browser CORS headers. Keep the
              existing layer opt-in so the deterministic twin makes no failing
              runtime request by default; ?liveTraffic=1 preserves the hook for
              CORS-capable deployments or a same-origin proxy. */}
          {liveTraffic ? <LiveTraffic /> : null}
          {postprocessing && (
            <Suspense fallback={<DrawWithoutPostStack />}>
              <Effects />
            </Suspense>
          )}
        </>
      )}
    </>
  );
}

function WebGLFallback({ stale = false }: { stale?: boolean }) {
  const setReady = useTwinStore((state) => state.setReady);
  const setSceneUnavailable = useTwinStore((state) => state.setSceneUnavailable);
  useEffect(() => {
    setReady();
    // The HUD drives a view that is not there, and would sit behind this panel
    // still taking focus; `TwinView` leaves it out while the flag is set.
    setSceneUnavailable(true);
    return () => setSceneUnavailable(false);
  }, [setReady, setSceneUnavailable]);

  return (
    <div
      role="alert"
      className="absolute inset-0 z-30 grid place-items-center bg-[#1c1b18] p-6 text-center text-sm text-[#e8e4d8]"
    >
      <div className="max-w-md space-y-3 leading-relaxed">
        {stale ? (
          <p>
            The 3D view stopped. {STALE_BUILD_NOTICE}{" "}
            <button type="button" className="underline" onClick={reloadPage}>
              Reload
            </button>
          </p>
        ) : (
          <p>
            This browser could not start WebGL, so the 3D view is unavailable. Hardware
            acceleration or a WebGL-capable browser is required for it.
          </p>
        )}
        <p>
          The model itself does not need it: every structure, claim, source, date and
          uncertainty is in the{" "}
          <Link to="/analysis" className="underline">
            analysis table
          </Link>
          , and releases can be compared in the{" "}
          <Link to="/compare" className="underline">
            manifest comparison
          </Link>
          .
        </p>
      </div>
    </div>
  );
}

class SceneErrorBoundary extends Component<
  { children: ReactNode },
  { failed: false | "stale" | "error" }
> {
  state: { failed: false | "stale" | "error" } = { failed: false };

  static getDerivedStateFromError(error: unknown) {
    // A lazy chunk (the cinematic camera, the post stack) that a deploy renamed
    // is not a WebGL failure, and the fallback must not say it is.
    return { failed: isChunkLoadError(error) ? "stale" : "error" };
  }

  render() {
    return this.state.failed ? (
      <WebGLFallback stale={this.state.failed === "stale"} />
    ) : (
      this.props.children
    );
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
        // The same bearing and pitch onto the compound as the orbit target has always
        // had, from half the distance, so the first thing seen is the site itself.
        camera={{ fov: 55, near: 1, far: 26000, position: [1379, 280, 1825] }}
        gl={{
          powerPreference: "high-performance",
          antialias: true,
          // the site spans ~26 km of camera range while pavement decals sit
          // 5 cm apart, so a linear depth buffer z-fights; log depth keeps
          // both ends resolvable. Custom ShaderMaterials must include the
          // logdepth chunks — see `createHardSurfaceShaderMaterial`.
          logarithmicDepthBuffer: true,
        }}
        onCreated={pauseRendering}
        onPointerMissed={() => select(null)}
      >
        <Suspense fallback={null}>
          <SceneContents
            liveTraffic={liveTrafficRequested}
            postprocessing={postEnabled}
          />
        </Suspense>
      </Canvas>
    </SceneErrorBoundary>
  );
}
