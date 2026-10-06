/**
 * The lab's rooms as semantic panels: the accessible front door, and the whole
 * lab when WebGL is unavailable. The 3D interior presents; these panels hold
 * every capability, every number and every label. Text that came from R.A.I.N.
 * or a proposal is rendered as text — never as HTML, never as a link.
 */
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import {
  CRITERIA_RULE,
  DEFINITION_SCHEMA,
  EXPERIMENT_BOUNDS,
  LIMITS,
  LOCATION_LABELS,
  METRICS,
  METRIC_IDS,
  METRIC_LABELS,
  PERSPECTIVES,
  RAIN_BETHESDA_SCHEMA,
  SCENARIO_IDS,
  SCENARIO_LABELS,
  SCENARIO_LOCATIONS,
  SOUL_FILES,
  WORLD_OBSERVATION_SCHEMA,
  type LocationId,
  type MetricId,
  type ScenarioId,
  type Verdict,
} from "./contracts";
import { protocolOf } from "./experiments";
import { STATE_LABELS } from "./lifecycle";
import { ROOMS, ROOM_IDS, type RoomId } from "./labLayout";
import { CATEGORIES, OPTIONS, branches, evidenceItems, type Category } from "./session";
import { labRevision } from "./provenance";
import { admissionBundle, runArtifactName } from "./submission";
import { runArtifactText, type ExperimentRecord } from "./record";
import { armTrace } from "./replay";
import { CONFIRMATION_LENGTH } from "./authorization";
import { engineName, suggestion, type LabStore } from "./store";
import { TOOL_NAMES, SENSOR, REGION_RADIUS, type ToolName } from "./tools";
import { positionAt } from "./presence";
import { LOCATION_IDS, type Perspective } from "./contracts";
import type { ExperimentCase } from "./cases";
import { DATA_VERSION } from "../model";
import { TERRAIN_VERSION } from "../terrain";
import { TRANSIT_VERSION } from "../streetscape";
import { SIM_VERSION } from "../simulation";

export const panel =
  "rounded border border-teal-100/20 bg-[#0d2328]/95 p-3 text-slate-100 shadow-xl";
export const button =
  "rounded border border-[#0B5D63] bg-[#0B5D63]/30 px-3 py-1.5 text-xs hover:bg-[#0B5D63]/60 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-200";
const quiet = "text-[11px] text-slate-300";
const label = "font-mono text-[9px] tracking-[.24em] text-teal-200";

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const short = (s: string | null | undefined, n = 12) =>
  s ? s.slice(0, n) + "…" : "unknown";

const CATEGORY_STYLE: Record<Category, string> = {
  SOURCE: "border-[#e8dcc0] text-[#f1e7cf]",
  INTERPRETATION: "border-dashed border-[#9fb8c9] text-[#c8d8e3]",
  HYPOTHESIS: "border-[#c9b3e6] text-[#ddd0f0]",
  OBSERVATION: "border-[#7fd1c6] text-[#a9e6dd]",
  "SIMULATION RESULT": "border-[#e9c46a] text-[#f2d998]",
  "VALIDATED CHECK": "border-[#9ad18b] text-[#bfe3b5]",
};
export function Badge({ c }: { c: Category }) {
  return (
    <span
      className={`inline-block rounded border px-1.5 py-0.5 font-mono text-[9px] tracking-widest ${CATEGORY_STYLE[c]}`}
    >
      <span aria-hidden="true">{CATEGORIES[c].glyph} </span>
      {c}
    </span>
  );
}
function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="mt-3" aria-labelledby={id}>
      <h3 id={id} className={label}>
        {title}
      </h3>
      <div className="mt-1 text-xs leading-relaxed">{children}</div>
    </section>
  );
}
const OUTCOME_GLYPH: Record<string, string> = {
  COMPLETED: "■",
  INCONCLUSIVE: "◫",
  FAILED: "✕",
  REJECTED: "⊘",
};
function outcomeText(r: ExperimentRecord) {
  const v = r.outcome.verdict.replaceAll("_", " ");
  return r.outcome.state === "COMPLETED"
    ? `COMPLETED · hypothesis ${v === "supported" ? "SUPPORTED" : "NOT SUPPORTED"}`
    : r.outcome.state === "INCONCLUSIVE"
      ? "INCONCLUSIVE · insufficient evidence"
      : r.outcome.state === "FAILED"
        ? "FAILED · the run did not complete; not evaluated"
        : "REJECTED · never ran";
}

// ---------------------------------------------------------------------------
export function RuntimeLine({ store }: { store: LabStore }) {
  const s = store.runtime.status;
  const id = s?.identity;
  if (store.runtime.checking) return <p className={quiet}>Runtime: checking…</p>;
  if (store.mode() === "LIVE" && id)
    return (
      <p className={quiet}>
        Runtime: <strong className="text-teal-100">LIVE</strong> · {id.meeting_engine} at{" "}
        {id.rain.repository} {short(id.rain.commit)}
        {id.rain.dirty ? " (uncommitted changes)" : ""} ·{" "}
        {id.meeting_generation === "scripted"
          ? "reasoning text is scripted; no model runs"
          : `model ${id.model}`}{" "}
        · bounded proposals: {id.bounded_decision}
        {id.remote_decisions ? " · remote engines allowed" : ""}
      </p>
    );
  return (
    <p className={quiet}>
      Runtime: <strong className="text-amber-100">OFFLINE</strong> ·{" "}
      {store.runtime.error ??
        (s?.configured === false
          ? s.failure
            ? `the research runtime could not start on this site's server (${s.failure})`
            : "the research runtime is switched off on this site's server"
          : s?.failure
            ? `the research runtime did not answer (${s.failure})`
            : "not yet checked")}
      . The lab is explorable; nothing is generated.
    </p>
  );
}

