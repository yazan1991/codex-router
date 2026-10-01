# Codex++ Subagent Reasoning Role Matrix

The workforce reasoning policy is generated from `src/codex-role-matrix.mjs`.
Do not hand-edit the managed role files under `~/.codex/agents/`; a catalog
refresh regenerates them.

## Named specialists

- `luna_search` -> GPT 6 Luna `low`: exact lookups, paths, strings, counts.
- `fast_scan` -> GPT 6 Luna `medium`: cross-file mapping and dependency tracing.
- `docs_researcher` -> GPT 6 Luna `high`: official docs and compatibility synthesis.
- `test_runner` -> GPT 6 Luna `medium`: deterministic reproduction and focused tests.
- `routine_worker` -> GPT 6.1 Sol `high`: bounded implementation and difficult execution.
- `reviewer` -> GPT 6.1 Sol `xhigh`: independent correctness and regression review.

## Generic routed agents

- `cliproxy/gpt-6-luna` -> `max`: cheap deep-reasoning worker.
- `cliproxy/gpt-6.1-sol` -> `high`: general difficult-work worker.
- `cliproxy/gpt-6-astra` -> `max`: escalation-only expert/final-review worker.

Machine-local `subagentEffort` settings still take precedence over these
generic defaults. The named specialist matrix itself is canonical and is
regenerated on every catalog publication.
