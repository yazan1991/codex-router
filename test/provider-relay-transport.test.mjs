import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const testRoot = mkdtempSync(path.join(os.tmpdir(), "provider-relay-transport-"));
const stateDir = path.join(testRoot, "state");
const providerKey = "CLI_PROXY_PROVIDER_KEY_MUST_NOT_ESCAPE";

mkdirSync(stateDir, { recursive: true });
process.env.CODEX_ROUTER_STATE_DIR = stateDir;
process.env.CLIPROXY_API_KEY = providerKey;
process.env.CLIPROXY_API_BASE_URL = "http://127.0.0.1:8317/v1";

const { MODEL_BY_SLUG } = await import("../src/model-registry.mjs");
const model = MODEL_BY_SLUG.get("cliproxy/gpt-5.6-sol");
assert.ok(model, "checked-in CLIProxy Sol route is missing");
const providerForTest = () => ({
  id: "cliproxy",
  kind: "openai-compatible",
  protocol: "openai-responses",
  baseUrl: "https://router.oloru.com/v1",
  credential: { environment: ["CLIPROXY_API_KEY"], file: "cliproxy-api-key.secret", legacyFiles: [], keychainServices: [] },
});

const {
  resolveProviderRelayTransport,
  isRoutedAgentRelayRequest,
  readCheckedInProviderAuthoritySnapshot,
} = await import("../src/provider-relay-transport.mjs");
const { PORTS } = await import("../src/paths.mjs");
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
  assert.equal(transport.providerEndpoint, readCheckedInProviderAuthoritySnapshot(providerForTest()).endpoint);
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

test("replacing the checked-in CLIProxy credential rotates the relay cache authority", () => {
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

test("the checked-in CLIProxy authority snapshot rejects a credential change", () => {
  const provider = providerForTest();
  const current = readCheckedInProviderAuthoritySnapshot(provider);
  assert.throws(
    () => readCheckedInProviderAuthoritySnapshot(provider, undefined, undefined, {
      expectedAuthority: current.authorityFingerprint.slice(0, -1) + "0",
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
  const savedKey = process.env.CLIPROXY_API_KEY;
  delete process.env.CLIPROXY_API_KEY;
  try {
    assert.throws(
      () => resolveProviderRelayTransport({
        apiBase: "http://127.0.0.1:4212/v1",
        internalKey: "router-internal-key",
        env,
      }),
      (error) => error?.code === "ROUTED_AGENT_RELAY_AUTH_UNAVAILABLE",
    );
  } finally {
    process.env.CLIPROXY_API_KEY = savedKey;
  }

  assert.equal(isRoutedAgentRelayRequest({ "x-codex-routed-agent-relay": "1" }), true);
  assert.equal(isRoutedAgentRelayRequest({}), false);
});
