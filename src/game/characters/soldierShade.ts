import * as THREE from "three";
import { patchShader } from "../../gfx/shaderPatch";

/**
 * Shade for the single skinned soldier material.
 *
 * A soldier is one mesh and one draw call, but it is a dozen materials: cotton
 * ripstop, 500D nylon, PALS webbing, velcro loop, a polymer helmet shell,
 * rubber soles, rough-out suede, knit, skin, glass and a little steel. They
 * must not share a highlight or a texture, so every vertex carries its class
 * (`pbr.z`) along with roughness, metalness and a camouflage flag, and this
 * shader gives each class its own micro-surface:
 *
 *  - **Camouflage is printed in the fragment shader**, from the vertex's
 *    rest-pose position. Vertex-colour camo is only as sharp as the mesh is
 *    dense, which on a limb is a smear; evaluated per pixel the blotches have
 *    printed edges at any distance and the pattern still travels with the
 *    cloth because it is sampled in rest space.
 *  - **Weave is a bump, not a colour.** Ripstop grid, twill, cordura basket
 *    weave, PALS rows with bar-tacks, knit ribs, rubber lugs: all are height
 *    fields turned into a perturbed normal with screen derivatives (three's
 *    own `perturbNormalArb`), faded out by `fwidth` before they alias.
 *  - **Occlusion and convexity are baked per vertex** (`soldierBake.ts`) and
 *    applied here: crevices darken the albedo and the indirect light, edges
 *    get abrasion. That is most of what separates a pouch from the plate it is
 *    sewn to.
 *
 * Patched through `patchShader`; log depth, shadows, fog and the environment
 * map all stay stock.
 */

/** Material classes, written into `pbr.z`. */
export const SOLDIER_MAT = {
  cloth: 0,
  nylon: 1,
  pals: 2,
  loop: 3,
  skin: 4,
  rubber: 5,
  polymer: 6,
  metal: 7,
  glass: 8,
  suede: 9,
  knit: 10,
  leather: 11,
} as const;

export type SoldierMat = (typeof SOLDIER_MAT)[keyof typeof SOLDIER_MAT];

/** Five printed tones: ground, two blotch layers, dark branches, highlights. */
export type CamoPalette = readonly [number, number, number, number, number];

const DEFAULT_CAMO: CamoPalette = [0xa8977a, 0x7c6a52, 0x6d6c52, 0x45392c, 0xc8b998];

/** Pale Lop Nur dust, the same family as the terrain playa highlight. */
const LAKEBED = new THREE.Color(0xc4b593);

const CACHE_KEY = "soldier-shade-v20";

const VERTEX_COMMON = /* glsl */ `
attribute vec4 pbr;
attribute vec2 occ;
varying vec4 vSoldierPbr;
varying vec2 vSoldierOcc;
varying vec3 vSoldierPos;
varying vec3 vSoldierRestN;
varying vec3 vSoldierWorldN;
`;

const VERTEX_PROJECT = /* glsl */ `
vSoldierPbr = pbr;
vSoldierOcc = occ;
// Rest-space position and normal, not the skinned ones: print and weave are
// on the cloth and have to stay put when a joint bends.
vSoldierPos = position;
vSoldierRestN = normal;
vSoldierWorldN = mat3(modelMatrix) * objectNormal;
#include <project_vertex>
`;

