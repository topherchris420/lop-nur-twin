import type { QualityTier } from "./store";

export interface QualityProfile {
  terrainSegments: number;
  dustParticles: number;
  shadowMapSize: 1024 | 2048;
  dprMax: 1 | 1.5 | 2;
  postprocessing: boolean;
  animateCircuit: boolean;
  patrolVehicleCount: number;
  patrolHeadlightLights: boolean;
  overlayRefreshHz: number;
  overlayRangeSamples: number;
  overlayRadarSamples: number;
  /**
   * Edge length of the close-range ground detail maps, or 0 to skip them
   * entirely. Two maps are built per surface family (concrete and desert) and
   * shared by every ground material, so the whole scene costs four canvases:
   * ~2.7 MB of texture and ~210 ms of canvas work at 512, ~0.7 MB and ~60 ms
   * at 256. 512 is a visible step up on aggregate grain and is worth it only
   * where the frame budget already allows the post stack.
   */
  groundDetailSize: 0 | 256 | 512;
  /**
   * Metres at which the metre-scale ground layer has faded out. Joints, wear
   * patches and dust reach a bit over twice this; past that the surface is
   * exactly the aerial-authored look, which is what protects the twin route.
   */
  groundDetailRange: number;
  /**
   * Slab cracks and directional traffic polish. Each costs one extra texture
   * tap on a surface that fills half the frame, so they are top-tier only.
   */
  groundDetailRich: boolean;
}

export const QUALITY_PROFILES: Record<QualityTier, QualityProfile> = {
  0: {
    terrainSegments: 160,
    dustParticles: 300,
    shadowMapSize: 1024,
    dprMax: 1,
    postprocessing: false,
    animateCircuit: false,
    patrolVehicleCount: 1,
    patrolHeadlightLights: false,
    overlayRefreshHz: 10,
    overlayRangeSamples: 24,
    overlayRadarSamples: 12,
    groundDetailSize: 0,
    groundDetailRange: 0,
    groundDetailRich: false,
  },
  1: {
    terrainSegments: 256,
    dustParticles: 650,
    shadowMapSize: 1024,
    dprMax: 1,
    postprocessing: false,
    animateCircuit: true,
    patrolVehicleCount: 1,
    patrolHeadlightLights: false,
    overlayRefreshHz: 15,
    overlayRangeSamples: 32,
    overlayRadarSamples: 16,
    groundDetailSize: 256,
    groundDetailRange: 85,
    groundDetailRich: false,
  },
  2: {
    terrainSegments: 384,
    dustParticles: 1_100,
    shadowMapSize: 2048,
    dprMax: 1.5,
    postprocessing: false,
    animateCircuit: true,
    patrolVehicleCount: 2,
    patrolHeadlightLights: false,
    overlayRefreshHz: 24,
    overlayRangeSamples: 48,
    overlayRadarSamples: 24,
    groundDetailSize: 256,
    groundDetailRange: 130,
    groundDetailRich: true,
  },
  3: {
    terrainSegments: 512,
    dustParticles: 1_800,
    shadowMapSize: 2048,
    dprMax: 2,
    postprocessing: true,
    animateCircuit: true,
    patrolVehicleCount: 3,
    patrolHeadlightLights: true,
    overlayRefreshHz: 30,
    overlayRangeSamples: 64,
    overlayRadarSamples: 32,
    groundDetailSize: 512,
    groundDetailRange: 170,
    groundDetailRich: true,
  },
};

export function getQualityProfile(tier: QualityTier): QualityProfile {
  return QUALITY_PROFILES[tier];
}
