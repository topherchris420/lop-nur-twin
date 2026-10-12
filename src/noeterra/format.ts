const SEASONS = ["Spring", "Summer", "Autumn", "Winter"] as const;

/** Astronomical year 0 is 1 BC. */
export function formatYear(year: number): string {
  return year <= 0 ? `${1 - year} BC` : `AD ${year}`;
}

export function seasonOf(startYear: number, turn: number): string {
  return `${SEASONS[turn % 4] ?? ""} ${formatYear(startYear + Math.floor(turn / 4))}`;
}

export function fmt(x: number | null | undefined, digits = 0): string {
  if (typeof x !== "number" || !Number.isFinite(x)) return "—";
  const s = x.toFixed(digits);
  return /^-0(\.0*)?$/.test(s) ? s.slice(1) : s;
}

export type Category =
  "Military" | "Diplomacy" | "Economy" | "Politics" | "Unrest" | "Disaster" | "Expansion";

const KINDS: Record<string, [Category, string]> = {
  war: ["Military", "War declared"],
  battle: ["Military", "Battle"],
  occupation: ["Military", "Province occupied"],
  liberation: ["Military", "Province liberated"],
  great_general: ["Military", "A great general"],
  joined_war: ["Diplomacy", "An ally joins the war"],
  peace: ["Diplomacy", "Peace concluded"],
  treaty: ["Diplomacy", "Treaty concluded"],
  treaty_cancelled: ["Diplomacy", "Treaty cancelled"],
  alliance_broken: ["Diplomacy", "Alliance broken"],
  tribute: ["Diplomacy", "Tribute paid"],
  tribute_refused: ["Diplomacy", "Tribute refused"],
  gift: ["Diplomacy", "Gift"],
  conquest: ["Expansion", "Lands annexed"],
  revolt: ["Unrest", "Revolt"],
  revolt_crushed: ["Unrest", "Revolt put down"],
  plague: ["Disaster", "Plague"],
  harvest: ["Economy", "Bountiful harvest"],
  windfall: ["Economy", "Trade windfall"],
  desertion: ["Economy", "Unpaid soldiers desert"],
  succession: ["Politics", "Succession"],
  scandal: ["Politics", "Scandal at court"],
  capital_moved: ["Politics", "Capital moved"],
  fall: ["Politics", "A power falls"],
};

export function eventHeading(
  kind: string,
  text: string,
): { category: Category; title: string } {
  const [category, title] =
    KINDS[kind] ?? (["Politics", kind.replaceAll("_", " ")] as [Category, string]);
  if (kind === "battle") {
    const at = text.split(":")[0];
    return { category, title: at ?? title };
  }
  return { category, title };
}

export const CATEGORY_STYLE: Record<Category, string> = {
  Military: "bg-red-500/15 text-red-200 ring-red-400/30",
  Diplomacy: "bg-sky-500/15 text-sky-200 ring-sky-400/30",
  Economy: "bg-emerald-500/15 text-emerald-200 ring-emerald-400/30",
  Politics: "bg-violet-500/15 text-violet-200 ring-violet-400/30",
  Unrest: "bg-amber-500/15 text-amber-200 ring-amber-400/30",
  Disaster: "bg-rose-500/15 text-rose-200 ring-rose-400/30",
  Expansion: "bg-teal-500/15 text-teal-200 ring-teal-400/30",
};

export const TRAITS = [
  "aggression",
  "expansion",
  "caution",
  "honor",
  "mercantile",
  "diplomacy",
] as const;

/** A heraldic shield in the nation's colour with its initial: no image assets. */
export function emblemPath(): string {
  return "M2 2 H22 V11 C22 17 17 21 12 23 C7 21 2 17 2 11 Z";
}
