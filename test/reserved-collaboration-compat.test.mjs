import assert from "node:assert/strict";
import test from "node:test";
import { normalizeReservedCollaborationRequest } from "../src/reserved-collaboration-compat.mjs";

const sol = { provider: "cliproxy", upstreamModel: "gpt-6.1-sol" };

test("CLIProxy Sol 6.1 aliases collaboration to agents without changing child schemas", () => {
  const wait = {
    type: "function",
    name: "wait_agent",
    parameters: { type: "object", properties: { target: { type: "string", encrypted: true } } },
  };
  const payload = {
    tools: [{ type: "namespace", name: "collaboration", tools: [wait] }],
    input: [{ type: "function_call", namespace: "collaboration", name: "wait_agent", arguments: "{}" }],
    tool_choice: { type: "function", namespace: "collaboration", name: "wait_agent" },
  };
  const normalized = normalizeReservedCollaborationRequest(payload, { model: sol, route: "/responses" });
  assert.equal(normalized.tools[0].name, "agents");
  assert.strictEqual(normalized.tools[0].tools[0], wait);
  assert.deepEqual(normalized.input[0], { ...payload.input[0], namespace: "agents" });
  assert.deepEqual(normalized.tool_choice, { ...payload.tool_choice, namespace: "agents" });
  assert.equal(payload.tools[0].name, "collaboration");
});

test("reserved collaboration alias is bounded to CLIProxy Sol 6.1 Responses", () => {
  const payload = { tools: [{ type: "namespace", name: "collaboration", tools: [] }] };
  assert.strictEqual(normalizeReservedCollaborationRequest(payload, {
    model: { provider: "cliproxy", upstreamModel: "gpt-6-luna" }, route: "/responses",
  }), payload);
  assert.strictEqual(normalizeReservedCollaborationRequest(payload, {
    model: sol, route: "/chat/completions",
  }), payload);
});

test("reserved collaboration alias fails closed on an existing agents namespace", () => {
  const payload = { tools: [
    { type: "namespace", name: "collaboration", tools: [] },
    { type: "namespace", name: "agents", tools: [] },
  ] };
  assert.throws(
    () => normalizeReservedCollaborationRequest(payload, { model: sol, route: "/responses" }),
    /conflicts with an existing agents namespace/,
  );
});
