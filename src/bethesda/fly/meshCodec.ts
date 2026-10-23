/**
 * The text encoding of the FlyBody mesh derivatives (`data/flybody-lod*.json`),
 * shared by the importer that writes them, the build validator that checks
 * them and the renderer that draws them.
 *
 * Positions are integers in units of `quantumCm`, in the frame of the body the
 * part belongs to, stored as differences from the previous vertex (x, y, z
 * interleaved). Vertices are numbered in order of first use, so each triangle
 * index is stored as the distance below the next unused number: 0 means "a new
 * vertex". Both choices only make the numbers small; decoding is exact.
 */
export interface EncodedPart {
  /** The FlyBody body (MJCF `<body name>`) this part moves with. */
  body: string;
  /** The FlyBody material (MJCF `<material name>`) it is drawn in. */
  material: string;
  vertices: number;
  p: number[];
  i: number[];
}

export interface DecodedPart {
  body: string;
  material: string;
  /** Centimetres, in the body's frame. */
  positions: Float32Array;
  indices: Uint16Array | Uint32Array;
}

export function encodePart(
  body: string,
  material: string,
  positionsCm: ArrayLike<number>,
  triangles: ArrayLike<number>,
  quantumCm: number,
): EncodedPart {
  const n = positionsCm.length / 3;
  const p: number[] = [];
  let px = 0,
    py = 0,
    pz = 0;
  for (let k = 0; k < n; k++) {
    const x = Math.round(positionsCm[3 * k]! / quantumCm),
      y = Math.round(positionsCm[3 * k + 1]! / quantumCm),
      z = Math.round(positionsCm[3 * k + 2]! / quantumCm);
    p.push(x - px, y - py, z - pz);
    px = x;
    py = y;
    pz = z;
  }
  const i: number[] = [];
  let next = 0;
  for (let t = 0; t < triangles.length; t++) {
    const idx = triangles[t]!;
    if (idx > next) throw new Error("vertices are not numbered in order of first use");
    i.push(next - idx);
    if (idx === next) next++;
  }
  if (next !== n) throw new Error("a vertex is never used");
  return { body, material, vertices: n, p, i };
}

/** Decodes one part, refusing anything malformed rather than drawing it. */
export function decodePart(part: EncodedPart, quantumCm: number): DecodedPart {
  const n = part.vertices;
  if (!Number.isInteger(n) || n < 3 || part.p.length !== 3 * n)
    throw new Error(`part ${part.body}/${part.material}: position count`);
  if (part.i.length % 3 !== 0 || part.i.length < 3)
    throw new Error(`part ${part.body}/${part.material}: index count`);
  const positions = new Float32Array(3 * n);
  let x = 0,
    y = 0,
    z = 0;
  for (let k = 0; k < n; k++) {
    const dx = part.p[3 * k]!,
      dy = part.p[3 * k + 1]!,
      dz = part.p[3 * k + 2]!;
    if (!Number.isInteger(dx) || !Number.isInteger(dy) || !Number.isInteger(dz))
      throw new Error(`part ${part.body}/${part.material}: non-integer position`);
    x += dx;
    y += dy;
    z += dz;
    positions[3 * k] = x * quantumCm;
    positions[3 * k + 1] = y * quantumCm;
    positions[3 * k + 2] = z * quantumCm;
  }
  const indices =
    n <= 0xffff ? new Uint16Array(part.i.length) : new Uint32Array(part.i.length);
  let next = 0;
  for (let t = 0; t < part.i.length; t++) {
    const code = part.i[t]!;
    if (!Number.isInteger(code) || code < 0 || code > next)
      throw new Error(`part ${part.body}/${part.material}: index out of range`);
    const idx = next - code;
    if (code === 0) next++;
    if (idx >= n)
      throw new Error(`part ${part.body}/${part.material}: index out of range`);
    indices[t] = idx;
  }
  if (next !== n) throw new Error(`part ${part.body}/${part.material}: unused vertices`);
  return { body: part.body, material: part.material, positions, indices };
}

export interface MeshFile {
  /** "lod0" (finest), "lod1", … */
  lod: string;
  quantumCm: number;
  triangles: number;
  parts: EncodedPart[];
}

/** A whole `flybody-lod*.json`, shape-checked; decode each part with `decodePart`. */
export function parseMeshFile(raw: unknown): MeshFile {
  const r = raw as Partial<MeshFile> & { schema?: unknown };
  if (!r || typeof r !== "object" || r.schema !== "flybody-mesh/v1")
    throw new Error("not a flybody-mesh/v1 file");
  if (
    typeof r.lod !== "string" ||
    !/^lod\d$/.test(r.lod) ||
    !(typeof r.quantumCm === "number" && r.quantumCm > 0)
  )
    throw new Error("flybody mesh: lod or quantum");
  if (!Number.isInteger(r.triangles) || !Array.isArray(r.parts))
    throw new Error("flybody mesh: triangles or parts");
  for (const p of r.parts)
    if (
      !p ||
      typeof p.body !== "string" ||
      typeof p.material !== "string" ||
      !Array.isArray(p.p) ||
      !Array.isArray(p.i)
    )
      throw new Error("flybody mesh: malformed part");
  return { lod: r.lod, quantumCm: r.quantumCm, triangles: r.triangles!, parts: r.parts };
}
