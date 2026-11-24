import * as THREE from "three";
import { getGroundDetailMaps, type GroundDetailKind } from "@/lib/textures";
import { getQualityProfile } from "@/lib/quality";
import { SITE_SEED } from "@/lib/noise";
import {
  APRONS,
  RUNWAYS,
  STREETS,
  STRUCTURES,
  TAXIWAYS,
  segmentCenter,
  segmentLength,
} from "@/lib/layout";
import type { QualityTier } from "@/lib/store";
import { sunState } from "@/lib/sunState";
import { patchShader } from "./shaderPatch";

/**
 * Close-range ground look development.
 *
 * The terrain and pavement maps in `src/lib/textures.ts` were authored for the
 * twin's aerial camera: they carry colour and wear at tens of metres and
 * nothing below that. That is exactly the wrong spectrum for `/play`, where
 * the bottom half of every frame is ground between one and five metres away
 * and the large-scale maps have long since resolved to a flat wash.
 *
 * This module patches a `MeshStandardMaterial` with the missing octaves. Every
 * tier with ground detail gets the texture-driven layer:
 *
 *  - a **detail normal** sampled twice from one tiling map (a ~1 m grain layer
 *    and a ~10 m macro layer, axis-swapped so the two do not beat against each
 *    other) and folded into the shading normal;
 *  - **roughness variation** from a signed surface-state field: below 0.5 is
 *    traffic-polished and compacted, above it is loose and dusty, and the two
 *    move albedo in opposite directions as well as roughness;
 *  - **aggregate grain** in the albedo, correlated with the relief;
 *  - **slab joints** on a real 5 m pour grid, in the strip's own frame so
 *    they never run diagonally, with a groove that tilts the shading normal;
 *  - **traffic polish** and a **dust overlay**, and contact darkening at the
 *    feet of the largest structures.
 *
 * The top tier adds an analytic layer (`GD_PROC`) on the surfaces that fill
 * the bottom half of a first-person frame, so the ground carries a scale
 * ladder from millimetres to a hundred metres instead of a soft wash:
 *
 *  - **lakebed**: polygonal desiccation cracks (two Voronoi octaves, 0.3 to
 *    1.4 m plates) with dark fissures and raised, curled, salt-rimmed lips;
 *    wind ripples in drifted sand; desert-pavement pebbles with directional
 *    contact shadows; vehicle ruts with tread; and 4-100 m colour regions
 *    (salt bloom, damp silt, drift sand) so nothing reads as a tile. Bladed
 *    ground inside the compound swaps the playa crust for compacted grit,
 *    dense ruts and cracked dried-puddle patches;
 *  - **pavement**: joint sealant (intact, failed and sand-filled, or
 *    overbanded), spalled joint edges, mid-slab and corner cracks, patch
 *    repairs, replaced slabs, oil and rubber stains, chipped paint, and a
 *    broken, sand-drifted edge wherever the pavement meets bare ground;
 *  - **the join**: broken concrete and drifted grit scattered on the ground
 *    just off every pavement edge, and a dark contact line under the slab lip.
 *
 * Everything is fenced behind a distance fade. The micro amount `gdAmt` is 0
 * at and beyond `fadeEnd` (`gdFade.y`), and the metre-scale terms end at
 * 2.1×fadeEnd, far below the altitude the aerial camera flies at, so the twin
 * route sees exactly the aerial-authored surface. Every analytic line is
 * filtered against its own pixel footprint (`fwidth`) and fades to its mean
 * instead of shimmering once it is thinner than about a pixel.
 *
 * Patching happens through `onBeforeCompile`, per the rules in
 * `.claude/skills/blender-hardsurface/SKILL.md`, so shadows, fog, the env map,
 * tone mapping and the logarithmic depth buffer all keep working — the vertex
 * injection sits immediately before `<project_vertex>` and leaves
 * `<logdepthbuf_vertex>` untouched.
 */

/** The ground families the site actually has. */
export type GroundDetailFamily = "pavement" | "desert" | "dirt";

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
  /** Which procedural stack `procedural` turns on. */
  family?: GroundDetailFamily;
  /**
   * The analytic layer (see the module comment). Several hundred ALU per
   * fragment on the surface that fills half the frame, so top tier only.
   */
  procedural?: boolean;
  /**
   * Width in metres of a strip mesh whose `uv.x` runs across it. Turns on a
   * ragged, blended long edge for graded dirt strips. 0 leaves edges alone.
   */
  edgeWidth?: number;
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
  family: GroundDetailFamily;
  procedural: boolean;
  edgeWidth: number;
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
  family: "desert",
  procedural: false,
  edgeWidth: 0,
};

/* ------------------------------------------------------------------ */
/* Pavement footprints                                                 */
/* ------------------------------------------------------------------ */

/**
 * The circular concrete fillets that soften the runway T-junction and the
 * apron throat. `Pavements.tsx` draws them; the ground shader needs the same
 * circles to know where concrete ends.
 */
export const PAVEMENT_FILLETS = (() => {
  const t0 = TAXIWAYS[0];
  const t1 = TAXIWAYS[1];
  const out: Array<{
    id: string;
    point: [number, number];
    radius: number;
    segment: (typeof TAXIWAYS)[number];
  }> = [];
  if (t0) out.push({ id: "runway-fillet", point: t0.from, radius: 31, segment: t0 });
  if (t0) out.push({ id: "taxiway-elbow", point: t0.to, radius: 27, segment: t0 });
  if (t1) out.push({ id: "apron-fillet", point: t1.to, radius: 30, segment: t1 });
  return out;
})();

/**
 * Every concrete surface as an oriented box or a circle, in the local frame.
 * `A` is centre XZ and half-extents (or radius in `z`); `B.xy` is the unit
 * direction of the shape's local x axis in world XZ, `B.z` is 1 for a circle.
 * The union of these is the edge both sides of the join are shaded against:
 * where a taxiway runs into an apron the union has no edge, so neither gets a
 * broken lip or a sand drift at a junction that is not there.
 */
function buildPavementShapes(): { a: THREE.Vector4[]; b: THREE.Vector4[] } {
  const a: THREE.Vector4[] = [];
  const b: THREE.Vector4[] = [];
  for (const seg of [...RUNWAYS, ...TAXIWAYS, ...STREETS]) {
    const [cx, cz] = segmentCenter(seg);
    const len = segmentLength(seg) || 1;
    const ux = (seg.to[0] - seg.from[0]) / len;
    const uz = (seg.to[1] - seg.from[1]) / len;
    a.push(new THREE.Vector4(cx, cz, len / 2, seg.width / 2));
    b.push(new THREE.Vector4(ux, uz, 0, 0));
  }
  // `apronCorners` in layout.ts: local x runs along (cos r, sin r) for a
  // plane laid with euler [-π/2, 0, -r], matching the terrain flattening.
  for (const apron of APRONS) {
    a.push(
      new THREE.Vector4(
        apron.center[0],
        apron.center[1],
        apron.size[0] / 2,
        apron.size[1] / 2,
      ),
    );
    b.push(new THREE.Vector4(Math.cos(apron.rotation), Math.sin(apron.rotation), 0, 0));
  }
  for (const fillet of PAVEMENT_FILLETS) {
    a.push(new THREE.Vector4(fillet.point[0], fillet.point[1], fillet.radius, 0));
    b.push(new THREE.Vector4(1, 0, 1, 0));
  }
  return { a, b };
}

const PAVE = buildPavementShapes();
const PAVE_N = PAVE.a.length;

/* ------------------------------------------------------------------ */
/* GLSL                                                                */
/* ------------------------------------------------------------------ */

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
uniform vec4 gdBoxA[48];
uniform vec4 gdBoxB[48];

varying vec3 vGdWorld;
#ifdef GD_COMPACT
varying float vGdCompact;
#endif

float gdHash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

#ifdef GD_PROC
uniform vec3 gdSun;             // world, toward the sun
uniform vec4 gdPaveA[${PAVE_N}];
uniform vec4 gdPaveB[${PAVE_N}];
uniform float gdEdgeW;
#ifdef GD_EDGE_UV
varying vec2 vGdUv;
#endif

