# Guardian CLIProxy Review Override - 2026-10-01

## Problem

Codex Automatic Approval Review / Guardian can select a native OpenAI reviewer independently of the routed parent model. When OpenAI workspace quota is exhausted, that review can fail even while `cliproxy/gpt-6.1-sol` is healthy.

## Durable fix

The maintained Router supports `autoReviewModelOverride` in model registry data and publishes it as `auto_review_model_override` in the generated Codex catalog. GPT 6.1 Sol through CLIProxy declares:

```json
"autoReviewModelOverride": "cliproxy/gpt-6.1-sol"
```

This keeps Guardian inference on CLIProxy Sol 6.1 for that routed parent model. It does not bypass approval policy, sandbox policy, OpenAI authentication, or native OpenAI quota enforcement.

## Linux qualification

- repository branch at rollout start: `codex/reconcile-routed-relay-20260923`
- pre-change HEAD: `b9b7618eecd0d2eaecd65a1f50e41ac9253f3dc4`
- pre-change worktree: clean
- focused Guardian catalog test: PASS
- generated catalog: `auto_review_model_override=cliproxy/gpt-6.1-sol`
- Router 0.6.0 health: `ok=true`, `degraded=[]`
- observed current route: `provider=cliproxy`, `model=cliproxy/gpt-6.1-sol`

The broader `catalog.test.mjs + registry.test.mjs` run reported 112 PASS / 1 FAIL because the registry expected-model list is already behind the current checked-in registry. The focused Guardian test passes and the generated reviewer override is correct.

## macOS reference qualification

The same change was qualified first on macOS with Desktop `26.924.22138` build `11645`, CodexHost `0.10.2`, and Router `0.6.0`. The generated override was present, focused tests passed 120/120, Router was healthy, and user live acceptance of an approval-reviewed operation passed.

macOS pre-change backup:

`~/codex-router-backups/20261001-053327-pre-guardian-cliproxy-review`

## Upgrade acceptance

After future Router updates verify that `cliproxy/gpt-6.1-sol` still publishes `auto_review_model_override=cliproxy/gpt-6.1-sol`, Guardian review remains usable when native workspace quota is exhausted, native OpenAI quota enforcement is unchanged, and Router health is non-degraded.
