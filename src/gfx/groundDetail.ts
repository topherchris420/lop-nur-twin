import * as THREE from "three";
import { getGroundDetailMaps, type GroundDetailKind } from "@/lib/textures";
import { getQualityProfile } from "@/lib/quality";
import { SITE_SEED } from "@/lib/noise";
import type { QualityTier } from "@/lib/store";

/**
 * Close-range ground look development.
 *
 * The terrain and pavement maps in `src/lib/textures.ts` were authored for the
 * twin's aerial camera: they carry colour and wear at tens of metres and
 * nothing below that. That is exactly the wrong spectrum for `/play`, where
 * the bottom half of every frame is ground between one and five metres away
 * and the large-scale maps have long since resolved to a flat wash.
 *
 * This module patches a `MeshStandardMaterial` with the missing octaves:
 *
 *  - a **detail normal** sampled twice from one tiling map (a ~1 m grain layer
 *    and a ~10 m macro layer, axis-swapped so the two do not beat against each
 *    other) and folded into the shading normal;
 *  - **roughness variation** — the single most valuable term here. A constant
 *    0.96 over an entire apron is what makes concrete read as plastic. The
 *    packed map's green channel is a signed surface-state field: below 0.5 is
 *    traffic-polished and compacted, above it is loose and dusty, and the two
 *    move albedo in opposite directions as well as roughness;
 *  - **aggregate grain** in the albedo, correlated with the relief so grains
 *    that catch the light also sit paler;
 *  - **slab joints** on a real 6 m pour grid, in the strip's own frame so they
 *    never run diagonally, with a groove that tilts the shading normal;
 *  - **cracks** gated by a per-slab hash so only some slabs are cracked, which
 *    decorrelates the crack tile from the joint grid;
 *  - **traffic polish** stretched along the direction the strip is driven;
 *  - a **dust overlay** that settles in the loose patches and in the joints.
 *
 * Everything is fenced behind a distance fade. Past `fadeEnd` the surface is
 * bit-for-bit what it was before, which is what keeps the aerial twin route
 * from regressing and stops the metre-scale layers from shimmering when a tile
 * falls below a pixel. Analytic terms (joints) additionally fade on `fwidth`.
 *
 * Patching happens through `onBeforeCompile`, per the rules in
 * `.claude/skills/blender-hardsurface/SKILL.md`, so shadows, fog, the env map,
 * tone mapping and the logarithmic depth buffer all keep working — the vertex
 * injection sits immediately before `<project_vertex>` and leaves
 * `<logdepthbuf_vertex>` untouched.
 */

export interface GroundDetailOptions {
  /** Tiling tangent-space detail normal. */
  normalMap: THREE.Texture;
  /** Packed R=grain, G=surface state, B=cracks. Must be linear. */
  surfaceMap: THREE.Texture;
  /** Metres covered by one tile of the fine layer. 0.8-1.6 reads best. */
  scale?: number;
  /** Fine-to-macro scale ratio. Keep it irrational-ish to avoid beating. */
  macro?: number;
  /** Fine / macro normal perturbation strength. */
  normalStrength?: [number, number];
  /** Peak-to-peak roughness swing from the surface-state channel. */
  roughness?: number;
  /** Peak-to-peak albedo grain. */
  grain?: number;
  /** Metres at which the micro layer starts and finishes fading out. */
  fade?: [number, number];
  /** Slab joint spacing in metres. 0 disables joints (and cracks). */
  jointSpacing?: number;
  /** Joint width in metres. */
  jointWidth?: number;
  /** Albedo multiplier inside a joint. */
  jointDarken?: number;
  /** Crack visibility, 0-1. Needs `jointSpacing` for the per-slab gate. */
  cracks?: number;
  /** Traffic-polish strength along `axis`. 0 disables the extra tap. */
  tracks?: number;
  /** Dust accumulation in the loose patches and joints. */
  dust?: number;
  /** Colour the dust settles toward. */
  dustColor?: THREE.ColorRepresentation;
  /**
   * World-space XZ direction the surface's local "along" axis points, and the
   * world XZ point the joint grid is anchored to. Slab joints and tyre tracks
   * are both built in this frame.
   */
  axis?: [number, number];
  origin?: [number, number];
  /**
   * Reads a `gdCompact` float attribute (1 where the ground has been graded
   * flat by pavement, 0 in open desert) and calms the grain there — a bladed
   * apron surround is not the same surface as untouched lakebed.
   */
  compactAttribute?: boolean;
}

