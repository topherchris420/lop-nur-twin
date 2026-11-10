/**
 * What moves on the model: the fly, the people and vehicles the life reports
 * near it, and the fly's recent path. All of it is placed from observations
 * and nothing here decides where anything goes.
 *
 * - **The fly** is the garden's clay puppet (`garden/scene/fly.ts`: FlyBody's
 *   own shape on its own skeleton), enlarged until it can be seen and stood
 *   where the life says the fly is. Its legs and wings are posed from the
 *   mode the life reports; the life sends no joint angles. In the air it is
 *   lifted clear of the model, as a puppet is flown on a rig, so that flying
 *   reads as flying at this scale.
 *   Enlarged, it would cut into any wall it stands beside, so it is drawn a
 *   body length nearer the lens than it stands: in front of what it touches.
 *   Its shadow still falls from where it stands.
 * - **People and vehicles** are an architect's figures: plain pegs and
 *   blocks, larger than the model's scale, one shape for each kind. The life
 *   reports where they are, not which way they face, so a vehicle is laid
 *   along the nearest street.
 * - **The path** is a line of amber beads where the fly has been.
 *
 * Between two observations a figure is moved in a straight line, for drawing
 * only; a figure that cannot be matched to one in the next observation is
 * simply set down where it is next reported.
 */
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { ClayLibrary } from "../../../garden/scene/clay.js";
import {
  BODY_M,
  ClayFly,
  type FlyFrame,
  type FlyPosture,
} from "../../../garden/scene/fly.js";
import { blob, merge, tint } from "../../../garden/scene/geometry.js";
import type { GaitParams } from "../../fly/gait.js";
import { resolveParams } from "../../fly/params.js";
import { NEARBY_MAX } from "../../life/observation.js";
import { roadWays, type Point } from "../../model.js";
import { groundAt } from "../../terrain.js";
import type { PresentedPose } from "../witnessFeed.js";
import {
  advanceGait,
  matchAgents,
  MODEL_SCALE,
  postureOf,
  puppetCityLength,
  type Agent,
} from "./stage.js";

const P = resolveParams();
const GAIT: GaitParams = {
  stanceLegsAt1: P.stanceLegsAt1,
  stanceLegsAt4: P.stanceLegsAt4,
  swingMs: P.swingMs,
  stepPeriodFloorMs: P.stepPeriodFloorMs,
  walkSpeedMinCmS: P.walkSpeedMinCmS,
  walkSpeedMaxCmS: P.walkSpeedMaxCmS,
};

/** How far, in its own body lengths, the flying puppet is held above where the fly is. */
const AIR_LIFT = 0.85;
/** Seconds the lift takes to follow a take-off or a landing. */
const LIFT_SETTLE = 0.3;

/**
 * How much nearer the lens the puppet is drawn than it stands, in clip-space
 * depth (set each frame for the lens's distance). Only the depth it is tested
 * and written at moves: its place in the picture, its light and its shadow do
 * not.
 */
const PULL = { value: 0 };
const pulled = new WeakSet<THREE.Material>();

function pull(m: THREE.Material) {
  if (pulled.has(m)) return;
  pulled.add(m);
  const compile = m.onBeforeCompile,
    key = m.customProgramCacheKey;
  m.onBeforeCompile = (shader, renderer) => {
    compile.call(m, shader, renderer);
    shader.uniforms.uPuppetPull = PULL;
    shader.vertexShader = shader.vertexShader
      .replace("void main() {", "uniform float uPuppetPull;\nvoid main() {")
      .replace(
        "#include <project_vertex>",
        "#include <project_vertex>\n  gl_Position.z -= uPuppetPull * gl_Position.w;",
      );
  };
  m.customProgramCacheKey = () => `${key.call(m)}:pulled`;
  m.needsUpdate = true;
}

export class Puppet {
  /** Stands at the fly's feet, in model metres; scaled to the puppet's enlargement. */
  readonly rig = new THREE.Group();
  /** Its body length on the model (model metres) as last posed. */
  length = BODY_M;
  /** The middle of its body, in model metres: what the lens looks at. */
  readonly centre = new THREE.Vector3();
  private readonly fly: ClayFly;
  private gait = 0;
  private lift = 0;
  private readonly depths = new Map<THREE.Material, [number, number]>();

