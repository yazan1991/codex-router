import assert from "node:assert/strict";
import test from "node:test";

import { routedAgentDefinition } from "../src/codex-agent-catalog.mjs";
import {
  routedSubagentModelIdentity,
  routedSubagentModelIdentityOrThrow,
} from "../src/subagent-model-identity.mjs";

function cliproxy(upstreamModel, overrides = {}) {
  return {
    slug: `cliproxy/${upstreamModel}`,
    upstreamModel,
    provider: "cliproxy",
    displayName: `${upstreamModel} through CLIProxy`,
    multiAgentVersion: "v2",
    ...overrides,
  };
}

test("reviewed CLIProxy GPT families separate client and execution identities", () => {
  for (const clientSpawnModel of [
    "gpt-6-astra",
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
  ]) {
    const route = cliproxy(clientSpawnModel);
    const identity = routedSubagentModelIdentity(route, { catalog: [route] });
    assert.deepEqual(identity, {
      clientSpawnModel,
      executionRoute: route.slug,
      agentType: routedAgentDefinition(route).agentName,
    });
    const definition = routedAgentDefinition(route);
    assert.match(definition.contents, /model_provider = "codex-router"/);
    assert.match(definition.contents, new RegExp(`model = ${JSON.stringify(route.slug)}`));
  }
});

test("native, non-GPT, and ambiguous CLIProxy identities do not gain a mapping", () => {
  assert.equal(routedSubagentModelIdentity({
    slug: "gpt-5.6-sol",
    upstreamModel: "gpt-5.6-sol",
    provider: "openai",
  }), undefined);
  assert.equal(routedSubagentModelIdentity(cliproxy("grok-4.6")), undefined);
  assert.equal(routedSubagentModelIdentity(cliproxy("gpt-5.6-sol", {
    slug: "cliproxy/alias-sol",
  })), undefined);
  assert.equal(routedSubagentModelIdentity({
    slug: "other/gpt-5.6-sol",
    upstreamModel: "gpt-5.6-sol",
    provider: "other",
  }), undefined);
});

test("CLIProxy identity requires a v2 route", () => {
  assert.equal(
    routedSubagentModelIdentity(
      cliproxy("gpt-5.6-sol", { multiAgentVersion: "v1" }),
      { catalog: [cliproxy("gpt-5.6-sol", { multiAgentVersion: "v1" })] },
    ),
    undefined,
  );
  assert.equal(
    routedSubagentModelIdentity(
      cliproxy("gpt-5.6-sol", { multiAgentVersion: undefined }),
      { catalog: [cliproxy("gpt-5.6-sol", { multiAgentVersion: undefined })] },
    ),
    undefined,
  );
});

test("native Sol remains a native identity", () => {
  const native = {
    slug: "gpt-5.6-sol",
    provider: "openai",
    upstreamModel: "gpt-5.6-sol",
  };
  assert.equal(routedSubagentModelIdentity(native), undefined);
});

test("missing CLIProxy artifact fails closed instead of falling back to native", () => {
  const route = cliproxy("gpt-5.6-sol");
  assert.throws(
    () => routedSubagentModelIdentityOrThrow(route, { catalog: [] }),
    (error) => error?.code === "ROUTED_SPAWN_IDENTITY_UNAVAILABLE" && error?.status === 502,
  );
});
