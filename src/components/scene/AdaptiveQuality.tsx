import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useTwinStore, type QualityTier } from "@/lib/store";
import { telemetry } from "@/lib/telemetry";

/**
 * Adaptive quality ladder, stepped by a rolling FPS estimate:
 *
 *   tier 3 — postprocessing on, full pixel ratio, 2048 shadows
 *   tier 2 — postprocessing off               (step a)
 *   tier 1 — pixel ratio dropped to 1         (step b)
 *   tier 0 — shadow map halved to 1024        (step c, applied in Atmosphere)
 *
 * Downgrade after >1 s below 50 FPS; recover after >2 s above 55 FPS.
 */
export function AdaptiveQualityManager() {
  const setDpr = useThree((s) => s.setDpr);
  const qualityTier = useTwinStore((s) => s.qualityTier);

  const ema = useRef(60);
  const lowTime = useRef(0);
  const highTime = useRef(0);
  const cooldown = useRef(0);

  useFrame((_, delta) => {
    const dt = Math.max(delta, 1e-4);
    const fps = 1 / dt;
    ema.current += (fps - ema.current) * Math.min(1, dt * 4);
    telemetry.fps = ema.current;

    if (cooldown.current > 0) {
      cooldown.current -= dt;
      lowTime.current = 0;
      highTime.current = 0;
      return;
    }

    const { qualityTier: tier, autoQuality, setQualityTier } = useTwinStore.getState();
    if (!autoQuality) return;

    if (ema.current < 50) {
      lowTime.current += dt;
      highTime.current = 0;
    } else if (ema.current > 55) {
      highTime.current += dt;
      lowTime.current = 0;
    } else {
      lowTime.current = 0;
      highTime.current = 0;
    }

    if (lowTime.current > 1 && tier > 0) {
      setQualityTier((tier - 1) as QualityTier);
      cooldown.current = 1.5;
    } else if (highTime.current > 2 && tier < 3) {
      setQualityTier((tier + 1) as QualityTier);
      cooldown.current = 1.5;
    }
  });

  useEffect(() => {
    setDpr(qualityTier >= 2 ? Math.min(window.devicePixelRatio, 2) : 1);
  }, [qualityTier, setDpr]);

  return null;
}
