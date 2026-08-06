import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { mulberry32 } from "@/lib/noise";

/**
 * Hard-surface look development for the desert airfield twin.
 *
 * The site is fully procedural — no binary assets — so the "assembled out of
 * steel plate" read has to come from shader maths rather than baked texture
 * sets. This module owns three things:
 *
 *  - `applyHardSurface()` patches a `MeshStandardMaterial` with procedural
 *    panel lines, plate seams, per-plate PBR variation, weathering and a
 *    grazing rim term. It patches via `onBeforeCompile` so shadows, fog,
 *    tone mapping and the logarithmic depth buffer all keep working.
 *  - `makeGreebleGeometry()` generates seeded, merged roof-clutter geometry.
 *  - `createHardSurfaceShaderMaterial()` builds a raw `ShaderMaterial` that
 *    is correctly wired for the logarithmic depth buffer.
 *
 * See `.claude/skills/blender-hardsurface/SKILL.md` for the authoring rules
 * these functions implement.
 */

/* ------------------------------------------------------------------ */
/* Hard-surface material patching                                      */
/* ------------------------------------------------------------------ */

export interface HardSurfaceOptions {
  /** Long edge of a plate, in metres. 1.4-4 for buildings, 6-12 for concrete. */
  plateScale?: number;
  /** Plate aspect ratio (short edge / long edge). */
  plateAspect?: number;
  /**
   * Running-bond offset per row, in cells. 0.5 staggers plates like
   * brickwork (right for sheet cladding), 0 keeps a straight grid (right for
   * architectural panels and poured concrete, where a stagger reads as
   * roof tiles).
   */
  stagger?: number;
  /** Seam width in metres. */
  seamWidth?: number;
  /** Albedo multiplier inside a seam. */
  seamDarken?: number;
  /** How much a seam raises roughness. */
  seamRoughness?: number;
  /** Strength of the seam's shading-normal perturbation. */
  seamRelief?: number;
  /** Peak-to-peak per-plate roughness variation. */
  plateRoughness?: number;
  /** Peak-to-peak per-plate albedo variation. */
  plateAlbedo?: number;
  /** Adds a hashed rivet speckle alongside the seams. */
  rivets?: boolean;
  /** Downward grime streaks on vertical faces. */
  streaks?: number;
  /** Dust settling on upward-facing surfaces. */
  dust?: number;
  /** Colour of the settled dust. */
  dustColor?: THREE.ColorRepresentation;
  /** Oxidisation bias applied along the streaks; drops metalness. */
  rust?: number;
  /** Colour the rust biases toward. */
  rustColor?: THREE.ColorRepresentation;
  /** Grazing-angle edge highlight strength. */
  rimIntensity?: number;
  /** Fresnel exponent for the rim; 2.5-4 reads as a machined edge. */
  rimPower?: number;
  /** Rim tint; usually the sky/haze colour. */
  rimColor?: THREE.ColorRepresentation;
  /** Decorrelates one material's plate layout from another's. */
  seed?: number;
}

interface ResolvedHardSurface extends Required<
  Omit<HardSurfaceOptions, "dustColor" | "rustColor" | "rimColor">
> {
  dustColor: THREE.Color;
  rustColor: THREE.Color;
  rimColor: THREE.Color;
}

const HARD_SURFACE_DEFAULTS: ResolvedHardSurface = {
  plateScale: 2.6,
  plateAspect: 0.62,
  stagger: 0.5,
  seamWidth: 0.035,
  seamDarken: 0.6,
  seamRoughness: 0.22,
  seamRelief: 0.55,
  plateRoughness: 0.14,
  plateAlbedo: 0.09,
  rivets: false,
  streaks: 0.35,
  dust: 0.3,
  dustColor: new THREE.Color("#c9bc99"),
  rust: 0,
  rustColor: new THREE.Color("#6d4325"),
  rimIntensity: 0.1,
  rimPower: 3,
  rimColor: new THREE.Color("#b9cfe8"),
  seed: 0,
};

/**
 * Shared fragment helpers. `hsProject` is a cheap face-aligned triplanar: the
 * geometry here is procedurally built from boxes and extrusions whose UVs are
 * inconsistent, so plate cells are derived from world position instead.
 */