  constructor(private readonly lib: ClayLibrary) {
    this.rig.name = "fly puppet";
    this.fly = new ClayFly(lib);
    this.rig.add(this.fly.root);
    this.rig.visible = false;
  }

  set finest(lod: 0 | 1) {
    this.fly.finest = lod;
  }

  get ready(): boolean {
    return this.fly.status === "ready";
  }

  /**
   * Poses the puppet for one frame of the picture. `pose` is where the life
   * says the fly is (null: no fly is drawn), `mode` and `speedMS` what it
   * reports doing, `pxPerModelM` device pixels per model metre at the puppet.
   */
  update(
    pose: PresentedPose | null,
    reported: { mode: string; speedMS: number },
    zoom: number,
    frame: FlyFrame,
    dt: number,
    pxPerModelM: number,
    lens: { distance: number; near: number },
  ) {
    this.rig.visible = pose !== null;
    if (!pose) return;
    const posture = postureOf(reported.mode);
    const k = (puppetCityLength(zoom) * MODEL_SCALE) / BODY_M;
    this.length = BODY_M * k;
    const want = posture.airborne ? AIR_LIFT * this.length : 0;
    this.lift = dt > 0 ? want + (this.lift - want) * Math.exp(-dt / LIFT_SETTLE) : want;
    this.rig.position.set(
      pose.x * MODEL_SCALE,
      pose.y * MODEL_SCALE + this.lift,
      pose.z * MODEL_SCALE,
    );
    this.rig.scale.setScalar(k);
    this.centre.copy(this.rig.position);
    this.centre.y += this.length * 0.3;

    // The clay's marks are pressed as deep as the puppet is enlarged.
    this.lib.each((m) => {
      if (!m.name.startsWith("fly-")) return;
      const u = m.userData.clay;
      let base = this.depths.get(m);
      if (!base) {
        base = [u.uClayDepth.value, u.uClayReliefDepth.value];
        this.depths.set(m, base);
      }
      u.uClayDepth.value = base[0] * k;
      u.uClayReliefDepth.value = base[1] * k;
    });

    const walking = posture.mode === "walk";
    const speedCmS = walking ? reported.speedMS * 100 : 0;
    this.gait = advanceGait(this.gait, speedCmS, dt, GAIT);
    const posed: FlyPosture = {
      position: [0, 0, 0],
      // Forward is (cos yaw, −sin yaw) on a map with south down (units.ts).
      forward: [Math.cos(pose.yaw), 0, -Math.sin(pose.yaw)],
      up: [0, 1, 0],
      mode: posture.mode,
      groom: posture.groom,
      legs: posture.legs,
      wingsOpen: posture.wingsOpen,
      beating: posture.beating,
      walkSpeed: speedCmS,
      gaitClock: this.gait,
      yawRate: 0,
      proboscis: posture.proboscis,
      drowsy: 0,
      headYaw: 0,
      headPitch: 0,
      antenna: Math.sin(frame.time * 1.7),
      breath: Math.sin(frame.time * 2.6),
      // Its shadow is the key light's; the puppet's own contact spot is not used here.
      support: 0,
      ground: { position: [0, 0, 0], normal: [0, 1, 0] },
      altitude: 0,
    };
    this.fly.update(posed, frame, this.length * pxPerModelM, true);
    // The meshes arrive after the puppet is made: each material is pulled as it is first seen.
    this.fly.root.traverse((o) => {
      if (o instanceof THREE.Mesh) pull(o.material as THREE.Material);
    });
    // A body length nearer, in the depth buffer's terms: d(ndc) = 2 · near · d(z) / z².
    PULL.value = (2 * lens.near * 0.9 * this.length) / (lens.distance * lens.distance);
  }

  dispose() {
    this.fly.dispose();
    this.rig.removeFromParent();
  }
}

// ------------------------------------------------------------------ figures

interface AgentFrame {
  at: number;
  agents: readonly Agent[];
  /** For each agent, where the same one stood in the frame before; null if it cannot be told. */
  from: (Point | null)[];
}

const segments = roadWays.flatMap((w) =>
  w.points.slice(1).map((b, k) => ({ a: w.points[k]!, b })),
);

