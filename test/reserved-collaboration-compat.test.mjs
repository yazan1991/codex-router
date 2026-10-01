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

test("reserved collaboration alias covers the managed routed GPT workforce only", () => {
  for (const upstreamModel of [
    "gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.6-sol-1m", "gpt-5.6-terra",
    "gpt-6-luna", "gpt-6-sol", "gpt-6.1-sol", "gpt-6-astra",
    "gpt-future-canary",
  ]) {
    const payload = { tools: [{ type: "namespace", name: "collaboration", tools: [] }] };
    const normalized = normalizeReservedCollaborationRequest(payload, {
      model: { provider: "cliproxy", upstreamModel },
      route: "/responses",
    });
    assert.equal(normalized.tools[0].name, "agents");
  }
  const unrelated = { tools: [{ type: "namespace", name: "collaboration", tools: [] }] };
  assert.strictEqual(normalizeReservedCollaborationRequest(unrelated, {
    model: { provider: "cliproxy", upstreamModel: "deepseek-v4-pro" }, route: "/responses",
  }), unrelated);
  assert.strictEqual(normalizeReservedCollaborationRequest(unrelated, {
    model: sol, route: "/chat/completions",
  }), unrelated);
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
