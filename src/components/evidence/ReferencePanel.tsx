import { useRef, useState } from "react";
import { ExternalLink, X } from "lucide-react";
import {
  ACCEPTED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  OVERLAY_MODES,
  OVERLAY_MODE_META,
  REFERENCE_SCENES,
  getReferenceScene,
  registrationInstructions,
  registrationReport,
  sceneAttribution,
  sceneSourceUrl,
} from "@/lib/referenceImagery";
import { EXTERNAL_LINK_PROPS, safeExternalHref } from "@/lib/safeUrl";
import { useTwinStore } from "@/lib/store";
import { cn } from "@/lib/utils";

/**
 * Registering a public reference scene beside the reconstruction.
 *
 * The panel is mostly a procedure, because the honest version of this feature
 * *is* a procedure: this application cannot ship the imagery (no binary assets),
 * cannot fetch it (the build and the runtime request nothing), and should not
 * make a licensing decision on a reviewer's behalf. So it prints the exact
 * projected window to crop to, links the precise scene its own measurements
 * came from, and reads whatever file the reviewer produces — in their browser,
 * never uploaded, released when replaced.
 *
 * What that buys is the one check that cannot be argued with. Slide the divider
 * across the runway: an edge that continues is registered, an edge that jumps is
 * not, and the registration readout says how many metres of ground each pixel
 * of the supplied crop is worth so a one-pixel disagreement is not mistaken for
 * a finding.
 */

type LoadError = string | null;

function readImageDimensions(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () =>
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error("the file could not be decoded as an image"));
    image.src = url;
  });
}

