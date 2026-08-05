# Government evaluation guide

**Lop Nur Geospatial Simulation Testbed**

This document is for a government innovation, GEOINT, OSINT, digital-engineering
or modelling-and-simulation team deciding whether this repository is worth an
hour of their time, and what it can and cannot be used for.

## 1. What this is

- An **unclassified public-source research prototype**. Every input is an
  openly published Earth-observation product, a public dataset, or cited open
  reporting.
- A **digital-engineering and geospatial-visualisation demonstration**: one
  metric layout drives a 3D reconstruction, a 2D minimap, a measurement tool,
  an accessible analysis table, and an interactive simulation, from a single
  source of truth.
- An **evidence-provenance experiment**: every analytical claim carries a
  classification, a confidence rank, a citation with access date, and a stated
  uncertainty where one is documented — enforced by a validator that fails the
  build.

## 2. What this is explicitly not

State these to anyone who asks, and do not let a demonstration imply otherwise:

- **Not operational intelligence.** It produces no assessment of activity,
  capability or intent, and confers no capability that the cited public imagery
  does not already provide.
- **Not a targeting system.** It supports no targeting workflow, holds no
  target data, and its coordinates are approximate modeled positions, not
  survey-grade control.
- **Not government-certified** in any respect.
- **Not approved for classified information.**
- **Not approved for Controlled Unclassified Information.**
- **Not FedRAMP authorized.** No FedRAMP process has been started.
- **Not CMMC certified.** No CMMC assessment has been performed.
- **Not an accredited government information system.** It has no ATO, no
  system security plan, no control baseline and no continuous-monitoring
  programme.
- **Not a survey product.** Modeled runway endpoints carry ~40 m of
  uncertainty; terrain is a procedural proxy, not a DEM reconstruction.
- **Not authenticated.** There is no login, and — deliberately — no simulated
  access control that could be mistaken for one.

The release manifest publishes this as machine-readable fact:

```json
"assurance": {
  "governmentCertified": false,
  "fedrampAuthorized": false,
  "cmmcCertified": false,
  "approvedForClassifiedInformation": false,
  "approvedForControlledUnclassifiedInformation": false,
  "operationalIntelligenceProduct": false
}
```

## 3. Evaluation areas

| Area | What to look at | Where |
| :-- | :-- | :-- |
| **Public-source geospatial reconstruction** | A 6.8 km frame registered to EPSG:32645, built from a pinned Sentinel-2 scene and cited reporting, with runway length and grid bearing validated against documented figures on every build | `src/lib/layout.ts`, `scripts/validate-data.ts` |
| **Evidence provenance** | A four-way classification, 0–1 ordinal confidence, per-claim citation with publication and access dates, and a build that fails when interpretation is dressed as observation | `src/lib/evidence.ts`, `src/lib/evidenceValidation.ts` |
| **Spatial visualisation** | Procedural terrain and structures, a custom GLSL post stack, a four-tier adaptive quality ladder, log-depth handling across a 26 km camera range | `src/components/scene/`, `src/gfx/` |
| **Digital twins** | One layout file projected into scene, minimap, index, measurement ruler, analysis table and a physics collision world baked from the rendered scene graph | `src/lib/layout.ts` → everything |
| **Scenario simulation** | Collision, ballistics with per-material penetration, bot AI with shared contacts, procedural animation with two-bone IK, fully synthesised audio | `src/game/` |
| **Human-computer interaction** | Three camera modes, touch controls, a measurement ruler with vertex snapping and clipboard export, dossier-to-table deep links in both directions | `src/components/hud/`, `/analysis` |
| **Game-engine techniques in analytical environments** | The same geometry serving analysis and simulation, and what that costs and buys | `docs/SYSTEM_ARCHITECTURE.md` §7 |
| **Reproducibility** | Deterministic seeded generation, canonical-JSON SHA-256 hashes, `SOURCE_DATE_EPOCH` support, byte-identical output under two runtimes | `scripts/generate-manifest.ts` |
| **Data lineage** | Derived ledger, single source register, reviewable source updates, no runtime data dependency | `docs/DATA_PROVENANCE.md` |
| **Accessibility** | A genuine non-3D route, automated axe testing on the production build, and an honest list of untested manual checks | `/analysis`, `docs/ACCESSIBILITY.md` |
| **Security posture for a public demo** | CSP verified against the real build, validated URL parameters, no storage, no secrets, supply-chain scanning in CI | `docs/THREAT_MODEL.md`, `SECURITY.md` |

## 4. A 30-minute evaluation path

```sh
git clone https://github.com/topherchris420/lop-nur-twin && cd lop-nur-twin
npm ci                    # or: bun install --frozen-lockfile
npm run validate:data     # data + geodesy + evidence gate
npm run test:evidence     # proves the validator rejects bad records
npm run manifest          # writes public/model-manifest.json
npm run build             # validate → manifest → bundle → strict typecheck
npm run preview           # http://localhost:4173
```

Then:

1. Open **`/analysis`** first. It is the fastest way to see what the model
   claims and how well each claim is supported. Filter by evidence status;
   notice how much of the site is `interpreted` or `illustrative`.
2. Open **`/`** and click a structure. Compare its dossier to the table row.
   Press `R` for sources, limitations and the manifest; press `M` and measure
   the runway against the documented 5 000 m at 046°.
3. Open **`/play`** to see the same geometry as a simulation, with its
   permanent "illustrative — not operational data" banner.
4. Download `/model-manifest.json` and compare its hashes with a local
   `SOURCE_DATE_EPOCH=1700000000 npm run manifest`.
5. Try to break the evidence rules: change a structure's status to `observed`
   in `src/lib/layout.ts` and run `npm run validate:data`.

## 5. What would need to happen before an agency pilot

This prototype is not a system of record and should not be treated as a
candidate for one without the work in `docs/FUTURE_BACKEND.md`. Minimum:

- Authentication and authorisation through an agency identity provider
  (OIDC, CAC/PIV), with real role-based access control.
- A server-side evidence service with immutable audit logging.
- Hosting inside an accredited boundary, with a system security plan, a control
  baseline, continuous monitoring and an ATO.
- GitHub Actions pinned to commit digests, and signed, attested build artifacts.
- A formal accessibility audit if a conformance statement is required.
- A data-governance decision about what may be modeled at all, and by whom.

## 6. Provenance and honesty commitments

- No fabricated sources, dates, hashes, measurements or confidence values. Where
  a value is unknown it is marked unknown or omitted.
- No claim of classified access, government affiliation, operational authority
  or confirmed facility function. The project holds none of those things.
- Interpretation and observation are separated in the data model, enforced by
  the validator, and displayed distinctly in every view.
- Errors are expected and correctable in the open: the model is a falsifiable
  hypothesis about a place, and a wrong wall should produce a pull request.

## 7. Licensing

Original source code, procedural models and documentation are Apache 2.0.
Third-party data, reporting, trademarks and referenced materials remain subject
to their own licences and terms — including the Copernicus and NASA POWER
attributions recorded in the source register. The Apache licence grants no
right to use the Vers3Dynamics name or branding except to identify the origin
of the project.

## 8. Points of contact

Security reports: see `SECURITY.md` — use GitHub private vulnerability
reporting. This document deliberately publishes no email address that has not
been configured by the maintainer.
