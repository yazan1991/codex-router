import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const catalog = fs.readFileSync(
  new URL("../src/catalog.mjs", import.meta.url),
  "utf8",
);

const forwarder = fs.readFileSync(
  new URL("../src/api-forwarder.mjs", import.meta.url),
  "utf8",
);

const router = fs.readFileSync(new URL("../src/router.mjs", import.meta.url), "utf8");
const relayTransport = fs.readFileSync(
  new URL("../src/provider-relay-transport.mjs", import.meta.url),
  "utf8",
);
const relaySemantics = fs.readFileSync(
  new URL("../src/routed-agent-relay.mjs", import.meta.url),
  "utf8",
);
const cliProxyProviderDocument = JSON.parse(fs.readFileSync(
  new URL("../config/cliproxy/cliproxy.json", import.meta.url),
  "utf8",
));
const serviceSources = ["linux", "macos", "windows"].map((platform) =>
  fs.readFileSync(new URL(`../src/service-${platform}.mjs`, import.meta.url), "utf8")
);

test("CLIProxy remains a checked-in routed provider", () => {
  const [provider] = cliProxyProviderDocument.providers;
  assert.equal(cliProxyProviderDocument.version, 1);
  assert.equal(cliProxyProviderDocument.providers.length, 1);
  assert.equal(provider.id, "cliproxy");
  assert.equal(provider.kind, "openai-compatible");
  assert.equal(provider.protocol, "openai-responses");
  assert.equal(provider.baseUrl, "https://router.oloru.com/v1");
  assert.equal(provider.baseUrlEnv, "CLIPROXY_API_BASE_URL");
  assert.deepEqual(provider.credential.environment, ["CLIPROXY_API_KEY"]);
  assert.equal(provider.credential.file, "cliproxy-api-key.secret");
});

test("CLIProxy native GPT parity remains narrowly scoped", () => {
  for (const slug of [
    "cliproxy/gpt-5.6-sol",
    "cliproxy/gpt-5.6-terra",
    "cliproxy/gpt-5.6-luna",
    "cliproxy/gpt-6-astra",
  ]) {
    assert.ok(catalog.includes(slug), `missing parity route: ${slug}`);
  }

  for (const capability of [
    "include_skills_usage_instructions",
    "include_plugin_usage_instructions",
    "include_apps_usage_instructions",
    "tool_mode",
    "support_verbosity",
    "default_verbosity",
    "supports_image_detail_original",
  ]) {
    assert.ok(
      catalog.includes(`"${capability}"`),
      `missing native capability: ${capability}`,
    );
  }

  assert.match(
    catalog,
    /if\s*\(!cliProxyNativeParity\)\s*delete next\.tool_mode;/,
  );
});

test("CLIProxy strips only ChatGPT private message metadata at compatibility boundary", () => {
  const helperMatch = forwarder.match(
    /function stripInternalChatMessageMetadataPassthrough\(payload\) \{[\s\S]*?\n\}/,
  );

  assert.ok(helperMatch, "metadata compatibility helper is missing");

  const helper = helperMatch[0];

  assert.match(
    helper,
    /internal_chat_message_metadata_passthrough/,
  );

  assert.match(
    helper,
    /delete item\.internal_chat_message_metadata_passthrough/,
  );

  assert.doesNotMatch(helper, /image_generation/);
  assert.doesNotMatch(helper, /\btools\b/);
  assert.doesNotMatch(helper, /\bmessages\b/);
  assert.doesNotMatch(helper, /\breasoning\b/);

  assert.match(
    forwarder,
    /provider\.id\s*===\s*"cliproxy"[\s\S]*?stripInternalChatMessageMetadataPassthrough\(payload\)/,
  );
  assert.match(forwarder, /payload\.model = model\.upstreamModel;/);
});

test("Codex++ routed collaboration relay remains opt-in and transport-isolated", () => {
  assert.match(relayTransport, /CODEX_PLUS_ROUTED_AGENT_RELAY/);
  assert.match(relayTransport, /if \(!config\.enabled\) return undefined/);
  assert.match(relayTransport, /providerId !== config\.providerId/);
  assert.match(relayTransport, /provider\.protocol !== "openai-responses"/);
  assert.match(
    relayTransport,
    /provider\.generic === true[\s\S]*?readGenericProviderAuthoritySnapshot[\s\S]*?readCheckedInProviderAuthoritySnapshot/,
  );
  assert.match(relayTransport, /requires a loopback API-forwarder base URL/);
  assert.match(relayTransport, /apiForwarderBaseUrl/);
  assert.match(relayTransport, /PORTS\.router/);
  assert.match(router, /ROUTED_AGENT_RELAY_RECURSION/);
  assert.match(router, /isRoutedAgentRelayRequest\(request\.headers\)/);
  assert.doesNotMatch(relayTransport, /nativeTarget|nativeRelayContext/);

  assert.match(router, /routedTransport[\s\S]*?: nativeRelayContext\(request\)/);
  assert.doesNotMatch(
    router,
    /relayAgentPayloadOnce\([\s\S]*?catch[\s\S]*?nativeRelayContext\(request\)/,
  );

  assert.match(relaySemantics, /stream: true/);
  assert.match(relaySemantics, /store: false/);
  assert.match(relaySemantics, /relay_external_agent_payload/);
  assert.doesNotMatch(relaySemantics, /image_generation/);

  for (const service of serviceSources) {
    assert.match(service, /CODEX_PLUS_ROUTED_AGENT_RELAY/);
    assert.match(service, /CODEX_PLUS_ROUTED_AGENT_RELAY_MODEL/);
  }
});
