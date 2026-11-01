/** Node-only selection. An untrusted version tag selects a verifier, never bypasses one. */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ECHO_UPGRADE, ECHO_UPGRADED_LIFE } from "./echoUpgrade";
import { BETHESDA_LIFE } from "./headless";
import { HABIT_LIFE } from "./habitOrganism";
import { ORGANISM_LIFE, ORGANISM_VERSION } from "./organism";

export function bethesdaStoreKind(dir: string): typeof BETHESDA_LIFE {
  const latest = readdirSync(join(dir, "checkpoints"))
    .filter((name) => /^\d{12}\.json$/.test(name))
    .sort()
    .at(-1);
  if (!latest) throw new Error(`${dir} holds no checkpoint`);
  const record = JSON.parse(readFileSync(join(dir, "checkpoints", latest), "utf8")) as {
    checkpoint?: { versions?: { upgrade?: unknown; organism?: unknown; habits?: unknown } };
  };
  const versions = record.checkpoint?.versions;
  if (versions?.habits === HABIT_LIFE.versions.habits) return HABIT_LIFE;
  if (versions?.organism === ORGANISM_VERSION) return ORGANISM_LIFE;
  return versions?.upgrade === ECHO_UPGRADE ? ECHO_UPGRADED_LIFE : BETHESDA_LIFE;
}
