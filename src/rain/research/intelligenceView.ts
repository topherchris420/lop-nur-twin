/** A read-only export of a host-validated CPU research campaign. */
export interface Assessment {
  mean: number;
  lower: number;
  upper: number;
  alpha: number;
  n: number;
  verdict: string;
  checks: Record<string, boolean>;
  method: string;
}

export interface IntelligenceViewReport {
  schema: "rain-intelligence-report/v1";
  study_id: string;
  plan_sha256: string;
  question: string;
  policy: "fifo" | "information";
  status: string;
  budget: {
    ceiling_units: number;
    reserved_units: number;
    completed_units: number;
    runtime_ms: number | null;
    model_calls: number;
  };
  rivals: Array<{ id: string; prior: number; posterior: number | null }>;
  designs: Array<{
    id: string;
    hypothesis: string;
    falsification: string;
    adapter: string;
    cost_units: number;
    minimum_rate: number;
    expected_bits: number;
    screen: Assessment | null;
    confirmation: Assessment | null;
    registry_run: string | null;
    state: string;
    error: string | null;
  }>;
  reviews: Array<{
    agent: string;
    role: string;
    generation: "scripted" | "model";
    text: string;
  }>;
  events: Array<{ sequence: number; kind: string; sha256: string }>;
  limitations: string[];
}

// Every report value is text. No value can become markup, a URL, CSS or script.
function escape(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const replacements: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return replacements[character]!;
  });
}

function number(value: number | null): string {
  return Number.isFinite(value) ? String(value) : "unknown";
}

function assessment(value: Assessment | null, phase: string): string {
  if (value === null) return `<p class="muted">${phase}: not measured.</p>`;
  return `<section class="assessment" aria-label="${phase}">
    <h4>${phase}: <span class="verdict">${escape(value.verdict)}</span></h4>
    <dl class="statistics">
      <div><dt>Mean</dt><dd>${number(value.mean)}</dd></div>
      <div><dt>Fixed-n interval</dt><dd>[${number(value.lower)}, ${number(value.upper)}]</dd></div>
      <div><dt>Alpha</dt><dd>${number(value.alpha)}</dd></div>
      <div><dt>Samples (n)</dt><dd>${number(value.n)}</dd></div>
    </dl>
    <p>Method: ${escape(value.method)}</p>
    <ul class="checks">${
      Object.entries(value.checks)
        .map(
          ([check, passed]) => `<li>${passed ? "PASS" : "FAIL"}: ${escape(check)}</li>`,
        )
        .join("") || "<li>No independent checks reported.</li>"
    }</ul>
  </section>`;
}

type Design = IntelligenceViewReport["designs"][number];

function finding(design: Design): string {
  if (design.error !== null) return "Execution error; no completed claim";
  if (
    design.screen?.verdict === "invalid" ||
    design.confirmation?.verdict === "invalid"
  ) {
    return "Invalid: independent checks failed";
  }
  if (design.confirmation?.verdict === "falsified") return "Falsified in confirmation";
  if (design.screen?.verdict === "falsified") return "Falsified in screening";
  if (
    design.screen?.verdict === "supported" &&
    design.confirmation?.verdict === "supported"
  ) {
    return "Correct-session criterion supported in screening and confirmation";
  }
  if (design.confirmation !== null) return "Unresolved after confirmation";
  if (design.screen !== null) return "Screened; no confirmed claim";
  return "Not measured";
}

function issue(design: Design): boolean {
  return (
    design.error !== null ||
    [design.screen?.verdict, design.confirmation?.verdict].some(
      (verdict) => verdict === "falsified" || verdict === "invalid",
    )
  );
}

