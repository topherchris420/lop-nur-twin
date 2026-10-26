/**
 * Plasticine. Every sculpted thing in the garden is drawn with this
 * material: Three's physically based standard material with five changes.
 *
 * 1. **Hand marks.** The clay detail texture (fingerprint ridges, smears,
 *    tool drags, pits) is sampled tri-planarly at the object's sculpting
 *    scale and turned into a true surface relief (its depth in metres, not
 *    a screen-space trick), fading out where the marks would be smaller
 *    than a pixel so distant clay does not shimmer.
 * 2. **Colour that was mixed by hand.** Slow variation in the same texture
 *    tints the albedo a few percent, the way kneaded colours never quite
 *    even out.
 * 3. **Soft terminator.** Direct light wraps a little past the shadow line,
 *    and the wrapped band takes on a warm tint: the soft, slightly
 *    translucent edge of a clay surface. Specular light does not wrap.
 * 4. **Boil.** Objects an animator re-poses between frames (the fly) shift
 *    their marks a fraction each frame, as handled clay does.
 * 5. **Wind.** Grass blades and leaves bend in the vertex shader with the
 *    same seeded gusts for every visitor.
 *
 * Every lit material in the garden (clay or not) also carries the
 * **two-cascade sun**: the key light is drawn by two directional lights with
 * the same direction, one with a shadow map over the whole garden, one with
 * a tight map around the fly. Each fragment takes its light from the tight
 * one where that map covers it and from the wide one elsewhere, so the fly's
 * legs cast real shadows on a pear without a garden-sized shadow map.
 */
import * as THREE from "three";

export interface WindSettings {
  /** Which local axis runs from the root to the tip: y for blades, z for leaves. */
  axis: "y" | "z";
  /** Length of a blade or leaf in local units, for the bend profile. */
  length: number;
  /** Bend at the tip per unit of wind strength (local units). */
  amount: number;
}

export interface ClaySettings {
  color: THREE.ColorRepresentation;
  roughness?: number;
  /** Size of one tile of hand marks, in the units marks are laid out in (world metres, or object units with `objectSpace`). */
  scale?: number;
  /** Depth of the marks, as a fraction of `scale`. */
  relief?: number;
  /** Colour variation, 0…1. */
  smudge?: number;
  /** Light wrap past the terminator, 0…1. */
  wrap?: number;
  /** Tint of the wrapped band (linear RGB multiplier). */
  scatter?: THREE.ColorRepresentation;
  /** Detail coordinates follow the mesh (posed parts) instead of the world. */
  objectSpace?: boolean;
  /** Metres per object unit when `objectSpace` (the fly's meshes are in centimetres). */
  unit?: number;
  /** Per-vertex colours multiply the albedo. */
  vertexColors?: boolean;
  side?: THREE.Side;
  /** Decal atlas maps (colour with alpha, relief). */
  map?: THREE.Texture | null;
  reliefMap?: THREE.Texture | null;
  alphaTest?: number;
  emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
  metalness?: number;
  envMapIntensity?: number;
  wind?: WindSettings | null;
  /** Further shader changes for this material, under a program-cache `key` of their own. */
  patch?: {
    key: string;
    apply(shader: THREE.WebGLProgramParametersWithUniforms): void;
  } | null;
}

export interface ClayUniforms {
  uClayDetail: { value: THREE.Texture | null };
  uClayRelief: { value: THREE.Texture | null };
  uClayScale: { value: number };
  uClayDepth: { value: number };
  uClaySmudge: { value: number };
  uClayWrap: { value: number };
  uClayScatter: { value: THREE.Color };
  uClayBoil: { value: THREE.Vector3 };
  uClayReliefDepth: { value: number };
}

/** Wind state shared by every swaying material: x time (s), y strength, zw direction (world xz). */
export const WIND = { value: new THREE.Vector4(0, 0.3, 1, 0) };

export type ClayMaterial = THREE.MeshStandardMaterial & {
  userData: { clay: ClayUniforms };
};

// ------------------------------------------------------------ the two-cascade sun

/** Index of the directional light whose shadow map is the tight one around the fly. */
export const NEAR_CASCADE = 1;

const CASCADE_PRELUDE = /* glsl */ `
float gardenNear = 0.0;
#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > ${NEAR_CASCADE}
{
  vec3 gc = vDirectionalShadowCoord[ ${NEAR_CASCADE} ].xyz / vDirectionalShadowCoord[ ${NEAR_CASCADE} ].w;
  vec2 ge = min( gc.xy, 1.0 - gc.xy );
  gardenNear = smoothstep( 0.0, 0.07, min( ge.x, ge.y ) ) * step( gc.z, 1.0 ) * step( 0.0, gc.z );
}
#endif
`;

