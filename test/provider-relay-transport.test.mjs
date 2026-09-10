import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const testRoot = mkdtempSync(path.join(os.tmpdir(), "provider-relay-transport-"));
const stateDir = path.join(testRoot, "state");
const providersFile = path.join(stateDir, "generic-providers.json");
const userModelsFile = path.join(stateDir, "user-models.json");
const credentialStoreFile = path.join(stateDir, "provider-credentials.json");
const credentialId = "cred_cliproxy_relay_01";
const providerKey = "CLI_PROXY_PROVIDER_KEY_MUST_NOT_ESCAPE";

mkdirSync(stateDir, { recursive: true });
process.env.CODEX_ROUTER_STATE_DIR = stateDir;
process.env.MODEL_ROUTER_GENERIC_PROVIDERS = providersFile;
process.env.MODEL_ROUTER_USER_MODELS = userModelsFile;
process.env.MODEL_ROUTER_PROVIDER_CREDENTIAL_STORE = credentialStoreFile;

const { userModelEntry } = await import("../src/user-models.mjs");
const model = userModelEntry({
  providerId: "cliproxy",
  upstreamId: "gpt-5.6-sol",
  priority: 100,
});
writeFileSync(providersFile, `${JSON.stringify({
  version: 1,
  providers: [{
    id: "cliproxy",
    displayName: "CLIProxy",
    baseUrl: "http://127.0.0.1:8317/v1",
    adapter: "openai-responses",
    headers: { "X-CLIProxy-Route": "chatgpt-team" },
    credentialRef: credentialId,
    allowPrivate: true,
    enabled: true,
  }],
})}\n`);
writeFileSync(userModelsFile, `${JSON.stringify({ version: 1, models: [model] })}\n`);

const { addGenericProviderCredentialReference } = await import(
  "../src/provider-credential-store.mjs"
);
const {
  genericProviderCredentialPath,
  writeGenericProviderCredential,
} = await import("../src/provider-credentials.mjs");
addGenericProviderCredentialReference({
  id: credentialId,
  providerId: "cliproxy",
  kind: "api_key",
});
writeGenericProviderCredential("cliproxy", providerKey);

const {
  resolveProviderRelayTransport,
  isRoutedAgentRelayRequest,
} = await import("../src/provider-relay-transport.mjs");
const { resolveGenericProviderTransportSnapshot } = await import(
  "../src/generic-provider-transport-snapshot.mjs"
);
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
  assert.equal(JSON.stringify(transport).includes(credentialId), false);
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

test("replacing the credential behind one opaque reference rotates the relay cache authority", () => {
  const options = {
    apiBase: "http://127.0.0.1:4212/v1",
    internalKey: "router-internal-key",
    env: {
      CODEX_PLUS_ROUTED_AGENT_RELAY: "cliproxy",
      CODEX_PLUS_ROUTED_AGENT_RELAY_MODEL: model.slug,
    },
  };
  const before = resolveProviderRelayTransport(options).cacheScope;
  writeGenericProviderCredential("cliproxy", "CLI_PROXY_REPLACEMENT_PROVIDER_KEY");
  const after = resolveProviderRelayTransport(options).cacheScope;
  assert.notEqual(before, after);
  assert.equal(after.includes("CLI_PROXY_REPLACEMENT_PROVIDER_KEY"), false);
});

test("the API-forwarder dispatch snapshot rejects an authority change before sending", () => {
  const current = resolveGenericProviderTransportSnapshot("cliproxy");
  assert.throws(
    () => resolveGenericProviderTransportSnapshot("cliproxy", {
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
  unlinkSync(genericProviderCredentialPath("cliproxy"));
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
