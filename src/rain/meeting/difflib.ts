/**
 * `difflib.SequenceMatcher(None, a, b).ratio()`, as CPython computes it.
 *
 * R.A.I.N.'s stagnation monitor measures how alike two turns are with this
 * ratio, so the port carries the same algorithm: Ratcliff/Obershelp longest
 * matching blocks over the two character sequences, with CPython's
 * "automatic junk" heuristic — in a sequence of 200 or more items, items that
 * occur in more than 1% of the positions are not used to seed matches, though
 * matches may still extend through them.
 *
 * Shared with the server: imports nothing.
 */

export function sequenceRatio(aText: string, bText: string): number {
  const a = [...aText];
  const b = [...bText];
  const la = a.length,
    lb = b.length;
  if (la + lb === 0) return 1.0;
  // b2j: each element of b to the positions where it occurs, minus the popular ones.
  const b2j = new Map<string, number[]>();
  b.forEach((elt, i) => {
    let list = b2j.get(elt);
    if (!list) b2j.set(elt, (list = []));
    list.push(i);
  });
  if (lb >= 200) {
    const ntest = Math.floor(lb / 100) + 1;
    for (const [elt, idxs] of [...b2j]) if (idxs.length > ntest) b2j.delete(elt);
  }
  const empty: number[] = [];
  const findLongestMatch = (
    alo: number,
    ahi: number,
    blo: number,
    bhi: number,
  ): [number, number, number] => {
    let besti = alo,
      bestj = blo,
      bestsize = 0;
    let j2len = new Map<number, number>();
    for (let i = alo; i < ahi; i++) {
      const newj2len = new Map<number, number>();
      for (const j of b2j.get(a[i]!) ?? empty) {
        if (j < blo) continue;
        if (j >= bhi) break;
        const k = (j2len.get(j - 1) ?? 0) + 1;
        newj2len.set(j, k);
        if (k > bestsize) {
          besti = i - k + 1;
          bestj = j - k + 1;
          bestsize = k;
        }
      }
      j2len = newj2len;
    }
    // Extend the match through popular elements on either side.
    while (besti > alo && bestj > blo && a[besti - 1] === b[bestj - 1]) {
      besti--;
      bestj--;
      bestsize++;
    }
    while (
      besti + bestsize < ahi &&
      bestj + bestsize < bhi &&
      a[besti + bestsize] === b[bestj + bestsize]
    )
      bestsize++;
    return [besti, bestj, bestsize];
  };
  const queue: [number, number, number, number][] = [[0, la, 0, lb]];
  let matches = 0;
  while (queue.length) {
    const [alo, ahi, blo, bhi] = queue.pop()!;
    const [i, j, k] = findLongestMatch(alo, ahi, blo, bhi);
    if (k) {
      matches += k;
      if (alo < i && blo < j) queue.push([alo, i, blo, j]);
      if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
    }
  }
  return (2.0 * matches) / (la + lb);
}
