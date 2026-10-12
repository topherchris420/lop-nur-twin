import { useState } from "react";
import {
  queryScientificKnowledge,
  type KnowledgeQuery,
  type ScientificKnowledgeGraph,
} from "./scientificKnowledgeProtocol.js";

const control = "rounded border border-teal-700 px-3 py-2 text-sm";
/** A view over host-derived evidence; selection and search never write claims. */
export function ScientificKnowledgeExplorer({
  graph,
}: {
  graph: ScientificKnowledgeGraph;
}) {
  const [query, setQuery] = useState<KnowledgeQuery>({ kind: "missing_evidence" });
  const [text, setText] = useState("");
  const [selected, setSelected] = useState("");
  const [first, setFirst] = useState("");
  const [second, setSecond] = useState("");
  const answer = queryScientificKnowledge(graph, query);
  const node = graph.nodes.find((n) => n.id === selected);
  const matches = answer.nodes.slice(0, 8);
  const matchIds = new Set(matches.map((n) => n.id));
  const neighbors = graph.nodes.filter(
    (n) =>
      !matchIds.has(n.id) &&
      answer.edges.some(
        (e) =>
          (matchIds.has(e.from) && e.to === n.id) ||
          (matchIds.has(e.to) && e.from === n.id),
      ),
  );
  const visible = [...matches, ...neighbors].slice(0, 24);
  const positions = new Map(
    visible.map((n, i) => [
      n.id,
      { x: 80 + (i % 4) * 190, y: 45 + Math.floor(i / 4) * 75 },
    ]),
  );
  const hypotheses = graph.nodes.filter((n) => n.kind === "hypothesis");
  return (
    <section
      aria-label="Scientific knowledge graph"
      className="my-3 rounded border border-teal-800 p-3"
    >
      <h4 className="font-semibold text-teal-200">Scientific knowledge graph</h4>
      <p className="my-2 text-xs">
        Reconstructed from source receipts, registry assessments and the retained journal.
        Source context and model suggestions retain their own standing.
      </p>
      <div className="my-2 flex flex-wrap gap-2">
        <button
          className={control}
          onClick={() => setQuery({ kind: "untested_hypotheses" })}
        >
          Untested hypotheses
        </button>
        <button
          className={control}
          onClick={() => setQuery({ kind: "shared_assumptions" })}
        >
          Shared assumptions
        </button>
        <button className={control} onClick={() => setQuery({ kind: "contradictions" })}>
          Contradiction inspector
        </button>
        <button
          className={control}
          onClick={() => setQuery({ kind: "missing_evidence" })}
        >
          Missing evidence
        </button>
      </div>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery({ kind: "search", text });
        }}
      >
        <label className="text-sm">
          Search evidence{" "}
          <input
            className="rounded bg-black/30 p-2"
            value={text}
            maxLength={400}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <button className={control} type="submit">
          Search graph
        </button>
      </form>
      <details className="my-2">
        <summary>Compare competing predictions</summary>
        <label className="block text-sm">
          First hypothesis{" "}
          <select
            className="max-w-full bg-black/30 p-2"
            value={first}
            onChange={(e) => setFirst(e.target.value)}
          >
            <option value="">Select hypothesis</option>
            {hypotheses.map((n) => (
              <option key={n.id} value={n.id}>
                {n.label.slice(0, 90)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          Second hypothesis{" "}
          <select
            className="max-w-full bg-black/30 p-2"
            value={second}
            onChange={(e) => setSecond(e.target.value)}
          >
            <option value="">Select hypothesis</option>
            {hypotheses.map((n) => (
              <option key={n.id} value={n.id}>
                {n.label.slice(0, 90)}
              </option>
            ))}
          </select>
        </label>
        <button
          className={control}
          disabled={!first || !second || first === second}
          onClick={() =>
            setQuery({
              kind: "distinguishing_experiment",
              hypothesis_ids: [first, second],
            })
          }
        >
          Inspect distinguishing protocols
        </button>
      </details>
      <p className="my-2 text-sm" role="status">
        {answer.explanation} {answer.nodes.length} matching nodes.
      </p>
      {!!visible.length && (
        <svg
          className="w-full rounded bg-black/20"
          viewBox={`0 0 800 ${Math.ceil(visible.length / 4) * 75 + 30}`}
          role="img"
          aria-label="Relationships between matching scientific records; select records in the table below"
        >
          {answer.edges
            .filter((e) => positions.has(e.from) && positions.has(e.to))
            .map((e) => {
              const a = positions.get(e.from)!,
                b = positions.get(e.to)!;
              return (
                <line
                  key={e.id}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={
                    selected === e.from || selected === e.to ? "#fef08a" : "#5eead4"
                  }
                  opacity="0.35"
                />
              );
            })}
          {visible.map((n) => {
            const p = positions.get(n.id)!;
            return (
              <g key={n.id}>
                <circle
                  cx={p.x}
                  cy={p.y}
                  r="14"
                  fill={n.standing === "verified_simulator" ? "#5eead4" : "#134e4a"}
                  stroke={selected === n.id ? "#fef08a" : "#5eead4"}
                />
                <text x={p.x + 20} y={p.y + 4} fill="#ccfbf1" fontSize="11">
                  {n.kind}
                </text>
                <text x={p.x - 55} y={p.y + 30} fill="#ccfbf1" fontSize="9">
                  {n.label.slice(0, 27)}
                </text>
              </g>
            );
          })}
        </svg>
      )}
      <div className="max-h-72 overflow-auto my-2">
        <table className="w-full text-left text-xs">
          <caption className="text-left">Inspectable scientific records</caption>
          <thead>
            <tr>
              <th>Record</th>
              <th>Type</th>
              <th>Standing</th>
              <th>Inspect</th>
            </tr>
          </thead>
          <tbody>
            {answer.nodes.map((n) => (
              <tr key={n.id}>
                <td className="p-2">{n.label}</td>
                <td>{n.kind}</td>
                <td>{n.standing}</td>
                <td>
                  <button
                    className={control}
                    onClick={() => setSelected(n.id)}
                    aria-label={`Inspect ${n.label}`}
                  >
                    Inspect
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {node && (
        <article
          className="my-2 border-t border-teal-800 pt-2"
          aria-label="Scientific provenance inspector"
        >
          <h5>{node.label}</h5>
          <p className="text-xs">
            {node.id} · {node.status} · {node.standing}
          </p>
          <p className="my-2 text-sm">{node.limitations.join(" ")}</p>
          <details open>
            <summary>Evidence provenance</summary>
            <textarea
              readOnly
              rows={8}
              aria-label="Scientific evidence provenance JSON"
              className="w-full max-h-64 overflow-auto bg-black/30 font-mono text-xs"
              value={JSON.stringify(node.provenance, null, 2)}
            />
          </details>
          <details open>
            <summary>Experimental lineage and typed relationships</summary>
            <ul className="text-xs">
              {graph.edges
                .filter((e) => e.from === node.id || e.to === node.id)
                .map((e) => (
                  <li key={e.id} className="my-2">
                    <button
                      className={control}
                      onClick={() => setSelected(e.from === node.id ? e.to : e.from)}
                    >
                      {e.relation} ·{" "}
                      {graph.nodes.find(
                        (n) => n.id === (e.from === node.id ? e.to : e.from),
                      )?.label ?? "unresolved reference"}
                    </button>
                    <p>{e.standing}</p>
                    <pre className="whitespace-pre-wrap break-all">
                      {JSON.stringify(e.provenance, null, 2)}
                    </pre>
                  </li>
                ))}
            </ul>
          </details>
        </article>
      )}
      <details>
        <summary>Projection limits and source revision</summary>
        <p className="text-xs break-all">
          Journal {graph.journal_head_sha256 ?? "empty"}; corpus{" "}
          {graph.corpus_commit ?? "unknown"}
        </p>
        <ul className="list-disc pl-5 text-xs">
          {graph.limitations.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}
