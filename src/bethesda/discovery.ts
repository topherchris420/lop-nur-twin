/** Kept light so ordinary visits never import the city or its map. */
export function resolvesBethesda(text: string): boolean {
  if (text.length > 64) return false;
  if (text.trim().toLowerCase() === "resolve bethesda") return true;
  const m =
    /^\s*([+-]?\d{1,3}(?:\.\d{1,8})?)\s*,\s*([+-]?\d{1,3}(?:\.\d{1,8})?)\s*$/.exec(text);
  if (!m) return false;
  const lat = Number(m[1]),
    lon = Number(m[2]);
  return lat >= 38.978 && lat <= 38.991 && lon >= -77.104 && lon <= -77.089;
}
