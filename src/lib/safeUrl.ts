/**
 * Outbound link safety.
 *
 * Citations are the one place where text from outside this repository becomes
 * a clickable target. They are reviewed and validated at build time
 * (`scripts/validate-data.ts` rejects a non-HTTPS source URL), but a data file
 * is still the sort of thing that gets edited in a hurry, and a `javascript:`
 * or `data:` href in a citation would execute in the page's origin.
 *
 * So every external href is filtered here at render time as well. Defence in
 * depth is cheap when it is four lines.
 */

/** Returns the URL when it is a safe external link, otherwise undefined. */
export function safeExternalHref(url: string | undefined): string | undefined {
  if (url === undefined) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  return parsed.protocol === "https:" ? parsed.href : undefined;
}

/**
 * The attributes every external link must carry. `noopener` denies the opened
 * page a handle on this one; `noreferrer` keeps the referrer out of a third
 * party's logs, which matters when the referrer is an analytical tool.
 */
export const EXTERNAL_LINK_PROPS = {
  target: "_blank",
  rel: "noopener noreferrer",
} as const;
