import { useEffect, useRef, useState } from "react";
import { DISCOVERY_QUESTION } from "./discoveryProtocol.js";
import type { DiscoveryView } from "./discoveryView.js";
import { researchArtifactHref } from "./researchProtocol.js";
import { partnership, INCEPTION_MODES, type InceptionMode } from "./inceptionProtocol.js";
import { SchedulePanel } from "./SchedulePanel";
import { DescendantInspector } from "./DescendantInspector";
import { AssessmentPanel } from "./AssessmentPanel";

const button = "rounded border border-teal-700 px-3 py-2 text-sm disabled:opacity-40";
export function DiscoveryWorkbench() {
  const lastCharter = useRef<string | null>(null);
  const restoredProfile = useRef(false);
  const [view, setView] = useState<DiscoveryView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState(DISCOVERY_QUESTION);
  const [prefix, setPrefix] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(false);
  const [inception, setInception] = useState(false);
  const [mode, setMode] = useState<InceptionMode>("independent");
  const [profileText, setProfileText] = useState(
    JSON.stringify(partnership().profile, null, 2),
  );
  const [memoryEpoch, setMemoryEpoch] = useState(0);
  const [worldPrefix, setWorldPrefix] = useState("");
  const [worldReviewed, setWorldReviewed] = useState(false);
  const [collaboratorText, setCollaboratorText] = useState("");
  const [intervention, setIntervention] = useState("");
  const [inspectedLab, setInspectedLab] = useState<string | null>(null);
  const [sourceTitle, setSourceTitle] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [sourceReviewed, setSourceReviewed] = useState(false);
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
    if (v.approved_source) {
      setProfileText((previous) => {
        try {
          const profile = JSON.parse(previous) as ReturnType<
            typeof partnership
          >["profile"];
          if (profile.source_ids.includes(v.approved_source!.id)) return previous;
          return JSON.stringify(
            {
              ...profile,
              version: profile.version + 1,
              source_ids: [...profile.source_ids, v.approved_source!.id],
            },
            null,
            2,
          );
        } catch {
          return previous;
        }
      });
      setReviewed(false);
      setPrefix("");
    }
    const config = v.charter?.research?.partnership ?? v.research?.partnership;
    if (
      (!restoredProfile.current ||
        (v.charter_sha256 && lastCharter.current !== v.charter_sha256)) &&
      config
    ) {
      setInception(true);
      setMode(config.mode);
      setMemoryEpoch(config.memory_epoch);
      setProfileText(JSON.stringify(config.profile, null, 2));
      setCollaboratorText(
        config.collaborator_model
          ? JSON.stringify(config.collaborator_model, null, 2)
          : "",
      );
      setQuestion(v.question);
      setReviewed(false);
      setPrefix("");
    }
    restoredProfile.current = true;
    lastCharter.current = v.charter_sha256;
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
  const archive = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        "/api/rain/discovery?archive=" + encodeURIComponent(id),
      );
      if (!response.ok)
        throw new Error(
          "Archive refused; inspect evidence integrity or export individual artifacts",
        );
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const download = document.createElement("a");
      download.href = url;
      download.download = "rain-inception-" + id + ".json";
      download.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const partnershipMatches = () => {
    const configured = view?.charter?.research?.partnership;
    if (!inception) return !configured;
    try {
      return (
        !!configured &&
        configured.mode === mode &&
        configured.memory_epoch === memoryEpoch &&
        JSON.stringify(configured.collaborator_model ?? null) ===
          JSON.stringify(collaboratorText.trim() ? JSON.parse(collaboratorText) : null) &&
        JSON.stringify(configured.profile) === JSON.stringify(JSON.parse(profileText))
      );
    } catch {
      return false;
    }
  };
  return (
    <section
      className="my-4 rounded border border-teal-800 bg-teal-950/20 p-3"
      aria-label="Autonomous discovery workbench"
    >
      <h3 className="font-semibold text-teal-200">Autonomous research program</h3>
      <p className="my-2 text-sm">
        Give the Lab a research question. James, Jasmine, Luca and Elena can examine the
        Lab's papers and mathematics, consult public literature when you approve it,
        design simulator experiments, critique the results and produce a paper draft with
        measured tables, a figure, references and a reproducible evidence bundle. Current
        execution investigates Bethesda's supported urban disruptions.
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
      <label className="my-2 block text-sm">
        <input
          type="checkbox"
          checked={online}
          disabled={view?.active}
          onChange={(e) => {
            setOnline(e.target.checked);
            setReviewed(false);
            setPrefix("");
          }}
        />{" "}
        Allow public literature queries to Crossref (metadata and abstracts; query terms
        leave this computer)
      </label>
      <div className="my-2 flex flex-wrap gap-2">
        {inception && (
          <label className="block w-full text-sm">
            Optional separate collaborator model (JSON; blank shares local Qwen)
            <textarea
              className="block w-full bg-black/30 p-2"
              value={collaboratorText}
              maxLength={600}
              disabled={view?.active}
              placeholder={
                '{"provider":"openai","model":"your-explicit-model-version","endpoint":"https://api.openai.com"}'
              }
              onChange={(e) => {
                setCollaboratorText(e.target.value);
                setReviewed(false);
              }}
            />
            Remote inference sends supplied source excerpts, prior research and memory to
            the provider. It requires matching server configuration, credentials, explicit
            remote consent and a new charter approval.
          </label>
        )}
        <label className="block text-sm">
          <input
            type="checkbox"
            checked={inception}
            disabled={view?.active}
            onChange={(e) => {
              setInception(e.target.checked);
              setReviewed(false);
              setPrefix("");
            }}
          />{" "}
          Project Inception: add Christopher-Sim and Research-Collaborator
        </label>
        {inception && (
          <details className="w-full">
            <summary>Founder command interface: profile, mode and memory</summary>
            <p className="my-2 text-sm">
              These are computational roles, not the real Christopher or a transferred
              ChatGPT identity. Methods are editable operator instructions. Profile
              changes require a new charter review. Reflection, creative and institution
              modes produce proposals only.
            </p>
            <label className="block text-sm">
              Session mode{" "}
              <select
                value={mode}
                disabled={view?.active}
                onChange={(e) => setMode(e.target.value as InceptionMode)}
              >
                {INCEPTION_MODES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              Versioned cognitive profile (optional customization)
              <textarea
                className="w-full bg-black/30 p-2"
                rows={10}
                value={profileText}
                disabled={view?.active}
                onChange={(e) => setProfileText(e.target.value)}
              />
            </label>
            <button
              className={button}
              disabled={view?.active}
              onClick={() => {
                setProfileText(JSON.stringify(partnership().profile, null, 2));
                setMemoryEpoch((n) => n + 1);
                setCollaboratorText("");
                setReviewed(false);
              }}
            >
              Reset profile and recalled memory
            </button>
            <details>
              <summary>Add an explicitly approved creative or research excerpt</summary>
              <label className="block">
                Source title{" "}
                <input
                  maxLength={200}
                  value={sourceTitle}
                  onChange={(e) => {
                    setSourceTitle(e.target.value);
                    setSourceReviewed(false);
                  }}
                />
              </label>
              <label className="block">
                Approved excerpt (poetry, art description, discussion or technical
                writing){" "}
                <textarea
                  maxLength={4000}
                  value={sourceText}
                  onChange={(e) => {
                    setSourceText(e.target.value);
                    setSourceReviewed(false);
                  }}
                />
              </label>
              <label className="block">
                <input
                  type="checkbox"
                  checked={sourceReviewed}
                  onChange={(e) => setSourceReviewed(e.target.checked)}
                />{" "}
                I approve this supplied excerpt for research context
              </label>
              <button
                className={button}
                disabled={
                  busy ||
                  view?.active ||
                  !sourceReviewed ||
                  !sourceText.trim() ||
                  !sourceTitle.trim()
                }
                onClick={() =>
                  void act("source", {
                    title: sourceTitle,
                    text: sourceText,
                    reviewed: sourceReviewed,
                  })
                }
              >
                Register and attach approved source to profile
              </button>
              {view?.approved_source && (
                <p className="text-xs">
                  Registered {view.approved_source.id} and updated the profile. Review a
                  new charter to use this excerpt. No active prompt or permission was
                  changed.
                </p>
              )}
            </details>
            <button
              className={button}
              disabled={view?.active}
              onClick={() => {
                setMemoryEpoch((n) => n + 1);
                setReviewed(false);
                setPrefix("");
              }}
            >
              Reset recalled memory for next reviewed session
            </button>
            <p className="text-xs">
              Memory epoch: {memoryEpoch}. Reset excludes old memories from prompts;
              scientific audit records remain. Uncheck Project Inception to remove these
              participants from the next scope.
            </p>
          </details>
        )}
        <button
          className={button}
          disabled={busy || view?.active}
          onClick={() => {
            if (!inception) {
              void act("research", { question, online });
              return;
            }
            try {
              void act("partnership", {
                question,
                online,
                partnership: {
                  ...partnership(mode),
                  memory_epoch: memoryEpoch,
                  profile: JSON.parse(profileText),
                  ...(collaboratorText.trim()
                    ? { collaborator_model: JSON.parse(collaboratorText) }
                    : {}),
                },
              });
            } catch {
              setError("The cognitive profile must be valid JSON.");
            }
          }}
        >
          Connect Qwen / review research program
        </button>
        <button
          className={button}
          disabled={busy || view?.active}
          onClick={() => void act("prepare")}
        >
          Review experiment-only scope
        </button>
        <button
          className={button}
          disabled={
            busy ||
            !view?.charter ||
            !partnershipMatches() ||
            view.active ||
            (!!view?.charter?.research &&
              (view.charter.research.goal !== question ||
                (view.charter.research.literature === "crossref") !== online))
          }
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
          disabled={!view?.active && view?.schedule?.status !== "armed"}
          onClick={() => void act("stop")}
        >
          Emergency stop
        </button>
      </div>
      {view?.charter?.research &&
        (view.charter.research.goal !== question ||
          (view.charter.research.literature === "crossref") !== online) && (
          <p className="mt-2 text-sm text-amber-200">
            The question or literature choice differs from the reviewed scope. Review a
            new research program before starting.
          </p>
        )}
      {view?.charter && !partnershipMatches() && (
        <p className="mt-2 text-sm text-amber-200">
          The participant selection, profile, mode or memory epoch differs from the
          reviewed scope. Review a new research program before starting.
        </p>
      )}
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
                research: view.charter.research ?? "Experiment-only session",
                ceilings: view.charter.ceilings,
                valid_hours: view.charter.valid_hours,
                policy: view.charter.policy_version,
                simulator_versions: view.charter.versions,
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
            Approve reviewed scope
          </button>
        </details>
      )}
      {view && (
        <>
          <button
            className={button}
            disabled={busy}
            onClick={() => void archive("bethesda-rain")}
          >
            Archive parent papers, evidence, sources and history
          </button>
          <label className="block text-sm">
            Intervene: challenge an assumption within the approved question
            <textarea
              className="block w-full bg-black/30 p-2"
              maxLength={1200}
              value={intervention}
              onChange={(e) => setIntervention(e.target.value)}
            />
          </label>
          <button
            className={button}
            disabled={busy || !view.charter?.research || !intervention.trim()}
            onClick={() => void act("intervene", { text: intervention })}
          >
            Record comment for next reasoning checkpoint
          </button>
          <p className="text-xs">
            The current inference finishes normally. Changing the objective or permissions
            requires a new charter.
          </p>
          <SchedulePanel view={view} act={act} busy={busy} />
          <AssessmentPanel view={view} act={act} busy={busy} />
          {view.observatory && (
            <section
              className="my-3 rounded border border-teal-800 p-3"
              aria-label="Inception Observatory"
            >
              <h4 className="font-semibold">Inception Observatory</h4>
              <p className="text-sm">
                Generation 0: Bethesda R.A.I.N. Descendant findings concern the simulator
                only. A world approval does not authorize its experiments: review its
                separate charter before starting.
              </p>
              <ul className="my-2 list-disc pl-5 text-sm">
                {view.observatory.labs.map((lab) => (
                  <li key={lab.id}>
                    <button className={button} onClick={() => setInspectedLab(lab.id)}>
                      Inspect / enter recorded world
                    </button>
                    <button
                      className={button}
                      disabled={busy}
                      onClick={() => void archive(lab.id)}
                    >
                      Archive descendant
                    </button>
                    {lab.parent} → {lab.id} · generation {lab.generation} · {lab.status} ·
                    expires {lab.expires_at}
                    {lab.status === "approved" && (
                      <button
                        className={button}
                        disabled={busy || view.active}
                        onClick={() => void act("prepare-world", { id: lab.id })}
                      >
                        Review child execution scope
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {inspectedLab && (
                <DescendantInspector
                  key={inspectedLab}
                  id={inspectedLab}
                  onClose={() => setInspectedLab(null)}
                />
              )}
              {view.observatory.proposals.map((p) => (
                <details key={p.digest}>
                  <summary>
                    Proposed world · {p.spec.id} · generation {p.spec.generation}
                  </summary>
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs">
                    {JSON.stringify(p.spec, null, 2)}
                  </pre>
                  <p className="break-all text-xs">World SHA-256: {p.digest}</p>
                  <label className="block text-sm">
                    <input
                      type="checkbox"
                      checked={worldReviewed}
                      onChange={(e) => setWorldReviewed(e.target.checked)}
                    />{" "}
                    I reviewed this world, its ancestry, assumptions and limits
                  </label>
                  <label className="block text-sm">
                    First 8 world digest characters{" "}
                    <input
                      value={worldPrefix}
                      maxLength={8}
                      onChange={(e) => setWorldPrefix(e.target.value)}
                      className="bg-black/30 p-1"
                    />
                  </label>
                  <button
                    className={button}
                    disabled={
                      busy ||
                      view.active ||
                      !worldReviewed ||
                      worldPrefix !== p.digest.slice(0, 8)
                    }
                    onClick={() =>
                      void act("approve-world", {
                        digest: p.digest,
                        prefix: worldPrefix,
                        reviewed: worldReviewed,
                      })
                    }
                  >
                    Approve this bounded world
                  </button>
                </details>
              ))}
              <details>
                <summary>Provenance-preserving descendant reports</summary>
                <pre className="max-h-80 overflow-auto whitespace-pre-wrap text-xs">
                  {JSON.stringify(view.observatory.reports, null, 2)}
                </pre>
              </details>
            </section>
          )}
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
          {view.research && (
            <section
              className="my-3 rounded border border-teal-800 p-3"
              aria-label="Research program"
            >
              <p className="font-semibold">{view.research.goal}</p>
              <p className="text-sm">
                Paper delivery: {view.research.delivery.replaceAll("_", " ")}. Human
                scientific review is required.
              </p>
              {!!view.research.gaps.length && (
                <ul className="my-2 list-disc pl-5 text-sm">
                  {view.research.gaps.map((gap, i) => (
                    <li key={i}>{gap}</li>
                  ))}
                </ul>
              )}
              <details open>
                <summary>Collaborating research perspectives</summary>
                {view.research.turns.map((turn) => (
                  <article key={turn.decision_id} className="my-2 text-sm">
                    <p className="font-semibold">
                      {turn.perspective} · {turn.role} · {turn.generation}
                    </p>
                    <p>{turn.contribution.hypothesis}</p>
                    <p>Falsification: {turn.contribution.falsification}</p>
                    <p>Next experiment: {turn.contribution.next_experiment}</p>
                    <p>
                      Disagreements:{" "}
                      {turn.contribution.disagreements.join("; ") || "None recorded"}
                    </p>
                    <p className="text-xs">
                      Sources:{" "}
                      {turn.contribution.source_ids.join(", ") || "No source cited"}
                    </p>
                  </article>
                ))}
              </details>
              {!!view.research.memory?.length && (
                <details>
                  <summary>Inspect cognitive memory and uncertainty</summary>
                  {view.research.memory.map((m) => (
                    <article key={m.id} className="my-2 text-sm">
                      <p>
                        {m.namespace} · {m.layer} · {m.status}
                      </p>
                      <p>{m.text}</p>
                      <button
                        className={button}
                        disabled={busy || view.active}
                        onClick={() => void act("forget-memory", { id: m.id })}
                      >
                        Remove this entry from recall
                      </button>
                      <p className="break-all text-xs">
                        Origin: {m.origin}; references:{" "}
                        {[...m.source_ids, ...m.evidence_run_ids].join(", ") || "none"}.
                        About computational research only.
                      </p>
                    </article>
                  ))}
                </details>
              )}
              <details>
                <summary>
                  Research sources and reading scope ({view.research.sources.length})
                </summary>
                {view.research.sources.map((source) => (
                  <article key={source.id} className="my-2 text-sm">
                    <p className="font-semibold">{source.title}</p>
                    <p>
                      {source.kind}: {source.reading_scope}
                    </p>
                    <p className="whitespace-pre-wrap">{source.excerpt}</p>
                    <p className="break-all text-xs">
                      {source.id} · {source.locator} · SHA-256 {source.sha256}
                    </p>
                  </article>
                ))}
              </details>
              <details>
                <summary>Research graph and retained branches</summary>
                <ul className="list-disc pl-5 text-sm">
                  {view.research.graph.nodes.map((node) => (
                    <li key={node.id}>
                      {node.kind} · {node.label} · {node.status}
                    </li>
                  ))}
                </ul>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-xs">
                  {JSON.stringify(view.research.graph.edges, null, 2)}
                </pre>
              </details>
              {view.research.manuscript && (
                <details open>
                  <summary>Scientific paper draft</summary>
                  <textarea
                    readOnly
                    rows={16}
                    value={view.research.manuscript}
                    aria-label="Research artifact contents"
                    className="w-full max-h-96 overflow-auto whitespace-pre-wrap text-sm"
                  />
                </details>
              )}
              {view.research.review && (
                <details>
                  <summary>Independent manuscript critique</summary>
                  <pre className="whitespace-pre-wrap text-sm">
                    {JSON.stringify(view.research.review, null, 2)}
                  </pre>
                </details>
              )}
              {!!view.research.artifacts.length && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {view.research.artifacts.map((a) => (
                    <a
                      key={a.path}
                      className={button}
                      href={researchArtifactHref(a.path)}
                      download={a.name}
                    >
                      Download {a.name}
                    </a>
                  ))}
                </div>
              )}
            </section>
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