// ---------------------------------------------------------------------------
export function ThresholdPanel({
  store,
  onExit,
}: {
  store: LabStore;
  onExit: () => void;
}) {
  return (
    <div>
      <h2 className="text-base">R.A.I.N. Lab</h2>
      <p className="mt-1 text-xs leading-relaxed">
        A fictional laboratory inside the Bethesda simulation. The interior is invented;
        the city outside its door is the simulator. R.A.I.N. may propose what to
        investigate. Bethesda determines what happens. Recorded observations determine
        what was observed. A person decides what is allowed.
      </p>
      <blockquote className="mt-3 border-l-2 border-[#0B5D63] pl-3 text-xs italic">
        Inference is not evidence. Evidence is not permission. Confidence is not
        authority.
        <footer className="mt-1 not-italic text-slate-400">— R.A.I.N. Lab</footer>
      </blockquote>
      <Section title="ROOMS">
        <ul className="space-y-1">
          {ROOM_IDS.filter((r) => r !== "threshold").map((r) => (
            <li key={r}>
              <strong>{ROOMS[r].label}</strong> — {ROOMS[r].hint}
            </li>
          ))}
        </ul>
      </Section>
      <Section title="THE CITY">
        Bethesda keeps running while you are inside (tick {store.sim.tick}
        {store.sim.paused ? ", paused" : ""}). Its rendering stops; its rules do not.
      </Section>
      <RuntimeLine store={store} />
      <button className={button + " mt-3"} onClick={onExit}>
        Return to Bethesda
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
function MeetingVerdict({
  verdict,
  split,
  onBay,
}: {
  verdict: Verdict;
  split: ReturnType<typeof branches>;
  onBay: () => void;
}) {
  return (
    <>
      <Section title="WHERE THE ROOM STANDS">
        <p>
          <strong>Agreed:</strong> {verdict.agreed}
        </p>
        <p className="mt-1 border-l-2 border-amber-200/60 pl-2">
          <strong>Contested</strong> (kept apart, not merged): {verdict.contested}
          {split?.challengers.length ? (
            <span className={quiet}>
              {" "}
              Challenges from {split.challengers.join(" and ")} in turns{" "}
              {split.turns.join(", ")}.
            </span>
          ) : null}
        </p>
        <p className={quiet + " mt-1"}>
          Agreement among the perspectives is not validation, and a disagreement is not
          resolved by being outvoted.
        </p>
      </Section>
      <Section title="NEXT INVESTIGATION">
        <div className="rounded border border-[#0B5D63] p-2">
          <p>{verdict.next_move}</p>
          <button className={button + " mt-2"} onClick={onBay}>
            Turn it into a Bethesda experiment →
          </button>
        </div>
        {verdict.read_next.length ? (
          <p className={quiet + " mt-1"}>Read next: {verdict.read_next.join(" · ")}</p>
        ) : null}
      </Section>
    </>
  );
}

export function ResearchPanel({
  store,
  go,
}: {
  store: LabStore;
  go: (r: RoomId) => void;
}) {
  const m = store.meeting;
  const [question, setQuestion] = useState(m?.record.question ?? "");
  const meetingId = m?.record.meeting_id;
  // Show the question the meeting answered, whichever way it arrived.
  useEffect(() => {
    if (m) setQuestion(m.record.question);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId]);
  const live = store.mode() === "LIVE";
  const record = m?.record;
  const shown = record ? record.turns.slice(0, m.revealed) : [];
  const split = record ? branches(record) : null;
  return (
    <div>
      <h2 className="text-base">Research Panel</h2>
      <RuntimeLine store={store} />
      <form
        className="mt-2"
        onSubmit={(e) => {
          e.preventDefault();
          void store.ask(question);
        }}
      >
        <label htmlFor="rain-question" className={label}>
          RESEARCH QUESTION
        </label>
        <textarea
          id="rain-question"
          value={question}
          maxLength={LIMITS.question}
          rows={3}
          onChange={(e) => setQuestion(e.target.value)}
          className="mt-1 w-full rounded border border-teal-100/25 bg-transparent p-2 text-xs"
          placeholder="What evidence would distinguish coordinated crowd behavior from coincidental local responses after a Metro closure?"
        />
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            className={button}
            type="submit"
            disabled={!live || store.asking || !question.trim()}
            title={live ? "" : "R.A.I.N. is OFFLINE"}
          >
            {store.asking ? "Asking…" : "Ask R.A.I.N."}
          </button>
          {store.meetingProgress ? (
            <button className={button} type="button" onClick={() => store.stopAsking()}>
              Stop the meeting
            </button>
          ) : null}
          <button className={button} type="button" onClick={() => store.playDemo()}>
            Replay the recorded meeting (DEMO)
          </button>
        </div>
      </form>
      <p role="status" aria-live="polite" className="mt-2 text-[11px] text-teal-100">
        {store.note}
      </p>
      {record && m ? (
        <div className="mt-2">
          <p className="flex flex-wrap gap-2">
            <span className="rounded bg-[#0B5D63] px-1.5 py-0.5 font-mono text-[9px] tracking-widest">
              {m.source === "DEMO" ? "PRERECORDED · DEMO" : "LIVE"}
            </span>
            {record.generation === "scripted" ? (
              <span className="rounded border border-amber-200/50 px-1.5 py-0.5 font-mono text-[9px] tracking-widest text-amber-100">
                SCRIPTED · NO MODEL RAN
              </span>
            ) : (
              <span className="rounded border border-amber-200/50 px-1.5 py-0.5 font-mono text-[9px] tracking-widest text-amber-100">
                MODEL · {record.model}
              </span>
            )}
          </p>
          <p className={quiet + " mt-1"}>
            {record.meeting_id} · {record.engine} · {record.rain.repository}{" "}
            {short(record.rain.commit)} · produced {record.produced_at}
          </p>
          <p className="mt-2 text-xs">
            <strong>Question:</strong> {record.question}
          </p>
          {record.grounding !== null &&
          record.matched_terms !== null &&
          record.missing_terms !== null ? (
            <p className={quiet}>
              Grounding: {record.grounding}. The corpus covers{" "}
              {record.matched_terms.join(", ") || "none of the question's terms"}; it is
              silent on {record.missing_terms.join(", ") || "nothing"}.
            </p>
          ) : (
            <p className={quiet}>
              R.A.I.N.'s model meeting does not grade how well the corpus covers the
              question; each quote below is checked on its own.
            </p>
          )}
          {record.source_artifact ? (
            <p className={quiet}>
              R.A.I.N.'s own record: session {record.source_artifact.session_id} ·{" "}
              {record.source_artifact.schema} · {record.source_artifact.status} · SHA-256{" "}
              {short(record.source_artifact.sha256, 16)}
            </p>
          ) : null}
          <ol className="mt-2 space-y-2" aria-label="Meeting turns">
            {shown.map((t) => {
              const grounded = t.quotes.some((q) => q.verified);
              const current = m.revealed < record.turns.length && t.index === m.revealed;
              return (
                <li
                  key={t.index}
                  className={`rounded border p-2 ${current ? "border-[#3fb6b0]" : "border-teal-100/10"}`}
                >
                  <p className="text-xs">
                    <strong>{t.speaker}</strong>{" "}
                    <span className={quiet}>
                      · {t.role} · {t.move}
                    </span>{" "}
                    <Badge c="INTERPRETATION" />
                    {record.generation === "model" && t.generation === "scripted" ? (
                      <span className="ml-1 font-mono text-[9px] tracking-widest text-amber-200">
                        A FIXED LINE IN R.A.I.N.'S CODE · NOT THE MODEL
                      </span>
                    ) : !grounded ? (
                      <span className="ml-1 font-mono text-[9px] tracking-widest text-amber-200">
                        UNGROUNDED · NO VERIFIED SPAN
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed">{t.lead}</p>
                  {t.quotes.map((q, i) => (
                    <blockquote
                      key={i}
                      className="mt-1 rounded border border-[#e8dcc0]/40 bg-[#e8dcc0]/5 p-2 text-xs"
                    >
                      <Badge c="SOURCE" /> “{q.text}”
                      <footer className={quiet}>
                        {q.source}:{q.line} · characters {q.span_start}–{q.span_end} ·{" "}
                        {q.verified ? "✓ verified verbatim" : "✕ NOT verified"}
                      </footer>
                    </blockquote>
                  ))}
                  {t.unverified ? (
                    <p className={quiet + " mt-1"}>
                      ✕ {t.unverified} quotation{t.unverified === 1 ? "" : "s"} in this
                      turn did not verify against R.A.I.N.'s corpus and{" "}
                      {t.unverified === 1 ? "is" : "are"} not shown as a source.
                    </p>
                  ) : null}
                  {t.coda ? (
                    <p className="mt-1 text-xs leading-relaxed">{t.coda}</p>
                  ) : null}
                </li>
              );
            })}
          </ol>
          {m.revealed < record.turns.length ? (
            <button className={button + " mt-2"} onClick={() => store.revealAll()}>
              Show all {record.turns.length} turns
            </button>
          ) : (
            <>
              {record.verdict === null ? (
                <Section title="WHERE THE ROOM STANDS">
                  <p>
                    R.A.I.N.'s model meeting records no verdict, so the lab states none:
                    the turns above are the record. Agreement among the perspectives would
                    not be validation in any case.
                  </p>
                  <button className={button + " mt-2"} onClick={() => go("bay")}>
                    Turn a question into a Bethesda experiment →
                  </button>
                </Section>
              ) : (
                <MeetingVerdict
                  verdict={record.verdict}
                  split={split}
                  onBay={() => go("bay")}
                />
              )}
              <Section title="CITATION AUDIT">
                <Badge c="VALIDATED CHECK" /> {record.audit.verified} of{" "}
                {record.audit.checked} quotes verified verbatim over{" "}
                {record.audit.corpus_files} corpus files (
                {short(record.audit.corpus_sha256, 16)}). A citation audit, not validated
                claims: a verified quote occurs in a source; it does not establish that
                the source is right or that it supports the conclusion.
              </Section>
            </>
          )}
        </div>
      ) : (
        <p className={quiet + " mt-2"}>
          The four perspectives are defined by their SOUL files (
          {PERSPECTIVES.map((p) => SOUL_FILES[p]).join(", ")}), bundled with the research
          runtime. Their roles and words arrive in R.A.I.N.'s records; this lab writes
          neither.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
export function EvidenceLibrary({ store }: { store: LabStore }) {
  const [only, setOnly] = useState<Category | null>(null);
  const items = useMemo(
    () =>
      evidenceItems(
        store.meeting?.record ?? null,
        store.records.slice(0, 6),
        store.avatarObservations.slice(0, 8),
      ),
    // The store's version is the dependency: records and meeting change through it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store.version],
  );
  const shown = only ? items.filter((i) => i.category === only) : items;
  return (
    <div>
      <h2 className="text-base">Evidence Library</h2>
      <p className={quiet}>
        Six kinds of material, never blurred. Each item carries exactly one label.
      </p>
      <ul
        className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2"
        aria-label="Evidence categories"
      >
        {(Object.keys(CATEGORIES) as Category[]).map((c) => (
          <li key={c}>
            <button
              className="text-left"
              aria-pressed={only === c}
              onClick={() => setOnly(only === c ? null : c)}
            >
              <Badge c={c} />{" "}
              <span className={quiet}>
                {CATEGORIES[c].note} ({items.filter((i) => i.category === c).length})
              </span>
            </button>
          </li>
        ))}
      </ul>
      {!items.length ? (
        <p className={quiet + " mt-3"}>
          Nothing yet. A meeting adds its sources and interpretations; an experiment adds
          its hypothesis, checks, observations and results.
        </p>
      ) : null}
      <ul className="mt-3 space-y-2">
        {shown.map((item) => (
          <li key={item.id} className="rounded border border-teal-100/10 p-2 text-xs">
            <p>
              <Badge c={item.category} /> <strong>{item.title}</strong>
              {item.grounded === false ? (
                <span className="ml-1 font-mono text-[9px] tracking-widest text-amber-200">
                  NOT GROUNDED
                </span>
              ) : null}
            </p>
            <p className="mt-1 leading-relaxed">{item.body}</p>
            <p className={quiet + " mt-1"}>{item.provenance}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
function ProposalForm({ store, question }: { store: LabStore; question: string }) {
  const [scenario, setScenario] = useState<ScenarioId>("metro_closure");
  const [location, setLocation] = useState<LocationId>("bethesda_metro");
  const [metric, setMetric] = useState<MetricId>("cohort_mean_distance_m");
  const [direction, setDirection] = useState<"increase" | "decrease">("increase");
  const [effect, setEffect] = useState("10");
  const [seeds, setSeeds] = useState("101, 202, 303");
  const [warmup, setWarmup] = useState("300");
  const [window, setWindow] = useState("1200");
  const [hypothesis, setHypothesis] = useState("");
  const places = SCENARIO_LOCATIONS[scenario];
  const field =
    "mt-0.5 w-full rounded border border-teal-100/25 bg-[#0d2328] p-1 text-xs";
  return (
    <form
      className="grid grid-cols-2 gap-2 text-[11px]"
      onSubmit={(e) => {
        e.preventDefault();
        store.proposeByHand({
          schema: "rain-bethesda-experiment/v1",
          proposal_id: `human-form-${Date.now().toString(36)}`,
          origin: "human",
          question: question || "A person's own question.",
          hypothesis: hypothesis || "A person's own hypothesis.",
          scenario,
          location,
          primary_metric: metric,
          expected_direction: direction,
          minimum_effect: Number(effect),
          comparison: "matched_seed_control",
          seeds: seeds
            .split(/[\s,]+/)
            .filter(Boolean)
            .map(Number),
          warmup_ticks: Number(warmup),
          observation_window_ticks: Number(window),
          rain_decision: null,
          meeting_id: store.meeting?.record.meeting_id ?? null,
        });
      }}
    >
      <label>
        Scenario
        <select
          className={field}
          value={scenario}
          onChange={(e) => {
            const s = e.target.value as ScenarioId;
            setScenario(s);
            setLocation(SCENARIO_LOCATIONS[s][0]!);
          }}
        >
          {SCENARIO_IDS.map((s) => (
            <option key={s} value={s}>
              {SCENARIO_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Place
        <select
          className={field}
          value={location}
          onChange={(e) => setLocation(e.target.value as LocationId)}
        >
          {places.map((l) => (
            <option key={l} value={l}>
              {LOCATION_LABELS[l]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Primary metric
        <select
          className={field}
          value={metric}
          onChange={(e) => setMetric(e.target.value as MetricId)}
        >
          {METRIC_IDS.map((m) => (
            <option key={m} value={m}>
              {METRIC_LABELS[m]} ({METRICS[m].unit})
            </option>
          ))}
        </select>
      </label>
      <label>
        Predicted direction
        <select
          className={field}
          value={direction}
          onChange={(e) => setDirection(e.target.value as "increase" | "decrease")}
        >
          <option value="increase">increase</option>
          <option value="decrease">decrease</option>
        </select>
      </label>
      <label>
        Minimum effect ({METRICS[metric].unit})
        <input
          className={field}
          value={effect}
          onChange={(e) => setEffect(e.target.value)}
        />
      </label>
      <label>
        Seeds (1–{EXPERIMENT_BOUNDS.maxSeeds})
        <input
          className={field}
          value={seeds}
          onChange={(e) => setSeeds(e.target.value)}
        />
      </label>
      <label>
        Warm-up ticks
        <input
          className={field}
          value={warmup}
          onChange={(e) => setWarmup(e.target.value)}
        />
      </label>
      <label>
        Window ticks
        <input
          className={field}
          value={window}
          onChange={(e) => setWindow(e.target.value)}
        />
      </label>
      <label className="col-span-2">
        Hypothesis
        <textarea
          className={field}
          rows={2}
          maxLength={LIMITS.hypothesis}
          value={hypothesis}
          onChange={(e) => setHypothesis(e.target.value)}
        />
      </label>
      <button className={button + " col-span-2"} type="submit">
        Validate this proposal
      </button>
    </form>
  );
}

function Authorize({ store, c }: { store: LabStore; c: ExperimentCase }) {
  const [operator, setOperator] = useState("R.A.I.N.Operator");
  const [prefix, setPrefix] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const sha = c.validated!.definitionSha256;
  return (
    <div className="mt-3 rounded border border-[#0B5D63] p-2 text-xs">
      <h3 className={label}>HUMAN AUTHORIZATION</h3>
      <p className="mt-1">
        Definition SHA-256: <code className="break-all font-mono text-[10px]">{sha}</code>
      </p>
      <p className={quiet + " mt-1"}>
        Approving writes a <strong>local operator authorization record</strong>: a hashed
        attestation, by this browser, bound to this exact digest. It is not authenticated
        identity and not a signature. Any change to the definition voids it.
      </p>
      <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
        <label>
          Operator role label
          <input
            className="mt-0.5 w-full rounded border border-teal-100/25 bg-transparent p-1"
            value={operator}
            maxLength={64}
            onChange={(e) => setOperator(e.target.value)}
          />
        </label>
        <label>
          First {CONFIRMATION_LENGTH} characters of the digest
          <input
            className="mt-0.5 w-full rounded border border-teal-100/25 bg-transparent p-1 font-mono"
            value={prefix}
            maxLength={CONFIRMATION_LENGTH}
            autoComplete="off"
            onChange={(e) => setPrefix(e.target.value)}
          />
        </label>
      </div>
      <label className="mt-2 flex items-center gap-2">
        <input
          type="checkbox"
          checked={reviewed}
          onChange={(e) => setReviewed(e.target.checked)}
        />
        I reviewed the protocol, its failure condition and its limitations.
      </label>
      <div className="mt-2 flex gap-2">
        <button
          className={button}
          onClick={() =>
            setErrors(store.approve(c.id, { operator, typedPrefix: prefix, reviewed }))
          }
        >
          Authorize this definition
        </button>
        <button className={button} onClick={() => store.decline(c.id)}>
          Decline
        </button>
      </div>
      {errors.length ? (
        <ul role="alert" className="mt-2 list-disc pl-5 text-amber-100">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function CaseView({ store, c }: { store: LabStore; c: ExperimentCase }) {
  const v = c.validated;
  const state = c.lifecycle.state!;
  const p = v ? protocolOf(v.definition) : null;
  const identity = store.runtime.status?.identity;
  return (
    <div className="mt-3">
      <p className="text-xs">
        <span className="rounded bg-[#0B5D63] px-1.5 py-0.5 font-mono text-[10px] tracking-widest">
          {STATE_LABELS[state]}
        </span>{" "}
        {v ? <strong>{v.experimentId}</strong> : <span>rejected proposal</span>}{" "}
        <span className={quiet}>
          · origin{" "}
          {v
            ? v.proposal.origin === "fixture"
              ? "DEMO fixture (written by hand; no model or R.A.I.N. process produced it)"
              : v.proposal.origin === "rain"
                ? `R.A.I.N. bounded decision ${short(v.proposal.rain_decision?.decision_id ?? "", 8)}`
                : "a person"
            : "unknown"}
        </span>
      </p>
      {p ? (
        <table className="mt-2 w-full text-left text-xs">
          <caption className="sr-only">Experiment protocol</caption>
          <tbody>
            {(
              [
                ["QUESTION", p.question],
                ["HYPOTHESIS", p.hypothesis],
                ["CONTROL", p.control],
                ["TREATMENT", p.treatment],
                ["PRIMARY METRIC", p.metric],
                ["SEEDS", p.seeds],
                ["FAILURE CONDITION", p.failure],
                ["EXPECTED OBSERVATIONS", p.expected],
              ] as const
            ).map(([k, val]) => (
              <tr key={k} className="border-t border-teal-100/10 align-top">
                <th
                  scope="row"
                  className="w-32 py-1 pr-2 font-mono text-[9px] tracking-widest text-teal-200"
                >
                  {k}
                </th>
                <td className="py-1">{val}</td>
              </tr>
            ))}
            <tr className="border-t border-teal-100/10 align-top">
              <th
                scope="row"
                className="py-1 pr-2 font-mono text-[9px] tracking-widest text-teal-200"
              >
                LIMITATIONS
              </th>
              <td className="py-1">
                <ul className="list-disc pl-4">
                  {p.limitations.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              </td>
            </tr>
            <tr className="border-t border-teal-100/10 align-top">
              <th
                scope="row"
                className="py-1 pr-2 font-mono text-[9px] tracking-widest text-teal-200"
              >
                AUTHORIZATION STATUS
              </th>
              <td className="py-1">
                {c.authorization
                  ? `Authorized by local operator ${c.authorization.operator} at ${c.authorization.authorized_at} (not authenticated identity) · record ${short(c.authorization.authorization_sha256, 16)}`
                  : state === "REJECTED"
                    ? "Never authorized."
                    : "Awaiting human approval. Nothing runs until a person authorizes this exact definition."}
                {c.preregistration
                  ? ` · pre-registered with R.A.I.N. as ${c.preregistration.experiment_id}`
                  : ""}
              </td>
            </tr>
          </tbody>
        </table>
      ) : (
        <p className="mt-2 text-xs">
          Rejected input (shown as text):{" "}
          <code className="break-all">{c.rejectedInput}</code>
        </p>
      )}
      <Section title="DETERMINISTIC CHECKS">
        <ul className="space-y-0.5">
          {c.checks.map((k) => (
            <li key={k.id}>
              {k.ok ? (
                <Badge c="VALIDATED CHECK" />
              ) : (
                <span className="text-amber-200">✕ FAILED</span>
              )}{" "}
              {k.label}: <span className={quiet}>{k.detail}</span>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="LIFECYCLE">
        <ol className="list-decimal pl-5">
          {c.lifecycle.history.map((t, i) => (
            <li key={i}>
              {STATE_LABELS[t.state]}{" "}
              <span className={quiet}>
                · {t.at} · {t.detail}
              </span>
            </li>
          ))}
        </ol>
      </Section>
      {state === "AWAITING_HUMAN_APPROVAL" ? <Authorize store={store} c={c} /> : null}
      {state === "AUTHORIZED" ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            className={button}
            onClick={() => store.runLocal(c.id)}
            disabled={!!store.run}
          >
            Run in Bethesda (not pre-registered with R.A.I.N.)
          </button>
          {store.mode() === "LIVE" && identity?.registry.available ? (
            <button
              className={button}
              onClick={() => void store.preregisterAndRun(c.id)}
              disabled={!!store.run}
            >
              Pre-register with R.A.I.N., run, and report the measurements
            </button>
          ) : null}
        </div>
      ) : null}
      {state === "RUNNING" && store.run?.caseId === c.id ? (
        <div className="mt-3 text-xs">
          <p>
            Arm {(store.run.progress?.armIndex ?? 0) + 1} of{" "}
            {store.run.progress?.arms ?? "?"}: {store.run.progress?.arm ?? "starting"} ·
            seed {store.run.progress?.seed ?? "?"} · tick {store.run.progress?.tick ?? 0}{" "}
            of {store.run.progress?.totalTicks ?? "?"}
          </p>
          <button className={button + " mt-2"} onClick={() => store.cancelActiveRun()}>
            Cancel run (recorded as FAILED)
          </button>
        </div>
      ) : null}
      {c.record && c.record.run ? (
        <p className="mt-2 text-xs">
          {outcomeText(c.record)} — {c.record.outcome.summary} See the Registry for the
          record, its replay and its export.
        </p>
      ) : null}
    </div>
  );
}

const WHY_NOT: Partial<Record<string, string>> = {
  INSUFFICIENT_CALIBRATION:
    "R.A.I.N. acts on an engine's answer only once that engine has been calibrated on this kind of decision, and it has not been",
  POLICY_REQUIRES_REVIEW:
    "the question may not leave this machine, so the remote engine was not asked (RAIN_DECISION_REMOTE_ALLOWED is off)",
  DISABLED: "R.A.I.N.'s decision mode is off",
  LOW_CONFIDENCE: "the answer's confidence was below the calibrated threshold",
  MARGIN_TOO_SMALL: "the top two options were too close to call",
};
/** The last decision R.A.I.N. handed back, with every engine it consulted, as returned. */
function HandedBack({ store }: { store: LabStore }) {
  const h = store.handoffs[0];
  if (!h) return null;
  const pick = suggestion(h);
  return (
    <Section title="R.A.I.N. HANDED THE CHOICE BACK">
      <p>
        R.A.I.N.'s router made no proposal: {h.destination}
        {h.reason ? ` · ${h.reason}` : ""}{" "}
        <span className={quiet}>(decision {h.decisionId.slice(0, 8)}…)</span>
      </p>
      {h.attempts.length ? (
        <ul className="mt-1 space-y-1">
          {h.attempts.map((a, i) => {
            const asked =
              a.model !== null || a.probabilities.length > 0 || !!a.error_code;
            const shown = [...a.probabilities].sort((x, y) => y[1] - x[1]);
            const named = shown.filter(([, v]) => v > 0);
            return (
              <li key={i} className="rounded border border-teal-100/10 p-1">
                <Badge c="INTERPRETATION" /> {engineName(a.engine)}
                {a.model ? ` · ${a.model}` : ""}:{" "}
                {!asked
                  ? "not asked"
                  : a.selected
                    ? `chose ${a.selected}`
                    : a.error_code
                      ? `did not answer (${a.error_code})`
                      : "chose nothing"}
                {named.length ? (
                  <span className={quiet}>
                    {" "}
                    · probabilities as returned:{" "}
                    {named.map(([id, v]) => `${id} ${v}`).join(" · ")}
                    {shown.length > named.length ? " · the rest 0" : ""}
                  </span>
                ) : null}
                {a.confidence !== null ? (
                  <span className={quiet}> · confidence {a.confidence}</span>
                ) : null}
                {a.reason ? (
                  <span className="text-amber-200">
                    {" "}
                    · NOT ACTED ON — {a.reason}
                    {WHY_NOT[a.reason] ? `: ${WHY_NOT[a.reason]}` : ""}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className={quiet}>
          No engine was consulted
          {h.reason && WHY_NOT[h.reason] ? `: ${WHY_NOT[h.reason]}` : ""}.
        </p>
      )}
      {pick ? (
        <button
          className={button + " mt-2"}
          onClick={() => store.adoptSuggestion(h.decisionId)}
        >
          Propose {pick.selected} as my own
        </button>
      ) : null}
    </Section>
  );
}

export function ExperimentBay({ store }: { store: LabStore }) {
  const question = store.meeting?.record.question ?? "";
  const [option, setOption] = useState(OPTIONS[0]!.id);
  const [writing, setWriting] = useState(false);
  useEffect(() => store.sweepStale(), [store]);
  const focus = store.caseById(store.focusCase) ?? store.cases[0] ?? null;
  return (
    <div>
      <h2 className="text-base">Experiment Bay</h2>
      <p className={quiet}>
        A proposal names a scenario, a mapped place and a metric from a closed vocabulary.
        The host compiles it with the city's own scenario compiler; nothing a proposer
        writes can carry a coordinate, code or a world mutation. Every run needs your
        approval.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button className={button} onClick={() => store.proposeDemo()}>
          Load the DEMO's scripted proposal
        </button>
        <button
          className={button}
          disabled={store.mode() !== "LIVE"}
          onClick={() =>
            void store.askRainForProposal(
              question || "An open question about the simulated city.",
            )
          }
        >
          Ask R.A.I.N. to choose an experiment
        </button>
        <button
          className={button}
          onClick={() => setWriting(!writing)}
          aria-expanded={writing}
        >
          {writing ? "Close the proposal form" : "Write a proposal"}
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-end gap-2 text-[11px]">
        <label>
          Or choose a supported experiment
          <select
            className="mt-0.5 block max-w-[min(420px,80vw)] rounded border border-teal-100/25 bg-[#0d2328] p-1 text-xs"
            value={option}
            onChange={(e) => setOption(e.target.value)}
          >
            {OPTIONS.filter((o) => o.template).map((o) => (
              <option key={o.id} value={o.id}>
                {o.description}
              </option>
            ))}
          </select>
        </label>
        <button className={button} onClick={() => store.proposeOption(option, question)}>
          Propose it
        </button>
      </div>
      {writing ? (
        <div className="mt-2 rounded border border-teal-100/10 p-2">
          <ProposalForm store={store} question={question} />
        </div>
      ) : null}
      <p role="status" aria-live="polite" className="mt-2 text-[11px] text-teal-100">
        {store.proposalNote}
      </p>
      <HandedBack store={store} />
      {store.cases.length > 1 ? (
        <div className="mt-2 flex flex-wrap gap-1" aria-label="Cases">
          {store.cases.map((c) => (
            <button
              key={c.id}
              className="rounded border border-teal-100/20 px-2 py-0.5 text-[10px]"
              aria-pressed={focus?.id === c.id}
              onClick={() => store.setFocusCase(c.id)}
            >
              {c.validated?.experimentId ?? "rejected"} ·{" "}
              {STATE_LABELS[c.lifecycle.state!]}
            </button>
          ))}
        </div>
      ) : null}
      {focus ? <CaseView store={store} c={focus} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
function MapCanvas({
  draw,
  label: name,
}: {
  draw: (c: CanvasRenderingContext2D) => void;
  label: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current?.getContext("2d");
    if (c) draw(c);
  });
  return (
    <canvas ref={ref} width={180} height={180} className="h-36 w-36" aria-label={name} />
  );
}
function Chart({ store }: { store: LabStore }) {
  const run = store.run;
  if (!run || !run.series.length) return null;
  const seed = run.progress?.seed;
  const points = run.series.filter((s) => s.seed === seed && s.value !== null);
  const values = points.map((p) => p.value!);
  const min = Math.min(...values, 0),
    max = Math.max(...values, 1);
  const ticks = points.map((p) => p.tick);
  const t0 = Math.min(...ticks),
    t1 = Math.max(...ticks, t0 + 1);
  const path = (arm: string) =>
    points
      .filter((p) => p.arm === arm)
      .map(
        (p, i) =>
          `${i ? "L" : "M"}${(((p.tick - t0) / (t1 - t0)) * 280 + 10).toFixed(1)},${(110 - ((p.value! - min) / (max - min || 1)) * 100).toFixed(1)}`,
      )
      .join(" ");
  return (
    <figure className="mt-2">
      <svg
        viewBox="0 0 300 120"
        className="w-full max-w-sm"
        role="img"
        aria-label={`Primary metric over the window for seed ${seed}: control and treatment`}
      >
        <rect x="0" y="0" width="300" height="120" fill="#071a1d" />
        <path
          d={path("control")}
          stroke="#9fb8c9"
          strokeWidth="2"
          fill="none"
          strokeDasharray="4 3"
        />
        <path d={path("treatment")} stroke="#3fb6b0" strokeWidth="2" fill="none" />
      </svg>
      <figcaption className={quiet}>
        Seed {seed}: control (dashed) and treatment (solid), {min.toFixed(1)}–
        {max.toFixed(1)}. Simulator state, sampled every{" "}
        {EXPERIMENT_BOUNDS.sampleInterval} ticks.
      </figcaption>
    </figure>
  );
}
function Presence({ store }: { store: LabStore }) {
  const [who, setWho] = useState<Perspective>("Luca");
  const [place, setPlace] = useState<LocationId>("bethesda_row");
  const field = "rounded border border-teal-100/25 bg-[#0d2328] p-1 text-xs";
  return (
    <Section title="PERSPECTIVES IN THE CITY">
      <p className={quiet}>
        An avatar walks the mapped sidewalks from the lab's door to a place and back. It
        is not a simulation agent, and where it stands is a place to look, not a thing
        that was seen: only inside the place's {REGION_RADIUS} m observation region does
        the simulator record an observation, from its own state, with the avatar named as
        the one who asked.
      </p>
      <div className="mt-2 flex flex-wrap items-end gap-2 text-[11px]">
        <label>
          Perspective
          <select
            className={field + " block"}
            value={who}
            onChange={(e) => setWho(e.target.value as Perspective)}
          >
            {PERSPECTIVES.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <label>
          Place
          <select
            className={field + " block"}
            value={place}
            onChange={(e) => setPlace(e.target.value as LocationId)}
          >
            {LOCATION_IDS.map((l) => (
              <option key={l} value={l}>
                {LOCATION_LABELS[l]}
              </option>
            ))}
          </select>
        </label>
        <button className={button} onClick={() => store.sendOuting(who, place)}>
          Send to observe
        </button>
      </div>
      <p role="status" aria-live="polite" className="mt-1 text-[11px] text-teal-100">
        {store.presenceNote}
      </p>
      {store.outings.length ? (
        <ul className="mt-1 list-disc pl-5">
          {store.outings.slice(0, 6).map((o) => (
            <li key={o.id}>
              {o.who} → {LOCATION_LABELS[o.location]}:{" "}
              {positionAt(o, store.sim.tick).phase} · {Math.round(o.length)} m each way
              {o.refused ? ` · refused: ${o.refused}` : ""}
            </li>
          ))}
        </ul>
      ) : null}
      {store.avatarObservations.length ? (
        <>
          <ul className="mt-1 space-y-1">
            {store.avatarObservations.slice(0, 4).map((o) => (
              <li
                key={`${o.who}${o.tick}`}
                className="rounded border border-teal-100/10 p-1"
              >
                <Badge c="OBSERVATION" /> {o.place} at tick {o.tick} (asked by {o.who}):{" "}
                {Object.entries(o.packet.metrics)
                  .filter(([, v]) => v !== null)
                  .map(([k, v]) => `${k} ${v}`)
                  .join(" · ")}
                <span className={quiet}> · world {o.packet.world_hash}</span>
              </li>
            ))}
          </ul>
          <button
            className={button + " mt-1"}
            onClick={() =>
              download(
                "bethesda-avatar-observations.json",
                JSON.stringify(store.avatarObservations, null, 1),
              )
            }
          >
            Export observations
          </button>
        </>
      ) : null}
    </Section>
  );
}
function Tools({ store }: { store: LabStore }) {
  const [tool, setTool] = useState<ToolName>("observe_nearby_actors");
  const [place, setPlace] = useState<LocationId>("bethesda_metro");
  const [other, setOther] = useState<LocationId>("bethesda_row");
  const [radius, setRadius] = useState(String(SENSOR.default));
  const [run, setRun] = useState("");
  const [arm, setArm] = useState("");
  const [tick, setTick] = useState("400");
  const field = "rounded border border-teal-100/25 bg-[#0d2328] p-1 text-xs";
  const record =
    store.records.find((r) => r.run_id === run) ?? store.records.find((r) => r.run);
  const located = !tool.startsWith("request_") && tool !== "measure_distance";
  const request = () => {
    if (tool === "measure_distance") return { tool, from: place, to: other };
    if (tool === "request_metric_snapshot")
      return {
        tool,
        run_id: record?.run_id ?? "",
        arm_id: arm || record?.run?.arms[0]?.id || "",
        tick: Number(tick),
      };
    if (tool === "request_replay_segment")
      return {
        tool,
        run_id: record?.run_id ?? "",
        arm_id: arm || record?.run?.arms[0]?.id || "",
        from_tick: 0,
        to_tick: Number(tick),
      };
    if (tool === "inspect_current_event") return { tool, location: place };
    return { tool, location: place, radius_m: Number(radius) };
  };
  const last = store.toolResults[0];
  return (
    <Section title="BOUNDED OBSERVATION TOOLS">
      <p className={quiet}>
        Read-only inspections, typed and bounded: counts and kinds, never another agent's
        id or position. There is no tool that acts.
      </p>
      <div className="mt-2 flex flex-wrap items-end gap-2 text-[11px]">
        <label>
          Tool
          <select
            className={field + " block"}
            value={tool}
            onChange={(e) => setTool(e.target.value as ToolName)}
          >
            {TOOL_NAMES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        {tool.startsWith("request_") ? (
          <>
            <label>
              Run
              <select
                className={field + " block"}
                value={record?.run_id ?? ""}
                onChange={(e) => setRun(e.target.value)}
              >
                {store.records
                  .filter((r) => r.run)
                  .map((r) => (
                    <option key={r.run_id}>{r.run_id}</option>
                  ))}
              </select>
            </label>
            <label>
              Arm
              <select
                className={field + " block"}
                value={arm}
                onChange={(e) => setArm(e.target.value)}
              >
                {(record?.run?.arms ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.arm} · seed {a.seed}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {tool === "request_metric_snapshot" ? "Tick" : "Up to tick"}
              <input
                className={field + " block w-20"}
                value={tick}
                onChange={(e) => setTick(e.target.value)}
              />
            </label>
          </>
        ) : (
          <label>
            {tool === "measure_distance" ? "From" : "Place"}
            <select
              className={field + " block"}
              value={place}
              onChange={(e) => setPlace(e.target.value as LocationId)}
            >
              {LOCATION_IDS.map((l) => (
                <option key={l} value={l}>
                  {LOCATION_LABELS[l]}
                </option>
              ))}
            </select>
          </label>
        )}
        {tool === "measure_distance" ? (
          <label>
            To
            <select
              className={field + " block"}
              value={other}
              onChange={(e) => setOther(e.target.value as LocationId)}
            >
              {LOCATION_IDS.map((l) => (
                <option key={l} value={l}>
                  {LOCATION_LABELS[l]}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {located && tool !== "inspect_current_event" ? (
          <label>
            Radius ({SENSOR.min}–{SENSOR.max} m)
            <input
              className={field + " block w-16"}
              value={radius}
              onChange={(e) => setRadius(e.target.value)}
            />
          </label>
        ) : null}
        <button className={button} onClick={() => store.inspect(request())}>
          Inspect
        </button>
      </div>
      {last ? (
        <pre className="mt-2 max-h-48 overflow-auto rounded bg-black/30 p-2 font-mono text-[10px]">
          {JSON.stringify(last, null, 1)}
        </pre>
      ) : null}
    </Section>
  );
}
export function ObservationRoom({ store }: { store: LabStore }) {
  const run = store.run;
  const sim = store.sim;
  const fallbacks = sim.decisions.filter((d) => d.source === "fallback").length;
  const rejected = store.records.filter((r) => r.outcome.state === "REJECTED");
  const people = (a: string) =>
    sim.agents.filter((g) => g.kind === "pedestrian" && !g.inside && g.action === a)
      .length;
  const drawArm = (c: CanvasRenderingContext2D) => {
    c.fillStyle = "#071a1d";
    c.fillRect(0, 0, 180, 180);
    const p = run?.progress;
    if (!p) return;
    const center = store.caseById(run.caseId)?.validated?.definition.center ?? {
      x: 0,
      z: 0,
    };
    const s = 180 / 900;
    const xy = (x: number, z: number) =>
      [90 + (x - center.x) * s, 90 + (z - center.z) * s] as const;
    c.fillStyle = "#9ab69b";
    for (let i = 0; i < p.pedestrians.length; i += 2) {
      const [x, y] = xy(p.pedestrians[i]!, p.pedestrians[i + 1]!);
      c.fillRect(x, y, 1.6, 1.6);
    }
    c.fillStyle = "#d4c8a4";
    for (let i = 0; i < p.vehicles.length; i += 2) {
      const [x, y] = xy(p.vehicles[i]!, p.vehicles[i + 1]!);
      c.fillRect(x, y, 2.2, 2.2);
    }
    c.strokeStyle = "#e7a56c";
    for (const e of p.events) {
      const [x, y] = xy(e.x, e.z);
      c.beginPath();
      c.arc(x, y, Math.max(2, e.r * s), 0, Math.PI * 2);
      c.stroke();
    }
  };
  return (
    <div>
      <h2 className="text-base">Observation Room</h2>
      <p className={quiet}>
        Everything here is the simulator's own state. A chart or map of it claims nothing
        about Bethesda, and nothing drawn here is ever measured.
      </p>
      <Section title="EXPERIMENT IN PROGRESS">
        {run ? (
          <>
            <p>
              {store.caseById(run.caseId)?.validated?.experimentId}: arm{" "}
              {(run.progress?.armIndex ?? 0) + 1} of {run.progress?.arms ?? "?"} —{" "}
              <strong>{run.progress?.arm ?? "starting"}</strong>, seed{" "}
              {run.progress?.seed ?? "?"}, tick {run.progress?.tick ?? 0} of{" "}
              {run.progress?.totalTicks ?? "?"}. Packets recorded: {run.series.length}.
            </p>
            <div className="mt-2 flex flex-wrap gap-3">
              <MapCanvas
                draw={drawArm}
                label="The active arm's agents around the experiment's location"
              />
              <Chart store={store} />
            </div>
            {run.progress?.packet ? (
              <p className={quiet + " mt-1"}>
                Latest <Badge c="OBSERVATION" /> tick {run.progress.packet.tick}:{" "}
                {Object.entries(run.progress.packet.metrics)
                  .map(([k, v]) => `${k} ${v ?? "not measured"}`)
                  .join(" · ")}
              </p>
            ) : null}
          </>
        ) : (
          <p>No experiment is running. Authorize one in the Experiment Bay.</p>
        )}
      </Section>
      <Section title="THE LIVE CITY">
        tick {sim.tick}
        {sim.paused ? " (paused)" : ""} · events {sim.events.length} · watching{" "}
        {people("watch")} · leaving {people("leave")} · sheltering {people("shelter")} ·
        indoors/riding {sim.agents.filter((a) => a.inside).length} · closed road edges{" "}
        {sim.closedRoads.size}
        {sim.events.length ? (
          <ul className="mt-1 list-disc pl-5">
            {sim.events.map((e) => (
              <li key={e.id}>
                {e.label} · started tick {e.startTick}
              </li>
            ))}
          </ul>
        ) : null}
      </Section>
      <Presence store={store} />
      <Tools store={store} />
      <Section title="REFUSED AND REJECTED">
        <p>
          Proposals rejected by deterministic validation or declined: {rejected.length}.
          R.A.I.N. answers that proposed nothing: {store.handoffs.length}. Jev answers the
          live city's gate replaced with its rules: {fallbacks}. Experiment arms take no
          external proposals, so they have no rejected actions to show.
        </p>
        {store.handoffs.length ? (
          <ul className="mt-1 list-disc pl-5">
            {store.handoffs.slice(0, 5).map((h) => {
              const pick = suggestion(h);
              return (
                <li key={h.decisionId}>
                  {h.at}: {h.destination}
                  {h.reason ? ` · ${h.reason}` : ""}
                  {pick
                    ? ` · ${engineName(pick.engine)} chose ${pick.selected}, not acted on`
                    : ""}
                </li>
              );
            })}
          </ul>
        ) : null}
      </Section>
      <RuntimeLine store={store} />
    </div>
  );
}

// ---------------------------------------------------------------------------
function RecordView({ store, r }: { store: LabStore; r: ExperimentRecord }) {
  const verification = store.verifications[r.run_id];
  const [arm, setArm] = useState(r.run?.arms[0]?.id ?? "");
  const p = r.provenance;
  const canReport =
    store.mode() === "LIVE" &&
    !!r.rain_preregistration &&
    !r.rain_admission &&
    !!(r.run || r.error);
  return (
    <div className="mt-3 rounded border border-teal-100/15 p-2 text-xs">
      <p>
        <strong>{r.run_id}</strong> <span className={quiet}>({r.kind})</span>
      </p>
      <p className="mt-1">
        <span aria-hidden="true">{OUTCOME_GLYPH[r.outcome.state]} </span>
        {outcomeText(r)}
      </p>
      <p className={quiet}>{r.outcome.summary}</p>
      {r.definition ? (
        <Section title="HYPOTHESIS AND PRE-REGISTRATION">
          <p>
            <Badge c="HYPOTHESIS" /> {r.definition.hypothesis}
          </p>
          <p className={quiet + " mt-1"}>
            Definition {r.experiment_id} · SHA-256 {short(r.definition_sha256, 16)} ·
            criteria {CRITERIA_RULE}:{" "}
            {r.definition.criteria.success
              .map((c) => `${c.id} ${c.metric} ${c.op} ${c.value}`)
              .join("; ")}{" "}
            · failure{" "}
            {r.definition.criteria.failure
              .map((c) => `${c.id} ${c.metric} ${c.op} ${c.value}`)
              .join("; ")}
            {" · "}
            {r.authorization
              ? `frozen and authorized at ${r.authorization.authorized_at} by local operator ${r.authorization.operator}`
              : "never authorized"}
            {r.rain_preregistration
              ? ` · pre-registered with R.A.I.N. as ${r.rain_preregistration.experiment_id} (${r.rain_preregistration.registry} registry) at ${r.rain_preregistration.created_at}`
              : " · not pre-registered with R.A.I.N."}
          </p>
          <p className={quiet}>
            Scenario: {r.definition.scenario.label} at {r.definition.scenario.place} ·
            seeds {r.definition.seeds.join(", ")}
          </p>
        </Section>
      ) : (
        <Section title="REJECTED INPUT">
          <code className="break-all">{r.rejected_input}</code>
        </Section>
      )}
      {r.run ? (
        <Section title="RESULT">
          <Badge c="SIMULATION RESULT" />
          <table className="mt-1 w-full text-left">
            <caption className="sr-only">Per-seed results</caption>
            <thead>
              <tr className={quiet}>
                <th scope="col">seed</th>
                <th scope="col">control</th>
                <th scope="col">treatment</th>
                <th scope="col">difference</th>
                <th scope="col">matched at T0</th>
              </tr>
            </thead>
            <tbody>
              {r.run.per_seed.map((s) => (
                <tr key={s.seed}>
                  <td>{s.seed}</td>
                  <td>{s.control ?? "not measured"}</td>
                  <td>{s.treatment ?? "not measured"}</td>
                  <td>{s.delta ?? "not computable"}</td>
                  <td>{s.t0_matched ? "yes" : "NO"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="mt-1">
            {[
              ...r.run.evaluation.guards,
              ...r.run.evaluation.success,
              ...r.run.evaluation.failure,
            ].map((c) => (
              <li key={c.id}>
                {c.id} {c.metric} {c.op} {c.value}: observed{" "}
                {c.observed ?? "not measured"} →{" "}
                {c.holds === null ? "not evaluable" : c.holds ? "holds" : "does not hold"}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      {r.rain_admission ? (
        <Section title="R.A.I.N.'S OWN RECORD">
          {r.rain_admission.run_id}: {r.rain_admission.status} (
          {r.rain_admission.hypothesis_verdict.replaceAll("_", " ")}) — R.A.I.N.
          interpretation (deterministic, R.A.I.N. registry):{" "}
          {r.rain_admission.interpretation.deterministic}
        </Section>
      ) : (
        <p className={quiet + " mt-2"}>
          R.A.I.N. interpretation: unavailable — this run has not been admitted by a
          R.A.I.N. registry. Export the admission bundle to admit it later.
        </p>
      )}
      {r.definition ? (
        <Section title="LIMITATIONS AND WHAT REMAINS UNRESOLVED">
          <ul className="list-disc pl-4">
            {[...r.definition.limitations, ...r.outcome.unresolved].map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </Section>
      ) : null}
      <Section title="PROVENANCE">
        lop-nur-twin {p.lop_nur_twin_commit ?? "unknown"} ({p.lop_nur_twin_source}
        {p.lop_nur_twin_dirty === null
          ? ""
          : p.lop_nur_twin_dirty
            ? ", uncommitted changes"
            : ", clean"}
        ) · R.A.I.N. runtime {p.rain_repository ?? "unknown"} {p.rain_commit ?? "unknown"}{" "}
        ({p.rain_source}) · {p.rain_contract} · {p.bethesda_contract} · {p.sim_version} ·
        map {short(p.bethesda_map_sha256)} · streetscape {short(p.streetscape_sha256)} ·
        terrain {short(p.terrain_sha256)} · provider {p.provider ?? "none"} · model{" "}
        {p.model ?? "none"} · recorded {p.recorded_at}
      </Section>
      {r.reproduction ? (
        <Section title="REPRODUCTION">
          Of {r.reproduction.source_run}: outcome{" "}
          {r.reproduction.outcome_matches ? "matches" : "DIFFERS"}; deterministic metrics{" "}
          {r.reproduction.deterministic_metrics_match ? "match" : "DIFFER"}
          {r.reproduction.mismatches.length
            ? ` (${r.reproduction.mismatches.join("; ")})`
            : ""}
          .
        </Section>
      ) : null}
      <Section title="REPLAY">
        {verification === "running" ? (
          <p>Re-simulating every arm from its recorded commands…</p>
        ) : verification ? (
          <>
            <p className={verification.ok ? "text-teal-100" : "text-amber-100"}>
              {verification.ok
                ? "Verified: every arm re-simulated identically; no model was contacted."
                : "Verification FAILED: the record does not match what the simulator does."}
            </p>
            <ul className="mt-1">
              {verification.checks.map((k) => (
                <li key={k.id}>
                  {k.ok ? "✓" : "✕"} {k.id}: <span className={quiet}>{k.detail}</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className={quiet}>Not verified in this session.</p>
        )}
      </Section>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          className={button}
          onClick={() => store.verify(r.run_id)}
          disabled={verification === "running"}
        >
          Verify by replay (no model)
        </button>
        <button
          className={button}
          onClick={() =>
            download(`bethesda-rain-record-${r.run_id}.json`, JSON.stringify(r))
          }
        >
          Export record
        </button>
        {r.run ? (
          <button
            className={button}
            onClick={() => download(runArtifactName(r), runArtifactText(r))}
          >
            Export run artifact
          </button>
        ) : null}
        {r.definition ? (
          <button
            className={button}
            onClick={() => {
              const b = admissionBundle(
                r,
                r.authorization?.operator ?? "R.A.I.N.Operator",
              );
              if (b.ok)
                download(
                  `rain-admission-${r.run_id}.json`,
                  JSON.stringify(b.value, null, 1),
                );
              else store.say("registry", "No admission bundle: " + b.errors.join("; "));
            }}
          >
            Export R.A.I.N. admission bundle
          </button>
        ) : null}
        {r.proposal ? (
          <button className={button} onClick={() => store.reproduce(r.run_id)}>
            Reproduce
          </button>
        ) : null}
        {canReport ? (
          <button
            className={button}
            onClick={() => {
              const c = store.cases.find((x) => x.record?.run_id === r.run_id);
              if (c) void store.report(c);
            }}
          >
            Return measurements to R.A.I.N.
          </button>
        ) : null}
      </div>
      {r.run ? (
        <div className="mt-2 flex flex-wrap items-end gap-2 text-[11px]">
          <label>
            Arm
            <select
              className="mt-0.5 block rounded border border-teal-100/25 bg-[#0d2328] p-1"
              value={arm}
              onChange={(e) => setArm(e.target.value)}
            >
              {r.run.arms.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.arm} · seed {a.seed}
                </option>
              ))}
            </select>
          </label>
          <button
            className={button}
            onClick={() => {
              const a = r.run!.arms.find((x) => x.id === arm);
              if (a)
                download(
                  `bethesda-replay-${a.id.replaceAll(":", "-")}.json`,
                  JSON.stringify(armTrace(a)),
                );
            }}
          >
            Export arm as a city replay (bethesda-replay/v3)
          </button>
        </div>
      ) : null}
    </div>
  );
}
/** What an unverified import says about itself, which may not even be readable. */
function claims(q: ExperimentRecord) {
  try {
    return outcomeText(q);
  } catch {
    return "an outcome the lab cannot read";
  }
}
/** Held records awaiting replay, or that failed it: shown, never evidence. */
function Quarantine({ store }: { store: LabStore }) {
  if (!store.quarantine.length) return null;
  return (
    <Section title="QUARANTINED RECORDS">
      <p className={quiet}>
        A record's digest shows only that it was not changed after it was sealed, and
        anyone can seal one or edit this browser's storage. An import, or a record kept
        from an earlier visit, is not in the registry, the Evidence Library or the tools
        until replay re-simulates every arm and matches.
      </p>
      <ul className="mt-1 space-y-1">
        {store.quarantine.map((q) => {
          const v = store.verifications[q.run_id];
          return (
            <li key={q.run_id} className="rounded border border-amber-200/30 p-1">
              <p>
                {q.run_id}{" "}
                <span className={quiet}>
                  ·{" "}
                  {store.heldFrom(q.run_id) === "storage"
                    ? "kept in this browser"
                    : "imported"}{" "}
                  · claims {claims(q)}
                </span>
              </p>
              <p className={v && v !== "running" && !v.ok ? "text-amber-100" : quiet}>
                {v === "running"
                  ? "Re-simulating every arm from its recorded commands…"
                  : v && !v.ok
                    ? "Verification FAILED: the record does not match what the simulator does. It stays quarantined."
                    : "Not verified yet."}
              </p>
              {v && v !== "running" && !v.ok ? (
                <ul className="mt-1">
                  {v.checks
                    .filter((k) => !k.ok)
                    .slice(0, 8)
                    .map((k) => (
                      <li key={k.id}>
                        ✕ {k.id}: <span className={quiet}>{k.detail}</span>
                      </li>
                    ))}
                </ul>
              ) : null}
              <div className="mt-1 flex flex-wrap gap-2">
                <button
                  className={button}
                  disabled={v === "running"}
                  onClick={() => store.verify(q.run_id)}
                >
                  Verify by replay (no model)
                </button>
                <button
                  className={button}
                  disabled={v === "running"}
                  onClick={() => store.discardImport(q.run_id)}
                >
                  {store.heldFrom(q.run_id) === "storage"
                    ? "Discard from this browser"
                    : "Discard the import"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

export function RegistryArchive({ store }: { store: LabStore }) {
  const [selected, setSelected] = useState<string | null>(null);
  const counts = (s: string) => store.records.filter((r) => r.outcome.state === s).length;
  const r = store.records.find((x) => x.run_id === selected) ?? store.records[0] ?? null;
  return (
    <div>
      <h2 className="text-base">Registry / Archive</h2>
      <p className={quiet}>
        Every ending is kept: supported, not supported, inconclusive, failed and rejected.
        COMPLETED {counts("COMPLETED")} · INCONCLUSIVE {counts("INCONCLUSIVE")} · FAILED{" "}
        {counts("FAILED")} · REJECTED {counts("REJECTED")}.
      </p>
      <p role="status" aria-live="polite" className="mt-1 text-[11px] text-teal-100">
        {store.registryNote}
      </p>
      <label className="mt-2 inline-block cursor-pointer text-[11px] underline">
        Import a record
        <input
          type="file"
          accept=".json,application/json"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            if (f.size > 8 * 1024 * 1024) {
              store.say("registry", "Record exceeds 8 MB; nothing was imported.");
              return;
            }
            void f.text().then((t) => store.importRecord(t));
          }}
        />
      </label>
      <Quarantine store={store} />
      {store.records.length ? (
        <ul className="mt-2 space-y-1">
          {store.records.map((x) => (
            <li key={x.run_id}>
              <button
                className="w-full rounded border border-teal-100/10 p-1 text-left text-[11px]"
                aria-pressed={r?.run_id === x.run_id}
                onClick={() => setSelected(x.run_id)}
              >
                <span aria-hidden="true">{OUTCOME_GLYPH[x.outcome.state]} </span>
                {x.experiment_id ?? "no definition"} · {outcomeText(x)} ·{" "}
                <span className={quiet}>{x.lifecycle.at(-1)?.at}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className={quiet + " mt-2"}>
          No records yet. Every experiment's ending lands here.
        </p>
      )}
      {r ? <RecordView store={store} r={r} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
export function SystemsRoom({ store }: { store: LabStore }) {
  const s = store.runtime.status;
  const id = s?.identity;
  const lab = labRevision();
  return (
    <div>
      <h2 className="text-base">Systems Room</h2>
      <RuntimeLine store={store} />
      <button className={button + " mt-2"} onClick={() => void store.checkRuntime()}>
        Check the runtime again
      </button>
      <Section title="R.A.I.N.">
        {id ? (
          <ul>
            <li>
              Runtime: {id.runtime.name} {id.runtime.version}, in this site's server
              process
            </li>
            <li>
              {id.rain.repository} {id.rain.commit ?? "unknown"} ·{" "}
              {id.rain.dirty === null
                ? "state unknown"
                : id.rain.dirty
                  ? "uncommitted changes"
                  : "clean"}
            </li>
            <li>
              Corpus: {id.corpus.files} files · {short(id.corpus.sha256, 16)}
            </li>
            <li>
              Meetings: {id.meeting_engine} ({id.meeting_generation}
              {id.model ? `, ${id.model}` : ", no model"})
            </li>
            <li>Bounded proposals: {id.bounded_decision}</li>
            <li>
              Remote decision engines (Jev):{" "}
              {id.remote_decisions
                ? "allowed — a decision's question is sent to TypeSafe"
                : "not allowed — no question leaves this machine"}
            </li>
            <li>
              Registry:{" "}
              {id.registry.available
                ? id.registry.scratch
                  ? "scratch"
                  : "configured"
                : `unavailable${id.registry.reason ? ` — ${id.registry.reason}` : ""}`}
            </li>
          </ul>
        ) : (
          <p>
            Not connected. The research runtime runs inside this site's server; it is
            switched off (RAIN_RUNTIME=off) or could not start. See
            docs/RAIN_LAB_BETHESDA.md, “Running LIVE”. DEMO needs nothing: it replays one
            recording.
          </p>
        )}
      </Section>
      <Section title="REVISIONS AND VERSIONS">
        <ul>
          <li>
            lop-nur-twin {lab.commit ?? "unknown"} ({lab.source}
            {lab.dirty === null ? "" : lab.dirty ? ", uncommitted changes" : ", clean"})
          </li>
          <li>
            Contracts: {RAIN_BETHESDA_SCHEMA} · {WORLD_OBSERVATION_SCHEMA} ·{" "}
            {DEFINITION_SCHEMA} · {CRITERIA_RULE}
          </li>
          <li>
            Simulator {SIM_VERSION} · map {short(DATA_VERSION, 16)} · terrain{" "}
            {short(TERRAIN_VERSION, 16)} · streetscape {short(TRANSIT_VERSION, 16)}
          </li>
        </ul>
      </Section>
      <Section title="BOUNDARIES">
        <ul className="list-disc pl-4">
          <li>
            The browser talks to this site only; the research runtime and its settings
            live on the server.
          </li>
          <li>
            Every R.A.I.N. answer is validated twice, closed-shape and size-bounded; stale
            answers are refused.
          </li>
          <li>
            R.A.I.N. cannot touch the city: it can propose ids from a closed vocabulary,
            and a person must approve each run.
          </li>
          <li>
            Experiments run on separate simulators; the live city is never paused, stepped
            or edited by the lab.
          </li>
          <li>
            No code, URL, path, coordinate or command from R.A.I.N. is ever executed,
            opened or followed.
          </li>
          <li>
            Questions go to the research runtime only when you press Ask; DEMO sends
            nothing.
          </li>
          <li>Records stay in this browser unless you export them.</li>
        </ul>
      </Section>
      <Section title="LIMITS">
        {LIMITS.meetingsPerSession} meetings per session · sessions end after{" "}
        {LIMITS.sessionMinutes} minutes ·{" "}
        {LIMITS.meetingsPerSession * LIMITS.sessionsPerAddress} meetings per network
        address in that time · questions ≤ {LIMITS.question} characters · up to{" "}
        {EXPERIMENT_BOUNDS.maxSeeds} seeds and {EXPERIMENT_BOUNDS.maxTotalTicks} simulated
        ticks per experiment · R.A.I.N. proposals expire after{" "}
        {LIMITS.proposalTtlMs / 60000} minutes unapproved.
      </Section>
    </div>
  );
}

export function RoomPanel({
  store,
  room,
  go,
  onExit,
}: {
  store: LabStore;
  room: RoomId;
  go: (r: RoomId) => void;
  onExit: () => void;
}) {
  switch (room) {
    case "threshold":
      return <ThresholdPanel store={store} onExit={onExit} />;
    case "panel":
      return <ResearchPanel store={store} go={go} />;
    case "library":
      return <EvidenceLibrary store={store} />;
    case "bay":
      return <ExperimentBay store={store} />;
    case "observation":
      return <ObservationRoom store={store} />;
    case "registry":
      return <RegistryArchive store={store} />;
    case "systems":
      return <SystemsRoom store={store} />;
  }
}
