import { useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { sceneProjection } from '@/lib/sceneProjection';

export function ProjectionBridge() {
  useFrame((state) => {
    sceneProjection.camera = state.camera;
    sceneProjection.width = state.size.width;
    sceneProjection.height = state.size.height;
    sceneProjection.frame += 1;
  });

  useEffect(
    () => () => {
      sceneProjection.camera = null;
      sceneProjection.width = 0;
      sceneProjection.height = 0;
    },
    [],
  );

  return null;
}
