import { createHash } from "node:crypto";

import {
  MODEL_BY_SLUG,
  endpointForModel,
  providerForModel,
} from "./model-registry.mjs";
import { canonicalProviderId } from "./provider-selection.mjs";
import { PORTS } from "./paths.mjs";
import { readGenericProviderAuthoritySnapshot } from "./generic-provider-transport-snapshot.mjs";

export const ROUTED_AGENT_RELAY_FLAG = "CODEX_PLUS_ROUTED_AGENT_RELAY";
export const ROUTED_AGENT_RELAY_MODEL_FLAG = "CODEX_PLUS_ROUTED_AGENT_RELAY_MODEL";
export const ROUTED_AGENT_RELAY_MARKER_HEADER = "X-Codex-Routed-Agent-Relay";
export const ROUTED_AGENT_RELAY_AUTHORITY_HEADER = "X-Codex-Relay-Authority";
export const DEFAULT_ROUTED_AGENT_RELAY_MODEL = "cliproxy/gpt-5.6-sol";

export function isRoutedAgentRelayRequest(headers = {}) {
  return String(headers[ROUTED_AGENT_RELAY_MARKER_HEADER.toLowerCase()] || "") === "1";
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function safeDiagnostic(value) {
  const normalized = text(value);
  return /^[A-Za-z0-9._/-]{1,160}$/.test(normalized) ? normalized : undefined;
}

function unavailable(
  message,
  code = "ROUTED_AGENT_RELAY_UNAVAILABLE",
  { providerId, modelSlug } = {},
) {
  const error = new Error(message);
  error.status = 502;
  error.code = code;
  error.relayProviderId = safeDiagnostic(providerId);
  error.relayModelSlug = safeDiagnostic(modelSlug);
  return error;
}

function loopbackUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return undefined;
  }
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!["127.0.0.1", "::1", "localhost"].includes(hostname)) return undefined;
  if (!["http:", "https:"].includes(parsed.protocol)) return undefined;
  if (parsed.username || parsed.password || parsed.search || parsed.hash) return undefined;
  return parsed;
}

function apiForwarderBaseUrl(value) {
  const parsed = loopbackUrl(value);
  if (!parsed || !/^\/v1\/?$/.test(parsed.pathname)) return undefined;
  const effectivePort = parsed.port || (parsed.protocol === "https:" ? "443" : "80");
  if (effectivePort === String(PORTS.router)) return { recursion: true };
  parsed.pathname = "/v1";
  return { url: parsed };
}

export function routedAgentRelayConfig(env = process.env) {
  const raw = text(env[ROUTED_AGENT_RELAY_FLAG]);
  if (!raw || ["0", "false", "off"].includes(raw.toLowerCase())) {
    return { enabled: false };
  }
  if (raw.toLowerCase() !== "cliproxy") {
    return {
      enabled: true,
      valid: false,
      providerId: raw.toLowerCase(),
      modelSlug: text(env[ROUTED_AGENT_RELAY_MODEL_FLAG]) || DEFAULT_ROUTED_AGENT_RELAY_MODEL,
    };
  }
  return {
    enabled: true,
    valid: true,
    providerId: "cliproxy",
    modelSlug: text(env[ROUTED_AGENT_RELAY_MODEL_FLAG]) || DEFAULT_ROUTED_AGENT_RELAY_MODEL,
  };
}

export function providerRelayAuthorityScope({
  providerId,
  endpointId,
  baseUrl,
  credentialAuthority,
  gatewayModel,
}) {
  const digest = createHash("sha256")
    .update(String(providerId || ""))
    .update("\0")
    .update(String(endpointId || ""))
    .update("\0")
    .update(String(baseUrl || ""))
    .update("\0")
    .update(String(credentialAuthority || "anonymous"))
    .update("\0")
    .update(String(gatewayModel || ""))
    .digest("base64url");
  return `routed-relay:${digest}`;
}

export function resolveProviderRelayTransport({
  apiBase,
  internalKey,
  env = process.env,
} = {}) {
  const config = routedAgentRelayConfig(env);
  if (!config.enabled) return undefined;
  const fail = (message, code) => unavailable(message, code, {
    providerId: config.providerId,
    modelSlug: config.modelSlug,
  });
  if (!config.valid) {
    throw fail(
      `Unsupported routed collaboration relay provider: ${config.providerId || "missing"}.`,
    );
  }
  const route = MODEL_BY_SLUG.get(config.modelSlug);
  if (!route) {
    throw fail(`Routed collaboration relay model is not registered: ${config.modelSlug}.`);
  }
  const provider = providerForModel(route);
  const providerId = canonicalProviderId(provider?.id || "");
  if (
    !provider ||
    provider.kind !== "openai-compatible" ||
    providerId !== config.providerId ||
    provider.protocol !== "openai-responses"
  ) {
    throw fail(
      `Routed collaboration relay model ${config.modelSlug} is not a ${config.providerId} Responses route.`,
    );
  }
  // Codex++ V1 deliberately targets the operator-defined CLIProxy boundary.
  // A future checked-in provider must define its credential/pool cache authority
  // explicitly before it can use decrypted relay results.
  if (provider.generic !== true || provider.enabled === false) {
    throw fail(
      `Routed collaboration relay provider ${providerId} is unavailable or not operator-defined.`,
    );
  }
  let authority;
  try {
    authority = readGenericProviderAuthoritySnapshot(provider.id);
  } catch {
    throw fail(
      `Routed collaboration relay credential is unavailable for ${providerId}.`,
      "ROUTED_AGENT_RELAY_AUTH_UNAVAILABLE",
    );
  }
  if (!authority) throw fail(`Routed collaboration relay credential is unavailable for ${providerId}.`, "ROUTED_AGENT_RELAY_AUTH_UNAVAILABLE");
  const endpoint = endpointForModel(route);
  const parsedBaseResult = apiForwarderBaseUrl(text(apiBase).replace(/\/+$/, ""));
  if (parsedBaseResult?.recursion) {
    throw fail(
      "Routed collaboration relay target resolves to the Router itself.",
      "ROUTED_AGENT_RELAY_RECURSION",
    );
  }
  const parsedBase = parsedBaseResult?.url;
  if (!parsedBase) {
    throw fail("Routed collaboration relay requires a loopback API-forwarder base URL.");
  }
  const key = text(internalKey);
  if (!key) {
    throw fail(
      "Routed collaboration relay cannot authenticate to the API forwarder.",
      "ROUTED_AGENT_RELAY_AUTH_UNAVAILABLE",
    );
  }
  const basePath = parsedBase.pathname.replace(/\/+$/, "");
  parsedBase.pathname = `${basePath}/responses`;
  return {
    url: parsedBase.toString(),
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      [ROUTED_AGENT_RELAY_MARKER_HEADER]: "1",
      [ROUTED_AGENT_RELAY_AUTHORITY_HEADER]: authority.authorityFingerprint,
    },
    providerId,
    providerEndpoint: endpoint?.baseUrl || provider.baseUrl,
    authorityFingerprint: authority.authorityFingerprint,
    modelSlug: route.slug,
    gatewayModel: route.gatewayModel,
    cacheScope: providerRelayAuthorityScope({
      providerId,
      endpointId: endpoint?.id,
      baseUrl: authority.endpoint,
      credentialAuthority: authority.authorityFingerprint,
      gatewayModel: route.gatewayModel,
    }),
  };
}
