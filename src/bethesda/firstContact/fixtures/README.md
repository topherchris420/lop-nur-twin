# First-contact fixtures

`joint-2026-10-31.json` holds real responses from the two public observation
endpoints, recorded read-only by `scripts/first-contact-observe.ts` on
2026-10-31 (UTC): four consecutive `GET /api/state` responses from the live
garden (Eva) and the fifteen `GET /v1/now` witnesses from the Bethesda observer
(ECHO) received over the same 15 seconds (11:59:42.418Z to 11:59:57.274Z).

Each entry keeps what the recorder wrote: the local receipt time, the stream,
the endpoint, the HTTP status, the SHA-256 of the body and the body's text,
unmodified. `joint.test.ts` re-hashes every body before using it.

During this window Eva was asleep at the windowsill, so her position does not
change; ECHO was resting in the city. Tests that need other situations (an
identity change, a stale stream, a jump) derive them from these responses and
say so where they do.
