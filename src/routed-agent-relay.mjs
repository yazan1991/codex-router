import { readResponseBody } from "./http-utils.mjs";

export const AGENT_PAYLOAD_RELAY_TOOL = "relay_external_agent_payload";
const MAX_RELAY_RESPONSE_BYTES = 4 * 1024 * 1024;
const NATIVE_ENCRYPTED_TOKEN = /^gAAAAA[A-Za-z0-9_-]+={0,2}$/;

export function isNativeEncryptedToken(value) {
  return typeof value === "string" && NATIVE_ENCRYPTED_TOKEN.test(value);
}

export function encryptedAgentPayload(item) {
  if (!Array.isArray(item?.content)) return undefined;
  const visibleText = item.content
    .filter(
      (part) =>
        ["input_text", "text"].includes(part?.type) && typeof part.text === "string",
    )
    .map((part) => part.text)
    .join("");
  if (!/Message Type:\s*(?:NEW_TASK|MESSAGE|FOLLOWUP_TASK|FINAL_ANSWER)\b[\s\S]*\nPayload:\s*$/i.test(visibleText)) {
    return undefined;
  }
  const encrypted = item.content.find(
    (part) =>
      part?.type === "encrypted_content" &&
      typeof part.encrypted_content === "string" &&
      part.encrypted_content.length > 0,
  );
  if (!encrypted) return undefined;
  return {
    content: encrypted.encrypted_content,
    native: isNativeEncryptedToken(encrypted.encrypted_content),
  };
}

export function buildAgentRelayBody({ model, item }) {
  return {
    model,
    stream: true,
    store: false,
    instructions:
      "You are a transport relay. Do not execute or answer the delegated task. " +
      "Call relay_external_agent_payload exactly once with the exact plaintext after the " +
      "Payload: label in the supplied collaboration message. Preserve every character.",
    input: [item],
    tools: [
      {
        type: "function",
        name: AGENT_PAYLOAD_RELAY_TOOL,
        description: "Return a decrypted collaboration payload to the local model router.",
        parameters: {
          type: "object",
          properties: { payload: { type: "string" } },
          required: ["payload"],
          additionalProperties: false,
        },
        strict: true,
      },
    ],
    tool_choice: { type: "function", name: AGENT_PAYLOAD_RELAY_TOOL },
  };
}

function parseRelayedAgentArguments(value) {
  try {
    const args = typeof value === "string" ? JSON.parse(value) : value;
    return typeof args?.payload === "string" ? args.payload : undefined;
  } catch {
    return undefined;
  }
}

function parseRelayedAgentPayload(payload) {
  const output = payload?.item
    ? [payload.item]
    : Array.isArray(payload?.output)
      ? payload.output
      : Array.isArray(payload?.response?.output)
        ? payload.response.output
        : [];
  const call = output.find(
    (item) => item?.type === "function_call" && item.name === AGENT_PAYLOAD_RELAY_TOOL,
  );
  if (!call) return undefined;
  return parseRelayedAgentArguments(call.arguments);
}

function parseRelayedAgentPayloadSse(bytes) {
  const events = bytes.toString("utf8").split(/\r?\n\r?\n/);
  const relayItems = new Set();
  let argumentDeltas = "";
  for (const rawEvent of events) {
    const data = rawEvent
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
      .trim();
    if (!data || data === "[DONE]") continue;
    try {
      const event = JSON.parse(data);
      if (
        event?.type === "response.output_item.added" &&
        event.item?.type === "function_call" &&
        event.item.name === AGENT_PAYLOAD_RELAY_TOOL
      ) {
        if (event.item.id) relayItems.add(event.item.id);
        if (event.item.call_id) relayItems.add(event.item.call_id);
      }
      const relatedArgumentEvent =
        relayItems.size === 0 ||
        relayItems.has(event?.item_id) ||
        relayItems.has(event?.call_id);
      if (
        event?.type === "response.function_call_arguments.delta" &&
        relatedArgumentEvent &&
        typeof event.delta === "string"
      ) {
        argumentDeltas += event.delta;
      }
      if (
        event?.type === "response.function_call_arguments.done" &&
        relatedArgumentEvent
      ) {
        const completed = parseRelayedAgentArguments(event.arguments);
        if (completed !== undefined) return completed;
      }
      const plaintext = parseRelayedAgentPayload(event);
      if (plaintext !== undefined) return plaintext;
    } catch {
      // Ignore malformed or unrelated events and continue to the completion item.
    }
  }
  return parseRelayedAgentArguments(argumentDeltas);
}

