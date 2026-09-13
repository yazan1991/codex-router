import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.MODEL_ROUTER_USER_MODELS = path.join(
  mkdtempSync(path.join(os.tmpdir(), "cliproxy-route-contract-")),
  "missing-user-models.json",
);

const {
  CHECKED_IN_MODELS,
  MODEL_BY_SLUG,
  providerForModel,
} = await import("../src/model-registry.mjs");
const { routedSubagentModelIdentity } = await import("../src/subagent-model-identity.mjs");

const ROUTES = [
  ["cliproxy/gpt-5.6-sol", "cliproxy-gpt-5-6-sol", "gpt-5.6-sol"],
  ["cliproxy/gpt-5.6-terra", "cliproxy-gpt-5-6-terra", "gpt-5.6-terra"],
  ["cliproxy/gpt-5.6-luna", "cliproxy-gpt-5-6-luna", "gpt-5.6-luna"],
  ["cliproxy/gpt-6-astra", "cliproxy-gpt-6-astra", "gpt-6-astra"],
  ["cliproxy/codex-auto-review", "cliproxy-codex-auto-review", "codex-auto-review"],
];

test("CLIProxy GPT routes are checked in and independent of user overlay state", () => {
  for (const [slug, gatewayModel, upstreamModel] of ROUTES) {
    const route = MODEL_BY_SLUG.get(slug);
    assert.ok(route, slug);
    assert.ok(CHECKED_IN_MODELS.includes(route), `${slug} must be authoritative`);
    assert.equal(route.provider, "cliproxy");
    assert.equal(providerForModel(route).protocol, "openai-responses");
    assert.equal(route.gatewayModel, gatewayModel);
    assert.equal(route.upstreamModel, upstreamModel);
    if (slug === "cliproxy/codex-auto-review") {
      assert.equal(route.multiAgentVersion, "v1");
      assert.equal(routedSubagentModelIdentity(route), undefined);
    } else {
      assert.equal(route.multiAgentVersion, "v2");
      assert.equal(routedSubagentModelIdentity(route)?.executionRoute, slug);
    }
  }
});

test("CLIProxy Sol never aliases the native Sol identity", () => {
  const routed = MODEL_BY_SLUG.get("cliproxy/gpt-5.6-sol");
  const native = MODEL_BY_SLUG.get("gpt-5.6-sol");
  assert.notEqual(routed, native);
  assert.equal(routed.provider, "cliproxy");
  assert.notEqual(routed.slug, native?.slug);
  assert.notEqual(routed.gatewayModel, native?.gatewayModel);
});