const DIR_INFO = "getDirectionalLightInfo( directionalLight, directLight );";

function patchCascade(fragmentShader: string): string {
  if (!fragmentShader.includes("#include <lights_fragment_begin>")) return fragmentShader;
  const chunk = THREE.ShaderChunk.lights_fragment_begin;
  if (!chunk.includes(DIR_INFO))
    throw new Error("garden: Three's light loop changed; update clay.ts");
  const patched = chunk
    .replace(
      "IncidentLight directLight;",
      `IncidentLight directLight;\n${CASCADE_PRELUDE}`,
    )
    .replace(
      DIR_INFO,
      `${DIR_INFO}\n\t\tdirectLight.color *= ( UNROLLED_LOOP_INDEX == 0 ? 1.0 - gardenNear : UNROLLED_LOOP_INDEX == ${NEAR_CASCADE} ? gardenNear : 1.0 );`,
    );
  return fragmentShader.replace("#include <lights_fragment_begin>", patched);
}

let extraPrograms = 0;

/**
 * Gives a non-clay lit material (water, glass, wing membranes) the
 * two-cascade sun. Every lit material in the garden must have it, or it
 * would take the key light twice. A material with `extra` shader changes
 * gets a program of its own: Three shares programs between materials whose
 * cache keys match, whatever their `onBeforeCompile` does.
 */
export function withCascade<M extends THREE.Material>(
  m: M,
  extra?: (s: THREE.WebGLProgramParametersWithUniforms) => void,
): M {
  const id = extra ? ++extraPrograms : 0;
  m.onBeforeCompile = (shader) => {
    extra?.(shader);
    shader.fragmentShader = patchCascade(shader.fragmentShader);
  };
  m.customProgramCacheKey = () => `cascade:${id}`;
  return m;
}

// ------------------------------------------------------------------- clay

const VERTEX_DECL = /* glsl */ `
varying vec3 vClayPos;
varying vec3 vClayNormal;
#ifdef CLAY_WIND
  uniform vec4 uWind;
  uniform vec3 uClayWind;
#endif
`;

/** Bends blades and leaves before anything else reads the position. */
const WIND_BODY = /* glsl */ `
#ifdef CLAY_WIND
{
  vec4 rootW = vec4( 0.0, 0.0, 0.0, 1.0 );
  #ifdef USE_INSTANCING
    rootW = instanceMatrix * rootW;
  #endif
  rootW = modelMatrix * rootW;
  float along = clamp( CLAY_WIND_AXIS / uClayWind.x, 0.0, 1.0 );
  float t = uWind.x;
  float ph = rootW.x * 2.7 + rootW.z * 3.1;
  float gust = 0.55 + 0.45 * sin( t * 0.37 + rootW.x * 0.6 - rootW.z * 0.4 );
  float sway = gust * ( 0.65 * sin( t * 1.9 + ph ) + 0.35 * sin( t * 3.3 + ph * 1.7 ) ) + 0.6 * gust;
  vec3 dirW = vec3( uWind.z, 0.0, uWind.w ) * sway * uWind.y * uClayWind.y * along * along;
  // World displacement into this instance's local frame.
  mat3 toLocal = mat3( modelMatrix );
  #ifdef USE_INSTANCING
    toLocal = toLocal * mat3( instanceMatrix );
  #endif
  float s2 = dot( toLocal[ 0 ], toLocal[ 0 ] );
  vec3 dl = transpose( toLocal ) * dirW / max( s2, 1e-12 );
  transformed += dl;
  // Keep the length: a bent tip also drops a little.
  transformed.y -= 0.5 * dot( dl, dl ) / max( uClayWind.x, 1e-6 );
}
#endif
`;

const VERTEX_BODY = /* glsl */ `
#ifdef CLAY_OBJECT_SPACE
  vClayPos = transformed;
  vClayNormal = objectNormal;
#else
  vec4 clayWorld = vec4( transformed, 1.0 );
  vec3 clayN = objectNormal;
  #ifdef USE_INSTANCING
    clayWorld = instanceMatrix * clayWorld;
    clayN = mat3( instanceMatrix ) * clayN;
  #endif
  clayWorld = modelMatrix * clayWorld;
  vClayPos = clayWorld.xyz;
  vClayNormal = mat3( modelMatrix ) * clayN;
#endif
`;

