import { Bloom, EffectComposer, N8AO, SMAA, Vignette } from "@react-three/postprocessing";

/**
 * Full postprocessing stack, only mounted on the top quality tier.
 * Lazy-loaded so the composer stays out of the initial bundle.
 */
export default function Effects() {
  return (
    <EffectComposer multisampling={0}>
      <N8AO aoRadius={14} intensity={2.4} distanceFalloff={120} halfRes />
      <SMAA />
      <Bloom mipmapBlur intensity={0.16} luminanceThreshold={0.92} luminanceSmoothing={0.12} />
      <Vignette eskil={false} offset={0.24} darkness={0.58} />
    </EffectComposer>
  );
}
