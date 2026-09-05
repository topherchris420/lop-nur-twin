import { describe, expect, it } from "vitest";
import {
  spatialResultsToCsv,
  spatialResultsToGeoJson,
  spatialResultsToJson,
} from "./spatialExport";
import {
  runSpatialQuery,
  type SpatialQueryResponse,
  type SuccessfulSpatialQuery,
} from "./spatialQuery";
import type { LocalRing } from "./spatialQuery";

function successful(response: SpatialQueryResponse): SuccessfulSpatialQuery {
  if (!response.ok) throw new Error(response.errors.join("; "));
  return response;
}

const MODEL_IDENTITY = {
  modelVersion: "test-version",
  geometryHash: "sha256:geometry",
  evidenceLedgerHash: "sha256:evidence",
} as const;

describe("spatial exports", () => {
  it("is byte-identical across repeated JSON, CSV, and GeoJSON exports", () => {
    const response = successful(
      runSpatialQuery({
        kinds: ["structure", "aircraft"],
        anchorSubjectId: "rwy-05-23",
        maximumDistanceM: 500,
      }),
    );

    expect(spatialResultsToJson(response, MODEL_IDENTITY)).toBe(
      spatialResultsToJson(response, MODEL_IDENTITY),
    );
    expect(spatialResultsToCsv(response)).toBe(spatialResultsToCsv(response));
    expect(spatialResultsToGeoJson(response, MODEL_IDENTITY)).toBe(
      spatialResultsToGeoJson(response, MODEL_IDENTITY),
    );
  });

  it("emits canonical JSON with query, identity, CRS, derivation, and limitations", () => {
    const response = successful(runSpatialQuery({ kinds: ["aircraft"] }));
    const parsed = JSON.parse(spatialResultsToJson(response, MODEL_IDENTITY)) as Record<
      string,
      unknown
    >;

    expect(parsed["schemaVersion"]).toBe("lop-nur-spatial-query/1.0.0");
    expect(parsed["query"]).toEqual({ kinds: ["aircraft"] });
    expect(parsed["identity"]).toEqual(MODEL_IDENTITY);
    expect(parsed["coordinateReferenceSystem"]).toBe("EPSG:32645");
    expect(parsed["derivation"]).toMatch(/modeled footprint distance/i);
    expect(parsed["knownLimitations"]).toBeInstanceOf(Array);
    expect(parsed["results"]).toBeInstanceOf(Array);
  });

  it("emits RFC 4180 CSV and spells unknown values as not stated", () => {
    const response = successful(runSpatialQuery({ evidenceClasses: ["illustrative"] }));
    const csv = spatialResultsToCsv(response);
    const [header] = csv.split("\r\n");

    expect(header).toBe(
      "subject_id,label,kind,evidence_class,confidence,source_ids,presence,modeled_distance_m,horizontal_uncertainty_m,footprint_uncertainty_m,anchor_subject_id,anchor_horizontal_uncertainty_m,anchor_footprint_uncertainty_m,distance_uncertainty",
    );
    expect(csv).toContain("not stated");
    expect(csv).toContain('"');
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv).not.toContain(",0,not stated");
  });

  it("emits closed finite WGS84 GeoJSON polygon rings with analytical metadata", () => {
    const response = successful(
      runSpatialQuery({
        kinds: ["aircraft"],
        anchorSubjectId: "rwy-05-23",
        maximumDistanceM: 500,
      }),
    );
    const collection = JSON.parse(spatialResultsToGeoJson(response, MODEL_IDENTITY)) as {
      type: string;
      features: Array<{
        id: string;
        geometry: { type: string; coordinates: number[][][] };
        properties: Record<string, unknown>;
      }>;
      lopNurTwin: Record<string, unknown>;
    };

    expect(collection.type).toBe("FeatureCollection");
    expect(collection.features).toHaveLength(response.results.length);
    expect(collection.lopNurTwin["sourceCoordinateReferenceSystem"]).toBe("EPSG:32645");
    expect(collection.lopNurTwin["identity"]).toEqual(MODEL_IDENTITY);

    for (const feature of collection.features) {
      expect(feature.geometry.type).toBe("Polygon");
      const ring = feature.geometry.coordinates[0]!;
      expect(ring[0]).toEqual(ring.at(-1));
      expect(ring.flat().every(Number.isFinite)).toBe(true);
      for (const [longitude, latitude] of ring) {
        expect(longitude).toBeGreaterThan(89);
        expect(longitude).toBeLessThan(90);
        expect(latitude).toBeGreaterThan(40);
        expect(latitude).toBeLessThan(42);
      }
      expect(feature.properties["distanceUncertainty"]).toBe("unknown");
      expect(feature.properties["anchorSubjectId"]).toBe("rwy-05-23");
      expect(feature.properties["anchorUncertainty"]).toBeDefined();
      expect(feature.id.startsWith("live-aircraft-")).toBe(false);
    }
  });

  it("rejects an unclosed source ring instead of repairing it", () => {
    const response = successful(runSpatialQuery({ kinds: ["aircraft"] }));
    const first = response.results[0]!;
    const unclosed: LocalRing = [
      ...first.subject.footprint.slice(0, -1),
      [first.subject.footprint[0]![0] + 1, first.subject.footprint[0]![1]],
    ];
    const fabricated: SuccessfulSpatialQuery = {
      ...response,
      results: [
        {
          ...first,
          subject: { ...first.subject, footprint: unclosed },
        },
        ...response.results.slice(1),
      ],
    };

    expect(() => spatialResultsToGeoJson(fabricated)).toThrow(/closed/i);
  });

  it("rejects fabricated unsorted results before serializing any format", () => {
    const response = successful(runSpatialQuery({ kinds: ["aircraft"] }));
    const fabricated: SuccessfulSpatialQuery = {
      ...response,
      results: [...response.results].reverse(),
    };

    expect(() => spatialResultsToJson(fabricated)).toThrow(/authoritative query/i);
    expect(() => spatialResultsToCsv(fabricated)).toThrow(/authoritative query/i);
    expect(() => spatialResultsToGeoJson(fabricated)).toThrow(/authoritative query/i);
  });

  it("exports a valid empty result instead of treating it as an error", () => {
    const response = successful(
      runSpatialQuery({
        maximumStatedHorizontalUncertaintyM: 0,
      }),
    );

    expect(response.results).toEqual([]);
    expect(JSON.parse(spatialResultsToJson(response))["results"]).toEqual([]);
    expect(JSON.parse(spatialResultsToGeoJson(response))["features"]).toEqual([]);
    expect(spatialResultsToCsv(response).split("\r\n")).toHaveLength(2);
  });
});
