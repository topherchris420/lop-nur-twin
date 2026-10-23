/**
 * Import the FlyBody adult Drosophila melanogaster model (TuragaLab/flybody,
 * Apache-2.0; Vaxenburg et al., Nature 643:1312–1320, 2025) as the digital
 * fly's anatomy, with provenance.
 *
 * Reads `flybody/fruitfly/assets/fruitfly.xml` and the OBJ meshes it names
 * from a clean checkout, and writes to `src/bethesda/fly/data/`:
 *
 * - `flybody-skeleton.json`: the body tree, hinge joints (axis, range, spring
 *   reference), tendons, materials, the `hover_up_dir` site and the two eye
 *   cameras exactly as the MJCF declares them, plus three lengths measured
 *   from the full-resolution meshes with every joint at zero.
 * - `flybody-lod0.json`, `flybody-lod1.json`: the visual meshes, placed in
 *   their bodies' frames, merged per body and material, welded and reduced by
 *   quadric edge collapse (`decimate.ts`) to two triangle budgets, then
 *   quantised (`meshCodec.ts`). Collision, inertial and fluid geoms are not
 *   imported: the browser fly does not run MuJoCo.
 * - `flybody.source.json`: the commit, the real import time, the hash of every
 *   input and output, the triangle counts before and after, and the list of
 *   modifications Apache-2.0 §4(b) asks a derivative to state.
 * - `LICENSE.md`: the Apache-2.0 text from the checkout, verbatim.
 *
 *   node scripts/run-ts.mjs scripts/import-flybody.ts --from ../flybody
 *
 * The checkout is read as data: nothing in it is executed. Never hand-edit the
 * outputs; re-import. `scripts/validate-bethesda.ts` fails when they disagree.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  apply,
  forwardKinematics,
  type BodyDef,
  type Frame,
  type Hinge,
  type Quat,
  type Vec3,
} from "../src/bethesda/fly/kinematics.ts";
import { encodePart, type EncodedPart } from "../src/bethesda/fly/meshCodec.ts";
import { decimate, weld, type Mesh } from "./decimate.ts";
import {
  child,
  children,
  Defaults,
  effective,
  numbers,
  parseXml,
  quat,
  vec3,
  type XmlNode,
} from "./mjcf.ts";

const REPO = resolve(fileURLToPath(new URL("..", import.meta.url)));
const OUT = join(REPO, "src", "bethesda", "fly", "data");
const MJCF = "flybody/fruitfly/assets/fruitfly.xml";
/** Position quantum: a quarter of a micrometre, far below what a screen resolves on a 3 mm fly. */
const QUANTUM_CM = 2.5e-5;
const LODS = [
  { name: "lod0", triangles: 40_000, floor: 48 },
  { name: "lod1", triangles: 5_000, floor: 12 },
] as const;

const args = process.argv.slice(2);
const fromIndex = args.indexOf("--from");
const from = fromIndex >= 0 ? args[fromIndex + 1] : undefined;
if (!from) {
  console.error("usage: import-flybody.ts --from <checkout of TuragaLab/flybody>");
  process.exit(2);
}
const source = resolve(from);
const git = (...argv: string[]) =>
  execFileSync("git", argv, { cwd: source, encoding: "utf8", timeout: 10_000 }).trim();
const commit = git("rev-parse", "HEAD");
if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error("the checkout's commit is unknown");
if (git("status", "--porcelain", "--untracked-files=no"))
  throw new Error("refusing to import from a checkout with uncommitted changes");
const commitDate = git("log", "-1", "--format=%cI", "HEAD");
const remote = git("remote", "get-url", "origin");
if (!/github\.com[/:]TuragaLab\/flybody(\.git)?$/i.test(remote))
  throw new Error(`the checkout's origin is not TuragaLab/flybody: ${remote}`);

const sha256 = (bytes: Buffer | string) =>
  createHash("sha256").update(bytes).digest("hex");
const inputs: { path: string; sha256: string; bytes: number }[] = [];
const readInput = (path: string): Buffer => {
  if (path.includes("..") || path.startsWith("/")) throw new Error(`unsafe path ${path}`);
  const bytes = readFileSync(join(source, path));
  inputs.push({ path, sha256: sha256(bytes), bytes: bytes.length });
  return bytes;
};

