# Open Historia — Reverse-Engineering Report

**Subject:** `Open-Historia/open-historia`, shallow clone at commit `6d2dc33858c097cc7c936f5e7cb23223943ce106` (2026-10-11).
**License:** GNU AGPL-3.0-or-later (`LICENSE`, `package.json:4`). Note: third-party listings (AlternativeTo) describe it as MIT; the repository itself says AGPL-3.0. **Treat it as AGPL** — copying code into a differently licensed project would impose AGPL obligations. Everything below is a description of design, written for independent re-implementation; no code is reproduced beyond identifiers.
**Method:** static reading of `docs/` and `src/` only. No code from the clone was installed or executed (two `node -e` one-liners parsed `defaultPrompts.json` as data to list its keys).

Legend: **[V]** = verified in source/docs at the cited `file:line`; **[I]** = inference from structure, naming or documentation that was not traced end-to-end in code.

---

## 1. Architecture and dependencies

### 1.1 Shape of the system

- **[V]** Single React 19 SPA built with Vite 7; the world is rendered with MapLibre GL 5 + PMTiles vector tiles; the map editor uses OpenLayers 10 behind `?editor=1` (`docs/architecture.md:3`, `:13-23`; `package.json` deps).
- **[V]** The same client bundle runs against **three interchangeable `/api` backends**: a local Express 5 server (desktop download, `server/server.js`), an in-browser `fetch()` interceptor backed by IndexedDB (hosted web build, `src/runtime/web/router.js`), and an embedded nodejs-mobile server (Android/Capacitor) (`docs/architecture.md:29-37`, `:211-219`). The variant is chosen by a compile-time literal `VITE_OH_WEB` and dead-code elimination (`docs/architecture.md:41-50`).
- **[V]** Electron wrapper for desktop (`electron/main.cjs`, `package.json` `dist:*` scripts).
- **[V]** Key deps (`package.json`): `maplibre-gl`, `react-map-gl`, `pmtiles`/`ol-pmtiles`, `ol`, `@turf/*`, `d3-geo`, `polygon-clipping`, `shpjs`, `geotiff` (GIS); `chart.js` (stats); `express` (server); `@noble/ed25519`/`@noble/hashes` (signed content manifests); `jszip` (scenario bundles); `react-markdown`.
- **[V]** Tests: `node --test "server/**/*.test.js" "src/**/*.test.js"` (`package.json` `test` script); 283 `*.test.js` files exist in the tree (counted with `find`).
- **[V]** There is **no game-engine language other than JavaScript** — no Rust, WASM or native simulation core. The "engine" is ~74k lines of JS under `src/Game/AI/` + `src/runtime/` (`wc -l`: `gameplay.js` alone is 16,640 lines; `gameState.js` 4,799; `gameplaySchemas.js` 3,717; `main.jsx` 3,454).

### 1.2 Data flow

- **[V]** The client never touches storage directly; every read/write is `/api/runtime/json/:key` (GET/PUT) or `/api/runtime/pmtiles/:key` (`docs/architecture.md:186-191`).
- **[V]** Write path: _AI turn / cheat / UI action → `gameState.js` write → PUT `/api/runtime/json/{world|game|events|…}` → store persists → library token bumps → caches swept → layers re-read_ (`docs/architecture.md:225-227`).
- **[V]** `/api/ai/relay` exists only to defeat CORS for the player's own OpenAI-compatible endpoint (`docs/architecture.md:204`); otherwise **the browser calls the AI provider directly with the player's key** (`docs/ai-overview.md:3`).

---

## 2. The turn loop: player order → AI referee → world update

### 2.1 The core abstraction: the "time skip" (a.k.a. jump)

