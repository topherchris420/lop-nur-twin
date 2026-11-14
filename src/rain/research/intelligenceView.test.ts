import { describe, expect, it } from "vitest";
import {
  renderIntelligenceObservatory,
  INTELLIGENCE_OBSERVATORY_SCRIPT,
  type Assessment,
  type IntelligenceViewReport,
} from "./intelligenceView.js";

const supported: Assessment = {
  mean: 0.7,
  lower: 0.51,
  upper: 0.89,
  alpha: 0.05,
  n: 100,
  verdict: "supported",
  checks: { "baseline agreement": true, "finite measurements": true },
  method: "Fixed-n test fixture",
};

function report(): IntelligenceViewReport {
  return {
    schema: "rain-intelligence-report/v1",
    study_id: "test-study",
    plan_sha256: "a".repeat(64),
    question: "Does the candidate beat its independent baseline?",
    policy: "information",
    status: "complete",
    budget: {
      ceiling_units: 600,
      reserved_units: 400,
      completed_units: 400,
      runtime_ms: 28,
      model_calls: 0,
    },
    rivals: [
      { id: "null", prior: 0.5, posterior: 0.2 },
      { id: "effect", prior: 0.5, posterior: null },
    ],
    designs: [
      {
        id: "D1",
        hypothesis: "The paired mean exceeds zero.",
        falsification: "The fixed-n upper bound is below zero.",
        adapter: "cpu-test",
        cost_units: 200,
        minimum_rate: 0.5,
        expected_bits: 0.3,
        screen: supported,
        confirmation: { ...supported, mean: -0.7, verdict: "falsified" },
        registry_run: "V3D-EXP-0001-RUN-0001",
        state: "complete",
        error: null,
      },
      {
        id: "D2",
        hypothesis: "An execution failure has no empirical verdict.",
        falsification: "Requires measurements.",
        adapter: "cpu-test",
        cost_units: 200,
        minimum_rate: 0.5,
        expected_bits: 0.1,
        screen: null,
        confirmation: null,
        registry_run: null,
        state: "failed",
        error: "Independent baseline unavailable",
      },
    ],
    reviews: [
      {
        agent: "James",
        role: "Design review",
        generation: "scripted",
        text: "Structural test fixture.",
      },
    ],
    events: [
      { sequence: 1, kind: "plan-registered", sha256: "b".repeat(64) },
      { sequence: 2, kind: "measurement-recorded", sha256: "c".repeat(64) },
    ],
    limitations: ["Fixture observations establish no scientific result."],
  };
}

