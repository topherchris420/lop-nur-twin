/**
 * Credential-shaped material is refused before it reaches a decision engine
 * or a record. A port of `contains_sensitive_material` from R.A.I.N.'s
 * `judgment/state.py` (james_library, MIT): credential assignments, bearer
 * tokens, known key prefixes, PEM private keys, and the value of any
 * configured secret in the server's environment.
 *
 * Shared with the server: imports nothing. The environment is passed in, so
 * tests never read the real one.
 */

const SENSITIVE_ASSIGNMENT =
  /\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|authorization|client[_ -]?secret|password|passwd|credential|private[_ -]?key)\b\s*[:=]\s*(?:bearer\s+)?[^\s,;]{8,}/i;
const BEARER_TOKEN = /\bbearer\s+[A-Za-z0-9._~+/-]{8,}/i;
const SECRET_PREFIX =
  /\b(?:sk-[A-Za-z0-9._-]{12,}|ghp_[A-Za-z0-9._-]{12,}|github_pat_[A-Za-z0-9._-]{12,}|xox[bpar]-[A-Za-z0-9._-]{12,}|AIza[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16})\b/;
const PEM_PRIVATE_KEY = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/;
const SECRET_ENV_MARKERS = [
  "API_KEY",
  "TOKEN",
  "SECRET",
  "PASSWORD",
  "PRIVATE_KEY",
  "CREDENTIAL",
];

/** Conservatively reject credential-shaped or configured secret material. */
export function containsSensitiveMaterial(
  text: string,
  env: Readonly<Record<string, string | undefined>> = {},
): boolean {
  if (
    SENSITIVE_ASSIGNMENT.test(text) ||
    BEARER_TOKEN.test(text) ||
    SECRET_PREFIX.test(text) ||
    PEM_PRIVATE_KEY.test(text)
  )
    return true;
  for (const [name, value] of Object.entries(env)) {
    if (
      value !== undefined &&
      SECRET_ENV_MARKERS.some((marker) => name.toUpperCase().includes(marker)) &&
      value.length >= 8 &&
      !["not-needed", "undefined"].includes(value.toLowerCase()) &&
      text.includes(value)
    )
      return true;
  }
  return false;
}
