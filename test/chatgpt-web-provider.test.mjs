import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";

const root = mkdtempSync(path.join(os.tmpdir(), "chatgpt-web-provider-"));
const userModelsPath = path.join(root, "user-models.json");
process.env.MODEL_ROUTER_STATE_DIR = path.join(root, "state");
process.env.MODEL_ROUTER_USER_MODELS = userModelsPath;
delete process.env.MODEL_ROUTER_CHATGPT_WEB_BASE_URL;
writeFileSync(userModelsPath, JSON.stringify({
  version: 1,
  models: [{
    slug: "chatgpt-web/light",
    gatewayModel: "chatgpt-web-light",
    upstreamModel: "chatgpt-web/light",
    provider: "chatgpt-web",
    listed: true,
    displayName: "ChatGPT Web — Instant",
    description: "Test ChatGPT Web route.",
    priority: 100,
    reasoningLevels: [{ effort: "low", description: "Quick reasoning" }],
    defaultEffort: "low",
    contextWindow: 41_000,
    autoCompact: 32_000,
    inputModalities: ["text", "image"],
    compHash: "chatgpt-web-light-test-v1"
  }],
}));

after(() => rmSync(root, { recursive: true, force: true }));

const {
  directResponsesBody,
  directResponsesHeaders,
  directResponsesTarget,
} = await import("../src/direct-responses-provider.mjs");
const {
  discoverProviderModels,
  modelIds,
  providerDiscoveryIdentityFingerprint,
  providerCatalogRequest,
} = await import("../src/model-discovery.mjs");
const { writeProviderCatalogCache } = await import("../src/model-catalog-cache.mjs");
const { MODEL_BY_SLUG, PROVIDERS } = await import("../src/model-registry.mjs");
const { routedClientModels } = await import("../src/routed-client-models.mjs");
const { userModelIdentity } = await import("../src/user-models.mjs");

test("ChatGPT Web is an explicit Codex-only direct Responses provider", () => {
  const provider = PROVIDERS.get("chatgpt-web");
  assert.equal(provider.protocol, "openai-responses");
  assert.equal(provider.keyless, true);
  assert.equal(provider.directResponses, true);
  assert.equal(provider.codexOnly, true);
  assert.equal(provider.explicitSelection, true);
  assert.equal(MODEL_BY_SLUG.get("chatgpt-web/light").upstreamModel, "chatgpt-web/light");
  assert.equal(
    userModelIdentity({ providerId: "chatgpt-web", upstreamId: "chatgpt-web/pro" }).slug,
    "chatgpt-web/pro",
  );
});

test("ChatGPT Web discovery accepts the current CGW catalog and withholds non-provider rows", async () => {
  const expected = [
    "chatgpt-web/light",
    "chatgpt-web/medium",
    "chatgpt-web/high",
    "chatgpt-web/extra-high",
    "chatgpt-web/pro",
  ];
  const payload = {
    object: "list",
    data: [
      ...expected.map((id) => ({
        id,
        object: "model",
        display_name: `CGW ${id.split("/")[1]}`,
        context_window: 128_000,
        input_modalities: ["text", "image"],
      })),
      { id: "gpt-6-astra", display_name: "Native row must stay out" },
      { id: "attacker/arbitrary", display_name: "Arbitrary row must stay out" },
    ],
  };
  assert.deepEqual(modelIds(payload, PROVIDERS.get("chatgpt-web")), [...expected].sort());

  const result = await discoverProviderModels("chatgpt-web", {
    cache: false,
    refresh: true,
    loadPayload: async () => payload,
  });
  assert.deepEqual(result.discovered, [...expected].sort());
  assert.deepEqual(
    result.contextLengths,
    Object.fromEntries(expected.map((id) => [id, 128_000])),
  );
  assert.equal(result.modelMetadata.length, expected.length);
  assert.ok(result.modelMetadata.every((model) => model.upstreamId.startsWith("chatgpt-web/")));
  const medium = result.modelMetadata.find((model) => model.upstreamId === "chatgpt-web/medium");
  assert.equal(medium.displayName, "CGW medium");
  assert.equal(medium.contextWindow, 128_000);
  assert.deepEqual(medium.inputModalities, ["text", "image"]);
});

