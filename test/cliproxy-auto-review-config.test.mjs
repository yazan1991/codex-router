import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const REVIEWER = "cliproxy/codex-auto-review";
const CONFIGS = [
  "config/cliproxy/gpt-6-luna.json",
  "config/cliproxy/gpt-6.1-sol.json",
  "config/cliproxy/gpt-6-astra.json",
];

test("production CLIProxy GPT routes use the routed Codex auto reviewer", () => {
  for (const file of CONFIGS) {
    const document = JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"));
    assert.equal(document.models.length, 1, `${file} should contain one production model`);
    assert.equal(
      document.models[0].autoReviewModelOverride,
      REVIEWER,
      `${document.models[0].slug} must keep automatic approvals off native workspace quota`,
    );
  }
});