describe("offline intelligence observatory", () => {
  it("renders actual report rows, assessments and attribution without inventing results", () => {
    const source = report();
    const before = JSON.stringify(source);
    const html = renderIntelligenceObservatory(source);
    expect(html.match(/<tr data-design-row/g)).toHaveLength(source.designs.length);
    expect(html.match(/<tr data-rival-row/g)).toHaveLength(source.rivals.length);
    expect(html.match(/<tr data-event-row/g)).toHaveLength(source.events.length);
    expect(html.match(/<article class="review" data-review/g)).toHaveLength(
      source.reviews.length,
    );
    expect(html).toContain("[0.51, 0.89]");
    expect(html).toContain("Samples (n)</dt><dd>100");
    expect(html).toContain("Falsified in confirmation");
    expect(html).toContain("Execution error; no completed claim");
    expect(html).toContain("Screening: not measured.");
    expect(html).toContain("Held-out confirmation: not measured.");
    expect(html).toContain("Design review · scripted");
    expect(html).toContain("<td>unknown</td>");
    expect(html).toContain("Plan SHA-256: <code>" + source.plan_sha256);
    expect(html).toContain("correct-session probability at least 0.5");
    expect(html).toContain("conditional bits per one seed-level binary observation");
    expect(html).toContain('href="evidence.json" download');
    expect(JSON.stringify(source)).toBe(before);
    expect(renderIntelligenceObservatory(source)).toBe(html);
  });

  it("escapes hostile text in every report surface without interpolating it into scripts", () => {
    const source = report();
    const payload = `</script><img src=x onerror="alert('x')"><script>globalThis.pwned=1</script>&`;
    source.study_id = payload;
    source.plan_sha256 = payload;
    source.question = payload;
    source.status = payload;
    source.rivals[0]!.id = payload;
    Object.assign(source.designs[0]!, {
      id: payload,
      hypothesis: payload,
      falsification: payload,
      adapter: payload,
      registry_run: payload,
      state: payload,
      error: payload,
      screen: {
        ...supported,
        verdict: payload,
        method: payload,
        checks: { [payload]: false },
      },
    });
    Object.assign(source.reviews[0]!, { agent: payload, role: payload, text: payload });
    Object.assign(source.events[0]!, { kind: payload, sha256: payload });
    source.limitations = [payload];
    const html = renderIntelligenceObservatory(source);
    expect(html).not.toContain(payload);
    expect(html).not.toContain("<img");
    expect(html.match(/<script /g)).toHaveLength(1);
    expect(html.match(/<\/script>/g)).toHaveLength(1);
    expect(html).toContain(
      "&lt;/script&gt;&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;",
    );
    expect(html).toContain('<script src="observatory.js" defer></script>');
    expect(html).not.toMatch(/<script>/);
    expect(INTELLIGENCE_OBSERVATORY_SCRIPT).not.toContain("pwned");
    expect(INTELLIGENCE_OBSERVATORY_SCRIPT).not.toContain("payload");
    expect(INTELLIGENCE_OBSERVATORY_SCRIPT).not.toMatch(
      /innerHTML|outerHTML|insertAdjacentHTML|\bfetch\(|localStorage/,
    );
  });

  it("requires both panels for support and separates failed checks from falsification", () => {
    const source = report();
    const design = source.designs[0]!;
    design.confirmation = null;
    expect(renderIntelligenceObservatory(source)).toContain(
      "Screened; no confirmed claim",
    );
    expect(renderIntelligenceObservatory(source)).not.toContain(
      "Correct-session criterion supported in screening and confirmation",
    );
    design.confirmation = supported;
    expect(renderIntelligenceObservatory(source)).toContain(
      "Correct-session criterion supported in screening and confirmation",
    );
    design.confirmation = {
      ...supported,
      verdict: "invalid",
      checks: { "baseline agreement": false },
    };
    const invalid = renderIntelligenceObservatory(source);
    expect(invalid).toContain("Invalid: independent checks failed");
    expect(invalid).toContain("FAIL: baseline agreement");
    expect(invalid).not.toContain(
      "Correct-session criterion supported in screening and confirmation",
    );
  });

  it("keeps an empty or nonfinite report explicit and provides semantic keyboard controls", () => {
    const source = report();
    source.designs = [];
    source.reviews = [];
    source.rivals = [];
    source.events = [];
    source.budget.runtime_ms = Number.NaN;
    const html = renderIntelligenceObservatory(source);
    expect(html).toContain("No designs reported.");
    expect(html).toContain("No reviews reported.");
    expect(html).toContain("No rival model probabilities reported.");
    expect(html).toContain("unknown ms");
    expect(html).toContain('for="design-search"');
    expect(html).toContain('for="design-filter"');
    expect(html).toContain('role="status" aria-live="polite"');
    expect(html).toContain('aria-label="Hypotheses and experiment results" tabindex="0"');
    expect(html).toContain('scope="col"');
    expect(html).toContain("script-src 'self'");
    expect(html.match(/<script[^>]+src="observatory.js"/g)).toHaveLength(1);
    expect(html).not.toMatch(/<link[^>]+href=|<iframe|<img/);
    source.budget.runtime_ms = null;
    expect(renderIntelligenceObservatory(source)).toContain("unknown ms");
  });
});
