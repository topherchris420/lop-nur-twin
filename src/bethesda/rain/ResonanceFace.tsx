/**
 * R.A.I.N.'s resonance: the plate instrument in the Research Panel. Presentation only.
 *
 * R.A.I.N. has no face, no head and no avatar. It is seen through a physical
 * instrument: on a steel plinth, one large Chladni plate clamped at its
 * centre, and behind it four small plates, one for each perspective, each
 * coupled to the large plate's stem by a thin rod. Sand lies on the plates and
 * gathers where they stay still, as on a real Chladni plate.
 *
 * What drives the plates is `resonance.ts`'s view of the lab store, read
 * through `read` and nothing else: this component never sees the store, a
 * client or a provider, so it shows R.A.I.N. the same way whatever produced a
 * meeting. The figures are the Vers3Dynamics Cymatics studio's plate figures
 * (`chladni.ts`): each partial is answered by the plate's modes, every figure
 * is normalised to the same contrast, and the motion is slowed as a
 * stroboscope would slow it. The sand density is drawn analytically from the
 * figure's time-averaged energy rather than simulated grain by grain, so a
 * figure costs the same every frame and nothing is random: the grains are a
 * fixed hash of their place on the plate.
 *
 * Nothing here is evidence or measurement. The plate reads the runtime's
 * state and writes none of it, decides nothing and sends nothing. A click on
 * it only navigates (`onInspect`): it opens the Research Panel, as the room
 * buttons do.
 *
 * No React state on the frame loop: uniforms are eased in `useFrame` in
 * place; a figure is rebuilt only when the view's key changes, and the
 * quality steps down (a discrete event) only when frames stay slow.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { ENERGY_CAP, STILL, buildFigure, seat, strobeRate, type Figure } from "./chladni";
import { PERSPECTIVES, type Perspective } from "./contracts";
import { RESONANCE } from "./labLayout";
import {
  PERSPECTIVE_MODES,
  PIGMENTS,
  type Pigment,
  type ResonanceView,
} from "./resonance";

export type ResonanceQuality = "high" | "medium" | "low";

/** The most terms a plate's shader evaluates per figure. */
const TERMS = 16;
const BUDGET: Record<ResonanceQuality, number> = { high: 16, medium: 10, low: 6 };
const SEGMENTS: Record<ResonanceQuality, number> = { high: 112, medium: 56, low: 1 };
const GRAIN: Record<ResonanceQuality, number> = { high: 1, medium: 1, low: 0 };
/** Seconds for the sand to move from one figure to the next. */
const CROSSFADE = 1.8;
/** The tilt toward the door, radians: an instrument shown to its visitor, not a table top. */
const TILT = 0.36;
const MAIN = { size: 0.86, at: [0, 1.0, 0.1] as const };
const SMALL = 0.24;
/** The perspectives' plates, behind the large one in the order of their seats. */
const SOURCES: Record<Perspective, readonly [number, number, number]> = {
  Jasmine: [-0.78, 0.98, 0.02],
  Luca: [-0.36, 1.28, -0.42],
  James: [0.36, 1.28, -0.42],
  Elena: [0.78, 0.98, 0.02],
};
const STEM_TOP: readonly [number, number, number] = [0, 0.96, 0.1];
const BOUNDARY = new THREE.Color("#e2a457");
const COUPLING = new THREE.Color("#3fb6b0");

