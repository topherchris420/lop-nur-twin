/**
 * Reproducible local bookmarks.
 *
 * A bookmark is a saved *analytical position*: where the camera was, which date
 * the model was being read at, which evidence mode was active, what was
 * selected and measured — plus the two hashes identifying the model that
 * produced it. That last part is what separates this from a browser bookmark.
 * Reopening a saved view against a build whose geometry has moved gives you a
 * different picture with the same name, and silently. So every bookmark records
 * `geometryHash` and `evidenceLedgerHash`, and `checkReproducibility` says
 * plainly whether the model in front of you is the model the note was written
 * against.
 *
 * Three boundaries, all deliberate:
 *
 * - **Local only.** `localStorage`, this browser, this origin. No account, no
 *   sync, no backend. Export and import are files the user handles themselves,
 *   which is also the only way a bookmark moves between machines.
 * - **A shareable URL carries settings, never content.** Camera, date, mode,
 *   selection — things that are already visible in the interface and already
 *   expressible as query parameters. Never the analyst note, never the tags,
 *   never the measurement path. A note is the one part of a bookmark that is
 *   genuinely the user's own writing, and putting it in a link is how private
 *   text ends up in someone's referrer log.
 * - **Every field is validated on the way in.** An imported file is untrusted
 *   input in exactly the way a URL parameter is, and it is read through the
 *   same discipline: reject before clamp, bound everything, never throw.
 */

import {
  DEFAULT_EVIDENCE_MODE,
  parseEvidenceMode,
  type EvidenceMode,
} from "./evidenceMode";
import { manifestHashesComparable } from "./manifestSchema";
import { isIsoDate, snapshotDateForYear } from "./temporal";
import type { MeasurePoint } from "./measure";
import type { CameraMode, QualityTier } from "./store";

/* ------------------------------------------------------------------ */
/* Schema                                                              */
/* ------------------------------------------------------------------ */

/**
 * Version 3 dropped `timelineYear`: the scene's time is the evidence-timeline
 * date (`snapshotDate`), and a year slider no longer exists to restore. A
 * version-2 view's year is mapped to the timeline date it corresponds to.
 */
export const BOOKMARK_SCHEMA_VERSION = 3;

/** Where the bookmarks live. The version is in the key as well as the payload. */
export const BOOKMARK_STORAGE_KEY = "lop-nur-twin.bookmarks.v3";

/**
 * Keys earlier versions wrote. Read once when the current key is empty and
 * migrated forward, so upgrading the site never loses a saved view; the old
 * key is left untouched for an older build that might still read it.
 */
export const LEGACY_BOOKMARK_STORAGE_KEYS = ["lop-nur-twin.bookmarks.v2"] as const;

/** Longest analyst note kept. Long enough for a paragraph, short enough to bound the store. */
export const MAX_NOTE_LENGTH = 600;
export const MAX_NAME_LENGTH = 80;
export const MAX_TAGS = 8;
export const MAX_TAG_LENGTH = 24;
export const MAX_BOOKMARKS = 200;
/** Largest import accepted, in characters. Roughly 200 full bookmarks. */
export const MAX_IMPORT_LENGTH = 500_000;

export interface BookmarkView {
  cameraMode: CameraMode;
  /** Camera position in local metres, when the view was captured from the 3D route. */
  cameraPosition?: [number, number, number];
  cameraTarget?: [number, number, number];
  /** The evidence-timeline date, or null for now. */
  snapshotDate: string | null;
  comparisonDate: string | null;
  evidenceMode: EvidenceMode;
  selectedId: string | null;
  measurePoints: readonly MeasurePoint[];
  showUncertainty: boolean;
  /** Whether the evidence lens was painting the view. Absent in older files: off. */
  showLens: boolean;
  environmentMonth: number;
  night: boolean;
  qualityTier: QualityTier | null;
}

/**
 * The model a bookmark was taken against.
 *
 * Absent hashes are normal — a bookmark saved on a dev server that never ran
 * `bun run manifest` has none — and produce an "unknown" reproducibility
 * verdict rather than a false "matches".
 */