interface Resolved {
  scale: number;
  macro: number;
  normalStrength: [number, number];
  roughness: number;
  grain: number;
  fade: [number, number];
  jointSpacing: number;
  jointWidth: number;
  jointDarken: number;
  cracks: number;
  tracks: number;
  dust: number;
  dustColor: THREE.Color;
  axis: [number, number];
  origin: [number, number];
  compactAttribute: boolean;
}

const DEFAULTS: Omit<Resolved, "dustColor"> & { dustColor: string } = {
  scale: 1.15,
  macro: 9.3,
  normalStrength: [0.85, 0.4],
  roughness: 0.3,
  grain: 0.22,
  fade: [26, 150],
  jointSpacing: 0,
  jointWidth: 0.035,
  jointDarken: 0.7,
  cracks: 0,
  tracks: 0,
  dust: 0.25,
  dustColor: "#cabc98",
  axis: [1, 0],
  origin: [0, 0],
  compactAttribute: false,
};

const HEAD = /* glsl */ `
uniform sampler2D gdNormalMap;
uniform sampler2D gdSurfaceMap;
uniform vec2 gdFade;            // micro fade start / end, metres
uniform float gdScale;          // metres per fine tile
uniform float gdMacro;          // macro / fine scale ratio
uniform vec2 gdNormalStrength;  // fine, macro
uniform float gdRoughness;
uniform float gdGrain;
uniform vec4 gdBasis;           // axis.x, axis.z, origin.x, origin.z
uniform vec3 gdJoint;           // spacing m, width m, albedo darken
uniform float gdCracks;
uniform float gdTracks;
uniform float gdDust;
uniform vec3 gdDustColor;

varying vec3 vGdWorld;
#ifdef GD_COMPACT
varying float vGdCompact;
#endif

float gdHash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
`;

/**
 * Runs after `<metalnessmap_fragment>`: `diffuseColor` already carries the map
 * and the vertex colours, and `roughnessFactor` / `metalnessFactor` exist and
 * are still untouched by lighting. The shading normal is not final yet, so the
 * perturbation is accumulated into `gdBump` (world space) and applied later.
 */