function designRow(design: Design, index: number): string {
  const measured = design.screen !== null || design.confirmation !== null;
  return `<tr data-design-row data-issue="${issue(design)}" data-measured="${measured}">
    <th scope="row"><a href="#design-${index}">${escape(design.id)}</a><span class="adapter">${escape(design.adapter)}</span></th>
    <td><p class="finding">${finding(design)}</p><p class="muted">State: ${escape(design.state)}</p>
      ${design.error === null ? "" : `<p class="error">${escape(design.error)}</p>`}</td>
    <td>${number(design.cost_units)} units per seed<br><span class="muted">${number(design.expected_bits)} conditional bits per one seed-level binary observation</span></td>
    <td><details id="design-${index}" class="design-detail">
      <summary>Inspect hypothesis and measurements</summary>
      <h3>${escape(design.id)}</h3>
      <p><strong>Plan hypothesis (narrative):</strong> ${escape(design.hypothesis)}</p>
      <p><strong>Host criterion:</strong> correct-session probability at least ${number(design.minimum_rate)}. Each panel's fixed-n lower bound must meet this threshold and all independent checks must pass for support.</p>
      <p><strong>Falsification protocol:</strong> ${escape(design.falsification)}</p>
      ${assessment(design.screen, "Screening")}
      ${assessment(design.confirmation, "Held-out confirmation")}
      <p><strong>Registry run:</strong> <code>${design.registry_run === null ? "not recorded" : escape(design.registry_run)}</code></p>
    </details></td>
  </tr>`;
}

// This script is static: it reads rendered text and changes visibility only.
// It receives no serialized report and performs no request, storage or execution.
export const INTELLIGENCE_OBSERVATORY_SCRIPT = `
(() => {
  const query = document.getElementById("design-search");
  const status = document.getElementById("design-filter");
  const rows = Array.from(document.querySelectorAll("[data-design-row]"));
  const output = document.getElementById("filter-count");
  const empty = document.getElementById("filter-empty");
  function filter() {
    const needle = query.value.trim().toLowerCase();
    let visible = 0;
    for (const row of rows) {
      const group = status.value;
      const matches = group === "all" ||
        (group === "issues" && row.dataset.issue === "true") ||
        (group === "measured" && row.dataset.measured === "true") ||
        (group === "unmeasured" && row.dataset.measured === "false");
      row.hidden = !matches || !row.textContent.toLowerCase().includes(needle);
      if (!row.hidden) visible += 1;
    }
    output.textContent = visible + " of " + rows.length + " designs shown";
    empty.hidden = visible !== 0;
  }
  query.addEventListener("input", filter);
  status.addEventListener("change", filter);
  document.getElementById("open-details").addEventListener("click", () => {
    for (const row of rows) if (!row.hidden) row.querySelector("details").open = true;
  });
  document.getElementById("close-details").addEventListener("click", () => {
    for (const detail of document.querySelectorAll(".design-detail")) detail.open = false;
  });
  filter();
})();`;

/**
 * Pure, deterministic presentation. The host's fixed-n assessments determine
 * findings; this export never recomputes statistics or mutates research memory.
 * All controls work offline and all report content remains readable without JS.
 */