- **[V]** The turn loop is a _time jump_: the AI returns a batch of `events`, each carrying machine-readable `impacts`, which `applyEventImpactsToWorld` folds into world state before persistence (`docs/world-state.md:3`).
- **[V]** Entry point `simulateTimelineJump({ days, mode, onEvents, onProgress, signal })` at `src/Game/AI/gameplay.js:14155`. It: takes a busy lock (`beginSimulation()`, `src/Game/AI/simulationStatus.js:23`), reads the whole bundle (`readGameStateBundle`, `src/runtime/gameState.js:4032`), refuses zero-day skips or a skip while an interactive scene is open, computes `originDate`/`targetDate`, builds template variables, counts queued player orders, and optionally **splits long jumps into segments** (`planJumpSegments`) (`gameplay.js:14155-14230`).
- **[V]** Segments are run by `runJumpSegments` (`gameplay.js:13120`), then `finishTimelineJump` (`gameplay.js:14017`) and `applySimulationResult` (`gameplay.js:7651`), which calls the pure `applyEventImpactsToWorld` (`gameplay.js:7862` → `src/runtime/gameState.js:4527`) and writes `actions`, `chats`, `events`, `game`, `colors`, `world` in one `Promise.all`, then captures a **rollback snapshot** (`captureRollbackSnapshot`, `gameplay.js:7348`; at most `MAX_ROLLBACK_SNAPSHOTS = 12`, `gameplay.js:7335`).
- **[V]** Player orders are free text stored in `actions.json`; `descriptionToAction` converts freeform text to a structured command (`docs/ai-prompts.md:301`); events list resolved order ids in `impacts.actionIds` (`docs/world-state.md` §5).
- **[V]** Since 2026-10 a skip is **one provider request** ("folded time skip"): each event must carry its own consequences (unit ops, territory ops, board ops), and agents' reports and the history-document fold ride at the end of the same answer (`docs/ai-overview.md`, "The folded time skip"). If a provider refuses the large folded contract, the game falls back to the lean contract plus a single "turn review" request that fences five jobs (unit director, territory director, timeline curator, Projects board, agents' reports) into one prompt (`gameplay.js:13773` `runTurnReview`; `:13018` `foldedTurnReview`).
- **[V]** The staged reveal (`src/Game/GameUI/time.jsx`) re-applies impacts event-by-event onto a base world and overrides the map so the player watches the map change as each event is revealed (`docs/world-state.md` §8). "Intervene" lets the player stop the reveal and discard unrevealed events (`docs/ai-overview.md` "Intervene").

### 2.2 The prompt that drives the world

- **[V]** The `jumpForward` task prompt (`src/Game/AI/defaultPrompts.json:61`) frames the model as the simulator of **every polity except the player's**: "The player runs one polity; YOU simulate the rest of the world." It instructs "Real History Is the Default": un-perturbed polities follow real history; divergence propagates outward from the player's changes.
- **[V]** Prompt assembly: `renderTemplate(promptPack.tasks[taskKey], vars)` + call-time directives (difficulty, language, map truth, reputation, world direction, GM reminders) (`docs/ai-overview.md` request-flow diagram; `docs/ai-prompts.md` §3, §6). Templates use `${PLACEHOLDER}` helpers that map to context builders (`defaultPrompts.json` `helpers.*`; `src/Game/AI/promptContext.js`).
- **[V]** Prompts are per-scenario/per-game editable ("Prompts" tab, `libraryBar.jsx` `PromptSectionEditor`, `docs/ai-prompts.md:7-25`).
- **[V]** Prompt sizes are large: a skip is ~47,000 tokens on the built-in scenario (`docs/ai-overview.md`, "The context preflight"); the advisor's system prompt ~100K characters (`docs/ai-overview.md`, "Conversations" table).

### 2.3 Task catalogue (all LLM calls)

**[V]** `defaultPrompts.json` `tasks` keys: `countryStatSheet, actions, autoJumpForward, interactiveCreation, interactiveExecutor, interactiveSummary, descriptionToAction, eventConsolidator, timelineCurator, unitDirector, gameMaster, jumpForward, nextSpeaker, pregameHistory, idleDiplomacy, spyIntercept, intelligenceAssessment, projects, territoryDirector, geographyResolver, chatActions`, plus root prompts `advisor` and `leader`.

---

## 3. World-state data model and persistence

### 3.1 Documents

**[V]** Five+ plain-JSON runtime documents per game (`docs/world-state.md` §1): `world` (mutable simulation), `game` (clock: `country, difficulty, gameDate, startDate, language, round` — `GAME_DEFAULTS`, `src/runtime/gameState.js:34`), `events` (timeline with impacts), `actions` (queued player orders), `chat` (diplomatic threads), plus `colors`, `flags`, `tags`, `prompts`, `snapshots`, custom geojson.

**[V]** `WORLD_DEFAULTS` at `src/runtime/gameState.js:43`; a single normalizer `normalizeWorldState` (`gameState.js:3497`) runs on **every** read and write, spreading defaults, rebuilding maps, clamping numbers and dropping blanks (`docs/world-state.md` §3).

