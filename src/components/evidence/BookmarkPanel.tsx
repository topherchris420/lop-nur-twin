import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BOOKMARK_SCHEMA_VERSION,
  MAX_NAME_LENGTH,
  MAX_NOTE_LENGTH,
  checkReproducibility,
  createBookmark,
  defaultStore,
  duplicateBookmark,
  exportBookmarks,
  loadBookmarks,
  parseBookmarkCollection,
  renameBookmark,
  saveBookmarks,
  shareableUrl,
  type Bookmark,
  type BookmarkProvenance,
  type BookmarkStore,
  type BookmarkView,
} from "@/lib/bookmarks";
import { EVIDENCE_MODE_META } from "@/lib/evidenceMode";
import { cn } from "@/lib/utils";

/**
 * Bookmark management, shared by `/analysis` and the 3D research panel.
 *
 * Every control is a real button or input with a label, so the whole feature
 * works from the keyboard and reads correctly to a screen reader — which is not
 * a nicety here, because `/analysis` is the route someone uses when the 3D view
 * is unavailable to them, and a bookmark they cannot manage there is a bookmark
 * they do not have.
 *
 * The reproducibility verdict is the load-bearing part of the display. It is
 * shown as a word and a symbol on every row, never as a colour, and it is
 * stated even when the answer is "cannot be checked".
 */

const VERDICT_META = {
  matches: { glyph: "✓", label: "Reproduces" },
  "evidence-changed": { glyph: "≠", label: "Evidence revised" },
  "geometry-changed": { glyph: "✗", label: "Geometry moved" },
  unknown: { glyph: "?", label: "Cannot be checked" },
} as const;

export interface BookmarkPanelProps {
  /** Snapshot of the current analytical position, captured when saving. */
  captureView: () => BookmarkView;
  /** Hashes identifying the model this build serves. */
  provenance: BookmarkProvenance;
  /** Hashes to check saved bookmarks against; null while the manifest is unread. */
  currentModel: { geometryHash?: string; evidenceLedgerHash?: string } | null;
  /** Applies a saved view to the live application. Omitted where that is not possible. */
  onOpen?: (bookmark: Bookmark) => void;
  density?: "compact" | "comfortable";
  className?: string;
  /** Injected in tests; defaults to `localStorage` with an in-memory fallback. */
  store?: BookmarkStore;
}

