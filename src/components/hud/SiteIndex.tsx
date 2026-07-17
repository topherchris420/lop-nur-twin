import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import {
  STRUCTURES,
  STRUCTURE_TYPE_LABELS,
  type StructureDef,
} from "@/lib/layout";
import { flyToStructure } from "@/lib/flyTo";
import { useTwinStore } from "@/lib/store";
import { cn } from "@/lib/utils";

/** Grouped outliner of every structure on site. Toggled with `I`. */
export function SiteIndex() {
  const showIndex = useTwinStore((s) => s.showIndex);
  const toggleIndex = useTwinStore((s) => s.toggleIndex);
  const selectedId = useTwinStore((s) => s.selectedId);
  const select = useTwinStore((s) => s.select);
  if (!showIndex) return null;

  const groups = new Map<string, StructureDef[]>();
  for (const s of STRUCTURES) {
    const label = STRUCTURE_TYPE_LABELS[s.type];
    const list = groups.get(label) ?? [];
    list.push(s);
    groups.set(label, list);
  }

  const inspect = (def: StructureDef) => {
    select(def.id);
    flyToStructure(def);
  };

  return (
    <Card className="absolute top-16 left-4 flex max-h-[70vh] w-64 flex-col">
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
      </CardHeader>
      <CardContent className="overflow-y-auto">
        {[...groups.entries()].map(([label, defs]) => (
          <div key={label} className="mb-3 last:mb-0">
            <div className="text-muted-foreground mb-1 text-[10px] font-semibold tracking-[0.18em] uppercase">
              {label}
            </div>
            <ul className="space-y-0.5">
              {defs.map((def) => (
                <li key={def.id}>
                  <button
                    type="button"
                    onClick={() => inspect(def)}
                    className={cn(
                      "hover:bg-accent w-full cursor-pointer rounded px-2 py-1 text-left text-xs transition-colors",
                      selectedId === def.id && "bg-accent text-accent-foreground",
                    )}
                  >
                    {def.name}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