### 3.2 Key world fields (all [V], `docs/world-state.md` §2)

- **Territory:** `regionOwnershipOverrides {regionId→owner}` (de-facto control, what the map paints), `regionSovereigntyOverrides` (legal sovereign when different — occupation), `regionClaimants {regionId→[≤4]}` (disputed, striped), `settledRegionClaims`, `groups` + `groupAreas` (non-state actors controlling regions).
- **Polities:** `polityOverrides` keyed **by name**; a rename re-keys everywhere and keeps `formerNames` (`server/polityRename.js`).
- **Identity/diplomacy scalars:** `internationalReputation {name→0..100}`, `countryTags {name→[]}`.
- **Canonical ledgers (engine-owned):** `wars[]` (`status ∈ active/ceasefire/ended`, `sideA/sideB`, `sourceEventIds`), `relations[]` (one row per unordered pair, `score −100..100`, banded status), `agreements[]` (alliance, mutual_defense, non_aggression, trade_economic, military_access, peace_settlement …), `storylines[]` (hidden persistent world processes with `pressure`, `momentum`, `nextReviewDate`).
- **Military:** `units[]` `{id,name,type∈{infantry,armor,air,naval,artillery,garrison},ownerCode,strength,lng,lat,regionId,status,posture…}`, `pendingUnitOrders[]` (standing `move`/`patrol` orders advanced by the engine each turn, `advanceStandingOrders`, `gameState.js:2730`), `markers[]` (built structures).
- **Information:** `reports[]` with `visibleTo` audience lists (documents only some governments hold), `chatKnowledgeCursors`, spy networks/intercepts.
- **Turn machinery:** `simulationHistory` (last ≤12 turns, each with an **application receipt** of what the engine dropped/changed), `consolidatedHistory`, `historyDocument` (a living ~1,500-word history), `gmChanges`, `simulationReminders`, `playerGoals`, `activeInteractive`, `interactiveOffer`.

### 3.3 The mutation vocabulary ("impacts")

**[V]** Every event may carry `impacts` whose arrays are **the only way the AI mutates world state**: `actionIds, createdChats, markerOps, polityChanges, projectOps, regionClaims, regionControlOps, regionTransfers, reports, spyOps, unitOps` (+ `groupOps`) (`docs/world-state.md` §5). Each array is independently normalized; invalid entries are dropped. `applyEventImpactsToWorld` (`gameState.js:4527`) is pure (`{colors, world, events} → {colors, world}`), order: transfers → polity changes → units → markers. `applyUnitOps` (`gameState.js:2723`) is pure; unknown ids silently ignored; units at strength ≤ 0 removed.
**[V]** A `basis` field on territorial changes (`treaty, annexation, unification, independence, occupation` move the map; `claim, threat, raid` do not — a `claim` becomes a dispute) (`docs/world-state.md` §5, `src/runtime/territoryBasis.js`).

### 3.4 Persistence and save format

