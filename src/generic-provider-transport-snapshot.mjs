import { providerCatalogIdentityFingerprint } from "./model-catalog-cache.mjs";
import { PROVIDERS } from "./model-registry.mjs";
import { readGenericProviders } from "./generic-provider-state.mjs";
import { readProviderCredentialStore } from "./provider-credential-store.mjs";
import { resolveGenericProviderCredentialReference } from "./provider-credentials.mjs";

function unavailable(message, code = "GENERIC_PROVIDER_TRANSPORT_UNAVAILABLE") {
  const error = new Error(message);
  error.status = 503;
  error.code = code;
  return error;
}

function providerForId(id) {
  return readGenericProviders({ reservedProviderIds: PROVIDERS })
    .find((provider) => provider.id === id);
}

function credentialSecret(provider) {
  if (!provider.credentialRef) return undefined;
  const entry = readProviderCredentialStore().credentials
    .find((candidate) => candidate.id === provider.credentialRef);
  if (
    !entry ||
    entry.state !== "active" ||
    entry.providerType !== "generic" ||
    entry.providerId !== provider.id ||
    entry.kind !== "api_key"
  ) return undefined;
  return resolveGenericProviderCredentialReference(provider.id, entry.secretRef)?.value;
}

function authorityFingerprint(provider, secret) {
  const headerPairs = Object.entries(provider.headers || {})
    .map(([name, value]) => [String(name).toLowerCase(), String(value)])
    .sort(([left], [right]) => left.localeCompare(right));
  return providerCatalogIdentityFingerprint([
    "generic",
    provider.id,
    provider.baseUrl,
    provider.adapter,
    headerPairs,
    secret || null,
  ]);
}

/**
 * Resolve one immutable generic provider transport snapshot. The credential,
 * endpoint, static headers, and authority fingerprint are captured together;
 * callers dispatch with this exact snapshot or fail closed if the expected
 * authority changed between logical phases.
 */
export function resolveGenericProviderTransportSnapshot(
  providerId,
  { expectedAuthority } = {},
) {
  const provider = providerForId(providerId);
  if (!provider) throw unavailable(`Unknown generic provider: ${providerId}.`);
  if (!provider.enabled) throw unavailable(`Generic provider ${provider.id} is disabled.`);
  const secret = credentialSecret(provider);
  if (provider.credentialRef && !secret) {
    throw unavailable(`The bound credential is unavailable for generic provider ${provider.id}.`);
  }
  const fingerprint = authorityFingerprint(provider, secret);
  if (expectedAuthority && expectedAuthority !== fingerprint) {
    throw unavailable(
      `Generic provider ${provider.id} transport authority changed; retry the relay.`,
      "ROUTED_AGENT_RELAY_AUTHORITY_CHANGED",
    );
  }
  const headers = { ...provider.headers };
  if (secret) headers.Authorization = `Bearer ${secret}`;
  return Object.freeze({
    provider: Object.freeze({ ...provider, headers: Object.freeze({ ...provider.headers }) }),
    endpoint: provider.baseUrl,
    headers: Object.freeze(headers),
    authorityFingerprint: fingerprint,
  });
}

export function readGenericProviderAuthoritySnapshot(providerId) {
  const snapshot = resolveGenericProviderTransportSnapshot(providerId);
  return Object.freeze({
    providerId: snapshot.provider.id,
    endpoint: snapshot.endpoint,
    authorityFingerprint: snapshot.authorityFingerprint,
  });
}
