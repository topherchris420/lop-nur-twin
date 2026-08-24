# Accessibility

**This project makes no claim of Section 508 conformance and no claim of full
WCAG 2.1 AA conformance.** What it can state is narrower and checkable: which
automated tests run, what they cover, what they found, and which manual checks
remain outstanding. An accessibility claim that has not been tested by a person
using assistive technology is not a claim worth making.

## The core problem, and the response

The primary interface is a WebGL canvas driven by a mouse. That is not usable
with a screen reader, is difficult without a pointing device, and requires a
GPU. No amount of ARIA fixes a 3D scene for a screen-reader user.

So the model has a second, equal front door: **`/analysis`** presents the same
evidence ledger as a document — semantic headings, one real table, text-first
evidence status, and a link into the 3D dossier for every row. It renders no
canvas, no animation and no timers.

## What `/analysis` implements

| Requirement                    | How                                                                                                                                                  |
| :----------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------- |
| Skip navigation                | First focusable element is a "Skip to the structure table" link, visually hidden until focused                                                       |
| Descriptive page title         | Set on mount: "Structure analysis table — Lop Nur Twin (public-source model)"                                                                        |
| Semantic headings              | One `<h1>`, `<h2>` per section, no level skipped                                                                                                     |
| Landmarks                      | `<header>`, `<nav aria-label>`, `<section aria-labelledby>`, `<footer>`                                                                              |
| Proper table markup            | `<caption>`, `<thead>`, `<th scope="col">`, row headers as `<th scope="row">`                                                                        |
| Full keyboard navigation       | Native controls only — no custom widgets, no keyboard traps, no positive `tabindex`                                                                  |
| Logical tab order              | DOM order matches visual order                                                                                                                       |
| Visible focus indicators       | `focus-visible:ring-2` on every link, button, input and checkbox                                                                                     |
| Screen-reader labels           | `<label for>` on the search field and every filter checkbox; `aria-describedby` hint; external links append a visually-hidden "(opens in a new tab)" |
| Status messages                | Result count and manifest state use `role="status"`                                                                                                  |
| No information by colour alone | Evidence status pairs a glyph and a word with its tint; confidence is a number and a rank in text                                                    |
| Reduced motion                 | The deep-link scroll uses `behavior: "auto"` when `prefers-reduced-motion: reduce` is set; the page has no other motion                              |
| Responsive / zoom              | Single-column stacking, wide table scrolls inside its own container, page body never scrolls horizontally                                            |

## What the 3D routes implement

`/` and `/play` are canvas surfaces, but their DOM overlays are still built to
be operable:

- All controls are real `<button>` and `<a>` elements with `aria-label`,
  `aria-pressed` and `aria-expanded` where they express state.
- Keyboard shortcuts cover every mode: `1`/`2`/`3` cameras, `N` day-night,
  `I` site index, `R` research, `M` measure, `H` help, `Esc` to close.
- The evidence legend is a labelled `<section>` with a real disclosure button.
- `prefers-reduced-motion: reduce` freezes automatic scene motion, makes camera
  moves immediate, disables adaptive quality promotion, and the global CSS rule
  neutralises animations and transitions.
- If WebGL is unavailable, a `role="alert"` message explains why instead of
  showing a black screen.
- `/play` carries its disclaimer and its return link as DOM elements outside
  the game canvas, so they are readable by assistive technology.

## Automated testing

`tools/a11y.mjs` runs axe-core 4.12 against the **production build** served by
`vite preview` with the deployed security headers, across all four routes. It
also records Content-Security-Policy violations and page errors in the same
pass.

```sh
npm run build
npm run preview &     # http://localhost:4173
npm run a11y
```

Rules: `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`.

Gating policy — deliberate and asymmetric:

- **`/analysis`**: any serious or critical violation fails the run. This route
  is the accessible view; it has no excuse.
- **`/` and `/play`**: violations are printed in full, but only CSP violations
  and page errors fail. Their primary content is a canvas that axe cannot
  evaluate, and a soft gate that everyone ignores is worse than an honest one.

### Result of the last run in this environment

| Route       | axe violations | serious/critical | CSP violations | page errors |
| :---------- | -------------: | ---------------: | -------------: | ----------: |
| `/analysis` |              0 |                0 |              0 |           0 |
| `/`         |              0 |                0 |              0 |           0 |
| `/play`     |              0 |                0 |              0 |           0 |

Two real defects were found and fixed while building this: a `<dl>` containing
a status `<div>` that was neither a term nor a definition, and a dimmed
`text-muted-foreground/70` on the boot overlay that fell below the 4.5:1
contrast threshold.

**Automated testing catches roughly 30–40% of WCAG issues.** A clean axe run
means the markup-level checks pass. It does not mean the site is accessible.

## Manual checks that remain outstanding

None of these has been performed. They require a person, and in several cases a
person who uses the technology daily:

1. **Screen-reader narration** — NVDA + Firefox, JAWS + Chrome, VoiceOver +
   Safari on `/analysis`: does the table read row by row in a way that makes
   sense? Are the evidence badges announced once, not twice?
2. **Keyboard-only task completion** — find a structure, filter by evidence
   status, open its 3D dossier, return. Without a mouse. On all four routes.
3. **Zoom to 200% and 400%**, and 320 px viewport width, without loss of
   content or horizontal page scroll.
4. **Colour-contrast review of the rendered canvas.** The 3D scene's own
   contrast is not measurable by axe and has not been assessed.
5. **Voice control** (Dragon, Voice Control) — are the visible labels the ones
   a user would speak?
6. **Cognitive-load review** of the evidence vocabulary with someone outside
   the OSINT field: does "interpreted" read as "guessed" or as "verified"?
7. **Reduced-motion verification with the OS preference actually set**, rather
   than emulated.
8. **A formal WCAG 2.1 AA audit** by a qualified assessor, if a conformance
   statement or an ACR/VPAT is ever required. This repository has no VPAT and
   should not be described as having one.

## Known limitations

- The 3D scene is not usable with a screen reader and will not become so.
  `/analysis` is the answer, not a canvas-level ARIA layer.
- Blacksite requires a mouse and keyboard, and fast reactions. It is a
  demonstration of simulation technique, not an accessible experience; the same
  underlying model is fully available through `/analysis`.
- There is no high-contrast theme. The interface is dark-only.
- No captions or transcripts exist because there is no speech or recorded
  audio; all sound is synthesised, non-verbal feedback that duplicates
  on-screen information.
- Automated checks run in a headless Chromium. Behaviour under real assistive
  technology is untested.

## If you find an accessibility barrier

Open an issue describing what you were trying to do, what happened, and the
assistive technology, browser and operating system involved. Accessibility
defects are treated as functional defects, not enhancements.
