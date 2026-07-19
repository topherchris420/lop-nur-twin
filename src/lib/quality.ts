import type { QualityTier } from "./store";

export interface QualityProfile {
  terrainSegments: number;
  dustParticles: number;
  shadowMapSize: 1024 | 2048;
  dprMax: 1 | 1.5 | 2;
  postprocessing: boolean;
  animateCircuit: boolean;
}

export const QUALITY_PROFILES: Record<QualityTier, QualityProfile> = {
  0: {
    terrainSegments: 160,
    dustParticles: 300,
    shadowMapSize: 1024,
    dprMax: 1,
    postprocessing: false,
    animateCircuit: false,
  },
  1: {
    terrainSegments: 256,
    dustParticles: 650,
    shadowMapSize: 1024,
    dprMax: 1,
    postprocessing: false,
    animateCircuit: true,
  },
  2: {
    terrainSegments: 384,
    dustParticles: 1_100,
    shadowMapSize: 2048,
    dprMax: 1.5,
    postprocessing: false,
    animateCircuit: true,
  },
  3: {
    terrainSegments: 512,
    dustParticles: 1_800,
    shadowMapSize: 2048,
    dprMax: 2,
    postprocessing: true,
    animateCircuit: true,
  },
};

export function getQualityProfile(tier: QualityTier): QualityProfile {
  return QUALITY_PROFILES[tier];
}