const HARD_SURFACE_HEAD = /* glsl */ `
varying vec3 vHsPos;
varying vec3 vHsNormal;
varying vec3 vHsWorldNormal;

// three declares these in the vertex prefix only, but binds them for any
// program whose uniform map contains them, so declaring it here is enough
uniform mat3 normalMatrix;

uniform float hsPlateScale;
uniform float hsPlateAspect;
uniform float hsStagger;
uniform float hsSeamWidth;
uniform float hsSeamDarken;
uniform float hsSeamRoughness;
uniform float hsSeamRelief;
uniform float hsPlateRoughness;
uniform float hsPlateAlbedo;
uniform float hsStreaks;
uniform float hsDust;
uniform vec3 hsDustColor;
uniform float hsRust;
uniform vec3 hsRustColor;
uniform float hsRimIntensity;
uniform float hsRimPower;
uniform vec3 hsRimColor;
uniform float hsSeed;

float hsHash11(float n) {
  return fract(sin(n * 127.1 + hsSeed) * 43758.5453123);
}

float hsHash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7)) + hsSeed) * 43758.5453123);
}

float hsValueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hsHash21(i);
  float b = hsHash21(i + vec2(1.0, 0.0));
  float c = hsHash21(i + vec2(0.0, 1.0));
  float d = hsHash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

/**
 * Face-aligned projection plus the two tangents of that plane.
 *
 * This runs in **object** space, not world space: the compound is rotated
 * ~20 degrees off the world axes, and world-space cells would run panel lines
 * diagonally across every roof. Object space keeps plates square to the
 * structure they belong to. Geometry here is metre-scale and unscaled, so
 * object units are metres.
 */
void hsProject(vec3 p, vec3 n, out vec2 uv, out vec3 t1, out vec3 t2) {
  vec3 a = abs(n);
  if (a.y >= a.x && a.y >= a.z) {
    uv = p.xz;                       // roof / floor
    t1 = vec3(1.0, 0.0, 0.0);
    t2 = vec3(0.0, 0.0, 1.0);
  } else if (a.x >= a.z) {
    uv = vec2(p.z, p.y);             // wall facing +/-x
    t1 = vec3(0.0, 0.0, 1.0);
    t2 = vec3(0.0, 1.0, 0.0);
  } else {
    uv = vec2(p.x, p.y);             // wall facing +/-z
    t1 = vec3(1.0, 0.0, 0.0);
    t2 = vec3(0.0, 1.0, 0.0);
  }
}
`;

/**
 * Runs after `<metalnessmap_fragment>`, so `diffuseColor`, `roughnessFactor`
 * and `metalnessFactor` all exist and are still untouched by lighting.
 */
