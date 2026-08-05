# Security policy

The Lop Nur Geospatial Simulation Testbed is an unclassified, public-source
research prototype that runs entirely in a browser. It holds no user accounts,
no personal data, no credentials and no non-public information. That shapes
everything below: the realistic risks here are supply-chain compromise of the
build, a cross-site scripting bug in a citation, and — the one specific to this
project — a viewer mistaking modeled interpretation for verified intelligence.

## Supported versions

| Version                                                         | Supported |
| :-------------------------------------------------------------- | :-------- |
| `main` (latest commit) and the current deployment built from it | Yes       |
| Any earlier commit, tag, fork or vendored copy                  | No        |

This is a single-branch research prototype. There is no long-term support
branch and no backport process: fixes land on `main`, and a deployment is
updated by rebuilding from `main`. If you are evaluating a specific build,
identify it by the `geometryHash` and `evidenceLedgerHash` in
`/model-manifest.json` rather than by a version number.

## Reporting a vulnerability

**Do not open a public issue for an unpatched vulnerability.** A public issue
is a disclosure, and this repository has no embargo mechanism.

Report privately, in this order of preference:

1. **GitHub private vulnerability reporting.** If it is enabled on this
   repository, use the _Report a vulnerability_ button under the **Security**
   tab. This is the preferred channel and requires no email address.
2. **A private security advisory draft**, if you have permission to create one.
3. **The maintainer's configured security contact.** If neither of the above is
   available, the repository has not yet published one.

> **Maintainer action required.** This file deliberately does not invent an
> email address. Enable GitHub private vulnerability reporting
> (_Settings → Code security and analysis → Private vulnerability reporting_),
> and if you want an email channel as well, add it here yourself. An
> unmonitored address in a security policy is worse than no address.

Please include: what you found, the commit or deployment URL, reproduction
steps, and what an attacker gains. If a proof of concept touches a third-party
service, describe it rather than running it.

**What to expect.** This is a small research project maintained on a
best-effort basis. There is no staffed response team, no service-level
agreement, and no bug bounty. Reports are triaged when the maintainer is
available. Nothing in this document creates a contractual obligation, and no
statement here should be read as a government or third-party certification of
any kind.

## What is in scope

- Cross-site scripting or content injection in the application, including
  through source metadata, citation URLs or query parameters.
- Anything that lets an attacker-supplied URL execute code in the page's
  origin, escape the Content-Security-Policy, or read another origin's data.
- Supply-chain issues: a compromised dependency, a malicious build script, a
  workflow that leaks a token or executes untrusted pull-request code with
  elevated permissions.
- Bugs in the build, validation or manifest pipeline that let unvalidated data
  or an incorrect hash ship as if it had passed.
- Deployment configuration that weakens the shipped security headers.

## What is out of scope

- Denial of service by loading the 3D scene on constrained hardware, or by
  requesting a large number of pages. This is a static site; capacity is the
  host's concern.
- Disagreements about the _content_ of the model — a wrong footprint, a
  questionable interpretation, a stale source. Those are correctness issues:
  open a normal issue or a pull request. They are the point of the project.
- Findings that require a compromised browser, a malicious extension, or
  physical access to the viewer's machine.
- Missing hardening that has no exploit path (for example, the absence of a
  header that this application's threat model does not need).

## Dependency policy

- Dependencies are installed from a committed lockfile. `npm ci` and
  `bun install --frozen-lockfile` are the only supported install paths in CI
  and in the container build, so a build cannot silently resolve a different
  tree.
- Dependabot proposes grouped updates weekly and security updates as soon as an
  advisory is published (`.github/dependabot.yml`).
- Every pull request runs `npm audit --omit=dev --audit-level=high`, a Trivy
  vulnerability and secret scan, GitHub dependency review, and CodeQL static
  analysis. A high or critical advisory with a fix available blocks the merge.
  Dependency review depends on the repository's dependency graph remaining
  enabled (_Settings → Code security and analysis_); if it is ever turned off
  the check reports "not supported on this repository", and the fix is the
  setting, not muting the check.
- An SBOM is generated per run in both CycloneDX JSON and SPDX JSON and
  attached to the workflow run.
- Runtime dependencies are kept deliberately small, and nothing is fetched from
  a CDN at runtime. Drei helpers that download assets are prohibited by
  `AGENTS.md`, which keeps the deployed page free of third-party origins.

## Secret handling

- **This repository contains no secrets, and no part of the application needs
  one.** It is a static client-side build; there is no server, no API key, and
  no authentication.
- Anything placed in a frontend build is public. Never add a credential to
  `.env`, `vite.config.ts`, a data file, or any module under `src/` — Vite
  inlines `VITE_`-prefixed values into the bundle, where any visitor can read
  them.
- CI references no user-defined repository secret. The one token it uses is
  `secrets.GITHUB_TOKEN`, minted per run and scoped read-only by each job's
  `permissions` block, because Gitleaks needs it to read a pull request —
  and GitHub issues a read-only token to fork pull requests regardless. No
  pull-request workflow is granted write permissions, so a malicious pull
  request cannot exfiltrate anything by editing a workflow.
- Gitleaks scans full history on every run, so a credential committed by
  mistake is caught rather than quietly living in the log.
- If a secret is ever committed: rotate it first, then remove it from history.
  Rotation is the fix; history rewriting is cleanup.

## Security limitations of a browser-hosted public demonstration

State these plainly to anyone evaluating this project:

- **There is no access control.** Every route, every structure, every evidence
  record and the whole simulation are public to anyone with the URL. The
  application performs no authentication or authorisation, and it contains no
  simulated login that could be mistaken for one.
- **All data ships to the client.** The evidence ledger, the geometry and the
  manifest are in the bundle. Nothing can be hidden from a viewer by the UI.
- **The browser is the trust boundary.** A compromised browser, a hostile
  extension, or a machine-in-the-middle on a plain-HTTP deployment sees and can
  alter everything the page does. Always serve over HTTPS.
- **The Content-Security-Policy requires `style-src 'unsafe-inline'`** because
  the framework sets inline styles at runtime. Script execution is restricted
  to same-origin files; inline scripts are blocked. See
  `docs/THREAT_MODEL.md` for what this does and does not mitigate.
- **One opt-in third-party request exists**: `?liveTraffic=1` fetches a public
  ADS-B feed. It is off by default; without it the application makes no
  cross-origin request at all. Remove `https://api.adsb.lol` from the
  Content-Security-Policy to forbid it entirely.
- **This system is not accredited.** It is not FedRAMP authorized, not CMMC
  certified, not government-certified, and not approved for classified
  information or Controlled Unclassified Information. Do not place non-public
  data into it, into a fork of it, or into any deployment of it.
