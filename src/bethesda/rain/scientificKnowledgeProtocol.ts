/** Read-only scientific knowledge projection. No evaluator or authority lives here. */
export const SCIENTIFIC_GRAPH_SCHEMA = "rain-scientific-knowledge/v1" as const;
export type ScientificNodeKind =
  | "paper"
  | "equation"
  | "hypothesis"
  | "assumption"
  | "question"
  | "protocol"
  | "measurement"
  | "contradiction"
  | "missing_evidence"
  | "falsification"
  | "limitation";
export type KnowledgeStanding =
  | "source_context"
  | "model_suggested"
  | "operator_assessed"
  | "host_observed"
  | "verified_simulator";
export interface KnowledgeProvenance {
  kind: "corpus" | "journal" | "registry";
  id: string;
  sha256: string;
  locator: string;
  detail: string;
}
export interface ScientificNode {
  id: string;
  kind: ScientificNodeKind;
  label: string;
  status: string;
  standing: KnowledgeStanding;
  provenance: KnowledgeProvenance[];
  limitations: string[];
  quantities?: { metric: string; value: number | null; unit: string }[];
}
export type ScientificRelation =
  | "informs"
  | "states"
  | "assumes"
  | "asks"
  | "tests"
  | "measures"
  | "supports"
  | "contradicts"
  | "challenges"
  | "requires"
  | "limits"
  | "falsified_by"
  | "revises";
export interface ScientificEdge {
  id: string;
  from: string;
  to: string;
  relation: ScientificRelation;
  standing: KnowledgeStanding;
  provenance: KnowledgeProvenance[];
}
export interface ScientificKnowledgeGraph {
  schema: typeof SCIENTIFIC_GRAPH_SCHEMA;
  journal_head_sha256: string | null;
  corpus_commit: string | null;
  nodes: ScientificNode[];
  edges: ScientificEdge[];
  limitations: string[];
}
export type KnowledgeQuery =
  | { kind: "untested_hypotheses" }
  | { kind: "shared_assumptions"; node_id?: string }
  | { kind: "contradictions"; node_id?: string }
  | { kind: "missing_evidence" }
  | { kind: "distinguishing_experiment"; hypothesis_ids: [string, string] }
  | { kind: "search"; text: string };
export interface KnowledgeAnswer {
  query: KnowledgeQuery;
  nodes: ScientificNode[];
  edges: ScientificEdge[];
  explanation: string;
  unresolved: boolean;
  matched_terms: string[];
}
/** Bounded deterministic queries over the host's derived graph, with inspectable links. */
export function queryScientificKnowledge(
  graph: ScientificKnowledgeGraph,
  query: KnowledgeQuery,
): KnowledgeAnswer {
  const ids = new Set<string>();
  let explanation = "",
    unresolved = false;
  const matched_terms: string[] = [];
  if (query.kind === "search") {
    const terms = [
      ...new Set(
        query.text
          .slice(0, 400)
          .toLowerCase()
          .match(/[a-z0-9]{2,}/g) ?? [],
      ),
    ].slice(0, 20);
    for (const node of graph.nodes) {
      const text = (node.label + " " + node.kind + " " + node.status).toLowerCase();
      const found = terms.filter((t) => text.includes(t));
      if (found.length) {
        ids.add(node.id);
        matched_terms.push(...found);
      }
    }
    explanation =
      "Lexical matches retrieve context; similarity establishes no scientific relationship.";
  } else if (query.kind === "untested_hypotheses") {
    for (const node of graph.nodes.filter((n) => n.kind === "hypothesis")) {
      const protocols = graph.edges
        .filter((e) => e.to === node.id && e.relation === "tests")
        .map((e) => e.from);
      const tested =
        graph.edges.some(
          (e) =>
            e.relation === "measures" &&
            e.standing === "verified_simulator" &&
            protocols.includes(e.from),
        ) ||
        graph.edges.some(
          (e) =>
            e.to === node.id &&
            ["supports", "contradicts"].includes(e.relation) &&
            e.standing !== "model_suggested",
        );
      if (!tested) ids.add(node.id);
    }
    unresolved = ids.size > 0;
    explanation =
      "These hypotheses lack an explicit protocol link to admitted, replay-verified measurements. Similar prose is not a test relation.";
  } else if (query.kind === "shared_assumptions") {
    for (const assumption of graph.nodes.filter((n) => n.kind === "assumption")) {
      const links = graph.edges.filter(
        (e) => e.to === assumption.id && e.relation === "assumes",
      );
      if (
        new Set(links.map((e) => e.from)).size > 1 &&
        (!query.node_id || links.some((e) => e.from === query.node_id))
      ) {
        ids.add(assumption.id);
        links.forEach((e) => ids.add(e.from));
      }
    }
    explanation =
      "Only explicitly recorded assumption links are compared. An assumption remains proposed or operator assessed, never measured merely because it is shared.";
  } else if (query.kind === "contradictions") {
    for (const edge of graph.edges.filter((e) =>
      ["contradicts", "challenges"].includes(e.relation),
    )) {
      if (!query.node_id || edge.to === query.node_id || edge.from === query.node_id) {
        ids.add(edge.from);
        ids.add(edge.to);
      }
    }
    unresolved = ids.size > 0;
    explanation =
      "Registry contrary evidence and model objections retain distinct standing. A model disagreement does not establish a scientific contradiction.";
  } else if (query.kind === "missing_evidence") {
    graph.nodes
      .filter((n) => n.kind === "missing_evidence")
      .forEach((n) => ids.add(n.id));
    unresolved = ids.size > 0;
    explanation =
      "Each gap identifies an absent explicit relation, source receipt or verified measurement.";
  } else {
    const hypotheses = query.hypothesis_ids;
    hypotheses
      .filter((id) => graph.nodes.some((n) => n.id === id && n.kind === "hypothesis"))
      .forEach((id) => ids.add(id));
    for (const protocol of graph.nodes.filter(
      (n) => n.kind === "protocol" && n.status === "validated",
    )) {
      if (
        hypotheses.every((id) =>
          graph.edges.some(
            (e) => e.from === protocol.id && e.to === id && e.relation === "tests",
          ),
        )
      )
        ids.add(protocol.id);
    }
    unresolved = ![...ids].some((id) =>
      graph.nodes.some((n) => n.id === id && n.kind === "protocol"),
    );
    explanation = unresolved
      ? "No recorded validated protocol explicitly tests both hypotheses. Define distinguishable predictions, observables and a reviewed protocol before execution."
      : "Recorded validated candidates explicitly test both hypotheses; this query establishes no optimality and grants no execution authority.";
  }
  const nodes = graph.nodes.filter((n) => ids.has(n.id)).slice(0, 200);
  const selected = new Set(nodes.map((n) => n.id));
  return {
    query,
    nodes,
    edges: graph.edges
      .filter((e) => selected.has(e.from) || selected.has(e.to))
      .slice(0, 400),
    explanation,
    unresolved,
    matched_terms: [...new Set(matched_terms)].sort(),
  };
}
