# CLAUDE.md

The project rules for every agent live in [AGENTS.md](AGENTS.md). Read it
first; this file only adds the commands the `/health` dashboard runs and the
gstack skill routing.

## Health Stack

- typecheck: tsc --noEmit
- lint: eslint . && prettier --check . && cargo clippy --manifest-path noeterra/Cargo.toml --all-targets -- -D warnings
- test: vitest run && bun run test:evidence && cargo test --manifest-path noeterra/Cargo.toml --release

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. Route only to skills in the session's available-skills list; answer directly for quick questions or small scoped edits.

Key routing rules:

- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
- Author a backlog-ready spec/issue → invoke /spec
