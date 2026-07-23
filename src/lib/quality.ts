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
  },
};

export function getQualityProfile(tier: QualityTier): QualityProfile {
  return QUALITY_PROFILES[tier];
}
