import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useTwinStore } from "@/lib/store";
import { telemetry } from "@/lib/telemetry";
import { getQualityProfile } from "@/lib/quality";
import { QualityLadder } from "@/lib/qualityLadder";

/**
 * Adaptive quality ladder. Profiles scale terrain, dust, shadows, pixel ratio,
 * postprocessing, and the illustrative aircraft circuit; see `lib/quality.ts` for
 * exact values, and `lib/qualityLadder.ts` for when it steps and why.
 */
export function AdaptiveQualityManager() {
  const setDpr = useThree((s) => s.setDpr);
  const qualityTier = useTwinStore((s) => s.qualityTier);
  const ladder = useRef(new QualityLadder());

  useFrame((_, delta) => {
    const {
      qualityTier: tier,
      autoQuality,
      reducedMotion,
      setQualityTier,
    } = useTwinStore.getState();
    const step = ladder.current.sample(delta, tier);
    telemetry.fps = ladder.current.fps;
    if (step !== null && autoQuality && !reducedMotion) setQualityTier(step);
  });

  useEffect(() => {
    const profile = getQualityProfile(qualityTier);
    setDpr(Math.min(window.devicePixelRatio, profile.dprMax));
  }, [qualityTier, setDpr]);

  return null;
}
