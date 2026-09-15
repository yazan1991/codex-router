import assert from "node:assert/strict";
import { existsSync, mkdtempSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const stateDir = mkdtempSync(path.join(os.tmpdir(), "multi-agent-state-test-"));
process.env.CODEX_ROUTER_STATE_DIR = stateDir;

const {
  MULTI_AGENT_ALL_PATH,
  MULTI_AGENT_STATE_PATH,
  applyMultiAgentCapabilities,
  applyMultiAgentSettings,
  codexAgentDefinitionModels,
  subagentEligibleModels,
  readAllMultiAgent,
  readMultiAgentSettings,
  setMultiAgentMode,
  setMultiAgentModel,
  setMultiAgentModels,
  replaceMultiAgentState,
  setSubagentModelPolicy,
  subagentSettingsSnapshot,
} = await import("../src/multi-agent-state.mjs");

test("subagent settings default to conservative proven mode", () => {
  assert.equal(readAllMultiAgent(), false);
  assert.equal(readMultiAgentSettings().mode, "proven");
  assert.equal(readMultiAgentSettings().subagent_model_policy, "inherit");
});

test("same-family policy and child-tier ceiling round-trip through protected state", () => {
  setSubagentModelPolicy("same-family", 2);
  assert.equal(readMultiAgentSettings().subagent_model_policy, "same-family");
  assert.equal(readMultiAgentSettings().max_child_tier, 2);
  assert.throws(() => setSubagentModelPolicy("unrestricted"), /Unknown subagent model policy/);
  assert.throws(() => setSubagentModelPolicy("same-family", -1), /max_child_tier/);
  setSubagentModelPolicy("inherit");
  assert.equal(readMultiAgentSettings().subagent_model_policy, "inherit");
  assert.equal(readMultiAgentSettings().max_child_tier, undefined);
});

test("model controls and full-state replacement preserve same-family policy", () => {
  setSubagentModelPolicy("same-family", 3);
  setMultiAgentModels(["chatgpt-web/high"], true);
  assert.equal(readMultiAgentSettings().subagent_model_policy, "same-family");
  assert.equal(readMultiAgentSettings().max_child_tier, 3);
  replaceMultiAgentState({ mode: "selected", enabled: ["chatgpt-web/high"], disabled: [] });
  assert.equal(readMultiAgentSettings().subagent_model_policy, "same-family");
  assert.equal(readMultiAgentSettings().max_child_tier, 3);
  setSubagentModelPolicy("inherit");
  replaceMultiAgentState({ mode: "proven", enabled: [], disabled: [] });
});

test("subagent mode round-trips through protected state", () => {
  setMultiAgentMode("all");
  assert.equal(readAllMultiAgent(), true);
  assert.equal(subagentSettingsSnapshot().all, true);
  setMultiAgentMode("proven");
  assert.equal(readAllMultiAgent(), false);
  assert.ok(MULTI_AGENT_STATE_PATH.startsWith(stateDir));
});

test("per-model subagent toggles promote selected mode and remember exclusions", () => {
  setMultiAgentMode("proven");
  setMultiAgentModel("opencode-go/deepseek-v4-flash", true);
  const selected = subagentSettingsSnapshot();
  assert.equal(selected.mode, "selected");
  assert.deepEqual(selected.enabled, ["opencode-go/deepseek-v4-flash"]);

  setMultiAgentMode("all");
  setMultiAgentModel("qwen-plan/qwen3.8-max", false);
  const all = subagentSettingsSnapshot();
  assert.equal(all.mode, "all");
  assert.deepEqual(all.disabled, ["qwen-plan/qwen3.8-max"]);
});

test("all mode advertises every model the operator has not switched off", () => {
  const models = [
    { slug: "opencode-go/deepseek-v4-flash" },
    { slug: "qwen-plan/qwen3.8-max", multiAgentVersion: "v1" },
    { slug: "kimi-oauth/k3", multiAgentVersion: "v2" },
  ];
  const promoted = applyMultiAgentSettings(models, {
    version: 2,
    mode: "all",
    enabled: [],
    disabled: ["qwen-plan/qwen3.8-max"],
  });
  assert.deepEqual(
    promoted.map((model) => [model.slug, model.multiAgentVersion]),
    // `all` is documented as "every non-hidden model, regardless of whether
    // it works". An explicit `off` still beats it.
    [
      ["opencode-go/deepseek-v4-flash", "v2"],
      ["qwen-plan/qwen3.8-max", "v1"],
      ["kimi-oauth/k3", "v2"],
    ],
  );
});

test("provider-sized subagent changes preserve other providers", () => {
  setMultiAgentMode("all");
  setMultiAgentModel("kimi-oauth/k3", false);
  setMultiAgentModels(
    ["commandcode/kimi-k3", "commandcode-messages/claude-opus-4.8"],
    false,
  );
  assert.deepEqual(subagentSettingsSnapshot().disabled, [
    "commandcode-messages/claude-opus-4.8",
    "commandcode/kimi-k3",
    "kimi-oauth/k3",
  ]);

  setMultiAgentModels(
    ["commandcode/kimi-k3", "commandcode-messages/claude-opus-4.8"],
    true,
  );
  assert.deepEqual(subagentSettingsSnapshot().disabled, ["kimi-oauth/k3"]);
});

test("picker visibility withholds a model the mode would otherwise advertise", () => {
  const models = [
    { slug: "opencode-go/deepseek-v4-flash" },
    { slug: "qwen-plan/qwen3.8-max" },
  ];
  const promoted = applyMultiAgentSettings(
    models,
    { version: 2, mode: "all", enabled: [], disabled: [] },
    new Set(["opencode-go/deepseek-v4-flash"]),
  );
  assert.deepEqual(
    promoted.map((model) => [model.slug, model.multiAgentVersion]),
    // Hidden always demotes; the mode promotes only what is left.
    [
      ["opencode-go/deepseek-v4-flash", "v1"],
      ["qwen-plan/qwen3.8-max", "v2"],
    ],
  );
});

test("selected mode advertises registry-proven routes plus the chosen ones", () => {
  const models = [
    { slug: "opencode-go/deepseek-v4-flash" },
    { slug: "qwen-plan/qwen3.8-max" },
    { slug: "kimi-oauth/k3", multiAgentVersion: "v2" },
  ];
  const selected = applyMultiAgentSettings(models, {
    version: 2,
    mode: "selected",
    enabled: ["opencode-go/deepseek-v4-flash"],
    disabled: [],
  });
  assert.deepEqual(
    selected.map((model) => [model.slug, model.multiAgentVersion]),
    // "Proven models plus ones you explicitly turn on"; a route nobody chose
    // is left exactly as the registry shipped it.
    [
      ["opencode-go/deepseek-v4-flash", "v2"],
      ["qwen-plan/qwen3.8-max", undefined],
      ["kimi-oauth/k3", "v2"],
    ],
  );
});

test("a machine-local proof still promotes nothing on its own", () => {
  const models = [
    { slug: "opencode-go/deepseek-v4-pro" },
    { slug: "opencode-go/deepseek-v4-flash" },
    { slug: "kimi-oauth/k3", multiAgentVersion: "v2" },
  ];
  const resolved = applyMultiAgentCapabilities(
    models,
    {
      version: 2,
      mode: "selected",
      enabled: ["opencode-go/deepseek-v4-pro"],
      disabled: ["opencode-go/deepseek-v4-flash"],
    },
    {
      proofs: {
        "opencode-go/deepseek-v4-pro": { status: "proven" },
        "opencode-go/deepseek-v4-flash": { status: "proven" },
      },
    },
  );
  assert.deepEqual(
    resolved.map((model) => [model.slug, model.multiAgentVersion]),
    // deepseek-v4-pro is v2 because the operator selected it, not because a
    // "proven" proof record exists; deepseek-v4-flash carries the same record
    // and stays v1 because they switched it off.
    [
      ["opencode-go/deepseek-v4-pro", "v2"],
      ["opencode-go/deepseek-v4-flash", "v1"],
      ["kimi-oauth/k3", "v2"],
    ],
  );
});

test("legacy all-on switch still enables all-models mode", () => {
  if (existsSync(MULTI_AGENT_STATE_PATH)) unlinkSync(MULTI_AGENT_STATE_PATH);
  writeFileSync(MULTI_AGENT_ALL_PATH, '{"version":1,"enabled":true}\n', {
    mode: 0o600,
  });
  assert.equal(readAllMultiAgent(), true);
});

test("Codex agent definitions include ChatGPT Web Compatibility V1 without granting V2 authority", () => {
  const models = [
    {
      slug: "chatgpt-web/high",
      provider: "chatgpt-web",
      multiAgentVersion: "v1",
    },
    {
      slug: "chatgpt-web/pro",
      provider: "chatgpt-web",
      multiAgentVersion: "v1",
    },
    {
      slug: "cliproxy/gpt-5.6-sol",
      provider: "cliproxy",
      multiAgentVersion: "v2",
    },
    {
      slug: "other/v1-model",
      provider: "other",
      multiAgentVersion: "v1",
    },
  ];

  const settings = {
    version: 2,
    mode: "all",
    enabled: [],
    disabled: [],
  };

  assert.deepEqual(
    codexAgentDefinitionModels(models, settings).map((model) => model.slug),
    [
      "chatgpt-web/high",
      "chatgpt-web/pro",
      "cliproxy/gpt-5.6-sol",
    ],
  );

  assert.deepEqual(
    subagentEligibleModels(models, settings).map((model) => model.slug),
    ["cliproxy/gpt-5.6-sol"],
  );
});

test("disabled ChatGPT Web V1 model is not published as a Codex agent definition", () => {
  const models = [
    {
      slug: "chatgpt-web/high",
      provider: "chatgpt-web",
      multiAgentVersion: "v1",
    },
  ];

  const settings = {
    version: 2,
    mode: "all",
    enabled: [],
    disabled: ["chatgpt-web/high"],
  };

  assert.deepEqual(codexAgentDefinitionModels(models, settings), []);
});