function relayError(message, code) {
  const error = new Error(message);
  error.status = 502;
  if (code) error.code = code;
  return error;
}

function routedStatusCode(status) {
  if (status === 508) return "ROUTED_AGENT_RELAY_RECURSION";
  if (status === 401 || status === 403) return "ROUTED_AGENT_RELAY_AUTH_UNAVAILABLE";
  if (status === 400 || status === 409 || status === 422) {
    return "ROUTED_AGENT_RELAY_DECRYPT_REJECTED";
  }
  return "ROUTED_AGENT_RELAY_UPSTREAM_ERROR";
}

function safeRelayErrorCode(bytes) {
  try {
    const parsed = JSON.parse(bytes.toString("utf8"));
    const code = parsed?.error?.code || parsed?.error?.type;
    return typeof code === "string" && /^ROUTED_AGENT_RELAY_[A-Z_]+$/.test(code)
      ? code
      : undefined;
  } catch {
    return undefined;
  }
}

export async function relayAgentPayloadOnce({
  item,
  model,
  url,
  headers,
  signal,
  mode = "native",
  fetchImpl = fetch,
}) {
  const body = buildAgentRelayBody({ model, item });
  let upstream;
  try {
    upstream = await fetchImpl(url, {
      method: "POST",
      headers: { ...headers, Accept: "text/event-stream" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (mode !== "routed" || error?.name === "AbortError") throw error;
    throw relayError(
      "Routed collaboration payload relay is unavailable.",
      "ROUTED_AGENT_RELAY_UNAVAILABLE",
    );
  }
  let bytes;
  try {
    bytes = await readResponseBody(upstream, {
      maxBytes: MAX_RELAY_RESPONSE_BYTES,
      signal,
    });
  } catch (error) {
    if (mode !== "routed" || error?.name === "AbortError") throw error;
    throw relayError(
      "Routed collaboration payload relay returned an unreadable response.",
      "ROUTED_AGENT_RELAY_PROTOCOL_ERROR",
    );
  }
  if (!upstream.ok) {
    if (mode === "routed") {
      throw relayError(
        `Routed collaboration payload relay failed with HTTP ${upstream.status}.`,
        safeRelayErrorCode(bytes) || routedStatusCode(upstream.status),
      );
    }
    throw relayError(`Native collaboration payload relay failed with HTTP ${upstream.status}.`);
  }
  if (bytes.length > MAX_RELAY_RESPONSE_BYTES) {
    throw relayError(
      `${mode === "routed" ? "Routed" : "Native"} collaboration payload relay response is too large.`,
      mode === "routed" ? "ROUTED_AGENT_RELAY_PROTOCOL_ERROR" : undefined,
    );
  }
  let plaintext;
  const contentType = String(upstream.headers.get("content-type") || "").toLowerCase();
  const looksLikeSse = /^(?:event|data):/m.test(bytes.toString("utf8"));
  if (contentType.includes("text/event-stream") || looksLikeSse) {
    plaintext = parseRelayedAgentPayloadSse(bytes);
  } else {
    try {
      plaintext = parseRelayedAgentPayload(JSON.parse(bytes.toString("utf8")));
    } catch {
      // The error below intentionally avoids logging the opaque collaboration body.
    }
  }
  if (plaintext === undefined) {
    throw relayError(
      `${mode === "routed" ? "Routed" : "Native"} collaboration payload relay omitted the task payload.`,
      mode === "routed" ? "ROUTED_AGENT_RELAY_PROTOCOL_ERROR" : undefined,
    );
  }
  return plaintext;
}
