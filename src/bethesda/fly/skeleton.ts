/**
 * The FlyBody skeleton as imported (`data/flybody-skeleton.json`): bodies,
 * hinge joints, tendons, materials, the hover thrust direction and the eye
 * cameras, exactly as `fruitfly.xml` declares them, plus a few lengths
 * measured from the imported meshes at the model's rest pose.
 *
 * Read through `SKELETON` so the rest of the fly never touches raw JSON. The
 * parse is strict: a missing parent, an unknown joint or a non-unit quaternion
 * fails at import time, not as a twisted leg on screen.
 */
import data from "./data/flybody-skeleton.json" with { type: "json" };
import type { BodyDef, Quat, Vec3 } from "./kinematics.js";

export interface MaterialDef {
  name: string;
  /** Linear RGBA as MuJoCo uses it, each in [0, 1]. */
  rgba: [number, number, number, number];
  shininess: number;
}
export interface SiteDef {
  name: string;
  body: string;
  pos: Vec3;
  quat: Quat;
}
export interface EyeDef extends SiteDef {
  /**
   * The eye camera's `fovy` as the MJCF file declares it, degrees (140).
   * FlyBody's walker sets it to 150° when it builds the fly; the senses use
   * that value (`eyeFovDeg` in params.ts), not this one.
   */
  fovyDeg: number;
}
export interface TendonDef {
  name: string;
  joints: { joint: string; coef: number }[];
}
export interface Measures {
  /** Head to abdomen tip along the thorax x axis, all joints at zero (cm). */
  bodyLengthCm: number;
  /** Farthest wing-membrane vertex from the wing hinge (cm). */
  wingLengthCm: number;
  /** Thorax origin above the lowest claw tip, all joints at zero (cm). */
  standingHeightCm: number;
}
export interface Skeleton {
  bodies: BodyDef[];
  tendons: TendonDef[];
  materials: MaterialDef[];
  sites: SiteDef[];
  eyes: EyeDef[];
  measures: Measures;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const vec = (v: unknown, n: number, what: string): number[] => {
  if (!Array.isArray(v) || v.length !== n || !v.every(isNum))
    throw new Error(`flybody skeleton: ${what}`);
  return v;
};
const unit = (q: number[], what: string): Quat => {
  if (Math.abs(Math.hypot(...q) - 1) > 1e-3)
    throw new Error(`flybody skeleton: ${what} is not a unit quaternion`);
  return q as Quat;
};

export function parseSkeleton(raw: unknown): Skeleton {
  const r = raw as Record<string, unknown>;
  if (r.schema !== "flybody-skeleton/v1") throw new Error("flybody skeleton: schema");
  if (r.units !== "cm") throw new Error("flybody skeleton: units");
  const names = new Set<string>();
  const bodies = (r.bodies as unknown[]).map((b0, k) => {
    const b = b0 as Record<string, unknown>;
    const name = String(b.name);
    const parent = b.parent === null ? null : String(b.parent);
    if (k === 0 ? parent !== null : parent === null || !names.has(parent))
      throw new Error(`flybody skeleton: ${name} has no earlier parent`);
    names.add(name);
    return {
      name,
      parent,
      pos: vec(b.pos, 3, `${name}.pos`) as Vec3,
      quat: unit(vec(b.quat, 4, `${name}.quat`), `${name}.quat`),
      joints: (b.joints as unknown[]).map((j0) => {
        const j = j0 as Record<string, unknown>;
        const range = vec(j.range, 2, `${name} joint range`) as [number, number];
        if (!(range[0] < range[1]))
          throw new Error(`flybody skeleton: ${name} joint range`);
        const axis = vec(j.axis, 3, `${name} joint axis`) as Vec3;
        if (!(Math.hypot(...axis) > 0))
          throw new Error(`flybody skeleton: ${name} joint axis`);
        if (!isNum(j.rest)) throw new Error(`flybody skeleton: ${name} joint rest`);
        return { name: String(j.name), axis, range, rest: j.rest };
      }),
    };
  });
  const joints = new Set(bodies.flatMap((b) => b.joints.map((j) => j.name)));
  const tendons = (r.tendons as TendonDef[]).map((t) => {
    for (const j of t.joints)
      if (!joints.has(j.joint) || !isNum(j.coef))
        throw new Error(`flybody skeleton: tendon ${t.name}`);
    return t;
  });
  const materials = (r.materials as MaterialDef[]).map((m) => {
    vec(m.rgba, 4, `material ${m.name}`);
    if (m.rgba.some((c) => c < 0 || c > 1))
      throw new Error(`flybody skeleton: ${m.name}`);
    return m;
  });
  const site = (s: SiteDef): SiteDef => {
    if (!names.has(s.body)) throw new Error(`flybody skeleton: site ${s.name} body`);
    return {
      name: s.name,
      body: s.body,
      pos: vec(s.pos, 3, `site ${s.name}`) as Vec3,
      quat: unit(vec(s.quat, 4, `site ${s.name}`), `site ${s.name}`),
    };
  };
  const sites = (r.sites as SiteDef[]).map(site);
  const eyes = (r.eyes as EyeDef[]).map((e) => {
    if (!isNum(e.fovyDeg) || e.fovyDeg <= 0 || e.fovyDeg >= 180)
      throw new Error(`flybody skeleton: eye ${e.name} fovy`);
    return { ...site(e), fovyDeg: e.fovyDeg };
  });
  const m = r.measures as Measures;
  for (const k of ["bodyLengthCm", "wingLengthCm", "standingHeightCm"] as const)
    if (!isNum(m[k]) || m[k] <= 0 || m[k] > 1) throw new Error(`flybody skeleton: ${k}`);
  return { bodies, tendons, materials, sites, eyes, measures: m };
}

export const SKELETON: Skeleton = parseSkeleton(data);

export const bodyIndex = (s: Skeleton = SKELETON) =>
  new Map(s.bodies.map((b, i) => [b.name, i] as const));
