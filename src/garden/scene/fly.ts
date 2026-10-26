/**
 * The fly, in clay. Its shape is FlyBody's (Apache-2.0): the same meshes,
 * decimated by the importer, on the same skeleton, posed by the same leg and
 * wing solver (`src/bethesda/fly/pose.ts`) the repository's other fly uses.
 * Nothing about its proportions is restyled; only its surface is made of
 * plasticine:
 *
 * - **Cuticle**: FlyBody's tan body colour and paler underside, modelled
 *   with a sculptor's thumbprints and tool marks at the scale of the fly, and
 *   darker posterior bands on each abdominal tergite (as on a real
 *   Drosophila, not in FlyBody's single colour).
 * - **Compound eyes**: brick red, every ommatidium a tiny dome with a glint,
 *   and the dark deep pseudopupil where the ommatidia look straight at the
 *   lens, so the eye follows the viewer as a real fly's appears to. No pupils,
 *   no eyelids, no face.
 * - **Wings**: thin iridescent film with brown veins. A beating wing (about
 *   200 beats a second) is drawn as the translucent sweep a camera records.
 * - **Stop motion**: the pose changes only on the animation's frames, each
 *   frame's clay marks shift a little, as handled clay does, and small seeded
 *   differences between frames give the head, antennae and abdomen the
 *   restlessness of a puppet re-posed by hand. All of it is presentation:
 *   positions and timings come from the presented state, never the reverse.
 */
import * as THREE from "three";
import type { GaitParams } from "../../bethesda/fly/gait.js";
import { bodyLocal, type BodyDef } from "../../bethesda/fly/kinematics.js";
import {
  decodePart,
  parseMeshFile,
  type MeshFile,
} from "../../bethesda/fly/meshCodec.js";
import { resolveParams } from "../../bethesda/fly/params.js";
import { PoseSolver, type PoseInput } from "../../bethesda/fly/pose.js";
import { SKELETON } from "../../bethesda/fly/skeleton.js";
import { strokeAt } from "../../bethesda/fly/wing.js";
import type { FlyPose } from "../core/performance.js";
import { boil } from "../core/stopMotion.js";
import { cross, type V3 } from "../core/vec.js";
import { withCascade, type ClayLibrary, type ClayMaterial } from "./clay.js";

const P = resolveParams();
const GAIT: GaitParams = {
  stanceLegsAt1: P.stanceLegsAt1,
  stanceLegsAt4: P.stanceLegsAt4,
  swingMs: P.swingMs,
  stepPeriodFloorMs: P.stepPeriodFloorMs,
  walkSpeedMinCmS: P.walkSpeedMinCmS,
  walkSpeedMaxCmS: P.walkSpeedMaxCmS,
};
export const BODY_M = SKELETON.measures.bodyLengthCm / 100;
const BY_NAME = new Map<string, BodyDef>(SKELETON.bodies.map((b) => [b.name, b]));
const WING_RANGE = (() => {
  const j = BY_NAME.get("wing_left")!.joints;
  return { yaw: j[0]!.range, roll: j[1]!.range, pitch: j[2]!.range };
})();
const GHOSTS = 6;
/** FlyBody's base wingbeat frequency (`_WING_PARAMS`); only its phase at frame times is drawn. */
const WINGBEAT_HZ = P.wingbeatHz;

/** FlyBody's meshes (emitted as hashed files by the build); fetched only when the fly is close enough to need them. */
const MESH_URL: Record<0 | 1, URL> = {
  0: new URL("../../bethesda/fly/data/flybody-lod0.json", import.meta.url),
  1: new URL("../../bethesda/fly/data/flybody-lod1.json", import.meta.url),
};

// ------------------------------------------------------------------ the eyes

/** The centre the facets are laid out around (head frame, cm), and their spacing (stereographic units ≈ radians). */
const EYE_CENTRE: V3 = [0.022, 0.017, 0.0035];
const EYE_RADIUS_CM = 0.023;
const FACET = 0.061;
const FACET_M = FACET * EYE_RADIUS_CM * 0.01;

