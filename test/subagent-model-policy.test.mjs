import assert from "node:assert/strict";
import test from "node:test";

import {
  applyReviewedSubagentRouteMetadata,
  reviewedSubagentRouteMetadata,
  resolveSubagentChildRoute,
} from "../src/subagent-model-policy.mjs";

function route(slug, tier, effort, family = "chatgpt-web/sol") {
  return {
    slug,
    provider: "chatgpt-web",
    upstreamModel: slug,
    multiAgentVersion: "v2",
    subagentFamilyId: family,
    subagentTier: tier,
    reasoningLevels: [{ effort, description: `${effort} reasoning` }],
  };
}

function routes() {
  const medium = route("chatgpt-web/medium", 1, "medium");
  const high = route("chatgpt-web/high", 2, "high");
  const foreign = route("other/high", 2, "high", "other/family");
  return { medium, high, foreign, bySlug: new Map([[medium.slug, medium], [high.slug, high], [foreign.slug, foreign]]) };
}

test("reviewed metadata recognizes only exact CGW Sol route identities", () => {
  assert.deepEqual(
    reviewedSubagentRouteMetadata({
      slug: "chatgpt-web/high",
      provider: "chatgpt-web",
      upstreamModel: "chatgpt-web/high",
    }),
    { subagentFamilyId: "chatgpt-web/sol", subagentTier: 2 },
  );
  assert.equal(
    reviewedSubagentRouteMetadata({
      slug: "chatgpt-web/high",
      provider: "chatgpt-web",
      upstreamModel: "untrusted-upstream-id",
    }),
    undefined,
  );
});

test("reviewed metadata replaces any user-supplied family fields", () => {
  const model = applyReviewedSubagentRouteMetadata({
    slug: "chatgpt-web/high",
    provider: "chatgpt-web",
    upstreamModel: "chatgpt-web/high",
    subagentFamilyId: "forged/family",
    subagentTier: 99,
  });
  assert.equal(model.subagentFamilyId, "chatgpt-web/sol");
  assert.equal(model.subagentTier, 2);
});

test("non-reviewed registry sources cannot mint a reviewed family", () => {
  const model = applyReviewedSubagentRouteMetadata({
    slug: "chatgpt-web/high",
    provider: "chatgpt-web",
    upstreamModel: "chatgpt-web/high",
    subagentFamilyId: "forged/family",
    subagentTier: 99,
  }, { reviewedRegistry: false });
  assert.equal(model.subagentFamilyId, undefined);
  assert.equal(model.subagentTier, undefined);
});

test("same-family policy accepts a canonical child route and validates its own effort", () => {
  const { medium, high, bySlug } = routes();
  const result = resolveSubagentChildRoute({
    parentRoute: medium,
    requestedModel: high.slug,
    requestedEffort: "high",
    policy: "same-family",
    maxChildTier: 2,
    routesBySlug: bySlug,
  });
  assert.equal(result.route, high);
  assert.equal(result.diagnostic, undefined);
});

test("same-family policy fails closed for an over-tier route", () => {
  const { medium, high, bySlug } = routes();
  const result = resolveSubagentChildRoute({
    parentRoute: medium,
    requestedModel: high.slug,
    policy: "same-family",
    maxChildTier: 1,
    routesBySlug: bySlug,
  });
  assert.equal(result.route, medium);
  assert.equal(result.diagnostic.code, "SUBAGENT_MODEL_TIER_DENIED");
});

test("same-family policy fails closed when the requested effort is unsupported by the child", () => {
  const { medium, bySlug } = routes();
  const result = resolveSubagentChildRoute({
    parentRoute: medium,
    requestedModel: medium.slug,
    requestedEffort: "high",
    policy: "same-family",
    maxChildTier: 1,
    routesBySlug: bySlug,
  });
  assert.equal(result.route, medium);
  assert.equal(result.diagnostic.code, "SUBAGENT_MODEL_EFFORT_DENIED");
});