const FRAGMENT_COMMON = /* glsl */ `
varying vec4 vSoldierPbr;
varying vec2 vSoldierOcc;
varying vec3 vSoldierPos;
varying vec3 vSoldierRestN;
varying vec3 vSoldierWorldN;
uniform vec3 uSoldierLakebed;
uniform vec3 uSoldierCamo[5];

float soldierLuma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

vec3 soldierHash3(vec3 p) {
  p = vec3(
    dot(p, vec3(127.1, 311.7, 74.7)),
    dot(p, vec3(269.5, 183.3, 246.1)),
    dot(p, vec3(113.5, 271.9, 124.6))
  );
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}

// Gradient noise, roughly -0.7..0.7.
float soldierNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float n000 = dot(soldierHash3(i), f);
  float n100 = dot(soldierHash3(i + vec3(1.0, 0.0, 0.0)), f - vec3(1.0, 0.0, 0.0));
  float n010 = dot(soldierHash3(i + vec3(0.0, 1.0, 0.0)), f - vec3(0.0, 1.0, 0.0));
  float n110 = dot(soldierHash3(i + vec3(1.0, 1.0, 0.0)), f - vec3(1.0, 1.0, 0.0));
  float n001 = dot(soldierHash3(i + vec3(0.0, 0.0, 1.0)), f - vec3(0.0, 0.0, 1.0));
  float n101 = dot(soldierHash3(i + vec3(1.0, 0.0, 1.0)), f - vec3(1.0, 0.0, 1.0));
  float n011 = dot(soldierHash3(i + vec3(0.0, 1.0, 1.0)), f - vec3(0.0, 1.0, 1.0));
  float n111 = dot(soldierHash3(i + vec3(1.0, 1.0, 1.0)), f - vec3(1.0, 1.0, 1.0));
  return mix(
    mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
    mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y),
    u.z
  );
}

// Antialiased threshold: hard print edge up close, a blend once the edge is
// smaller than a pixel.
float soldierStep(float edge, float x) {
  float w = max(fwidth(x) * 0.75, 1e-4);
  return smoothstep(edge - w, edge + w, x);
}

// Amplitude fade for a pattern of the given frequency (cycles per metre).
float soldierFade(vec3 p, float freq) {
  vec3 fw = fwidth(p) * freq;
  return 1.0 - smoothstep(0.35, 0.9, max(fw.x, max(fw.y, fw.z)));
}

float soldierFade2(vec2 p, float freq) {
  vec2 fw = fwidth(p) * freq;
  return 1.0 - smoothstep(0.35, 0.9, max(fw.x, fw.y));
}

// Multi-scale disruptive print, sampled in rest space (metres): a ground
// tone, two layers of domain-warped blotches, thin dark vertical branches and
// small pale highlights, in that stacking order.
vec3 soldierCamo(vec3 p) {
  vec3 q = p * 8.5;
  vec3 warp = vec3(
    soldierNoise(q * 0.7 + vec3(3.1, 1.7, 9.2)),
    soldierNoise(q * 0.7 + vec3(7.7, 5.3, 2.9)),
    0.0
  );
  warp.z = -warp.x * 0.6 + warp.y * 0.4;
  q += warp * 1.1;
  float n1 = soldierNoise(q) * 0.72 + soldierNoise(q * 2.3 + 4.0) * 0.28;
  float n2 = soldierNoise(q * 1.55 + vec3(19.0, 3.0, 11.0)) * 0.7
    + soldierNoise(q * 3.4 + 5.0) * 0.3;
  vec3 qb = vec3(q.x * 2.6, q.y * 0.85, q.z * 2.6) + vec3(41.0, 7.0, 13.0);
  float n3 = soldierNoise(qb) * 0.8 + soldierNoise(q * 5.0 + 2.0) * 0.2;
  float n4 = soldierNoise(q * 3.8 + vec3(77.0, 1.0, 5.0));
  vec3 col = uSoldierCamo[0];
  col = mix(col, uSoldierCamo[1], soldierStep(0.07, n1));
  col = mix(col, uSoldierCamo[2], soldierStep(0.2, n2) * (1.0 - soldierStep(0.3, n1)));
  float branch = soldierStep(0.36, n3) * soldierStep(-0.1, n1 + n2 * 0.5);
  col = mix(col, uSoldierCamo[3], branch);
  col = mix(col, uSoldierCamo[4], soldierStep(0.36, n4) * (1.0 - branch));
  return col;
}

// Thin line every 'period' metres, 0..1, faded under a pixel.
float soldierLines(float x, float period, float width) {
  float f = abs(fract(x / period) - 0.5) * 2.0;
  float w = max(fwidth(x / period) * 1.5, width);
  return 1.0 - smoothstep(width, width + w, 1.0 - f);
}

float soldierHeight;
`;

const ROUGHNESS = /* glsl */ `
float roughnessFactor = clamp(vSoldierPbr.x, 0.04, 1.0);
`;

