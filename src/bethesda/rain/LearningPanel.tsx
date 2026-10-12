import { useState } from "react";
import type { LearningView } from "./learningProtocol.js";

const button = "rounded border border-teal-700 px-3 py-2 text-sm disabled:opacity-40";
export function LearningPanel({
  view,
  busy,
  act,
}: {
  view: LearningView;
  busy: boolean;
  act: (action: string, extra: Record<string, unknown>) => Promise<void>;
}) {
  const [instructions, setInstructions] = useState("");
  const [digest, setDigest] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <section
      className="my-3 rounded border border-teal-800 p-3"
      aria-label="Research learning engine"
    >
      <h4 className="font-semibold text-teal-200">Research improvement history</h4>
      <p className="my-2 text-xs">
        Procedural guidance is separate from scientific verdicts. A valid negative result
        is not a research failure. Activation requires a beneficial independent evaluation
        and your approval of its exact digest.
      </p>
      {!view.recurring.length && (
        <p className="text-sm">
          No recurring deterministic design errors found in the retained journal.
        </p>
      )}
      <label className="block text-sm">
        Proposed corrective guidance
        <textarea
          className="w-full bg-black/30 p-2"
          maxLength={2000}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
        />
      </label>
      {view.recurring.map((r) => (
        <article key={r.code} className="my-2 text-sm">
          <p>
            {r.code}: {r.count} retained errors
          </p>
          <details>
            <summary>Inspect procedural-error evidence</summary>
            <pre className="whitespace-pre-wrap break-all text-xs">
              {JSON.stringify(r, null, 2)}
            </pre>
          </details>
          <button
            className={button}
            disabled={busy || !instructions.trim()}
            onClick={() => void act("learning-propose", { code: r.code, instructions })}
          >
            Propose guidance for {r.code}
          </button>
        </article>
      ))}
      <label className="block text-sm">
        Reviewed evaluation or activation SHA-256
        <input
          className="block w-full bg-black/30 p-2 font-mono text-xs"
          maxLength={64}
          value={digest}
          onChange={(e) => setDigest(e.target.value)}
        />
      </label>
      <label className="block my-2 text-sm">
        <input
          type="checkbox"
          checked={reviewed}
          onChange={(e) => setReviewed(e.target.checked)}
        />{" "}
        I reviewed the evidence, scope and independent comparison.
      </label>
      {view.proposals.map((p) => (
        <article key={p.sha256} className="my-3 border-t border-teal-800 pt-2 text-sm">
          <h5>
            {p.proposal.id} · v{p.proposal.version} · {p.status}
          </h5>
          <p>{p.proposal.instructions}</p>
          <p className="break-all text-xs">
            Proposal {p.sha256}; scope {JSON.stringify(p.proposal.scope)}
          </p>
          <button
            className={button}
            disabled={busy || p.proposal.scope.error !== "parameter-grid"}
            onClick={() => void act("learning-evaluate", { proposal: p.sha256 })}
          >
            Run scripted held-out compiler comparison
          </button>
          {p.evaluations.map((e) => (
            <details key={e.sha256} open>
              <summary>
                Baseline versus candidate ·{" "}
                {e.evaluation.beneficial
                  ? "benefit demonstrated on this panel"
                  : "benefit not established"}
              </summary>
              <p className="break-all text-xs">Evaluation {e.sha256}</p>
              <p>
                Paired tasks: {e.evaluation.sample_size}; wins {e.evaluation.paired.wins};
                losses {e.evaluation.paired.losses}; ties {e.evaluation.paired.ties}.
                Generation: {e.evaluation.generation}.
              </p>
              <div className="overflow-auto">
                <table className="w-full text-xs text-left">
                  <caption>Held-out outcomes with 95% intervals</caption>
                  <thead>
                    <tr>
                      <th>Metric</th>
                      <th>Baseline</th>
                      <th>Candidate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(e.evaluation.baseline).map(([key, b]) => {
                      const c =
                        e.evaluation.candidate[
                          key as keyof typeof e.evaluation.candidate
                        ];
                      return (
                        <tr key={key}>
                          <th>{key}</th>
                          <td>
                            {b.successes}/{b.total} [
                            {b.interval95.map((n) => n.toFixed(3)).join(", ")}]
                          </td>
                          <td>
                            {c.successes}/{c.total} [
                            {c.interval95.map((n) => n.toFixed(3)).join(", ")}]
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p>{e.evaluation.limitations.join(" ")}</p>
              <button
                className={button}
                disabled={
                  busy || !reviewed || digest !== e.sha256 || !e.evaluation.beneficial
                }
                onClick={() =>
                  void act("learning-activate", {
                    proposal: p.sha256,
                    evaluation: e.sha256,
                    digest,
                    reviewed,
                  })
                }
              >
                Activate evaluated guidance
              </button>
              <details>
                <summary>Inspect frozen evaluation and resources</summary>
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs">
                  {JSON.stringify(e.evaluation, null, 2)}
                </pre>
              </details>
            </details>
          ))}
        </article>
      ))}
      <label className="block text-sm">
        Rollback reason
        <input
          className="block w-full bg-black/30 p-2"
          maxLength={1000}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      {view.activations.map((a) => (
        <article key={a.sha256} className="my-2 text-xs">
          <p className="break-all">
            Activation {a.sha256}; operator role {a.operator}
          </p>
          <button
            className={button}
            disabled={
              busy ||
              !reviewed ||
              digest !== a.sha256 ||
              !reason.trim() ||
              view.rollbacks.some((r) => r.activation === a.sha256)
            }
            onClick={() =>
              void act("learning-rollback", {
                activation: a.sha256,
                digest,
                reason,
                reviewed,
              })
            }
          >
            Roll back this guidance
          </button>
        </article>
      ))}
      {!!view.rollbacks.length && (
        <details>
          <summary>Retained rollback history</summary>
          <pre className="whitespace-pre-wrap break-all text-xs">
            {JSON.stringify(view.rollbacks, null, 2)}
          </pre>
        </details>
      )}
    </section>
  );
}
