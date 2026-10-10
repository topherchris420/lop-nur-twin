/** Opt-in text ingestion; reads only the exact file named by the operator. */
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { ResearchStore } from "../src/rain/autonomy/store.js";
import { corpusSourceManifest } from "../src/rain/research/knowledge.js";
import {
  prepareSourceVersion,
  admitSourceVersion,
  type SourceManifest,
} from "../src/rain/research/sourceIngestion.js";
const index = process.argv.findIndex((v) =>
  v.replaceAll("\\", "/").endsWith("/rain-inception-source.ts"),
);
const args = process.argv.slice(index < 0 ? 2 : index + 1).filter((v) => v !== "--");
const command = args.shift(),
  options = new Map<string, string>();
if (command === "catalog" && args.length === 0) {
  console.log(JSON.stringify(corpusSourceManifest(), null, 2));
  process.exit(0);
}
for (let i = 0; i < args.length; i += 2) {
  const flag = args[i]!,
    value = args[i + 1];
  if (
    ![
      "--file",
      "--root",
      "--collection",
      "--version",
      "--previous",
      "--title",
      "--creator",
      "--category",
      "--start",
      "--end",
      "--approve",
      "--operator",
    ].includes(flag) ||
    !value ||
    value.startsWith("--") ||
    options.has(flag)
  )
    throw new Error("Invalid source argument");
  options.set(flag, value);
}
if (
  !["prepare", "import"].includes(command ?? "") ||
  ["--file", "--root", "--collection", "--title", "--creator", "--category"].some(
    (f) => !options.has(f),
  )
)
  throw new Error(
    "Usage: rain:inception:source prepare|import --file UTF8_TEXT --root STORE --collection ID --title TITLE --creator ATTRIBUTION --category CATEGORY [--version N --previous HASH --start N --end N] [--approve MANIFEST_SHA256 --operator ROLE]. No file scanning, downloads, PDF parsing or private-conversation collection.",
  );
const file = resolve(options.get("--file")!);
if (!statSync(file).isFile() || statSync(file).size > 1048576)
  throw new Error("Supply a regular text file of at most one MiB");
const document = new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(file));
const prepared = prepareSourceVersion(
  document,
  {
    collection: options.get("--collection")!,
    version: Number(options.get("--version") ?? 1),
    previous_sha256: options.get("--previous") ?? null,
    title: options.get("--title")!,
    creator: options.get("--creator")!,
    category: options.get("--category") as SourceManifest["category"],
  },
  Number(options.get("--start") ?? 0),
  Number(options.get("--end") ?? Math.min(document.length, 4000)),
);
if (command === "import") {
  if (!options.get("--operator")) throw new Error("Operator role required");
  admitSourceVersion(
    new ResearchStore(resolve(options.get("--root")!)),
    prepared,
    options.get("--approve") ?? "",
    options.get("--operator")!,
  );
}
console.log(
  JSON.stringify(
    {
      ...prepared,
      imported: command === "import",
      next: "Attach source.id to a new reviewed profile.source_ids; ingestion alone does not change an approved charter.",
    },
    null,
    2,
  ),
);