const HARD_SURFACE_SURFACE = /* glsl */ `
{
  vec3 hsN = normalize(vHsNormal);
  vec3 hsWorldN = normalize(vHsWorldNormal);
  vec2 hsUv;
  vec3 hsT1;
  vec3 hsT2;
  hsProject(vHsPos, hsN, hsUv, hsT1, hsT2);

  vec2 hsCellSize = vec2(hsPlateScale, hsPlateScale * hsPlateAspect);
  vec2 hsQ = hsUv / hsCellSize;

  // derivatives taken before the running-bond offset so the row stagger does
  // not produce a one-pixel artefact line
  vec2 hsFw = max(fwidth(hsQ), vec2(1e-5));

  float hsRow = floor(hsQ.y);
  hsQ.x += hsHash11(hsRow) * hsStagger;
  vec2 hsCell = floor(hsQ);

  // distance to the nearest cell boundary, 0 on the boundary
  vec2 hsEdge = abs(fract(hsQ - 0.5) - 0.5);
  vec2 hsHalf = (vec2(hsSeamWidth) * 0.5) / hsCellSize;
  vec2 hsLine = 1.0 - smoothstep(hsHalf, hsHalf + hsFw * 1.25, hsEdge);

  // fade the whole grid out once a plate is smaller than a couple of pixels,
  // otherwise the seams shimmer at distance
  float hsFade = 1.0 - smoothstep(0.22, 0.6, max(hsFw.x, hsFw.y));
  hsLine *= hsFade;
  float hsSeam = max(hsLine.x, hsLine.y);

  // --- per-plate PBR variation -------------------------------------
  float hsPlate = hsHash21(hsCell + 17.0);
  float hsPlate2 = hsHash21(hsCell * 1.37 - 5.0);
  roughnessFactor = clamp(roughnessFactor + (hsPlate - 0.5) * hsPlateRoughness, 0.035, 1.0);
  diffuseColor.rgb *= 1.0 + (hsPlate2 - 0.5) * hsPlateAlbedo;
  metalnessFactor = clamp(metalnessFactor * (1.0 + (hsPlate - 0.5) * 0.12), 0.0, 1.0);

  #ifdef HS_RIVETS
  {
    // sparse hashed speckle hugging the seams, as a PBR variation only
    vec2 hsRq = hsQ * vec2(7.0, 5.0);
    vec2 hsRf = fract(hsRq) - 0.5;
    float hsDot = 1.0 - smoothstep(0.16, 0.3, length(hsRf));
    float hsBand = 1.0 - smoothstep(0.04, 0.14, min(hsEdge.x, hsEdge.y));
    float hsRivet = hsDot * hsBand * hsFade * step(0.45, hsHash21(floor(hsRq) + 91.0));
    roughnessFactor = clamp(roughnessFactor - hsRivet * 0.22, 0.035, 1.0);
    diffuseColor.rgb *= 1.0 - hsRivet * 0.1;
  }
  #endif

  // --- seams: a recess is never clean ------------------------------
  diffuseColor.rgb *= mix(1.0, hsSeamDarken, hsSeam);
  roughnessFactor = clamp(roughnessFactor + hsSeam * hsSeamRoughness, 0.035, 1.0);
  metalnessFactor *= mix(1.0, 0.72, hsSeam);

  // --- weathering --------------------------------------------------
  // orientation terms use the *world* normal: dust settles along world up no
  // matter how the mesh that carries this material is rotated
  float hsUp = clamp(hsWorldN.y, 0.0, 1.0);
  float hsVertical = 1.0 - hsUp;

  // grime runs downward: fast horizontal variation, slow vertical
  float hsStreakField =
      hsValueNoise(vec2(hsUv.x * 1.9, vHsPos.y * 0.05)) * 0.62 +
      hsValueNoise(vec2(hsUv.x * 6.7, vHsPos.y * 0.018)) * 0.38;
  float hsStreak = smoothstep(0.52, 0.95, hsStreakField) * hsVertical;
  // seams shed water, so streaks are strongest just below one
  hsStreak *= 0.7 + 0.6 * hsLine.y;
  diffuseColor.rgb *= 1.0 - hsStreak * hsStreaks * 0.5;
  roughnessFactor = clamp(roughnessFactor + hsStreak * hsStreaks * 0.3, 0.035, 1.0);

  if (hsRust > 0.0) {
    float hsOx = hsStreak * hsRust;
    diffuseColor.rgb = mix(diffuseColor.rgb, hsRustColor, hsOx * 0.7);
    roughnessFactor = clamp(roughnessFactor + hsOx * 0.25, 0.035, 1.0);
    metalnessFactor *= 1.0 - hsOx * 0.65;
  }

  // dust settles by orientation, and undersides stay dark
  float hsDustAmount = pow(hsUp, 1.6) * hsDust * (0.65 + 0.35 * hsPlate2);
  diffuseColor.rgb = mix(diffuseColor.rgb, hsDustColor, hsDustAmount * 0.55);
  roughnessFactor = mix(roughnessFactor, 0.97, hsDustAmount * 0.7);
  metalnessFactor *= 1.0 - hsDustAmount * 0.6;
  diffuseColor.rgb *= 1.0 - clamp(-hsWorldN.y, 0.0, 1.0) * 0.18;

  hsSeamSlope = sign(fract(hsQ - 0.5) - 0.5) * hsLine;
  hsSeamT1 = hsT1;
  hsSeamT2 = hsT2;
}
`;

/**
 * Runs after `<normal_fragment_maps>`: tilts the shading normal along the
 * seam walls so grooves catch a specular highlight at grazing angles without
 * any actual displacement. The perturbation is built in object space from the
 * projection tangents, then rotated into the view space where `normal` lives.
 */
