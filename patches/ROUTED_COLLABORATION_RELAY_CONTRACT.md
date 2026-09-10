# Codex++ Routed Collaboration Relay V1 Contract

## Root cause

Codex collaboration handoffs can contain a native-format `encrypted_content`
token even when the parent and child inference routes are external. Before this
patch, `relayEncryptedAgentPayloadOnce()` always submitted that token to the
local signed-in Codex account at the native ChatGPT `/responses` endpoint. A
routed child therefore still depended on local native quota: a native HTTP 429
became a Router 502 and interrupted an otherwise working CLIProxy child.

## Semantic contract

The feature changes relay authority, not the collaboration protocol.

- `encrypted_content` is copied byte-for-byte into the existing Responses relay
  body.
- The relay instructions, `relay_external_agent_payload` tool, forced tool
  choice, `stream: true`, and `store: false` remain unchanged.
- Plaintext handoffs already carried under `encrypted_content` remain local and
  are not submitted to any relay.
- Native model requests and the feature-disabled path retain the existing native
  behavior.
- An enabled routed relay failure is final for that handoff. It never falls back
  to the local native account.

## Integration points

- `src/routed-agent-relay.mjs` owns collaboration payload recognition, the
  invariant relay body, streamed/JSON tool-result parsing, and safe error
  classification.
- `src/provider-relay-transport.mjs` owns the opt-in policy, exact CLIProxy model
  validation, loopback API-forwarder target, provider credential availability,
  and credential-bound cache authority.
- `src/generic-provider-transport-snapshot.mjs` is the provider-owned immutable
  snapshot boundary. The Router sends its authority fingerprint with the relay;
  the API forwarder resolves one dispatch snapshot and refuses the request if
  the provider credential, endpoint, or static authority changed in between.
- `src/router.mjs` selects native versus routed authority and retains the
  existing bounded plaintext cache and in-flight coalescing.
- The routed request enters `src/api-forwarder.mjs` through its authenticated
  loopback `/v1/responses` surface. That existing boundary resolves the model's
  configured endpoint and provider credential and applies its outbound header
  sanitization. The relay does not duplicate provider request code in the
  Router.

The relay carries an internal marker header. The Router rejects that marker with
`ROUTED_AGENT_RELAY_RECURSION`, while the API forwarder strips all `x-codex-*`
headers before provider egress. A configured API base must be exactly a local
`/v1` boundary and may not use the Router's own listening port.

## Feature flag and target

The default is off.

```text
CODEX_PLUS_ROUTED_AGENT_RELAY=cliproxy
CODEX_PLUS_ROUTED_AGENT_RELAY_MODEL=cliproxy/gpt-5.6-sol
```

The model variable is optional and defaults to `cliproxy/gpt-5.6-sol`. V1
accepts only an enabled, operator-defined `cliproxy` provider using the native
Responses protocol. Unknown modes, missing models, non-Responses providers,
unavailable credentials, or a non-loopback API-forwarder base fail closed.

Set `CODEX_PLUS_ROUTED_AGENT_RELAY=off` (or `0`/`false`, or remove the variable)
for the emergency kill switch. The managed Linux, macOS, and Windows service
renderers preserve these two variables from the install/update environment.
Re-render and restart the managed source service through the normal rollout
procedure to apply a change; no production mutation is part of this source
patch.

## Security boundary

The routed relay does not call `nativeRelayContext()` and never forwards the
request's `Authorization`, `chatgpt-account-id`, `x-codex-*`, `x-openai-*`,
`originator`, attestation, session, or thread headers. It sends only the Router
internal service credential and JSON/SSE content negotiation to the loopback
API forwarder. The forwarder replaces that local service credential with the
configured provider credential at its existing protected transport boundary.

Provider secrets are read only inside the transport module to derive the same
installation-keyed, memory-hard authority fingerprint used by provider catalog
isolation. Raw credentials are not returned, logged, or placed in cache keys.
Diagnostics contain only relay mode, provider ID, model slug, and a safe error
code. Decrypted payload text is never logged.

## Cache boundary

Native entries use `native:<native-account-digest>`. Routed entries use
`routed-relay:<provider-authority-digest>`, derived from provider identity,
endpoint, configured static headers, the effective credential fingerprint, and
relay model. Replacing a credential behind the same opaque reference rotates
the routed scope. Native and routed plaintext cannot collide.

## Errors

Public compatibility remains HTTP 502. Internal errors distinguish:

- `ROUTED_AGENT_RELAY_UNAVAILABLE`
- `ROUTED_AGENT_RELAY_AUTH_UNAVAILABLE`
- `ROUTED_AGENT_RELAY_UPSTREAM_ERROR`
- `ROUTED_AGENT_RELAY_DECRYPT_REJECTED`
- `ROUTED_AGENT_RELAY_PROTOCOL_ERROR`
- `ROUTED_AGENT_RELAY_RECURSION`
- `ROUTED_AGENT_RELAY_AUTHORITY_CHANGED`

No error includes a token, key, ciphertext, or plaintext payload.

## Verification contract

The protected tests are:

- `test/routed-agent-relay.test.mjs`
- `test/provider-relay-transport.test.mjs`
- routed collaboration cases in `test/routing.test.mjs`
- `test/yazan-cliproxy-contract.test.mjs`
- existing API-forwarder, routing, CLIProxy parity, and ChatGPT-private metadata
  suites

They cover off-by-default behavior, native compatibility, exact payload/tool
shape, header isolation, configured endpoint and credential authority, cache
separation and credential rotation, safe error classes, and the absence of
native fallback.

## Upstream reconciliation

For every upstream update:

1. Inspect changes to collaboration payload detection/parsing, native relay,
   request headers, API-forwarder normalization/authentication, provider
   credentials, runtime provider descriptors, and cache identity helpers.
2. Rebase the two small modules onto current upstream contracts rather than
   copying newer Router or forwarder internals into them.
3. Confirm the relay body still matches the native collaboration contract
   byte-for-byte for all invariant fields.
4. Run the protected tests and the relevant upstream routing/forwarder suites.
5. Canary Linux first, then use the exact reviewed revision on macOS.

The patch is obsolete only when upstream natively supports selecting a
non-native collaboration relay authority with equivalent identity-header
isolation, credential-scoped caching, diagnostics, and no implicit native
fallback. Remove it only after deterministic tests and a quota-exhausted canary
prove that upstream behavior.

## Rollback

Operational rollback is the feature flag kill switch. Source rollback reverts
only the dedicated routed-relay source, tests, and documentation commit; it must
not revert unrelated upstream or Codex++ patches.
