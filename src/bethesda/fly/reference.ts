/**
 * The Virtual Fly Brain reference the fly's panel names, as imported by
 * `scripts/import-vfb-reference.ts` (never hand-edited). Parsed strictly: the
 * build validator and the panel both read it through `parseVfbReference`.
 */
import data from "./data/vfb-reference.json" with { type: "json" };

export interface VfbTerm {
  id: string;
  label: string;
  symbol: string;
  definition: string;
  types: string[];
  tags: string[];
  isTemplate: boolean;
  isPaintedDomain: boolean;
  licenses: { label: string; iri: string; source: string }[];
  query: string;
  sha256: string;
}
export interface VfbGroup {
  id: string;
  label: string;
  modelled: string;
  terms: string[];
}
export interface VfbConnectivity {
  upstream: string;
  downstream: string;
  query: string;
  sha256: string;
  excludedDatasets: string[];
  connections: {
    upstreamClass: string;
    downstreamClass: string;
    totalUpstream: number;
    connectedUpstream: number;
    percentConnected: number;
    totalWeight: number;
    averageWeight: number;
  }[];
}
export interface VfbReference {
  schema: "vfb-reference/v1";
  retrievedAt: string;
  importer: string;
  api: string;
  template: string;
  citation: { short: string; doi: string };
  licensing: { terms: string; geometry: string };
  evidence: string;
  domains: Record<string, string>;
  groups: VfbGroup[];
  terms: VfbTerm[];
  connectivity: VfbConnectivity[];
}

const ID = /^(VFB|FBbt)_\d{8}$/;
const HEX64 = /^[0-9a-f]{64}$/;

export function parseVfbReference(raw: unknown): VfbReference {
  const r = raw as Partial<VfbReference>;
  const fail = (why: string): never => {
    throw new Error(`vfb-reference: ${why}`);
  };
  if (!r || typeof r !== "object" || r.schema !== "vfb-reference/v1") fail("schema");
  if (typeof r.retrievedAt !== "string" || Number.isNaN(Date.parse(r.retrievedAt)))
    fail("retrievedAt");
  if (typeof r.api !== "string" || !r.api.startsWith("https://")) fail("api");
  if (!r.citation || !/^10\.\d{4,}\//.test(r.citation.doi)) fail("citation");
  if (
    !Array.isArray(r.terms) ||
    !Array.isArray(r.groups) ||
    !Array.isArray(r.connectivity)
  )
    fail("lists");
  const ids = new Set<string>();
  for (const t of r.terms!) {
    if (!ID.test(t.id) || ids.has(t.id)) fail(`term id ${t.id}`);
    if (typeof t.label !== "string" || !t.label) fail(`${t.id} label`);
    if (!HEX64.test(t.sha256)) fail(`${t.id} sha256`);
    if (typeof t.query !== "string" || !t.query.startsWith(r.api + "/"))
      fail(`${t.id} query`);
    if (!Array.isArray(t.types) || !t.types.every((x) => ID.test(x)))
      fail(`${t.id} types`);
    ids.add(t.id);
  }
  if (!ids.has(r.template!)) fail("template term missing");
  for (const g of r.groups!)
    for (const id of g.terms)
      if (!ids.has(id)) fail(`group ${g.id} names missing term ${id}`);
  for (const c of r.connectivity!) {
    if (!ids.has(c.upstream) || !ids.has(c.downstream)) fail("connectivity terms");
    if (!HEX64.test(c.sha256)) fail("connectivity sha256");
  }
  return r as VfbReference;
}

export const VFB_REFERENCE = parseVfbReference(data);
export const VFB_TERMS = new Map(VFB_REFERENCE.terms.map((t) => [t.id, t]));
/** VFB's public report page for a term. */
export const vfbUrl = (id: string) => `https://virtualflybrain.org/reports/${id}`;
export const doiUrl = (doi: string) => `https://doi.org/${doi}`;
