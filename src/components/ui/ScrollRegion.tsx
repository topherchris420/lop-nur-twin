import type { ReactNode } from "react";

/**
 * A scrolling box a keyboard can reach. Every wide table scrolls somewhere
 * (sideways on a phone or under browser zoom, down for long lists), and a
 * scroll container with nothing focusable inside is unreachable without a
 * mouse: axe's `scrollable-region-focusable`, which `bun run a11y` gates on at
 * both of its widths. A table wider than its column goes in one of these,
 * never in a bare `overflow-x-auto` box.
 */
export function ScrollRegion({
  label,
  className,
  id,
  children,
}: {
  /** What the region holds, for a screen reader's list of regions. */
  label: string;
  className: string;
  /** For a link or a script that moves focus here. */
  id?: string;
  children: ReactNode;
}) {
  // `relative`: screen-reader-only text inside is absolutely positioned, and
  // without a positioned ancestor it escapes the clipping and widens the page.
  const classes = `relative ${className}`;
  return (
    // A focusable region is the pattern axe and WAI-ARIA prescribe for a
    // scroll container; the lint rule cannot see that it scrolls.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
    <div id={id} role="region" aria-label={label} tabIndex={0} className={classes}>
      {children}
    </div>
  );
}