const EYE_DECL = /* glsl */ `
varying vec3 vEyeAxis;
// Offset from the nearest hexagon centre, in cells (Shane's hex tiling).
vec2 eyeHex( vec2 p ) {
  const vec2 s = vec2( 1.0, 1.7320508 );
  vec4 c = floor( vec4( p, p - vec2( 0.5, 1.0 ) ) / s.xyxy ) + 0.5;
  vec2 a = p - c.xy * s;
  vec2 b = p - ( c.zw + 0.5 ) * s;
  return dot( a, a ) < dot( b, b ) ? a : b;
}
`;

const EYE_COLOR = /* glsl */ `
  vec3 eyeP = vClayPos - vec3( sign( vClayPos.x ) * ${EYE_CENTRE[0]}, ${EYE_CENTRE[1]}, ${EYE_CENTRE[2]} );
  vec3 eyeD = normalize( eyeP );
  // Stereographic from the eye's inner pole: conformal, so facets stay hexagonal.
  vec2 eyeQ = vec2( eyeD.y, eyeD.z ) * 2.0 / ( 1.0 + abs( eyeD.x ) ) / ${FACET.toFixed(4)};
  vec2 eyeO = eyeHex( eyeQ );
  float eyeKeep = 1.0 - smoothstep( 0.3, 0.8, length( fwidth( eyeQ ) ) );
  vec2 eyeA = abs( eyeO );
  float eyeEdge = max( dot( eyeA, vec2( 0.5, 0.8660254 ) ), eyeA.x );
  diffuseColor.rgb *= 1.0 - 0.4 * smoothstep( 0.34, 0.5, eyeEdge ) * eyeKeep;
  // The deep pseudopupil.
  float eyePupil = smoothstep( 0.962, 0.993, dot( normalize( vEyeAxis ), normalize( vViewPosition ) ) );
  diffuseColor.rgb *= 1.0 - 0.82 * eyePupil;
`;

const EYE_NORMAL = /* glsl */ `
  {
    float dome = sqrt( max( 0.0, 1.0 - 4.0 * dot( eyeO, eyeO ) ) );
    normal = clayRelief( - vViewPosition, normal, ${(FACET_M * 0.22).toExponential(4)} * dome * eyeKeep, faceDirection );
  }
`;

