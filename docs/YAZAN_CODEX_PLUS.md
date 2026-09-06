# Yazan Codex++ Router

Maintained fork of upstream Codex Router.

## Ownership

Upstream:
- General Router implementation
- Provider routing
- Catalog infrastructure
- Native account catalog
- Standard lifecycle and tests

Yazan patchset:
- Native GPT semantic capability parity for verified CLIProxy GPT routes
- ChatGPT private metadata compatibility for CLIProxy
- Regression contract tests

Runtime state remains outside Git.

Do not commit:
- ~/.codex/codex-router/merged-models.json
- private CLIProxy configuration
- credentials or tokens
- local backups
- troubleshooting artifacts
- generated runtime state

## Canonical Branch

`yazan/codex-plus-clean`

The production checkout is not the canonical development checkout.

Canonical maintenance worktree:

`~/projects/codex-router-maintained`

## Current Patch Surface

- src/catalog.mjs
- src/api-forwarder.mjs
- test/yazan-cliproxy-contract.test.mjs

## Update Flow

1. Fetch upstream.
2. Inspect upstream changes touching the patch surface.
3. Determine whether either local patch has become redundant upstream.
4. Update the maintained branch onto the new upstream baseline.
5. Run targeted upstream tests.
6. Run the Yazan contract test.
7. Run static checks.
8. Canary before production rollout.
9. Preserve rollback anchor.
10. Roll out Mac and Linux separately.

Never blindly carry an obsolete patch forward.