const HARD_SURFACE_NORMAL = /* glsl */ `
// the rim term keys off the *geometric* normal: it exists to light the
// silhouette, and letting a micro-groove drive it paints a bright fringe
// along every seam
hsRimNormal = normal;
if (hsSeamRelief > 0.0) {
  // hsSeamT1/T2 are object-space tangents and normal here is view space;
  // normalMatrix is object -> view, and three binds it for any program that
  // declares it (see the fragment head above)
  vec3 hsBump = -(hsSeamT1 * hsSeamSlope.x + hsSeamT2 * hsSeamSlope.y) * hsSeamRelief;
  normal = normalize(normal + normalMatrix * hsBump);
}
`;

/**
 * Runs after the lighting has been resolved into `gl_FragColor`: adds the
 * grazing-angle term that keeps geometric silhouettes readable against a dark
 * sky. Masked by the surface's own luminance so lit faces do not double up.
 */
const HARD_SURFACE_RIM = /* glsl */ `
if (hsRimIntensity > 0.0) {
  vec3 hsView = normalize(vViewPosition);
  vec3 hsRimN = dot(hsRimNormal, hsRimNormal) > 0.25 ? normalize(hsRimNormal) : normal;
  float hsFresnel = pow(clamp(1.0 - abs(dot(hsRimN, hsView)), 0.0, 1.0), hsRimPower);
  float hsLum = dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  float hsMask = 1.0 - smoothstep(0.12, 0.85, hsLum);
  gl_FragColor.rgb += hsRimColor * (hsFresnel * hsRimIntensity * hsMask);
}
`;

const patched = new WeakSet<THREE.Material>();

/**
 * Injects the procedural hard-surface pipeline into a standard material.
 *
 * Idempotent per material: calling it twice is a no-op, so it is safe from a
 * `useMemo` that React may run more than once. Returns the same instance so
 * it composes inline.
 */
export function applyHardSurface<M extends THREE.MeshStandardMaterial>(
  material: M,
  options: HardSurfaceOptions = {},
): M {
  if (patched.has(material)) return material;
  patched.add(material);

  const o: ResolvedHardSurface = {
    ...HARD_SURFACE_DEFAULTS,
    ...options,
    dustColor: new THREE.Color(options.dustColor ?? HARD_SURFACE_DEFAULTS.dustColor),
    rustColor: new THREE.Color(options.rustColor ?? HARD_SURFACE_DEFAULTS.rustColor),
    rimColor: new THREE.Color(options.rimColor ?? HARD_SURFACE_DEFAULTS.rimColor),
  };

  const uniforms: Record<string, THREE.IUniform> = {
    hsPlateScale: { value: o.plateScale },
    hsPlateAspect: { value: o.plateAspect },
    hsStagger: { value: o.stagger },
    hsSeamWidth: { value: o.seamWidth },
    hsSeamDarken: { value: o.seamDarken },
    hsSeamRoughness: { value: o.seamRoughness },
    hsSeamRelief: { value: o.seamRelief },
    hsPlateRoughness: { value: o.plateRoughness },
    hsPlateAlbedo: { value: o.plateAlbedo },
    hsStreaks: { value: o.streaks },
    hsDust: { value: o.dust },
    hsDustColor: { value: o.dustColor },
    hsRust: { value: o.rust },
    hsRustColor: { value: o.rustColor },
    hsRimIntensity: { value: o.rimIntensity },
    hsRimPower: { value: o.rimPower },
    hsRimColor: { value: o.rimColor },
    hsSeed: { value: o.seed },
  };

  // expose the uniforms so a `useFrame`/`useEffect` can retune without
  // re-patching the shader
  material.userData.hardSurface = uniforms;

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vHsPos;
varying vec3 vHsNormal;
varying vec3 vHsWorldNormal;`,
      )
      // `transformed` and `objectNormal` are final by the time project_vertex
      // runs, and this keeps the logdepth/clipping chunks after us untouched
      .replace(
        "#include <project_vertex>",
        `vHsPos = transformed;
vHsNormal = objectNormal;
vHsWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
#include <project_vertex>`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${HARD_SURFACE_HEAD}`)
      .replace(
        "void main() {",
        `void main() {
  vec2 hsSeamSlope = vec2(0.0);
  vec3 hsSeamT1 = vec3(1.0, 0.0, 0.0);
  vec3 hsSeamT2 = vec3(0.0, 1.0, 0.0);
  vec3 hsRimNormal = vec3(0.0);`,
      )
      .replace(
        "#include <metalnessmap_fragment>",
        `#include <metalnessmap_fragment>\n${HARD_SURFACE_SURFACE}`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>\n${HARD_SURFACE_NORMAL}`,
      )
      // gl_FragColor is assigned by <opaque_fragment>, which sits immediately
      // before this include in every lit material
      .replace(
        "#include <tonemapping_fragment>",
        `${HARD_SURFACE_RIM}\n#include <tonemapping_fragment>`,
      );
  };

  // the injection is switched by a #define, so it has to be part of the key
  const cacheKey = `hs:${o.rivets ? 1 : 0}`;
  material.customProgramCacheKey = () => cacheKey;
  if (o.rivets) material.defines = { ...material.defines, HS_RIVETS: "" };

  material.needsUpdate = true;
  return material;
}