// --- MJCF ---------------------------------------------------------------
const xml = parseXml(readInput(MJCF).toString("utf8"));
const mujoco = child(xml, "mujoco");
if (!mujoco) throw new Error("no <mujoco> root");
const compiler = child(mujoco, "compiler");
if (compiler?.attrs.angle !== "radian") throw new Error('expected angle="radian"');
const defaults = new Defaults(child(mujoco, "default"));
const assets = child(mujoco, "asset");
if (!assets) throw new Error("no <asset>");

const materials = children(assets, "material").map((m) => {
  const rgba = numbers(m.attrs.rgba ?? "1 1 1 1", 4, `material ${m.attrs.name}`);
  return {
    name: String(m.attrs.name),
    rgba: rgba as [number, number, number, number],
    shininess: Number(m.attrs.shininess ?? 0.5),
  };
});
const meshAssets = new Map(
  children(assets, "mesh").map((m) => {
    const a = effective(defaults, m, "main");
    const scale = vec3(a.scale, `mesh ${a.name} scale`, [1, 1, 1]);
    if (a.refpos || a.refquat)
      throw new Error(`mesh ${a.name}: refpos/refquat unsupported`);
    return [String(a.name), { file: String(a.file), scale }] as const;
  }),
);

interface VisualGeom {
  body: string;
  mesh: string;
  material: string;
  frame: Frame;
}
const bodies: BodyDef[] = [];
const geoms: VisualGeom[] = [];
const sites: { name: string; body: string; pos: Vec3; quat: Quat }[] = [];
const eyes: { name: string; body: string; pos: Vec3; quat: Quat; fovyDeg: number }[] = [];
const ORIENTATION = ["euler", "axisangle", "xyaxes", "zaxis"];

function visit(node: XmlNode, parent: string | null, inherited: string) {
  const name = node.attrs.name;
  if (!name) throw new Error("unnamed body");
  if (ORIENTATION.some((k) => k in node.attrs))
    throw new Error(`body ${name}: only quat orientations are supported`);
  const cls = node.attrs.childclass ?? inherited;
  const joints: Hinge[] = [];
  for (const c of node.children) {
    if (c.tag === "freejoint") {
      if (parent !== null) throw new Error(`freejoint below the root in ${name}`);
      continue;
    }
    if (c.tag === "joint") {
      const a = effective(defaults, c, cls);
      if ((a.type ?? "hinge") !== "hinge")
        throw new Error(`joint ${a.name}: not a hinge`);
      if (a.pos && numbers(a.pos, 3, "joint pos").some((v) => v !== 0))
        throw new Error(`joint ${a.name}: off-origin joints unsupported`);
      if (a.ref) throw new Error(`joint ${a.name}: ref unsupported`);
      const range = numbers(a.range, 2, `joint ${a.name} range`) as [number, number];
      joints.push({
        name: String(a.name),
        axis: vec3(a.axis, `joint ${a.name} axis`, [0, 0, 1]),
        range,
        rest: Number(a.springref ?? 0),
      });
    } else if (c.tag === "geom" && c.attrs.mesh) {
      const a = effective(defaults, c, cls);
      if (ORIENTATION.some((k) => k in c.attrs))
        throw new Error(`geom ${a.name}: only quat orientations are supported`);
      if ((a.type ?? "mesh") !== "mesh") throw new Error(`geom ${a.name}: not a mesh`);
      geoms.push({
        body: name,
        mesh: String(a.mesh),
        material: String(a.material),
        frame: { p: vec3(a.pos, "geom pos", [0, 0, 0]), q: quat(a.quat, "geom quat") },
      });
    } else if (c.tag === "site" && c.attrs.name === "hover_up_dir") {
      sites.push({
        name: c.attrs.name,
        body: name,
        pos: vec3(c.attrs.pos, "site pos", [0, 0, 0]),
        quat: quat(c.attrs.quat, "site quat"),
      });
    } else if (c.tag === "camera" && /^eye_(left|right)$/.test(c.attrs.name ?? "")) {
      if (ORIENTATION.some((k) => k in c.attrs))
        throw new Error("eye camera orientation");
      eyes.push({
        name: String(c.attrs.name),
        body: name,
        pos: vec3(c.attrs.pos, "camera pos", [0, 0, 0]),
        quat: quat(c.attrs.quat, "camera quat"),
        fovyDeg: Number(c.attrs.fovy),
      });
    }
  }
  bodies.push({
    name,
    parent,
    pos: vec3(node.attrs.pos, `body ${name} pos`, [0, 0, 0]),
    quat: quat(node.attrs.quat, `body ${name} quat`),
    joints,
  });
  for (const c of children(node, "body")) visit(c, name, cls);
}
const world = child(mujoco, "worldbody");
const roots = world ? children(world, "body") : [];
if (roots.length !== 1 || roots[0]!.attrs.name !== "thorax")
  throw new Error("expected a single thorax root body");