const SURFACE = /* glsl */ `
{
  float gdDist = length(vGdWorld - cameraPosition);
  // micro layer: grain, aggregate, fine roughness
  float gdAmt = 1.0 - smoothstep(gdFade.x, gdFade.y, gdDist);
  // macro layer: joints, wear patches, dust. Reaches further because metre-
  // scale features stay legible long after millimetre ones stop resolving,
  // but still ends far below any altitude the aerial route flies at.
  float gdMacroAmt = 1.0 - smoothstep(gdFade.y, gdFade.y * 2.1, gdDist);

  if (gdMacroAmt > 0.002) {
    vec2 gdUv = vGdWorld.xz / gdScale;
    // Both maps are *centred* on neutral — 0.5 grey, (0.5, 0.5, 1) normal — so
    // their mip chain converges to a no-op and minification cannot alias on
    // its own. The only guard needed is against a footprint so large the taps
    // are pure waste, and it has to be measured on the geometric mean of the
    // derivatives, not their max: at the grazing angles a ground plane spends
    // its life at, one derivative is an order of magnitude bigger than the
    // other and 16x anisotropy is resolving it fine. Gating on the max of the
    // two is what makes a detail layer vanish exactly where it is needed most.
    vec2 gdFw = fwidth(gdUv);
    float gdFoot = sqrt(max(gdFw.x * gdFw.y, 1e-8));
    float gdFine = gdAmt * (1.0 - smoothstep(1.6, 4.0, gdFoot));

    // axis-swapped and offset so the macro tap does not sit on top of the fine
    // one and double its contrast
    vec2 gdUvM = vGdWorld.zx / (gdScale * gdMacro) + 0.371;

    vec4 gdSf = texture2D(gdSurfaceMap, gdUv);
    vec4 gdSm = texture2D(gdSurfaceMap, gdUvM);

    float gdCalm = 1.0;
    #ifdef GD_COMPACT
      // bladed, compacted ground: the pebble relief is gone, the dust is not
      gdCalm = 1.0 - vGdCompact * 0.55;
    #endif

    // --- shading normal ------------------------------------------------
    if (gdFine > 0.0) {
      vec2 gdNf = texture2D(gdNormalMap, gdUv).xy * 2.0 - 1.0;
      gdBump.xz += gdNf * gdNormalStrength.x * gdFine * gdCalm;
    }
    if (gdMacroAmt > 0.0) {
      vec2 gdNm = texture2D(gdNormalMap, gdUvM).xy * 2.0 - 1.0;
      gdBump.xz += gdNm.yx * gdNormalStrength.y * gdMacroAmt * gdCalm;
    }

    // --- albedo grain ---------------------------------------------------
    // the macro tap only breaks up the flatness; run it well under the fine
    // one or the two beat together into blotch
    float gdGrainF = (gdSf.r - 0.5) * gdFine * gdCalm + (gdSm.r - 0.5) * gdMacroAmt * 0.3;
    diffuseColor.rgb *= 1.0 + gdGrainF * gdGrain;

    // --- surface state: polished <-> loose -------------------------------
    // -1 traffic-polished / compacted, +1 loose and powdered. This is the term
    // that matters: a single roughness value across an apron is exactly what
    // makes concrete read as plastic, and the swing has to be big enough to
    // change the specular response, not just nudge it.
    float gdPatch = (gdSm.g - 0.5) * 2.0 * gdMacroAmt;
    float gdMicro = (gdSf.g - 0.5) * 2.0 * gdFine;
    // the micro term is deliberately the smaller of the two: per-grain
    // roughness swings make the specular sparkle rather than vary, which reads
    // as noise. Roughness wants to move at the patch scale.
    roughnessFactor = clamp(
      roughnessFactor + (gdPatch * 0.78 + gdMicro * 0.15) * gdRoughness, 0.08, 1.0);
    // a polished patch is darker and slightly more specular; a loose one is
    // paler and completely matte. Moving albedo and roughness together is what
    // separates "damp/worn" from "someone lowered a slider".
    float gdPolish = max(0.0, -gdPatch);
    float gdLoose = max(0.0, gdPatch);
    diffuseColor.rgb *= 1.0 - gdPolish * 0.13;
    diffuseColor.rgb = mix(diffuseColor.rgb, gdDustColor, gdLoose * gdDust);

    #ifdef GD_JOINTS
    {
      vec2 gdRel = vGdWorld.xz - gdBasis.zw;
      vec2 gdLocal = vec2(dot(gdRel, gdBasis.xy), dot(gdRel, vec2(-gdBasis.y, gdBasis.x)));
      vec2 gdCellF = gdLocal / gdJoint.x;
      vec2 gdCellFw = max(fwidth(gdCellF), vec2(1e-5));
      vec2 gdEdge = abs(fract(gdCellF - 0.5) - 0.5);
      vec2 gdHalf = vec2(gdJoint.y * 0.5 / gdJoint.x);
      vec2 gdLine = 1.0 - smoothstep(gdHalf, gdHalf + gdCellFw * 1.4, gdEdge);
      // a joint narrower than a pixel is aliasing, not detail
      gdLine *= (1.0 - smoothstep(0.1, 0.32, max(gdCellFw.x, gdCellFw.y))) * gdMacroAmt;
      float gdSeam = max(gdLine.x, gdLine.y);

      diffuseColor.rgb *= mix(1.0, gdJoint.z, gdSeam);
      roughnessFactor = clamp(roughnessFactor + gdSeam * 0.16, 0.06, 1.0);
      // joints are where the wind puts the sand
      diffuseColor.rgb = mix(diffuseColor.rgb, gdDustColor, gdSeam * gdDust * 0.55);

      // groove relief, in the strip's frame then rotated back to world XZ
      vec2 gdSlope = sign(fract(gdCellF - 0.5) - 0.5) * gdLine;
      gdBump.xz -= (gdBasis.xy * gdSlope.x + vec2(-gdBasis.y, gdBasis.x) * gdSlope.y) * 0.5;

      // per-slab PBR drift: a pour is never uniform across a day's work
      vec2 gdCell = floor(gdCellF);
      float gdSlab = gdHash21(gdCell + 13.0);
      roughnessFactor = clamp(roughnessFactor + (gdSlab - 0.5) * 0.09 * gdMacroAmt, 0.06, 1.0);
      diffuseColor.rgb *= 1.0 + (gdHash21(gdCell * 1.31 - 7.0) - 0.5) * 0.05 * gdMacroAmt;

      if (gdCracks > 0.0) {
        // gate on the slab hash so only a minority of slabs are cracked; the
        // 6 m slab grid and the ~11 m crack tile share no period, so the crack
        // layer never reads as a repeat
        float gdCracked = step(0.66, gdSlab);
        float gdCrack = smoothstep(0.35, 0.85, gdSm.b) * gdCracked * gdCracks * gdMacroAmt;
        // cracks stop at the joints, the way slabs really fail
        gdCrack *= 1.0 - gdSeam;
        diffuseColor.rgb *= 1.0 - gdCrack * 0.42;
        roughnessFactor = clamp(roughnessFactor + gdCrack * 0.2, 0.06, 1.0);
      }
    }
    #endif

    #ifdef GD_TRACKS
    {
      vec2 gdRelT = vGdWorld.xz - gdBasis.zw;
      // stretched hard along the direction of travel: one tap, but the 14:1
      // aspect turns the same map into long polished lanes
      vec2 gdTrackUv = vec2(
        dot(gdRelT, vec2(-gdBasis.y, gdBasis.x)) / 3.6,
        dot(gdRelT, gdBasis.xy) / 52.0);
      float gdWear = smoothstep(0.44, 0.8, texture2D(gdSurfaceMap, gdTrackUv).g)
                   * gdTracks * gdMacroAmt;
      roughnessFactor = clamp(roughnessFactor - gdWear * 0.28, 0.06, 1.0);
      diffuseColor.rgb *= 1.0 - gdWear * 0.11;
    }
    #endif
  }
}
`;

