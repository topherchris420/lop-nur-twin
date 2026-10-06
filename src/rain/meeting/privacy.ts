/**
 * Where a model meeting is allowed to send the question and the corpus.
 *
 * A port of the locality rule of R.A.I.N.'s `utilities/rig_settings.py`
 * (james_library, MIT): IP literals and `localhost` are classified directly;
 * any other hostname is resolved and is local only when every address is
 * loopback or private; lookup failure is remote (fail closed). Under
 * `RAIN_MEETING_PRIVACY=local` — the runtime's default — a remote endpoint or
 * an Ollama `:cloud` model is refused before the first request; `hybrid`
 * permits them, which is R.A.I.N.'s own default and what an operator who
 * points the runtime at a hosted model is choosing.
 *
 * Server only: resolves names through `node:dns`.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type Privacy = "local" | "hybrid";
export type Locality = "loopback" | "private" | "remote";

export class PrivacyError extends Error {}

const PRIVATE_V4 = [
  [0x0a000000, 0xff000000], // 10.0.0.0/8
  [0xac100000, 0xfff00000], // 172.16.0.0/12
  [0xc0a80000, 0xffff0000], // 192.168.0.0/16
  [0xa9fe0000, 0xffff0000], // 169.254.0.0/16
] as const;

const v4ToInt = (address: string) =>
  address.split(".").reduce((acc, part) => ((acc << 8) | Number(part)) >>> 0, 0) >>> 0;

/** The address's class: loopback, private (RFC 1918, link-local, ULA) or remote. */
export function classifyIp(address: string): Locality {
  let ip = address.trim();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) ip = mapped[1]!;
  if (isIP(ip) === 4) {
    const n = v4ToInt(ip);
    if ((n & 0xff000000) >>> 0 === 0x7f000000) return "loopback";
    return PRIVATE_V4.some(([net, mask]) => (n & mask) >>> 0 === net)
      ? "private"
      : "remote";
  }
  if (isIP(ip) === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "0:0:0:0:0:0:0:1") return "loopback";
    const head = parseInt(lower.split(":")[0] || "0", 16);
    if ((head & 0xfe00) === 0xfc00) return "private"; // fc00::/7
    if ((head & 0xffc0) === 0xfe80) return "private"; // fe80::/10
    return "remote";
  }
  return "remote";
}

export type Resolver = (host: string) => Promise<string[]>;
export const systemResolve: Resolver = async (host) => {
  try {
    return (await lookup(host, { all: true })).map((entry) => entry.address);
  } catch {
    return [];
  }
};

export async function classifyHost(
  host: string,
  resolve: Resolver = systemResolve,
): Promise<Locality> {
  const bare = host
    .trim()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "")
    .toLowerCase();
  if (bare === "localhost") return "loopback";
  if (isIP(bare)) return classifyIp(bare);
  const addresses = await resolve(bare);
  if (!addresses.length) return "remote";
  const kinds = new Set(addresses.map(classifyIp));
  if (kinds.has("remote")) return "remote";
  return kinds.has("private") ? "private" : "loopback";
}

export async function classifyUrl(
  url: string,
  resolve: Resolver = systemResolve,
): Promise<Locality> {
  let host: string | null;
  try {
    host = new URL(url.trim()).hostname;
  } catch {
    return "remote";
  }
  return host ? classifyHost(host, resolve) : "remote";
}

/**
 * Fail closed when privacy is `local` and the meeting would be hosted.
 * Returns the effective mode; throws `PrivacyError` otherwise.
 */
export async function enforceMeetingPrivacy(
  privacy: Privacy,
  baseUrl: string,
  model: string,
  resolve: Resolver = systemResolve,
): Promise<Privacy> {
  if (privacy !== "local") return privacy;
  if (model.trim().endsWith(":cloud"))
    throw new PrivacyError(
      `RAIN_MEETING_PRIVACY=local refuses the meeting model '${model}': Ollama ':cloud' models run on a hosted service. Set RAIN_LLM_MODEL to a local model, or set RAIN_MEETING_PRIVACY=hybrid.`,
    );
  if ((await classifyUrl(baseUrl, resolve)) === "remote") {
    let host = "(invalid URL)";
    try {
      host = new URL(baseUrl).hostname || host;
    } catch {
      /* reported as invalid */
    }
    throw new PrivacyError(
      `RAIN_MEETING_PRIVACY=local refuses the meeting endpoint host ${host}: it is not loopback or private-network. Point RAIN_LLM_BASE_URL at a local server, or set RAIN_MEETING_PRIVACY=hybrid.`,
    );
  }
  return privacy;
}
