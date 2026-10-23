/**
 * Import the digital fly's neuroanatomical reference from Virtual Fly Brain.
 *
 *   node scripts/run-ts.mjs scripts/import-vfb-reference.ts
 *
 * Fetches VFB's term information for the JRC2018Unisex template
 * (VFB_00101567), the template's painted neuropil domains the fly's panel
 * names, the FBbt anatomy classes those domains are typed as, every term the
 * controller's region links cite, and VFB's class-level connectivity for the
 * two visual projection neuron types that drive the giant fiber. It keeps a
 * small, checked subset of each response (label, symbol, definition, types,
 * tags, licences as VFB reports them) with the SHA-256 of the full response
 * and the time it was retrieved, and writes `src/bethesda/fly/data/
 * vfb-reference.json`. The build validator checks the file's shape and that
 * every id the controller links to is in it.
 *
 * No geometry is imported. VFB reports the JRC2018 template and its painted
 * domains under CC-BY-NC-SA 4.0, which this Apache-2.0 repository cannot
 * carry; the panel links to VFB instead. FBbt labels and definitions are
 * CC BY 4.0 (FlyBase anatomy ontology) and are attributed.
 *
 * Responses are untrusted input: ids must match the VFB/FBbt pattern, strings
 * are length-limited and markdown links are reduced to their text.
 */
import { createHash } from "node:crypto";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { REDUCED_ORDER_DESCRIPTOR } from "../src/bethesda/fly/controller.js";

const API = "https://v3-cached.virtualflybrain.org";
const OUT = resolve("src/bethesda/fly/data/vfb-reference.json");
const TEMPLATE = "VFB_00101567";
/** JRC2018Unisex painted domains, by the abbreviation VFB labels them with. */
const DOMAINS = {
  ME: "VFB_00102107",
  LO: "VFB_00102109",
  LOP: "VFB_00102110",
  EB: "VFB_00102135",
  PB: "VFB_00102137",
  FB: "VFB_00102134",
  NO: "VFB_00102282",
  LAL: "VFB_00102140",
  AL: "VFB_00102201",
  CA: "VFB_00102114",
  LH: "VFB_00102159",
} as const;
/** This repository's grouping for the panel; what each group's terms are is VFB's. */
const GROUPS: { id: string; label: string; modelled: string; terms: string[] }[] = [
  {
    id: "vision",
    label: "Vision",
    modelled:
      "Proxy: the simulated eyes are FlyBody's two eye cameras with a 4.6° acuity limit, ray-cast occlusion and a looming (giant-fiber) proxy. No photoreceptor, optic-lobe or projection-neuron activity is simulated.",
    terms: [
      "FBbt_00004508",
      "FBbt_00004510",
      "FBbt_00006007",
      DOMAINS.ME,
      DOMAINS.LO,
      DOMAINS.LOP,
      "FBbt_00003731",
      "FBbt_00003907",
      "FBbt_00003874",
      "FBbt_00111763",
    ],
  },
  {
    id: "olfaction",
    label: "Olfaction",
    modelled:
      "Not modelled: the fly has no odour input. Listed so the panel can say where olfaction would be processed.",
    terms: [DOMAINS.AL, DOMAINS.CA, DOMAINS.LH],
  },
  {
    id: "navigation",
    label: "Navigation and heading",
    modelled:
      "Proxy: heading is a state variable steered by rules; no central-complex activity is simulated.",
    terms: ["FBbt_00003632", DOMAINS.EB, DOMAINS.PB, DOMAINS.FB, DOMAINS.NO, DOMAINS.LAL],
  },
  {
    id: "motor",
    label: "Motor control",
    modelled:
      "Proxy: escape, walking, grooming and flight are modes of a state machine with published timings; no descending or ventral nerve cord neurons are simulated.",
    terms: ["FBbt_00004020", "FBbt_00111308", "FBbt_00004052"],
  },
];
const CONNECTIVITY: [string, string][] = [
  ["FBbt_00111763", "FBbt_00004020"],
  ["FBbt_00003874", "FBbt_00004020"],
];

const ID = /^(VFB|FBbt)_\d{8}$/;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const text = (v: unknown, max: number): string => {
  if (typeof v !== "string") return "";
  // [label](ID) → label; then collapse whitespace.
  const plain = v
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > max ? plain.slice(0, max - 1).trimEnd() + "…" : plain;
};
const idsIn = (v: unknown): string[] =>
  typeof v === "string"
    ? [...v.matchAll(/\]\(((?:VFB|FBbt)_\d{8})\)/g)].map((m) => m[1]!)
    : [];

