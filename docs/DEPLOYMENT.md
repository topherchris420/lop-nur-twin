# Deployment

Two supported deployments: the public demo on Vercel, and a container image for
evaluation on an evaluator's own infrastructure. Both serve the same static
`dist/` output with the same security headers.

## Build settings

| Setting | Value |
| :-- | :-- |
| Install command | `npm ci` (or `bun install --frozen-lockfile`) |
| Build command | `npm run build` |
| Output directory | `dist` |
| Node version | **22.18 or newer** (declared in `package.json` `engines`) |
| Framework preset | Vite |
| Environment variables required | none |
| Secrets required | none |

`npm run build` is four steps, in this order:

```text
node scripts/run-ts.mjs scripts/validate-data.ts       # data + evidence gate
node scripts/run-ts.mjs scripts/generate-manifest.ts   # public/model-manifest.json
vite build                                             # → dist/
tsc --noEmit                                           # strict typecheck
```

Data validation and manifest generation run **before** Vite, so a deployment
cannot be produced from data that does not validate, and `dist/` always
contains a manifest describing itself.

### Why Node 22.18

`scripts/run-ts.mjs` executes the TypeScript build scripts under either
runtime: Bun natively, or Node using its built-in type stripping (unflagged
since 22.18) plus a small `module.registerHooks` resolver. Both produce
byte-identical manifests. On an older Node the script exits with a clear
message rather than a confusing parse error.

If your platform pins an older Node, either raise it or install Bun and run
`bun scripts/validate-data.ts` and `bun scripts/generate-manifest.ts` directly.

## Vercel

`vercel.json` in the repository root configures three things:

1. **SPA rewrites** — `/(.*)` → `/index.html`. Vercel checks the filesystem
   *before* applying rewrites, so real files (`/assets/*`,
   `/model-manifest.json`) are served as themselves and only unmatched paths
   fall through to the app shell. This is what makes `/play` and `/analysis`
   work when opened directly and survive a refresh.
2. **Security headers** on every response: Content-Security-Policy,
   `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`,
   `Cross-Origin-Opener-Policy`, `Permissions-Policy` and
   `Strict-Transport-Security`.
3. **Cache policy** — hashed assets under `/assets/` are immutable for a year;
   `/model-manifest.json` is `no-cache`, because a stale manifest would
   describe a build the visitor is not looking at.

### Redeploying after these changes

The header and cache rules in `vercel.json` take effect on the **next
deployment** — Vercel applies them at build time, not to already-deployed
output. So:

1. Push to the branch Vercel builds, or trigger a redeploy from the dashboard.
2. Confirm the dashboard's Node version is 22.x. If it is pinned to 20.x, the
   build will fail at `run-ts.mjs` with an explicit message; raise it.
3. Confirm the output directory is `dist` (it is also declared in
   `vercel.json`).
4. After deploying, verify the headers and the SPA routing:

```sh
curl -sI https://<your-deployment>/ | grep -i content-security-policy
curl -s -o /dev/null -w '%{http_code}\n' https://<your-deployment>/analysis
curl -s -o /dev/null -w '%{http_code}\n' https://<your-deployment>/play
curl -s https://<your-deployment>/model-manifest.json | head -20
```

All three routes should return 200 on a direct request and on a refresh.

## Container image

```sh
docker build -t lop-nur-twin .
docker run --rm -p 8080:8080 lop-nur-twin
curl -f http://localhost:8080/healthz          # → ok
open http://localhost:8080/analysis
```

Properties:

- **Multi-stage.** A `node:22.22-alpine` builder runs the same
  validate → manifest → build → typecheck pipeline as CI; the runtime stage
  copies only `dist/`.
- **Minimal runtime.** `nginxinc/nginx-unprivileged:1.29-alpine` — no Node, no
  npm, no source, no development dependencies, no shell tooling beyond
  BusyBox.
- **Non-root.** Runs as uid 101 and listens on 8080. No capability beyond
  reading static files is required.
- **No embedded secrets.** The build takes no credential and the image contains
  none; `.dockerignore` keeps `.env*`, keys and local state out of the build
  context entirely.
- **`--ignore-scripts` on install**, so no dependency postinstall executes
  during an image build. Puppeteer's browser download is skipped: it is a test
  dependency and has no place in a production image.
- **SPA fallback** via `try_files $uri $uri/ /index.html`, with real files
  still served as themselves.
- **Health path** at `/healthz`, returning `ok` with no application state
  touched. Also wired as a Docker `HEALTHCHECK`.
- **Security headers** identical to the Vercel deployment.

### Reproducible image

```sh
docker build --build-arg SOURCE_DATE_EPOCH=1700000000 -t lop-nur-twin:pinned .
```

With `SOURCE_DATE_EPOCH` set, `model-manifest.json` inside the image is
byte-for-byte reproducible from the same commit.

Before using this image anywhere that requires a verified supply chain, pin
both base images to digests (`node@sha256:…`,
`nginxinc/nginx-unprivileged@sha256:…`) rather than to version tags.

### Behind a reverse proxy or TLS terminator

The container serves plain HTTP on 8080 and sets every security header except
`Strict-Transport-Security`, which belongs to whatever terminates TLS. Add it
there, and make sure the proxy does not strip the Content-Security-Policy.

## Kubernetes

Not required, and not recommended for a static site — see
`docs/FUTURE_BACKEND.md`. If an agency platform already runs Kubernetes, the
image is the deployment unit: a Deployment with a non-root `securityContext`
(uid 101), `readOnlyRootFilesystem` where the nginx temp paths allow it,
resource limits, a readiness and liveness probe on `/healthz`, and an Ingress
that preserves the security headers.

## Verifying a deployment matches a commit

```sh
# On the deployment
curl -s https://<deployment>/model-manifest.json | grep -E 'geometryHash|evidenceLedgerHash'

# Locally, at the commit you expect
git checkout <commit> && npm ci && npm run manifest
grep -E 'geometryHash|evidenceLedgerHash' public/model-manifest.json
```

The hashes are pure functions of the committed model data — independent of the
build machine, the runtime and the timestamp — so a mismatch means the
deployment is not that commit.

## Local verification before deploying

```sh
npm run build
npm run preview &        # http://localhost:4173, with the deployed headers
npm run a11y             # axe-core + CSP violations across /, /play, /analysis
```

`vite.config.ts` sets the same headers on the preview server, so a
Content-Security-Policy that would break production fails here first.
