import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";

function within(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** Validate before appending an export or running expensive experiments. */
export function intelligenceExportPath(
  repository: string,
  journal: string,
  requested: string | undefined,
  kind: "publication" | "archive",
): string | undefined {
  if (requested === undefined) return undefined;
  const root = realpathSync(repository);
  const requestedPath = resolve(root, requested);
  const parent = realpathSync(dirname(requestedPath));
  const target = resolve(parent, basename(requestedPath));
  if (target === root || !within(root, requestedPath) || !within(root, target))
    throw new Error("Export must remain inside the producing repository");
  if (existsSync(target)) throw new Error("Export requires a new directory");
  const source = existsSync(journal) ? realpathSync(journal) : resolve(journal);
  if (within(source, target) || within(target, source))
    throw new Error("Export cannot overlap the research journal");
  if (
    kind === "archive" &&
    ["public", "dist"].some(
      (name) =>
        within(resolve(root, name), target) || within(resolve(root, name), requestedPath),
    )
  )
    throw new Error("Raw archives must remain outside the static website");
  return target;
}
