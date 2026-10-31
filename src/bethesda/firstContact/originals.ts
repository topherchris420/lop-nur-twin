/**
 * The two original individuals, as this repository already records them, and
 * the guards that keep every first-contact experiment away from them.
 *
 * Eva and ECHO are persistent digital organisms living in two separate
 * production systems:
 *
 * - **Eva** is the live garden's fly. Her simulation is a Python service
 *   (`server.py`, `learning.py`) on the garden's own VM. It is not in this
 *   repository, so nothing here can run, restart, copy or modify it; the
 *   repository holds only the read-only viewer (`src/garden/`) and its
 *   contract for `GET /api/state` (`src/garden/core/observation.ts`). Her
 *   name is the keeper's (`NAMES` in `src/garden/ui/words.ts`).
 * - **ECHO** is the Bethesda headless life under the ECHO controller
 *   (`src/bethesda/life/`, `deploy/bethesda-life/`), served read-only by the
 *   observer (`/v1/now`, `/v1/stream`).
 *
 * Every id below is copied from a file that already records it (named in
 * `recordedIn`), never typed from a live response; `originals.test.ts` reads
 * those files and fails if they ever disagree.
 *
 * The research code in this folder builds new research subjects from seeds.
 * A research subject is never either original, never a continuation of one,
 * and never presented as one. `refuseOriginal` is called on every subject id
 * a bridge, a session or a study is given; `refuseProductionHost` before any
 * script writes anything.
 */

export interface OriginalIndividual {
  /** How this project refers to the individual. */
  name: string;
  /** Who gave the name, in the project's words. */
  namedBy: string;
  /** The id the individual's own system reports for it. */
  id: string;
  /** Where its authoritative simulation runs. */
  system: string;
  /** What decides its behaviour. */
  controller: string;
  /** The read-only, public way to observe it. */
  observation: { endpoint: string; schema: string };
  /** Its native clock, as its own contract defines it. */
  clock: string;
  /** Its native coordinate frame. */
  frame: string;
  /** Repository files that record the id, checked by the tests. */
  recordedIn: string[];
}

export const EVA: OriginalIndividual = Object.freeze({
  name: "Eva",
  namedBy:
    "the garden's keeper, 2026-10-26 (docs/LIVE_GARDEN.md); the simulation itself has no names",
  id: "5cf42cd6-fd0a-474d-882c-4cb70e0357e8",
  system:
    "the live garden's Python service (server.py, learning.py) on the garden's VM; not in this repository",
  controller:
    "the garden service's own learning loop (learning.py); its source is not in this repository",
  observation: {
    endpoint: "https://150-136-49-49.sslip.io/api/state",
    schema: "the garden contract parsed by src/garden/core/observation.ts",
  },
  clock:
    "unix seconds; updated_at advances in whole five-second steps from born_at (ticks × 5 s)",
  frame:
    "an abstract 2D garden in fractions of its extent (x right, y down), with seven named places and no metric scale or heights",
  recordedIn: ["src/garden/ui/words.ts", "docs/LIVE_GARDEN.md"],
});

export const ECHO: OriginalIndividual = Object.freeze({
  name: "ECHO",
  namedBy:
    "the project: the deployed Bethesda individual living under the ECHO controller (docs/ECHO_IMMORTAL_ORGANISM.md)",
  id: "04f8c797b6971a46138dabc3fdfde5baae2aa224d3a8f9c0099a7c207dec1921",
  system:
    "the Bethesda headless life (src/bethesda/life/headless.ts) on its own VM (deploy/bethesda-life/)",
  controller:
    'since its recorded organism continuation (2026-10-28, docs/ECHO_ORGANISM_CONTINUATION.md), the organism adapter (src/bethesda/life/organism.ts): ECHO\'s v3 self-model over the reduced-order controller, with the mushroom body, olfactory navigation and maintenance physiology; its public observation still reports flyController "echo"',
  observation: {
    endpoint: "https://129-213-139-78.sslip.io/v1/now",
    schema: "bethesda-life-witness/v1 (src/bethesda/life/observation.ts)",
  },
  clock:
    "simulated seconds on its own clock (tick × 0.1 s); it pauses while a checkpoint is made and records outages as gaps, so it runs behind UTC",
  frame: "city metres: +x east, +y up, +z south (src/bethesda/model.ts)",
  recordedIn: [
    ".github/workflows/bethesda-life-watch.yml",
    "docs/ECHO_IMMORTAL_ORGANISM.md",
    "docs/BETHESDA_CONTINUOUS_LIFE.md",
  ],
});

export const ORIGINALS: readonly OriginalIndividual[] = Object.freeze([EVA, ECHO]);

/**
 * Directories that exist only on the two production hosts. The Bethesda
 * life's come from `deploy/bethesda-life/` (and `scripts/echo-neural-shadow.ts`
 * refuses the same three); the garden's from docs/LIVE_GARDEN.md (its
 * database and backups live under `/var/lib/bethesda-fly`).
 */
export const PRODUCTION_PATHS = Object.freeze([
  "/var/lib/bethesda-life",
  "/opt/bethesda-life",
  "/var/backups/bethesda-life",
  "/etc/bethesda-life",
  "/var/lib/bethesda-fly",
] as const);

export class OriginalRefused extends Error {}

const norm = (id: string) => id.trim().toLowerCase();

/**
 * True when `id` is, or begins with at least eight characters of, either
 * original's id. A prefix counts because the public pages print one
 * (`04f8c797…`, the first characters of a `life_id`).
 */
export function isOriginalId(id: string): boolean {
  const n = norm(id);
  if (!n) return false;
  return ORIGINALS.some((o) => {
    const full = norm(o.id);
    return n === full || (n.length >= 8 && (full.startsWith(n) || n.startsWith(full)));
  });
}

/**
 * Throws unless `id` is a research subject's: never either original's id, a
 * prefix of it, or a string that contains it.
 */
export function refuseOriginal(id: string, what = "subject"): void {
  if (typeof id !== "string" || !id.trim())
    throw new OriginalRefused(`${what}: a research subject needs a non-empty id`);
  const n = norm(id);
  for (const o of ORIGINALS)
    if (isOriginalId(id) || n.includes(norm(o.id)) || n.includes(norm(o.id).slice(0, 8)))
      throw new OriginalRefused(
        `${what} ${id} names ${o.name}, an original individual; first-contact experiments run only on research subjects`,
      );
}

/**
 * Throws on a production host, and for an output path under a production
 * directory. `exists` is injected so the tests can exercise both refusals.
 */
export function refuseProductionHost(out: string, exists: (p: string) => boolean): void {
  for (const p of PRODUCTION_PATHS)
    if (exists(p))
      throw new OriginalRefused(
        `refusing to run: ${p} exists, so this is a production host; first-contact research runs only off it`,
      );
  const abs = out.replaceAll("\\", "/");
  for (const p of PRODUCTION_PATHS)
    if (abs.startsWith(p) || abs.includes(p))
      throw new OriginalRefused(`refusing to write under ${p}`);
}