const EYE_PATCH = {
  key: "compound-eye",
  apply(shader: THREE.WebGLProgramParametersWithUniforms) {
    const c = EYE_CENTRE;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vEyeAxis;")
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>\nvEyeAxis = mat3( modelViewMatrix ) * ( transformed - vec3( sign( transformed.x ) * ${c[0]}, ${c[1]}, ${c[2]} ) );`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${EYE_DECL}`)
      .replace("#include <color_fragment>", `#include <color_fragment>\n${EYE_COLOR}`)
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>\n${EYE_NORMAL}`,
      );
  },
};

// ------------------------------------------------------------- materials

const flyRGB = (name: string): THREE.Color => {
  const def = SKELETON.materials.find((m) => m.name === name);
  const [r, g, b] = def?.rgba ?? [0.5, 0.5, 0.5, 1];
  // As the repository's other fly view reads FlyBody's colours: sRGB.
  return new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
};

/**
 * The cuticle as a sculptor would mix it to match a living fruit fly: the tan
 * of a Drosophila melanogaster thorax, and the near-black of its abdominal
 * bands. FlyBody's own body colour is a simulator's orange; its other
 * colours (eyes, legs, ocelli, veins) are kept.
 */
const CUTICLE = new THREE.Color().setRGB(0.6, 0.43, 0.25, THREE.SRGBColorSpace);
const BAND = new THREE.Color().setRGB(0.2, 0.13, 0.08, THREE.SRGBColorSpace);

/** Shared settings for the fly's clay: marks laid out on the fly itself, at its centimetre scale. */
const FLY_CLAY = {
  objectSpace: true,
  unit: 0.01,
  scale: 0.35,
  relief: 0.006,
  smudge: 0.08,
} as const;

function flyMaterials(lib: ClayLibrary) {
  const body = lib.get("fly-cuticle", {
    ...FLY_CLAY,
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.46,
    wrap: 0.5,
    scatter: 0xb0602a,
  });
  const lower = lib.get("fly-underside", {
    ...FLY_CLAY,
    color: flyRGB("lower"),
    roughness: 0.5,
    wrap: 0.55,
    scatter: 0xb07a3a,
  });
  const bristle = lib.get("fly-bristle", {
    ...FLY_CLAY,
    color: 0x120c08,
    roughness: 0.32,
    relief: 0.002,
    wrap: 0.1,
  });
  const eye = lib.get("fly-eye", {
    ...FLY_CLAY,
    color: new THREE.Color().setRGB(0.66, 0.07, 0.035, THREE.SRGBColorSpace),
    roughness: 0.26,
    relief: 0.0015,
    smudge: 0.04,
    wrap: 0.45,
    scatter: 0xa02010,
    patch: EYE_PATCH,
  });
  const ocelli = lib.get("fly-ocelli", {
    ...FLY_CLAY,
    color: flyRGB("ocelli"),
    roughness: 0.12,
    relief: 0.001,
  });
  const vein = lib.get("fly-vein", {
    ...FLY_CLAY,
    color: flyRGB("brown"),
    roughness: 0.42,
    relief: 0.002,
    side: THREE.DoubleSide,
  });
  const membrane = lib.keep(
    withCascade(
      new THREE.MeshPhysicalMaterial({
        color: 0xb9b7ae,
        roughness: 0.3,
        metalness: 0,
        transparent: true,
        opacity: 0.22,
        // Written to depth, so depth of field keeps the wing as sharp as the body it lies on.
        depthWrite: true,
        side: THREE.DoubleSide,
        iridescence: 1,
        iridescenceIOR: 1.38,
        iridescenceThicknessRange: [220, 720],
        envMapIntensity: 0.9,
      }),
    ),
  );
  const ghost = lib.keep(
    withCascade(
      new THREE.MeshPhysicalMaterial({
        color: 0xe8ecef,
        roughness: 0.5,
        transparent: true,
        opacity: 0.04,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    ),
  );
  const pick = (m: string): THREE.Material =>
    m === "body"
      ? body
      : m === "lower"
        ? lower
        : m === "red"
          ? eye
          : m === "ocelli"
            ? ocelli
            : m === "membrane"
              ? membrane
              : m === "brown"
                ? vein
                : bristle;
  const clay: ClayMaterial[] = [body, lower, bristle, eye, ocelli, vein];
  return { pick, clay, membrane, ghost };
}

/** Each abdominal tergite's posterior band, darker, fading round the sides (segment frame: +y toward the tip, +z dorsal). */
function bandColors(g: THREE.BufferGeometry, bodyName: string) {
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const base = CUTICLE,
    band = BAND;
  const next = SKELETON.bodies.find(
    (b) => b.parent === bodyName && b.name.startsWith("abdomen"),
  );
  const len = next ? Math.abs(next.pos[1]) : 0.018;
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    let dark = 0;
    if (bodyName.startsWith("abdomen")) {
      const along = pos.getY(i) / len;
      dark = smooth(0.42, 0.8, along) * smooth(-0.03, 0.0, pos.getZ(i)) * 0.8;
    }
    c.copy(base).lerp(band, dark);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

const toThree = (q: readonly number[], out: THREE.Quaternion) =>
  out.set(q[1]!, q[2]!, q[3]!, q[0]!);

// ------------------------------------------------------------- the rig

export type FlyStatus = "loading" | "ready" | "unavailable";

export interface FlyFrame {
  /** Animation frame index (stop motion) and the presented time it shows. */
  index: number;
  time: number;
  /** Stop motion's hand-made differences between frames (clay marks, small re-posing); off for smooth playback. */
  handmade: boolean;
}

export class ClayFly {
  /** Placed at the thorax, scaled from FlyBody's centimetres to metres. */
  readonly root = new THREE.Group();
  /** A soft dark spot on the surface under the fly, for the contact shadow that the shadow maps are too coarse to draw at a distance. */
  readonly contact: THREE.Mesh;
  readonly thorax = new THREE.Vector3();
  status: FlyStatus = "loading";
  /** The level drawn this frame, or -1 when too small to draw. */
  shown: -1 | 0 | 1 = -1;
  /** The most detailed level the quality preset allows. */
  finest: 0 | 1 = 0;
  private readonly groups = new Map<string, THREE.Group>();
  private readonly lods = new Map<number, THREE.Group[]>();
  private readonly loading = new Set<number>();
  private readonly ghosts: Record<"left" | "right", THREE.Group[]> = {
    left: [],
    right: [],
  };
  private readonly solver = new PoseSolver(GAIT);
  private readonly mats: ReturnType<typeof flyMaterials>;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly contactTexture: THREE.CanvasTexture;
  private disposed = false;
  private readonly basis = new THREE.Matrix4();

  constructor(lib: ClayLibrary) {
    this.root.name = "fly";
    this.root.scale.setScalar(0.01);
    for (const b of SKELETON.bodies) {
      const g = new THREE.Group();
      g.name = b.name;
      const f = bodyLocal(b, []);
      g.position.set(f.p[0], f.p[1], f.p[2]);
      toThree(f.q, g.quaternion);
      (b.parent ? this.groups.get(b.parent)! : this.root).add(g);
      this.groups.set(b.name, g);
    }
    this.mats = flyMaterials(lib);
    // The contact spot: a radial falloff, darkest under the body.
    const cv = document.createElement("canvas");
    cv.width = cv.height = 64;
    const cx = cv.getContext("2d")!;
    const grad = cx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(0,0,0,0.85)");
    grad.addColorStop(0.45, "rgba(0,0,0,0.35)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    cx.fillStyle = grad;
    cx.fillRect(0, 0, 64, 64);
    this.contactTexture = new THREE.CanvasTexture(cv);
    this.contactTexture.colorSpace = THREE.SRGBColorSpace;
    const spot = new THREE.MeshBasicMaterial({
      map: this.contactTexture,
      transparent: true,
      depthWrite: false,
      color: 0x000000,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    lib.keep(spot);
    this.contact = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), spot);
    this.contact.name = "fly contact";
    this.contact.renderOrder = 1;
    this.geometries.push(this.contact.geometry);
  }

  /** Starts fetching a level of detail (same origin, next to the bundle). */
  load(lod: 0 | 1): void {
    if (this.loading.has(lod) || this.status === "unavailable") return;
    this.loading.add(lod);
    fetch(MESH_URL[lod], { credentials: "same-origin" })
      .then((r) => {
        if (!r.ok) throw new Error(`fly mesh ${lod}: HTTP ${r.status}`);
        return r.json() as Promise<unknown>;
      })
      .then((raw) => {
        if (!this.disposed) this.attach(parseMeshFile(raw));
      })
      .catch((e: unknown) => {
        console.warn("garden: the fly's mesh could not be loaded", e);
        if (!this.lods.size) this.status = "unavailable";
      });
  }

  private attach(file: MeshFile) {
    const level = Number(file.lod.slice(3));
    const holders: THREE.Group[] = [];
    for (const part of file.parts) {
      const d = decodePart(part, file.quantumCm);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(d.positions, 3));
      geo.setIndex(new THREE.BufferAttribute(d.indices, 1));
      geo.computeVertexNormals();
      if (part.material === "body") bandColors(geo, part.body);
      this.geometries.push(geo);
      const body = this.groups.get(part.body);
      if (!body) throw new Error(`fly mesh: unknown body ${part.body}`);
      let holder = body.children.find((c) => c.userData.lod === level) as
        THREE.Group | undefined;
      if (!holder) {
        holder = new THREE.Group();
        holder.userData.lod = level;
        holder.visible = false;
        body.add(holder);
        holders.push(holder);
      }
      const mesh = new THREE.Mesh(geo, this.mats.pick(part.material));
      mesh.castShadow = part.material !== "membrane";
      mesh.receiveShadow = true;
      holder.add(mesh);
      // The beating-wing sweep: the membrane at six points of the stroke.
      if (level === 1 && part.material === "membrane") {
        const side = part.body === "wing_left" ? "left" : "right";
        const list = this.ghosts[side];
        if (!list.length) {
          const thorax = this.groups.get("thorax")!;
          for (let k = 0; k < GHOSTS; k++) {
            const g = new THREE.Group();
            g.position.copy(body.position);
            g.visible = false;
            thorax.add(g);
            list.push(g);
          }
        }
        for (const g of list) g.add(new THREE.Mesh(geo, this.mats.ghost));
      }
    }
    this.lods.set(level, holders);
    this.status = "ready";
  }

  /**
   * Poses the fly for one animation frame. `pixels` is the fly's length on
   * screen: below about two pixels it is not drawn (the observation view's
   * locator shows where it is), below about sixty the light mesh is used.
   */
  update(pose: FlyPose, frame: FlyFrame, pixels: number, inView: boolean): void {
    const footZ = this.solver.footZ;
    const up = new THREE.Vector3(...pose.up);
    const fwd = new THREE.Vector3(...pose.forward);
    const left = new THREE.Vector3(...cross(pose.up, pose.forward));
    this.thorax.set(...pose.position).addScaledVector(up, -footZ * 0.01);
    this.root.position.copy(this.thorax);
    this.basis.makeBasis(fwd, left, up);
    this.root.quaternion.setFromRotationMatrix(this.basis);

    // The contact spot: under the body, fading as it rises.
    const g = pose.ground;
    const lift = Math.max(0, pose.altitude);
    const spotFade = pose.support * Math.max(0, 1 - lift / 0.012);
    this.contact.visible = spotFade > 0.02 && pixels > 1.5;
    if (this.contact.visible) {
      const n = new THREE.Vector3(...g.normal);
      this.contact.position.set(...g.position).addScaledVector(n, 0.00004);
      this.contact.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
      const size = BODY_M * (1.15 + lift * 40);
      this.contact.scale.set(size, size * 0.8, 1);
      (this.contact.material as THREE.MeshBasicMaterial).opacity = 0.55 * spotFade;
      // Turn the spot's long axis along the body.
      const along = fwd.clone().addScaledVector(n, -fwd.dot(n));
      if (along.lengthSq() > 1e-12) {
        const angle = Math.atan2(
          along.dot(new THREE.Vector3(0, 1, 0).applyQuaternion(this.contact.quaternion)),
          along.dot(new THREE.Vector3(1, 0, 0).applyQuaternion(this.contact.quaternion)),
        );
        this.contact.rotateZ(angle);
      }
    }

    const want: -1 | 0 | 1 = pixels < 1.8 ? -1 : pixels < 60 || this.finest === 1 ? 1 : 0;
    if (want >= 0) {
      this.load(1);
      if (want === 0) this.load(0);
    }
    this.shown =
      want === 0 && this.lods.has(0) ? 0 : want >= 0 && this.lods.has(1) ? 1 : -1;
    this.root.visible = this.shown >= 0;
    if (!this.root.visible) return;
    for (const [lod, holders] of this.lods)
      for (const h of holders) h.visible = lod === this.shown;
    if (!inView) return;

    // Clay marks shift a little every frame, as handled clay does.
    const b = new THREE.Vector3(
      boil(frame.index, "fly-x"),
      boil(frame.index, "fly-y"),
      boil(frame.index, "fly-z"),
    ).multiplyScalar(frame.handmade ? 0.035 : 0);
    for (const m of this.mats.clay) m.userData.clay.uClayBoil.value.copy(b);

    const input: PoseInput = {
      mode: pose.mode,
      groom: pose.groom,
      legs: pose.legs,
      wingsOpen: pose.wingsOpen,
      walkSpeed: pose.walkSpeed,
      gaitClock: pose.gaitClock,
      yawRate: pose.yawRate,
      wingPhase: (2 * Math.PI * WINGBEAT_HZ * frame.time) % (2 * Math.PI),
      ampL: 1,
      ampR: 1,
      time: frame.time,
    };
    const angles = new Map(this.solver.solve(input));
    // The parts the leg and wing solver leaves at rest: head, mouthparts, antennae, abdomen.
    const jitter = (channel: string, amount: number) =>
      frame.handmade ? boil(frame.index, channel) * amount : 0;
    angles.set("head", [
      clampJoint("head", 0, pose.headYaw + jitter("head-yaw", 0.012)),
      0,
      clampJoint(
        "head",
        2,
        -pose.headPitch - 0.22 * pose.drowsy + jitter("head-pitch", 0.012),
      ),
    ]);
    const pr = pose.proboscis;
    angles.set("rostrum", [clampJoint("rostrum", 0, 0.18 + (-0.95 - 0.18) * pr)]);
    angles.set("haustellum", [0, clampJoint("haustellum", 1, 0.7 + (-0.75 - 0.7) * pr)]);
    angles.set("labrum_left", [clampJoint("labrum_left", 0, 0.55 * pr)]);
    angles.set("labrum_right", [clampJoint("labrum_right", 0, 0.55 * pr)]);
    for (const side of ["left", "right"] as const) {
      const lift =
        0.12 + 0.16 * pose.antenna - 0.15 * pose.drowsy + jitter(`antenna-${side}`, 0.03);
      angles.set(`antenna_${side}`, [
        0.05 + jitter(`antenna-spread-${side}`, 0.04),
        0,
        clampJoint(`antenna_${side}`, 2, lift),
      ]);
    }
    for (let k = 1; k <= 7; k++) {
      const name = k === 1 ? "abdomen" : `abdomen_${k}`;
      angles.set(name, [
        0,
        clampJoint(name, 1, 0.025 * pose.breath + jitter(`abdomen-${k}`, 0.006)),
      ]);
    }
    for (const [name, values] of angles) {
      const body = BY_NAME.get(name);
      const group = this.groups.get(name);
      if (body && group) toThree(bodyLocal(body, values).q, group.quaternion);
    }

    // A beating wing is drawn as the sweep a camera's shutter records.
    const sweep = pose.beating && pose.wingsOpen > 0.999;
    for (const side of ["left", "right"] as const) {
      const wing = this.groups.get(`wing_${side}`)!;
      for (const h of wing.children) h.visible = !sweep && h.userData.lod === this.shown;
      const body = BY_NAME.get(`wing_${side}`)!;
      this.ghosts[side].forEach((gh, k) => {
        gh.visible = sweep;
        if (!sweep) return;
        const s = strokeAt((2 * Math.PI * (k + 0.5)) / GHOSTS, 1, WING_RANGE);
        toThree(bodyLocal(body, [s.yaw, s.roll, s.pitch]).q, gh.quaternion);
      });
    }
  }

  dispose() {
    this.disposed = true;
    this.root.removeFromParent();
    this.contact.removeFromParent();
    for (const g of this.geometries) g.dispose();
    this.contactTexture.dispose();
  }
}

function clampJoint(body: string, joint: number, v: number): number {
  const j = BY_NAME.get(body)?.joints[joint];
  if (!j) return v;
  return Math.min(j.range[1], Math.max(j.range[0], v));
}