// Arithmetic hashes: no sin(), stable on the integer cell ids they are fed.
float gdH12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 gdH22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float gdVN(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = gdH12(i);
  float b = gdH12(i + vec2(1.0, 0.0));
  float c = gdH12(i + vec2(0.0, 1.0));
  float d = gdH12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
// Value noise with its analytic gradient (xy), for relief that has to bend
// the normal without a second tap.
vec3 gdVNd(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  vec2 du = 6.0 * f * (1.0 - f);
  float a = gdH12(i);
  float b = gdH12(i + vec2(1.0, 0.0));
  float c = gdH12(i + vec2(0.0, 1.0));
  float d = gdH12(i + vec2(1.0, 1.0));
  float k = a - b - c + d;
  return vec3(a + (b - a) * u.x + (c - a) * u.y + k * u.x * u.y,
              du * (vec2(b - a, c - a) + k * u.yx));
}
// Ridged salt relief: sharp crests, soft hollows. Returns height in [0,1]
// and its gradient per unit of p.
vec3 gdRidge(vec2 p) {
  vec3 n = gdVNd(p);
  float s = 2.0 * n.x - 1.0;
  float r = 1.0 - abs(s);
  return vec3(r * r, 2.0 * r * (-sign(s) * 2.0) * n.yz);
}

// Box-filtered coverage of the band |d| < w by a pixel of footprint fp, all
// in metres (d >= 0). Once the band is thinner than the pixel it keeps its
// mean (2w/fp) instead of flickering between full and nothing, so a field of
// cracks fades to its average tone rather than ending on a line.
float gdBand(float d, float w, float fp) {
  float aa = max(fp * 1.5, 1e-4);
  return clamp((min(d + 0.5 * aa, w) - max(d - 0.5 * aa, -w)) / aa, 0.0, 1.0);
}

// A crack network's coverage at any distance. gdBand alone keeps a line's
// integral only while the pixel is smaller than a cell; past that it would
// thin the network to nothing. Once the footprint reaches the cell size the
// coverage hands over to the network's expected value (two borders' worth of
// width per cell, about 4w / cell), so the field keeps its tone to the horizon.
float gdNet(float d, float w, float fp, float cell) {
  float mean = clamp(4.0 * w / cell, 0.0, 1.0);
  return mix(gdBand(d, w, fp), mean, smoothstep(0.2 * cell, 0.8 * cell, fp * 1.5));
}

// Distance to the nearest Voronoi border (cell units), the unit vector from
// that border into the cell, and hashes of the cell and of the border.
vec3 gdVoronoi(vec2 p, float jit, out vec2 dir) {
  vec2 n = floor(p);
  vec2 f = fract(p);
  vec2 mg = vec2(0.0);
  vec2 mr = vec2(0.0);
  float md = 8.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 r = g + 0.5 + (gdH22(n + g) - 0.5) * jit - f;
      float d = dot(r, r);
      if (d < md) { md = d; mr = r; mg = g; }
    }
  }
  md = 8.0;
  dir = vec2(0.0, 1.0);
  vec2 mb = mg;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = mg + vec2(float(i), float(j));
      vec2 r = g + 0.5 + (gdH22(n + g) - 0.5) * jit - f;
      vec2 dr = r - mr;
      float l2 = dot(dr, dr);
      if (l2 > 1e-6) {
        vec2 nd = dr * inversesqrt(l2);
        float d = dot(0.5 * (mr + r), nd);
        if (d < md) { md = d; dir = -nd; mb = g; }
      }
    }
  }
  vec2 ca = n + mg;
  vec2 cb = n + mb;
  return vec3(md, gdH12(ca + 0.37), gdH12(ca + cb + 17.0));
}

// Signed distance to the union of every concrete surface (negative inside).
float gdPaveSd(vec2 p) {
  float d = 1e5;
  for (int i = 0; i < ${PAVE_N}; i++) {
    vec4 a = gdPaveA[i];
    vec4 b = gdPaveB[i];
    vec2 c = p - a.xy;
    float s;
    if (b.z > 0.5) {
      s = length(c) - a.z;
    } else {
      vec2 l = vec2(b.x * c.x + b.y * c.y, b.x * c.y - b.y * c.x);
      vec2 q = abs(l) - a.zw;
      s = length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0);
    }
    d = min(d, s);
  }
  return d;
}

// One scatter layer: at most one stone per cell, kept inside the cell along
// with its shadow, so a single tap answers it. angular 0 is a rounded pebble,
// 1 a broken chunk with a flat tilted face. Returns the stone's coverage.
float gdScatter(vec2 p, float cell, float density, vec2 rr, float seed, float fp,
                float angular, vec3 tintA, vec3 tintB,
                inout vec3 col, inout vec3 bump, inout float rough) {
  vec2 q = p / cell;
  vec2 id = floor(q);
  float pick = gdH12(id + seed);
  if (pick >= density) return 0.0;
  vec2 h = gdH22(id * 1.31 + seed * 7.0);
  float r = mix(rr.x, rr.y, h.x * h.x);
  float vis = 1.0 - smoothstep(0.45, 1.1, fp / r);
  if (vis <= 0.0) return 0.0;
  float slack = max(0.0, 0.5 - 1.9 * r / cell);
  vec2 lp = (fract(q) - 0.5 - (h - 0.5) * 2.0 * slack) * cell;
  float an = h.y * 6.2832;
  vec2 cs = vec2(cos(an), sin(an));
  vec2 rp = vec2(cs.x * lp.x + cs.y * lp.y, cs.x * lp.y - cs.y * lp.x);
  vec2 ab = r * vec2(1.0, 0.55 + 0.4 * fract(pick * 13.7));
  vec2 e = rp / ab;
  float dR = length(e) - 1.0;
  vec2 qa = abs(e) - vec2(0.62);
  float dA = length(max(qa, vec2(0.0))) + min(max(qa.x, qa.y), 0.0) - 0.36;
  float sd = mix(dR, dA, angular);
  float aa = max(fp / r, 0.05);
  float body = 1.0 - smoothstep(-aa, aa, sd);
  // directional contact shadow, cast away from the sun
  float day = smoothstep(0.02, 0.18, gdSun.y);
  vec2 so = -gdSun.xz / max(gdSun.y, 0.3) * r * 0.5;
  float sh = 1.0 - smoothstep(-0.25, 0.45, length((lp - so) / (r * 1.02)) - 1.0);
  float ring = 1.0 - smoothstep(0.0, 0.55, sd);
  col *= 1.0 - vis * (1.0 - body) * (0.34 * sh * day + 0.12 * ring);
  float t = fract(pick * 31.7 + h.x * 5.3);
  vec3 ic = mix(tintA, tintB, t * t) * (0.78 + 0.44 * gdH12(id + 91.0));
  vec2 ew = e.x * cs + e.y * vec2(-cs.y, cs.x);
  vec2 facet = (gdH22(id + 47.0) - 0.5) * 0.8;
  float bevel = smoothstep(-0.35, 0.0, sd);
  vec2 tilt = mix(ew * 0.9, facet + ew * 0.7 * bevel, angular);
  col = mix(col, ic * (1.0 - 0.25 * bevel * angular), body * vis);
  bump.xz += tilt * body * vis;
  rough = mix(rough, mix(0.58, 0.92, angular), body * vis);
  return body * vis;
}

