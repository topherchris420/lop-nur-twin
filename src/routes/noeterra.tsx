import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { parseIdValue } from "@/lib/params";
import { NoeterraApp } from "@/noeterra/NoeterraApp";

/**
 * `/noeterra` — alternate histories played by autonomous civilizations. The
 * Noeterra engine (noeterra/, Rust) runs in the visitor's browser as an
 * import-free WebAssembly module: rule-based agents with memory rule every
 * nation the visitor does not. Its outcomes describe an illustrative model,
 * never the historical world, and the page says so wherever a result appears.
 */
const SCENARIOS = ["mediterranean-264bc", "tarim-77bc"] as const;

interface NoeterraSearch {
  scenario?: (typeof SCENARIOS)[number];
  play?: string;
  seed?: number;
}

const KEYS = [
  "scenario",
  "play",
  "seed",
] as const satisfies readonly (keyof NoeterraSearch)[];

export const Route = createFileRoute("/noeterra")({
  component: NoeterraPage,
  validateSearch: (search: Record<string, unknown>): NoeterraSearch => {
    const v: NoeterraSearch = {};
    const scenario = parseIdValue(search["scenario"]);
    const known = SCENARIOS.find((s) => s === scenario);
    if (known) v.scenario = known;
    const play = parseIdValue(search["play"]);
    if (play !== null && /^[a-z][a-z0-9_]{0,23}$/.test(play)) v.play = play;
    const raw = search["seed"];
    const seed =
      typeof raw === "number"
        ? raw
        : typeof raw === "string" && /^\d{1,10}$/.test(raw)
          ? Number(raw)
          : NaN;
    if (Number.isSafeInteger(seed) && seed >= 0 && seed <= 2147483647) v.seed = seed;
    // Every key is returned, `undefined` when rejected (see AGENTS.md).
    return Object.fromEntries(KEYS.map((k) => [k, v[k]]));
  },
});

function NoeterraPage() {
  const search = Route.useSearch();
  useEffect(() => {
    document.title = "Noeterra — autonomous civilizations · illustrative simulation";
  }, []);
  return (
    <div className="relative h-full w-full overflow-hidden">
      <NoeterraApp scenario={search.scenario} play={search.play} seed={search.seed} />
    </div>
  );
}