const HEAD = /* glsl */ `
#define R_TERMS ${TERMS}
varying vec2 vPlate;
uniform vec4 uTermA[R_TERMS];
uniform vec2 uCoefA[R_TERMS];
uniform int uCountA;
uniform vec4 uWeightA;
uniform vec4 uTermB[R_TERMS];
uniform vec2 uCoefB[R_TERMS];
uniform int uCountB;
uniform vec4 uWeightB;
uniform float uMix;
float rShape(vec4 t, vec2 uv) {
  float direct = cos(t.x * uv.x) * cos(t.y * uv.y);
  if (t.z == 0.0) return direct;
  return 0.5 * (direct + t.z * cos(t.y * uv.x) * cos(t.x * uv.y));
}
float rPick(vec4 v, float k) {
  return k < 0.5 ? v.x : k < 1.5 ? v.y : k < 2.5 ? v.z : v.w;
}
void rStore(inout vec4 e, float k, float v) {
  if (k < -0.5) return;
  if (k < 0.5) e.x = v;
  else if (k < 1.5) e.y = v;
  else if (k < 2.5) e.z = v;
  else e.w = v;
}
`;
/** Each partial's time-averaged energy, one per component; terms come grouped by partial. */
const energy = (s: "A" | "B") => /* glsl */ `
vec4 rEnergy${s}(vec2 p) {
  vec2 uv = 1.5707963 * (p + 1.0);
  vec4 e = vec4(0.0);
  float re = 0.0, im = 0.0, cur = -1.0;
  for (int i = 0; i < R_TERMS; i++) {
    if (i >= uCount${s}) break;
    vec4 t = uTerm${s}[i];
    if (t.w != cur) { rStore(e, cur, re * re + im * im); re = 0.0; im = 0.0; cur = t.w; }
    float sh = rShape(t, uv);
    re += uCoef${s}[i].x * sh;
    im += uCoef${s}[i].y * sh;
  }
  rStore(e, cur, re * re + im * im);
  return min(e, vec4(${ENERGY_CAP.toFixed(2)}));
}`;
const displacement = (s: "A" | "B") => /* glsl */ `
float rDisp${s}(vec2 p) {
  vec2 uv = 1.5707963 * (p + 1.0);
  float d = 0.0;
  for (int i = 0; i < R_TERMS; i++) {
    if (i >= uCount${s}) break;
    vec4 t = uTerm${s}[i];
    float c = rPick(uPhaseCos${s}, t.w), n = rPick(uPhaseSin${s}, t.w);
    d += rPick(uWeight${s}, t.w) * (uCoef${s}[i].x * c - uCoef${s}[i].y * n) * rShape(t, uv);
  }
  return d;
}`;
const VERTEX_HEAD = /* glsl */ `
uniform vec4 uPhaseCosA;
uniform vec4 uPhaseSinA;
uniform vec4 uPhaseCosB;
uniform vec4 uPhaseSinB;
uniform float uSwing;
uniform float uHalf;
${displacement("A")}
${displacement("B")}
float rSwing(vec2 p) {
  float a = uCountA > 0 ? rDispA(p) : 0.0;
  float b = uCountB > 0 ? rDispB(p) : 0.0;
  return mix(a, b, uMix) * uSwing;
}
`;
const FRAGMENT_HEAD = /* glsl */ `
uniform float uSettle;
uniform float uLevel;
uniform float uGrain;
uniform float uSeed;
uniform float uHover;
uniform vec3 uRamp[5];
${energy("A")}
${energy("B")}
float rHash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031 + uSeed);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
vec3 rRamp(float t) {
  if (t < 0.3) return mix(uRamp[0], uRamp[1], t / 0.3);
  if (t < 0.58) return mix(uRamp[1], uRamp[2], (t - 0.3) / 0.28);
  if (t < 0.84) return mix(uRamp[2], uRamp[3], (t - 0.58) / 0.26);
  return mix(uRamp[3], uRamp[4], (t - 0.84) / 0.16);
}
// Each sounding partial lays its own figure of sand, as loud as the partial;
// where figures cross, their sand adds up without ever exceeding a full plate.
float rDensity(vec4 e, int count, vec4 weight, float w) {
  // A plate nobody drives keeps its sand where it was strewn.
  if (count == 0) return 1.0;
  // Antialiased on the amplitude, which crosses a nodal line linearly: a line
  // is widened by the pixel it falls in, never by the figure's slopes.
  vec4 fa = fwidth(sqrt(e));
  vec4 d = exp(-e / max(vec4(w), fa * fa * 0.5)) * weight;
  return 1.0 - (1.0 - d.x) * (1.0 - d.y) * (1.0 - d.z) * (1.0 - d.w);
}
`;
const SAND = /* glsl */ `
// Settling narrows the band of quiet plate the sand rests in, from the whole
// plate (strewn) to the nodal lines themselves.
float rW = 1.2 * pow(0.004, uSettle);
// The figure the sand is leaving is evaluated only while it is leaving.
float rDA = uMix < 1.0 ? rDensity(rEnergyA(vPlate), uCountA, uWeightA, rW) : 1.0;
float rDB = rDensity(rEnergyB(vPlate), uCountB, uWeightB, rW);
// The same sand spread over less plate piles higher.
float rPile = mix(rDA, rDB, uMix) * (0.45 + 3.0 * uSettle * uSettle);
vec2 rCell = vPlate * 150.0;
float rCover = 1.0 - exp(-rPile * rPile * 0.7);
float rSpeck = step(1.0 - rCover, rHash(floor(rCell)));
// Grains smaller than a pixel are drawn as the density they add up to.
float rPx = fwidth(rCell.x) + fwidth(rCell.y);
float rGrainy = uGrain > 0.5 ? mix(rSpeck, rCover, clamp(rPx - 0.7, 0.0, 1.0)) : rCover;
float rSand = clamp(rGrainy * 0.94 + rCover * 0.06, 0.0, 1.0);
vec3 rSandColor = rRamp(1.0 - exp(-rPile * 0.65));
diffuseColor.rgb = mix(diffuseColor.rgb, rSandColor, rSand);
`;

