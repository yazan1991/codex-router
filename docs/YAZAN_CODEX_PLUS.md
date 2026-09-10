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
- Opt-in routed collaboration relay for CLIProxy-backed Codex subagents
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
- src/provider-relay-transport.mjs
- src/generic-provider-transport-snapshot.mjs
- src/routed-agent-relay.mjs
- src/router.mjs
- test/yazan-cliproxy-contract.test.mjs
- test/provider-relay-transport.test.mjs
- test/routed-agent-relay.test.mjs
- test/routing.test.mjs
- patches/ROUTED_COLLABORATION_RELAY_CONTRACT.md

## Routed Collaboration Relay

The relay is disabled by default. Set
`CODEX_PLUS_ROUTED_AGENT_RELAY=cliproxy` to relay native-format collaboration
tokens through the configured `cliproxy` Responses route instead of the local
signed-in Codex account. The optional
`CODEX_PLUS_ROUTED_AGENT_RELAY_MODEL` defaults to
`cliproxy/gpt-5.6-sol`.

The routed path enters the existing authenticated loopback API forwarder, so
provider endpoint selection, credentials, and outbound header isolation stay
owned by the normal provider transport. It never forwards the local native
identity and never falls back to native after a routed relay failure. Set the
flag to `off` or remove it for the kill switch.

The managed Linux, macOS, and Windows service renderers copy these explicit
variables from the install/update environment. Applying or killing the feature
therefore requires the normal service re-render/restart rollout; it does not
require editing a managed service file by hand.

The full maintenance and rollback contract is
[`patches/ROUTED_COLLABORATION_RELAY_CONTRACT.md`](../patches/ROUTED_COLLABORATION_RELAY_CONTRACT.md).

## Update Flow

1. Fetch upstream.
2. Inspect upstream changes touching the patch surface.
3. Determine whether either local patch has become redundant upstream.
4. Update the maintained branch onto the new upstream baseline.
5. Run targeted upstream tests.
6. Run the Yazan contract test.
7. Run the routed collaboration relay unit and routing tests.
8. Run static checks.
9. Canary before production rollout.
10. Preserve rollback anchor.
11. Roll out Linux first, then the exact reviewed revision on Mac.

Never blindly carry an obsolete patch forward.