/**
 * Runs after `<normal_fragment_maps>`, where `normal` is final and in view
 * space. `gdBump` is a world-space tilt: the ground here is within a few
 * degrees of horizontal everywhere, so the world XZ plane is a good enough
 * tangent frame and needs no per-vertex tangents.
 */
const NORMAL = /* glsl */ `
if (dot(gdBump, gdBump) > 1e-8) {
  normal = normalize(normal + mat3(viewMatrix) * gdBump);
}
`;

const patched = new WeakSet<THREE.Material>();

/**
 * Injects the close-range ground pipeline into a standard material.
 *
 * Idempotent per material, so a `useMemo` that React runs twice is harmless.
 * Returns the same instance so it composes inline.
 */
export function applyGroundDetail<M extends THREE.MeshStandardMaterial>(
  material: M,
  options: GroundDetailOptions,
): M {
  if (patched.has(material)) return material;
  patched.add(material);

  const o: Resolved = {
    ...DEFAULTS,
    ...options,
    dustColor: new THREE.Color(options.dustColor ?? DEFAULTS.dustColor),
  };

  const axisLen = Math.hypot(o.axis[0], o.axis[1]) || 1;
  const ax = o.axis[0] / axisLen;
  const az = o.axis[1] / axisLen;

  const joints = o.jointSpacing > 0;
  const tracks = o.tracks > 0;

  const uniforms: Record<string, THREE.IUniform> = {
    gdNormalMap: { value: options.normalMap },
    gdSurfaceMap: { value: options.surfaceMap },
    gdFade: { value: new THREE.Vector2(o.fade[0], o.fade[1]) },
    gdScale: { value: o.scale },
    gdMacro: { value: o.macro },
    gdNormalStrength: {
      value: new THREE.Vector2(o.normalStrength[0], o.normalStrength[1]),
    },
    gdRoughness: { value: o.roughness },
    gdGrain: { value: o.grain },
    gdBasis: { value: new THREE.Vector4(ax, az, o.origin[0], o.origin[1]) },
    gdJoint: { value: new THREE.Vector3(o.jointSpacing || 1, o.jointWidth, o.jointDarken) },
    gdCracks: { value: o.cracks },
    gdTracks: { value: o.tracks },
    gdDust: { value: o.dust },
    gdDustColor: { value: o.dustColor },
  };

  material.userData.groundDetail = uniforms;

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vGdWorld;
#ifdef GD_COMPACT
attribute float gdCompact;
varying float vGdCompact;
#endif`,
      )
      // `transformed` is final here and the logdepth / clipping chunks that
      // follow `<project_vertex>` are left exactly where three put them
      .replace(
        "#include <project_vertex>",
        `vGdWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
#ifdef GD_COMPACT
vGdCompact = gdCompact;
#endif
#include <project_vertex>`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${HEAD}`)
      .replace("void main() {", `void main() {\n  vec3 gdBump = vec3(0.0);`)
      .replace(
        "#include <metalnessmap_fragment>",
        `#include <metalnessmap_fragment>\n${SURFACE}`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>\n${NORMAL}`,
      );
  };

  // the injections are switched by #defines, so they have to be part of the key
  const cacheKey = `gd:${joints ? 1 : 0}${tracks ? 1 : 0}${o.compactAttribute ? 1 : 0}`;
  material.customProgramCacheKey = () => cacheKey;
  material.defines = {
    ...material.defines,
    ...(joints ? { GD_JOINTS: "" } : {}),
    ...(tracks ? { GD_TRACKS: "" } : {}),
    ...(o.compactAttribute ? { GD_COMPACT: "" } : {}),
  };

  material.needsUpdate = true;
  return material;
}

