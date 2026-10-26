/**
 * The observation file between the life and its observer (observation.ts):
 * written whole by the runner, read by the observer, which has no other
 * access to the life. On the VM it is /run/bethesda-life/observation.json,
 * which systemd removes when the life stops.
 */
import { chmodSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { parseObservation, type LifeObservation } from "./observation.js";

/**
 * Publishes an observation whole: written aside, made readable by the
 * observer's user (the life's umask would not let it), then renamed into
 * place, so a reader never sees half of one.
 */
export function writeObservation(path: string, observation: LifeObservation): void {
  const aside = `${path}.${process.pid}.tmp`;
  writeFileSync(aside, JSON.stringify(observation) + "\n");
  chmodSync(aside, 0o644);
  renameSync(aside, path);
}

/** Removes the observation, so the observer reports the life unavailable at once. */
export function removeObservation(path: string): void {
  rmSync(path, { force: true });
}

/** The observation in `path`, null when there is none, or a thrown error saying why it is invalid. */
export function readObservation(path: string): LifeObservation | null {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
  return parseObservation(JSON.parse(text));
}