/** The heading (radians about y) of the street nearest `p`. */
function streetHeading(p: Point): number {
  let best = Infinity,
    heading = 0;
  for (const { a, b } of segments) {
    const dx = b.x - a.x,
      dz = b.z - a.z;
    const l2 = dx * dx + dz * dz || 1;
    const t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2));
    const d = Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t);
    if (d < best) {
      best = d;
      heading = Math.atan2(dx, dz);
    }
  }
  return heading;
}

const paint = (g: THREE.BufferGeometry, hex: number) => {
  const c = new THREE.Color(hex);
  return tint(g, () => c);
};

/** A peg with a head: an architect's scale figure. City metres, feet at the origin. */
function pegGeometry(): THREE.BufferGeometry {
  const body = new THREE.CylinderGeometry(0.2, 0.32, 1.2, 8).translate(0, 0.6, 0);
  const head = new THREE.SphereGeometry(0.25, 10, 8).translate(0, 1.5, 0);
  for (const g of [body, head]) g.deleteAttribute("uv");
  return merge([paint(body, 0xf1e9d8), paint(head, 0xf1e9d8)]);
}

/** A vehicle as three slabs of clay: body, a dark band of windows, a pale roof. Long axis along z. */
function vehicleGeometry(
  length: number,
  width: number,
  height: number,
  body: number,
  beacon: number | null,
): THREE.BufferGeometry {
  const slab = (w: number, h: number, l: number, y: number, hex: number) => {
    const g = new RoundedBoxGeometry(w, h, l, 2, Math.min(w, h) * 0.22).translate(
      0,
      y,
      0,
    );
    g.deleteAttribute("uv");
    return paint(g, hex);
  };
  const parts = [
    slab(width, height * 0.5, length, 0.35 + height * 0.25, body),
    slab(width * 0.94, height * 0.34, length * 0.96, 0.35 + height * 0.62, 0x20262c),
    slab(width, height * 0.16, length * 0.98, 0.35 + height * 0.86, 0xf2eee4),
  ];
  if (beacon !== null) {
    const light = new THREE.SphereGeometry(0.32, 8, 6).translate(0, 0.35 + height, 0);
    light.deleteAttribute("uv");
    parts.push(paint(light, beacon));
  }
  return merge(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
}

/** Figures are drawn this much larger than the model's scale, so they can be made out. */
const FIGURE_SCALE = { pedestrian: 1.9, bus: 1.25, emergency: 1.35 } as const;
type Kind = keyof typeof FIGURE_SCALE;
const isKind = (k: string): k is Kind => k in FIGURE_SCALE;

export class Figures {
  /** In city metres; scaled to the model. */
  readonly group = new THREE.Group();
  private readonly meshes: Record<Kind, THREE.InstancedMesh>;
  private frames: AgentFrame[] = [];
  private readonly headings = new Map<string, number>();

  constructor(lib: ClayLibrary) {
    this.group.name = "figures";
    this.group.scale.setScalar(MODEL_SCALE);
    const clay = lib.get("city-figure", {
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.5,
      scale: 0.008,
      smudge: 0.05,
    });
    const make = (g: THREE.BufferGeometry, name: string) => {
      const m = new THREE.InstancedMesh(g, clay, NEARBY_MAX);
      m.name = name;
      m.count = 0;
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      this.group.add(m);
      return m;
    };
    this.meshes = {
      pedestrian: make(pegGeometry(), "pedestrians"),
      bus: make(vehicleGeometry(12, 2.6, 3, 0x3d7fc0, null), "buses"),
      emergency: make(vehicleGeometry(7, 2.3, 2.7, 0xc8402f, 0xd8301f), "emergency"),
    };
  }

  /** A new observation's figures, received at `at` (the viewer's clock, ms). Null: none are drawn. */
  observe(agents: readonly Agent[] | null, at: number) {
    if (!agents) {
      this.frames = [];
      return;
    }
    const prev = this.frames.at(-1);
    this.frames.push({ at, agents, from: matchAgents(prev?.agents ?? [], agents) });
    if (this.frames.length > 6) this.frames.shift();
  }

  /** Stands the figures where they were at `when` (the viewer's clock, ms). */
  update(when: number) {
    const counts: Record<Kind, number> = { pedestrian: 0, bus: 0, emergency: 0 };
    // The newest frame at or before `when` is where figures come from; the one after, where they go.
    let i = this.frames.findIndex((f) => f.at > when);
    if (i < 0) i = this.frames.length;
    const next = this.frames[i] ?? this.frames[i - 1];
    const prev = this.frames[i - 1];
    if (next) {
      const t =
        prev && prev !== next ? Math.min(1, (when - prev.at) / (next.at - prev.at)) : 1;
      const m = new THREE.Matrix4(),
        q = new THREE.Quaternion(),
        up = new THREE.Vector3(0, 1, 0);
      next.agents.forEach((a, k) => {
        if (!isKind(a.kind)) return;
        const from = next.from[k];
        // A figure with no past in view appears with its observation, not before it.
        if (!from && t < 1) return;
        const p = from
          ? { x: from.x + (a.x - from.x) * t, z: from.z + (a.z - from.z) * t }
          : { x: a.x, z: a.z };
        const mesh = this.meshes[a.kind];
        const s = FIGURE_SCALE[a.kind];
        let heading = 0;
        if (a.kind !== "pedestrian") {
          // The nearest street rarely changes: looked up once per few metres travelled.
          const key = `${a.kind}:${Math.round(a.x / 4)}:${Math.round(a.z / 4)}`;
          heading = this.headings.get(key) ?? streetHeading(a);
          this.headings.set(key, heading);
          if (this.headings.size > 400) this.headings.clear();
        }
        q.setFromAxisAngle(up, heading);
        m.compose(
          new THREE.Vector3(p.x, groundAt(p) + 0.26, p.z),
          q,
          new THREE.Vector3(s, s, s),
        );
        mesh.setMatrixAt(counts[a.kind]++, m);
      });
    }
    for (const kind of Object.keys(this.meshes) as Kind[]) {
      const mesh = this.meshes[kind];
      mesh.count = counts[kind];
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  dispose() {
    for (const m of Object.values(this.meshes)) {
      m.geometry.dispose();
      m.dispose();
    }
    this.group.removeFromParent();
  }
}

// --------------------------------------------------------------------- path

const TRAIL_MAX = 240;
/** A bead is laid each time the fly has moved this far (city metres). */
const TRAIL_STEP_M = 0.5;
/** Further than this in one step is a jump (a pause, a restart): the path starts again. */
const TRAIL_JUMP_M = 20;

export class Trail {
  /** In city metres; scaled to the model. */
  readonly group = new THREE.Group();
  private readonly mesh: THREE.InstancedMesh;
  private points: [number, number, number][] = [];

  constructor(lib: ClayLibrary) {
    this.group.name = "path";
    this.group.scale.setScalar(MODEL_SCALE);
    const bead = blob(1, { detail: 1, seed: 0xbead, lumps: 0.1, squash: [1, 0.6, 1] });
    this.mesh = new THREE.InstancedMesh(
      bead,
      lib.get("city-path", {
        color: 0xe8b860,
        roughness: 0.42,
        scale: 0.006,
        smudge: 0.05,
        emissive: 0xe8b860,
        emissiveIntensity: 0.12,
      }),
      TRAIL_MAX,
    );
    this.mesh.name = "path beads";
    this.mesh.count = 0;
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
  }

  /** Lays the path up to `pose` (null: the path is forgotten) and sizes its beads for a zoom. */
  update(pose: PresentedPose | null, zoom: number) {
    if (!pose) this.points = [];
    else {
      const last = this.points.at(-1);
      const moved = last ? Math.hypot(last[0] - pose.x, last[2] - pose.z) : Infinity;
      if (last && moved > TRAIL_JUMP_M) this.points = [];
      if (!last || moved >= TRAIL_STEP_M) this.points.push([pose.x, pose.y, pose.z]);
      if (this.points.length > TRAIL_MAX) this.points.shift();
    }
    // Thick enough to see from far off, never thicker than a kerb is wide.
    const radius = Math.min(1.6, Math.max(0.12, 3.2 / zoom));
    const m = new THREE.Matrix4(),
      q = new THREE.Quaternion();
    const n = this.points.length;
    this.points.forEach((p, k) => {
      const s = radius * (0.35 + (0.65 * (k + 1)) / n);
      m.compose(
        new THREE.Vector3(p[0], p[1] + s * 0.4, p[2]),
        q,
        new THREE.Vector3(s, s, s),
      );
      this.mesh.setMatrixAt(k, m);
    });
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.dispose();
    this.group.removeFromParent();
  }
}
