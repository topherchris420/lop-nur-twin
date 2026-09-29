import type { ReactNode } from "react";

/**
 * A scrolling box a keyboard can reach. Every wide table on `/evaluation`
 * scrolls somewhere (sideways on a phone, down for long episode lists), and a
 * scroll container with nothing focusable inside is unreachable without a
 * mouse: axe's `scrollable-region-focusable`, which `bun run a11y` gates on.
 */
export function ScrollRegion({
  label,
  className,
  children,
}: {
  label: string;
  className: string;
  children: ReactNode;
}) {
  return (
    // A focusable region is the pattern axe and WAI-ARIA prescribe for a
    // scroll container; the lint rule cannot see that it scrolls.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
    <div role="region" aria-label={label} tabIndex={0} className={className}>
      {children}
    </div>
  );
}