export interface BookmarkProvenance {
  geometryHash?: string;
  evidenceLedgerHash?: string;
  modelVersion?: string;
  /**
   * The manifest schema the hashes were written under. Hashes are compared only
   * within one schema: 1.2.0 narrowed `geometryHash` to placement, so the same
   * model hashes differently before and after it.
   */
  manifestSchemaVersion?: string;
}

export interface Bookmark {
  schemaVersion: typeof BOOKMARK_SCHEMA_VERSION;
  id: string;
  name: string;
  /** ISO timestamp, local to this browser. */
  createdAt: string;
  updatedAt: string;
  /** Short analyst note. Local only — never leaves this browser in a URL. */
  note?: string;
  tags: readonly string[];
  view: BookmarkView;
  provenance: BookmarkProvenance;
}

/* ------------------------------------------------------------------ */
/* Validation and migration                                            */
/* ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return value < min ? min : value > max ? max : value;
}

function safeString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.slice(0, maxLength);
}

function readVector(value: unknown): [number, number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 3) return undefined;
  const parts = value.map((component) =>
    typeof component === "number" && Number.isFinite(component) ? component : null,
  );
  if (parts.some((component) => component === null)) return undefined;
  // Bounded well outside the 6.8 km site so a saved cinematic altitude survives,
  // and far inside the range where a float stops being a usable coordinate.
  const limit = 100_000;
  const [x, y, z] = parts as number[];
  return [
    clampNumber(x, -limit, limit, 0),
    clampNumber(y, -limit, limit, 0),
    clampNumber(z, -limit, limit, 0),
  ];
}

const CAMERA_MODES: readonly CameraMode[] = ["orbit", "fps", "cinematic"];
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

function readMeasurePoints(value: unknown): readonly MeasurePoint[] {
  if (!Array.isArray(value)) return [];
  const points: MeasurePoint[] = [];
  // The store itself caps a live measurement at 64 vertices; an imported file
  // gets the same ceiling rather than the file's word for it.
  for (const entry of value.slice(0, 64)) {
    if (!isRecord(entry)) continue;
    const x = entry["x"];
    const z = entry["z"];
    if (typeof x !== "number" || !Number.isFinite(x)) continue;
    if (typeof z !== "number" || !Number.isFinite(z)) continue;
    const snappedTo = safeString(entry["snappedTo"], 120);
    const subjectId = entry["subjectId"];
    points.push({
      x: clampNumber(x, -100_000, 100_000, 0),
      z: clampNumber(z, -100_000, 100_000, 0),
      snappedTo: snappedTo ?? null,
      // A file's word for which subject a point sits on is kept only if it is
      // a well-formed id; `positionalStatement` then also requires the point to
      // lie exactly on that subject's vertex before quoting its evidence.
      ...(snappedTo !== undefined &&
      typeof subjectId === "string" &&
      ID_PATTERN.test(subjectId)
        ? { subjectId }
        : {}),
    });
  }
  return points;
}

function readView(value: unknown): BookmarkView {
  const source = isRecord(value) ? value : {};
  const cameraMode = CAMERA_MODES.includes(source["cameraMode"] as CameraMode)
    ? (source["cameraMode"] as CameraMode)
    : "orbit";
  const cameraPosition = readVector(source["cameraPosition"]);
  const cameraTarget = readVector(source["cameraTarget"]);
  const storedSnapshot = source["snapshotDate"];
  const legacyYear = source["timelineYear"];
  // A version-2 view held a year as well as an optional date; the date wins,
  // and a year alone maps to the timeline date it corresponds to.
  const snapshotDate = isIsoDate(storedSnapshot)
    ? storedSnapshot
    : typeof legacyYear === "number" && Number.isFinite(legacyYear)
      ? snapshotDateForYear(legacyYear)
      : null;
  const comparisonDate = source["comparisonDate"];
  const selectedId = source["selectedId"];
  const qualityTier = source["qualityTier"];

  return {
    cameraMode,
    ...(cameraPosition === undefined ? {} : { cameraPosition }),
    ...(cameraTarget === undefined ? {} : { cameraTarget }),
    snapshotDate,
    comparisonDate: isIsoDate(comparisonDate) ? comparisonDate : null,
    evidenceMode: parseEvidenceMode(source["evidenceMode"]) ?? DEFAULT_EVIDENCE_MODE,
    selectedId:
      typeof selectedId === "string" && ID_PATTERN.test(selectedId) ? selectedId : null,
    measurePoints: readMeasurePoints(source["measurePoints"]),
    showUncertainty: source["showUncertainty"] === true,
    showLens: source["showLens"] === true,
    environmentMonth: Math.round(clampNumber(source["environmentMonth"], 0, 11, 5)),
    night: source["night"] === true,
    qualityTier:
      qualityTier === 0 || qualityTier === 1 || qualityTier === 2 || qualityTier === 3
        ? qualityTier
        : null,
  };
}

function readProvenance(value: unknown): BookmarkProvenance {
  const source = isRecord(value) ? value : {};
  const hash = (key: string): string | undefined => {
    const raw = source[key];
    // Only a well-formed digest is kept. A malformed one would produce a
    // "does not match" verdict that says nothing about the model.
    return typeof raw === "string" && /^sha256:[0-9a-f]{64}$/.test(raw) ? raw : undefined;
  };
  const modelVersion = safeString(source["modelVersion"], 32);
  const schema = source["manifestSchemaVersion"];
  const manifestSchemaVersion =
    typeof schema === "string" && /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(schema)
      ? schema
      : undefined;
  return {
    ...(manifestSchemaVersion === undefined ? {} : { manifestSchemaVersion }),
    ...(hash("geometryHash") === undefined ? {} : { geometryHash: hash("geometryHash") }),
    ...(hash("evidenceLedgerHash") === undefined
      ? {}
      : { evidenceLedgerHash: hash("evidenceLedgerHash") }),
    ...(modelVersion === undefined ? {} : { modelVersion }),
  };
}

function readTags(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  const tags: string[] = [];
  for (const entry of value) {
    const tag = safeString(entry, MAX_TAG_LENGTH);
    if (tag === undefined) continue;
    if (!tags.includes(tag)) tags.push(tag);
    if (tags.length >= MAX_TAGS) break;
  }
  return tags;
}

function isoNow(): string {
  return new Date().toISOString();
}

/**
 * Identifier for a new bookmark.
 *
 * `crypto.randomUUID` where it exists, and a timestamp-plus-counter fallback
 * where it does not. This is the one place the project generates a value that
 * is not derived from the model, and it is deliberately *not* routed through
 * `mulberry32`: the determinism rule exists so a given seed reproduces the same
 * site, and two bookmarks saved a second apart must not collide.
 */