interface FieldUniforms {
  [key: string]: THREE.IUniform;
  uTermA: THREE.IUniform<THREE.Vector4[]>;
  uCoefA: THREE.IUniform<THREE.Vector2[]>;
  uCountA: THREE.IUniform<number>;
  uWeightA: THREE.IUniform<THREE.Vector4>;
  uTermB: THREE.IUniform<THREE.Vector4[]>;
  uCoefB: THREE.IUniform<THREE.Vector2[]>;
  uCountB: THREE.IUniform<number>;
  uWeightB: THREE.IUniform<THREE.Vector4>;
  uMix: THREE.IUniform<number>;
  uPhaseCosA: THREE.IUniform<THREE.Vector4>;
  uPhaseSinA: THREE.IUniform<THREE.Vector4>;
  uPhaseCosB: THREE.IUniform<THREE.Vector4>;
  uPhaseSinB: THREE.IUniform<THREE.Vector4>;
  uSwing: THREE.IUniform<number>;
  uHalf: THREE.IUniform<number>;
  uSettle: THREE.IUniform<number>;
  uLevel: THREE.IUniform<number>;
  uGrain: THREE.IUniform<number>;
  uSeed: THREE.IUniform<number>;
  uHover: THREE.IUniform<number>;
  uRamp: THREE.IUniform<THREE.Vector3[]>;
}

/** sRGB pigment stops as linear colours, the way the material blends them. */
const LINEAR: Record<Pigment, THREE.Vector3[]> = Object.fromEntries(
  Object.entries(PIGMENTS).map(([k, ramp]) => [
    k,
    ramp.map(([r, g, b]) => {
      const c = new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
      return new THREE.Vector3(c.r, c.g, c.b);
    }),
  ]),
) as Record<Pigment, THREE.Vector3[]>;

/** Where a plate's sand, swing, glow and pigment are heading. */
interface Target {
  settle: number;
  level: number;
  motion: number;
  pigment: Pigment;
  hover: number;
}

/**
 * One plate's surface: a standard metal material whose colour, roughness and
 * glow are patched with the figure's sand, and, with `relief`, whose vertices
 * swing with it. Keeps two figures, so the sand can move from one to the next.
 */
