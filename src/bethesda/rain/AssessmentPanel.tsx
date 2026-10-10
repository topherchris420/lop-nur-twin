import { useState } from "react";
import type { DiscoveryView } from "./discoveryView";
export function AssessmentPanel({
  view,
  act,
  busy,
}: {
  view: DiscoveryView;
  act: (action: string, extra?: Record<string, unknown>) => Promise<void>;
  busy: boolean;
}) {
  const [runId, setRunId] = useState("");
  const [reviewer, setReviewer] = useState("");
  const [rationale, setRationale] = useState("");
  const [quality, setQuality] = useState(0);
  const [resolved, setResolved] = useState(false);
  const [connection, setConnection] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  return (
    <details className="my-3">
      <summary>Compare and assess investigation quality</summary>
      <p className="text-sm">
        Metrics describe this simulator and the available history. A new generation is not
        automatically better. Human ratings remain operator attestations and never change
        registry verdicts.
      </p>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs">
        {JSON.stringify(view.observatory?.evaluation, null, 2)}
      </pre>
      <label className="block">
        Completed evidence{" "}
        <select
          value={runId}
          onChange={(e) => {
            setRunId(e.target.value);
            setReviewed(false);
          }}
        >
          <option value="">Choose a run</option>
          {view.observatory?.inheritance
            ?.filter((r) => r.status === "simulated")
            .map((r) => (
              <option key={r.id} value={r.id}>
                {r.origin_lab} / {r.id}
              </option>
            ))}
        </select>
      </label>
      <label className="block">
        Reviewer label{" "}
        <input
          maxLength={100}
          value={reviewer}
          onChange={(e) => setReviewer(e.target.value)}
        />
      </label>
      <label className="block">
        Quality (0–5, your stated rubric){" "}
        <input
          type="number"
          min={0}
          max={5}
          value={quality}
          onChange={(e) => setQuality(Number(e.target.value))}
        />
      </label>
      <label className="block">
        <input
          type="checkbox"
          checked={resolved}
          onChange={(e) => setResolved(e.target.checked)}
        />{" "}
        The bounded question is resolved under its simulator criteria
      </label>
      <label className="block">
        <input
          type="checkbox"
          checked={connection}
          onChange={(e) => setConnection(e.target.checked)}
        />{" "}
        A useful cross-domain connection has a testable formulation
      </label>
      <label className="block">
        Rubric, evidence and limitations{" "}
        <textarea
          maxLength={1200}
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
        />
      </label>
      <label className="block">
        <input
          type="checkbox"
          checked={reviewed}
          onChange={(e) => setReviewed(e.target.checked)}
        />{" "}
        I independently inspected the evidence and take responsibility for this rating
      </label>
      <button
        disabled={
          busy ||
          view.active ||
          !runId ||
          !reviewer.trim() ||
          !rationale.trim() ||
          !reviewed
        }
        onClick={() =>
          void act("assess", {
            assessment: {
              schema: "rain-institution-assessment/v1",
              run_id: runId,
              quality,
              rationale,
              reviewer,
              question_resolved: resolved,
              useful_cross_domain_connection: connection,
            },
            reviewed,
          })
        }
      >
        Record human assessment
      </button>
    </details>
  );
}
