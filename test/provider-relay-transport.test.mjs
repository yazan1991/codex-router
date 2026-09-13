import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const testRoot = mkdtempSync(path.join(os.tmpdir(), "provider-relay-transport-"));
const stateDir = path.join(testRoot, "state");
const userModelsFile = path.join(stateDir, "user-models.json");
const providerKey = "CLI_PROXY_PROVIDER_KEY_MUST_NOT_ESCAPE";

mkdirSync(stateDir, { recursive: true });
process.env.CODEX_ROUTER_STATE_DIR = stateDir;
process.env.MODEL_ROUTER_USER_MODELS = userModelsFile;
process.env.CLIPROXY_API_BASE_URL = "http://127.0.0.1:8317/v1";
process.env.CLIPROXY_API_KEY = providerKey;

const { userModelEntry } = await import("../src/user-models.mjs");
const model = userModelEntry({
  providerId: "cliproxy",
  upstreamId: "gpt-5.6-sol",
  priority: 100,
});
const grokModel = userModelEntry({
  providerId: "cliproxy",
  upstreamId: "grok-4.6",
  priority: 99,
});
writeFileSync(userModelsFile, `${JSON.stringify({ version: 1, models: [model, grokModel] })}\n`);

const {
  resolveProviderRelayTransport,
  isRoutedAgentRelayRequest,
  readCheckedInProviderAuthoritySnapshot,
} = await import("../src/provider-relay-transport.mjs");
const { MODEL_BY_SLUG, endpointForModel, providerForModel } = await import("../src/model-registry.mjs");
const { PORTS } = await import("../src/paths.mjs");
test("routed CLIProxy identities retain bare provider-facing model ids", () => {
  for (const expected of [model, grokModel]) {
    const registered = MODEL_BY_SLUG.get(expected.slug);
    assert.equal(registered.slug, expected.slug);
    assert.equal(registered.provider, "cliproxy");
    assert.equal(registered.gatewayModel, expected.gatewayModel);
    assert.equal(registered.upstreamModel, expected.upstreamModel);
    assert.equal(registered.upstreamModel.includes("cliproxy/"), false);
  }
});

const { relayAgentPayloadOnce } = await import("../src/routed-agent-relay.mjs");

test.after(() => rmSync(testRoot, { recursive: true, force: true }));

