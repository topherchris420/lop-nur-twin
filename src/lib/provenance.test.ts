import { describe, expect, it } from "vitest";
import {
  PROVENANCE_STEP_IDS,
  chainToText,
  fieldValue,
  provenanceChain,
} from "./provenance";
import { EVIDENCE_LEDGER, MODEL_INTERNAL_SOURCE_ID } from "./evidence";

/**
 * The chain's contract is that it is *total*: every record produces the same
 * six links in the same order, and a link this project holds nothing for is
 * marked hollow rather than dropped. That is what lets two chains be compared
 * side by side, and it is why the gaps are the interesting part — a chain that
 * quietly closed over its missing links would read as though it had none.
 */

const RECORDS = EVIDENCE_LEDGER;

describe("chain shape", () => {
  it("produces the same six links, in order, for every record", () => {
    for (const record of RECORDS) {
      const chain = provenanceChain(record);
      expect(
        chain.steps.map((step) => step.id),
        record.id,
      ).toEqual([...PROVENANCE_STEP_IDS]);
    }
  });

  it("never drops a link, only marks it hollow", () => {
    for (const record of RECORDS) {
      const chain = provenanceChain(record);
      expect(chain.steps).toHaveLength(6);
      for (const id of chain.hollowSteps) {
        expect(chain.steps.find((step) => step.id === id)?.hollow).toBe(true);
      }
    }
  });

  it("carries the record and subject it was built from", () => {
    for (const record of RECORDS) {
      const chain = provenanceChain(record);
      expect(chain.recordId).toBe(record.id);
      expect(chain.subjectId).toBe(record.subjectId);
    }
  });
});

describe("the source link", () => {
  it("is hollow exactly when the model is its own source", () => {
    for (const record of RECORDS) {
      const chain = provenanceChain(record);
      const source = chain.steps.find((step) => step.id === "source");
      expect(source?.hollow, record.id).toBe(
        record.sourceId === MODEL_INTERNAL_SOURCE_ID,
      );
    }
  });

  it("never invents a content hash", () => {
    // The build fetches nothing, so there is no retrieved artifact to hash.
    for (const record of RECORDS) {
      const source = provenanceChain(record).steps.find((step) => step.id === "source");
      const hash = source?.fields.find((field) => field.label === "Content hash");
      expect(fieldValue(hash!), record.id).toBe("not recorded");
    }
  });
});

describe("the date link", () => {
  it("keeps the three dates in three separate fields", () => {
    for (const record of RECORDS) {
      const labels = provenanceChain(record)
        .steps.find((step) => step.id === "date")!
        .fields.map((field) => field.label);
      expect(labels).toContain("Site event");
      expect(labels).toContain("Evidence published");
      expect(labels).toContain("Entered this model");
    }
  });

  it("records no model-entry date, because this repository has never kept one", () => {
    for (const record of RECORDS) {
      const entered = provenanceChain(record)
        .steps.find((step) => step.id === "date")!
        .fields.find((field) => field.label === "Entered this model");
      expect(fieldValue(entered!), record.id).toBe("not recorded");
    }
  });

  it("never prints a site date bare, where it could be read as a build date", () => {
    for (const record of RECORDS) {
      const site = provenanceChain(record)
        .steps.find((step) => step.id === "date")!
        .fields.find((field) => field.label === "Site event");
      const value = fieldValue(site!);
      if (value === "not recorded") continue;
      expect(value, record.id).toMatch(/existed by|no earlier than|between/);
    }
  });
});

describe("the uncertainty link", () => {
  it("states no height or orientation tolerance anywhere", () => {
    for (const record of RECORDS) {
      const fields = provenanceChain(record).steps.find(
        (step) => step.id === "uncertainty",
      )!.fields;
      for (const label of ["Height", "Orientation"]) {
        const field = fields.find((candidate) => candidate.label === label);
        if (field === undefined) continue;
        expect(fieldValue(field), `${record.id}/${label}`).toBe("not recorded");
      }
    }
  });
});

describe("the model-decision link", () => {
  it("names what this project supplied that no source carries", () => {
    for (const record of RECORDS) {
      const step = provenanceChain(record).steps.find(
        (candidate) => candidate.id === "model-decision",
      )!;
      expect(step.summary.length).toBeGreaterThan(20);
    }
  });
});

describe("chainToText", () => {
  it("is deterministic and carries every link", () => {
    const record = RECORDS[0]!;
    const text = chainToText(provenanceChain(record));
    expect(text).toBe(chainToText(provenanceChain(record)));
    for (const id of PROVENANCE_STEP_IDS) {
      expect(text.toLowerCase()).toContain(id.replace("-", " ").split(" ")[0]!);
    }
  });
});

describe("fieldValue", () => {
  it("prints absence as absence, never as zero or a dash", () => {
    expect(fieldValue({ label: "x" })).toBe("not recorded");
    expect(fieldValue({ label: "x", value: "" })).toBe("not recorded");
    expect(fieldValue({ label: "x", value: "0" })).toBe("0");
  });
});
