/** Kept free of imports so the twin's Site Index never pulls in the game. */
const NAMES = new Set(["loulan", "kroraina", "shanshan", "noeterra"]);

export function resolvesLoulan(text: string): boolean {
  return text.length <= 32 && NAMES.has(text.trim().toLowerCase());
}
