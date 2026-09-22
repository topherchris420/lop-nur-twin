import * as THREE from "three";

/**
 * Shade for the single skinned soldier material.
 *
 * Roughness and metalness are per vertex (`pbr`) because one MeshStandardMaterial
 * cannot vary them otherwise — cloth, skin, helmet polymer, metal and glass must
 * not share a highlight. Cloth then gets an object-space weave (high frequency,
 * mostly roughness, a little albedo darkening) and upward faces get a dust lift
 * toward the pale lakebed. The albedo multiply stays inside about 0.85–1.08 so
 * the camouflage value bands are not washed out.
 *
 * Patched with onBeforeCompile. Log-depth chunks in the standard material are
 * left in place; this is not a raw ShaderMaterial.
 */

/** Pale Lop Nur dust, the same family as the terrain playa highlight. */
const LAKEBED = new THREE.Color(0xcabc98);

const CACHE_KEY = "soldier-shade-v9";

const VERTEX_COMMON = /* glsl */ `
attribute vec2 pbr;
varying vec2 vSoldierPbr;
varying vec3 vSoldierPos;
varying vec3 vSoldierWorldN;
`;

const VERTEX_PROJECT = /* glsl */ `
vSoldierPbr = pbr;
// Rest-space position, not the skinned one: the weave is printed on the cloth
// and has to stay put when a joint bends.
vSoldierPos = position;
vSoldierWorldN = mat3(modelMatrix) * objectNormal;
#include <project_vertex>
`;

const FRAGMENT_COMMON = /* glsl */ `
varying vec2 vSoldierPbr;
varying vec3 vSoldierPos;
varying vec3 vSoldierWorldN;
uniform vec3 uSoldierLakebed;

float soldierLuma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

// Continuous object-space weave. High frequency, faded once a thread is
// smaller than a pixel so it does not shimmer past the range it can read.
float soldierWeave(vec3 p, float freq) {
  vec3 q = p * freq;
  vec3 fw = max(fwidth(q), vec3(1e-4));
  float fade = 1.0 - smoothstep(0.45, 1.2, max(fw.x, max(fw.y, fw.z)));
  float s = sin(q.x) * sin(q.y + q.z * 1.7);
  return smoothstep(-0.15, 0.9, -s) * fade;
}

float soldierMacro(vec3 p) {
  vec3 q = p * vec3(8.5, 7.5, 6.0);
  vec3 fw = max(fwidth(q), vec3(1e-4));
  float fade = 1.0 - smoothstep(0.75, 1.6, max(fw.x, max(fw.y, fw.z)));
  return sin(q.x + q.z * 0.4) * sin(q.y) * fade;
}
`;

const ROUGHNESS = /* glsl */ `
float roughnessFactor = clamp(vSoldierPbr.x, 0.04, 1.0);
`;