let fallbackCounter = 0;
export function newBookmarkId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid !== undefined) return uuid;
  fallbackCounter += 1;
  return `bm-${Date.now().toString(36)}-${fallbackCounter.toString(36)}`;
}

/**
 * Upgrades a stored bookmark of any known version to the current one, or
 * returns null if it cannot be understood.
 *
 * Version 1 is the shape this feature would have shipped as without provenance
 * hashes, tags or snapshot dates. No version-1 store was ever released, so this
 * path migrates nothing today — it exists, and is tested, so that the first
 * schema change that *does* have users behind it has a tested mechanism rather
 * than an improvised one. A v1 record upgrades with empty provenance, which
 * correctly reports as "unknown" rather than "matches".
 *
 * A version newer than this build is rejected rather than coerced: fields with
 * the same name may not mean the same thing, and silently reading a future
 * bookmark wrong is worse than declining it.
 */
export function migrateBookmark(value: unknown): Bookmark | null {
  if (!isRecord(value)) return null;
  const rawVersion = value["schemaVersion"];
  const version =
    typeof rawVersion === "number" && Number.isInteger(rawVersion) ? rawVersion : 1;
  if (version > BOOKMARK_SCHEMA_VERSION) return null;

  const id = safeString(value["id"], 64);
  const name = safeString(value["name"], MAX_NAME_LENGTH);
  if (id === undefined) return null;

  const createdAt = safeString(value["createdAt"], 40) ?? isoNow();
  const note = safeString(value["note"], MAX_NOTE_LENGTH);

  return {
    schemaVersion: BOOKMARK_SCHEMA_VERSION,
    id,
    name: name ?? "Untitled view",
    createdAt,
    updatedAt: safeString(value["updatedAt"], 40) ?? createdAt,
    ...(note === undefined ? {} : { note }),
    // v1 carried neither tags nor provenance; both default empty, and an empty
    // provenance is what makes the reproducibility verdict "unknown".
    tags: readTags(value["tags"]),
    view: readView(value["view"]),
    provenance: readProvenance(value["provenance"]),
  };
}