visit(roots[0]!, null, "main");
// Quaternions as MuJoCo normalises them on load.
for (const b of bodies) {
  const n = Math.hypot(...b.quat);
  b.quat = b.quat.map((v) => v / n) as Quat;
}
const tendons = children(
  child(mujoco, "tendon") ?? { tag: "", attrs: {}, children: [] },
  "fixed",
).map((t) => ({
  name: String(t.attrs.name),
  joints: children(t, "joint").map((j) => ({
    joint: String(j.attrs.joint),
    coef: Number(j.attrs.coef),
  })),
}));

// --- Meshes -------------------------------------------------------------
function readObj(path: string): { soup: number[]; faces: number[] } {
  const text = readInput(path).toString("utf8");
  const v: number[] = [];
  const faces: number[] = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const [kw, ...rest] = t.split(/\s+/);
    if (kw === "v") {
      const xyz = rest.slice(0, 3).map(Number);
      if (xyz.length !== 3 || xyz.some((x) => !Number.isFinite(x)))
        throw new Error(`${path}: bad vertex`);
      v.push(...xyz);
    } else if (kw === "f") {
      const idx = rest.map((r) => Number(r.split("/")[0]) - 1);
      if (
        idx.length < 3 ||
        idx.some((i) => !Number.isInteger(i) || i < 0 || i >= v.length / 3)
      )
        throw new Error(`${path}: bad face`);
      for (let k = 1; k + 1 < idx.length; k++) faces.push(idx[0]!, idx[k]!, idx[k + 1]!);
    } else if (!["vt", "vn", "o", "g", "s", "mtllib", "usemtl"].includes(kw!))
      throw new Error(`${path}: unsupported OBJ statement ${kw}`);
  }
  return { soup: v, faces };
}

interface Group {
  body: string;
  material: string;
  soup: number[];
  faces: number[];
}
const groups = new Map<string, Group>();
let sourceTriangles = 0;
for (const g of geoms) {
  const asset = meshAssets.get(g.mesh);
  if (!asset) throw new Error(`unknown mesh ${g.mesh}`);
  if (!materials.some((m) => m.name === g.material))
    throw new Error(`unknown material ${g.material}`);
  const { soup, faces } = readObj(`flybody/fruitfly/assets/${asset.file}`);
  sourceTriangles += faces.length / 3;
  const key = `${g.body}\u0000${g.material}`;
  let group = groups.get(key);
  if (!group) {
    group = { body: g.body, material: g.material, soup: [], faces: [] };
    groups.set(key, group);
  }
  const base = group.soup.length / 3;
  for (let k = 0; k < soup.length; k += 3) {
    // MuJoCo draws a mesh geom at its file coordinates, scaled, then placed by
    // the geom's pos/quat (the inertial re-centring it applies is undone).
    const p = apply(g.frame, [
      soup[k]! * asset.scale[0],
      soup[k + 1]! * asset.scale[1],
      soup[k + 2]! * asset.scale[2],
    ]);
    group.soup.push(p[0], p[1], p[2]);
  }
  for (const f of faces) group.faces.push(base + f);
}
const ordered = [...groups.values()].sort(
  (a, b) =>
    bodies.findIndex((x) => x.name === a.body) -
      bodies.findIndex((x) => x.name === b.body) || a.material.localeCompare(b.material),
);
const welded = ordered.map((g) => ({ ...g, mesh: weld(g.soup, g.faces) }));

