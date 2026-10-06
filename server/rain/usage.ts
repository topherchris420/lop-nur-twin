/**
 * How often each key — an operation and a session, or an operation and a
 * client address — has been used within its window, in a bounded map.
 *
 * A key's window opens at its first counted use and closes `windowMs` later;
 * after that it starts again from nothing. A full ledger makes room for a new
 * key by forgetting keys whose window has closed and then, one at a time, the
 * least recently used. It never forgets everything at once: that would hand
 * every session and client a fresh allowance whenever someone filled the map.
 *
 * Like the route's other limits, this lives in one process and is forgotten on
 * a cold start.
 */

export interface Usage {
  /** When this key's window opened. */
  since: number;
  /** When this key was last counted. */
  last: number;
  count: number;
}

export class UsageLedger {
  private readonly uses = new Map<string, Usage>();
  private readonly windowMs: number;
  private readonly maxKeys: number;

  constructor(windowMs: number, maxKeys: number) {
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;
  }

  /** The key's usage in its open window, or `undefined` if it has none. */
  get(key: string, now: number): Usage | undefined {
    const use = this.uses.get(key);
    if (use && now - use.since >= this.windowMs) {
      this.uses.delete(key);
      return undefined;
    }
    return use;
  }

  /** Count one use of the key, which becomes the most recently used. */
  record(key: string, now: number): void {
    const use = this.get(key, now);
    if (use) this.uses.delete(key);
    else this.makeRoom(now);
    this.uses.set(key, {
      since: use?.since ?? now,
      last: now,
      count: (use?.count ?? 0) + 1,
    });
  }

  get size(): number {
    return this.uses.size;
  }

  private makeRoom(now: number): void {
    if (this.uses.size < this.maxKeys) return;
    for (const [key, use] of this.uses)
      if (now - use.since >= this.windowMs) this.uses.delete(key);
    // Iteration order is recency order, because `record` re-inserts.
    while (this.uses.size >= this.maxKeys) {
      const oldest = this.uses.keys().next();
      if (oldest.done) break;
      this.uses.delete(oldest.value);
    }
  }
}