// One family of vehicle tracks: lanes of paired ruts that wander, start and
// stop. Returns the rut-floor amount; writes the berm amount.
float gdTrack(vec2 p, vec2 d, float spacing, float seed, float fp, float density,
              inout vec3 bump, inout vec3 col, out float berm) {
  berm = 0.0;
  vec2 nrm = vec2(-d.y, d.x);
  float a = dot(p, d);
  float c = dot(p, nrm) + 7.0 * sin(a / 61.0 + seed) + 2.2 * sin(a / 17.0 + seed * 2.3);
  float lane = floor(c / spacing);
  float lh = gdH12(vec2(lane, seed));
  if (lh > density) return 0.0;
  float run = smoothstep(0.36, 0.5, gdVN(vec2(a / 37.0, lane * 7.1 + seed)));
  if (run <= 0.0) return 0.0;
  float q = c - (lane + 0.5) * spacing - (fract(lh * 3.7) - 0.5) * spacing * 0.5;
  float gauge = 0.8 + 0.12 * fract(lh * 9.1);
  float s = abs(q) - gauge;          // + is away from the track's centreline
  float r = abs(s);
  float aa = max(fp, 0.004);
  float rutW = 0.13 + 0.04 * fract(lh * 5.3);
  float floorA = (1.0 - smoothstep(rutW - aa, rutW + 0.04 + aa, r)) * run;
  berm = smoothstep(rutW, rutW + 0.06, r) * (1.0 - smoothstep(rutW + 0.08, rutW + 0.22, r)) * run;
  float outward = sign(s) * sign(q);
  float wall = smoothstep(rutW - 0.05, rutW, r) * (1.0 - smoothstep(rutW + 0.02, rutW + 0.07, r));
  float bermOut = smoothstep(rutW + 0.1, rutW + 0.15, r) * (1.0 - smoothstep(rutW + 0.17, rutW + 0.24, r));
  float keep = 1.0 - smoothstep(0.05, 0.14, fp);
  bump.xz += nrm * outward * (-0.75 * wall + 0.35 * bermOut) * run * keep;
  // tyre tread: chevron blocks across the rut floor
  float tp = (a + abs(s) * 0.55) / 0.11;
  float tk = (1.0 - smoothstep(0.25, 0.55, fwidth(tp))) * floorA;
  float tw = sin(6.2832 * tp);
  bump.xz += d * cos(6.2832 * tp) * 0.45 * tk;
  col *= 1.0 + tw * 0.05 * tk;
  return floorA;
}
#endif
`;

/**
 * Pavement, top tier. Runs inside the joint block, so it has the strip frame
 * (`gdLocal`, `gdCellF`, `gdCell`, `gdSlab`) and the joint coverage.
 */
const PAVEMENT_PROC = /* glsl */ `
{
  vec2 gdP = vGdWorld.xz;
  vec2 gdAx = gdBasis.xy;
  vec2 gdPr = vec2(-gdBasis.y, gdBasis.x);
  float gdSp = gdJoint.x;
  float gdHW = gdJoint.y * 0.5;
  vec2 gdFrac = fract(gdCellF);
  vec2 gdSlabM = gdFrac * gdSp;                      // metres from the slab corner
  vec2 gdToJ = min(gdSlabM, gdSp - gdSlabM);         // metres to each axis' joint
  float gdJx = step(gdToJ.x, gdToJ.y);               // 1: nearest joint is transverse
  float gdJd = min(gdToJ.x, gdToJ.y);
  vec2 gdJid = gdJx > 0.5
    ? vec2(floor(gdCellF.x + 0.5), gdCell.y)
    : vec2(gdCell.x + 0.5, floor(gdCellF.y + 0.5) + 0.5);
  float gdJh = gdH12(gdJid * 1.37 + gdJx * 41.0);
  float gdAlong = gdJx > 0.5 ? gdLocal.y : gdLocal.x;
  vec2 gdToJointW = gdJx > 0.5
    ? gdAx * sign(gdFrac.x - 0.5)
    : gdPr * sign(gdFrac.y - 0.5);
  float gdSB = gdH12(gdCell * 1.71 + 3.3);
  float gdSC = gdH12(gdCell * 2.13 - 8.7);
  float gdRepl = step(gdSlab, 0.08);                 // a slab cut out and re-poured
  float gdWide = gdMacroAmt;

  // --- slab finish: re-poured slabs are smoother, cooler and darker --------
  diffuseColor.rgb *= mix(vec3(1.0), vec3(0.86, 0.87, 0.89), gdRepl * gdWide);
  roughnessFactor = clamp(roughnessFactor - gdRepl * 0.06 * gdWide, 0.45, 1.0);

  // --- concrete, not sand: neutral grey, per-slab tone, sun-bleached slabs ---
  // The canvas map and the dust overlay both lean warm; pull the slab back
  // to a neutral portland grey (paint keeps its own colour) so the pavement
  // never converges with the lakebed under a warm grade.
  {
    float gdPaintM = 0.0;
    #ifdef USE_MAP
      gdPaintM = smoothstep(0.6, 0.78, dot(sampledDiffuseColor.rgb, vec3(0.3333)));
    #endif
    float gdNotPaint = (1.0 - gdPaintM) * gdWide;
    float gdL = dot(diffuseColor.rgb, vec3(0.3, 0.5, 0.2));
    diffuseColor.rgb = mix(diffuseColor.rgb, gdL * vec3(0.985, 1.0, 1.025), 0.65 * gdNotPaint);
    float gdBleach = step(0.85, gdH12(gdCell * 3.7 + 1.1)) * (1.0 - gdRepl);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(gdL * 1.17), gdBleach * 0.75 * gdNotPaint);
    diffuseColor.rgb *= 1.0 + (gdSB - 0.5) * 0.08 * gdWide;
  }

  // --- broom finish: fine transverse striations, crisp underfoot -----------
  {
    float gdBr = gdLocal.x / 0.016 + gdVN(gdLocal * vec2(0.6, 4.0)) * 3.0;
    float gdBrK = (1.0 - smoothstep(0.25, 0.6, fwidth(gdBr))) * gdFine * (1.0 - gdRepl)
                * (0.35 + 0.65 * gdVN(gdLocal * vec2(0.45, 1.3) + gdSlab * 20.0));
    gdBump.xz += gdAx * cos(6.2832 * gdBr) * 0.16 * gdBrK;
    diffuseColor.rgb *= 1.0 + sin(6.2832 * gdBr) * 0.03 * gdBrK;
  }

  // --- joint sealant ---------------------------------------------------------
  // Intact sealant is a dark rubbery bead with a little sheen. On some joints
  // it has been overbanded wide; along others it has failed in runs and the
  // groove has filled with sand.
  float gdOver = step(0.8, gdJh) * (1.0 - gdRepl);
  float gdLost = smoothstep(0.52, 0.66, gdVN(vec2(gdAlong * 0.8, gdJh * 57.0))) * (1.0 - gdOver);
  float gdSealW = mix(gdHW * 0.8,
                      gdHW * (1.8 + 1.3 * gdVN(vec2(gdAlong * 2.7, gdJh * 13.0))),
                      gdOver);
  float gdSealC = gdBand(gdJd, gdSealW, gdFp) * gdWide;
  float gdSeal = gdSealC * (1.0 - gdLost);
  float gdSand = gdSealC * gdLost;
  vec3 gdSealCol = vec3(0.034, 0.032, 0.03) * (0.85 + 0.3 * gdSf.r);
  diffuseColor.rgb = mix(diffuseColor.rgb, gdSealCol, gdSeal * 0.92);
  roughnessFactor = mix(roughnessFactor, 0.5 + 0.12 * gdSf.g, gdSeal);
  diffuseColor.rgb = mix(diffuseColor.rgb, gdDustColor * (0.72 + 0.25 * gdSf.r), gdSand * 0.9);
  roughnessFactor = mix(roughnessFactor, 1.0, gdSand);
  // the overband bead stands slightly proud of the slab
  gdBump.xz -= gdToJointW * gdOver * gdBand(abs(gdJd - gdSealW * 0.8), gdSealW * 0.25, gdFp) * 0.35;

  // --- spalled joint edges ---------------------------------------------------
  float gdSpN = gdVN(vec2(gdAlong * 2.3, gdJh * 23.0 + 5.0));
  float gdSpW = max(0.0, gdSpN - 0.64) * 0.42 * (0.55 + 0.9 * gdVN(gdP * 11.0));
  float gdSpall = gdBand(gdJd, gdHW + gdSpW, gdFp) * step(0.004, gdSpW) * gdWide;
  float gdSpRim = gdBand(abs(gdJd - gdHW - gdSpW), 0.006, gdFp) * step(0.004, gdSpW) * gdWide;
  gdSpall *= 1.0 - gdSeal * 0.7;
  diffuseColor.rgb *= 1.0 - gdSpall * (0.34 - 0.2 * gdSf.r) - gdSpRim * 0.3;
  roughnessFactor = mix(roughnessFactor, 1.0, gdSpall);
  gdBump.xz += gdToJointW * gdSpall * 0.55;
  gdBump.xz += (gdSf.rg - 0.5) * 2.2 * gdSpall * gdFine;

  // --- mid-slab and corner cracks -------------------------------------------
  float gdCrackA = 0.0;
  if (gdSB > 0.6 && gdCracks > 0.0) {
    vec2 gdP0 = (0.22 + 0.56 * vec2(gdSC, fract(gdSC * 7.7))) * gdSp;
    float gdTh = gdSB * 19.0;
    vec2 gdCd = vec2(cos(gdTh), sin(gdTh));
    vec2 gdRs = gdSlabM - gdP0;
    float gdT = dot(gdRs, gdCd);
    float gdN = dot(gdRs, vec2(-gdCd.y, gdCd.x));
    gdN += (gdVN(vec2(gdT * 1.5, gdSB * 40.0)) - 0.5) * 0.55
         + (gdVN(vec2(gdT * 8.0, gdSC * 30.0)) - 0.5) * 0.07;
    float gdCw = 0.0022 + 0.0035 * gdVN(vec2(gdT * 0.6, 3.0));
    float gdSh = 0.016 * max(0.0, gdVN(vec2(gdT * 3.0, 9.0 + gdSB)) - 0.55);
    gdCrackA = max(gdCrackA, gdBand(abs(gdN), gdCw, gdFp));
    gdCrackA = max(gdCrackA, gdBand(abs(gdN), gdCw + gdSh, gdFp) * 0.45);
  }
  if (gdSC > 0.84 && gdCracks > 0.0) {
    // a corner break: the piece toward one corner has dropped a little
    vec2 gdCorner = step(0.5, vec2(fract(gdSB * 5.3), fract(gdSB * 9.1)));
    vec2 gdCl = abs(gdSlabM - gdCorner * gdSp);
    vec2 gdAb = vec2(0.5, 0.5) + 1.2 * vec2(fract(gdSC * 13.0), fract(gdSC * 29.0));
    float gdCn = (gdCl.x / gdAb.x + gdCl.y / gdAb.y - 1.0) * (gdAb.x * gdAb.y / length(gdAb));
    gdCn += (gdVN(gdSlabM * 6.0) - 0.5) * 0.05;
    gdCrackA = max(gdCrackA, gdBand(abs(gdCn), 0.003, gdFp));
    float gdPiece = 1.0 - smoothstep(-gdFp, gdFp, gdCn);
    diffuseColor.rgb *= 1.0 - gdPiece * 0.06 * gdWide;
  }
  gdCrackA *= gdWide * gdCracks * (1.0 - gdSeam);
  diffuseColor.rgb *= 1.0 - gdCrackA * 0.7;
  roughnessFactor = mix(roughnessFactor, 1.0, gdCrackA);

  // --- patch repairs -----------------------------------------------------------
  if (gdSB > 0.16 && gdSB < 0.29) {
    vec2 gdPc = (0.3 + 0.4 * vec2(gdSC, fract(gdSC * 3.3))) * gdSp;
    vec2 gdPh = vec2(0.35 + 1.15 * fract(gdSB * 11.0), 0.3 + 0.85 * fract(gdSC * 17.0));
    vec2 gdPq = abs(gdSlabM - gdPc) - gdPh;
    float gdPd = length(max(gdPq, vec2(0.0))) + min(max(gdPq.x, gdPq.y), 0.0);
    float gdIn = (1.0 - smoothstep(-gdFp, gdFp, gdPd)) * gdWide;
    float gdRim = gdBand(abs(gdPd), 0.01 + 0.012 * gdVN(gdSlabM * 7.0), gdFp) * gdWide;
    bool gdAsphalt = fract(gdSC * 29.0) > 0.45;
    vec3 gdPcol = gdAsphalt
      ? vec3(0.055, 0.052, 0.048) * (0.8 + 0.6 * gdSf.r)
      : diffuseColor.rgb * vec3(1.06, 1.07, 1.09);
    diffuseColor.rgb = mix(diffuseColor.rgb, gdPcol, gdIn);
    roughnessFactor = mix(roughnessFactor, gdAsphalt ? 0.82 : 0.78, gdIn);
    diffuseColor.rgb = mix(diffuseColor.rgb, gdSealCol, gdRim * 0.85);
    roughnessFactor = mix(roughnessFactor, 0.55, gdRim);
    gdBump.xz += (gdSf.rg - 0.5) * 0.9 * gdIn * gdFine;
  }

  // --- oil and rubber -----------------------------------------------------------
  {
    float gdCl = smoothstep(0.5, 0.78, gdVN(gdP / 19.0 + 3.7));
    float gdO = gdVN(gdP / 2.1 + 9.1) * 0.6 + gdVN(gdP / 0.62) * 0.28 + gdVN(gdP / 0.17) * 0.12;
    float gdOil = smoothstep(0.6, 0.74, gdO) * gdCl * gdWide;
    float gdHalo = smoothstep(0.5, 0.62, gdO) * gdCl * gdWide;
    diffuseColor.rgb *= 1.0 - gdHalo * 0.12;
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.32, 0.3, 0.28), gdOil * 0.75);
    roughnessFactor = mix(roughnessFactor, 0.47, gdOil * 0.85);
    // rubber laid down along the direction of travel
    float gdRb = gdVN(vec2(gdLocal.x / 7.5, gdLocal.y / 0.22) + gdSlab);
    float gdRub = smoothstep(0.68, 0.86, gdRb) * smoothstep(0.55, 0.8, gdVN(gdP / 31.0 - 5.0)) * gdWide;
    diffuseColor.rgb *= 1.0 - gdRub * 0.28;
    roughnessFactor = mix(roughnessFactor, 0.62, gdRub * 0.6);
  }

  // --- paint: worn thin, chipped to the concrete ---------------------------------
  #ifdef USE_MAP
  {
    float gdPaint = smoothstep(0.6, 0.78, dot(sampledDiffuseColor.rgb, vec3(0.3333)));
    float gdChip = smoothstep(0.58, 0.66, gdVN(gdP * 6.0) * 0.7 + gdVN(gdP * 23.0) * 0.3);
    float gdWear = smoothstep(0.35, 0.75, gdVN(gdP * 1.3));
    diffuseColor.rgb *= 1.0 - gdPaint * gdWide * (0.48 * gdChip + 0.16 * gdWear);
    roughnessFactor = mix(roughnessFactor, 0.62, gdPaint * (1.0 - gdChip) * 0.5 * gdWide);
  }
  #endif

  // --- the edge where concrete meets bare ground --------------------------------
  // Measured against the union of every concrete surface, so a junction
  // between two pavements has no edge.
  if (gdAmt > 0.0) {
    float gdE = -gdPaveSd(gdP);
    if (gdE < 3.2) {
      float gdBrk = gdVN(gdP * 1.6) * 0.62 + gdVN(gdP * 5.9) * 0.28 + gdVN(gdP * 21.0) * 0.1;
      float gdCut = max(0.0, gdBrk - 0.4) * 0.95 * gdAmt * (1.0 - smoothstep(0.02, 0.07, gdFp));
      float gdEc = gdE - gdCut;
      if (gdEc < 0.0) discard;
      float gdCr = 1.0 - smoothstep(0.0, 0.07 + 0.08 * gdBrk, gdEc);
      diffuseColor.rgb *= 1.0 - gdCr * 0.38 * gdAmt;
      roughnessFactor = mix(roughnessFactor, 1.0, gdCr * gdAmt);
      gdBump.xz += (gdSf.rg - 0.5) * 2.0 * gdCr * gdFine;
      // sand blown up onto the slab, deepest against the lip
      float gdReach = 0.3 + 2.4 * gdVN(gdP * 0.33 + 4.0);
      float gdDrift = 1.0 - smoothstep(0.0, gdReach, gdEc);
      gdDrift *= smoothstep(0.2, 0.55, gdVN(gdP * 1.9) * 0.55 + 0.45 * gdDrift + 0.1 * gdSf.g);
      diffuseColor.rgb = mix(diffuseColor.rgb, gdDustColor * (0.86 + 0.2 * gdSf.r), gdDrift * 0.88 * gdAmt);
      roughnessFactor = mix(roughnessFactor, 1.0, gdDrift * gdAmt);
      // grit and pebbles washed onto the concrete
      float gdNear = 1.0 - smoothstep(0.0, 1.6, gdEc);
      gdScatter(gdP, 0.21, 0.55 * gdNear * gdAmt, vec2(0.008, 0.03), 31.0, gdFp, 0.5,
                vec3(0.07, 0.055, 0.045), vec3(0.32, 0.29, 0.24),
                diffuseColor.rgb, gdBump, roughnessFactor);
    }
  }
}
`;

/**
 * Lakebed, bladed compound ground and graded dirt, top tier. Runs after the
 * texture layer; everything rides `gdMacroAmt` (or `gdAmt` for the fine
 * terms) so the aerial route never sees it.
 */
const GROUND_PROC = /* glsl */ `
{
  vec2 gdP = vGdWorld.xz;
  float gdW = gdMacroAmt;
  float gdC = 0.0;
  #ifdef GD_COMPACT
    gdC = vGdCompact;
  #endif
  #ifdef GD_FAM_DIRT
    gdC = 1.0;
  #endif

  // Salt, clay and grit are set relative to the local sediment, so they hold
  // their contrast whatever exposure and palette the surface sits under.
  float gdBaseL = max(dot(diffuseColor.rgb, vec3(0.3, 0.5, 0.2)), 0.02);
  float gdTintK = gdBaseL * 2.4;
  // At eye level the playa's large-scale structure has to reach the horizon;
  // from the aerial camera it must not appear at all.
  float gdWx = max(gdW, gdGroundCam);

  // --- colour regions, 4 to 600 m --------------------------------------------
  float gdM1 = gdVN(gdP / 43.0);
  float gdM2 = gdVN(gdP / 13.7 + 7.3);
  float gdM3 = gdVN(gdP / 97.0 - 3.1);
  float gdM4 = gdVN(gdP / 4.7 + 1.9);
  float gdM5 = gdVN(gdP / 151.0 + 11.3);
  float gdM6 = gdVN(gdP / 587.0 - 23.9);
  float gdSalt = smoothstep(0.6, 0.82, gdM1 * 0.65 + gdM4 * 0.35) * (1.0 - 0.6 * gdC);
  float gdDamp = smoothstep(0.6, 0.84, gdM3 * 0.7 + gdM2 * 0.3);
  float gdDriftR = smoothstep(0.56, 0.74, gdM4 * 0.5 + gdM2 * 0.5);
  // three macro octaves (40, 150, 600 m), each about +-10% luminance
  diffuseColor.rgb *= 1.0 + ((gdM1 - 0.5) * 0.26 + (gdM5 - 0.5) * 0.28 + (gdM6 - 0.5) * 0.3) * gdWx;
  diffuseColor.rgb *= 1.0 + ((gdM2 - 0.5) * 0.12 + (gdM3 - 0.5) * 0.1) * gdW;
  // pale salt pans with ragged edges, and the smaller blooms inside them
  float gdPan = smoothstep(0.6, 0.76, gdM5 * 0.5 + gdM1 * 0.3 + gdM4 * 0.12 + gdM2 * 0.08)
              * (1.0 - 0.7 * gdC);
  diffuseColor.rgb = mix(diffuseColor.rgb, gdBaseL * vec3(1.62, 1.58, 1.5), gdPan * 0.6 * gdWx);
  diffuseColor.rgb = mix(diffuseColor.rgb, gdBaseL * vec3(1.45, 1.42, 1.36), gdSalt * 0.3 * gdW);
  diffuseColor.rgb *= mix(vec3(1.0), vec3(0.84, 0.82, 0.8), gdDamp * 0.7 * gdW);
  roughnessFactor = mix(roughnessFactor, 0.84, gdDamp * 0.6 * gdW);
  // broad 2-8 cm undulation at 9 and 21 m so a low sun lays tonal waves
  // across the flat; faded before the waves alias into the horizon
  {
    vec3 gdU1 = gdVNd(gdP / 9.0 + 2.1);
    vec3 gdU2 = gdVNd(gdP / 21.0 - 6.3);
    vec2 gdG = gdU1.yz * (0.04 / 9.0) * (1.0 - smoothstep(1.2, 4.0, gdFp))
             + gdU2.yz * (0.07 / 21.0) * (1.0 - smoothstep(3.0, 9.0, gdFp));
    gdBump.xz -= gdG * 7.0 * gdWx;
  }

  // --- vehicle ruts ---------------------------------------------------------------
  float gdRut = 0.0;
  float gdBerm = 0.0;
  {
    float gdB;
    float gdDen = mix(0.34, 0.7, gdC);
    gdRut = max(gdRut, gdTrack(gdP, vec2(0.906, 0.423), mix(41.0, 23.0, gdC), 1.3, gdFp, gdDen, gdBump, diffuseColor.rgb, gdB));
    gdBerm = max(gdBerm, gdB);
    gdRut = max(gdRut, gdTrack(gdP, vec2(-0.342, 0.94), mix(57.0, 29.0, gdC), 4.1, gdFp, gdDen, gdBump, diffuseColor.rgb, gdB));
    gdBerm = max(gdBerm, gdB);
    gdRut = max(gdRut, gdTrack(gdP, vec2(0.574, -0.819), mix(73.0, 37.0, gdC), 7.7, gdFp, gdDen * 0.8, gdBump, diffuseColor.rgb, gdB));
    gdBerm = max(gdBerm, gdB);
    #ifdef GD_FAM_DIRT
    {
      // the strip's own traffic: two worn lanes either side of its centreline
      vec2 gdRel = gdP - gdBasis.zw;
      float gdQ = dot(gdRel, vec2(-gdBasis.y, gdBasis.x));
      float gdA = dot(gdRel, gdBasis.xy);
      float gdQs = gdQ + 1.4 * sin(gdA / 37.0) + 0.5 * sin(gdA / 11.0);
      float gdR = abs(abs(abs(gdQs) - 2.6) - 0.86);
      float gdF = 1.0 - smoothstep(0.12, 0.2 + gdFp, gdR);
      gdRut = max(gdRut, gdF);
      gdBerm = max(gdBerm, smoothstep(0.16, 0.24, gdR) * (1.0 - smoothstep(0.26, 0.42, gdR)));
    }
    #endif
    gdRut *= gdW;
    gdBerm *= gdW;
    diffuseColor.rgb *= 1.0 - gdRut * 0.13 + gdBerm * 0.07;
    roughnessFactor = clamp(roughnessFactor - gdRut * 0.07 + gdBerm * 0.04, 0.45, 1.0);
  }

  // --- drifted sand and wind ripples -------------------------------------------------
  float gdDrift = gdDriftR * (1.0 - 0.45 * gdC) * (1.0 - gdRut * 0.8);
  {
    vec2 gdWd = vec2(0.8, 0.6);
    float gdS = dot(gdP, gdWd) / 0.085 + gdVN(gdP * 1.15) * 3.5 + gdVN(gdP * 0.23) * 7.0;
    float gdKeep = (1.0 - smoothstep(0.22, 0.5, fwidth(gdS))) * gdAmt;
    float gdDh = cos(6.2832 * gdS) + 0.45 * cos(12.566 * gdS + 1.1);
    float gdRip = gdDrift * gdKeep;
    gdBump.xz -= gdWd * gdDh * 0.2 * gdRip;
    diffuseColor.rgb *= 1.0 + sin(6.2832 * gdS) * 0.035 * gdRip;
    diffuseColor.rgb = mix(diffuseColor.rgb, gdDustColor * 1.04, gdDrift * 0.42 * gdW);
    roughnessFactor = mix(roughnessFactor, 1.0, gdDrift * gdW);
  }

  // --- desiccation cracks --------------------------------------------------------------
  // Three tiers: 4-8 m primary plates with open fissures, 0.6-1.5 m secondary
  // plates inside them, and hairlines. The network is never masked off: the
  // regional field only opens or pinches it, so it is continuous everywhere on
  // open playa. Every tier is carried in albedo (clay floor, cavity shoulder,
  // salt rim) so it reads the same in sun and shade, and every tier hands
  // over to its mean coverage once a pixel spans a cell (gdNet), so the field
  // keeps its tone all the way to the horizon instead of ending on a line.
  // Ruts crush the crust and drifts bury it. Bladed compound ground has none.
  float gdNetK = (1.0 - gdC) * (1.0 - 0.85 * gdRut) * (1.0 - 0.75 * gdDrift) * gdWx;
  if (gdNetK > 0.002) {
    float gdOpenW = 0.55 + 0.9 * smoothstep(0.2, 0.8, gdM2 * 0.55 + gdM1 * 0.45);
    vec2 gdWarp = (vec2(gdVN(gdP * 0.9), gdVN(gdP * 0.9 + 5.2)) - 0.5) * 0.55
                + (vec2(gdVN(gdP * 3.1 + 2.0), gdVN(gdP * 3.1 + 7.7)) - 0.5) * 0.12;
    // primaries
    float gdC1 = 5.4;
    vec2 gdDir1;
    vec3 gdV1 = gdVoronoi((gdP + gdWarp) / gdC1, 0.92, gdDir1);
    float gdD1 = gdV1.x * gdC1;
    float gdW1 = (0.008 + 0.012 * gdV1.z) * (0.3 + 1.4 * gdVN(gdP * 1.3 + gdV1.z * 17.0)) * gdOpenW;
    float gdL1 = 0.05 + 0.04 * gdV1.y;
    // secondaries
    float gdC2 = 1.05;
    vec2 gdDir2;
    vec3 gdV2 = gdVoronoi((gdP - gdWarp * 0.4) / gdC2 + 13.7, 0.88, gdDir2);
    float gdD2 = gdV2.x * gdC2;
    float gdW2 = (0.0025 + 0.004 * gdV2.z) * (0.25 + 1.5 * gdVN(gdP * 4.1 + gdV2.z * 23.0)) * gdOpenW;
    float gdL2 = 0.018 + 0.014 * gdV2.y;

    float gdF1 = gdNet(gdD1, gdW1, gdFp, gdC1);
    float gdF2 = gdNet(gdD2, gdW2, gdFp, gdC2) * (1.0 - gdF1);
    // cavity: the shoulder either side of the floor that the sky cannot reach
    float gdAo1 = gdNet(gdD1, gdW1 * 3.5 + 0.035, gdFp, gdC1);
    float gdAo2 = gdNet(gdD2, gdW2 * 3.0 + 0.008, gdFp, gdC2);
    // the curled lip either side of the fissure, where the salt wicks up
    float gdR1 = max(gdNet(gdD1, gdW1 + gdL1, gdFp, gdC1) - gdNet(gdD1, gdW1 * 2.0, gdFp, gdC1), 0.0);
    float gdR2 = max(gdNet(gdD2, gdW2 + gdL2, gdFp, gdC2) - gdNet(gdD2, gdW2 * 2.0, gdFp, gdC2), 0.0);
    // hairlines, near field only
    float gdF3 = 0.0;
    if (gdFp < 0.03) {
      vec2 gdDir3;
      vec3 gdV3 = gdVoronoi(gdP / 0.31 + 41.3 + gdWarp, 0.8, gdDir3);
      gdF3 = gdNet(gdV3.x * 0.31, 0.0008 + 0.001 * gdV3.z, gdFp, 0.31)
           * step(0.3, gdV3.z) * (1.0 - smoothstep(0.012, 0.03, gdFp));
    }

    // per-plate tone and tilt, only while a plate is bigger than a pixel (a
    // hash per pixel would sparkle)
    float gdPk1 = 1.0 - smoothstep(0.15 * gdC1, 0.5 * gdC1, gdFp);
    float gdPk2 = 1.0 - smoothstep(0.15 * gdC2, 0.5 * gdC2, gdFp);
    diffuseColor.rgb *= 1.0 + ((gdV1.y - 0.5) * 0.2 * gdPk1 + (gdV2.y - 0.5) * 0.11 * gdPk2) * gdNetK;
    vec2 gdTilt = (gdH22(vec2(gdV1.y, gdV1.z) * 97.0) - 0.5) * 0.09 * gdPk1
                + (gdH22(vec2(gdV2.y, gdV2.z) * 53.0) - 0.5) * 0.07 * gdPk2;
    gdBump.xz += gdTilt * gdNetK;

    // salt on the rims, then the cavity, then the clay floor
    // once the lip is narrower than a pixel the pale rim would only cancel
    // the dark fissure beside it; from there the shadowed line carries it
    float gdRim = clamp(gdR1 * (0.7 + 0.3 * gdSalt) * (1.0 - smoothstep(gdL1, gdL1 * 3.0, gdFp * 1.5))
                      + gdR2 * 0.35 * (1.0 - smoothstep(gdL2, gdL2 * 3.0, gdFp * 1.5)), 0.0, 1.0);
    diffuseColor.rgb = mix(diffuseColor.rgb, gdBaseL * vec3(1.8, 1.76, 1.68), gdRim * 0.6 * gdNetK);
    diffuseColor.rgb *= 1.0 - (gdAo1 * 0.4 + gdAo2 * 0.16) * gdNetK;
    float gdFloor = clamp(gdF1 + gdF2 * 0.6 + gdF3 * 0.35, 0.0, 1.0);
    diffuseColor.rgb = mix(diffuseColor.rgb, gdBaseL * vec3(0.34, 0.27, 0.21), gdFloor * gdNetK);
    roughnessFactor = mix(roughnessFactor, 1.0, (gdF1 + gdF2 + gdRim * 0.5) * gdNetK);

    // relief: rims curl up and tilt in toward their own plate, then the face
    // drops into the fissure. Only while the lip spans a couple of pixels; the
    // albedo terms above carry the network past that.
    float gdNk1 = 1.0 - smoothstep(gdL1 * 0.5, gdL1 * 2.0, gdFp);
    float gdNk2 = 1.0 - smoothstep(gdL2 * 0.5, gdL2 * 2.0, gdFp);
    float gdCurl1 = exp(-max(gdD1 - gdW1, 0.0) / gdL1) * (1.0 - gdBand(gdD1, gdW1, gdFp));
    float gdCurl2 = exp(-max(gdD2 - gdW2, 0.0) / gdL2) * (1.0 - gdBand(gdD2, gdW2, gdFp));
    float gdWall1 = gdBand(gdD1, gdW1 * 1.3, gdFp);
    float gdWall2 = gdBand(gdD2, gdW2 * 1.3, gdFp);
    gdBump.xz += gdDir1 * (gdCurl1 * 0.6 - gdWall1 * 0.9) * gdNk1 * gdNetK;
    gdBump.xz += gdDir2 * (gdCurl2 * 0.4 - gdWall2 * 0.6) * gdNk2 * gdNetK * (1.0 - gdF1);
  }

  // --- salt-crust relief: ridged crests at 10, 4 and 1.5 cm ----------------------------
  // Replaces the stamped dimples. A 1-3 m mask leaves some plates polished
  // and others lumpy; crests are a touch paler, where the salt stands proud.
  {
    float gdLumpy = smoothstep(0.25, 0.75, gdVN(gdP / 2.2 + 3.3));
    float gdAmpR = (0.3 + 0.7 * gdLumpy) * gdAmt * (1.0 - 0.55 * gdC);
    float gdKa = 1.0 - smoothstep(0.02, 0.06, gdFp);
    if (gdKa * gdAmpR > 0.0) {
      float gdKb = 1.0 - smoothstep(0.008, 0.025, gdFp);
      float gdKc = 1.0 - smoothstep(0.003, 0.009, gdFp);
      vec3 gdRa = gdRidge(gdP / 0.1 + 1.7);
      vec3 gdRb = gdRidge(gdP / 0.04 + 9.1);
      vec3 gdRc = gdRidge(gdP / 0.015 - 4.3);
      vec2 gdG = gdRa.yz * (0.005 / 0.1) * gdKa
               + gdRb.yz * (0.003 / 0.04) * gdKb
               + gdRc.yz * (0.0015 / 0.015) * gdKc;
      gdBump.xz -= gdG * gdAmpR * 1.6;
      diffuseColor.rgb *= 1.0 + ((gdRa.x - 0.4) * 0.09 * gdKa + (gdRb.x - 0.4) * 0.05 * gdKb) * gdAmpR;
    }
  }
  // --- the join: debris off the edge of the concrete ---------------------------------
  #ifdef GD_COMPACT
  if (gdC > 0.02 && gdAmt > 0.0) {
    float gdSdT = gdPaveSd(gdP);
    if (gdSdT < 3.5) {
      // contact under the slab lip, and the hollow a broken edge leaves
      float gdLipAo = (1.0 - smoothstep(0.0, 0.1, abs(gdSdT))) ;
      float gdUnder = 1.0 - smoothstep(-0.6, -0.05, gdSdT);
      diffuseColor.rgb *= 1.0 - (gdLipAo * 0.42 + (1.0 - gdUnder) * step(gdSdT, 0.0) * 0.18) * gdAmt;
      // sand banked against the edge
      float gdBank = (1.0 - smoothstep(0.0, 0.6 + 1.4 * gdVN(gdP * 0.5), gdSdT)) * step(0.0, gdSdT);
      diffuseColor.rgb = mix(diffuseColor.rgb, gdDustColor * 1.02, gdBank * 0.6 * gdAmt);
      roughnessFactor = mix(roughnessFactor, 1.0, gdBank * gdAmt);
      // the drift is wind-laid: fine ripples across it, crests a shade paler
      {
        vec2 gdWd = vec2(0.8, 0.6);
        float gdS = dot(gdP, gdWd) / 0.07 + gdVN(gdP * 1.3) * 3.0 + gdVN(gdP * 0.3) * 6.0;
        float gdKeepR = (1.0 - smoothstep(0.22, 0.5, fwidth(gdS))) * gdBank * gdAmt;
        gdBump.xz -= gdWd * cos(6.2832 * gdS) * 0.2 * gdKeepR;
        diffuseColor.rgb *= 1.0 + sin(6.2832 * gdS) * 0.04 * gdKeepR;
      }
      // broken concrete strewn off the edge
      float gdDens = (1.0 - smoothstep(-0.3, 3.2, gdSdT)) * 0.8 * gdAmt;
      gdScatter(gdP, 0.32, gdDens, vec2(0.025, 0.1), 77.0, gdFp, 1.0,
                vec3(0.27, 0.26, 0.24), vec3(0.42, 0.4, 0.36),
                diffuseColor.rgb, gdBump, roughnessFactor);
      gdScatter(gdP, 0.13, gdDens * 0.8, vec2(0.008, 0.03), 79.0, gdFp, 0.8,
                vec3(0.22, 0.21, 0.19), vec3(0.4, 0.38, 0.34),
                diffuseColor.rgb, gdBump, roughnessFactor);
    }
  }
  #endif

  // --- grit ------------------------------------------------------------------------
  // Clustered, not spread: a 30 m and a 7 m field put most of the grit in a
  // fraction of the ground. Sizes run on a power law (many 2-5 mm grains, a
  // few centimetre stones) and colours from pale salt-washed to dark varnish,
  // so no two read as the same decal. Bladed ground keeps fine grit only.
  {
    float gdClump = smoothstep(0.42, 0.78, gdVN(gdP / 31.0 + 4.4) * 0.6 + gdVN(gdP / 7.0 - 2.2) * 0.4);
    float gdLag = (0.08 + 0.92 * gdClump) * (1.0 - 0.7 * gdDrift) * (1.0 - 0.6 * gdRut) * gdAmt;
    gdScatter(gdP, 1.7, gdLag * mix(0.3, 0.08, gdC), vec2(0.03, 0.09), 3.0, gdFp, 0.3,
              vec3(0.52, 0.49, 0.44) * gdTintK, vec3(0.11, 0.09, 0.075) * gdTintK,
              diffuseColor.rgb, gdBump, roughnessFactor);
    gdScatter(gdP, 0.33, gdLag * mix(0.4, 0.3, gdC), vec2(0.008, 0.03), 11.0, gdFp, 0.45,
              vec3(0.58, 0.55, 0.5) * gdTintK, vec3(0.16, 0.13, 0.1) * gdTintK,
              diffuseColor.rgb, gdBump, roughnessFactor);
    gdScatter(gdP, 0.075, gdLag * mix(0.35, 0.6, gdC), vec2(0.002, 0.006), 17.0, gdFp, 0.6,
              vec3(0.62, 0.6, 0.56) * gdTintK, vec3(0.2, 0.17, 0.14) * gdTintK,
              diffuseColor.rgb, gdBump, roughnessFactor);
  }
  // --- graded dirt strips: a ragged edge that dissolves into the lakebed --------------
  #ifdef GD_EDGE_UV
  if (gdEdgeW > 0.0) {
    float gdEd = (0.5 - abs(vGdUv.x - 0.5)) * gdEdgeW;
    float gdRag = 0.15 + 1.6 * (gdVN(gdP * 0.7) * 0.7 + gdVN(gdP * 3.1) * 0.3);
    float gdCutD = gdRag * gdAmt * (1.0 - smoothstep(0.03, 0.09, gdFp));
    if (gdEd < gdCutD) discard;
    float gdSoft = 1.0 - smoothstep(0.0, 2.5, gdEd - gdCutD);
    diffuseColor.rgb = mix(diffuseColor.rgb, gdDustColor * 0.95, gdSoft * 0.35 * gdW);
  }
  #endif

  // the stacked multiplies above can undershoot; keep albedo physical
  diffuseColor.rgb = max(diffuseColor.rgb, vec3(0.0));
  roughnessFactor = clamp(roughnessFactor, 0.45, 1.0);
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
  // 1 for a camera standing on the ground, 0 for the aerial route: the
  // playa's large-scale albedo and crack tone then run to the horizon on
  // foot and never appear from the air.
  float gdGroundCam = 1.0 - smoothstep(40.0, 120.0, cameraPosition.y);

  if (gdMacroAmt > 0.002 || gdGroundCam > 0.002) {
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
    // Fine normals are full at a couple of metres (gdFoot is millimetres to
    // centimetres there) and gone once the grain's footprint leaves that read.
    // Roughness and albedo keep the longer gdFine tail; normals must not.
    float gdNormKeep = 1.0 - smoothstep(0.22, 0.9, gdFoot);

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

    #ifdef GD_PROC
      // Pixel footprint in metres. Lines at every orientation are filtered
      // against it, so it sits between the two derivatives: the max fades a
      // crack running across the view long before it stops resolving.
      vec2 gdDxW = dFdx(vGdWorld.xz);
      vec2 gdDyW = dFdy(vGdWorld.xz);
      float gdFa = length(gdDxW);
      float gdFb = length(gdDyW);
      float gdFp = mix(sqrt(gdFa * gdFb), max(gdFa, gdFb), 0.3);
    #endif

    // --- shading normal ------------------------------------------------
    if (gdFine > 0.0) {
      vec2 gdNf = texture2D(gdNormalMap, gdUv).xy * 2.0 - 1.0;
      float gdFineN = gdNormalStrength.x * gdFine * gdNormKeep * gdCalm;
      #if defined(GD_PROC) && !defined(GD_JOINTS)
        // the analytic salt relief replaces the map's pitted grain
        gdFineN *= 0.3;
      #endif
      gdBump.xz += gdNf * gdFineN;
    }
    if (gdMacroAmt > 0.0) {
      vec2 gdNm = texture2D(gdNormalMap, gdUvM).xy * 2.0 - 1.0;
      float gdMacroN = gdNormalStrength.y * gdMacroAmt * gdCalm;
      #ifdef GD_PROC
        // The macro tap scales millimetre grit up 9x into soft 3-10 cm
        // dimples, which is the whole "blurred sand" look; and past a few
        // tens of metres it only reads as an 11 m repeat. The analytic
        // cracks, ruts and ripples carry metre-scale form instead.
        gdMacroN *= 0.3 * (1.0 - 0.7 * smoothstep(0.02, 0.12, gdFp));
      #endif
      gdBump.xz += gdNm.yx * gdMacroN;
    }

    // --- albedo grain ---------------------------------------------------
    // the macro tap only breaks up the flatness; run it well under the fine
    // one or the two beat together into blotch. mix() is 1 past fadeEnd, so
    // the aerial grain is unchanged; up close pavement sheds pebbles and
    // open desert keeps them.
    float gdGrainF = (gdSf.r - 0.5) * gdFine * gdCalm + (gdSm.r - 0.5) * gdMacroAmt * 0.3;
    #ifdef GD_JOINTS
      float gdPebble = 0.7;
    #else
      float gdPebble = 1.18;
    #endif
    diffuseColor.rgb *= 1.0 + gdGrainF * gdGrain * mix(1.0, gdPebble, gdAmt);

    // Large-scale value mottling, wavelengths 4–18 m, so a 512 px tile cannot
    // stamp across an apron. Analytic — no extra texture tap — and multiplied
    // by gdAmt, which is exactly 0 at and beyond fadeEnd.
    if (gdAmt > 0.001) {
      vec2 gdWp = vGdWorld.xz;
      // Continuous mottling only. A soft cell hash still left square seams
      // once the values jumped between cells.
      // Broad wear borrows the surface maps' irregular edges. Crossing two
      // sine waves alone made regular dark diamonds on both sand and concrete.
      float gdMottle = sin(dot(gdWp, vec2(0.18, 0.07)) + gdSm.g * 5.0);
      #ifdef GD_PROC
        // the analytic colour regions below replace the sine's job
        gdMottle *= 0.35;
      #endif
      diffuseColor.rgb *= 1.0 + (gdMottle * 0.10 + (gdSm.r - 0.5) * 0.19) * gdAmt;

      #if defined(GD_COMPACT) && !defined(GD_PROC)
        // Loose stones belong to the lakebed. The highlight, rounded normal
        // and occlusion all end at the stone, including in grazing views.
        vec2 stoneUv = gdWp * 0.82;
        vec2 cell = floor(stoneUv);
        float pick = gdHash21(cell);
        vec2 jitter = vec2(gdHash21(cell + 2.1), gdHash21(cell + 5.7)) - 0.5;
        vec2 p = (fract(stoneUv) - 0.5 - jitter * 0.50) * vec2(0.85, 1.15);
        float radius = mix(0.055, 0.14, fract(pick * 17.0));
        float footprint = max(fwidth(stoneUv.x), fwidth(stoneUv.y));
        float aa = min(radius, max(0.008, footprint));
        float amount = step(0.80, pick) * gdFine * (1.0 - vGdCompact)
                     * (1.0 - smoothstep(radius * 0.55, radius * 2.0, footprint));
        float body = 1.0 - smoothstep(radius - aa, radius + aa, length(p));
        float contact = 1.0 - smoothstep(radius * 0.55, radius + 1.5 * aa,
                                         length(p - vec2(0.026, 0.018)));
        diffuseColor.rgb *= 1.0 - amount * (0.18 * body + 0.24 * contact * (1.0 - body));
        gdBump.xz += (p / radius) * body * amount * 0.95;
      #endif

      // Contact at structure feet. A ring just outside each footprint, not a
      // disc under the building (the mesh already covers that). gdAmt keeps
      // it off the aerial twin.
      float gdOccl = 0.0;
      for (int i = 0; i < 48; i++) {
        vec2 gdC = vGdWorld.xz - gdBoxA[i].xy;
        float gdCos = gdBoxB[i].x;
        float gdSin = gdBoxB[i].y;
        vec2 gdL = vec2(gdCos * gdC.x - gdSin * gdC.y, gdSin * gdC.x + gdCos * gdC.y);
        vec2 gdQ = abs(gdL) - gdBoxA[i].zw;
        float gdOut = length(max(gdQ, vec2(0.0)));
        float gdIn = min(max(gdQ.x, gdQ.y), 0.0);
        float gdSd = gdOut + gdIn;
        // Darkest at the wall (gdSd ~ 0), gone by about three metres so a
        // standing frame still sees the seam as a gradient, not a full wash.
        float gdBand = (1.0 - smoothstep(0.05, 2.8, gdSd)) * smoothstep(-0.25, 0.04, gdSd);
        float gdGrit = (1.0 - smoothstep(0.0, 0.85, gdSd)) * smoothstep(-0.15, 0.02, gdSd);
        gdOccl = max(gdOccl, max(gdBand, gdGrit * 1.05));
      }
      diffuseColor.rgb *= 1.0 - gdOccl * 0.97 * gdAmt;
      // A thin grit line right against the wall so the join is not a knife edge.
      roughnessFactor = clamp(roughnessFactor + gdOccl * 0.18 * gdAmt, 0.45, 1.0);
    }

    // --- surface state: polished <-> loose -------------------------------
    // -1 traffic-polished / compacted, +1 loose and powdered. This is the term
    // that matters: a single roughness value across an apron is exactly what
    // makes concrete read as plastic, and the swing has to be big enough to
    // change the specular response, not just nudge it.
    float gdPatch = (gdSm.g - 0.5) * 2.0 * gdMacroAmt;
    float gdMicro = (gdSf.g - 0.5) * 2.0 * gdFine;
    // the micro term stays the smaller of the two: per-grain roughness swings
    // make the specular sparkle rather than vary. The patch coefficient is
    // 0.78 past fadeEnd (gdAmt is 0 there) and a little wider up close.
    // Floor 0.45 is polished concrete, not a mirror; 1.0 is loose dust.
    float gdRoughDelta = (gdPatch * (0.78 + 0.2 * gdAmt) + gdMicro * 0.15) * gdRoughness;
    roughnessFactor = clamp(roughnessFactor + gdRoughDelta, 0.45, 1.0);
    // a polished patch is darker and slightly more specular; a loose one is
    // paler and completely matte. Moving albedo and roughness together is what
    // separates "damp/worn" from "someone lowered a slider".
    float gdPolish = max(0.0, -gdPatch);
    float gdLoose = max(0.0, gdPatch);
    diffuseColor.rgb *= 1.0 - gdPolish * (0.13 + 0.04 * gdAmt);
    // Geometric view-normal's world up. Dust settles on upward faces and only
    // where roughness rose (gdLoose). mix(..., gdAmt) leaves the previous
    // gdLoose * gdDust weight untouched once gdAmt hits 0.
    float gdUp = saturate(dot(normalize(vNormal), viewMatrix[1].xyz));
    float gdDustBase = gdLoose * gdDust;
    #ifdef GD_JOINTS
      float gdDustExtra = 0.07;
    #else
      float gdDustExtra = 0.2;
    #endif
    float gdDustClose = gdLoose * gdUp * min(gdDust + gdDustExtra, 0.62);
    diffuseColor.rgb = mix(diffuseColor.rgb, gdDustColor, mix(gdDustBase, gdDustClose, gdAmt));

    #ifdef GD_JOINTS
    {
      vec2 gdRel = vGdWorld.xz - gdBasis.zw;
      vec2 gdLocal = vec2(dot(gdRel, gdBasis.xy), dot(gdRel, vec2(-gdBasis.y, gdBasis.x)));
      vec2 gdCellF = gdLocal / gdJoint.x;
      vec2 gdCellFw = max(fwidth(gdCellF), vec2(1e-5));
      vec2 gdEdge = abs(fract(gdCellF - 0.5) - 0.5);
      float gdHalfW = gdJoint.y * 0.5 / max(gdJoint.x, 1e-4);
      vec2 gdHalf = vec2(gdHalfW);
      // Soft shoulder at least ~1.5 px wide. A hard step at grazing angles is
      // what shimmers; the band tracks fwidth so the edge stays a few pixels.
      vec2 gdAa = max(gdCellFw * 1.6, gdHalf * 0.75);
      vec2 gdLine = 1.0 - smoothstep(gdHalf, gdHalf + gdAa, gdEdge);
      // Fade each axis on its own derivative. The joint running across the
      // view stays sharp; the one compressed along the view drops out once it
      // is thinner than about a pixel and a half, instead of aliasing.
      vec2 gdKeep = vec2(1.0) - smoothstep(gdHalf * 1.15, gdHalf * 3.4, gdCellFw);
      gdLine *= gdKeep * gdMacroAmt;
      float gdSeam = max(gdLine.x, gdLine.y);

      diffuseColor.rgb *= mix(1.0, gdJoint.z, gdSeam);
      roughnessFactor = clamp(roughnessFactor + gdSeam * 0.16, 0.45, 1.0);
      // joints are where the wind puts the sand; up close, only on faces that
      // can hold it. Past fadeEnd the up-weight mixes back to 1.
      diffuseColor.rgb = mix(
        diffuseColor.rgb,
        gdDustColor,
        gdSeam * gdDust * 0.55 * mix(1.0, gdUp, gdAmt));

      // smooth groove in the strip's frame, then rotated back to world XZ.
      // A sign() step at the centre flickers; the ramp does not.
      vec2 gdSigned = fract(gdCellF - 0.5) - 0.5;
      vec2 gdSlope = clamp(gdSigned / max(gdHalf + gdAa, vec2(1e-4)), -1.0, 1.0) * gdLine;
      gdBump.xz -= (gdBasis.xy * gdSlope.x + vec2(-gdBasis.y, gdBasis.x) * gdSlope.y) * 0.38;

      // per-slab PBR drift: a pour is never uniform across a day's work
      vec2 gdCell = floor(gdCellF);
      float gdSlab = gdHash21(gdCell + 13.0);
      #ifdef GD_PROC
        float gdSlabDrift = 0.09;
      #else
        float gdSlabDrift = 0.05;
      #endif
      roughnessFactor = clamp(roughnessFactor + (gdSlab - 0.5) * 0.09 * gdMacroAmt, 0.45, 1.0);
      diffuseColor.rgb *= 1.0 + (gdHash21(gdCell * 1.31 - 7.0) - 0.5) * gdSlabDrift * gdMacroAmt;

      #ifndef GD_PROC
      if (gdCracks > 0.0) {
        // gate on the slab hash so only a minority of slabs are cracked; the
        // 6 m slab grid and the ~11 m crack tile share no period, so the crack
        // layer never reads as a repeat
        float gdCracked = step(0.66, gdSlab);
        float gdCrack = smoothstep(0.35, 0.85, gdSm.b) * gdCracked * gdCracks * gdMacroAmt;
        // cracks stop at the joints, the way slabs really fail
        gdCrack *= 1.0 - gdSeam;
        diffuseColor.rgb *= 1.0 - gdCrack * 0.42;
        roughnessFactor = clamp(roughnessFactor + gdCrack * 0.2, 0.45, 1.0);
      }
      #endif

      #ifdef GD_PROC
      ${PAVEMENT_PROC}
      #endif
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
      roughnessFactor = clamp(roughnessFactor - gdWear * (0.28 + 0.06 * gdAmt), 0.45, 1.0);
      diffuseColor.rgb *= 1.0 - gdWear * (0.11 + 0.03 * gdAmt);
    }
    #endif

    #if defined(GD_PROC) && !defined(GD_JOINTS)
    ${GROUND_PROC}
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

const CONTACT_LIMIT = 48;

/**
 * Oriented footprints of the largest structures, in the local frame.
 * `A` is centre XZ and half-extents. `B.xy` is the yaw (cos, sin) of the
 * group's Y rotation, matching `StructureNode`. Unused slots sit far away
 * with a zero extent so the contact ring never fires.
 */
function buildContactBoxes(): { a: THREE.Vector4[]; b: THREE.Vector4[] } {
  const ranked = [...STRUCTURES].sort(
    (p, q) => q.size[0] * q.size[2] - p.size[0] * p.size[2],
  );
  const a: THREE.Vector4[] = [];
  const b: THREE.Vector4[] = [];
  for (let i = 0; i < CONTACT_LIMIT; i += 1) {
    const structure = ranked[i];
    if (!structure) {
      a.push(new THREE.Vector4(1e6, 1e6, 0, 0));
      b.push(new THREE.Vector4(1, 0, 0, 0));
      continue;
    }
    a.push(
      new THREE.Vector4(
        structure.position[0],
        structure.position[1],
        structure.size[0] * 0.5,
        structure.size[2] * 0.5,
      ),
    );
    b.push(
      new THREE.Vector4(Math.cos(structure.rotation), Math.sin(structure.rotation), 0, 0),
    );
  }
  return { a, b };
}

const CONTACT = buildContactBoxes();
const CONTACT_A = CONTACT.a;
const CONTACT_B = CONTACT.b;

/** Shared by every ground material: the sun moves them all together. */
const SUN_UNIFORM: THREE.IUniform<THREE.Vector3> = { value: sunState.direction };

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
  const proc = o.procedural;
  const edgeUv = proc && o.edgeWidth > 0;

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
    gdJoint: {
      value: new THREE.Vector3(o.jointSpacing || 1, o.jointWidth, o.jointDarken),
    },
    gdCracks: { value: o.cracks },
    gdTracks: { value: o.tracks },
    gdDust: { value: o.dust },
    gdDustColor: { value: o.dustColor },
    gdBoxA: { value: CONTACT_A },
    gdBoxB: { value: CONTACT_B },
    ...(proc
      ? {
          gdSun: SUN_UNIFORM,
          gdPaveA: { value: PAVE.a },
          gdPaveB: { value: PAVE.b },
          gdEdgeW: { value: o.edgeWidth },
        }
      : {}),
  };

  material.userData.groundDetail = uniforms;

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = patchShader("ground detail (vertex)", shader.vertexShader, [
      [
        "#include <common>",
        `#include <common>
varying vec3 vGdWorld;
#ifdef GD_COMPACT
attribute float gdCompact;
varying float vGdCompact;
#endif
#ifdef GD_EDGE_UV
varying vec2 vGdUv;
#endif`,
      ],
      // `transformed` is final here and the logdepth / clipping chunks that
      // follow `<project_vertex>` are left exactly where three put them
      [
        "#include <project_vertex>",
        `vGdWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
#ifdef GD_COMPACT
vGdCompact = gdCompact;
#endif
#ifdef GD_EDGE_UV
vGdUv = uv;
#endif
#include <project_vertex>`,
      ],
    ]);

    shader.fragmentShader = patchShader(
      "ground detail (fragment)",
      shader.fragmentShader,
      [
        ["#include <common>", `#include <common>\n${HEAD}`],
        ["void main() {", `void main() {\n  vec3 gdBump = vec3(0.0);`],
        [
          "#include <metalnessmap_fragment>",
          `#include <metalnessmap_fragment>\n${SURFACE}`,
        ],
        ["#include <normal_fragment_maps>", `#include <normal_fragment_maps>\n${NORMAL}`],
      ],
    );
  };

  // Defines switch the injection, and the GLSL string itself is versioned:
  // three caches programs on this key, not on the onBeforeCompile output.
  const famKey = o.family === "pavement" ? "p" : o.family === "dirt" ? "d" : "s";
  const cacheKey = `gd31:${joints ? 1 : 0}${tracks ? 1 : 0}${o.compactAttribute ? 1 : 0}${
    proc ? famKey : "-"
  }${edgeUv ? 1 : 0}`;
  material.customProgramCacheKey = () => cacheKey;
  material.defines = {
    ...material.defines,
    ...(joints ? { GD_JOINTS: "" } : {}),
    ...(tracks ? { GD_TRACKS: "" } : {}),
    ...(o.compactAttribute ? { GD_COMPACT: "" } : {}),
    ...(proc ? { GD_PROC: "" } : {}),
    ...(proc && o.family === "dirt" ? { GD_FAM_DIRT: "" } : {}),
    ...(edgeUv ? { GD_EDGE_UV: "" } : {}),
  };

  material.needsUpdate = true;
  return material;
}

