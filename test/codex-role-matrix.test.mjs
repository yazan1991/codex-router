import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  CANONICAL_NAMED_ROLES,
  canonicalCodexRoleStatus,
  canonicalRoleContents,
  canonicalRoutedEffort,
  syncCanonicalCodexRoles,
} from "../src/codex-role-matrix.mjs";

test("canonical workforce binds each specialist to an explicit reasoning effort", () => {
  assert.deepEqual(
    Object.fromEntries(CANONICAL_NAMED_ROLES.map((role) => [role.name, role.reasoningEffort])),
    {
      luna_search: "low",
      fast_scan: "medium",
      docs_researcher: "high",
      test_runner: "medium",
      routine_worker: "high",
      reviewer: "xhigh",
    },
  );
});

test("generic routed workforce has durable deep-reasoning defaults", () => {
  assert.equal(canonicalRoutedEffort("cliproxy/gpt-6-luna"), "max");
  assert.equal(canonicalRoutedEffort("cliproxy/gpt-6.1-sol"), "high");
  assert.equal(canonicalRoutedEffort("cliproxy/gpt-6-astra"), "max");
  assert.equal(canonicalRoutedEffort("cliproxy/other"), undefined);
});

test("role sync writes private canonical files and repairs drift", () => {
  const agentsDir = mkdtempSync(path.join(os.tmpdir(), "codex-role-matrix-"));
  const result = syncCanonicalCodexRoles(agentsDir);
  assert.equal(result.written.length, CANONICAL_NAMED_ROLES.length);
  assert.equal(canonicalCodexRoleStatus(agentsDir).ok, true);

  const reviewer = CANONICAL_NAMED_ROLES.find((role) => role.name === "reviewer");
  const target = path.join(agentsDir, reviewer.fileName);
  assert.match(readFileSync(target, "utf8"), /^model_reasoning_effort = "xhigh"$/m);
  writeFileSync(target, canonicalRoleContents(reviewer).replace('"xhigh"', '"medium"'));
  assert.deepEqual(canonicalCodexRoleStatus(agentsDir).stale, ["reviewer"]);

  syncCanonicalCodexRoles(agentsDir);
  assert.equal(canonicalCodexRoleStatus(agentsDir).ok, true);
});
