/**
 * Bethesda claims, classified with the desert's own vocabulary.
 *
 * The four classes and their wording are Lop Nur's (`src/lib/evidence.ts`);
 * only the rule that assigns them is local, and it is derived from the data,
 * never hand-written per building. That is the quiet point of the anomaly:
 * the same evidence discipline that leaves the desert mostly *interpreted*
 * finds the suburb mostly *reported* — because the suburb is observable.
 *
 *   footprint geometry  reported     OSM contributors published it; this project
 *                                    did not observe it in a cited scene.
 *   height: height tag  reported     a community-published height.
 *   height: levels      interpreted  a published level count × an assumed 3.3 m.
 *   height: none        illustrative a typology guess so the block has a skyline.
 *   façades, roofs      illustrative procedural detailing everywhere.
 *   terrain             reported     the county's published bare-earth DTM.
 *   people, traffic     illustrative simulated behaviour, not observed Bethesda.
 */
import {
  EVIDENCE_CLASSIFICATION_META,
  type EvidenceClassification,
} from "../lib/evidence";
import { buildings, type Building } from "./model";
import { buildingAttributes, storefronts, storefrontBuilding } from "./streetscape";
import { elevationAt } from "./terrain";

export { EVIDENCE_CLASSIFICATION_META };
export type { EvidenceClassification };
const ORDER: EvidenceClassification[] = [
  "observed",
  "reported",
  "interpreted",
  "illustrative",
];
export const weakest = (...c: EvidenceClassification[]) =>
  c.reduce((a, b) => (ORDER.indexOf(b) > ORDER.indexOf(a) ? b : a));
export function heightClass(b: Building): EvidenceClassification {
  return b.heightEvidence === "height tag"
    ? "reported"
    : b.heightEvidence === "levels × assumed 3.3 m"
      ? "interpreted"
      : "illustrative";
}
/** The weakest claim the massing makes: footprint and height together. */
export function buildingClass(b: Building): EvidenceClassification {
  return weakest("reported", heightClass(b));
}
export const EVIDENCE_TINT: Record<EvidenceClassification, string> = {
  observed: "#e3e6df",
  reported: "#6fa3b8",
  interpreted: "#d1a956",
  illustrative: "#a3a19a",
};
export function evidenceTally() {
  const tally: Record<EvidenceClassification, number> = {
    observed: 0,
    reported: 0,
    interpreted: 0,
    illustrative: 0,
  };
  for (const b of buildings) tally[buildingClass(b)]++;
  return tally;
}
function area(ring: { x: number; z: number }[]) {
  let a = 0;
  for (let i = 1; i < ring.length; i++)
    a += ring[i - 1]!.x * ring[i]!.z - ring[i]!.x * ring[i - 1]!.z;
  return Math.abs(a) / 2;
}
let tenants: Map<string, string[]> | null = null;
export interface Dossier {
  building: Building;
  title: string;
  rows: { label: string; value: string; class: EvidenceClassification | null }[];
  osmUrl: string;
}
export function dossier(b: Building): Dossier {
  if (!tenants) {
    tenants = new Map();
    for (const s of storefronts) {
      const at = storefrontBuilding(s);
      if (at) tenants.set(at.id, [...(tenants.get(at.id) ?? []), s.name]);
    }
  }
  const attr = buildingAttributes.get(b.id);
  const footprint = area(b.ring) - b.holes.reduce((s, h) => s + area(h), 0);
  const rows: Dossier["rows"] = [
    {
      label: "OSM object",
      value: `${b.osmType} ${b.id} · v${b.version} · edited ${b.editedAt.slice(0, 10)}`,
      class: "reported",
    },
    { label: "Building tag", value: b.type, class: "reported" },
    {
      label: "Footprint",
      value: `${Math.round(footprint).toLocaleString()} m² (computed from mapped geometry${b.holes.length ? `, ${b.holes.length} courtyard` : ""})`,
      class: "reported",
    },
    {
      label: "Height",
      value: `${b.height.toFixed(1)} m · ${b.heightEvidence}${b.levels ? ` (${b.levels} levels)` : ""}`,
      class: heightClass(b),
    },
    {
      label: "Ground",
      value: `${elevationAt(b.center).toFixed(1)} m NAVD88 at footprint centre (DTM crop)`,
      class: "reported",
    },
    {
      label: "Façade, roof, windows",
      value: "procedural detailing; not surveyed",
      class: "illustrative",
    },
  ];
  if (attr?.material || attr?.colour || attr?.roofShape)
    rows.push({
      label: "Mapped attributes",
      value: [
        attr.material && `material ${attr.material}`,
        attr.colour && `colour ${attr.colour}`,
        attr.roofShape && `roof ${attr.roofShape}`,
      ]
        .filter(Boolean)
        .join(" · "),
      class: "reported",
    });
  const inside = tenants.get(b.id);
  if (inside?.length)
    rows.push({
      label: "Mapped storefronts",
      value:
        inside.slice(0, 8).join(" · ") +
        (inside.length > 8 ? ` +${inside.length - 8}` : ""),
      class: "reported",
    });
  return {
    building: b,
    title: b.name || `Unnamed ${b.type === "yes" ? "building" : b.type}`,
    rows,
    osmUrl: `https://www.openstreetmap.org/${b.osmType}/${b.id}`,
  };
}
