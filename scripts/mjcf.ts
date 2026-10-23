/**
 * The small part of MJCF (MuJoCo's XML) that `import-flybody.ts` needs, read
 * strictly: elements, attributes, the `<default>` class tree, `childclass`
 * inheritance and the body tree. Anything the importer would have to guess at
 * — an orientation given as Euler angles on a visual mesh, a slide joint, an
 * unknown default class — is refused rather than approximated.
 */
import type { Quat, Vec3 } from "../src/bethesda/fly/kinematics.ts";

export interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: XmlNode[];
}

const ENTITIES: Record<string, string> = {
  "&quot;": '"',
  "&apos;": "'",
  "&lt;": "<",
  "&gt;": ">",
  "&amp;": "&",
};
const decode = (s: string) => s.replace(/&(quot|apos|lt|gt|amp);/g, (m) => ENTITIES[m]!);

/** Elements and attributes only; text content, CDATA and DTDs are not part of MJCF here. */
export function parseXml(text: string): XmlNode {
  const root: XmlNode = { tag: "#document", attrs: {}, children: [] };
  const stack: XmlNode[] = [root];
  let i = 0;
  while (i < text.length) {
    const lt = text.indexOf("<", i);
    if (lt < 0) break;
    if (text.slice(i, lt).trim()) throw new Error(`unexpected text at ${i}`);
    if (text.startsWith("<!--", lt)) {
      const end = text.indexOf("-->", lt);
      if (end < 0) throw new Error("unterminated comment");
      i = end + 3;
      continue;
    }
    if (text.startsWith("<?", lt)) {
      const end = text.indexOf("?>", lt);
      if (end < 0) throw new Error("unterminated declaration");
      i = end + 2;
      continue;
    }
    if (text.startsWith("<!", lt)) throw new Error("DTD and CDATA are not supported");
    let gt = lt + 1,
      quote = "";
    for (; gt < text.length; gt++) {
      const c = text[gt]!;
      if (quote) {
        if (c === quote) quote = "";
      } else if (c === '"' || c === "'") quote = c;
      else if (c === ">") break;
    }
    if (gt >= text.length) throw new Error("unterminated tag");
    const inner = text.slice(lt + 1, gt).trim();
    i = gt + 1;
    if (inner.startsWith("/")) {
      const name = inner.slice(1).trim();
      const top = stack.pop();
      if (!top || top.tag !== name) throw new Error(`mismatched </${name}>`);
      continue;
    }
    const selfClosing = inner.endsWith("/");
    const body = selfClosing ? inner.slice(0, -1) : inner;
    const name = /^[A-Za-z_][\w.:-]*/.exec(body)?.[0];
    if (!name) throw new Error(`malformed tag at ${lt}`);
    const attrs: Record<string, string> = {};
    const rest = body.slice(name.length);
    const re = /\s*([A-Za-z_][\w.:-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let consumed = 0;
    for (let m = re.exec(rest); m; m = re.exec(rest)) {
      if (m.index !== consumed) throw new Error(`malformed attributes in <${name}>`);
      if (m[1]! in attrs) throw new Error(`duplicate attribute ${m[1]} in <${name}>`);
      attrs[m[1]!] = decode(m[3] ?? m[4] ?? "");
      consumed = re.lastIndex;
    }
    if (rest.slice(consumed).trim()) throw new Error(`malformed attributes in <${name}>`);
    const node: XmlNode = { tag: name, attrs, children: [] };
    stack[stack.length - 1]!.children.push(node);
    if (!selfClosing) stack.push(node);
  }
  if (stack.length !== 1) throw new Error(`unclosed <${stack[stack.length - 1]!.tag}>`);
  return root;
}

export const numbers = (s: string | undefined, n: number, what: string): number[] => {
  const v = (s ?? "").trim().split(/\s+/).map(Number);
  if (v.length !== n || v.some((x) => !Number.isFinite(x)))
    throw new Error(`${what}: expected ${n} numbers, got "${s}"`);
  return v;
};
export const vec3 = (s: string | undefined, what: string, fallback?: Vec3): Vec3 =>
  s === undefined && fallback ? [...fallback] : (numbers(s, 3, what) as Vec3);
export const quat = (s: string | undefined, what: string): Quat =>
  s === undefined ? [1, 0, 0, 0] : (numbers(s, 4, what) as Quat);

interface DefaultClass {
  parent: string | null;
  elements: Map<string, Record<string, string>>;
}

/** MJCF defaults: a tree of classes, each holding attribute defaults per element type. */
export class Defaults {
  private classes = new Map<string, DefaultClass>();
  constructor(root: XmlNode | undefined) {
    if (!root) {
      this.classes.set("main", { parent: null, elements: new Map() });
      return;
    }
    const visit = (node: XmlNode, name: string, parent: string | null) => {
      if (this.classes.has(name)) throw new Error(`duplicate default class ${name}`);
      const elements = new Map<string, Record<string, string>>();
      this.classes.set(name, { parent, elements });
      for (const child of node.children) {
        if (child.tag === "default") {
          const cls = child.attrs.class;
          if (!cls) throw new Error("nested default without a class");
          visit(child, cls, name);
        } else elements.set(child.tag, { ...child.attrs });
      }
    };
    visit(root, root.attrs.class ?? "main", null);
  }
  has(name: string) {
    return this.classes.has(name);
  }
  /** Attribute defaults for `tag` under class `name`, nearest class winning. */
  resolve(tag: string, name: string): Record<string, string> {
    const chain: DefaultClass[] = [];
    for (let c: string | null = name; c !== null;) {
      const cls = this.classes.get(c);
      if (!cls) throw new Error(`unknown default class ${c}`);
      chain.unshift(cls);
      c = cls.parent;
    }
    return Object.assign({}, ...chain.map((c) => c.elements.get(tag) ?? {}));
  }
}

/** An element's attributes after its class (explicit, or inherited childclass) is applied. */
export function effective(
  defaults: Defaults,
  node: XmlNode,
  childclass: string,
): Record<string, string> {
  const cls = node.attrs.class ?? childclass;
  return { ...defaults.resolve(node.tag, cls), ...node.attrs };
}

export function child(node: XmlNode, tag: string): XmlNode | undefined {
  return node.children.find((c) => c.tag === tag);
}
export function children(node: XmlNode, tag: string): XmlNode[] {
  return node.children.filter((c) => c.tag === tag);
}
