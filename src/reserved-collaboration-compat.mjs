const ROUTED_GPT_RESERVED_COLLABORATION_MODELS = new Set([
  "gpt-6-luna",
  "gpt-6.1-sol",
  "gpt-6-astra",
]);

function usesReservedCollaborationAlias(model, route) {
  return model?.provider === "cliproxy" &&
    ROUTED_GPT_RESERVED_COLLABORATION_MODELS.has(model?.upstreamModel) &&
    route === "/responses";
}

export function normalizeReservedCollaborationRequest(payload, { model, route } = {}) {
  if (!usesReservedCollaborationAlias(model, route) ||
      !payload || typeof payload !== "object" || !Array.isArray(payload.tools)) {
    return payload;
  }
  const hasCollaboration = payload.tools.some(
    (tool) => tool?.type === "namespace" && tool.name === "collaboration",
  );
  if (!hasCollaboration) return payload;
  const hasAgents = payload.tools.some(
    (tool) => tool?.type === "namespace" && tool.name === "agents",
  );
  if (hasAgents) {
    const error = new Error("Reserved collaboration alias conflicts with an existing agents namespace.");
    error.status = 400;
    throw error;
  }
  const tools = payload.tools.map((tool) =>
    tool?.type === "namespace" && tool.name === "collaboration"
      ? { ...tool, name: "agents" }
      : tool
  );
  const normalized = { ...payload, tools };
  if (Array.isArray(payload.input)) {
    normalized.input = payload.input.map((item) =>
      item?.type === "function_call" && item.namespace === "collaboration"
        ? { ...item, namespace: "agents" }
        : item
    );
  }
  if (payload.tool_choice?.type === "function" &&
      payload.tool_choice.namespace === "collaboration") {
    normalized.tool_choice = { ...payload.tool_choice, namespace: "agents" };
  }
  return normalized;
}