async function get(url: string): Promise<{ body: string; json: unknown }> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.text();
      if (body.length > 5_000_000) throw new Error("response too large");
      return { body, json: JSON.parse(body) as unknown };
    } catch (e) {
      if (attempt >= 3)
        throw new Error(`${url}: ${e instanceof Error ? e.message : String(e)}`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

interface Term {
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

async function term(id: string): Promise<Term> {
  if (!ID.test(id)) throw new Error(`not a VFB/FBbt id: ${id}`);
  const query = `${API}/get_term_info?id=${id}`;
  const { body, json } = await get(query);
  const j = json as Record<string, unknown>;
  if (j.Id !== id) throw new Error(`${id}: response is for ${String(j.Id)}`);
  const meta = (j.Meta ?? {}) as Record<string, unknown>;
  const licenses = Object.values(
    (j.Licenses ?? {}) as Record<string, Record<string, unknown>>,
  ).map((l) => ({
    label: text(l.label, 60),
    iri: text(l.iri, 200),
    source: text(l.source, 120),
  }));
  const tags = Array.isArray(j.Tags)
    ? j.Tags.filter((t): t is string => typeof t === "string")
    : [];
  return {
    id,
    label: text(meta.Name, 200) || text(j.Name, 200),
    symbol: text(meta.Symbol, 80),
    definition: text(meta.Description, 900),
    types: idsIn(meta.Types).filter((t) => ID.test(t)),
    tags: tags.map((t) => text(t, 60)).slice(0, 20),
    isTemplate: j.IsTemplate === true,
    isPaintedDomain: j.IsPaintedDomain === true,
    licenses,
    query,
    sha256: sha256(body),
  };
}

const wanted = new Set<string>([
  TEMPLATE,
  ...Object.values(DOMAINS),
  ...GROUPS.flatMap((g) => g.terms),
  ...REDUCED_ORDER_DESCRIPTOR.regions.flatMap((r) => r.vfb),
  ...CONNECTIVITY.flat(),
]);
const terms = new Map<string, Term>();
const retrievedAt = new Date().toISOString();
for (const id of [...wanted].sort()) terms.set(id, await term(id));
// Follow each VFB individual (the template, its painted domains) to the FBbt
// class it is typed as; a class's own types are its ontology ancestors, not followed.
for (const t of [...terms.values()])
  if (t.id.startsWith("VFB_"))
    for (const type of t.types) if (!terms.has(type)) terms.set(type, await term(type));

const connectivity = [];
for (const [up, down] of CONNECTIVITY) {
  const query = `${API}/query_connectivity?upstream_type=${up}&downstream_type=${down}&group_by_class=true`;
  const { body, json } = await get(query);
  const j = json as Record<string, unknown>;
  const rows = Array.isArray(j.connections) ? j.connections : [];
  connectivity.push({
    upstream: up,
    downstream: down,
    query,
    sha256: sha256(body),
    excludedDatasets: Array.isArray(j.excluded_dbs)
      ? j.excluded_dbs
          .filter((d): d is string => typeof d === "string")
          .map((d) => text(d, 40))
      : [],
    connections: rows.map((r) => {
      const c = r as Record<string, unknown>;
      const n = (k: string) => {
        const v = c[k];
        if (typeof v !== "number" || !Number.isFinite(v))
          throw new Error(`${query}: ${k} missing`);
        return v;
      };
      const upId = String(c.upstream_class_id),
        downId = String(c.downstream_class_id);
      if (!ID.test(upId) || !ID.test(downId)) throw new Error(`${query}: bad class id`);
      return {
        upstreamClass: upId,
        downstreamClass: downId,
        totalUpstream: n("total_upstream_count"),
        connectedUpstream: n("connected_upstream_count"),
        percentConnected: n("percent_connected"),
        totalWeight: n("total_weight"),
        averageWeight: n("average_weight"),
      };
    }),
  });
}

const reference = {
  schema: "vfb-reference/v1",
  retrievedAt,
  importer: "scripts/import-vfb-reference.ts",
  api: API,
  template: TEMPLATE,
  citation: {
    short:
      "Court R, Costa M, Pilgrim C, et al. Virtual Fly Brain — an interactive atlas of the Drosophila nervous system. Front. Physiol. 14:1076533 (2023)",
    doi: "10.3389/fphys.2023.1076533",
  },
  licensing: {
    terms:
      "FBbt class labels and definitions: FlyBase Drosophila anatomy ontology, CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Each term's own licences are listed as VFB reported them.",
    geometry:
      "Not bundled. VFB reports the JRC2018 template and painted domains under CC-BY-NC-SA 4.0, which this Apache-2.0 repository cannot carry; the panel links to VFB.",
  },
  evidence:
    "Anatomy and connectivity here are published or measured data as VFB serves them. The digital fly does not simulate any of these neurons or neuropils; its controller only cites them as functional associations.",
  domains: DOMAINS,
  groups: GROUPS,
  terms: [...terms.values()].sort((a, b) => a.id.localeCompare(b.id)),
  connectivity,
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT + ".tmp", JSON.stringify(reference, null, 2) + "\n");
renameSync(OUT + ".tmp", OUT);
console.log(
  `imported VFB reference: ${terms.size} terms, ${connectivity.length} connectivity queries, retrieved ${retrievedAt}`,
);
