# Getting started

Everything needed to run the project locally, from the base app to the optional
parts. The base app needs no account, no environment file and no model server.
Running it starts a local experience: it does not start, touch or replace either
hosted fly.

## Run the app

Use **Node.js 22.18+** and **Bun 1.3+**. CI installs from `bun.lock`.

```sh
git clone https://github.com/topherchris420/lop-nur-twin.git
cd lop-nur-twin
bun install --frozen-lockfile
bun run dev
```

Open **[localhost:5173](http://localhost:5173)**.

**With npm instead,** after cloning and entering the repository:

```sh
npm ci
npm run dev
```

Individual scripts, including `npm run build`, work with Node. The aggregate
`check` script invokes Bun internally, so it still requires Bun.

**A production build and local preview,** with the deployed security headers:

```sh
bun run build
bun run preview
```

Open **[localhost:4173](http://localhost:4173)**.

## Run a recorded experiment, no model required

```sh
npm run rain:scientific:demo -- --dir .rain-research/readme-demo
```

This fixture uses a **scripted designer and scripted operator**, runs a numerical
simulation, and keeps its artifacts in `.rain-research/readme-demo`. Use a fresh
directory for each run. Fixture authorization covers this demonstration only; it
is not a finding.

## Check it

```sh
bun run check  # formatting, lint, unit tests, evidence tests, and build
```

`bun run build` is the integration gate: it validates the data and the Bethesda
and lab artifacts, generates and checks the release manifest, bundles the app,
runs strict TypeScript checks and scans `dist/` for credentials. The other
suites and their prerequisites are in [VALIDATION.md](VALIDATION.md) and
[CONTRIBUTING.md](../CONTRIBUTING.md).

| Command                                               | Purpose                                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------------------------ |
| `bun run rain:conformance`                            | Exercise lab drafts and submissions through the research registry.             |
| `bun run rain:scientific:verify`                      | Recheck archived journals, numerical replay, graphs, and learning evaluations. |
| `bun run rain:fly:verify`                             | Check archived fly records and replay compatible runs.                         |
| `bun run bethesda:life:smoke`                         | Exercise a short headless city-and-fly run.                                    |
| `bun run rain:civilization:verify`                    | Recheck the civilization archive; build Noeterra first.                        |
| `bun run noeterra:test`                               | Run the Rust engine's tests.                                                   |
| `bun run a11y` / `bun run routes`                     | Check accessibility, security headers, deep links, and URL handling.           |
| `bun run verify:bethesda` / `bun run verify:rain-lab` | Exercise the hidden city and lab end to end.                                   |

Browser checks have server prerequisites; see [CONTRIBUTING.md](../CONTRIBUTING.md).
Noeterra backend tests skip when its engine is absent. Fly archive verification
reports older-engine records separately and exits with code `3` if incompatible
records remain unchecked.

## Optional capabilities

| Capability                       | Additional requirement                                                 |
| -------------------------------- | ---------------------------------------------------------------------- |
| Noeterra in the browser          | Rust stable and a local WebAssembly build.                             |
| Model-assisted research          | A configured local model server and reviewed experiment authorization. |
| Model-controlled Blacksite seats | The selected provider's server-side configuration.                     |
| A persistent Bethesda individual | A separately operated headless service, durable storage, and backups.  |

Optional settings live in [`.env.example`](../.env.example). For local
development, copy it to the git-ignored `.env.local` and set only what you need.
Provider keys stay server-side; never prefix them with `VITE_`. Optional
`/play?brain=jev|glide|llm` seats require their own provider configuration and
show `UNAVAILABLE` when it is missing.

To host a persistent Bethesda individual of your own, follow the
[service, backup, and recovery guide](BETHESDA_CONTINUOUS_LIFE.md). It is a new
individual with a birth of its own, never a copy of ECHO.

### Build Noeterra's civilization engine

Install [Rust stable](https://rustup.rs), then build the engine **before starting
or restarting the dev server**:

```sh
rustup target add wasm32-unknown-unknown
bun run noeterra:wasm
bun run dev
```

Open **[localhost:5173/noeterra](http://localhost:5173/noeterra)**. Without the
build, the rest of the site works and Noeterra reports its engine as unavailable.
Its browser core runs in Rust/WebAssembly; public seats use human, rule-based, or
random control.

The separate local workbench supports optional model rulers:
`bun run noeterra:serve`, then **[127.0.0.1:7878](http://127.0.0.1:7878)**.
[Noeterra guide](NOETERRA.md).

### Connect LM Studio for model-assisted research

Start LM Studio's server at `http://127.0.0.1:1234` and load a model. Replace
`your-loaded-model-id` with its exact identifier from `/v1/models`. Stop the
existing dev server before restarting it with these settings.

**macOS / Linux**

```sh
export RAIN_AUTONOMY_ENABLED=true
export RAIN_MODEL_PROVIDER=lmstudio
export RAIN_MODEL=your-loaded-model-id
npm run dev
```

**Windows PowerShell**

```powershell
$env:RAIN_AUTONOMY_ENABLED = "true"
$env:RAIN_MODEL_PROVIDER = "lmstudio"
$env:RAIN_MODEL = "your-loaded-model-id"
npm run dev
```

Enter Bethesda and open the discovery workbench. Enabling the service does not
authorize an experiment: review its plan or bounded charter before execution.
The hosted site's server-side runtime cannot reach a model on your computer.

[Model-generated meetings](RAIN_LAB_BETHESDA.md#model-meetings-qwen-or-another-local-model)
have separate settings. The [autonomous research CLI](RAIN_LAB_BETHESDA.md#autonomous-research)
also supports Ollama. Failed calls remain in the journal; there is no silent
switch to a remote model.
