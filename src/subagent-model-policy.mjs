export const SUBAGENT_MODEL_POLICIES = Object.freeze(["inherit", "same-family"]);

// This table is reviewed Router source, not model-catalog or user configuration
// data. Matching the exact provider and upstream route prevents a user-created
// model record from borrowing a family merely by reusing a public slug.
const REVIEWED_SUBAGENT_ROUTE_METADATA = new Map([
  ["chatgpt-web/light", Object.freeze({ provider: "chatgpt-web", upstreamModel: "chatgpt-web/light", subagentFamilyId: "chatgpt-web/sol", subagentTier: 0 })],
  ["chatgpt-web/medium", Object.freeze({ provider: "chatgpt-web", upstreamModel: "chatgpt-web/medium", subagentFamilyId: "chatgpt-web/sol", subagentTier: 1 })],
  ["chatgpt-web/high", Object.freeze({ provider: "chatgpt-web", upstreamModel: "chatgpt-web/high", subagentFamilyId: "chatgpt-web/sol", subagentTier: 2 })],
  ["chatgpt-web/extra-high", Object.freeze({ provider: "chatgpt-web", upstreamModel: "chatgpt-web/extra-high", subagentFamilyId: "chatgpt-web/sol", subagentTier: 3 })],
  ["chatgpt-web/pro", Object.freeze({ provider: "chatgpt-web", upstreamModel: "chatgpt-web/pro", subagentFamilyId: "chatgpt-web/sol", subagentTier: 4 })],
]);

export function reviewedSubagentRouteMetadata(model) {
  const reviewed = REVIEWED_SUBAGENT_ROUTE_METADATA.get(model?.slug);
  if (!reviewed) return undefined;
  if (model.provider !== reviewed.provider || model.upstreamModel !== reviewed.upstreamModel) return undefined;
  return {
    subagentFamilyId: reviewed.subagentFamilyId,
    subagentTier: reviewed.subagentTier,
  };
}

export function applyReviewedSubagentRouteMetadata(model, { reviewedRegistry = true } = {}) {
  if (!reviewedRegistry) {
    const { subagentFamilyId: _family, subagentTier: _tier, ...withoutUntrustedMetadata } = model;
    return withoutUntrustedMetadata;
  }
  const reviewed = reviewedSubagentRouteMetadata(model);
  if (!reviewed) {
    const { subagentFamilyId: _family, subagentTier: _tier, ...withoutUntrustedMetadata } = model;
    return withoutUntrustedMetadata;
  }
  return { ...model, ...reviewed };
}

export function normalizeSubagentModelPolicy(value) {
  if (value === undefined) return "inherit";
  if (!SUBAGENT_MODEL_POLICIES.includes(value)) {
    throw new Error(`Unknown subagent model policy "${value}". Choose: ${SUBAGENT_MODEL_POLICIES.join(", ")}`);
  }
  return value;
}

export function normalizeMaxChildTier(value) {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 0) {
    throw new Error("max_child_tier must be a non-negative integer");
  }
  return value;
}

function diagnostic(code, {
  parentRoute,
  requestedRoute,
  parentFamilyId,
  requestedFamilyId,
  tier,
  maxChildTier,
} = {}) {
  return Object.freeze({
    code,
    parentRoute: parentRoute?.slug,
    requestedRoute: requestedRoute?.slug,
    parentFamilyId,
    requestedFamilyId,
    tier,
    maxChildTier,
  });
}

function denied(parentRoute, code, details) {
  return { route: parentRoute, diagnostic: diagnostic(code, { parentRoute, ...details }) };
}

export function resolveSubagentChildRoute({
  parentRoute,
  requestedModel,
  requestedAgentTypeRoute,
  requestedEffort,
  policy = "inherit",
  maxChildTier,
  routesBySlug,
  isRouteEligible = (route) => route?.multiAgentVersion === "v2",
}) {
  if (!parentRoute) return { route: undefined };
  const normalizedPolicy = normalizeSubagentModelPolicy(policy);
  if (normalizedPolicy === "inherit") return { route: parentRoute };

  const requestedRoute = requestedAgentTypeRoute ||
    (requestedModel === undefined ? parentRoute : routesBySlug?.get(requestedModel));
  if (!requestedRoute) {
    return denied(parentRoute, "UNKNOWN_CHILD_MODEL", {
      parentFamilyId: parentRoute.subagentFamilyId,
    });
  }
  if (!parentRoute.subagentFamilyId || !requestedRoute.subagentFamilyId ||
      parentRoute.subagentFamilyId !== requestedRoute.subagentFamilyId) {
    return denied(parentRoute, "SUBAGENT_MODEL_FAMILY_DENIED", {
      requestedRoute,
      parentFamilyId: parentRoute.subagentFamilyId,
      requestedFamilyId: requestedRoute.subagentFamilyId,
    });
  }
  if (!isRouteEligible(parentRoute) || !isRouteEligible(requestedRoute)) {
    return denied(parentRoute, "SUBAGENT_MODEL_CAPABILITY_DENIED", {
      requestedRoute,
      parentFamilyId: parentRoute.subagentFamilyId,
      requestedFamilyId: requestedRoute.subagentFamilyId,
    });
  }
  const ceiling = normalizeMaxChildTier(maxChildTier) ?? parentRoute.subagentTier;
  if (!Number.isInteger(requestedRoute.subagentTier) || !Number.isInteger(ceiling) ||
      requestedRoute.subagentTier > ceiling) {
    return denied(parentRoute, "SUBAGENT_MODEL_TIER_DENIED", {
      requestedRoute,
      parentFamilyId: parentRoute.subagentFamilyId,
      requestedFamilyId: requestedRoute.subagentFamilyId,
      tier: requestedRoute.subagentTier,
      maxChildTier: ceiling,
    });
  }
  if (requestedEffort !== undefined && !requestedRoute.reasoningLevels?.some(
    (level) => level?.effort === requestedEffort,
  )) {
    return denied(parentRoute, "SUBAGENT_MODEL_EFFORT_DENIED", {
      requestedRoute,
      parentFamilyId: parentRoute.subagentFamilyId,
      requestedFamilyId: requestedRoute.subagentFamilyId,
      tier: requestedRoute.subagentTier,
      maxChildTier: ceiling,
    });
  }
  return { route: requestedRoute };
}
