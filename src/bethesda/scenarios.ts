import { EVENT_KINDS, type EventKind } from "./contract";
import { inBounds, landmarks, metro, row, type Point } from "./model";
export interface Scenario {
  kind: EventKind;
  point: Point;
  radius: number;
  durationTicks: number;
  label: string;
}
export interface CityEvent extends Scenario {
  id: number;
  startTick: number;
}
export function validScenario(v: unknown): v is Scenario {
  if (!v || typeof v !== "object") return false;
  const s = v as Scenario;
  return (
    EVENT_KINDS.includes(s.kind) &&
    !!s.point &&
    inBounds(s.point) &&
    Number.isFinite(s.radius) &&
    s.radius >= 10 &&
    s.radius <= 180 &&
    Number.isInteger(s.durationTicks) &&
    s.durationTicks >= 10 &&
    s.durationTicks <= 3600 &&
    typeof s.label === "string" &&
    s.label.length <= 100
  );
}
export function parseScenario(text: string): Scenario | null {
  if (text.length > 240) return null;
  const t = text.toLowerCase().trim();
  let kind: EventKind | null = null;
  if (/\bfire\b/.test(t) && /bethesda row/.test(t)) kind = "fire";
  else if (/thunderstorm|\bstorm\b/.test(t) && /bethesda|downtown/.test(t))
    kind = "storm";
  else if (/metro|station/.test(t) && /clos/.test(t)) kind = "metro-closure";
  else if (/parade/.test(t) && /wisconsin/.test(t)) kind = "parade";
  else if (/unidentified|\bufo\b|strange.*object/.test(t) && /bethesda/.test(t))
    kind = "object";
  if (!kind) return null;
  const location =
    kind === "metro-closure"
      ? metro.point
      : kind === "parade"
        ? landmarks.find((p) => p.name === "Wisconsin Avenue")!.point
        : row.point;
  return {
    kind,
    point: { ...location },
    radius: kind === "storm" ? 180 : kind === "fire" ? 32 : kind === "parade" ? 65 : 90,
    durationTicks: kind === "fire" ? 2400 : kind === "storm" ? 1800 : 1200,
    label:
      kind === "fire"
        ? "Fire near Bethesda Row"
        : kind === "storm"
          ? "Thunderstorm"
          : kind === "metro-closure"
            ? "Bethesda Metro closure"
            : kind === "parade"
              ? "Wisconsin Avenue parade closure"
              : "Unidentified object",
  };
}
