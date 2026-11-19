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
      [
        "#include <common>",
        "#include <common>\nvarying vec2 vPaneUv;\nvarying float vRoomVariant;",
      ],
      [
        "#include <uv_vertex>",
        "#include <uv_vertex>\nvRoomVariant = floor(uv.y * 0.5);\nvPaneUv = vec2(uv.x, uv.y - vRoomVariant * 2.0);",
      ],
    ]);
    shader.fragmentShader = patchShader(
      "Bethesda glass (fragment)",
      shader.fragmentShader,
      [
        [
          "#include <common>",
          "#include <common>\nvarying vec2 vPaneUv;\nvarying float vRoomVariant;",
        ],
        [
          "#include <color_fragment>",
          /* glsl */ `#include <color_fragment>
      vec3 roomGlow = vec3(0.0);
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
        bool side = depth == toWall.x;
        bool horizontal = depth == toWall.y;
        vec2 wall = side ? vec2(depth / 2.4, hit.y) : hit;
        bool shop = vRoomVariant >= 8.0;
        float style = mod(vRoomVariant, 8.0);
        vec3 plaster = mix(vec3(0.60,0.54,0.45), vec3(0.43,0.53,0.52), fract(style * 0.37));
        vec3 room = plaster * (side ? 0.64 : 0.90);
        float openLight = 1.0 - depth / 2.4;
        if (horizontal) {
          room = hit.y < 0.5 ? vec3(0.25,0.21,0.16) : vec3(0.76,0.75,0.68);
        } else if (shop) {
          // A fitted display on the room wall, behind a freestanding counter.
          // Their different depths produce parallax as the observer walks.
          float bays = 3.0 + mod(style,3.0);
          float bay = floor(wall.x * bays);
          vec2 panel = fract(wall * vec2(bays,3.0));
          vec2 aa = clamp(fwidth(wall) * vec2(bays,3.0), vec2(0.008), vec2(0.25));
          float upright = 1.0 - smoothstep(0.025, 0.025 + aa.x, min(panel.x,1.0-panel.x));
          float shelf = 1.0 - smoothstep(0.045, 0.045 + aa.y, panel.y);
          float trim = max(upright, shelf) * (1.0 - smoothstep(0.77,0.81,wall.y));
          room = mix(room, vec3(0.17,0.13,0.095),trim * 0.78);
          float light = smoothstep(0.025,0.06,panel.y) * (1.0 - smoothstep(0.065,0.12+aa.y,panel.y));
          roomGlow = vec3(0.095,0.051,0.024) * light * step(0.4,fract(style*0.27+bay*0.41)) * (1.0-smoothstep(0.68,0.77,wall.y));
        } else {
          // Depth at the reveals, a ceiling cove, and varying window treatments.
          float blind = smoothstep(0.54 + 0.05*style,0.565 + 0.05*style,wall.y);
          room = mix(room,vec3(0.61,0.57,0.48),blind * step(3.0,style));
          room *= 0.76 + 0.24*smoothstep(0.0,0.12,1.0 - wall.y);
        }
        if (shop) {
          float setBack = 0.55 + 0.07 * style;
          vec2 front = vPaneUv + setBack * ray;
          vec2 aa = clamp(fwidth(front), vec2(0.004), vec2(0.08));
          float bottom = 0.06, top = 0.32 + mod(style,3.0)*0.065;
          float counter = smoothstep(0.12,0.12+aa.x,front.x)*(1.0-smoothstep(0.79-aa.x,0.79,front.x)) *
              smoothstep(bottom,bottom+aa.y,front.y)*(1.0-smoothstep(top-aa.y,top,front.y))*step(setBack,depth);
          room = mix(room,mix(vec3(0.22,0.14,0.09),vec3(0.48,0.43,0.35),smoothstep(top-0.04,top-0.015,front.y)),counter);
          roomGlow *= 1.0-counter;
        }
        float clearView = smoothstep(0.045,0.38,facing);
        diffuseColor.rgb *= mix(vec3(0.27),room * (0.48 + 0.46 * openLight),clearView);
        roomGlow *= clearView;
      }`,
        ],
        [
          "#include <emissivemap_fragment>",
          "#include <emissivemap_fragment>\ntotalEmissiveRadiance += roomGlow;",
        ],
      ],
    );
  };
  material.customProgramCacheKey = () => "bethesda-window-interior-v2";
  return material;
}
