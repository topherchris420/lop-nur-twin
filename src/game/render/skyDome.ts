import * as THREE from "three";
import { SKY_MODEL_GLSL, skyUniforms } from "./skyModel";

/**
 * The ground-level sky dome: `skyModel.ts`'s clear sky, the sun and moon
 * discs, a lit cumulus deck with cirrus above it, and at night the Milky Way.
 *
 * It replaces three's Preetham `Sky` for the first-person view only; the
 * twin's aerial camera keeps the sky it was tuned under. The dome is drawn at
 * the far plane behind everything, unfogged — the aerial perspective pass
 * skips sky pixels because the dome already carries its own horizon haze,
 * computed by the same function the pass fades terrain toward.
 */

const VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vWorldPosition;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldPosition = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
  #include <logdepthbuf_vertex>
}
`;

const FRAGMENT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${SKY_MODEL_GLSL}
varying vec3 vWorldPosition;

float domeHash(vec2 p) {
  vec3 q = fract(p.xyx * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

// The galactic band: a great circle tilted across the dome, mottled, with a
// dark dust lane down its middle.
vec3 milkyWay(vec3 dir) {
  vec3 pole = normalize(vec3(0.42, 0.55, -0.72));
  float lat = dot(dir, pole);
  vec3 u = normalize(cross(pole, vec3(0.0, 1.0, 0.0)));
  vec3 v = cross(pole, u);
  float lon = atan(dot(dir, v), dot(dir, u));
  vec2 p = vec2(lon * 3.0, lat * 9.0);
  float band = exp(-lat * lat / 0.018);
  float mottle = skyFbm3(p * 1.6) * 0.5 + 0.5;
  float laneOffset = (lat - 0.02 + skyNoise(p * 0.7) * 0.03) / 0.035;
  float lane = 1.0 - 0.7 * exp(-laneOffset * laneOffset);
  float coreOffset = lon - 0.8;
  float core = 0.6 + 0.4 * exp(-coreOffset * coreOffset / 0.5);
  return vec3(0.007, 0.0075, 0.009) * band * mottle * lane * core * smoothstep(0.0, 0.25, dir.y);
}

vec3 domeHash3(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}

// Stars: one candidate per cell of a lattice around the camera, kept where
// the hash says so. Brightness follows a steep power law, so most stars sit
// at the edge of visibility and a handful are bright enough to bloom.
vec3 starField(vec3 dir) {
  vec3 p = dir * 140.0;
  vec3 cell = floor(p);
  vec3 h = domeHash3(cell);
  if (h.x > 0.12) return vec3(0.0);
  vec3 star = cell + 0.2 + 0.6 * domeHash3(cell + 17.0);
  // Distance from the view ray to the star, in lattice units.
  float along = dot(star, dir);
  float off = length(star - dir * along);
  float mag = h.y * h.y * h.y * h.y;
  mag *= mag;
  float radius = 0.1 + 0.09 * mag;
  float glow = exp(-off * off / (radius * radius));
  float bright = 0.03 + 2.8 * mag * mag + 0.25 * mag;
  // Colour temperature: most white, some warm, a few blue.
  vec3 tint = mix(vec3(1.0, 0.86, 0.7), vec3(0.78, 0.86, 1.0), h.z);
  return tint * glow * bright * smoothstep(0.02, 0.2, dir.y);
}

void main() {
  #include <logdepthbuf_fragment>
  vec3 dir = normalize(vWorldPosition - cameraPosition);
  vec3 col = skyClear(dir);
  col += (milkyWay(dir) + starField(dir)) * (1.0 - skyDay);
  col += skySunDisc(dir);
  vec4 cloud = skyClouds(dir, col);
  col = col * (1.0 - cloud.a) + cloud.rgb;
  // A whisper of noise, below one display step, so the long gradients of an
  // empty sky do not band in eight bits.
  col *= 1.0 + (domeHash(gl_FragCoord.xy) - 0.5) * 0.012;
  gl_FragColor = vec4(max(col, 0.0), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/**
 * `cloudTaps` is the cloud self-shadow sample count (0 to 3): the dome is the
 * most expensive pixel on screen, so the lower tiers take fewer.
 */
export function createSkyDome(cloudTaps: number): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    name: "BlacksiteSky",
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: skyUniforms,
    defines: { SKY_CLOUD_TAPS: Math.max(0, Math.min(3, Math.round(cloudTaps))) },
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  // Inside the 26 km far plane wherever the player stands on the 6.8 km map.
  const dome = new THREE.Mesh(new THREE.SphereGeometry(16000, 48, 24), material);
  dome.name = "blacksite-sky";
  dome.frustumCulled = false;
  dome.renderOrder = -2;
  dome.userData["noCollide"] = true;
  return dome;
}
