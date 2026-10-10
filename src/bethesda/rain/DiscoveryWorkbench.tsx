import { useEffect, useState } from "react";
import { DISCOVERY_QUESTION } from "./discoveryProtocol.js";
import type { DiscoveryView } from "./discoveryView.js";

const button = "rounded border border-teal-700 px-3 py-2 text-sm disabled:opacity-40";
export function DiscoveryWorkbench() {
  const [view, setView] = useState<DiscoveryView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState(DISCOVERY_QUESTION);
  const [prefix, setPrefix] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const accept = (data: unknown) => {
    const v = data as DiscoveryView;
    if (
      !v ||
      v.schema !== "rain-discovery-view/v1" ||
      !Array.isArray(v.history) ||
      typeof v.active !== "boolean" ||
      typeof v.stage !== "string" ||
      typeof v.detail !== "string"
    )
      throw new Error(
        "Local discovery workbench unavailable. Run this checkout locally with LM Studio and RAIN_AUTONOMY_ENABLED=true.",
      );
    setView(v);
  };
  useEffect(() => {
    const abort = new AbortController();
    let pending = false;
    const read = async () => {
      if (pending) return;
      pending = true;
      try {
        const response = await fetch("/api/rain/discovery", { signal: abort.signal });
        if (
          !response.ok ||
          !response.headers.get("content-type")?.includes("application/json")
        )
          throw new Error(
            "Discovery runs locally: start LM Studio and this checkout with npm run dev. The deployed site cannot reach your computer's model.",
          );
        const data: unknown = await response.json();
        if (!abort.signal.aborted) accept(data);
      } catch (e) {
        if (!abort.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      } finally {
        pending = false;
      }
    };
    void read();
    const timer = setInterval(() => {
      void read();
    }, 2000);
    return () => {
      abort.abort();
      clearInterval(timer);
    };
  }, []);
  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/rain/discovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const data = (await response.json()) as DiscoveryView & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Discovery request refused");
      accept(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className="my-4 rounded border border-teal-800 bg-teal-950/20 p-3"
      aria-label="Autonomous discovery workbench"
    >
      <h3 className="font-semibold text-teal-200">Autonomous experimental discovery</h3>
      <p className="my-2 text-sm">
        Ask how simulated disruptions change movement. R.A.I.N. can design matched-control
        studies, vary mapped locations, populations, timing and intensity, replay its
        measurements, and propose a follow-up. Findings describe this simulator.
      </p>
      <p className="text-xs">
        Qwen proposes. The host validates and admits. The simulator measures. A separate
        inference critiques. Manual experiments remain available below.
      </p>
      {error && (
        <p role="alert" className="my-2 text-amber-200">
          {error}
        </p>
      )}
      <label className="mt-3 block text-sm">
        Scientific question
        <textarea
          className="mt-1 w-full rounded border border-teal-800 bg-black/30 p-2"
          value={question}
          maxLength={400}
          disabled={view?.active}
          onChange={(e) => setQuestion(e.target.value)}
        />
      </label>
      <div className="my-2 flex flex-wrap gap-2">
        <button
          className={button}
          disabled={busy || view?.active}
          onClick={() => void act("prepare")}
        >
          Connect local Qwen / review scope
        </button>
        <button
          className={button}
          disabled={busy || !view?.charter || view.active}
          onClick={() => void act("start", { question })}
        >
          Start bounded session
        </button>
        <button
          className={button}
          disabled={!view?.active || busy}
          onClick={() => void act("pause")}
        >
          Pause after this experiment
        </button>
        <button
          className="rounded border border-red-400 bg-red-950 px-3 py-2 font-semibold text-red-100 disabled:opacity-40"
          disabled={!view?.active}
          onClick={() => void act("stop")}
        >
          Emergency stop
        </button>
      </div>
      {view?.charter && (
        <details className="my-3">
          <summary>Review authorization: {view.authorization}</summary>
          <p className="my-2 text-sm">
            This approves a parameter family, model, budget and expiry. It is a local
            operator attestation. Every experiment still passes deterministic validation.
            New or changed scope requires review.
          </p>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap text-xs">
            {JSON.stringify(
              {
                model: view.charter.model,
                scope: view.charter.family,
                ceilings: view.charter.ceilings,
                valid_hours: view.charter.valid_hours,
                policy: view.charter.policy_version,
              },
              null,
              2,
            )}
          </pre>
          <p className="break-all text-xs">Charter SHA-256: {view.charter_sha256}</p>
          <label className="my-2 block text-sm">
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(e) => setReviewed(e.target.checked)}
            />{" "}
            I reviewed this scope and its ceilings
          </label>
          <label className="block text-sm">
            Type the first 8 digest characters
            <input
              className="mx-2 rounded border bg-black/40 p-1"
              maxLength={8}
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
            />
          </label>
          <button
            className={button}
            disabled={busy || view.active || !reviewed || prefix.length !== 8}
            onClick={() => void act("authorize", { prefix, reviewed })}
          >
            Approve family
          </button>
        </details>
      )}
      {view && (
        <>
          <p role="status" className="my-2 text-sm">
            {view.stage} · {view.detail}
          </p>
          {view.lock && !view.active && (
            <details>
              <summary>Interrupted or other session lock</summary>
              <pre className="whitespace-pre-wrap break-all text-xs">
                {JSON.stringify(view.lock, null, 2)}
              </pre>
              <button
                className={button}
                onClick={() =>
                  void act("recover", { digest: view.lock!.sha256, reviewed: true })
                }
              >
                Reviewed — recover only if owner exited
              </button>
            </details>
          )}
          <p className="text-xs">
            Model: {view.model ?? "not connected"} · Authorization: {view.authorization}
          </p>
          {view.progress && (
            <p className="text-sm">
              {view.progress.arm} · seed {view.progress.seed} · tick {view.progress.tick}/
              {view.progress.totalTicks}
            </p>
          )}
          {view.proposed && (
            <details open>
              <summary>Active hypothesis and proposed experiment</summary>
              <p className="text-sm">{view.proposed.hypothesis}</p>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs">
                {JSON.stringify(view.proposed, null, 2)}
              </pre>
            </details>
          )}
          {!!view.validation.length && (
            <p className="text-sm">Validation: {view.validation.join("; ")}</p>
          )}
          {view.critique && (
            <details open>
              <summary>Scientific critique · model interpretation</summary>
              <p className="text-sm">{view.critique.learned}</p>
              <p className="text-sm">
                Uncertainty: {view.critique.uncertainty.join("; ")}
              </p>
              <p className="text-sm">Next investigation: {view.critique.next_question}</p>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs">
                {JSON.stringify(view.critique, null, 2)}
              </pre>
            </details>
          )}
          <details className="mt-2">
            <summary>Full experiment history ({view.history.length})</summary>
            {view.history.map((r) => (
              <article className="my-3 border-t border-teal-800 pt-2" key={r.run_id}>
                <p>{r.question}</p>
                <p className="text-sm">
                  {r.purpose} · {r.verdict} · replay {r.replay ? "passed" : "unverified"}
                </p>
                <p className="break-all text-xs">
                  Parent: {r.parent ?? "none"} · {r.run_id}
                </p>
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap text-xs">
                  {JSON.stringify(r, null, 2)}
                </pre>
              </article>
            ))}
          </details>
          <details className="mt-2">
            <summary>
              Discovery audit: validations, refusals, failures and lineage
            </summary>
            {view.events.map((e) => (
              <details key={e.sequence}>
                <summary>
                  {e.at} · {e.kind}
                </summary>
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs">
                  {e.detail}
                </pre>
              </details>
            ))}
            <p className="text-xs">
              Preview text is bounded; complete entries and all model calls remain in the
              local discovery journal.
            </p>
          </details>
          {view.report && (
            <p className="break-all text-xs">Reproducible report saved: {view.report}</p>
          )}
        </>
      )}
    </section>
  );
}
