import { Navigation, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  GRID_EASTING_ORIGIN,
  GRID_NORTHING_ORIGIN,
  STRUCTURE_TYPE_LABELS,
  getStructure,
} from "@/lib/layout";
import { flyToStructure } from "@/lib/flyTo";
import { useTwinStore } from "@/lib/store";

export function Dossier() {
  const selectedId = useTwinStore((s) => s.selectedId);
  const select = useTwinStore((s) => s.select);
  const def = selectedId ? getStructure(selectedId) : undefined;
  if (!def) return null;

  const [w, h, d] = def.size;
  const easting = (GRID_EASTING_ORIGIN + def.position[0]).toFixed(0);
  const northing = (GRID_NORTHING_ORIGIN - def.position[1]).toFixed(0);

  return (
    <Card className="absolute top-16 right-4 w-80">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle>{def.name}</CardTitle>
            <Badge variant="secondary" className="mt-1.5">
              {STRUCTURE_TYPE_LABELS[def.type]}
            </Badge>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close dossier"
            onClick={() => select(null)}
          >
            <X />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <CardDescription>{def.description}</CardDescription>
        <Separator />
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 font-mono text-xs">
          <dt className="text-muted-foreground">Dimensions</dt>
          <dd className="text-right">
            {w} × {d} × {h} m
          </dd>
          <dt className="text-muted-foreground">Capacity</dt>
          <dd className="text-right">{def.capacity}</dd>
          <dt className="text-muted-foreground">Grid ref</dt>
          <dd className="text-right">
            {easting} E {northing} N
          </dd>
        </dl>
        <Button className="w-full" onClick={() => flyToStructure(def)}>
          <Navigation />
          Fly to structure
        </Button>
      </CardContent>
    </Card>
  );
}