/* ------------------------------------------------------------------ */
/* Storage                                                             */
/* ------------------------------------------------------------------ */

/**
 * The storage this module reads and writes.
 *
 * Taken as a parameter throughout rather than reaching for `window` so the
 * whole module is testable without a DOM — and so a browser that throws on
 * `localStorage` access (Safari in private mode does) degrades to an in-memory
 * store instead of taking the page down.
 */
export type BookmarkStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function memoryStore(): BookmarkStore {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

/** The browser's `localStorage`, or an in-memory stand-in when it is unusable. */
export function defaultStore(): BookmarkStore {
  try {
    const storage = globalThis.localStorage;
    if (storage === undefined) return memoryStore();
    const probe = "lop-nur-twin.probe";
    storage.setItem(probe, "1");
    storage.removeItem(probe);
    return storage;
  } catch {
    return memoryStore();
  }
}

export function loadBookmarks(store: BookmarkStore): readonly Bookmark[] {
  let raw: string | null = null;
  try {
    raw = store.getItem(BOOKMARK_STORAGE_KEY);
    for (const legacyKey of LEGACY_BOOKMARK_STORAGE_KEYS) {
      if (raw !== null) break;
      raw = store.getItem(legacyKey);
    }
  } catch {
    return [];
  }
  if (raw === null) return [];
  // Every record passes through `migrateBookmark`, so a legacy collection
  // arrives at the current version.
  return parseBookmarkCollection(raw).bookmarks;
}

export function saveBookmarks(
  store: BookmarkStore,
  bookmarks: readonly Bookmark[],
): boolean {
  try {
    store.setItem(
      BOOKMARK_STORAGE_KEY,
      JSON.stringify({
        schemaVersion: BOOKMARK_SCHEMA_VERSION,
        bookmarks: bookmarks.slice(0, MAX_BOOKMARKS),
      }),
    );
    return true;
  } catch {
    // Quota exceeded, or storage disabled after the probe succeeded. The caller
    // surfaces this; it must not throw out of a click handler.
    return false;
  }
}

export interface BookmarkCollectionResult {
  bookmarks: readonly Bookmark[];
  /** Records that could not be understood, so an import can report them. */
  rejected: number;
  error?: string;
}

/**
 * Parses an exported or stored collection. Accepts both the wrapped
 * `{ schemaVersion, bookmarks }` envelope and a bare array, because a bare
 * array is what someone will hand-edit and paste in.
 */
export function parseBookmarkCollection(text: string): BookmarkCollectionResult {
  if (text.length > MAX_IMPORT_LENGTH) {
    return {
      bookmarks: [],
      rejected: 0,
      error: `Import is ${text.length} characters, over the ${MAX_IMPORT_LENGTH}-character limit.`,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { bookmarks: [], rejected: 0, error: "File is not valid JSON." };
  }

  const list = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed["bookmarks"])
      ? parsed["bookmarks"]
      : null;
  if (list === null) {
    return {
      bookmarks: [],
      rejected: 0,
      error:
        "No bookmark array found. Expected either an array or an object with a `bookmarks` array.",
    };
  }

  const bookmarks: Bookmark[] = [];
  let rejected = 0;
  const seen = new Set<string>();
  for (const entry of list.slice(0, MAX_BOOKMARKS)) {
    const bookmark = migrateBookmark(entry);
    if (bookmark === null || seen.has(bookmark.id)) {
      rejected += 1;
      continue;
    }
    seen.add(bookmark.id);
    bookmarks.push(bookmark);
  }
  return { bookmarks, rejected };
}

export interface CappedBookmarks {
  /** The list to show and save: never longer than `MAX_BOOKMARKS`. */
  bookmarks: readonly Bookmark[];
  /** How many of the incoming bookmarks made it in. */
  added: number;
  /** How many were refused because the collection is full. */
  refused: number;
}

/**
 * Puts `incoming` in front of `existing`, refusing whatever does not fit under
 * `MAX_BOOKMARKS`.
 *
 * Existing bookmarks are never pushed out to make room: `saveBookmarks`
 * keeps only the first `MAX_BOOKMARKS`, so adding to a full list used to drop
 * the oldest saved views silently while the panel still listed them. A full
 * collection refuses the new ones instead and the caller says so.
 */
export function addBookmarksWithinCap(
  existing: readonly Bookmark[],
  incoming: readonly Bookmark[],
): CappedBookmarks {
  const kept = existing.slice(0, MAX_BOOKMARKS);
  const room = MAX_BOOKMARKS - kept.length;
  const added = Math.min(incoming.length, room);
  return {
    bookmarks: [...incoming.slice(0, added), ...kept],
    added,
    refused: incoming.length - added,
  };
}

/** The export format: the envelope, pretty-printed, with a trailing newline. */
export function exportBookmarks(bookmarks: readonly Bookmark[]): string {
  return `${JSON.stringify(
    {
      schemaVersion: BOOKMARK_SCHEMA_VERSION,
      exportedAt: isoNow(),
      bookmarks,
    },
    null,
    2,
  )}\n`;
}

/* ------------------------------------------------------------------ */
/* Operations                                                          */
/* ------------------------------------------------------------------ */

export function createBookmark(input: {
  name: string;
  view: BookmarkView;
  provenance: BookmarkProvenance;
  note?: string;
  tags?: readonly string[];
}): Bookmark {
  const now = isoNow();
  const note = safeString(input.note, MAX_NOTE_LENGTH);
  return {
    schemaVersion: BOOKMARK_SCHEMA_VERSION,
    id: newBookmarkId(),
    name: safeString(input.name, MAX_NAME_LENGTH) ?? "Untitled view",
    createdAt: now,
    updatedAt: now,
    ...(note === undefined ? {} : { note }),
    tags: readTags(input.tags ?? []),
    view: input.view,
    provenance: input.provenance,
  };
}

export function renameBookmark(bookmark: Bookmark, name: string): Bookmark {
  return {
    ...bookmark,
    name: safeString(name, MAX_NAME_LENGTH) ?? bookmark.name,
    updatedAt: isoNow(),
  };
}

export function duplicateBookmark(bookmark: Bookmark): Bookmark {
  const now = isoNow();
  return {
    ...bookmark,
    id: newBookmarkId(),
    name: safeString(`${bookmark.name} (copy)`, MAX_NAME_LENGTH) ?? "Untitled view",
    createdAt: now,
    updatedAt: now,
  };
}

/* ------------------------------------------------------------------ */
/* Reproducibility                                                     */
/* ------------------------------------------------------------------ */

export type ReproducibilityVerdict =
  "matches" | "evidence-changed" | "geometry-changed" | "unknown";

export interface ReproducibilityCheck {
  verdict: ReproducibilityVerdict;
  message: string;
}

/**
 * Whether the model in front of the user is the model this bookmark was taken
 * against.
 *
 * The three outcomes are deliberately not collapsed. Evidence moving while
 * geometry holds means the claims were revised and the view still points at the
 * same shapes; geometry moving means the camera may be looking at something
 * else entirely. Those need different reactions from a reviewer, so they get
 * different verdicts.
 */
export function checkReproducibility(
  bookmark: Bookmark,
  current: {
    geometryHash?: string;
    evidenceLedgerHash?: string;
    manifestSchemaVersion?: string;
  } | null,
): ReproducibilityCheck {
  const saved = bookmark.provenance;
  if (
    current === null ||
    current.geometryHash === undefined ||
    saved.geometryHash === undefined
  ) {
    return {
      verdict: "unknown",
      message:
        "Cannot be checked: this bookmark or this build carries no geometry hash. Run `bun run manifest` so the model identifies itself.",
    };
  }
  // Two hashes written under different schemas can differ while the model is
  // the same, so comparing them would report a move that never happened.
  if (
    !manifestHashesComparable(saved.manifestSchemaVersion, current.manifestSchemaVersion)
  ) {
    return {
      verdict: "unknown",
      message: `Cannot be checked: this view was saved under manifest schema ${saved.manifestSchemaVersion ?? "1.1.0 or earlier"} and this build writes ${current.manifestSchemaVersion ?? "an unstated schema"}, whose hashes are computed differently. Save the view again to check it from now on.`,
    };
  }
  if (saved.geometryHash !== current.geometryHash) {
    return {
      verdict: "geometry-changed",
      message:
        "The modeled geometry has changed since this view was saved. The camera position still resolves, but it may no longer be looking at what it was pointed at.",
    };
  }
  if (
    saved.evidenceLedgerHash !== undefined &&
    current.evidenceLedgerHash !== undefined &&
    saved.evidenceLedgerHash !== current.evidenceLedgerHash
  ) {
    return {
      verdict: "evidence-changed",
      message:
        "Geometry is unchanged, but the evidence ledger has been revised. Nothing has moved; what the model claims about it is different.",
    };
  }
  return {
    verdict: "matches",
    message:
      "Geometry and evidence ledger both match this build. The view reproduces exactly.",
  };
}

/* ------------------------------------------------------------------ */
/* Shareable URL                                                       */
/* ------------------------------------------------------------------ */

/**
 * Query parameters for a shareable link, carrying settings only.
 *
 * Excluded on purpose, and each for its own reason:
 *
 * - the **note**, because it is the user's own writing and a link is a thing
 *   that gets pasted into a chat, logged by a proxy and kept in a history;
 * - the **tags**, for the same reason at smaller scale;
 * - the **measurement path**, because it is unbounded state that would push a
 *   URL past what a mail client will keep intact — the export file carries it;
 * - the **bookmark name and id**, which identify a local artifact that the
 *   recipient does not have.
 *
 * Everything that remains is already reconstructible by clicking around the
 * interface, which is the test for whether a setting belongs in a URL.
 */
export function shareableSearchParams(bookmark: Bookmark): Record<string, string> {
  const { view } = bookmark;
  const params: Record<string, string> = {
    evidence: view.evidenceMode,
    month: String(view.environmentMonth + 1),
  };
  if (view.snapshotDate !== null) params["snapshot"] = view.snapshotDate;
  if (view.comparisonDate !== null) params["compare"] = view.comparisonDate;
  if (view.selectedId !== null) params["structure"] = view.selectedId;
  if (view.showUncertainty) params["uncertainty"] = "1";
  if (view.showLens) params["lens"] = "1";
  if (view.night) params["night"] = "1";
  if (view.qualityTier !== null) params["quality"] = String(view.qualityTier);
  if (view.cameraTarget !== undefined) {
    const [x, , z] = view.cameraTarget;
    params["at"] = `${x.toFixed(0)},${z.toFixed(0)}`;
  }
  return params;
}

/**
 * A shareable link for a bookmark, rooted at `origin`.
 *
 * `route` is `/` or `/analysis`; both read the same parameters, so a link works
 * in whichever front door the recipient can use. The URL is built with
 * `URLSearchParams`, so every value is percent-encoded and no caller can inject
 * a second parameter through a value.
 */
export function shareableUrl(
  bookmark: Bookmark,
  origin: string,
  route: "/" | "/analysis" = "/",
): string {
  const params = new URLSearchParams(shareableSearchParams(bookmark));
  const base = origin.replace(/\/+$/, "");
  return `${base}${route}?${params.toString()}`;
}