/** Ready-made parameter sets for the ground families the site actually has. */
export const GROUND_DETAIL_PRESETS = {
  /**
   * Airfield PCC. Contraction joints go in on a 5 m grid (the canvas maps
   * already carry the 25 m construction joints, which is the real hierarchy),
   * traffic polishes lanes into it and wind-blown sand fills the grooves.
   */
  pavement: {
    family: "pavement" as const,
    scale: 1.05,
    macro: 10.7,
    // Fine normal is eased off from 1.0: the map already carries relief, and
    // more of it reads as crumpled paper. Roughness and joints do the work.
    normalStrength: [0.84, 0.42] as [number, number],
    roughness: 0.48,
    grain: 0.21,
    jointSpacing: 5,
    // a sawn joint plus its chamfer; the sealant bead sits inside it
    jointWidth: 0.034,
    jointDarken: 0.55,
    cracks: 0.8,
    tracks: 0.6,
    dust: 0.16,
    dustColor: "#aaa597",
  },
  /**
   * Open lakebed: pebbles, crust, no joints and no directional wear. The macro
   * normal carries more here than on concrete — the terrain mesh is 13 m per
   * quad even on the top tier, so metre-scale form has nowhere else to come
   * from.
   */
  desert: {
    family: "desert" as const,
    scale: 1.35,
    macro: 8.6,
    // Still stronger than pavement so the lakebed stays pebbled, but not
    // pushed past the point where the fine layer looks like crumpled paper.
    normalStrength: [0.98, 0.62] as [number, number],
    roughness: 0.34,
    grain: 0.3,
    dust: 0.18,
    dustColor: "#aba393",
  },
  /** Graded dirt strips and haul roads: coarser, looser, no joints. */
  dirt: {
    family: "dirt" as const,
    scale: 1.5,
    macro: 7.4,
    normalStrength: [0.92, 0.6] as [number, number],
    roughness: 0.3,
    grain: 0.28,
    tracks: 0.45,
    dust: 0.22,
    dustColor: "#a99f8b",
  },
} satisfies Record<
  GroundDetailFamily,
  Omit<GroundDetailOptions, "normalMap" | "surfaceMap">
>;

/** Which canvas detail set each family samples. */
const FAMILY_MAPS: Record<GroundDetailFamily, GroundDetailKind> = {
  pavement: "concrete",
  desert: "desert",
  dirt: "desert",
};

/** The tier that can afford the analytic layer: the one with the post stack. */
function proceduralTier(tier: QualityTier): boolean {
  const profile = getQualityProfile(tier);
  return profile.groundDetailRich && profile.groundDetailSize >= 512;
}

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
  const procedural = proceduralTier(tier);
  // the analytic layer draws the crust itself; the map then carries grit only
  const maps = getGroundDetailMaps(
    kind,
    SITE_SEED + (kind === "concrete" ? 610 : 620),
    profile.groundDetailSize,
    { crust: !procedural },
  );
  const preset = GROUND_DETAIL_PRESETS[family];
  const range = profile.groundDetailRange;

  return {
    ...preset,
    // cracks and directional polish are the two extra taps; they come off on
    // the tiers that cannot afford them
    ...(profile.groundDetailRich ? {} : { cracks: 0, tracks: 0 }),
    fade: [range * 0.2, range],
    procedural,
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
