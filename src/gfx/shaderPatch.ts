/**
 * Splicing GLSL into three's own shaders, checked.
 *
 * Every custom look in this project is a stock three material with text
 * spliced in at a known line: after `#include <common>`, in place of
 * `#include <project_vertex>`, around one statement inside a lighting chunk.
 * `String.replace` is the obvious tool and the wrong one, because an anchor
 * that is no longer there is not an error to it: the shader comes back
 * unchanged and the material renders as stock three, or half patched, which
 * compiles to nothing at all. Nothing fails until someone looks.
 *
 * three rewords its chunks between releases, and the version range allows the
 * next one. r187 moved the multiscatter term out of the specular BRDF call the
 * clay material patched; the clay module refused to load, and `/live` served
 * an error page for two days because no check ran the patch against the three
 * that was actually installed.
 *
 * So a patch goes through `patchShader`, which throws on an anchor that is
 * gone, naming the site and the line; and `shaderPatches.test.ts` runs every
 * patch in the project against the installed three's shader library, so the
 * release that moves a line fails the unit tests instead of a page. A new
 * `onBeforeCompile` belongs in that test's list — it fails on a file that
 * patches shaders and is not there.
 */
import { REVISION } from "three";

/** One splice: the text to find, and what stands in its place. */
export type ShaderSplice = readonly [anchor: string, replacement: string];

/** An anchor three's shader no longer contains. */
export class ShaderAnchorError extends Error {
  constructor(
    readonly site: string,
    readonly anchor: string,
  ) {
    super(
      `${site}: three r${REVISION}'s shader no longer contains ` +
        `${JSON.stringify(anchor)}; update the patch`,
    );
    this.name = "ShaderAnchorError";
  }
}

/**
 * Applies `splices` to `source` in order, each to the first occurrence of its
 * anchor in the result of the one before, exactly as a chain of `.replace()`
 * calls would — except that a missing anchor throws, and the replacement is
 * inserted as written (`$&` and `$1` mean nothing here).
 */
export function patchShader(
  site: string,
  source: string,
  splices: readonly ShaderSplice[],
): string {
  let out = source;
  for (const [anchor, replacement] of splices) {
    const at = out.indexOf(anchor);
    if (at < 0) throw new ShaderAnchorError(site, anchor);
    out = out.slice(0, at) + replacement + out.slice(at + anchor.length);
  }
  return out;
}
