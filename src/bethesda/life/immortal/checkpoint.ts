/** Node-only archive transaction. Reuses LifeStore; no alternative persistence system. */
import { checkpointLife, restoreLife, type LifeCheckpoint } from "../continuity.js";
import type { LifeStore } from "../store.js";
import {
  IMMORTAL_RESEARCH_LIFE,
  type ImmortalGenesis,
  type ImmortalLife,
} from "./life.js";

/** Move bounded experience records into the sealed append-only checkpoint history.
 * A failed publish restores the in-memory outbox and fails closed. Never retries a fork. */
export function checkpointResearch(
  life: ImmortalLife,
  store: LifeStore<ImmortalGenesis, ImmortalLife>,
  previous: LifeCheckpoint<ImmortalGenesis>,
): LifeCheckpoint<ImmortalGenesis> {
  const records = life.outbox;
  life.outbox = [];
  try {
    const checkpoint = checkpointLife(IMMORTAL_RESEARCH_LIFE, life, {
      genesis: previous.genesis,
      birth: previous.birth,
      previous,
      events: records,
    });
    restoreLife(IMMORTAL_RESEARCH_LIFE, checkpoint);
    store.renew();
    store.commit(checkpoint);
    return checkpoint;
  } catch (e) {
    life.outbox = records;
    throw e;
  }
}