- **[V]** Scenarios (immutable seeds) vs Games (live playthroughs that copy a scenario's `world.json` and mutate it) (`docs/world-state.md` "Games vs scenarios").
- **[V]** Desktop: JSON files under `server/data/` (`server/dataDir.js`, `server/libraryStore.js`). Web: IndexedDB. Scenario import/export as zip bundles (`/api/scenarios/:id/export`, `/api/scenarios/import`; `libraryStore.js:849` references games arriving "from a .zip").
- **[V]** Save writes `world` whole, never a shallow patch (`docs/world-state.md` §1).
- **[I]** There is no event-sourced log of state transitions for the world document itself (unlike chat threads, below); history is recoverable only through the 12 rollback snapshots and the events list with impacts.

---

## 4. AI layer

### 4.1 Provider abstraction

- **[V]** Providers: `gemini` (default), `openai`, `anthropic`, `openai-compatible`, `anthropic-compatible` (`docs/ai-overview.md` "Supported providers"; `src/Game/AI/providerConfig.js`). `callAI` at `src/Game/AI/main.jsx:2413`; `dispatchToProvider` at `main.jsx:2242`; `callOpenAICompatible` at `main.jsx:1715`.
- **[V]** **Local models:** "OpenAI Compatible" is the catch-all for Ollama, LM Studio, OpenRouter, vLLM; default endpoint `http://localhost:11434/v1` (`providerConfig.js:107`). For a local endpoint (loopback / `.local` / private IPv4), learned context-window limits are not remembered because the user can reload the model with a different context (`docs/ai-overview.md`, "A local server's window is a setting"; `localEndpoint.js`). A blank model on an openai-compatible endpoint triggers one `/models` discovery per session.
- **[V]** All AI config is in browser `localStorage`: `ai_connections`, `ai_fallback_list`, `ai_task_picks`, `ai_fallback_states` (`docs/ai-overview.md` "Configuration & storage keys").

### 4.2 Fallback list (ADR 0001/0002)

- **[V]** An ordered list of (Connection, model) entries; **every call starts at the top** and moves down only when an entry can't answer; Spent entries sink until reset, busy (502/503/504/529) entries sink for 10 min; **never round-robin** to multiply free quotas, on provider-terms grounds (`docs/adr/0001-fallback-never-rotation.md`; `src/Game/AI/fallbackRunner.js:204` `runWithFallback`).
- **[V]** Failure classification (`providerErrors.js` `classifyProviderFailure`): Spent / Unusable / Busy / Rate-limited / tooBig, each with distinct marking and retry policy. Retries: `retries = 3`, `retryDelay = 15000` ms (`main.jsx:950-951`), bounded by a deadline.
- **[V]** **Context preflight**: requests are sized (4 chars/token) and entries whose known window can't fit are skipped without a request (`contextWindow.js`).

### 4.3 Structured output

- **[V]** `runJsonTask` (`gameplay.js:3332`) is the schema-validated task harness: build system prompt → pick tool → `callAI` with a forced tool → parse (`toolInput ?? extractJsonPayload`, `jsonSalvage.js:483`) → `validateGameplayPayload` (`gameplaySchemas.js:3602`, a hand-rolled schema walker `validateAgainstSchema` at `:3201`) → task-specific `validatePayload` → up to 2 attempts → deterministic `fallback()`.
- **[V]** Forcing per provider: Gemini `functionCallingConfig.mode:"ANY"`; OpenAI `tool_choice:"required"` (string form because llama.cpp rejects the object form, `main.jsx:1270`); Anthropic `tool_choice:{type:"tool"}` (`docs/ai-overview.md` "Structured output modes").
- **[V]** **Structured-output ladder** for arbitrary gateways: `tool → json_schema → json_object → text_json` (`structuredMode.js:33`), stepping down on a 400/422 _or_ on a 200 that contains a planning monologue instead of a tool call (`looksLikeDeliberation`). `text_json` uses an `ANSWER_SENTINEL` marker before the payload.
- **[V]** **Salvage**: `salvageBySchema` (`schemaSalvage.js:109`) removes the smallest faulty piece (unknown field, one bad list item) rather than re-requesting; `repairLooseJson` tolerates JS-object syntax; think-block stripping. What salvage dropped is reported to the model in the next turn's **application receipt** (`src/runtime/applicationReceipt.js`).
- **[V]** **Lookup functions**: twenty read-only tools (`list_powers`, `region_info`, `border_between`, `path_between`, `relations_between`, `war_ledger`, `recent_events`, …) declared beside the output tool, max 3 rounds; **off by default** because each round is another request (`docs/ai-overview.md` "Lookup functions"; `lookupTools.js`). Answers are audience-scoped (`audience.js`): a viewer polity is told only what it could know.

### 4.4 How AI-controlled nations decide

- **[V]** **There are no per-nation agents.** One omniscient "simulator" call writes the whole world's history for the period (`defaultPrompts.json:61`, "YOU simulate the rest of the world"). AI nations have no persistent goals, utility functions, memory stores or planners of their own; their "decisions" are prose events the narrator writes.
- **[V]** In diplomacy, one model call role-plays **all** AI participants in a chat (`defaultPrompts.json:3`, `leader`: "roleplaying as all of the polities that are speaking in this chat"); a group turn returns one ordered **action batch** (`send_message, add_reaction, rename_chat, add_member, remove_member, create_poll, add_poll_option, poll_vote`) (`chatActions.js`; `runChatActionBatch`, `gameplay.js:12400`).
- **[V]** Unprompted activity: `maybeSendIdleDiplomacy` (`gameplay.js:16510`) rolls `Math.random()` per visible minute (`gameplay.js:16521`) to decide whether some polity writes a note / forces visibly move.
- **[V]** Mitigation for the narrator's lack of independent actors: the **native world director** builds a "current-state-first ledger" and a deterministic rotating "exploration slate" so the model attends to regions and storylines beyond the player (`nativeWorldDirector.js:1-14`, `nativeWorldIntegrity.js` header). Storylines carry `pressure`/`momentum`/`nextReviewDate` for scheduled attention.

---

## 5. Diplomacy system

- **[V]** Relations: sparse pair scores −100..100 banded as friendly ≥55, cordial ≥20, neutral ≥−10, cautious ≥−30, strained ≥−60, else hostile/rival (`nativeDiplomaticDirector.js:151-166`). An untracked pair is _unknown_, not zero. A band clamp prevents wild one-turn swings (`nativeDiplomaticDirector.js:171` comment).
- **[V]** Agreements are formal typed instruments with lifecycle ops; lifecycle errors are repaired rather than fatal (`docs/world-state.md` §2b-bis).
- **[V]** **War ledger is authoritative**: an event narrating combat must carry `warId` and `combatants` naming polities on opposite sides of an _active_ war, or the segment is rejected (combat event dropped on the final attempt) (`nativeWarLedger.js:540-602`; `docs/world-state.md` §2b-bis).
- **[V]** The AI never writes ledgers directly — the jump carries compact text lines (`warUpdates`, `relationUpdates`, `agreementUpdates`) that native code validates, binds to their causing event, and folds in once per turn (`docs/world-state.md` §2b-bis).
- **[V]** Chat threads are **event logs** (`chat_created, member_joined, member_left, title_changed, message, reaction, poll_*`) with membership windows (`src/runtime/chatThreads.js`). **Cross-chat knowledge** shows a leader what it heard in _its own_ other threads, cursored and fenced as data-not-instructions (`crossChatKnowledge.js`). Chat visibility is enforced so a leader never sees threads it wasn't in (`chatVisibility.js`).
- **[V]** Binding polls (e.g., a ceasefire vote) can be created and voted in one batch via batch-local `pollRef`s (`docs/ai-overview.md` "Group diplomacy").

## 6. Memory and history summarization

- **[V]** `eventConsolidator` task + `compactHistoryIfNeeded` (`gameplay.js:4429`) fold old events into `consolidatedHistory` and a rewritten `historyDocument` (~1,500-word cap) — the event log itself is never trimmed (`docs/world-state.md` §2f). In a folded skip the history fold rides as the last field of the same request.
- **[V]** `simulationHistory` keeps the last ≤12 turns with receipts.
- **[V]** Conversation memory: advisor/leader chats keep the transcript only in the turns (not duplicated in the system prompt), making the system prompt byte-identical between messages for provider prefix caching; a "catch-up note" tells a conversation what changed since it last spoke (`conversationCatchUp.js`).
- **[V]** Historical anchors / retrieval: `timelineCurator` compares new events against "retrieved prior matches" before dropping redundancies (`nativeTimelineCurator.js` header) — default is KEEP.
- **[I]** Memory is **global and narrative**, not per-agent: there is no per-polity episodic memory, belief state or grudges store; per-polity knowledge is approximated by audience filtering over shared records.

## 7. Map rendering and UI

- **[V]** `World.jsx` composes an ESRI raster basemap (via a custom `ohbase://` protocol), terrarium DEM terrain/hillshade or a custom background, then layers `<Nations>` (region fills/borders/labels, disputed stripes), `<Cities>`, `<Units>`, `<MarkersLayer>`, `<GlobeEffects>` (`docs/architecture.md:221-223`; `docs/game-map.md`). `regions.pmtiles` ~101 MB is downloaded on first launch, never bundled (`docs/architecture.md:25`).
- **[V]** HUD (`src/Game/GameUI/`): date pill + timeline skip panel (`time.jsx`), event history with staged reveal, diplomacy chat panel (`chat.jsx`), advisor drawer + Chart.js stats (`advisor.jsx`, `stats.jsx`), Actions panel (`actions.jsx`), GM cheats console (`cheats.jsx`), scenario library/community hub (`libraryBar.jsx`, `communityHub.jsx`) (`docs/game-ui.md` headings).
- **[V]** Map editor (OpenLayers) authors regions/cities/basemaps and exports scenario bundles; can embed Azgaar's Fantasy Map Generator (`docs/architecture.md:22`, `:235`).
- **[V]** Units deterministic feasibility: haversine distance and per-type, era-scaled movement leashes (garrison 200 km … naval 4000 km) so a move order beyond reach becomes a multi-turn campaign (`src/Game/Map/unitCombat.js:1-30`).

## 8. Deterministic vs LLM-decided, and weaknesses

### 8.1 What is deterministic (native code)

**[V]** Schema validation and salvage; impact normalization and application; war-ledger gating of combat; relation band clamps; territory `basis` screening; territory tempo caps (`worldDirection.js`: max regions per 30 days); unit movement leash; standing-order advancement; placement of named locations against a gazetteer into one deterministic point (`placement.js`); event pace/world-share counts; interactive-offer choice seeded by the turn (`docs/world-state.md` §2f); audience/visibility filters; request-budget accounting; rollback.

### 8.2 What the LLM decides

**[V]** Essentially _all_ world dynamics: which events happen, who goes to war, who annexes what, battle outcomes, economic statistics (the `countryStatSheet` task generates GDP breakdowns etc.; `gameplaySchemas.js:165` `gdpBreakdown` with a sum-to-100 rule; the stats kernel only _prepares_ data, "No … AI calls", `countryStatsWorkerKernel.js:1-3`), diplomatic replies, and the narration of every non-player polity.

### 8.3 Weaknesses worth improving on

1. **[V] LLM is the sole source of world dynamics.** Native code validates and constrains, but there is no underlying economic, demographic, military or logistic model; outcomes are whatever the narrator writes. Battles have no combat resolution function — the war ledger only checks that combat is _legal_, not who wins.
2. **[V] No autonomous agents.** One omniscient narrator plays every nation; leaders in a chat are one model wearing many masks. Nations cannot pursue private long-term goals, keep secrets from the narrator, or be measured individually.
3. **[V] Nondeterminism / no reproducibility.** Idle diplomacy uses `Math.random()` (`gameplay.js:16521`); outcomes depend on model sampling; there is no seed-and-replay of a campaign. Rollback is limited to 12 snapshots.
4. **[V] Cost/latency bound.** ~47K-token skips, ~100K-char advisor prompts; huge engineering effort (folded skip, request ledger, prefix caching, context preflight) exists solely to fit free-tier request quotas. A local 8–32K-context model can't take a default skip (`docs/ai-overview.md` "The context preflight").
5. **[V] Monolithic code.** `gameplay.js` is 16,640 lines; the docs themselves say `main.jsx` and `gameplay.js` "cannot be tested at all", which is why pure helpers were lifted out (`docs/ai-overview.md`, after the module map).
6. **[V] Names as keys.** Polities, reputation, tags and colours are keyed by display name verbatim, requiring rename re-keying and alias maps (`docs/world-state.md` §3 "Namespace caution").
7. **[I] Validation is post-hoc.** The model proposes a whole turn, then the engine strips what's illegal and tells the model next turn via the receipt. Illegal intent costs tokens and quality; a legal-action-set-first design would avoid it.
8. **[I] Prompt-as-rules.** Many invariants (e.g., "no nuclear weapons before 1945") are prose priority rules rather than mechanics.

---

## 9. Design concepts worth independent re-implementation

1. **Impacts as a closed mutation vocabulary**: the model can only change the world through typed ops, all normalized and applied by a pure function. (Re-implement as a typed Rust `enum Op` applied by a pure `apply(state, ops) -> (state, receipt)`.)
2. **Application receipt**: tell the model next turn what was dropped or changed and why.
3. **Canonical ledgers gate narrative** (no combat without an active war; relations banded and rate-clamped; agreements with lifecycle).
4. **De-facto control vs de-jure sovereignty vs claims** as three separate layers.
5. **Audience-scoped knowledge** (reports with `visibleTo`, chat membership windows, cross-chat knowledge cursors, fenced model-written text treated as data).
6. **Provider fallback list** (top-first, never rotate), failure classification, context preflight, and the structured-output ladder with deliberation detection — important for local models via LM Studio.
7. **History consolidation** into a bounded living document plus a short recent-turn window.
8. **World direction as numbers** (pace, territory tempo, scripted beats) enforced by the engine rather than prose.
9. **Staged reveal / intervene / rollback** as UX for an AI-authored turn.