export function BookmarkPanel({
  captureView,
  provenance,
  currentModel,
  onOpen,
  density = "comfortable",
  className,
  store,
}: BookmarkPanelProps) {
  const storeRef = useRef<BookmarkStore | null>(store ?? null);
  if (storeRef.current === null) storeRef.current = defaultStore();
  const activeStore = storeRef.current;

  const [bookmarks, setBookmarks] = useState<readonly Bookmark[]>([]);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const compact = density === "compact";
  const text = compact ? "text-[10px]" : "text-xs";

  useEffect(() => {
    setBookmarks(loadBookmarks(activeStore));
  }, [activeStore]);

  const persist = useCallback(
    (next: readonly Bookmark[], message: string) => {
      setBookmarks(next);
      const ok = saveBookmarks(activeStore, next);
      setStatus(
        ok
          ? message
          : "Could not write to this browser's local storage. The list above is correct for this tab only and will not survive a reload.",
      );
    },
    [activeStore],
  );

  const save = useCallback(() => {
    const bookmark = createBookmark({
      name: name.trim().length > 0 ? name : `View ${bookmarks.length + 1}`,
      view: captureView(),
      provenance,
      ...(note.trim().length === 0 ? {} : { note }),
    });
    persist([bookmark, ...bookmarks], `Saved "${bookmark.name}".`);
    setName("");
    setNote("");
  }, [bookmarks, captureView, name, note, persist, provenance]);

  const importFile = useCallback(
    (file: File) => {
      file
        .text()
        .then((content) => {
          const result = parseBookmarkCollection(content);
          if (result.error !== undefined) {
            setStatus(`Import failed: ${result.error}`);
            return;
          }
          const existing = new Set(bookmarks.map((bookmark) => bookmark.id));
          const incoming = result.bookmarks.filter(
            (bookmark) => !existing.has(bookmark.id),
          );
          persist(
            [...incoming, ...bookmarks],
            `Imported ${incoming.length} bookmark${incoming.length === 1 ? "" : "s"}` +
              (result.rejected > 0
                ? `; ${result.rejected} record${result.rejected === 1 ? "" : "s"} rejected as malformed or duplicated.`
                : "."),
          );
        })
        .catch(() => {
          setStatus("Import failed: the file could not be read.");
        });
    },
    [bookmarks, persist],
  );

  const exportAll = useCallback(() => {
    const blob = new Blob([exportBookmarks(bookmarks)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "lop-nur-bookmarks.json";
    anchor.click();
    URL.revokeObjectURL(url);
    setStatus(
      `Exported ${bookmarks.length} bookmark${bookmarks.length === 1 ? "" : "s"}, including notes and tags. The file stays on your machine.`,
    );
  }, [bookmarks]);

  const origin = useMemo(
    () => (typeof window === "undefined" ? "" : window.location.origin),
    [],
  );

  return (
    <div className={className}>
      <div className="flex flex-wrap items-end gap-3">
        <div className={compact ? "w-40" : "w-64"}>
          <label htmlFor="bookmark-name" className={cn("block font-medium", text)}>
            Bookmark name
          </label>
          <input
            id="bookmark-name"
            type="text"
            value={name}
            maxLength={MAX_NAME_LENGTH}
            onChange={(event) => setName(event.target.value)}
            placeholder="Main apron, observed mode"
            className={cn(
              "border-input bg-secondary/60 focus-visible:ring-ring mt-1 w-full rounded-md border px-2 py-1 focus-visible:ring-2 focus-visible:outline-none",
              text,
            )}
          />
        </div>
        <div className={compact ? "w-full" : "w-96"}>
          <label htmlFor="bookmark-note" className={cn("block font-medium", text)}>
            Analyst note (stays on this machine)
          </label>
          <input
            id="bookmark-note"
            type="text"
            value={note}
            maxLength={MAX_NOTE_LENGTH}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Why this view matters"
            className={cn(
              "border-input bg-secondary/60 focus-visible:ring-ring mt-1 w-full rounded-md border px-2 py-1 focus-visible:ring-2 focus-visible:outline-none",
              text,
            )}
          />
        </div>
        <button
          type="button"
          onClick={save}
          className={cn(
            "border-border hover:bg-accent focus-visible:ring-ring rounded-md border px-3 py-1.5 focus-visible:ring-2 focus-visible:outline-none",
            text,
          )}
        >
          Save this view
        </button>
        <button
          type="button"
          onClick={exportAll}
          disabled={bookmarks.length === 0}
          className={cn(
            "border-border hover:bg-accent focus-visible:ring-ring rounded-md border px-3 py-1.5 focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50",
            text,
          )}
        >
          Export all
        </button>
        <label
          className={cn(
            "border-border hover:bg-accent focus-within:ring-ring cursor-pointer rounded-md border px-3 py-1.5 focus-within:ring-2",
            text,
          )}
        >
          Import file
          <input
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file !== undefined) importFile(file);
              event.target.value = "";
            }}
          />
        </label>
      </div>

      <p role="status" className={cn("text-muted-foreground mt-2 leading-relaxed", text)}>
        {status ??
          `Bookmarks are stored in this browser only — no account, no server. Schema version ${BOOKMARK_SCHEMA_VERSION}; export to move them between machines.`}
      </p>

      {bookmarks.length === 0 ? (
        <p className={cn("text-muted-foreground mt-3 leading-relaxed", text)}>
          No bookmarks saved yet.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {bookmarks.map((bookmark) => {
            const check = checkReproducibility(bookmark, currentModel);
            const verdict = VERDICT_META[check.verdict];
            const share = origin.length === 0 ? null : shareableUrl(bookmark, origin);
            return (
              <li key={bookmark.id} className="border-border rounded border p-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span
                    className={cn("font-semibold", compact ? "text-[11px]" : "text-sm")}
                  >
                    {bookmark.name}
                  </span>
                  <span className={cn("font-mono", text)}>
                    <span aria-hidden="true">{verdict.glyph}</span> {verdict.label}
                  </span>
                </div>
                <p className={cn("text-muted-foreground mt-0.5 font-mono", text)}>
                  {EVIDENCE_MODE_META[bookmark.view.evidenceMode].shortLabel} ·{" "}
                  {bookmark.view.timelineYear} ·{" "}
                  {bookmark.view.snapshotDate ?? "current state"}
                  {bookmark.view.comparisonDate === null
                    ? ""
                    : ` vs ${bookmark.view.comparisonDate}`}{" "}
                  · {bookmark.view.measurePoints.length} measurement point
                  {bookmark.view.measurePoints.length === 1 ? "" : "s"}
                </p>
                <p className={cn("text-muted-foreground mt-0.5 leading-relaxed", text)}>
                  {check.message}
                </p>
                {bookmark.note === undefined ? null : (
                  <p className={cn("mt-1 leading-relaxed", text)}>{bookmark.note}</p>
                )}
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {onOpen === undefined ? null : (
                    <button
                      type="button"
                      onClick={() => onOpen(bookmark)}
                      className={cn(
                        "border-border hover:bg-accent focus-visible:ring-ring rounded border px-2 py-0.5 focus-visible:ring-2 focus-visible:outline-none",
                        text,
                      )}
                    >
                      Open here
                    </button>
                  )}
                  {share === null ? null : (
                    <>
                      <a
                        href={shareableUrl(bookmark, origin, "/")}
                        className={cn(
                          "border-border hover:bg-accent focus-visible:ring-ring rounded border px-2 py-0.5 focus-visible:ring-2 focus-visible:outline-none",
                          text,
                        )}
                      >
                        Open in 3D
                      </a>
                      <a
                        href={shareableUrl(bookmark, origin, "/analysis")}
                        className={cn(
                          "border-border hover:bg-accent focus-visible:ring-ring rounded border px-2 py-0.5 focus-visible:ring-2 focus-visible:outline-none",
                          text,
                        )}
                      >
                        Open in analysis
                      </a>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard
                            ?.writeText(share)
                            .then(() => {
                              setStatus(
                                "Shareable link copied. It carries view settings only — the note, the tags and the measurement path stay on this machine.",
                              );
                            })
                            .catch(() => {
                              setStatus(`Copy failed. The link is: ${share}`);
                            });
                        }}
                        className={cn(
                          "border-border hover:bg-accent focus-visible:ring-ring rounded border px-2 py-0.5 focus-visible:ring-2 focus-visible:outline-none",
                          text,
                        )}
                      >
                        Copy shareable link
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      const next = window.prompt("Rename bookmark", bookmark.name);
                      if (next === null) return;
                      persist(
                        bookmarks.map((item) =>
                          item.id === bookmark.id ? renameBookmark(item, next) : item,
                        ),
                        `Renamed to "${next}".`,
                      );
                    }}
                    className={cn(
                      "border-border hover:bg-accent focus-visible:ring-ring rounded border px-2 py-0.5 focus-visible:ring-2 focus-visible:outline-none",
                      text,
                    )}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      persist(
                        [duplicateBookmark(bookmark), ...bookmarks],
                        `Duplicated "${bookmark.name}".`,
                      )
                    }
                    className={cn(
                      "border-border hover:bg-accent focus-visible:ring-ring rounded border px-2 py-0.5 focus-visible:ring-2 focus-visible:outline-none",
                      text,
                    )}
                  >
                    Duplicate
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      persist(
                        bookmarks.filter((item) => item.id !== bookmark.id),
                        `Deleted "${bookmark.name}".`,
                      )
                    }
                    className={cn(
                      "border-border hover:bg-accent focus-visible:ring-ring rounded border px-2 py-0.5 focus-visible:ring-2 focus-visible:outline-none",
                      text,
                    )}
                  >
                    Delete
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