class PlateField {
  readonly material: THREE.MeshStandardMaterial;
  readonly u: FieldUniforms;
  private a: Figure = STILL;
  private b: Figure = STILL;
  private key: string | null = null;
  private settle = 0;
  private level = 0;
  private swing = 0;
  private hover = 0;

  constructor(half: number, seed: number, relief: boolean, grain: number) {
    const terms = () => Array.from({ length: TERMS }, () => new THREE.Vector4());
    const coefs = () => Array.from({ length: TERMS }, () => new THREE.Vector2());
    this.u = {
      uTermA: { value: terms() },
      uCoefA: { value: coefs() },
      uCountA: { value: 0 },
      uWeightA: { value: new THREE.Vector4() },
      uTermB: { value: terms() },
      uCoefB: { value: coefs() },
      uCountB: { value: 0 },
      uWeightB: { value: new THREE.Vector4() },
      uMix: { value: 1 },
      uPhaseCosA: { value: new THREE.Vector4(1, 1, 1, 1) },
      uPhaseSinA: { value: new THREE.Vector4() },
      uPhaseCosB: { value: new THREE.Vector4(1, 1, 1, 1) },
      uPhaseSinB: { value: new THREE.Vector4() },
      uSwing: { value: 0 },
      uHalf: { value: half },
      uSettle: { value: 0 },
      uLevel: { value: 0 },
      uGrain: { value: grain },
      uSeed: { value: seed },
      uHover: { value: 0 },
      uRamp: { value: LINEAR.bone.map((v) => v.clone()) },
    };
    // Brushed bronze, as Chladni's plates were brass: dark enough that the
    // sand carries the figure, metallic enough to catch the room's lights.
    this.material = new THREE.MeshStandardMaterial({
      color: "#8a7558",
      metalness: 0.55,
      roughness: 0.4,
      emissive: "#000000",
    });
    const u = this.u;
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\n${HEAD}\n${VERTEX_HEAD}`)
        .replace(
          "#include <beginnormal_vertex>",
          relief
            ? /* glsl */ `#include <beginnormal_vertex>
vPlate = uv * 2.0 - 1.0;
float rLift = rSwing(vPlate);
// The plate moves a few millimetres; its slopes are shown steeper, as the
// studio exaggerates its relief, so the light can find them.
float rDx = 6.0 * (rSwing(vPlate + vec2(0.01, 0.0)) - rLift) / (0.01 * uHalf);
float rDy = 6.0 * (rSwing(vPlate + vec2(0.0, 0.01)) - rLift) / (0.01 * uHalf);
objectNormal = normalize(vec3(-rDx, -rDy, 1.0));`
            : `#include <beginnormal_vertex>\nvPlate = uv * 2.0 - 1.0;\nfloat rLift = 0.0;`,
        )
        .replace(
          "#include <begin_vertex>",
          "#include <begin_vertex>\ntransformed.z += rLift;",
        );
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\n${HEAD}\n${FRAGMENT_HEAD}`)
        .replace("#include <color_fragment>", `#include <color_fragment>\n${SAND}`)
        .replace(
          "#include <roughnessmap_fragment>",
          "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.92, rSand);",
        )
        .replace(
          "#include <metalnessmap_fragment>",
          "#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.0, rSand);",
        )
        .replace(
          "#include <emissivemap_fragment>",
          /* glsl */ `#include <emissivemap_fragment>
totalEmissiveRadiance += rSandColor * rSand * uLevel * 0.08;
float rEdge = smoothstep(0.93, 1.0, max(abs(vPlate.x), abs(vPlate.y)));
totalEmissiveRadiance += vec3(0.05, 0.22, 0.22) * rEdge * uHover;`,
        );
    };
    const cacheKey = `rain-resonance:${relief ? 1 : 0}`;
    this.material.customProgramCacheKey = () => cacheKey;
  }

  private static write(
    fig: Figure,
    terms: THREE.Vector4[],
    coefs: THREE.Vector2[],
    weights: THREE.Vector4,
  ) {
    const n = Math.min(fig.terms.length, TERMS);
    for (let i = 0; i < n; i++) {
      const t = fig.terms[i]!;
      terms[i]!.set(t.m, t.n, t.sign, t.partial);
      coefs[i]!.set(t.re, t.im);
    }
    // A partial that is not sounding lays no sand.
    for (let p = 0; p < 4; p++) weights.setComponent(p, fig.weights[p] ?? 0);
    return n;
  }

  /** Moves the sand towards a new figure; the old one fades as the new one forms. */
  show(fig: Figure, key: string, instant: boolean) {
    if (key === this.key) return;
    this.key = key;
    this.a = this.u.uMix.value < 0.5 ? this.a : this.b;
    this.b = fig;
    const u = this.u;
    u.uCountA.value = PlateField.write(
      this.a,
      u.uTermA.value,
      u.uCoefA.value,
      u.uWeightA.value,
    );
    u.uCountB.value = PlateField.write(
      this.b,
      u.uTermB.value,
      u.uCoefB.value,
      u.uWeightB.value,
    );
    this.u.uMix.value = instant ? 1 : 0;
  }

  private static phases(fig: Figure, t: number, cos: THREE.Vector4, sin: THREE.Vector4) {
    const lead = fig.frequencies[fig.lead] ?? 1;
    for (let p = 0; p < 4; p++) {
      const f = fig.frequencies[p];
      const phase = f ? Math.PI * 2 * t * strobeRate(f, lead) : 0;
      cos.setComponent(p, Math.cos(phase));
      sin.setComponent(p, Math.sin(phase));
    }
  }

  /** Eases towards the targets; `t` is the clock the stroboscope follows. */
  tick(dt: number, t: number, target: Target, instant: boolean) {
    const u = this.u;
    const k = instant ? 1 : 1 - Math.exp(-dt * 1.6);
    u.uMix.value = instant ? 1 : Math.min(1, u.uMix.value + dt / CROSSFADE);
    this.settle += (target.settle - this.settle) * k;
    this.level += (target.level - this.level) * k;
    this.swing += (target.motion - this.swing) * k;
    this.hover += (target.hover - this.hover) * (instant ? 1 : 1 - Math.exp(-dt * 6));
    // Mid-move the sand is lifted: a figure never jumps into the next one.
    u.uSettle.value = this.settle * (1 - 0.55 * Math.sin(Math.PI * u.uMix.value));
    u.uLevel.value = this.level;
    u.uHover.value = this.hover;
    const strength = u.uMix.value < 0.5 ? this.a.strength : this.b.strength;
    // At most a few millimetres: the plate's body sits just below its surface.
    u.uSwing.value = this.swing * strength * 0.0018;
    PlateField.phases(this.a, t, u.uPhaseCosA.value, u.uPhaseSinA.value);
    PlateField.phases(this.b, t, u.uPhaseCosB.value, u.uPhaseSinB.value);
    const ramp = LINEAR[target.pigment];
    for (let i = 0; i < 5; i++) u.uRamp.value[i]!.lerp(ramp[i]!, instant ? 1 : k);
  }

  dispose() {
    this.material.dispose();
  }
}