const FRAGMENT_DECL = /* glsl */ `
uniform sampler2D uClayDetail;
uniform float uClayScale;
uniform float uClayDepth;
uniform float uClaySmudge;
uniform vec3 uClayBoil;
varying vec3 vClayPos;
varying vec3 vClayNormal;
#ifdef CLAY_RELIEF_MAP
  uniform sampler2D uClayRelief;
  uniform float uClayReliefDepth;
#endif

vec4 claySample( vec3 p, vec3 n ) {
  vec3 w = pow( abs( n ), vec3( 4.0 ) );
  w /= ( w.x + w.y + w.z + 1e-5 );
  vec3 q = p / uClayScale + uClayBoil;
  return texture2D( uClayDetail, q.yz ) * w.x
       + texture2D( uClayDetail, q.zx ) * w.y
       + texture2D( uClayDetail, q.xy ) * w.z;
}

// A height field (view-space units) as a perturbed normal: Mikkelsen's surface gradient.
vec3 clayRelief( vec3 surfPos, vec3 n, float h, float faceDir ) {
  vec3 dpdx = dFdx( surfPos ), dpdy = dFdy( surfPos );
  vec3 r1 = cross( dpdy, n ), r2 = cross( n, dpdx );
  float det = dot( dpdx, r1 ) * faceDir;
  vec3 grad = sign( det ) * ( dFdx( h ) * r1 + dFdy( h ) * r2 );
  return normalize( abs( det ) * n - grad );
}
`;

const MAP_BODY = /* glsl */ `
  vec4 clay = claySample( vClayPos, normalize( vClayNormal ) );
  diffuseColor.rgb *= 1.0 + uClaySmudge * ( clay.g - 0.5 ) * 2.0;
  #if defined( USE_MAP ) && defined( USE_ALPHATEST )
  {
    // Cut-outs keep their shape far away: coarser mip levels average a leaf's
    // alpha down toward the cut, so it is scaled back up by the level sampled.
    vec2 texel = vMapUv * vec2( textureSize( map, 0 ) );
    vec2 dx = dFdx( texel ), dy = dFdy( texel );
    diffuseColor.a *= 1.0 + 0.25 * max( 0.5 * log2( max( dot( dx, dx ), dot( dy, dy ) ) ), 0.0 );
  }
  #endif
`;

const NORMAL_BODY = /* glsl */ `
  {
    // Marks finer than about a pixel are faded out rather than aliased.
    float tilesPerPixel = length( fwidth( vClayPos ) ) / uClayScale;
    float keep = 1.0 - smoothstep( 0.015, 0.06, tilesPerPixel );
    float h = ( ( clay.r - 0.5 ) + 0.3 * ( clay.b - 0.5 ) ) * uClayDepth * keep;
    #ifdef CLAY_RELIEF_MAP
      h += ( texture2D( uClayRelief, vMapUv ).r - 0.5 ) * uClayReliefDepth;
    #endif
    normal = clayRelief( - vViewPosition, normal, h, faceDirection );
  }
`;

/** The physical lighting chunk with the soft clay terminator (diffuse only). */
const LIGHTS = THREE.ShaderChunk.lights_physical_pars_fragment
  .replace(
    "vec3 irradiance = dotNL * directLight.color;",
    /* glsl */ `float clayNL = dot( geometryNormal, directLight.direction );
	float clayWrapped = saturate( ( clayNL + uClayWrap ) / ( 1.0 + uClayWrap ) );
	vec3 irradiance = ( clayWrapped + uClayScatter * max( clayWrapped - dotNL, 0.0 ) ) * directLight.color;
	vec3 claySpecular = dotNL * directLight.color;`,
  )
  .replace(
    "reflectedLight.directSpecular += irradiance * BRDF_GGX_Multiscatter(",
    "reflectedLight.directSpecular += claySpecular * BRDF_GGX_Multiscatter(",
  );
if (!LIGHTS.includes("clayWrapped") || !LIGHTS.includes("claySpecular * BRDF_GGX"))
  throw new Error("clay: Three's physical lighting chunk changed; update clay.ts");