export function renderIntelligenceObservatory(report: IntelligenceViewReport): string {
  const issues = report.designs.filter(issue);
  const measured = report.designs.filter(
    (design) => design.screen !== null || design.confirmation !== null,
  ).length;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; object-src 'none'">
  <title>Research observatory — ${escape(report.study_id)}</title>
  <style>
    :root { color-scheme: dark; font-family: system-ui, sans-serif; background: #071318; color: #e5f0f2; line-height: 1.55; }
    * { box-sizing: border-box; } body { margin: 0; } main { max-width: 1240px; margin: auto; padding: 36px 24px 64px; }
    a { color: #81e6d8; text-underline-offset: .2em; } a:hover { color: #c4fff6; }
    :focus-visible { outline: 3px solid #ffd184; outline-offset: 4px; }
    .skip { position: absolute; top: -90px; padding: 12px; background: #071318; } .skip:focus { top: 8px; }
    header { border-top: 3px solid #65cdbb; padding: 22px 0; } .eyebrow { color: #94c7c7; letter-spacing: .14em; font-size: .75rem; font-weight: 700; }
    h1 { font-size: clamp(2rem, 5vw, 3.1rem); line-height: 1.12; margin: 10px 0 18px; } h2 { font-size: 1.25rem; margin: 0 0 16px; } h3 { font-size: 1.05rem; } h4 { margin-bottom: 10px; }
    p { margin: .6em 0; } .question { max-width: 900px; font-size: 1.15rem; } .muted { color: #afc3c9; font-size: .875rem; } code { font-family: ui-monospace, monospace; font-size: .85em; overflow-wrap: anywhere; }
    nav { display: flex; gap: 20px; flex-wrap: wrap; margin: 16px 0; font-size: .9rem; }
    .panel { background: #0c1e26; border: 1px solid #2c4853; border-radius: 9px; padding: 22px; margin: 20px 0; }
    .callout { border-left: 3px solid #d8aa64; background: #28251e; padding: 14px 18px; margin: 16px 0; }
    .budget { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 16px; margin: 18px 0; } .budget div { border-left: 1px solid #3a5a63; padding-left: 16px; }
    dt { color: #afc3c9; font-size: .8rem; } dd { margin: 4px 0 0; font-size: 1.35rem; font-variant-numeric: tabular-nums; }
    .statistics { display: flex; flex-wrap: wrap; gap: 16px 28px; } .statistics dd { font-size: 1rem; }
    .controls { display: flex; gap: 12px; align-items: end; flex-wrap: wrap; margin: 18px 0; } label { display: grid; gap: 5px; font-size: .875rem; } .search { flex: 1 1 260px; }
    input, select, button { font: inherit; color: #e5f0f2; background: #071318; border: 1px solid #52727d; border-radius: 5px; padding: 10px 12px; min-height: 44px; } button { cursor: pointer; } button:hover { background: #153842; }
    .scroll { position: relative; overflow: auto; border: 1px solid #2c4853; border-radius: 5px; } table { width: 100%; border-collapse: collapse; text-align: left; font-size: .9rem; } caption { text-align: left; padding: 12px 16px; color: #afc3c9; background: #071318; }
    th, td { padding: 14px 16px; border-bottom: 1px solid #2c4853; vertical-align: top; } thead th { color: #b6d5d8; font-size: .75rem; text-transform: uppercase; letter-spacing: .04em; background: #102a33; } th[scope="row"] { min-width: 140px; } td { min-width: 140px; } tbody tr:last-child > * { border-bottom: 0; }
    .finding { font-weight: 600; } .error { color: #ffd0b0; overflow-wrap: anywhere; } .adapter { display: block; margin-top: 6px; color: #afc3c9; font-weight: 400; font-size: .8rem; }
    details { min-width: 260px; } summary { cursor: pointer; color: #81e6d8; padding: 2px 0; } details[open] { min-width: 340px; } .assessment { border-top: 1px solid #375560; padding: 2px 0 8px; } .checks { padding-left: 20px; font-size: .85rem; }
    .reviews { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; } .review { border-left: 2px solid #52727d; padding: 0 16px; } .review h3 { margin: 0; } .review p { white-space: pre-wrap; overflow-wrap: anywhere; }
    .issue-list { padding-left: 20px; } .issue-list li { padding: 5px 0; } .events td:last-child { min-width: 280px; } footer { margin-top: 30px; color: #afc3c9; font-size: .8rem; }
    [hidden] { display: none !important; }
    @media (max-width: 760px) { main { padding: 22px 14px 40px; } .panel { padding: 16px; } .budget { grid-template-columns: repeat(2, minmax(0, 1fr)); } .reviews { grid-template-columns: 1fr; } }
    @media print { :root { color-scheme: light; color: #15232c; background: white; } .panel, header, .callout, caption, thead th { background: white; color: #15232c; } .controls, nav, .skip { display: none; } .muted, dt, caption, .adapter { color: #354952; } .scroll { overflow: visible; } main { max-width: none; padding: 0; } .panel { break-inside: avoid; } a, summary { color: #14594f; } }
  </style>
</head>
<body>
<a class="skip" href="#research">Skip to research report</a>
<main id="research">
  <header>
    <p class="eyebrow">R.A.I.N. LAB / RESEARCH OBSERVATORY / OFFLINE EXPORT</p>
    <h1>Experiments that can disagree.</h1>
    <p class="question">${escape(report.question)}</p>
    <p class="muted">Study <code>${escape(report.study_id)}</code> · Status: <strong>${escape(report.status)}</strong> · Scheduling policy: ${escape(report.policy)}</p>
    <nav aria-label="Report sections"><a href="#failures">Failures and negative findings</a><a href="#experiments">Experiments</a><a href="#beliefs">Rival models</a><a href="#reviews">Reviews</a><a href="#provenance">Provenance</a></nav>
    <div class="callout">Computational research only. The registered correct-session criterion is supported only when screening and held-out confirmation both support it. This assesses the numeric criterion; the plan's narrative hypothesis requires its own justification. Execution errors and missing results do not falsify a hypothesis.</div>
  </header>
  <section class="panel" aria-labelledby="budget-heading">
    <h2 id="budget-heading">Computational budget</h2>
    <dl class="budget">
      <div><dt>Ceiling</dt><dd>${number(report.budget.ceiling_units)} units</dd></div>
      <div><dt>Reserved</dt><dd>${number(report.budget.reserved_units)} units</dd></div>
      <div><dt>Completed</dt><dd>${number(report.budget.completed_units)} units</dd></div>
      <div><dt>Runtime</dt><dd>${number(report.budget.runtime_ms)} ms</dd></div>
      <div><dt>Model calls</dt><dd>${number(report.budget.model_calls)}</dd></div>
    </dl>
    <p class="muted">${measured} of ${report.designs.length} designs have measurements. Units are the plan's declared work budget; milliseconds are the reported wall time. Unknown runtime means the recorded timing is incomplete.</p>
  </section>
  <section id="failures" class="panel" aria-labelledby="failures-heading">
    <h2 id="failures-heading">Failures and negative findings</h2>
    ${issues.length === 0 ? "<p>No execution errors, falsifications or invalid assessments reported.</p>" : `<ul class="issue-list">${issues.map((design) => `<li><strong>${escape(design.id)}</strong>: ${finding(design)}${design.error === null ? "" : ` — ${escape(design.error)}`}</li>`).join("")}</ul>`}
    <p class="muted">Inconclusive results remain unresolved. Failed independent checks invalidate an assessment rather than supply evidence for a competing explanation.</p>
  </section>
  <section id="experiments" class="panel" aria-labelledby="experiments-heading">
    <h2 id="experiments-heading">Hypotheses and experiments</h2>
    <p>Expected information is calculated under the plan's declared rival models, in conditional bits per one seed-level binary observation. It forecasts one observation rather than an entire run. Intervals and verdicts below are the host's fixed-n assessments of the numeric correct-session probability criterion.</p>
    <p class="muted">A passing diagnostic records that check alone. It does not establish nominal calibration, discovery power or the validity of a broader scientific claim.</p>
    <div class="controls">
      <label class="search" for="design-search">Search hypotheses, methods and findings<input id="design-search" type="search" autocomplete="off"></label>
      <label for="design-filter">Show<select id="design-filter"><option value="all">All designs</option><option value="issues">Failures and negative findings</option><option value="measured">Measured designs</option><option value="unmeasured">Unmeasured designs</option></select></label>
      <button id="open-details" type="button">Expand visible details</button><button id="close-details" type="button">Collapse details</button>
    </div>
    <p id="filter-count" class="muted" role="status" aria-live="polite">${report.designs.length} of ${report.designs.length} designs shown</p>
    <noscript><p>Filtering requires JavaScript. Every design and its details remain available below.</p></noscript>
    <div class="scroll" role="region" aria-label="Hypotheses and experiment results" tabindex="0">
      <table id="design-table"><caption>Registered designs; expand each row for its falsification protocol and both sample panels.</caption><thead><tr><th scope="col">Design / adapter</th><th scope="col">Host finding</th><th scope="col">Declared cost / gain</th><th scope="col">Protocol and uncertainty</th></tr></thead><tbody>${report.designs.map(designRow).join("")}</tbody></table>
    </div>
    <p id="filter-empty" hidden>No designs match these filters.</p>
    ${report.designs.length === 0 ? "<p>No designs reported.</p>" : ""}
  </section>
  <section id="beliefs" class="panel" aria-labelledby="beliefs-heading">
    <h2 id="beliefs-heading">Rival models: conditional beliefs</h2>
    <p>These probabilities are conditional on the declared models and likelihood assumptions. Posterior belief is not independent evidence, scientific confidence or a validation of those assumptions.</p>
    <div class="scroll" role="region" aria-label="Conditional rival model beliefs" tabindex="0"><table><caption>Reported prior and posterior model probabilities; an absent posterior stays unknown.</caption><thead><tr><th scope="col">Rival model</th><th scope="col">Prior probability</th><th scope="col">Conditional posterior probability</th></tr></thead><tbody>${report.rivals.map((rival) => `<tr data-rival-row><th scope="row">${escape(rival.id)}</th><td>${number(rival.prior)}</td><td>${rival.posterior === null ? "unknown" : number(rival.posterior)}</td></tr>`).join("")}</tbody></table></div>
    ${report.rivals.length === 0 ? "<p>No rival model probabilities reported.</p>" : ""}
  </section>
  <section id="reviews" class="panel" aria-labelledby="reviews-heading">
    <h2 id="reviews-heading">Attributable research reviews</h2>
    <p class="muted">Scripted reviews are host structural checks. Model reviews are interpretations. Neither replaces measurements or independent replication.</p>
    <div class="reviews">${report.reviews.map((review) => `<article class="review" data-review><h3>${escape(review.agent)}</h3><p class="muted">${escape(review.role)} · ${escape(review.generation)}</p><p>${escape(review.text)}</p></article>`).join("") || "<p>No reviews reported.</p>"}</div>
  </section>
  <section class="panel" aria-labelledby="limitations-heading"><h2 id="limitations-heading">Limits and unresolved questions</h2><ul>${report.limitations.map((limitation) => `<li>${escape(limitation)}</li>`).join("") || "<li>No limitations supplied in this report; absence of a list does not establish validity.</li>"}</ul></section>
  <section id="provenance" class="panel" aria-labelledby="provenance-heading">
    <h2 id="provenance-heading">Reproducibility and provenance</h2>
    <p>Report schema: <code>${escape(report.schema)}</code></p><p>Plan SHA-256: <code>${escape(report.plan_sha256)}</code></p>
    <p><a href="evidence.json" download>Download the campaign evidence (JSON)</a></p>
    <p class="muted">This view does not verify hashes or replay runs. Inspect the adjacent evidence export and campaign records to verify code revisions, configurations, seeds and results. A digest identifies content; it is not a signature.</p>
    <details><summary>Inspect ${report.events.length} recorded events</summary><div class="scroll" role="region" aria-label="Recorded event digests" tabindex="0"><table class="events"><caption>Events in the order supplied by the host report.</caption><thead><tr><th scope="col">Sequence</th><th scope="col">Kind</th><th scope="col">SHA-256</th></tr></thead><tbody>${report.events.map((event) => `<tr data-event-row><th scope="row">${number(event.sequence)}</th><td>${escape(event.kind)}</td><td><code>${escape(event.sha256)}</code></td></tr>`).join("")}</tbody></table></div></details>
  </section>
  <footer>Read-only report. Controls filter this export locally and make no network requests. This page loads no external dependencies.</footer>
</main>
<script src="observatory.js" defer></script>
</body>
</html>`;
}
