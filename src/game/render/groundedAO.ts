import type * as THREE from "three";
import { patchShader } from "@/gfx/shaderPatch";

/**
 * Ambient occlusion that occludes ambient light.
 *
 * N8AO composites by multiplying the whole pixel, sunlight included. Physically
 * occlusion only takes away the sky and bounce a point cannot see; a patch of
 * apron in full sun at the foot of a wall is still in full sun. Multiplied
 * through, a radius big enough to ground a T-wall or a hangar paints a grey
 * halo across the sunlit ground beside it, the classic screen-space AO tell.
 *
 * The composer only has the summed radiance, not the ambient term alone, so
 * this uses the pixel's own brightness as the proxy for how much of it is
 * direct light. In this scene the split is wide — sunlit sand sits near 0.25
 * in scene-linear units and the same sand in shade near 0.05 — so shade gets
 * the full occlusion and sunlit faces keep a fraction of it, enough for a
 * contact line where an object meets the ground.
 */

/** Stock compositor output for N8AO's combined render mode. */
const COMPOSITE_LINE =
  "gl_FragColor = vec4( mix(sceneTexel.rgb, aoApplied, 1.0 - finalAo), sceneTexel.a);";

const GROUNDED_LINE = /* glsl */ `
            float groundedLuma = dot(sceneTexel.rgb, vec3(0.2126, 0.7152, 0.0722));
            // 0 in shade (ambient light only), 1 in full sun.
            float groundedDirect = smoothstep(0.07, 0.26, groundedLuma);
            float groundedAo = mix(finalAo, 1.0 - (1.0 - finalAo) * 0.3, groundedDirect);
            gl_FragColor = vec4( mix(sceneTexel.rgb, aoApplied, 1.0 - groundedAo), sceneTexel.a);`;

/** Splices the ambient-only weighting into N8AO's compositor fragment shader. */
export function groundedComposite(fragmentShader: string): string {
  return patchShader("grounded AO composite", fragmentShader, [
    [COMPOSITE_LINE, GROUNDED_LINE],
  ]);
}

/** The parts of N8AO's post pass this touches. Not exported by its typings. */
interface N8AOInternals {
  configureEffectCompositer(depthBufferType?: number, ortho?: boolean): void;
  effectCompositerQuad?: { material: THREE.ShaderMaterial };
}

const grounded = new WeakSet<object>();

function patchCompositor(pass: N8AOInternals): void {
  const material = pass.effectCompositerQuad?.material;
  if (!material || material.userData["groundedAo"] === true) return;
  try {
    material.fragmentShader = groundedComposite(material.fragmentShader);
    material.userData["groundedAo"] = true;
    material.needsUpdate = true;
  } catch (error) {
    // A newer N8AO reworded the line: keep its stock composite rather than
    // take the post stack down. The unit test fails on this first.
    if (import.meta.env.DEV) console.warn("[groundedAO]", error);
  }
}

/**
 * Applies the ambient-only weighting to an N8AO post pass, now and every time
 * it rebuilds its compositor (it does on the first frame, once it has seen the
 * renderer's logarithmic depth buffer, and on a resolution-mode change).
 */
export function groundAmbientOcclusion(pass: unknown): void {
  const ao = pass as N8AOInternals | null;
  if (!ao || typeof ao.configureEffectCompositer !== "function" || grounded.has(ao)) {
    return;
  }
  grounded.add(ao);
  const configure = ao.configureEffectCompositer.bind(ao);
  ao.configureEffectCompositer = (depthBufferType, ortho) => {
    configure(depthBufferType, ortho);
    patchCompositor(ao);
  };
  patchCompositor(ao);
}
