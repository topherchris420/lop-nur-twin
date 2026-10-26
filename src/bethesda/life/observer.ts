/**
 * The read-only observer of the one living Bethesda life (criterion 6 of
 * docs/BETHESDA_CONTINUOUS_LIFE.md): an HTTP server that reads the life's
 * observation file and serves its witness (observation.ts) to anyone.
 *
 *   GET /v1/now      the witness, JSON
 *   GET /v1/stream   the witness once a second (server-sent events)
 *   GET /v1/health   200 while the life is live, 503 otherwise
 *
 * It has no other access to the life: it cannot tick, step, restore or
 * write it, and it serves no observation it could not validate. Requests are
 * rate-limited per address and streams capped, per address and in all.
 */
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { readObservation } from "./observationFile.js";
import { witness, type LifeObservation, type Witness } from "./observation.js";

export interface ObserverOptions {
  /** The observation file the life writes. */
  file: string;
  now?: () => number;
  /** Requests per second each address may make, after a burst of `burst`. */
  ratePerS?: number;
  burst?: number;
  /** Streams open at once, per address and in all. */
  streamsPerAddress?: number;
  streams?: number;
}

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-cache",
};
const PUBLIC_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "X-Content-Type-Options": "nosniff",
};

export class Observer {
  readonly server: Server;
  private readonly o: Required<ObserverOptions>;
  private current: Witness;
  private payload: string;
  private readonly buckets = new Map<string, { tokens: number; at: number }>();
  private readonly streams = new Map<string, Set<ServerResponse>>();
  private open = 0;

  constructor(options: ObserverOptions) {
    this.o = {
      now: Date.now,
      ratePerS: 2,
      burst: 10,
      streamsPerAddress: 4,
      streams: 2000,
      ...options,
    };
    this.current = witness(null, this.o.now());
    this.payload = JSON.stringify(this.current);
    this.server = createServer((req, res) => this.handle(req, res));
    this.refresh();
  }

  /** The newest witness. */
  get now(): Witness {
    return this.current;
  }

  /**
   * Reads the observation again and sends the witness to every stream. The
   * script calls it once a second; an invalid observation is never served.
   */
  refresh(): void {
    let observation: LifeObservation | null = null,
      why: string | undefined;
    try {
      observation = readObservation(this.o.file);
    } catch (e) {
      why =
        `the observation is invalid: ${e instanceof Error ? e.message : String(e)}`.slice(
          0,
          300,
        );
    }
    this.current = witness(observation, this.o.now(), why);
    this.payload = JSON.stringify(this.current);
    const event = `data: ${this.payload}\n\n`;
    for (const set of this.streams.values()) for (const res of set) res.write(event);
    // Forget addresses whose buckets have refilled.
    const now = this.o.now();
    for (const [address, b] of this.buckets)
      if ((now - b.at) / 1000 > this.o.burst / this.o.ratePerS)
        this.buckets.delete(address);
  }

  close(): void {
    for (const set of this.streams.values()) for (const res of set) res.end();
    this.server.close();
  }

  /**
   * The client's address: the socket's, or behind the proxy on this machine
   * (Caddy) the last one it put in X-Forwarded-For.
   */
  private address(req: IncomingMessage): string {
    const socket = req.socket.remoteAddress ?? "unknown";
    const loopback =
      socket === "127.0.0.1" || socket === "::1" || socket === "::ffff:127.0.0.1";
    const forwarded = req.headers["x-forwarded-for"];
    if (!loopback || typeof forwarded !== "string") return socket;
    return forwarded.split(",").pop()!.trim() || socket;
  }

  private allowed(address: string): boolean {
    const now = this.o.now();
    const b = this.buckets.get(address) ?? { tokens: this.o.burst, at: now };
    b.tokens = Math.min(this.o.burst, b.tokens + ((now - b.at) / 1000) * this.o.ratePerS);
    b.at = now;
    this.buckets.set(address, b);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const path = (req.url ?? "/").split("?")[0];
    if (req.method === "OPTIONS") {
      res.writeHead(204, { ...PUBLIC_HEADERS, "Access-Control-Max-Age": "86400" });
      res.end();
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { ...PUBLIC_HEADERS, Allow: "GET, HEAD, OPTIONS" });
      res.end();
      return;
    }
    const address = this.address(req);
    if (!this.allowed(address)) {
      res.writeHead(429, { ...PUBLIC_HEADERS, ...JSON_HEADERS, "Retry-After": "1" });
      res.end(JSON.stringify({ error: "too many requests" }));
      return;
    }
    if (path === "/v1/now") {
      res.writeHead(200, { ...PUBLIC_HEADERS, ...JSON_HEADERS });
      res.end(req.method === "HEAD" ? undefined : this.payload);
    } else if (path === "/v1/health") {
      const live = this.current.status === "live";
      res.writeHead(live ? 200 : 503, {
        ...PUBLIC_HEADERS,
        "Content-Type": "text/plain",
      });
      res.end(live ? "live\n" : `${this.current.status}: ${this.current.reason}\n`);
    } else if (path === "/v1/stream") {
      this.stream(address, req, res);
    } else {
      res.writeHead(404, { ...PUBLIC_HEADERS, ...JSON_HEADERS });
      res.end(
        JSON.stringify({
          error: "not found",
          paths: ["/v1/now", "/v1/stream", "/v1/health"],
        }),
      );
    }
  }

  private stream(address: string, _req: IncomingMessage, res: ServerResponse): void {
    const set = this.streams.get(address) ?? new Set<ServerResponse>();
    if (set.size >= this.o.streamsPerAddress || this.open >= this.o.streams) {
      res.writeHead(429, { ...PUBLIC_HEADERS, ...JSON_HEADERS, "Retry-After": "30" });
      res.end(JSON.stringify({ error: "too many streams" }));
      return;
    }
    res.writeHead(200, {
      ...PUBLIC_HEADERS,
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    });
    res.write(`retry: 5000\ndata: ${this.payload}\n\n`);
    set.add(res);
    this.streams.set(address, set);
    this.open++;
    // The response's close, not the request's: a GET's request closes once read.
    res.on("close", () => {
      set.delete(res);
      this.open--;
      if (!set.size) this.streams.delete(address);
    });
  }
}
