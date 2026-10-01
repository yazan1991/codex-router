# OpenAI quota dependency of routed Codex subagents

Date: 2026-09-28
Status: evidence baseline captured; exhausted-quota confirmation pending next natural exhaustion

## Finding

A routed Codex subagent using an external Router model is not necessarily independent of the authenticated OpenAI account.

Router supports native Codex collaboration payloads and, for encrypted native collaboration messages, may use the native authenticated relay to recover the plaintext collaboration item before forwarding the normalized request to the external provider.

Therefore this topology can contain both paths in one logical child operation:

```text
Codex parent / native collaboration
        |
        | encrypted agent_message
        v
Codex Router
        |
        +--> native authenticated relay when required
        |        |
        |        +--> subject to native account availability/quota
        |
        +--> normalized external child request
                 |
                 +--> CLIProxy provider/model
```

Selecting `cliproxy/gpt-5.6-sol` for the child does not by itself eliminate the native relay dependency.

## Source-level evidence already present in Router

The maintained Router test suite explicitly covers native relay quota exhaustion.

`test/routing.test.mjs` contains the case:

```text
router preserves relay 429 and suppresses repeated native attempts per account
```

The fixture returns a native `429` with `native relay quota exhausted` and verifies that Router surfaces a bounded `ERR_NATIVE_AGENT_RELAY_RATE_LIMITED` result rather than leaking the raw upstream message.

The same test verifies short per-account/ciphertext backoff and retries the native relay after that backoff expires.

Router subagent certification also treats account-level failures such as `429` as `deferred`, not as proof that a route cannot run subagents.

`test/subagent-certify.test.mjs` explicitly includes `429` in `STATUS_ABOUT_THE_ACCOUNT` and documents:

```text
a rate limit is not a verdict about the route
```

This is important: the Router source already models native/account quota as distinct from external route capability.

## Production evidence before quota reset

During the observed exhausted-quota period, native OpenAI requests returned `429`.

Representative timing:

```text
2026-09-28T00:52:59.977Z model=gpt-6-luna provider=openai status=429 total_ms=1003 upstream_ms=1001
```

At the same time, routed external GPT traffic showed severe latency variance:

```text
cliproxy/gpt-5.6-sol status=200 total_ms=65518 upstream_ms=65010
cliproxy/gpt-5.6-sol status=200 total_ms=56085 upstream_ms=54210
cliproxy/gpt-5.6-sol status=200 total_ms=14385 upstream_ms=14137
```

A minimal one-child `CHILD_OK` Desktop run showed slow child completion, delayed parent settlement, duplicate `Child ok finished`, and later `Planning child process interruption`.

These observations prove correlation, not yet complete causation.

## Production evidence after quota reset

Without an intentional Router performance change, native OpenAI requests began succeeding:

```text
2026-09-28T01:13:20.146Z model=gpt-6-luna provider=openai status=200 total_ms=3390 upstream_ms=1426
2026-09-28T01:13:23.413Z model=gpt-6-luna provider=openai status=200 total_ms=5250 upstream_ms=1222
2026-09-28T01:13:28.909Z model=gpt-6-luna provider=openai status=200 total_ms=5325 upstream_ms=1135
2026-09-28T01:13:34.201Z model=gpt-6-luna provider=openai status=200 total_ms=5251 upstream_ms=1433
2026-09-28T01:13:38.302Z model=gpt-6-luna provider=openai status=200 total_ms=4086 upstream_ms=1016
```

External CLIProxy GPT requests in the same window were also fast:

```text
2026-09-28T01:13:29.494Z model=cliproxy/gpt-5.6-sol provider=cliproxy status=200 total_ms=3651 upstream_ms=1394
2026-09-28T01:13:32.397Z model=cliproxy/gpt-5.6-sol provider=cliproxy status=200 total_ms=2858 upstream_ms=1215
2026-09-28T01:13:38.954Z model=cliproxy/gpt-5.6-sol provider=cliproxy status=200 total_ms=3229 upstream_ms=1193
2026-09-28T01:13:41.765Z model=cliproxy/gpt-5.6-sol provider=cliproxy status=200 total_ms=2797 upstream_ms=1367
```

Router health after the fast run was healthy/idle and associated the activity with the subagent verification session.

## Collaboration relay evidence

Production diagnostics observed routed native collaboration items such as:

```text
route=cliproxy/gpt-5.6-sol
item_type=agent_message
parts=input_text,encrypted_content
encrypted_parts=1
detected=yes
native_token=yes
relay=selected
normalized=input_text
```

This proves that some external GPT child requests traverse native collaboration handling before reaching CLIProxy.

## CLIProxy translator compatibility invariant

The working configuration on the CLIProxy GPT path is:

```yaml
codex-msg-translator:
  enabled: true
  priority: 10
  family_gpt: false
```

Do not change `family_gpt` back to `true` during quota A/B testing.

A previous controlled A/B isolated that setting:

- `family_gpt=true`: GPT collaboration `agent_message` was modified and child task delivery failed/corrupted.
- `family_gpt=false`: translator reported `modified=false reason=non_deepseek`; Router relay/decrypt/normalize succeeded and the child returned `CHILD_OK`.

Changing this invariant during the quota test would introduce a second variable and invalidate the comparison.

## Healthy baseline to preserve

At the time this record was written:

```text
native OpenAI quota path: available
native gpt-6-luna: HTTP 200
Router: healthy
Router activity: idle after successful subagent verification
external cliproxy/gpt-5.6-sol: HTTP 200
external GPT upstream latency: approximately 1.2-1.4s in representative fast requests
subagent workflow: user-observed fast
```

## Next natural exhausted-quota capture

Do not deliberately consume quota to manufacture the condition.

When native Codex quota naturally reaches 0%, before restarting or changing configuration:

1. Confirm a native OpenAI request returns `429` and preserve its bounded usage-limit metadata.
2. Run exactly one child test: `CHILD_OK`.
3. Capture Router `/activity` immediately before/during/after the run.
4. Preserve `isSubagent`, `parentThreadId`, provider, model, request timestamps, event count, terminal event/status, and upstream attempts.
5. Preserve Router timing `total_ms` and `upstream_ms`.
6. Record every `agent_relay_probe` line for the run without plaintext/ciphertext content.
7. Determine whether native relay returns `ERR_NATIVE_AGENT_RELAY_RATE_LIMITED`.
8. Correlate the same child with CodexHost lifecycle instrumentation.
9. Record Desktop child completion count and parent settlement delay.
10. Test Plugins/app-tools and Remote separately, without assuming they share the same dependency.

## A/B interpretation

The strongest confirmation will be:

```text
same Router build
same CodexHost build
same CLIProxy configuration
same external model
same CHILD_OK task
same translator family_gpt=false

quota available  -> native relay 200 -> fast/normal child
quota exhausted  -> native relay 429 -> slow/broken/degraded child
quota reset      -> native relay 200 -> fast/normal child again
```

If reproduced, classify native OpenAI quota as an architectural dependency of the routed Codex collaboration path.

## Future fix boundary

Do not solve this by globally bypassing OpenAI authentication or quota checks.

A safe future change should be narrowly scoped to collaboration/control behavior and preserve:

- authenticated OpenAI account
- native OpenAI models and their quota enforcement
- Plugins/app tools
- Remote
- Router caller capability/signing
- external CLIProxy routing
- current GPT translator compatibility behavior

Candidate work should begin only after the exhausted-quota trace proves exactly where the native relay dependency becomes user-visible.