/** Adds the clay changes (and the two-cascade sun) to a standard material. */
export function clayify<M extends THREE.MeshStandardMaterial>(
  m: M,
  shared: { detail: THREE.Texture },
  s: Omit<ClaySettings, "color"> = {},
): M & { userData: { clay: ClayUniforms } } {
  const scale = s.scale ?? 0.02;
  // Relief heights are applied in view space, so in metres.
  const unit = s.objectSpace ? (s.unit ?? 1) : 1;
  const u: ClayUniforms = {
    uClayDetail: { value: shared.detail },
    uClayRelief: { value: s.reliefMap ?? null },
    uClayScale: { value: scale },
    uClayDepth: { value: scale * (s.relief ?? 0.035) * unit },
    uClaySmudge: { value: s.smudge ?? 0.07 },
    uClayWrap: { value: s.wrap ?? 0.3 },
    uClayScatter: { value: new THREE.Color(s.scatter ?? 0x8a3a1c) },
    uClayBoil: { value: new THREE.Vector3() },
    uClayReliefDepth: { value: scale * 0.08 * unit },
  };
  const wind = s.wind ?? null;
  m.userData.clay = u;
  const defines: Record<string, string> = {};
  if (s.objectSpace) defines.CLAY_OBJECT_SPACE = "";
  // The relief map shares the colour map's UVs, so it needs one.
  if (s.reliefMap && s.map) defines.CLAY_RELIEF_MAP = "";
  if (wind) {
    defines.CLAY_WIND = "";
    defines.CLAY_WIND_AXIS = wind.axis === "y" ? "transformed.y" : "transformed.z";
  }
  m.defines = { ...m.defines, ...defines };
  const windUniform = wind
    ? { value: new THREE.Vector3(wind.length, wind.amount, 0) }
    : null;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    if (windUniform) {
      shader.uniforms.uWind = WIND;
      shader.uniforms.uClayWind = windUniform;
    }
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${VERTEX_DECL}`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\n${WIND_BODY}`)
      .replace("#include <project_vertex>", `#include <project_vertex>\n${VERTEX_BODY}`);
    shader.fragmentShader = patchCascade(
      shader.fragmentShader
        .replace("#include <common>", `#include <common>\n${FRAGMENT_DECL}`)
        .replace(
          "#include <lights_physical_pars_fragment>",
          `uniform float uClayWrap;\nuniform vec3 uClayScatter;\n${LIGHTS}`,
        )
        .replace("#include <color_fragment>", `#include <color_fragment>\n${MAP_BODY}`)
        .replace(
          "#include <normal_fragment_maps>",
          `#include <normal_fragment_maps>\n${NORMAL_BODY}`,
        ),
    );
    s.patch?.apply(shader);
  };
  m.customProgramCacheKey = () =>
    `clay2:${s.objectSpace ? "o" : "w"}${s.reliefMap && s.map ? "r" : ""}${wind ? `w${wind.axis}` : ""}${s.patch ? `:${s.patch.key}` : ""}`;
  return m as M & { userData: { clay: ClayUniforms } };
}

/**
 * The shadow-pass material for casters whose silhouette is not their
 * geometry: wind-bent blades and leaves (the shadow bends with them) and
 * cut-out leaves and petals (the shadow has their outline, not a square).
 */
export function casterMaterial(o: {
  wind?: WindSettings | null;
  map?: THREE.Texture | null;
  alphaTest?: number;
}): THREE.MeshDepthMaterial {
  const m = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
    map: o.map ?? null,
    alphaTest: o.alphaTest ?? 0,
  });
  const wind = o.wind ?? null;
  if (!wind) return m;
  const windUniform = { value: new THREE.Vector3(wind.length, wind.amount, 0) };
  m.defines = {
    CLAY_WIND: "",
    CLAY_WIND_AXIS: wind.axis === "y" ? "transformed.y" : "transformed.z",
  };
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uWind = WIND;
    shader.uniforms.uClayWind = windUniform;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>\nuniform vec4 uWind;\nuniform vec3 uClayWind;`,
      )
      .replace("#include <begin_vertex>", `#include <begin_vertex>\n${WIND_BODY}`);
  };
  m.customProgramCacheKey = () => `clay-caster-wind-${wind.axis}${o.map ? "-cut" : ""}`;
  return m;
}

export class ClayLibrary {
  private cache = new Map<string, ClayMaterial>();
  private extras: THREE.Material[] = [];

  constructor(readonly detail: THREE.Texture) {}

  /** A clay material, shared by everything asking for the same `key`. */
  get(key: string, s: ClaySettings): ClayMaterial {
    let m = this.cache.get(key);
    if (m) return m;
    const mat = new THREE.MeshStandardMaterial({
      color: s.color,
      roughness: s.roughness ?? 0.62,
      metalness: s.metalness ?? 0,
      vertexColors: s.vertexColors ?? false,
      side: s.side ?? THREE.FrontSide,
      map: s.map ?? null,
      alphaTest: s.alphaTest ?? 0,
      emissive: s.emissive ?? 0x000000,
      emissiveIntensity: s.emissiveIntensity ?? 1,
      envMapIntensity: s.envMapIntensity ?? 1,
    });
    mat.name = key;
    m = clayify(mat, { detail: this.detail }, s);
    this.cache.set(key, m);
    return m;
  }

  /** Registers a non-clay material for disposal with the rest. */
  keep<M extends THREE.Material>(m: M): M {
    this.extras.push(m);
    return m;
  }

  /** Every clay material, for frame-by-frame boil. */
  each(f: (m: ClayMaterial) => void) {
    for (const m of this.cache.values()) f(m);
  }

  dispose() {
    for (const m of this.cache.values()) m.dispose();
    for (const m of this.extras) m.dispose();
    this.cache.clear();
    this.extras = [];
  }
}