const METALNESS_AND_SHADE = /* glsl */ `
float metalnessFactor = clamp(vSoldierPbr.y, 0.0, 1.0);
float soldierAo = clamp(vSoldierOcc.x, 0.0, 1.0);
soldierHeight = 0.0;
{
  int mat = int(vSoldierPbr.z + 0.5);
  vec3 p = vSoldierPos;
  vec3 rn = normalize(vSoldierRestN);
  vec3 an = abs(rn);
  // Cheap triplanar: the weave runs in the plane the surface mostly faces.
  vec2 pl = an.y > max(an.x, an.z) ? p.xz : (an.x > an.z ? p.zy : p.xy);
  float convex = vSoldierOcc.y;
  vec3 base = diffuseColor.rgb;
  if (vSoldierPbr.w > 0.5) base = soldierCamo(p) * diffuseColor.rgb;
  float rough = roughnessFactor;
  float wearAmount = 0.0;
  float speck = soldierNoise(p * 90.0);

  if (mat == ${SOLDIER_MAT.cloth}) {
    // Cotton/nylon ripstop: a 5.5 mm grid of heavier threads over a twill.
    float fadeGrid = soldierFade2(pl, 1.0 / 0.0055);
    float grid = max(soldierLines(pl.x, 0.0055, 0.1), soldierLines(pl.y, 0.0055, 0.1)) * fadeGrid;
    float twillFade = soldierFade2(pl, 1.0 / 0.0011);
    float twill = sin((pl.x + pl.y) * 6.2832 / 0.0011) * twillFade;
    float crumple = (soldierNoise(p * 38.0) * 0.65 + soldierNoise(p * 85.0) * 0.35) * soldierFade(p, 85.0);
    soldierHeight = grid * 0.00011 + twill * 0.000035 + crumple * 0.0011;
    base *= 1.0 - grid * 0.07;
    base *= 1.0 + crumple * 0.07;
    rough = clamp(rough + crumple * 0.05 - grid * 0.02, 0.5, 1.0);
    wearAmount = 0.35;
  } else if (mat == ${SOLDIER_MAT.nylon} || mat == ${SOLDIER_MAT.pals}) {
    // 500D cordura: tight basket weave, a slightly waxy sheen.
    float fadeW = soldierFade2(pl, 1.0 / 0.0014);
    float weave = sin(pl.x * 6.2832 / 0.0014) * sin(pl.y * 6.2832 / 0.0014) * fadeW;
    soldierHeight = weave * 0.00005 + soldierNoise(p * 30.0) * 0.0004 * soldierFade(p, 30.0);
    base *= 1.0 + soldierNoise(p * 14.0) * 0.06;
    if (mat == ${SOLDIER_MAT.pals}) {
      // PALS: 25 mm webbing rows on 25 mm gaps, bar-tacked every 38 mm.
      float u = an.x > an.z ? p.z : p.x;
      float row = fract((p.y + 0.004) / 0.05);
      float band = smoothstep(0.02, 0.07, row) * (1.0 - smoothstep(0.48, 0.53, row));
      float fadeRow = soldierFade(p, 1.0 / 0.05);
      float tack = soldierLines(u, 0.038, 0.06) * band;
      soldierHeight += (band * 0.0016 - tack * 0.0006) * fadeRow;
      base *= 1.0 - (1.0 - band) * 0.22 * fadeRow - tack * 0.15 * fadeRow;
      rough = clamp(rough + (1.0 - band) * 0.06, 0.4, 1.0);
    }
    wearAmount = 0.6;
  } else if (mat == ${SOLDIER_MAT.loop}) {
    // Velcro loop: fuzz.
    soldierHeight = soldierNoise(p * 260.0) * 0.00025 * soldierFade(p, 260.0);
    base *= 0.92 + speck * 0.12;
    rough = 1.0;
  } else if (mat == ${SOLDIER_MAT.skin}) {
    soldierHeight = soldierNoise(p * 160.0) * 0.00008 * soldierFade(p, 160.0);
    base *= 1.0 + soldierNoise(p * 22.0) * 0.08;
  } else if (mat == ${SOLDIER_MAT.rubber}) {
    // Moulded sole: horizontal sipes along the sidewall.
    float sipe = soldierLines(p.y, 0.0065, 0.18) * soldierFade(p, 150.0);
    soldierHeight = -sipe * 0.0007;
    base *= 1.0 - sipe * 0.25;
    rough = clamp(rough - sipe * 0.1, 0.6, 1.0);
    wearAmount = 0.4;
  } else if (mat == ${SOLDIER_MAT.polymer}) {
    // Moulded stipple and scuffing.
    soldierHeight = soldierNoise(p * 420.0) * 0.00004 * soldierFade(p, 420.0);
    float scuff = smoothstep(0.25, 0.6, soldierNoise(p * 26.0 + 3.0));
    rough = clamp(rough + scuff * 0.14 + speck * 0.05, 0.25, 0.95);
    base *= 1.0 + scuff * 0.08;
    wearAmount = 0.9;
  } else if (mat == ${SOLDIER_MAT.metal}) {
    rough = clamp(rough + speck * 0.08, 0.2, 0.8);
    wearAmount = 1.2;
  } else if (mat == ${SOLDIER_MAT.suede} || mat == ${SOLDIER_MAT.leather}) {
    float nap = soldierNoise(p * 120.0) * soldierFade(p, 120.0);
    soldierHeight = nap * (mat == ${SOLDIER_MAT.suede} ? 0.00022 : 0.00007);
    base *= 1.0 + soldierNoise(p * 18.0) * 0.12 + nap * 0.05;
    // Creases across the vamp.
    float crease = soldierLines(p.z + p.y * 0.4, 0.011, 0.12) * smoothstep(-0.03, -0.09, p.z)
      * soldierFade(p, 90.0);
    soldierHeight -= crease * 0.0005;
    wearAmount = 0.7;
  } else if (mat == ${SOLDIER_MAT.knit}) {
    // Rib knit, ribs running down the face.
    float ang = atan(p.x, -p.z + 0.02);
    float rib = sin(ang * 120.0) * soldierFade2(vec2(ang * 0.019, p.y), 120.0 / 0.019);
    float course = sin(p.y * 6.2832 / 0.0016) * soldierFade(p, 1.0 / 0.0016);
    soldierHeight = rib * 0.00022 + course * 0.00005 + soldierNoise(p * 40.0) * 0.0006;
    base *= 1.0 + rib * 0.05;
    // Eye opening of a balaclava: skin and shadowed sockets.
    vec2 slot = vec2(p.x / 0.056, (p.y - 1.641) / 0.021);
    float slotMask = (1.0 - smoothstep(0.85, 1.0, length(pow(abs(slot), vec2(1.6)))))
      * step(p.z, -0.035);
    vec2 eyeL = vec2(p.x + 0.033, p.y - 1.637);
    vec2 eyeR = vec2(p.x - 0.033, p.y - 1.637);
    float sock = 1.0 - smoothstep(0.009, 0.022, min(length(eyeL), length(eyeR)));
    vec3 skin = vec3(0.32, 0.2, 0.14) * (1.0 - sock * 0.8);
    base = mix(base, skin, slotMask);
    rough = mix(rough, 0.6, slotMask);
    soldierHeight *= 1.0 - slotMask;
  }

  // Edge abrasion and cavity grime from the baked convexity.
  float edge = smoothstep(0.18, 0.62, convex) * (0.6 + 0.4 * smoothstep(-0.3, 0.4, speck));
  base = mix(base, base * 1.32 + vec3(0.012, 0.01, 0.008), edge * wearAmount * 0.5);
  rough = clamp(rough + edge * wearAmount * 0.06, 0.04, 1.0);
  float cavity = smoothstep(0.0, -0.55, convex);
  base *= 1.0 - cavity * 0.22;
  // Grime settles where light does not reach.
  base *= mix(0.7, 1.0, soldierAo);

  // Dust: up-facing surfaces, and the legs from the knee down.
  float nLen = length(vSoldierWorldN);
  vec3 worldN = nLen > 1e-4 ? vSoldierWorldN / nLen : vec3(0.0, 1.0, 0.0);
  float upN = max(worldN.y, 0.0);
  float dirt = (1.0 - smoothstep(0.06, 0.36, p.y)) * 0.16 + upN * upN * 0.12;
  dirt *= (mat == ${SOLDIER_MAT.glass} || mat == ${SOLDIER_MAT.skin}) ? 0.0 : 1.0;
  dirt *= 0.7 + 0.6 * smoothstep(-0.4, 0.5, soldierNoise(p * 11.0));
  base = mix(base, uSoldierLakebed * 0.62, clamp(dirt, 0.0, 0.3));
  rough = clamp(rough + dirt * 0.2, 0.04, 1.0);

  // Fabric backscatter: cloth brightens a little at grazing angles, the
  // velvet term that makes a sleeve read soft rather than painted.
  vec3 viewN = normalize(mat3(viewMatrix) * worldN);
  float ndotv = clamp(dot(viewN, normalize(vViewPosition)), 0.0, 1.0);
  float soft = (mat == ${SOLDIER_MAT.cloth} || mat == ${SOLDIER_MAT.knit} || mat == ${SOLDIER_MAT.loop}
    || mat == ${SOLDIER_MAT.suede}) ? 1.0 : (mat == ${SOLDIER_MAT.nylon} || mat == ${SOLDIER_MAT.pals}) ? 0.5 : 0.0;
  base *= 1.0 + pow(max(1.0 - ndotv, 0.0), 3.0) * 0.35 * soft;

  diffuseColor.rgb = base;
  roughnessFactor = rough;
}
`;