/** Ready-made parameter sets for the ground families the site actually has. */
export const GROUND_DETAIL_PRESETS = {
  /**
   * Airfield PCC. Contraction joints go in on a 6.25 m grid (the canvas maps
   * already carry the 25 m construction joints, which is the real hierarchy),
   * traffic polishes lanes into it and wind-blown sand fills the grooves.
   */
  pavement: {
    scale: 1.05,
    macro: 10.7,
    normalStrength: [1.0, 0.42] as [number, number],
    roughness: 0.48,
    grain: 0.21,
    jointSpacing: 6.25,
    jointWidth: 0.045,
    jointDarken: 0.6,
    cracks: 0.8,
    tracks: 0.6,
    dust: 0.24,
    dustColor: "#c9bb96",
  },
  /**
   * Open lakebed: pebbles, crust, no joints and no directional wear. The macro
   * normal carries more here than on concrete — the terrain mesh is 13 m per
   * quad even on the top tier, so metre-scale form has nowhere else to come
   * from.
   */
  desert: {
    scale: 1.35,
    macro: 8.6,
    normalStrength: [1.15, 0.62] as [number, number],
    roughness: 0.34,
    grain: 0.3,
    dust: 0.18,
    dustColor: "#cec19d",
  },
  /** Graded dirt strips and haul roads: coarser, looser, no joints. */
  dirt: {
    scale: 1.5,
    macro: 7.4,
    normalStrength: [1.05, 0.6] as [number, number],
    roughness: 0.3,
    grain: 0.28,
    tracks: 0.45,
    dust: 0.22,
    dustColor: "#cbbc94",
  },
} satisfies Record<string, Omit<GroundDetailOptions, "normalMap" | "surfaceMap">>;

export type GroundDetailFamily = keyof typeof GROUND_DETAIL_PRESETS;

/** Which canvas detail set each family samples. */
const FAMILY_MAPS: Record<GroundDetailFamily, GroundDetailKind> = {
  pavement: "concrete",
  desert: "desert",
  dirt: "desert",
};

/**
 * Resolves a preset against the active quality tier, building (and caching)
 * the detail maps on first use. Returns `null` on the tier that has ground
 * detail switched off, in which case the caller simply does not patch.
 */
export function groundDetailFor(
  tier: QualityTier,
  family: GroundDetailFamily,
  overrides: Partial<Omit<GroundDetailOptions, "normalMap" | "surfaceMap">> = {},
): GroundDetailOptions | null {
  const profile = getQualityProfile(tier);
  if (profile.groundDetailSize === 0) return null;

  const kind = FAMILY_MAPS[family];
  const maps = getGroundDetailMaps(
    kind,
    SITE_SEED + (kind === "concrete" ? 610 : 620),
    profile.groundDetailSize,
  );
  const preset = GROUND_DETAIL_PRESETS[family];
  const range = profile.groundDetailRange;

  return {
    ...preset,
    // cracks and directional polish are the two extra taps; they come off on
    // the tiers that cannot afford them
    ...(profile.groundDetailRich ? {} : { cracks: 0, tracks: 0 }),
    fade: [range * 0.2, range],
    ...overrides,
    normalMap: maps.normal,
    surfaceMap: maps.surface,
  };
}

/** `applyGroundDetail` with a tier-resolved preset; a no-op when disabled. */
export function applyGroundDetailPreset<M extends THREE.MeshStandardMaterial>(
  material: M,
  tier: QualityTier,
  family: GroundDetailFamily,
  overrides: Partial<Omit<GroundDetailOptions, "normalMap" | "surfaceMap">> = {},
): M {
  const options = groundDetailFor(tier, family, overrides);
  if (options) applyGroundDetail(material, options);
  return material;
}