/** A soft dark pool under the plinth: the instrument stands on the floor, not above it. */
function contactShadow() {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const g = canvas.getContext("2d")!;
  const grad = g.createRadialGradient(
    size / 2,
    size / 2,
    2,
    size / 2,
    size / 2,
    size / 2,
  );
  grad.addColorStop(0, "rgba(0,0,0,0.62)");
  grad.addColorStop(0.55, "rgba(0,0,0,0.32)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** A rod from `a` to `b`, as a unit cylinder's position, rotation and length. */
function rod(a: readonly number[], b: readonly number[]) {
  const from = new THREE.Vector3(...a),
    to = new THREE.Vector3(...b);
  const dir = to.clone().sub(from);
  const length = dir.length();
  const q = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    dir.normalize(),
  );
  return {
    position: from.add(to).multiplyScalar(0.5),
    quaternion: q,
    length,
  };
}

const SOURCE_FIGURES: Record<Perspective, Figure> = Object.fromEntries(
  PERSPECTIVES.map((p) => {
    const mode = PERSPECTIVE_MODES[p];
    return [p, buildFigure([{ f: mode.f, a: 1 }], seat(mode), 4)];
  }),
) as Record<Perspective, Figure>;

const reducedMotion = () =>
  typeof matchMedia === "function" &&
  matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * R.A.I.N.'s resonance instrument. `read` returns the current view (cheap to
 * call: the caller caches it per store change). `quality` is where it starts;
 * under "auto" it steps down once frames stay slow, and never back up.
 */