const NORMAL_BUMP = /* glsl */ `
#include <normal_fragment_maps>
{
  // perturbNormalArb with an analytic height (metres) instead of a texture.
  vec3 sigmaX = dFdx(-vViewPosition);
  vec3 sigmaY = dFdy(-vViewPosition);
  vec3 r1 = cross(sigmaY, normal);
  vec3 r2 = cross(normal, sigmaX);
  float det = dot(sigmaX, r1) * faceDirection;
  vec2 dh = vec2(dFdx(soldierHeight), dFdy(soldierHeight));
  vec3 grad = sign(det) * (dh.x * r1 + dh.y * r2);
  vec3 bumped = normalize(abs(det) * normal - grad);
  normal = (abs(det) > 1e-12) ? bumped : normal;
}
`;

const AO = /* glsl */ `
{
  float occl = soldierAo * soldierAo * (3.0 - 2.0 * soldierAo);
  reflectedLight.indirectDiffuse *= occl;
  // Shadow maps cannot resolve a pouch-sized gap; let the bake take a share
  // of the direct light too, so crevices read under the sun.
  reflectedLight.directDiffuse *= mix(1.0, occl, 0.4);
  reflectedLight.directSpecular *= mix(1.0, occl, 0.6);
  #if defined( USE_ENVMAP ) && defined( STANDARD )
    float dotNVo = saturate(dot(geometryNormal, geometryViewDir));
    reflectedLight.indirectSpecular *= computeSpecularOcclusion(dotNVo, occl, material.roughness);
  #endif
}
#include <aomap_fragment>
`;

function replaceChunk(
  source: string,
  needle: string,
  insert: string,
  label: string,
): string {
  return patchShader(`soldier shade (${label})`, source, [[needle, insert]]);
}

/**
 * Route per-vertex material classes, PBR, camouflage and the baked occlusion
 * into a standard material. `camo` is the team's printed palette.
 */
export function applySoldierShade(
  material: THREE.MeshStandardMaterial,
  camo: CamoPalette = DEFAULT_CAMO,
): THREE.MeshStandardMaterial {
  const palette = camo.map((hex) => new THREE.Color(hex));
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSoldierLakebed = { value: LAKEBED };
    shader.uniforms.uSoldierCamo = { value: palette };
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
    shader.fragmentShader = replaceChunk(
      shader.fragmentShader,
      "#include <normal_fragment_maps>",
      NORMAL_BUMP,
      "normal_fragment_maps",
    );
    shader.fragmentShader = replaceChunk(
      shader.fragmentShader,
      "#include <aomap_fragment>",
      AO,
      "aomap_fragment",
    );
  };
  // The chunk does not vary per team; palettes are uniforms, everything else
  // lives in the geometry.
  material.customProgramCacheKey = () => CACHE_KEY;
  material.needsUpdate = true;
  return material;
}
