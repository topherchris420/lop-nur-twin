import { describe, expect, it } from "vitest";
import { spatialQueryFromSearch } from "./SpatialQueryPanel";
import { runSpatialQuery } from "@/lib/spatialQuery";

describe("spatialQueryFromSearch", () => {
  it("preserves explicit empty enum selections as empty query sets", () => {
    const query = spatialQueryFromSearch({
      kinds: "",
      classes: "",
      spatialDate: "2025-09-13",
      presence: "",
    });

    expect(query.kinds).toEqual([]);
    expect(query.evidenceClasses).toEqual([]);
    expect(query.presence).toEqual([]);
    const response = runSpatialQuery(query);
    expect(response.ok).toBe(true);
    if (response.ok) expect(response.results).toEqual([]);
  });
});