export function RAINResonanceFace({
  read,
  quality: initial,
  auto,
  onInspect,
}: {
  read: () => ResonanceView;
  quality: ResonanceQuality;
  auto: boolean;
  onInspect: () => void;
}) {
  // The caller keys this component on its starting quality, so a new one starts afresh.
  const [quality, setQuality] = useState<ResonanceQuality>(initial);
  const { gl, camera } = useThree();
  const reduced = useMemo(reducedMotion, []);
  const half = MAIN.size / 2;
  const main = useMemo(
    () => new PlateField(half, 0.37, quality !== "low", GRAIN[quality]),
    [half, quality],
  );
  const sources = useMemo(
    () =>
      Object.fromEntries(
        PERSPECTIVES.map((p, i) => [
          p,
          new PlateField(SMALL / 2, 0.11 * (i + 1), false, GRAIN[quality]),
        ]),
      ) as Record<Perspective, PlateField>,
    [quality],
  );
  const steel = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#20282b",
        metalness: 0.7,
        roughness: 0.48,
      }),
    [],
  );
  const bronze = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#6f5d45",
        metalness: 0.6,
        roughness: 0.45,
      }),
    [],
  );
  const rim = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#2a2f31",
        metalness: 0.5,
        roughness: 0.5,
        emissive: BOUNDARY.clone(),
        emissiveIntensity: 0,
      }),
    [],
  );
  const couplings = useMemo(
    () =>
      Object.fromEntries(
        PERSPECTIVES.map((p) => [
          p,
          new THREE.MeshStandardMaterial({
            color: "#2b3336",
            metalness: 0.6,
            roughness: 0.4,
            emissive: COUPLING.clone(),
            emissiveIntensity: 0,
          }),
        ]),
      ) as Record<Perspective, THREE.MeshStandardMaterial>,
    [],
  );
  const shadow = useMemo(contactShadow, []);
  const rods = useMemo(
    () =>
      Object.fromEntries(
        PERSPECTIVES.map((p) => {
          const [x, y, z] = SOURCES[p];
          return [p, rod([x, y - 0.03, z], STEM_TOP)];
        }),
      ) as Record<Perspective, ReturnType<typeof rod>>,
    [],
  );
  const plateGeometry = useMemo(
    () =>
      new THREE.PlaneGeometry(MAIN.size, MAIN.size, SEGMENTS[quality], SEGMENTS[quality]),
    [quality],
  );
  const smallGeometry = useMemo(() => new THREE.PlaneGeometry(SMALL, SMALL, 1, 1), []);
  useEffect(
    () => () => {
      main.dispose();
      for (const p of PERSPECTIVES) sources[p].dispose();
      plateGeometry.dispose();
    },
    [main, sources, plateGeometry],
  );
  useEffect(
    () => () => {
      steel.dispose();
      bronze.dispose();
      rim.dispose();
      for (const p of PERSPECTIVES) couplings[p].dispose();
      shadow.dispose();
      smallGeometry.dispose();
      gl.domElement.style.cursor = "";
    },
    [steel, bronze, rim, couplings, shadow, smallGeometry, gl],
  );

  /** Which plate the pointer is on: the large one, a perspective's, or none. */
  const hovered = useRef<"main" | Perspective | null>(null);
  const shown = useRef<string | null>(null);
  /** The field the shown key was given to: a step down builds new ones, which start afresh. */
  const shownFor = useRef<PlateField | null>(null);
  const slow = useRef(0);
  const settled = useRef(0);
  const boundary = useRef(0);
  const world = useMemo(
    () => new THREE.Vector3(RESONANCE.at.x, MAIN.at[1], RESONANCE.at.z + MAIN.at[2]),
    [],
  );
  // Targets are written in place each frame: nothing is allocated on the loop.
  const mainTarget = useRef<Target>({
    settle: 0,
    level: 0,
    motion: 0,
    pigment: "bone",
    hover: 0,
  }).current;
  const sourceTarget = useRef<Target>({
    settle: 0,
    level: 0,
    motion: 0,
    pigment: "bone",
    hover: 0,
  }).current;
  useFrame((state, dt) => {
    const view = read();
    const first = shownFor.current !== main;
    if (first || view.key !== shown.current) {
      shown.current = view.key;
      shownFor.current = main;
      const drive = view.plate.drive;
      main.show(
        drive.length ? buildFigure(drive, drive[0]!.at, BUDGET[quality]) : STILL,
        view.key,
        first || reduced,
      );
    }
    const t = reduced ? 0 : state.clock.elapsedTime;
    // Near or pointed at, a plate's edge catches a little light; nothing else changes.
    const near = Math.max(0, Math.min(1, (4 - camera.position.distanceTo(world)) / 2.5));
    mainTarget.settle = view.plate.settle;
    mainTarget.level = view.plate.level;
    mainTarget.motion = reduced ? 0 : view.plate.motion;
    mainTarget.pigment = view.plate.pigment;
    mainTarget.hover = Math.max(hovered.current === "main" ? 1 : 0, near * 0.35);
    main.tick(dt, t, mainTarget, first || reduced);
    for (const p of PERSPECTIVES) {
      const s = view.sources[p];
      const on = s.level >= 0.15;
      sources[p].show(
        on ? SOURCE_FIGURES[p] : STILL,
        on ? "on" : "off",
        first || reduced,
      );
      sourceTarget.settle = on ? 0.9 : 0;
      sourceTarget.level = s.level;
      sourceTarget.pigment = view.plate.pigment;
      sourceTarget.hover = Math.max(hovered.current === p ? 1 : 0, s.speaking ? 0.6 : 0);
      sources[p].tick(dt, t, sourceTarget, first || reduced);
      const c = couplings[p];
      c.emissiveIntensity +=
        (s.level * 0.5 - c.emissiveIntensity) * (reduced ? 1 : 1 - Math.exp(-dt * 2));
    }
    boundary.current +=
      ((view.boundary ? 1 : 0) - boundary.current) *
      (reduced ? 1 : 1 - Math.exp(-dt * 1.5));
    rim.emissiveIntensity = boundary.current * 0.9;
    // Two seconds of frames slower than 28 fps step the instrument down a level,
    // once per level. A hitch — a hidden tab coming back, a shader compiling —
    // is not slowness: frames over half a second, and the first second after
    // the instrument appears, are not counted.
    settled.current += Math.min(dt, 0.5);
    if (auto && quality !== "low" && settled.current > 1 && dt < 0.5) {
      slow.current =
        dt > 1 / 28 ? slow.current + dt : Math.max(0, slow.current - dt * 0.5);
      if (slow.current > 2) {
        slow.current = 0;
        setQuality(quality === "high" ? "medium" : "low");
      }
    }
  });

  const [mx, my, mz] = MAIN.at;
  const pointer = (which: "main" | Perspective) => ({
    onPointerOver: () => {
      hovered.current = which;
      gl.domElement.style.cursor = "pointer";
    },
    onPointerOut: () => {
      if (hovered.current === which) hovered.current = null;
      gl.domElement.style.cursor = "";
    },
    // A drag across the plate is a look, not a click.
    onClick: (e: ThreeEvent<MouseEvent>) => {
      if (e.delta <= 4) onInspect();
    },
  });
  return (
    <group position={[RESONANCE.at.x, 0, RESONANCE.at.z]}>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.003, -0.05]} renderOrder={-1}>
        <planeGeometry args={[RESONANCE.width + 0.7, RESONANCE.depth + 0.6]} />
        <meshBasicMaterial
          map={shadow}
          transparent
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <mesh position={[0, 0.035, 0]} material={steel}>
        <boxGeometry args={[RESONANCE.width - 0.05, 0.07, RESONANCE.depth - 0.05]} />
      </mesh>
      <mesh position={[mx, (0.07 + my - 0.04) / 2, mz]} material={steel}>
        <cylinderGeometry args={[0.03, 0.04, my - 0.11, 16]} />
      </mesh>
      {PERSPECTIVES.map((p) => {
        const [x, y, z] = SOURCES[p];
        const r = rods[p];
        return (
          <group key={p}>
            <mesh position={[x, (0.07 + y - 0.03) / 2, z]} material={steel}>
              <cylinderGeometry args={[0.01, 0.014, y - 0.1, 8]} />
            </mesh>
            <mesh position={r.position} quaternion={r.quaternion} material={couplings[p]}>
              <cylinderGeometry args={[0.004, 0.004, r.length, 6]} />
            </mesh>
            <group position={[x, y, z]} rotation-x={TILT}>
              <mesh position={[0, -0.016, 0]} material={steel}>
                <cylinderGeometry args={[0.022, 0.022, 0.02, 12]} />
              </mesh>
              <mesh material={bronze}>
                <boxGeometry args={[SMALL, 0.005, SMALL]} />
              </mesh>
              <mesh
                rotation-x={-Math.PI / 2}
                position={[0, 0.0026, 0]}
                geometry={smallGeometry}
                material={sources[p].material}
                {...pointer(p)}
              />
            </group>
          </group>
        );
      })}
      <group position={[mx, my, mz]} rotation-x={TILT}>
        <mesh position={[0, -0.026, 0]} material={steel}>
          <cylinderGeometry args={[0.05, 0.05, 0.025, 20]} />
        </mesh>
        <mesh position={[0, -0.0062, 0]} material={bronze}>
          <boxGeometry args={[MAIN.size, 0.008, MAIN.size]} />
        </mesh>
        <mesh
          rotation-x={-Math.PI / 2}
          position={[0, 0, 0]}
          geometry={plateGeometry}
          material={main.material}
          {...pointer("main")}
        />
        {/* The boundary: a thin guard round the plate, lit only while a person must decide. */}
        {[
          [0, -(half + 0.025), MAIN.size + 0.062, 0.012],
          [0, half + 0.025, MAIN.size + 0.062, 0.012],
          [-(half + 0.025), 0, 0.012, MAIN.size + 0.038],
          [half + 0.025, 0, 0.012, MAIN.size + 0.038],
        ].map(([x, z, w, d], i) => (
          <mesh key={i} position={[x!, 0.001, z!]} material={rim}>
            <boxGeometry args={[w!, 0.01, d!]} />
          </mesh>
        ))}
      </group>
      {/* Always mounted, so the room's light count never changes; dark at economy. */}
      <pointLight
        position={[0, 2.25, 0.45]}
        intensity={quality === "low" ? 0 : 1.5}
        distance={3}
        decay={2}
        color="#e3f2ee"
      />
    </group>
  );
}
