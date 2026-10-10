/** A local export, never publishing. Every file's bytes are verified against its receipt. */
import type { ResearchStore } from "../autonomy/store.js";
import { descendantLabs, ROOT_LAB } from "./worlds.js";
import { sha256Json } from "../sha256.js";
export function archiveInstitution(store: ResearchStore, id = ROOT_LAB) {
  const lab =
    id === ROOT_LAB ? null : descendantLabs(store).find((l) => l.spec.id === id);
  if (id !== ROOT_LAB && !lab) throw new Error("Unknown archive namespace");
  const current = lab ? store.descendant(id, lab.spec.budget.storage_bytes) : store;
  const journal = current.discoveryEntries();
  const records = current.records();
  if (records.some((r) => !r.digestOK))
    throw new Error("Quarantined evidence prevents a verified archive");
  const artifacts = journal
    .filter((e) => e.kind === "research-artifact")
    .map((e) => {
      const receipt = e.payload as { name: string; path: string; sha256: string };
      return { ...receipt, text: current.readResearchArtifact(receipt.path) };
    });
  const body = {
    schema: "rain-inception-archive/v1",
    lab: id,
    scope: "simulator-only",
    world: lab?.spec ?? null,
    journal_head_sha256: journal.at(-1)?.sha256 ?? null,
    journal,
    records: records.map((r) => ({ path: r.path, record: r.record })),
    artifacts,
    source_manifest: journal
      .filter((e) => e.kind === "research-source")
      .map((e) => e.payload),
    provenance_rule:
      "Model and scripted interpretations retain their origin. Registry/replay receipts and charter attestations are included in the journal and sealed records. Export is not publication or independent scientific validation.",
  };
  const archive = { ...body, archive_sha256: sha256Json(body) };
  const text = JSON.stringify(archive, null, 2);
  if (Buffer.byteLength(text) > 64 * 1024 * 1024)
    throw new Error(
      "Archive exceeds 64 MiB; export individual native artifacts or a descendant namespace",
    );
  return text;
}
