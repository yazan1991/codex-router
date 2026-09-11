import { routedAgentDefinition } from "./codex-agent-catalog.mjs";
import { CHECKED_IN_MODELS } from "./model-registry.mjs";

// Codex validates spawn_agent.model against a small client-owned enum. A
// routed model slug is an execution identity and does not belong in that enum.
// Only reviewed CLIProxy routes whose explicit upstream model is itself one of
// Codex's supported GPT child models may use the compatibility identity below.
// Other providers and non-GPT CLIProxy routes keep the existing fail-closed
// behavior rather than guessing from a namespace or a display name.
const CLIPROXY_CLIENT_SPAWN_MODELS = new Set([
  "gpt-6-astra",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
]);

function sameRoute(a, b) {
  return String(a?.slug || "").trim() === String(b?.slug || "").trim() &&
    String(a?.provider || "").trim() === String(b?.provider || "").trim() &&
    String(a?.upstreamModel || "").trim() === String(b?.upstreamModel || "").trim();
}

export function routedSubagentModelIdentity(model, { catalog = CHECKED_IN_MODELS } = {}) {
  const provider = String(model?.provider || "").trim();
  const executionRoute = String(model?.slug || "").trim();
  const upstreamModel = String(model?.upstreamModel || "").trim();
  const declaredClientSpawnModel = String(model?.clientSpawnModel || "").trim();
  const clientSpawnModel = declaredClientSpawnModel || upstreamModel;
  const artifact = Array.isArray(catalog)
    ? catalog.find((candidate) => sameRoute(candidate, model))
    : undefined;
  if (
    provider !== "cliproxy" ||
    (artifact?.multiAgentVersion ?? artifact?.multi_agent_version) !== "v2" ||
    !CLIPROXY_CLIENT_SPAWN_MODELS.has(clientSpawnModel) ||
    executionRoute !== `${provider}/${upstreamModel}` ||
    (declaredClientSpawnModel && declaredClientSpawnModel !== upstreamModel)
  ) {
    return undefined;
  }
  const { agentName } = routedAgentDefinition(artifact);
  return Object.freeze({
    clientSpawnModel,
    executionRoute,
    agentType: agentName,
  });
}

export function routedSubagentModelIdentityOrThrow(model, options) {
  const provider = String(model?.provider || "").trim();
  if (provider !== "cliproxy") return undefined;
  const identity = routedSubagentModelIdentity(model, options);
  if (identity) return identity;
  const error = new Error(
    `CLIProxy routed subagent identity is unavailable for ${String(model?.slug || "<missing>")}; refusing native fallback.`,
  );
  error.code = "ROUTED_SPAWN_IDENTITY_UNAVAILABLE";
  error.status = 502;
  throw error;
}