const METALNESS_AND_SHADE = /* glsl */ `
float metalnessFactor = clamp(vSoldierPbr.y, 0.0, 1.0);
{
  float dielectric = 1.0 - metalnessFactor;
  // Cloth sits above skin (~0.72) and below a rubber sole (~0.98).
  float cloth = smoothstep(0.80, 0.88, roughnessFactor)
    * (1.0 - smoothstep(0.93, 0.98, roughnessFactor))
    * dielectric;
  // Helmet polymer and boot leather. Skin and glass fall outside this band.
  float hard = smoothstep(0.20, 0.40, roughnessFactor)
    * (1.0 - smoothstep(0.55, 0.68, roughnessFactor))
    * dielectric;

  float weave = soldierWeave(vSoldierPos, 52.0) * 0.68
    + soldierWeave(vSoldierPos, 104.0) * 0.32;
  float grain = soldierWeave(vSoldierPos, 26.0);
  float macro = soldierMacro(vSoldierPos);

  // Dust on world-up. Squared so only the top faces lift, and glass stays clear.
  float nLen = length(vSoldierWorldN);
  vec3 worldN = nLen > 1e-4 ? vSoldierWorldN / nLen : vec3(0.0, 1.0, 0.0);
  float upN = max(worldN.y, 0.0);
  float dust = upN * upN * smoothstep(0.2, 0.45, roughnessFactor);

  float darken = weave * 0.2 * cloth;
  vec3 shaded = diffuseColor.rgb * (1.0 - darken);
  // Wide bands plus a vertical seam. One direction still reads as a flat dye.
  float bands = smoothstep(0.32, 0.04, abs(fract(vSoldierPos.y * 4.8) - 0.5));
  float seam = smoothstep(0.22, 0.02, abs(fract(vSoldierPos.x * 3.2 + vSoldierPos.z) - 0.5));
  shaded *= 1.0 - (bands * 0.42 + seam * 0.18) * cloth;
  // Continuous, so a 0.3 m plate holds several values. floor() of a 3.2/m
  // grid is one cell across that plate and the vest stays one colour.
  float blot = sin(vSoldierPos.x * 62.0) * sin(vSoldierPos.y * 48.0 + vSoldierPos.z * 36.0);
  shaded *= 1.0 + blot * 0.28 * cloth;
  // Socket ring around each eye. The hole is wider than the sclera so the
  // white is not painted out.
  vec2 eyeL = vSoldierPos.xy - vec2(-0.036, 1.633);
  vec2 eyeR = vSoldierPos.xy - vec2(0.036, 1.633);
  float sock = max(
    smoothstep(0.048, 0.026, length(eyeL)) * (1.0 - smoothstep(0.022, 0.030, length(eyeL))),
    smoothstep(0.048, 0.026, length(eyeR)) * (1.0 - smoothstep(0.022, 0.030, length(eyeR)))
  );
  sock *= 1.0 - smoothstep(-0.08, -0.02, vSoldierPos.z);
  shaded *= 1.0 - sock * 0.5 * dielectric;
  vec3 dusted = mix(shaded, uSoldierLakebed, dust * 0.14);

  // Undersides of the helmet brim, pouches and pack. A single key leaves
  // those cavities the same value as the lit cloth, which is why the kit
  // reads as one faceted lump at a few metres.
  float cavity = max(-worldN.y, 0.0);
  cavity = cavity * cavity * dielectric * (1.0 - metalnessFactor);
  dusted *= 1.0 - cavity * 0.55;

  // Brow shadow only. The eyes sit near y = 1.63, z = -0.08; a band that
  // includes them paints the sockets the same value as the skin and the
  // face goes blank again. The brim is the strip just above that line.
  float brow = smoothstep(1.648, 1.672, vSoldierPos.y) * (1.0 - smoothstep(1.70, 1.735, vSoldierPos.y));
  float face = brow * smoothstep(0.02, -0.05, vSoldierPos.z);
  dusted *= 1.0 - face * 0.48 * dielectric;

  // Grazing rim in view space, stronger where the face is already dark, so
  // the silhouette separates from the sand without lighting the sun side twice.
  vec3 viewN = normalize(mat3(viewMatrix) * worldN);
  float ndotv = clamp(dot(viewN, normalize(-vViewPosition)), 0.0, 1.0);
  float rim = pow(1.0 - ndotv, 3.0) * (1.0 - upN) * dielectric;
  dusted += vec3(0.55, 0.62, 0.72) * rim * 0.16;

  float baseL = max(soldierLuma(diffuseColor.rgb), 1e-3);
  float dustL = max(soldierLuma(dusted), 1e-3);
  float ratio = dustL / baseL;
  float limited = clamp(ratio, 0.48, 1.32);
  diffuseColor.rgb = dusted * (limited / ratio);

  roughnessFactor = clamp(
    roughnessFactor
      + weave * 0.16 * cloth
      + macro * 0.05 * cloth
      + grain * 0.08 * hard
      + dust * 0.04,
    0.04,
    1.0
  );
}
`;

function replaceChunk(
  source: string,
  needle: string,
  insert: string,
  label: string,
): string {
  if (!source.includes(needle)) {
    throw new Error(`soldierShade: missing shader chunk ${label}`);
  }
  return source.replace(needle, insert);
}

/** Route per-vertex PBR plus the fabric / dust term into a standard material. */
export function applySoldierShade(
  material: THREE.MeshStandardMaterial,
): THREE.MeshStandardMaterial {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSoldierLakebed = { value: LAKEBED };
    shader.vertexShader = replaceChunk(
      shader.vertexShader,
      "#include <common>",
      `#include <common>\n${VERTEX_COMMON}`,
      "vertex common",
    );
    shader.vertexShader = replaceChunk(
      shader.vertexShader,
      "#include <project_vertex>",
      VERTEX_PROJECT,
      "project_vertex",
    );
    shader.fragmentShader = replaceChunk(
      shader.fragmentShader,
      "#include <common>",
      `#include <common>\n${FRAGMENT_COMMON}`,
      "fragment common",
    );
    shader.fragmentShader = replaceChunk(
      shader.fragmentShader,
      "#include <roughnessmap_fragment>",
      ROUGHNESS,
      "roughnessmap_fragment",
    );
    shader.fragmentShader = replaceChunk(
      shader.fragmentShader,
      "#include <metalnessmap_fragment>",
      METALNESS_AND_SHADE,
      "metalnessmap_fragment",
    );
  };
  // The chunk does not vary per team; colours and pbr live in the geometry.
  material.customProgramCacheKey = () => CACHE_KEY;
  material.needsUpdate = true;
  return material;
}