/** Preset bundles for the material families the site actually uses. */
export const HARD_SURFACE_PRESETS = {
  /** Poured concrete: wide expansion joints, no rivets, weak neutral rim. */
  concrete: {
    plateScale: 7.5,
    plateAspect: 0.85,
    // expansion joints are poured on a straight grid, never staggered
    stagger: 0,
    seamWidth: 0.06,
    seamDarken: 0.72,
    seamRelief: 0.3,
    plateRoughness: 0.06,
    plateAlbedo: 0.07,
    streaks: 0.42,
    dust: 0.34,
    rimIntensity: 0.05,
    rimPower: 3.4,
  },
  /** Painted / chalked steel cladding: tight plates, rivets, rust streaks. */
  cladding: {
    plateScale: 2.4,
    plateAspect: 0.55,
    seamWidth: 0.03,
    seamDarken: 0.55,
    seamRelief: 0.7,
    plateRoughness: 0.16,
    plateAlbedo: 0.1,
    rivets: true,
    streaks: 0.5,
    rust: 0.35,
    dust: 0.26,
    rimIntensity: 0.13,
    rimPower: 2.8,
  },
  /** Bare machined metal: fine plates, strong rim, almost no grime. */
  machined: {
    plateScale: 1.1,
    plateAspect: 0.6,
    seamWidth: 0.016,
    seamDarken: 0.62,
    seamRelief: 0.8,
    plateRoughness: 0.12,
    plateAlbedo: 0.06,
    rivets: true,
    streaks: 0.16,
    dust: 0.12,
    rimIntensity: 0.16,
    rimPower: 2.6,
  },
  /**
   * Low-observable airframe skin. Deliberately the subtlest preset here: the
   * whole point of the coating is that panel lines and fasteners do *not*
   * read, so plates are large, seams are barely darker than the skin and
   * there are no rivets. The rim term does the work instead — it is what
   * makes a faceted airframe legible against dark ground.
   */
  airframe: {
    plateScale: 2.4,
    plateAspect: 0.75,
    stagger: 0,
    seamWidth: 0.014,
    seamDarken: 0.89,
    seamRelief: 0.3,
    plateRoughness: 0.05,
    plateAlbedo: 0.025,
    rivets: false,
    streaks: 0.1,
    dust: 0.08,
    rimIntensity: 0.17,
    rimPower: 3.2,
  },
  /** Large storage tanks / radomes: broad plates, welded seams, sun-bleached. */
  plated: {
    plateScale: 3.4,
    plateAspect: 0.5,
    stagger: 0.5,
    seamWidth: 0.045,
    seamDarken: 0.66,
    seamRelief: 0.6,
    plateRoughness: 0.13,
    plateAlbedo: 0.08,
    streaks: 0.4,
    rust: 0.2,
    dust: 0.3,
    rimIntensity: 0.12,
    rimPower: 3,
  },
} satisfies Record<string, HardSurfaceOptions>;

