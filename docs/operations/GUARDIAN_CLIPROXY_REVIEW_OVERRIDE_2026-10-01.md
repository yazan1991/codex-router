# Guardian CLIProxy Review Override - 2026-10-01

## Problem

With the OpenAI workspace quota exhausted, Codex Automatic Approval Review / Guardian could reject an operation even when the parent model was `cliproxy/gpt-6.1-sol`. Router evidence showed the review path independently selected native `gpt-6-luna` through provider `openai` and received HTTP 429. The earlier CLIProxy Composer quota-gate patch did not control this internal reviewer selection.

## Root cause

Codex supports a per-model catalog field named `auto_review_model_override`. The routed CLIProxy GPT 6.1 Sol catalog entry did not publish this field, so Guardian fell back to its native/default review model. This made approval review depend on OpenAI workspace quota even though the user-facing parent turn was routed through CLIProxy.

## Fix

The maintained Router now supports a registry property named `autoReviewModelOverride` and publishes it as `auto_review_model_override` in the generated Codex model catalog. The `cliproxy/gpt-6.1-sol` route declares:

```json
"autoReviewModelOverride": "cliproxy/gpt-6.1-sol"
```

Therefore, when GPT 6.1 Sol (CLIProxy) is the parent route, Automatic Approval Review uses the same CLIProxy Sol 6.1 route instead of the native OpenAI Luna reviewer.

This does not bypass approval policy, sandbox policy, OpenAI authentication, or native OpenAI quota enforcement. It only changes the inference route used by Guardian for this explicitly configured routed model.

## macOS qualification

Production pair retained:

- Desktop: `26.924.22138`, build `11645`
- CodexHost: `0.10.2`
- Router: `0.6.0`
- Parent route: `cliproxy/gpt-6.1-sol`
- Guardian override: `cliproxy/gpt-6.1-sol`

Validation:

- generated `~/.codex/codex-router/merged-models.json` contains `auto_review_model_override=cliproxy/gpt-6.1-sol`
- focused catalog/registry tests: 120/120 PASS
- Router health: `ok=true`, `degraded=[]`
- Desktop was fully relaunched through CodexHost after catalog refresh
- user live acceptance: PASS, the approval-reviewed operation completed successfully while testing the new override

Pre-change backup:

`~/codex-router-backups/20261001-053327-pre-guardian-cliproxy-review`

Known unrelated check issue: the broad Router `scripts-check.mjs` currently fails an existing v2-agent application admission for `cliproxy/gpt-6-luna`; this is not introduced by the Guardian override.

## Linux rollout

The same durable source change was applied to the Linux `codex-router-maintained` repository on 2026-10-01:

- `config/cliproxy/gpt-6.1-sol.json`
- `src/catalog.mjs`
- `src/model-registry.mjs`
- `test/catalog.test.mjs`

Linux validation:

- focused Guardian catalog test: PASS
- generated catalog contains `auto_review_model_override=cliproxy/gpt-6.1-sol`
- Router `0.6.0`: healthy, `degraded=[]`
- existing active route observed as `provider=cliproxy`, `model=cliproxy/gpt-6.1-sol`

The broader two-file Linux test run was 112 PASS / 1 FAIL because `registry.test.mjs` has a pre-existing expected-model-list drift relative to the current registry. The new focused Guardian test passes and the generated field is correct.

## Upgrade requirement

Future Router upgrades must preserve both the registry property and the catalog projection. Acceptance after an upgrade should verify:

1. `cliproxy/gpt-6.1-sol` publishes `auto_review_model_override=cliproxy/gpt-6.1-sol`.
2. Guardian approval review succeeds while native OpenAI workspace quota is exhausted.
3. Native OpenAI models remain subject to native quota enforcement.
4. Router health remains non-degraded.