export function ReferencePanel() {
  const showReference = useTwinStore((state) => state.showReference);
  const toggleReference = useTwinStore((state) => state.toggleReference);
  const reference = useTwinStore((state) => state.reference);
  const setReferenceScene = useTwinStore((state) => state.setReferenceScene);
  const setReferenceImage = useTwinStore((state) => state.setReferenceImage);
  const setReferenceMode = useTwinStore((state) => state.setReferenceMode);
  const setReferenceOpacity = useTwinStore((state) => state.setReferenceOpacity);
  const setReferenceSwipe = useTwinStore((state) => state.setReferenceSwipe);
  const clearReference = useTwinStore((state) => state.clearReference);
  const [error, setError] = useState<LoadError>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  if (!showReference) return null;

  const scene = getReferenceScene(reference.sceneId);
  if (scene === undefined) return null;

  const sourceHref = safeExternalHref(sceneSourceUrl(scene));
  const report =
    reference.objectUrl === null
      ? null
      : registrationReport(reference.widthPx, reference.heightPx, scene);

  const onFile = async (file: File | undefined) => {
    if (file === undefined) return;
    setError(null);
    // Type and size are checked before a blob URL is minted, so a wrong file
    // never reaches the decoder or the scene.
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setError(
        `Unsupported file type "${file.type || "unknown"}". Use PNG, JPEG or WebP.`,
      );
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError(
        `That file is ${(file.size / 1_000_000).toFixed(1)} MB; the limit is ${
          MAX_IMAGE_BYTES / 1_000_000
        } MB.`,
      );
      return;
    }
    const url = URL.createObjectURL(file);
    try {
      const { width, height } = await readImageDimensions(url);
      setReferenceImage(url, width, height);
    } catch (cause) {
      URL.revokeObjectURL(url);
      setError(cause instanceof Error ? cause.message : "the file could not be read");
    }
  };

  return (
    <section
      aria-labelledby="reference-panel-heading"
      // The left column, between the telemetry readout and the minimap. The
      // right column belongs to the dossier and the strip-down report, and this
      // panel has to stay open alongside both — comparing the source against
      // what survived is the whole point of having it.
      className={cn(
        "hud-panel pointer-events-auto absolute top-[13rem] left-4 z-20",
        "max-h-[calc(100vh-21rem)] w-[21rem] max-w-[calc(100vw-2rem)] overflow-y-auto p-3",
        "max-sm:top-14 max-sm:left-2 max-sm:max-h-[calc(100vh-16rem)] max-sm:w-[calc(100vw-1rem)]",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2
            id="reference-panel-heading"
            className="text-muted-foreground text-[10px] font-semibold tracking-[0.18em] uppercase"
          >
            Reference imagery
          </h2>
          <p className="text-muted-foreground mt-0.5 text-[10px] leading-relaxed">
            Put the cited scene under the model and slide between them.
          </p>
        </div>
        <button
          type="button"
          onClick={toggleReference}
          aria-label="Close the reference imagery panel"
          className="border-border hover:bg-accent focus-visible:ring-ring rounded border p-1 focus-visible:ring-2 focus-visible:outline-none"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      </div>

      <div className="mt-3">
        <label
          htmlFor="reference-scene"
          className="text-muted-foreground block text-[10px] tracking-[0.14em] uppercase"
        >
          Scene and window
        </label>
        <select
          id="reference-scene"
          value={reference.sceneId}
          onChange={(event) => setReferenceScene(event.target.value)}
          className="border-border bg-secondary/60 focus-visible:ring-ring mt-1 w-full rounded border px-1 py-0.5 text-[10px] focus-visible:ring-2 focus-visible:outline-none"
        >
          {REFERENCE_SCENES.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.label}
            </option>
          ))}
        </select>
        <p className="text-muted-foreground mt-1 text-[10px] leading-relaxed">
          {scene.note}
        </p>
      </div>

      <ol className="mt-3 space-y-1.5 pl-4 text-[10px] leading-relaxed">
        {registrationInstructions(scene).map((step) => (
          <li key={step} className="list-decimal">
            {step}
          </li>
        ))}
      </ol>

      {sourceHref === undefined ? null : (
        <p className="mt-2 text-[10px]">
          <a
            href={sourceHref}
            {...EXTERNAL_LINK_PROPS}
            className="text-primary inline-flex items-start gap-1 hover:underline"
          >
            Open the cited scene
            <ExternalLink className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        </p>
      )}

      <div className="border-border mt-3 border-t pt-3">
        <label
          htmlFor="reference-file"
          className="text-muted-foreground block text-[10px] tracking-[0.14em] uppercase"
        >
          Registered crop
        </label>
        <input
          ref={inputRef}
          id="reference-file"
          type="file"
          accept={ACCEPTED_IMAGE_TYPES.join(",")}
          onChange={(event) => {
            void onFile(event.target.files?.[0]);
          }}
          className="text-muted-foreground file:border-border file:bg-secondary/60 hover:file:bg-accent focus-visible:ring-ring mt-1 w-full text-[10px] file:mr-2 file:rounded file:border file:px-2 file:py-0.5 file:text-[10px] focus-visible:ring-2 focus-visible:outline-none"
        />
        {error === null ? null : (
          <p role="alert" className="text-destructive mt-1 text-[10px] leading-relaxed">
            {error}
          </p>
        )}
      </div>

      {report === null ? null : (
        <>
          <div className="border-border mt-3 border-t pt-3">
            <div className="text-muted-foreground text-[10px] font-semibold tracking-[0.14em] uppercase">
              Registration
            </div>
            <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[10px]">
              <dt className="text-muted-foreground">Supplied</dt>
              <dd className="text-right">
                {reference.widthPx} x {reference.heightPx} px
              </dd>
              <dt className="text-muted-foreground">Ground per pixel</dt>
              <dd className="text-right">{report.metresPerPixel.toFixed(1)} m</dd>
              <dt className="text-muted-foreground">Scene resolution</dt>
              <dd className="text-right">{scene.resolutionM} m</dd>
              <dt className="text-muted-foreground">Native size</dt>
              <dd className="text-right">{report.nativePixels} px</dd>
              <dt className="text-muted-foreground">Registration ±</dt>
              <dd className="text-right">{report.registrationUncertaintyM} m</dd>
            </dl>
            {report.square ? null : (
              <p className="text-muted-foreground mt-1 text-[10px] leading-relaxed">
                The crop is not square, but the window is. It will be stretched to the
                window, which will misregister it — re-export it square.
              </p>
            )}
            {report.atNativeResolution ? null : (
              <p className="text-muted-foreground mt-1 text-[10px] leading-relaxed">
                Coarser than the source scene itself, so fine disagreements between the
                overlay and the model are the crop's resolution, not a finding.
              </p>
            )}
          </div>

          <fieldset className="mt-3">
            <legend className="text-muted-foreground text-[10px] tracking-[0.14em] uppercase">
              Comparison
            </legend>
            <div className="mt-1 flex flex-wrap gap-1">
              {OVERLAY_MODES.map((mode) => {
                const meta = OVERLAY_MODE_META[mode];
                const active = reference.mode === mode;
                return (
                  <label
                    key={mode}
                    title={meta.description}
                    className={cn(
                      "focus-within:ring-ring inline-flex cursor-pointer items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] focus-within:ring-2",
                      active
                        ? "border-primary/70 bg-accent/60 text-foreground"
                        : "border-border text-muted-foreground hover:bg-accent/40",
                    )}
                  >
                    <input
                      type="radio"
                      name="reference-mode"
                      value={mode}
                      checked={active}
                      onChange={() => setReferenceMode(mode)}
                      className="sr-only"
                    />
                    <span>{meta.label}</span>
                    <span aria-hidden="true">{active ? "✓" : ""}</span>
                  </label>
                );
              })}
            </div>
            <p className="text-muted-foreground mt-1 text-[10px] leading-relaxed">
              {OVERLAY_MODE_META[reference.mode].description}
            </p>
          </fieldset>

          {reference.mode === "swipe" ? (
            <div className="mt-2">
              <label
                htmlFor="reference-swipe"
                className="text-muted-foreground block text-[10px]"
              >
                Divider position
              </label>
              <input
                id="reference-swipe"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={reference.swipe}
                aria-valuetext={`${Math.round(reference.swipe * 100)} per cent across the window, west to east`}
                onChange={(event) => setReferenceSwipe(Number(event.target.value))}
                className="accent-primary h-4 w-full cursor-ew-resize touch-pan-x"
              />
            </div>
          ) : null}

          {reference.mode === "blend" ? (
            <div className="mt-2">
              <label
                htmlFor="reference-opacity"
                className="text-muted-foreground block text-[10px]"
              >
                Scene opacity
              </label>
              <input
                id="reference-opacity"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={reference.opacity}
                aria-valuetext={`${Math.round(reference.opacity * 100)} per cent`}
                onChange={(event) => setReferenceOpacity(Number(event.target.value))}
                className="accent-primary h-4 w-full cursor-ew-resize touch-pan-x"
              />
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => {
              clearReference();
              if (inputRef.current) inputRef.current.value = "";
            }}
            className="border-border hover:bg-accent focus-visible:ring-ring mt-3 rounded border px-2 py-1 text-[10px] focus-visible:ring-2 focus-visible:outline-none"
          >
            Remove the overlay
          </button>

          <ul className="text-muted-foreground mt-3 space-y-1 text-[10px] leading-relaxed">
            {report.caveats.map((caveat) => (
              <li key={caveat}>{caveat}</li>
            ))}
          </ul>
        </>
      )}

      <p className="text-muted-foreground border-border mt-3 border-t pt-2 text-[10px] leading-relaxed">
        {sceneAttribution(scene)}
      </p>
    </section>
  );
}
