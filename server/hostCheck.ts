import { isIP } from "node:net";

/**
 * Whether the dev and preview servers' `/api/*` middleware may answer a request
 * that names this `Host`.
 *
 * The decision routes spend the developer's provider credit, and their
 * same-origin check compares `Origin` with an origin rebuilt from this very
 * header — so under DNS rebinding (`evil.example:5173` resolving to 127.0.0.1)
 * both name the attacker's page and agree. The host is the one thing such a
 * page cannot choose. It is checked here, before any API handler runs, and
 * independently of whether Vite's own host validation happens to run first.
 *
 * The rule is Vite's `allowedHosts` rule: an IP literal (a page cannot
 * rebind one), `localhost` and `*.localhost`, and what `server.allowedHosts`
 * or `preview.allowedHosts` lists — exactly, or with a leading `.` for a
 * domain and its subdomains. `true` there means the developer turned host
 * checking off. No `Host` at all is refused: every browser sends one.
 */
export function isAllowedApiHost(
  hostHeader: string | undefined,
  allowedHosts: readonly string[] | true,
): boolean {
  if (allowedHosts === true) return true;
  if (hostHeader === undefined) return false;
  const host = hostHeader.trim().toLowerCase();
  if (host === "") return false;
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    if (end < 0) return false;
    const rest = host.slice(end + 1);
    return isIP(host.slice(1, end)) === 6 && (rest === "" || /^:\d{1,5}$/.test(rest));
  }
  const match = /^([^:]+)(?::\d{1,5})?$/.exec(host);
  if (!match) return false;
  const name = match[1]!.replace(/\.$/, "");
  if (isIP(name) === 4) return true;
  if (name === "localhost" || name.endsWith(".localhost")) return true;
  return allowedHosts.some((entry) => {
    const allowed = entry.toLowerCase();
    return allowed.startsWith(".")
      ? name === allowed.slice(1) || name.endsWith(allowed)
      : name === allowed;
  });
}
