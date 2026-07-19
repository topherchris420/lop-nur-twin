import { Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  STRUCTURES,
  STRUCTURE_TYPE_LABELS,
  type StructureDef,
} from "@/lib/layout";
import { flyToStructure } from "@/lib/flyTo";
import { useTwinStore } from "@/lib/store";
import { cn } from "@/lib/utils";

/** Searchable outliner of every modeled structure. Toggled with `I`. */
export function SiteIndex() {
  const showIndex = useTwinStore((s) => s.showIndex);
  const toggleIndex = useTwinStore((s) => s.toggleIndex);
  const selectedId = useTwinStore((s) => s.selectedId);
  const select = useTwinStore((s) => s.select);
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    const filtered = normalized
      ? STRUCTURES.filter((structure) => {
          const searchable = [
            structure.name,
            structure.description,
            STRUCTURE_TYPE_LABELS[structure.type],
            structure.evidence.note,
          ]
            .join(" ")
            .toLocaleLowerCase();
          return searchable.includes(normalized);
        })
      : STRUCTURES;

    const grouped = new Map<string, StructureDef[]>();
    for (const structure of filtered) {
      const label = STRUCTURE_TYPE_LABELS[structure.type];
      const list = grouped.get(label) ?? [];
      list.push(structure);
      grouped.set(label, list);
    }

    return [...grouped.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([label, structures]) => [
        label,
        [...structures].sort((left, right) => left.name.localeCompare(right.name)),
      ] as const);
  }, [query]);

  if (!showIndex) return null;

  const inspect = (def: StructureDef) => {
    select(def.id);
    flyToStructure(def);
    toggleIndex();
  };

  return (
    <Card id="site-index" className="site-index-panel hud-side-panel absolute top-16 left-4 z-10 flex max-h-[70dvh] w-64 flex-col">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Site Index</CardTitle>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close site index"
            onClick={toggleIndex}
          >
            <X />
          </Button>
        </div>
        <div className="relative mt-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
          <label className="sr-only" htmlFor="site-index-search">
            Search site structures
          </label>
          <input
            id="site-index-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search structures"
            autoComplete="off"
            className="border-input bg-secondary/70 text-foreground placeholder:text-muted-foreground h-8 w-full rounded-md border pr-2 pl-8 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      </CardHeader>
      <CardContent className="overflow-y-auto">
        {groups.length > 0 ? (
          groups.map(([label, defs]) => (
            <div key={label} className="mb-3 last:mb-0">
              <div className="text-muted-foreground mb-1 text-[10px] font-semibold tracking-[0.18em] uppercase">
                {label} / {defs.length}
              </div>
              <ul className="space-y-0.5">
                {defs.map((def) => (
                  <li key={def.id}>
                    <button
                      type="button"
                      onClick={() => inspect(def)}
                      className={cn(
                        "hover:bg-accent w-full cursor-pointer rounded px-2 py-1.5 text-left text-xs transition-colors",
                        selectedId === def.id && "bg-accent text-accent-foreground",
                      )}
                    >
                      {def.name}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))
        ) : (
          <p className="text-muted-foreground py-6 text-center text-xs" role="status">
            No matching structures
          </p>
        )}
      </CardContent>
    </Card>
  );
}