export type HardSurfacePreset = keyof typeof HARD_SURFACE_PRESETS;

/** `applyHardSurface` with a named preset, optionally overridden. */
export function applyPreset<M extends THREE.MeshStandardMaterial>(
  material: M,
  preset: HardSurfacePreset,
  overrides: HardSurfaceOptions = {},
): M {
  return applyHardSurface(material, { ...HARD_SURFACE_PRESETS[preset], ...overrides });
}

/* ------------------------------------------------------------------ */
/* Log-depth-safe raw shader material                                  */
/* ------------------------------------------------------------------ */

export interface HardSurfaceShaderOptions {
  vertexBody?: string;
  fragmentBody: string;
  head?: string;
  uniforms?: Record<string, THREE.IUniform>;
  transparent?: boolean;
  side?: THREE.Side;
}

/**
 * Raw `ShaderMaterial` wired for the logarithmic depth buffer.
 *
 * `<Canvas>` runs with `logarithmicDepthBuffer: true` (the site spans ~26 km
 * of camera range with 5 cm pavement lifts), which rewrites `gl_FragDepth` in
 * every built-in material. A custom shader that omits the logdepth chunks
 * writes plain window-space depth and z-fights against everything else, so
 * they are included here and cannot be forgotten.
 */
export function createHardSurfaceShaderMaterial({
  vertexBody = "",
  fragmentBody,
  head = "",
  uniforms = {},
  transparent = false,
  side = THREE.FrontSide,
}: HardSurfaceShaderOptions): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent,
    side,
    uniforms,
    vertexShader: /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec2 vUvCoord;
${head}
void main() {
  vUvCoord = uv;
  vec3 transformed = position;
  ${vertexBody}
  vec4 worldPosition = modelMatrix * vec4(transformed, 1.0);
  vWorldPos = worldPosition.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
  #include <logdepthbuf_vertex>
}
`,
    fragmentShader: /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec2 vUvCoord;
${head}
void main() {
  #include <logdepthbuf_fragment>
  ${fragmentBody}
}
`,
  });
}

/* ------------------------------------------------------------------ */
/* Greeble generation                                                  */
/* ------------------------------------------------------------------ */

export interface GreebleOptions {
  /** Seed; the same seed must always produce the same deck. */
  seed: number;
  /** Deck extent along local x, in metres. */
  width: number;
  /** Deck extent along local z, in metres. */
  depth: number;
  /** Primitive budget. Clamped to 60 — see the skill's budget rule. */
  count?: number;
  /** Keep clutter this far in from the deck edge. */
  inset?: number;
  /** Tallest box, in metres. */
  maxHeight?: number;
  /** Number of alignment rails clutter is distributed along. */
  rows?: number;
  /** Adds a few vertical stacks and a low pipe run. */
  pipes?: boolean;
}

/**
 * One merged `BufferGeometry` of seeded roof clutter: ducts, vents, cable
 * trays, exhaust stacks.
 *
 * Greebles read as *equipment*, so sizes are drawn from plausible aspect
 * ratios (ducts long and low, vents cubic, stacks tall and thin) and placed
 * along shared rails with small jitter — uniformly random boxes look like
 * static, aligned rows look like engineering. One geometry means one draw
 * call for the whole deck.
 */