// --- Lengths measured at the rest pose ------------------------------------
const frames = forwardKinematics(bodies);
const worldVerts = (g: { body: string; mesh: Mesh }) => {
  const f = frames.get(g.body)!;
  const out: Vec3[] = [];
  for (let k = 0; k < g.mesh.positions.length; k += 3)
    out.push(
      apply(f, [
        g.mesh.positions[k]!,
        g.mesh.positions[k + 1]!,
        g.mesh.positions[k + 2]!,
      ]),
    );
  return out;
};
const axial = welded
  .filter((g) => /^(head|thorax|abdomen(_\d)?)$/.test(g.body))
  .flatMap(worldVerts);
const bodyLengthCm =
  Math.max(...axial.map((p) => p[0])) - Math.min(...axial.map((p) => p[0]));
const wingLengthCm = Math.max(
  ...welded
    .filter((g) => g.body === "wing_left" && g.material === "membrane")
    .flatMap((g) => {
      const f = frames.get(g.body)!;
      return worldVerts(g).map((p) =>
        Math.hypot(p[0] - f.p[0], p[1] - f.p[1], p[2] - f.p[2]),
      );
    }),
);
const claws = welded.filter((g) => g.body.startsWith("claw_")).flatMap(worldVerts);
const standingHeightCm = -Math.min(...claws.map((p) => p[2]));

// --- Reduction ------------------------------------------------------------
/** Budgets grow sublinearly with a part's source size, so small parts keep their shape. */
function budgets(total: number, floor: number): number[] {
  const n = welded.map((g) => g.mesh.triangles.length / 3);
  const w = n.map((x) => Math.pow(x, 0.7));
  const sum = w.reduce((a, b) => a + b, 0);
  return n.map((x, k) => Math.min(x, Math.max(floor, Math.round((total * w[k]!) / sum))));
}
const lodOutputs = LODS.map((lod) => {
  const b = budgets(lod.triangles, lod.floor);
  const parts: EncodedPart[] = welded.map((g, k) => {
    const reduced = decimate(g.mesh, b[k]!);
    return encodePart(
      g.body,
      g.material,
      reduced.positions,
      reduced.triangles,
      QUANTUM_CM,
    );
  });
  const triangles = parts.reduce((s, p) => s + p.i.length / 3, 0);
  return { name: lod.name, budget: lod.triangles, triangles, parts };
});

// --- Write --------------------------------------------------------------
/** Indented JSON with arrays of numbers kept on one line, so a part is one line, not thousands. */
function json(value: unknown, indent = ""): string {
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v === "number")) return `[${value.join(",")}]`;
    if (!value.length) return "[]";
    const inner = indent + "  ";
    return `[\n${value.map((v) => inner + json(v, inner)).join(",\n")}\n${indent}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    if (!entries.length) return "{}";
    const inner = indent + "  ";
    return `{\n${entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${json(v, inner)}`).join(",\n")}\n${indent}}`;
  }
  return JSON.stringify(value);
}
const round = (x: number) => Math.round(x * 1e6) / 1e6;
const skeleton = {
  schema: "flybody-skeleton/v1",
  units: "cm",
  frame:
    "MuJoCo body frames: x anterior, y the fly's left, z dorsal; quaternions [w, x, y, z]",
  bodies,
  tendons,
  materials,
  sites,
  eyes,
  measures: {
    bodyLengthCm: round(bodyLengthCm),
    wingLengthCm: round(wingLengthCm),
    standingHeightCm: round(standingHeightCm),
    method:
      "measured by the importer from the full-resolution meshes with every joint at zero (MuJoCo qpos0): body length is the head-to-abdomen extent along the thorax x axis, wing length the farthest membrane vertex from the left wing hinge, standing height the thorax origin above the lowest claw vertex",
  },
};
const outputs: Record<string, string> = {
  "flybody-skeleton.json": json(skeleton) + "\n",
};
for (const lod of lodOutputs)
  outputs[`flybody-${lod.name}.json`] =
    json({
      schema: "flybody-mesh/v1",
      lod: lod.name,
      quantumCm: QUANTUM_CM,
      triangles: lod.triangles,
      parts: lod.parts,
    }) + "\n";
