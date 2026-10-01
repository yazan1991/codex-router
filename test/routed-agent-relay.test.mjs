import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAgentRelayBody,
  encryptedAgentPayload,
  relayAgentPayloadOnce,
} from "../src/routed-agent-relay.mjs";
import { normalizeOpenAIRequest } from "../src/openai-adapters.mjs";
import {
  DEFAULT_ROUTED_AGENT_RELAY_MODEL,
  providerRelayAuthorityScope,
  routedAgentRelayConfig,
} from "../src/provider-relay-transport.mjs";

const encrypted = "gAAAAA-byte_string_MUST_stay_identical==";
const item = {
  type: "agent_message",
  content: [
    { type: "input_text", text: "Message Type: NEW_TASK\nPayload:\n" },
    { type: "encrypted_content", encrypted_content: encrypted },
    { type: "image_generation", id: "image-tool-state" },
  ],
};

test("relay body preserves the collaboration payload and tool contract", () => {
  const before = structuredClone(item);
  const body = buildAgentRelayBody({ model: "relay-model", item });
  assert.deepEqual(item, before);
  assert.equal(encryptedAgentPayload(item).content, encrypted);
  assert.equal(body.input[0].content[1].encrypted_content, encrypted);
  assert.deepEqual(body.input[0].content[2], { type: "image_generation", id: "image-tool-state" });
  assert.equal(body.stream, true);
  assert.equal(body.store, false);
  assert.equal(body.tools.length, 1);
  assert.equal(body.tools[0].name, "relay_external_agent_payload");
  assert.deepEqual(body.tool_choice, {
    type: "function",
    name: "relay_external_agent_payload",
  });
});

test("the Responses provider adapter preserves encrypted collaboration items exactly", () => {
  const body = buildAgentRelayBody({ model: "cliproxy-gpt-5-6-sol", item });
  const normalized = normalizeOpenAIRequest(body);
  assert.equal(normalized.input[0].content[1].encrypted_content, encrypted);
  assert.deepEqual(normalized.input[0], item);
  assert.deepEqual(normalized.tools, body.tools);
  assert.deepEqual(normalized.tool_choice, body.tool_choice);
  assert.equal(normalized.stream, true);
  assert.equal(normalized.store, false);
});

test("relay request preserves native body semantics and parses a streamed tool result", async () => {
  let observed;
  const plaintext = await relayAgentPayloadOnce({
    item,
    model: "gpt-5.6-sol",
    url: "https://native.example.test/responses",
    headers: {
      Authorization: "Bearer native-session",
      "ChatGPT-Account-Id": "native-account",
    },
    mode: "native",
    fetchImpl: async (url, options) => {
      observed = { url, options, body: JSON.parse(options.body) };
      return new Response(
        `event: response.function_call_arguments.done\ndata: ${JSON.stringify({
          type: "response.function_call_arguments.done",
          arguments: JSON.stringify({ payload: "exact plaintext" }),
        })}\n\ndata: [DONE]\n\n`,
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      );
    },
  });
  assert.equal(plaintext, "exact plaintext");
  assert.equal(observed.url, "https://native.example.test/responses");
  assert.equal(observed.options.headers.Authorization, "Bearer native-session");
  assert.equal(observed.options.headers["ChatGPT-Account-Id"], "native-account");
  assert.equal(observed.options.headers.Accept, "text/event-stream");
  assert.equal(observed.body.input[0].content[1].encrypted_content, encrypted);
  assert.equal(observed.body.tool_choice.name, "relay_external_agent_payload");
});

test("routed relay is off by default and accepts only the explicit cliproxy mode", () => {
  assert.deepEqual(routedAgentRelayConfig({}), { enabled: false });
  assert.deepEqual(routedAgentRelayConfig({ CODEX_PLUS_ROUTED_AGENT_RELAY: "off" }), {
    enabled: false,
  });
  assert.deepEqual(routedAgentRelayConfig({ CODEX_PLUS_ROUTED_AGENT_RELAY: "cliproxy" }), {
    enabled: true,
    valid: true,
    providerId: "cliproxy",
    modelSlug: DEFAULT_ROUTED_AGENT_RELAY_MODEL,
  });
  assert.equal(
    routedAgentRelayConfig({ CODEX_PLUS_ROUTED_AGENT_RELAY: "unknown" }).valid,
    false,
  );
});

test("native and routed cache authorities cannot collide", () => {
  const first = providerRelayAuthorityScope({
    providerId: "cliproxy",
    endpointId: "cliproxy",
    baseUrl: "http://127.0.0.1:8317/v1",
    credentialAuthority: "credential-fingerprint-first",
    gatewayModel: "cliproxy-gpt-5-6-sol",
  });
  const second = providerRelayAuthorityScope({
    providerId: "cliproxy",
    endpointId: "cliproxy",
    baseUrl: "http://127.0.0.1:8317/v1",
    credentialAuthority: "credential-fingerprint-second",
    gatewayModel: "cliproxy-gpt-5-6-sol",
  });
  assert.match(first, /^routed-relay:/);
  assert.notEqual(first, second);
  assert.notEqual(first, `native:${first.slice("routed-relay:".length)}`);
  assert.equal(first.includes("credential-fingerprint-first"), false);
});

test("routed relay classifies authentication, decrypt, upstream, and protocol failures", async () => {
  const request = {
    item,
    model: "relay-model",
    url: "http://127.0.0.1/v1/responses",
    headers: { Authorization: "Bearer local-only" },
    mode: "routed",
  };
  for (const [status, code] of [
    [401, "ROUTED_AGENT_RELAY_AUTH_UNAVAILABLE"],
    [422, "ROUTED_AGENT_RELAY_DECRYPT_REJECTED"],
    [503, "ROUTED_AGENT_RELAY_UPSTREAM_ERROR"],
  ]) {
    await assert.rejects(
      () => relayAgentPayloadOnce({
        ...request,
        fetchImpl: async () => new Response("{}", {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      }),
      (error) => error?.status === 502 && error?.code === code,
    );
  }
  await assert.rejects(
    () => relayAgentPayloadOnce({
      ...request,
      fetchImpl: async () => new Response(JSON.stringify({
        error: { code: "ROUTED_AGENT_RELAY_AUTHORITY_CHANGED" },
      }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }),
    }),
    (error) => error?.code === "ROUTED_AGENT_RELAY_AUTHORITY_CHANGED",
  );
  await assert.rejects(
    () => relayAgentPayloadOnce({
      ...request,
      fetchImpl: async () => new Response(JSON.stringify({ output: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    }),
    (error) => error?.status === 502 && error?.code === "ROUTED_AGENT_RELAY_PROTOCOL_ERROR",
  );
});

test("a recursive Router target is classified and never retried through native relay", async () => {
  let calls = 0;
  await assert.rejects(
    () => relayAgentPayloadOnce({
      item,
      model: "cliproxy-gpt-5-6-sol",
      url: "http://127.0.0.1:4202/v1/responses",
      headers: { Authorization: "Bearer router-internal-key" },
      mode: "routed",
      fetchImpl: async () => {
        calls += 1;
        return new Response(JSON.stringify({
          error: { code: "ROUTED_AGENT_RELAY_RECURSION" },
        }), { status: 508, headers: { "Content-Type": "application/json" } });
      },
    }),
    (error) => error?.code === "ROUTED_AGENT_RELAY_RECURSION" && error?.status === 502,
  );
  assert.equal(calls, 1);
});
