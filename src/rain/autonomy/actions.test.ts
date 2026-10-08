import { describe, expect, it } from "vitest";
import {
  ANALYSIS_SCHEMA,
  RESEARCH_KEYS,
  parseAnalysis,
  parseResearchAction,
  readingFor,
  researchActionSchema,
} from "./actions";
import { analyst, inspectDesign, proposal, stop } from "./fixtures";

const allowed = {
  designs: new Set(["X1-increase-primary", "X1-decrease-replication"]),
  experiments: new Set(["BX-8633bd9dc0c5"]),
  toolsLeft: 1,
};
const errors = (raw: Record<string, unknown>, a = allowed) => {
  const r = parseResearchAction(raw, a);
  return r.ok ? [] : r.errors;
};

describe("the researcher's actions are a closed vocabulary", () => {
  it("accepts a proposal of a listed design in the model's own words", () => {
    const r = parseResearchAction(
      proposal("X1-increase-primary", ["X1-decrease-replication"]),
      allowed,
    );
    expect(r.ok).toBe(true);
  });
  it("refuses a design, a ranking or a result the Lab does not list", () => {
    expect(errors(proposal("X12-increase-primary")).join()).toMatch(
      /not one the charter lists/,
    );
    expect(
      errors(proposal("X1-increase-primary", ["X9-increase-primary"])).join(),
    ).toMatch(/not a listed design/);
    expect(
      errors({
        ...stop(""),
        action: "inspect_result",
        experiment: "BX-000000000000",
      }).join(),
    ).toMatch(/not a recorded result/);
  });
  it("refuses an action that is not in the vocabulary — there is no write, fetch or command", () => {
    for (const action of [
      "run_shell",
      "write_file",
      "fetch_url",
      "edit_record",
      "run_experiment",
    ])
      expect(errors({ ...proposal("X1-increase-primary"), action }).join()).toMatch(
        /action must be one of/,
      );
  });
  it("refuses unknown and missing fields, and every unsafe character", () => {
    expect(
      errors({ ...proposal("X1-increase-primary"), command: "rm -rf /" }).join(),
    ).toMatch(/unknown field: command/);
    const { rationale: _r, ...missing } = proposal("X1-increase-primary");
    expect(errors(missing).join()).toMatch(/missing field: rationale/);
    expect(
      errors({
        ...proposal("X1-increase-primary"),
        hypothesis: "fine\u001b[2Jcleared",
      }).join(),
    ).toMatch(/control or invisible/);
    expect(
      errors({ ...proposal("X1-increase-primary"), question: "a\u202eb" }).join(),
    ).toMatch(/control or invisible/);
    expect(
      errors({ ...proposal("X1-increase-primary"), rationale: "x".repeat(1001) }).join(),
    ).toMatch(/exceeds 1000/);
  });
  it("requires the model's words for a proposal and a reason to stop", () => {
    expect(
      errors({ ...proposal("X1-increase-primary"), hypothesis: " " }).join(),
    ).toMatch(/hypothesis is required/);
    expect(errors(stop("")).join()).toMatch(/stop_reason is required/);
    expect(errors(stop("nothing new"))).toEqual([]);
  });
  it("refuses an answer that both proposes and stops", () => {
    expect(
      errors({ ...stop("nothing new"), ranking: ["X1-increase-primary"] }).join(),
    ).toMatch(/a stop names no design and no ranking/);
    expect(
      errors({ ...stop("nothing new"), design: "X1-increase-primary" }).join(),
    ).toMatch(/a stop names no design/);
    expect(
      errors({ ...proposal("X1-increase-primary"), stop_reason: "nothing new" }).join(),
    ).toMatch(/a proposal gives no stop_reason/);
  });
  it("allows read-only tools only while calls are left", () => {
    expect(errors(inspectDesign("X1-increase-primary"))).toEqual([]);
    expect(
      errors(inspectDesign("X1-increase-primary"), { ...allowed, toolsLeft: 0 }).join(),
    ).toMatch(/no read-only tool calls are left/);
  });
  it("enumerates the ids in the schema the server constrains the answer to", () => {
    const schema = researchActionSchema(["X1-increase-primary"], ["BX-8633bd9dc0c5"]) as {
      required: string[];
      additionalProperties: boolean;
      properties: Record<string, { enum?: string[] }>;
    };
    expect(schema.required).toEqual([...RESEARCH_KEYS]);
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.design!.enum).toEqual(["", "X1-increase-primary"]);
    expect(schema.properties.experiment!.enum).toEqual(["", "BX-8633bd9dc0c5"]);
    expect(
      (ANALYSIS_SCHEMA as { additionalProperties: boolean }).additionalProperties,
    ).toBe(false);
  });
});

describe("the analyst's reading", () => {
  it("is one of three words, with bounded notes", () => {
    const ok = parseAnalysis(
      analyst()(
        "VERDICT (the registry's pre-registered criteria): not supported",
        1,
      ) as Record<string, unknown>,
    );
    expect(ok.ok && ok.value.reading).toBe("contradicts");
    expect(
      parseAnalysis({ ...(analyst("supports")("", 1) as object), reading: "proven" }).ok,
    ).toBe(false);
    expect(
      parseAnalysis({
        ...(analyst("supports")("", 1) as object),
        caveats: ["a", "b", "c", "d"],
      }).ok,
    ).toBe(false);
  });
  it("is checked against what the criteria imply", () => {
    expect(readingFor("supported")).toBe("supports");
    expect(readingFor("not_supported")).toBe("contradicts");
    expect(readingFor("insufficient_evidence")).toBe("inconclusive");
    expect(readingFor("not_evaluated")).toBe("inconclusive");
  });
});
