import * as THREE from "three";
import { patchShader } from "../gfx/shaderPatch";

/** A shallow room behind a shop window, drawn inside the pane. Rays hit one
 * of five interior faces. Mullions and sills remain the separate modelled
 * geometry. No duplicate building meshes or offscreen render per window. */
export function windowGlass(warm: boolean): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: warm ? "#a09883" : "#91a3a6",
    roughness: warm ? 0.21 : 0.14,
    envMapIntensity: 1.3,
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = patchShader("Bethesda glass (vertex)", shader.vertexShader, [
      ["#include <common>", "#include <common>\nvarying vec2 vPaneUv;"],
      ["#include <uv_vertex>", "#include <uv_vertex>\nvPaneUv = uv;"],
    ]);
    shader.fragmentShader = patchShader(
      "Bethesda glass (fragment)",
      shader.fragmentShader,
      [
        ["#include <common>", "#include <common>\nvarying vec2 vPaneUv;"],
        [
          "#include <color_fragment>",
          /* glsl */ `#include <color_fragment>
      vec2 paneDx = dFdx(vPaneUv), paneDy = dFdy(vPaneUv);
      vec3 posDx = dFdx(-vViewPosition), posDy = dFdy(-vViewPosition);
      float det = paneDx.x * paneDy.y - paneDx.y * paneDy.x;
      if (abs(det) > 1e-12) {
        // Recover the actual pane dimensions in view space. A wide storefront
        // has the same room depth in metres as a narrow upper window.
        vec3 span = (posDx * paneDy.y - posDy * paneDx.y) / det;
        vec3 rise = (posDy * paneDx.x - posDx * paneDy.x) / det;
        vec3 eye = normalize(vViewPosition);
        float facing = abs(dot(eye, normalize(cross(span, rise))));
        vec2 ray = -vec2(dot(eye, span) / max(dot(span,span), 1e-5),
                         dot(eye, rise) / max(dot(rise,rise), 1e-5)) / max(0.07, facing);
        vec2 toWall = mix(vPaneUv, 1.0 - vPaneUv, step(vec2(0.0), ray)) / max(abs(ray), vec2(1e-5));
        float depth = min(2.4, min(toWall.x, toWall.y));
        vec2 hit = clamp(vPaneUv + depth * ray, 0.0, 1.0);
        float tone = depth == toWall.y ? mix(0.24, 0.56, step(0.5, hit.y))
                    : depth == toWall.x ? 0.34 : 0.29;
        // Light from the opening falls off into the recess. A back-wall rail
        // gives the eye a fixed depth cue as it moves past the glass.
        tone *= mix(1.12, 0.64, depth / 2.4);
        float rail = 1.0 - smoothstep(0.01, 0.022 + fwidth(vPaneUv.y), abs(hit.y - 0.31));
        tone *= 1.0 - 0.45 * rail * smoothstep(2.35, 2.4, depth);
        diffuseColor.rgb *= mix(0.42, tone, smoothstep(0.06, 0.42, facing));
      }`,
        ],
      ],
    );
  };
  material.customProgramCacheKey = () => "bethesda-window-interior-v1";
  return material;
}