// The licence as reproduced in LICENSE.md's fenced block (LF endings, one
// final newline); `inputs` keeps the hash of the file's own bytes.
const licenseBody =
  readInput("LICENSE").toString("utf8").replace(/\r\n/g, "\n").trimEnd() + "\n";
const licenseText =
  "# License of the FlyBody derivatives\n\n" +
  "`flybody-skeleton.json`, `flybody-lod0.json` and `flybody-lod1.json` are derived from\n" +
  `\`TuragaLab/flybody\` at commit ${commit} (${commitDate}): \`${MJCF}\` and the\n` +
  "OBJ meshes it names. FlyBody is published under the Apache License 2.0, reproduced\n" +
  "below. These files were modified from the originals; `flybody.source.json` lists every\n" +
  "modification, the per-file hashes and the import time.\n\n" +
  "Cite: Vaxenburg R, Siwanowicz I, Merel J, et al. Whole-body physics simulation of\n" +
  "fruit fly locomotion. Nature 643, 1312–1320 (2025). https://doi.org/10.1038/s41586-025-09029-4\n\n```\n" +
  licenseBody +
  "```\n";
const manifest = {
  schema: "flybody-source/v1",
  repository: "TuragaLab/flybody",
  repositoryUrl: "https://github.com/TuragaLab/flybody",
  commit,
  commitDate,
  importedAt: new Date().toISOString(),
  importer: "scripts/import-flybody.ts",
  license: "Apache-2.0",
  licenseSha256: sha256(licenseBody),
  citation: {
    text: "Vaxenburg R, Siwanowicz I, Merel J, et al. Whole-body physics simulation of fruit fly locomotion. Nature 643, 1312–1320 (2025).",
    doi: "10.1038/s41586-025-09029-4",
  },
  excluded:
    "The FlyBody figshare datasets (doi:10.25378/janelia.25309105: trained policies, reference flight and walking trajectories, grooming poses) are GPL-3.0 and are not imported. Neither is drosophila.blend, the collision, inertial or fluid geoms, the actuators or the sensors.",
  modifications: [
    "Visual mesh geoms only, transformed from OBJ file coordinates into their body frames by the MJCF mesh scale and geom pos/quat.",
    "Meshes merged per body and material, welded at identical positions, and reduced by quadric edge collapse to two levels of detail.",
    `Positions quantised to ${QUANTUM_CM} cm and stored as integer differences; indices renumbered by first use.`,
    "Texture coordinates and normals dropped (FlyBody's materials are untextured; normals are recomputed when drawn).",
    "Skeleton transcribed from the MJCF with default classes resolved; body quaternions normalised as MuJoCo does on load.",
  ],
  sourceTriangles,
  lods: lodOutputs.map((l) => ({
    name: l.name,
    budget: l.budget,
    triangles: l.triangles,
    parts: l.parts.length,
  })),
  inputs: inputs.sort((a, b) => a.path.localeCompare(b.path)),
  outputs: Object.fromEntries(
    Object.entries(outputs).map(([name, text]) => [name, sha256(text)]),
  ),
};
mkdirSync(OUT, { recursive: true });
const writeAtomic = (name: string, text: string) => {
  const path = join(OUT, name);
  writeFileSync(path + ".tmp", text);
  renameSync(path + ".tmp", path);
};
for (const [name, text] of Object.entries(outputs)) writeAtomic(name, text);
writeAtomic("LICENSE.md", licenseText);
writeAtomic("flybody.source.json", json(manifest) + "\n");
console.log(
  `imported FlyBody ${commit.slice(0, 12)}: ${bodies.length} bodies, ` +
    `${bodies.reduce((s, b) => s + b.joints.length, 0)} hinges, ${sourceTriangles} source triangles -> ` +
    lodOutputs.map((l) => `${l.name} ${l.triangles}`).join(", ") +
    `; body ${bodyLengthCm.toFixed(4)} cm, wing ${wingLengthCm.toFixed(4)} cm, stance ${standingHeightCm.toFixed(4)} cm`,
);