test("ChatGPT Web discovery alone uses its unauthenticated local endpoint", async () => {
  const identity = {
    baseUrl: "http://127.0.0.1:17841/v1",
    credential: { value: "local" },
  };
  assert.deepEqual(await providerCatalogRequest(PROVIDERS.get("chatgpt-web"), identity), {
    endpoint: "http://127.0.0.1:17841/v1/chatgpt-web-models",
    headers: {},
    allowPrivate: true,
  });
  assert.deepEqual(await providerCatalogRequest(PROVIDERS.get("local"), identity), {
    endpoint: "http://127.0.0.1:17841/v1/models",
    headers: { Authorization: "Bearer local" },
    allowPrivate: true,
  });
});

test("ChatGPT Web ignores a pre-change /models cache and reloads the dedicated catalog", async () => {
  const baseUrl = "http://127.0.0.1:17841/v1";
  const previousBaseUrl = process.env.MODEL_ROUTER_CHATGPT_WEB_BASE_URL;
  process.env.MODEL_ROUTER_CHATGPT_WEB_BASE_URL = baseUrl;
  try {
    const identityFingerprint = providerDiscoveryIdentityFingerprint({
      baseUrl,
      credential: { value: "local" },
    });
    await writeProviderCatalogCache("chatgpt-web", {
      discovered: ["gpt-6-astra", "chatgpt-web/high"],
      fetchedAt: new Date().toISOString(),
      identityFingerprint,
      provenance: {
        schema: "codex-router/provider-catalog/v1",
        providerId: "chatgpt-web",
        endpoint: `${baseUrl}/models`,
        identityFingerprint,
      },
    });
    const result = await discoverProviderModels("chatgpt-web", {
      refresh: false,
      cache: true,
      loadPayload: async () => ({
        data: [{ id: "chatgpt-web/high" }, { id: "chatgpt-web/pro" }],
      }),
    });
    assert.equal(result.cached, false);
    assert.deepEqual(result.discovered, ["chatgpt-web/high", "chatgpt-web/pro"]);
  } finally {
    if (previousBaseUrl === undefined) delete process.env.MODEL_ROUTER_CHATGPT_WEB_BASE_URL;
    else process.env.MODEL_ROUTER_CHATGPT_WEB_BASE_URL = previousBaseUrl;
  }
});

test("direct Responses requests retain Codex authority but strip account credentials", () => {
  const provider = PROVIDERS.get("chatgpt-web");
  const headers = directResponsesHeaders({
    authorization: "Bearer CHATGPT_ACCOUNT_TOKEN",
    "chatgpt-account-id": "acct-secret",
    cookie: "session=secret",
    "content-encoding": "zstd",
    "content-length": "999",
    "openai-project": "project-secret",
    "x-oai-attestation": "attestation-secret",
    "x-codex-turn-metadata": "turn-authority",
    "x-openai-subagent": "review",
  });
  assert.equal(headers.Authorization, "Bearer local");
  assert.equal(headers["x-codex-turn-metadata"], "turn-authority");
  assert.equal(headers["x-openai-subagent"], "review");
  assert.equal(headers["chatgpt-account-id"], undefined);
  assert.equal(headers.cookie, undefined);
  assert.equal(headers["openai-project"], undefined);
  assert.equal(headers["x-oai-attestation"], undefined);
  assert.equal(headers["content-encoding"], undefined);
  assert.equal(
    directResponsesTarget(provider, "/v1/responses/compact", "?mode=test"),
    "http://127.0.0.1:17841/v1/responses/compact?mode=test",
  );
  assert.deepEqual(
    JSON.parse(directResponsesBody(
      { model: "chatgpt-web/light", client_metadata: { authority: "kept" } },
      MODEL_BY_SLUG.get("chatgpt-web/light"),
    )),
    { model: "chatgpt-web/light", client_metadata: { authority: "kept" } },
  );
});

test("non-Codex client publication omits ChatGPT Web routes", () => {
  assert.ok(!routedClientModels().models.some((model) => model.slug.startsWith("chatgpt-web/")));
});