export function makeGreebleGeometry({
  seed,
  width,
  depth,
  count = 22,
  inset = 1,
  maxHeight = 1.6,
  rows = 3,
  pipes = true,
}: GreebleOptions): THREE.BufferGeometry {
  const random = mulberry32(seed);
  const parts: THREE.BufferGeometry[] = [];

  const usableWidth = Math.max(0.5, width - inset * 2);
  const usableDepth = Math.max(0.5, depth - inset * 2);
  const budget = Math.min(60, Math.max(1, Math.round(count)));
  const railCount = Math.max(1, Math.min(rows, budget));

  const push = (
    geometry: THREE.BufferGeometry,
    x: number,
    y: number,
    z: number,
    rotationY: number,
  ) => {
    geometry.rotateY(rotationY);
    geometry.translate(x, y, z);
    parts.push(geometry);
  };

  for (let rail = 0; rail < railCount; rail++) {
    // rails run along z, evenly spread across the deck, each with its own
    // shared rotation so a cluster reads as one installation
    const railZ =
      railCount === 1 ? 0 : -usableDepth / 2 + (usableDepth * (rail + 0.5)) / railCount;
    const railX = (random() - 0.5) * usableWidth * 0.5;
    const railRotation = (random() - 0.5) * 0.12;
    const perRail = Math.max(1, Math.floor(budget / railCount));

    let cursor = -usableDepth / (2 * railCount);
    for (let i = 0; i < perRail; i++) {
      const kind = random();
      let sx: number;
      let sy: number;
      let sz: number;

      if (kind < 0.42) {
        // duct: long, low, narrow
        sx = 0.5 + random() * 0.7;
        sy = 0.3 + random() * 0.45;
        sz = 1.4 + random() * 2.6;
      } else if (kind < 0.74) {
        // vent housing: roughly cubic
        sx = 0.7 + random() * 0.9;
        sy = 0.5 + random() * 0.8;
        sz = sx * (0.8 + random() * 0.5);
      } else {
        // equipment cabinet: tall-ish block
        sx = 0.6 + random() * 0.8;
        sy = 0.9 + random() * (maxHeight - 0.9 > 0 ? maxHeight - 0.9 : 0.4);
        sz = 0.5 + random() * 0.7;
      }

      sy = Math.min(sy, maxHeight);

      const gap = 0.35 + random() * 0.8;
      const z = THREE.MathUtils.clamp(cursor + sz / 2, -usableDepth / 2, usableDepth / 2);
      cursor += sz + gap;
      if (cursor > usableDepth / (2 * railCount) + usableDepth) break;

      const x = THREE.MathUtils.clamp(
        railX + (random() - 0.5) * 0.6,
        -usableWidth / 2 + sx / 2,
        usableWidth / 2 - sx / 2,
      );

      push(
        new THREE.BoxGeometry(sx, sy, sz),
        x,
        sy / 2,
        THREE.MathUtils.clamp(railZ + z * 0.35, -usableDepth / 2, usableDepth / 2),
        railRotation,
      );

      // a low plinth under the taller cabinets, the way real kit is mounted
      if (sy > 1 && random() < 0.6) {
        push(
          new THREE.BoxGeometry(sx * 1.25, 0.12, sz * 1.25),
          x,
          0.06,
          THREE.MathUtils.clamp(railZ + z * 0.35, -usableDepth / 2, usableDepth / 2),
          railRotation,
        );
      }
    }
  }

  if (pipes) {
    // a couple of exhaust stacks
    const stacks = 1 + Math.floor(random() * 3);
    for (let i = 0; i < stacks; i++) {
      const radius = 0.1 + random() * 0.14;
      const height = maxHeight * (1.1 + random() * 0.9);
      const x = (random() - 0.5) * usableWidth * 0.8;
      const z = (random() - 0.5) * usableDepth * 0.8;
      const stack = new THREE.CylinderGeometry(radius, radius * 1.15, height, 8, 1);
      stack.translate(x, height / 2, z);
      parts.push(stack);
      const cap = new THREE.CylinderGeometry(radius * 1.45, radius * 1.45, 0.1, 8, 1);
      cap.translate(x, height, z);
      parts.push(cap);
    }

    // one low pipe run crossing the deck, on stubby supports
    const runZ = (random() - 0.5) * usableDepth * 0.6;
    const runRadius = 0.09 + random() * 0.06;
    const runLength = usableWidth * (0.55 + random() * 0.35);
    const run = new THREE.CylinderGeometry(runRadius, runRadius, runLength, 8, 1);
    run.rotateZ(Math.PI / 2);
    run.translate(0, 0.32, runZ);
    parts.push(run);
    for (let i = 0; i < 3; i++) {
      const support = new THREE.BoxGeometry(0.14, 0.32, 0.14);
      support.translate((-1 + i) * runLength * 0.34, 0.16, runZ);
      parts.push(support);
    }
  }

  if (parts.length === 0) return new THREE.BufferGeometry();
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!merged) return new THREE.BufferGeometry();
  merged.computeVertexNormals();
  return merged;
}
