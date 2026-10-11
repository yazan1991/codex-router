# Linux Codex Router retirement — 2026-10-11

Status: **RETIRED / VERIFIED**

This record documents retirement of the legacy Linux Codex Router fallback after the OpenCodex production cutover. It does not contain credentials or private state.

## Production after retirement

- Host: `ubuntu-hermes-core`.
- OpenCodex: 2.82.0, production data plane on `127.0.0.1:11100`.
- Codex CLI: 0.159.1.
- Codex production `openai_base_url`: `http://127.0.0.1:11100/v1`.
- Active model catalog: `/root/.local/state/opencodex-linux-stage/codex/opencodex-catalog.json`.
- Final catalog check: 56 models; `Jev-calude`, `gpt-6.1-sol`, and `gpt-6-luna` present.
- CodexHost remote app-server listener remained running.
- WebCodex runtime, runner, and tunnel remained active.
- `multi_agent_v2` remained enabled.

## Legacy Router retirement

The prior production-cutover receipt explicitly recorded `codex-router-production.service` on port 4202 as an immediate rollback fallback and stated that retirement was a separate post-cutover step.

Before deletion, a stop-only canary was performed:
- Router service changed to inactive.
- Router port 4202 disappeared.
- OpenCodex remained live.
- OpenCodex catalog remained exactly 56 models.
- Key models remained present.
- CodexHost remained live.

After the canary passed:
- `codex-router-production.service` was disabled.
- The stale `[model_providers.codex-router]` entry pointing at `http://127.0.0.1:4202/v1` was removed from `/root/.codex/config.toml` with an exact private backup first.
- The service unit and drop-ins were removed and `systemctl daemon-reload` was run.
- All Router listeners on ports 4200, 4201, 4202, 4203, and 4208 were absent.
- Thirteen legacy Router source/candidate/production/test trees were removed.
- `/root/.codex/codex-router` was removed because Linux production now reads the OpenCodex-owned catalog, unlike the earlier Mac retirement where a legacy-named catalog remained live.
- Historical Router rollback directories/files were removed only after a separate private archive was verified.

## Source/history preservation

The final production checkout had two tracked uncommitted files:
- `src/router.mjs`
- `test/router-resilience.test.mjs`

They were committed locally before deletion:
- commit: `aead2899c5b6992cfcbe908e2cb1eacb9c101e64`
- message: `archive: preserve final Linux Router resilience changes before retirement`
- final patch: 207 insertions, 35 deletions.

The Linux host did not have GitHub HTTPS credentials, so a direct `git push` of the complete historical branch failed closed before deletion. No token was added to the host.

Instead, the complete repository history was preserved outside all deleted Router trees as:
- `/root/.codexhost/backups/codex-router-linux-all-refs-20261011.bundle`
- mode: `0600`
- bytes: `25,831,586`
- SHA256: `f73709bf134c7b073a204792a93ba1896a4f1cb9a59d86045872424b9b7c1ccc`
- `git bundle verify`: PASS
- bundle reports complete history and 26 refs.
- the bundle contains final commit `aead2899...`.

The complete Linux source branch is therefore recoverable from the private Git bundle even though that full historical ref was not pushed from the host.

This GitHub branch (`archive/linux-retirement-record-20261011`) was created through the authenticated GitHub connector after retirement to keep a public, credential-free retirement record. It is a record branch based on the repository's existing main, **not** a replacement for the private full-history bundle.

## Private recovery artifacts — do not publish

Stored under `/root/.codexhost/backups/` with mode `0600`:

- `codex-router-linux-all-refs-20261011.bundle` — SHA256 `f73709bf134c7b073a204792a93ba1896a4f1cb9a59d86045872424b9b7c1ccc`.
- `codex-router-linux-private-state-20261011.tar.gz` — SHA256 `c182db3a6d5153436fc402b1fd12855fa9a3ad05381b3eb2095c9e5f8645b6f0`.
- `codex-router-linux-historical-receipts-20261011.tar.gz` — SHA256 `e0324dc66539060c5b677bac53a32bb5d08ae4a72943db67374e45d02fe363fc`.
- `codex-config-before-linux-router-retirement-20261011.toml` — exact pre-retirement Codex config; private because it may contain credentials. SHA256 `95ad3f89acc71f7bd32bff2ed32d0c71b2ba0cb82a600a9a3b0a774d67c64add`.

## Final validation

- `codex-router-production.service`: unit not found.
- Legacy Router ports 4200/4201/4202/4203/4208: none listening.
- Legacy Router project trees: absent.
- Legacy Router state directory: absent.
- OpenCodex: running and restart-protected by its background service.
- OpenCodex catalog: 56 models.
- CodexHost: running.
- WebCodex runtime/runner/tunnel: active.
- Codex CLI: 0.159.1.
- Codex `openai_base_url`: still 11100.
- OpenCodex catalog file exists and is active.
- Dead `codex-router` provider: absent.
- `multi_agent_v2`: still enabled.

Disk free space increased from `114,025,528 KiB` to `117,824,984 KiB` during the retirement window: approximately **3.62 GiB** net additional free space.

## Known non-Router warning

`ocx status` reports OAuth health warning for the Codex account pool: reauthentication required. This warning existed independently of Router retirement and does not indicate a 4202 routing dependency.

## Restoration

Do not restore the old systemd service as a normal operating path. For source inspection only:

```bash
git clone /root/.codexhost/backups/codex-router-linux-all-refs-20261011.bundle \
  /root/projects/codex-router-archive-reference
```

The final archived commit can then be checked out by SHA:

```bash
git -C /root/projects/codex-router-archive-reference checkout \
  aead2899c5b6992cfcbe908e2cb1eacb9c101e64
```

Any production rollback must separately restore the private config/state and must not overwrite the current OpenCodex 11100 path without a deliberate rollback decision.
