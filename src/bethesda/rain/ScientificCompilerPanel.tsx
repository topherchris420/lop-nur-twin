import { useState } from "react";
import type { ScientificView } from "./scientificWorkbenchProtocol.js";
import type { NumericalDesign } from "./scientificProtocol.js";

const button = "rounded border border-teal-700 px-3 py-2 text-sm disabled:opacity-40";
const initial: NumericalDesign = {
  schema: "rain-oscillator-design/v1",
  question:
    "Does periodic driving increase RMS displacement against a matched free oscillator?",
  hypothesis: "Periodic driving increases RMS displacement.",
  competing_hypothesis:
    "Periodic driving does not increase RMS displacement over this window.",
  parameters: {
    mass: { value: 1, unit: "kg" },
    damping: { value: 0.4, unit: "kg/s" },
    stiffness: { value: 4, unit: "N/m" },
    force_amplitude: { value: 1, unit: "N" },
    angular_frequency: { value: 1.8, unit: "rad/s" },
    initial_displacement: { value: 0, unit: "m" },
    initial_velocity: { value: 0, unit: "m/s" },
    duration: { value: 10, unit: "s" },
    timestep: { value: 0.01, unit: "s" },
    sample_every_steps: 10,
  },
  analysis: {
    method: "matched_rms_displacement",
    expected_direction: "increase",
    minimum_effect_m: 0.01,
    max_reference_error_m: 0.000001,
    max_reference_velocity_error_m_per_s: 0.000001,
  },
  budget: { max_steps: 2000, max_samples: 1001 },
  provenance: {
    generation: "human",
    decision_sha256: null,
    source_ids: [],
    parent_record_sha256: null,
  },
};
export function ScientificCompilerPanel({
  view,
  busy,
  act,
}: {
  view: ScientificView;
  busy: boolean;
  act: (action: string, extra: Record<string, unknown>) => Promise<void>;
}) {
  const [raw, setRaw] = useState(() => JSON.stringify(initial, null, 2));
  const [question, setQuestion] = useState(initial.question);
  const [prefix, setPrefix] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const compile = () => {
    try {
      const proposal: unknown = JSON.parse(raw);
      setError(null);
      setPrefix("");
      setReviewed(false);
      void act("scientific-compile", { proposal });
    } catch {
      setError("Enter a valid JSON experiment proposal.");
    }
  };
  return (
    <section
      className="my-3 rounded border border-teal-800 p-3"
      aria-label="Scientific experiment compiler"
    >
      <h4 className="font-semibold text-teal-200">Scientific experiment compiler</h4>
      <p className="my-2 text-xs">
        Bethesda keeps its existing charter and runner. Numerical physics uses a
        separately reviewed simulation plan. The draft below is an editable host example.
        Local model drafts are labelled model proposals; neither grants execution
        authority.
      </p>
      <details>
        <summary>Backend capabilities and execution boundaries</summary>
        {view.capabilities.map((c) => (
          <article key={c.id} className="my-2 text-sm">
            <h5>
              {c.id} · {c.version}
            </h5>
            <p>Supported: {c.supported.join("; ")}</p>
            <p>Unavailable: {c.unsupported.join("; ")}</p>
            <p>Authority scope: {c.authority_scope}</p>
          </article>
        ))}
      </details>
      <label className="block my-2 text-sm">
        Numerical research question
        <textarea
          className="w-full bg-black/30 p-2"
          maxLength={400}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
      </label>
      <button
        className={button}
        disabled={busy || !question.trim()}
        onClick={() => {
          setPrefix("");
          setReviewed(false);
          void act("scientific-draft", { question });
        }}
      >
        Ask the selected local model for a numerical draft
      </button>
      <details className="my-2">
        <summary>Specify an original numerical design</summary>
        <label className="block text-sm">
          Experiment proposal JSON
          <textarea
            className="w-full bg-black/30 p-2 font-mono text-xs"
            rows={12}
            maxLength={7000}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
          />
        </label>
        <button className={button} disabled={busy} onClick={compile}>
          Validate and preregister design
        </button>
      </details>
      {error && <p role="alert">{error}</p>}
      {view.latest && (
        <article className="my-3 border-t border-teal-800 pt-2">
          <h5>Compiler inspection · {view.latest.experiment_id}</h5>
          <p className="text-sm">{view.latest.ir.question}</p>
          <p className="text-xs break-all">
            Plan SHA-256 {view.latest.digest}; registry{" "}
            {view.latest.registry_experiment_id}; author{" "}
            {view.latest.design.provenance.generation}.
          </p>
          <details open>
            <summary>Validated scientific intermediate representation</summary>
            <textarea
              readOnly
              rows={12}
              aria-label="Validated experiment representation JSON"
              className="w-full max-h-80 overflow-auto bg-black/30 font-mono text-xs"
              value={JSON.stringify(view.latest.ir, null, 2)}
            />
          </details>
          <details>
            <summary>Exact parameters and frozen analysis criteria</summary>
            <textarea
              readOnly
              rows={12}
              aria-label="Frozen experiment parameters JSON"
              className="w-full max-h-80 overflow-auto bg-black/30 font-mono text-xs"
              value={JSON.stringify(view.latest.design, null, 2)}
            />
          </details>
          <label className="block my-2 text-sm">
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(e) => setReviewed(e.target.checked)}
            />{" "}
            I reviewed the numerical simulation, controls, resource budget and
            falsification criteria.
          </label>
          <label className="block text-sm">
            First eight characters of the numerical plan digest
            <input
              className="block bg-black/30 p-2 font-mono"
              maxLength={8}
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
            />
          </label>
          <button
            className={button}
            disabled={busy || !reviewed || prefix !== view.latest.digest.slice(0, 8)}
            onClick={() =>
              void act("scientific-authorize", {
                digest: view.latest!.digest,
                prefix,
                reviewed,
              })
            }
          >
            Authorize this numerical simulation
          </button>{" "}
          <button
            className={button}
            disabled={busy || !view.latest.authorized}
            onClick={() =>
              void act("scientific-execute", { digest: view.latest!.digest })
            }
          >
            Execute, replay and admit results
          </button>
        </article>
      )}
      {view.records.map((r) => (
        <details key={r.sha256} className="my-2" open>
          <summary>
            Numerical history · {r.status} · {r.verdict} · replay{" "}
            {r.replay ? "passed" : "unverified"}
          </summary>
          <p className="text-xs break-all">
            Run {r.run_id}; sealed SHA-256 {r.sha256}; registry{" "}
            {r.registry_run_id ?? "not admitted"}.
          </p>
          <table className="w-full text-xs text-left">
            <caption>Verified simulator measurements</caption>
            <thead>
              <tr>
                <th>Metric (unit in identifier)</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(r.measurements).map(([k, v]) => (
                <tr key={k}>
                  <th>{k}</th>
                  <td>{v ?? "not measured"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs">{r.limitations.join(" ")}</p>
        </details>
      ))}
      {!!view.failures.length && (
        <details>
          <summary>
            Retained refusals and incomplete results ({view.failures.length})
          </summary>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs">
            {JSON.stringify(view.failures, null, 2)}
          </pre>
        </details>
      )}
    </section>
  );
}
