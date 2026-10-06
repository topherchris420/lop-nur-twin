/**
 * A request the runtime will not serve. The status and code are safe to
 * return to the browser: no value from the environment, no path, no stack.
 *
 * Shared with the server: imports nothing.
 */
export class Refused extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}