test("relay transport resolves the configured Responses model through the loopback forwarder", () => {
  const transport = resolveProviderRelayTransport({
    apiBase: "http://127.0.0.1:4212/v1",
    internalKey: "router-internal-key",
    env: {
      CODEX_PLUS_ROUTED_AGENT_RELAY: "cliproxy",
      CODEX_PLUS_ROUTED_AGENT_RELAY_MODEL: model.slug,
    },
  });
  assert.equal(transport.url, "http://127.0.0.1:4212/v1/responses");
  assert.equal(transport.providerId, "cliproxy");
  assert.equal(transport.modelSlug.startsWith("cliproxy/"), true);
  assert.notEqual(transport.modelSlug, "gpt-5.6-sol");
  assert.equal(transport.providerEndpoint, "http://127.0.0.1:8317/v1");
  assert.equal(transport.modelSlug, model.slug);
  assert.equal(transport.gatewayModel, model.gatewayModel);
  assert.equal(transport.authorityFingerprint, transport.headers["X-Codex-Relay-Authority"]);
  assert.deepEqual(
    {
      Authorization: transport.headers.Authorization,
      "Content-Type": transport.headers["Content-Type"],
      Accept: transport.headers.Accept,
    },
    {
      Authorization: "Bearer router-internal-key",
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
  );
  assert.equal(transport.headers["X-Codex-Routed-Agent-Relay"], "1");
  assert.match(transport.headers["X-Codex-Relay-Authority"], /^[a-f0-9]{64}$/);
  assert.match(transport.cacheScope, /^routed-relay:/);
  assert.equal(JSON.stringify(transport).includes(providerKey), false);
});

test("routed relay sends only loopback service auth and the invariant encrypted body", async () => {
  const transport = resolveProviderRelayTransport({
    apiBase: "http://127.0.0.1:4212/v1",
    internalKey: "router-internal-key",
    env: {
      CODEX_PLUS_ROUTED_AGENT_RELAY: "cliproxy",
      CODEX_PLUS_ROUTED_AGENT_RELAY_MODEL: model.slug,
    },
  });
  let observed;
  const plaintext = await relayAgentPayloadOnce({
    item: {
      type: "agent_message",
      content: [
        { type: "input_text", text: "Message Type: NEW_TASK\nPayload:\n" },
        { type: "encrypted_content", encrypted_content: "gAAAAA-provider-relay=" },
      ],
    },
    model: transport.gatewayModel,
    url: transport.url,
    headers: transport.headers,
    mode: "routed",
    fetchImpl: async (url, options) => {
      observed = { url, options, body: JSON.parse(options.body) };
      return new Response(JSON.stringify({
        output: [{
          type: "function_call",
          name: "relay_external_agent_payload",
          arguments: JSON.stringify({ payload: "provider plaintext" }),
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });
  assert.equal(plaintext, "provider plaintext");
  assert.equal(observed.url, "http://127.0.0.1:4212/v1/responses");
  assert.equal(observed.options.headers.Authorization, "Bearer router-internal-key");
  assert.equal(observed.options.headers["Content-Type"], "application/json");
  assert.equal(observed.options.headers.Accept, "text/event-stream");
  assert.equal(observed.options.headers["X-Codex-Routed-Agent-Relay"], "1");
  assert.match(observed.options.headers["X-Codex-Relay-Authority"], /^[a-f0-9]{64}$/);
  assert.equal(observed.body.model, model.gatewayModel);
  assert.equal(
    observed.body.input[0].content[1].encrypted_content,
    "gAAAAA-provider-relay=",
  );
});

test("replacing the checked-in provider credential rotates the relay cache authority", () => {
  const options = {
    apiBase: "http://127.0.0.1:4212/v1",
    internalKey: "router-internal-key",
    env: {
      CODEX_PLUS_ROUTED_AGENT_RELAY: "cliproxy",
      CODEX_PLUS_ROUTED_AGENT_RELAY_MODEL: model.slug,
    },
  };
  const before = resolveProviderRelayTransport(options).cacheScope;
  process.env.CLIPROXY_API_KEY = "CLI_PROXY_REPLACEMENT_PROVIDER_KEY";
  const after = resolveProviderRelayTransport(options).cacheScope;
  assert.notEqual(before, after);
  assert.equal(after.includes("CLI_PROXY_REPLACEMENT_PROVIDER_KEY"), false);
});

test("the API-forwarder dispatch snapshot rejects an authority change before sending", () => {
  const registeredModel = MODEL_BY_SLUG.get(model.slug);
  const provider = providerForModel(registeredModel);
  const endpoint = endpointForModel(registeredModel);
  const current = readCheckedInProviderAuthoritySnapshot(provider, endpoint);
  assert.throws(
    () => readCheckedInProviderAuthoritySnapshot(provider, endpoint, undefined, {
      expectedAuthority: `${current.authorityFingerprint.slice(0, -1)}0`,
    }),
    (error) => error?.code === "ROUTED_AGENT_RELAY_AUTHORITY_CHANGED",
  );
});

test("transport fails closed for non-loopback forwarding and missing internal auth", () => {
  const env = {
    CODEX_PLUS_ROUTED_AGENT_RELAY: "cliproxy",
    CODEX_PLUS_ROUTED_AGENT_RELAY_MODEL: model.slug,
  };
  assert.throws(
    () => resolveProviderRelayTransport({
      apiBase: "https://forwarder.example.test/v1",
      internalKey: "router-internal-key",
      env,
    }),
    (error) => error?.code === "ROUTED_AGENT_RELAY_UNAVAILABLE",
  );
  assert.throws(
    () => resolveProviderRelayTransport({
      apiBase: `http://127.0.0.1:${PORTS.router}/v1`,
      internalKey: "router-internal-key",
      env,
    }),
    (error) => error?.code === "ROUTED_AGENT_RELAY_RECURSION",
  );
  assert.throws(
    () => resolveProviderRelayTransport({
      apiBase: "http://127.0.0.1:4212/responses",
      internalKey: "router-internal-key",
      env,
    }),
    (error) => error?.code === "ROUTED_AGENT_RELAY_UNAVAILABLE",
  );
  assert.throws(
    () => resolveProviderRelayTransport({
      apiBase: "http://127.0.0.1:4212/v1",
      internalKey: "",
      env,
    }),
    (error) => error?.code === "ROUTED_AGENT_RELAY_AUTH_UNAVAILABLE",
  );
  delete process.env.CLIPROXY_API_KEY;
  assert.throws(
    () => resolveProviderRelayTransport({
      apiBase: "http://127.0.0.1:4212/v1",
      internalKey: "router-internal-key",
      env,
    }),
    (error) => error?.code === "ROUTED_AGENT_RELAY_AUTH_UNAVAILABLE",
  );
  assert.equal(isRoutedAgentRelayRequest({ "x-codex-routed-agent-relay": "1" }), true);
  assert.equal(isRoutedAgentRelayRequest({}), false);
});
