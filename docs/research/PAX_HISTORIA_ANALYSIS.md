# Pax Historia: public-surface technical analysis

Date of investigation: 2026-10-12. Scope: public, unauthenticated material only.
I did not sign in, create an account, start a game, issue any AI turn, call any
`/api/*` endpoint, or query Firestore directly. The in-game client (`/games`)
redirects anonymous visitors to `/`, so the code that actually runs a game was
**not** observed. What follows is reconstructed from the marketing/preset pages,
the JavaScript those pages ship to every visitor, the public wiki, and press.

Labels:

- **VERIFIED**: directly observed, with the source given.
- **INFERRED**: my reasoning from verified facts. Treat these as hypotheses.

Raw captures are in `pax-capture\` (landing HTML, 45
public JS/CSS chunks, sitemap, preset pages). A REA `analyze_web_bundle` run
over 51 scripts on the root page (evidence id
`ev_d01b05ff2776cdb3bdc060f871064429e4a7e990ddb78f3f219688fbeb610901`) parsed
everything with 0 failures.

---

## 1. Identity and scale

| Claim                                                                                                               | Status                      | Source                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Canonical host is `www.paxhistoria.co`. `paxhistoria.com` and the apex 308-redirect there.                          | VERIFIED                    | `curl -I`                                                                                                                                                                    |
| Founders Eli Bullock-Papa and Ryan Zhang, YC W2026, started at a hackathon                                          | VERIFIED                    | [OpenRouter customer story](https://openrouter.ai/customers/paxhistoria), [YC launch](https://www.ycombinator.com/launches/PMu-pax-historia-user-ai-powered-gaming-platform) |
| ~35k daily players, ~4.87M requests/month via OpenRouter, >100B tokens in one week, >4k presets with 50+ plays each | VERIFIED (self-reported)    | same                                                                                                                                                                         |
| Sitemap lists **51,443** public preset URLs                                                                         | VERIFIED                    | `https://paxhistoria.co/sitemap.xml`                                                                                                                                         |
| Unity mobile client in development                                                                                  | VERIFIED (hiring and press) | YC launch, [startuphub review](https://www.startuphub.ai/news/pax-historia-review-ai-grand-strategy-game)                                                                    |

## 2. Tech stack

| Component                                                                                    | Status                                                          | Evidence                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Next.js App Router, React Server Components, Turbopack build                                 | VERIFIED                                                        | `/_next/static/immutable/chunks/turbopack-*.js`; `Vary: rsc, next-router-state-tree`; REA vendor fingerprint "Next.js" (high)                                                                                            |
| Hosted on Vercel (iad1), Vercel Speed Insights                                               | VERIFIED                                                        | `Server: Vercel`, `X-Vercel-Id: iad1::…`, `/_vercel/speed-insights/script.js`                                                                                                                                            |
| Firebase Auth (Google sign-in) plus Firestore client SDK with local persistence              | VERIFIED                                                        | CSP `frame-src https://*.firebaseapp.com`; bundle strings `firebaseLocalStorageDb`, Firestore `enablePersistence()` warning, `memoryLocalCache`                                                                          |
| Session cookies issued by its own API (`/api/auth/sign-in`, `/refresh-session`, `/sign-out`) | VERIFIED                                                        | REA endpoint extraction                                                                                                                                                                                                  |
| Firestore auto-IDs as preset keys (20-char, e.g. `MvyhIBRkEZBWeIYH4n4R`)                     | VERIFIED (ID shape) / INFERRED (that presets live in Firestore) | sitemap, preset URLs                                                                                                                                                                                                     |
| Preset assets on a separate CDN host `preset-assets.paxhistoria.co`                          | VERIFIED                                                        | `og:image` on preset page                                                                                                                                                                                                |
| Stripe Checkout and Customer Portal for tokens and subscription                              | VERIFIED                                                        | `/api/tokens/create-checkout-session`, `/api/subscription/create-checkout-session`, `/api/subscription/create-portal-session`                                                                                            |
| Statsig feature flags                                                                        | VERIFIED                                                        | `x-statsig-region` header read in bundle                                                                                                                                                                                 |
| reCAPTCHA Enterprise (invisible) on public pages                                             | VERIFIED                                                        | `<script src=…recaptcha/enterprise.js>`, iframe target                                                                                                                                                                   |
| BetterStack logging/status (`status.paxhistoria.co`)                                         | VERIFIED                                                        | CSP `script-src`/`frame-src`                                                                                                                                                                                             |
| Service worker (`/sw.js`) and Web Push                                                       | VERIFIED                                                        | CDP target list; `/api/notifications/push/subscribe`                                                                                                                                                                     |
| Three.js `WebGLRenderer` in shipped bundles (34 references)                                  | VERIFIED                                                        | static grep                                                                                                                                                                                                              |
| Experimental "3D Globe" map view                                                             | VERIFIED                                                        | [wiki: Gameplay Map](https://wiki.paxhistoria.co/wiki/Gameplay_Map)                                                                                                                                                      |
| Map editor uses Leaflet with SVG overlays                                                    | Third-party claim, unconfirmed                                  | [Claude's Corner article](https://www.startuphub.ai/ai-news/claudes-corner/2026/claudes-corner-pax-historia-yc-w2026). I found no Leaflet code in the public chunks, but the editor and game chunks were not observable. |
| INFERRED: the 2D map and the 3D globe are both WebGL (Three.js), not Leaflet.                | INFERRED                                                        | Three.js ships on public pages and a globe needs WebGL. Leaflet may still be in gated chunks.                                                                                                                            |

## 3. LLM layer (the most informative find)

The public bundle includes a large, shared model-capability registry. It looks
like a module shared with the server: it references `process.env.VERTEX_PROJECT_ID`
and a probe script path `scripts/probe-kimi-k3-reasoning.ts`.

### 3.1 Task-specific prompt slots (VERIFIED, bundle)

Every "model pack" maps **12 distinct LLM tasks** to a model and a thinking level:

```
descriptionToAction, chatWithUser, chatWithAdvisor, jumpForward,
autoJumpForward, actions, nextSpeaker, eventConsolidator,
catalystCreation, catalystRunner, catalystSummarizer, gameMaster
```

These collapse into three user-facing "live slots": `utility`, `game` and
`advisor`. Users can build a custom pack with a `{utility, game, advisor}` slot
map. `MAX_CUSTOM_MODEL_PACK_DOLLAR_SIGNS = 5`.

Interpretation of each slot (names VERIFIED, roles INFERRED from names and
public gameplay descriptions):

| Slot                                                         | Likely role                                                                                                                                                                         |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `descriptionToAction`                                        | Turns a player's free text into a structured action (normalise, validate)                                                                                                           |
| `actions`                                                    | Resolves or generates AI polities' actions                                                                                                                                          |
| `jumpForward` / `autoJumpForward`                            | The world-advance step: given state, orders and a time span, produce events and map changes. "auto" is probably AI-only advancement without player orders, or a scheduled jump      |
| `eventConsolidator`                                          | Merges or deduplicates the events from a round into a coherent report. This is a de-facto **memory compaction** step                                                                |
| `catalystCreation` / `catalystRunner` / `catalystSummarizer` | A persistent "catalyst" subsystem: long-running storylines or processes (wars, crises, movements) created once, advanced each round, and summarised to bound context                |
| `chatWithUser`                                               | Diplomacy chat in character as a foreign leader                                                                                                                                     |
| `nextSpeaker`                                                | Picks who speaks next in a **multi-party** chat. It is always routed to the cheapest model (e.g. `gemini-2.5-flash-lite`, thinking off), which suggests a small classification call |
| `chatWithAdvisor`                                            | The advisor. It has an optional tool `advisorCharts`, and production evidence strings mention "nine-chart" auto-shaped outputs, so the advisor can emit charts through tool calls   |
| `gameMaster`                                                 | Probably an arbiter or "cheats" console call, or a rules-enforcement pass                                                                                                           |

### 3.2 Default packs (VERIFIED, bundle)

| Pack         | $ signs | Main model                                                            | Notes                   |
| ------------ | ------- | --------------------------------------------------------------------- | ----------------------- |
| Light        | 1       | `alibaba/qwen3.5-plus`                                                | "Fast & affordable"     |
| Pro          | 2       | `google/gemini-3-flash-preview` (thinking low)                        | "Balanced"              |
| Max          | 4       | `anthropic/claude-sonnet-4.6` (thinking low)                          | "Premium and expensive" |
| Patron       | 0       | `canopywave/pax-model-02` or `chutes/default`                         | Subscriber-only         |
| Experimental | 0–2     | e.g. `xiaomi/mimo-v2.5-pro`, `nvidia/nemotron-3-ultra-550b-a55b:free` |                         |

In one mixed pack, `nextSpeaker` uses `gemini-2.5-flash-lite`, the catalyst
tasks use `gemini-2.5-flash`, and the game and consolidator tasks use
`gemini-3-flash-preview`. **Tasks are routed to models of different cost**
(VERIFIED).

### 3.3 Providers and routing (VERIFIED, bundle)

- Each model entry has `aiProviderPriority`, an ordered fallback list over
  providers: `oneRouter`, `openRouter`, `aiStudio`, `vertexai`, `openai`,
  `anthropic`, `alibaba`, `zhipu`, `chutes`, `bytedance`, `canopywave`. The
  most common order is `["openai","openRouter"]` (37 entries).
- `providerModelIds` maps one canonical model ID to each provider's slug.
- Per-model metadata includes `inputPrice`, `outputPrice`, `cacheStoragePrice`,
  `contextWindow`/`contextWindowTokens`, `maxOutputTokens`, `tokenizer`,
  `lifecycle.introducedAt`, `allowedResources:[{kind:"pax_tokens"}]` and
  `endpointRegion` (e.g. `"china"`).
- A **capability matrix** per model and provider:
  `constrainedDecoding.{structuredOutputNoThinking, forcedToolCallingNoThinking,
structuredOutputWhenThinking, forcedToolCallingWhenThinking}` with values like
  `grammar_bound`, `syntax_only`, `advisory_only`, `emulated_only`, and
  `reasoningContinuation.{format, toolLoop, completedTurns}`. Thinking levels
  map to provider-specific wire dialects (Anthropic `budget_tokens`/adaptive,
  Gemini thinking, OpenAI reasoning effort).
- **Prompt-cache probing**: entries carry measured evidence such as
  "Identical ~6.7k-token prefix read N cached tokens on both repeat rounds". The
  team empirically tests implicit prefix caching per provider. INFERRED: game
  prompts keep a stable prefix (rules plus scenario) so repeat rounds hit the cache.
- **Fine-tuned scenario models** on Vertex AI:
  `vertexai/ww2-jump-forward-v1-{flash,light,pro}` and
  `vertexai/three-kingdoms-jump-forward-v1{,-LIGHT}` (light priced $0.075/$0.30
  per M). So Pax trains **scenario-specific jump-forward models**, and
  `canopywave/pax-model-02` is a house model.
- 28+ selectable models with automatic provider fallback (VERIFIED,
  [OpenRouter story](https://openrouter.ai/customers/paxhistoria)).

## 4. Game loop

| Element                                                                                                                                                                                                        | Status                                            | Source                                                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Pick a preset and a polity, write actions in plain language, "jump forward", read an AI-written report, see the map update                                                                                     | VERIFIED                                          | YC launch, startuphub review, wiki                                                   |
| Jump size from 1 week to 1 year                                                                                                                                                                                | VERIFIED (press)                                  | startuphub review, Habr                                                              |
| Free-form chat with heads of state, generals and advisors; treaties, ultimatums, intelligence                                                                                                                  | VERIFIED (press)                                  | startuphub review                                                                    |
| No tech trees, sliders or scripted event chains; all consequences are generated                                                                                                                                | VERIFIED (press)                                  | startuphub review                                                                    |
| Sim Rules are "parsed every turn, before generating that round's events"; not deterministic; the AI may ignore them                                                                                            | VERIFIED                                          | [wiki: Simulation Rules](https://wiki.paxhistoria.co/wiki/Simulation_Rules)          |
| Battalions are created through actions; moving one into an enemy region attacks it, and success transfers ownership                                                                                            | VERIFIED                                          | wiki: Gameplay Map                                                                   |
| Region transfers through treaties, occupation, trade or new-state birth (rebellion)                                                                                                                            | VERIFIED                                          | wiki: Gameplay Map                                                                   |
| INFERRED round pipeline: `descriptionToAction`, then the polities' `actions`, then `jumpForward` (events plus map deltas), `catalystRunner` per active catalyst, `eventConsolidator`, and `catalystSummarizer` | INFERRED                                          | slot names and their order in array `ix`                                             |
| A 2026 article states every action POSTs the full world state to `/api/simple-chat`                                                                                                                            | Third-party claim, unconfirmed, possibly outdated | Claude's Corner article. That endpoint does not appear in the current public bundle. |

## 5. Scenario (preset) format

VERIFIED from a live preset page ("Afton's America") and the [wiki: Preset](https://wiki.paxhistoria.co/wiki/Preset):

- **Description**, labelled in the UI "not seen by the AI".
- **Starting Timeline**: "background and key events before the starting date.
  Helps players and the AI understand the starting world state." In practice
  this is a long free-text world bible (leaders, ideologies, factions, conflicts,
  even a year-by-year "canon timeline").
- **Simulation Rules**: "constraints and guidelines for the AI". Free text such
  as "During warfare, countries can only take regions that they border, except
  naval invasion" and "Territories should never become unowned during a war".
- **Start date**, genre tags ("Historical Fiction", "Modern Day").
- **Gameplay Map**: dimensions (multiple maps per preset), basemaps, regions
  typed `land`/`coastal`/`ocean`/`strait` (custom types allowed), and map
  features (nodes) tagged `battalion`, `city` or `capital`. City features are
  "invisible to the AI".
- **Polities**: name, alternate names, flag, tags (e.g. NATO), colour, owned
  regions, and "recommended polities" with image and description.
- **Versions** (`?versionID=4`), **Copies** (fork), Plays, Rounds, Favorites,
  Comments, **Sponsor**, and "Similar Presets".
- Creator economics: 10% of eligible tokens spent on presets with more than 150
  authored rounds; Patron "Creator Reward Tokens" can be donated to presets (wiki).

INFERRED: the rules and heads-of-state lists live **only in prose**. The
simulation has no structured representation of leaders, ideology, alliances or
economy, so the model must re-read and re-interpret them every round. That
explains why preset authors write rules in capitals ("must NEVER, EVER be changed").

## 6. Memory and context management

- VERIFIED: dedicated `eventConsolidator` and `catalystSummarizer` tasks exist.
- VERIFIED: per-model implicit prompt-cache probing, and 1M-token context
  models preferred for several packs.
- VERIFIED (wiki): token cost scales with "number of game events…, chat length,
  number of map regions and map complexity, amount of simulation information".
  Context therefore grows with the game.
- VERIFIED (press): players report inconsistency in long campaigns.
- INFERRED: memory is prompt-resident, rolling summaries plus a raw recent
  window, with no retrieval index or structured fact store. The context cost and
  long-game drift fit this model.

## 7. Pricing

| Item                                                                                                                                                               | Status           | Source                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- | ------------------------------------------------------------------- |
| Daily free allowance up to $0.20 of tokens, resetting every 20 h, non-stacking; $1 signup bonus; guests $0.04 one-time                                             | VERIFIED         | [wiki: Token System](https://wiki.paxhistoria.co/wiki/Token_System) |
| Pax tokens are dollar-denominated credit, separate from model tokens                                                                                               | VERIFIED         | wiki: Pax Patron                                                    |
| Pax Patron: $0 first month, then $12/month; 300 free requests/day through Chutes **or** Canopy Wave (both in month 1); BYOK through OpenRouter or Google AI Studio | VERIFIED         | [wiki: Pax Patron](https://wiki.paxhistoria.co/wiki/Pax_Patron)     |
| Earlier press figures ("1 token/day, $1 per token") conflict with the wiki                                                                                         | Outdated         | startuphub review                                                   |
| Patron was temporarily frozen after Google lowered API limits                                                                                                      | VERIFIED (press) | [Habr](https://habr.com/ru/articles/993940)                         |
| "Pax Arena": $0.03 per completed voting response                                                                                                                   | VERIFIED (wiki)  | wiki: Token System                                                  |
| INFERRED: Arena is a pairwise human-preference collector, used to rank models and, given the fine-tuned jump-forward models, probably to build training data       | INFERRED         |                                                                     |

## 8. Weaknesses (observed or reported)

1. **Non-determinism and rule drift.** The wiki says Sim Rules may not be followed; press calls it "prompt engineering dressed up as grand strategy".
2. **No numeric substrate.** Armies, economy and diplomacy are prose; outcomes are "inferred, not computed".
3. **Context growth.** Cost grows with game length; long campaigns become inconsistent.
4. **The LLM owns the state.** Map deltas come from model output. INFERRED: invalid deltas (non-adjacent conquest, unowned regions) must be patched or prompted against, as the preset rules show.
5. **No replay or audit.** Nothing public indicates a seeded or replayable game.
6. **Cloud-only inference and cost pressure** (Patron freeze, daily caps).
7. **Choice overload** (28+ models) is partly mitigated by packs.

## 9. Not determined

- Exact prompts, the JSON schemas of jump-forward output, and how map deltas are applied or validated (server-side or gated chunks).
- Whether multiplayer exists. No realtime transport was seen in public chunks; my "ably" string match was a false positive ("reliably").
- Persistence layout for games (Firestore likely, unconfirmed).
