# Codex++ Router Patch Contract

## Patch 1: CLIProxy Native GPT Capability Parity

Verified routes:

- cliproxy/gpt-5.6-sol
- cliproxy/gpt-5.6-terra
- cliproxy/gpt-5.6-luna
- cliproxy/gpt-6-astra

These routes may inherit verified model-semantic capabilities from their native behavior twin:

- include_skills_usage_instructions
- include_plugin_usage_instructions
- include_apps_usage_instructions
- tool_mode
- support_verbosity
- default_verbosity
- supports_image_detail_original

Arbitrary routed providers must retain upstream conservative behavior.

## Patch 2: CLIProxy ChatGPT Metadata Compatibility

Only when provider.id is `cliproxy`, remove:

`input[*].internal_chat_message_metadata_passthrough`

Do not strip or alter:

- image_generation
- tools
- tool schemas
- messages
- content
- reasoning
- service tiers

## Patch 3: Routed Collaboration Relay V1

The optional `CODEX_PLUS_ROUTED_AGENT_RELAY=cliproxy` mode sends native-format
collaboration relay bodies through the configured CLIProxy Responses route and
the existing API-forwarder transport boundary. It is off by default, keeps the
native path unchanged, isolates cache authority, forwards no native identity
headers, rejects Router self-targets, binds dispatch to an immutable provider
authority snapshot, and never falls back to native after a routed failure.

See `patches/ROUTED_COLLABORATION_RELAY_CONTRACT.md` for the full semantic,
security, verification, maintenance, and rollback contract.

## Runtime Boundary

The source fork must not contain production credentials or generated Router state.

`merged-models.json` remains generated state.

Mac headless Tray policy is deployment state, not a source patch.

CLIProxy image passthrough configuration is external runtime state, not Router source.
