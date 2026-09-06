import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const catalog = fs.readFileSync(
  new URL("../src/catalog.mjs", import.meta.url),
  "utf8",
);

const forwarder = fs.readFileSync(
  new URL("../src/api-forwarder.mjs", import.meta.url),
  "utf8",
);

test("CLIProxy native GPT parity remains narrowly scoped", () => {
  for (const slug of [
    "cliproxy/gpt-5.6-sol",
    "cliproxy/gpt-5.6-terra",
    "cliproxy/gpt-5.6-luna",
    "cliproxy/gpt-6-astra",
  ]) {
    assert.ok(catalog.includes(slug), `missing parity route: ${slug}`);
  }

  for (const capability of [
    "include_skills_usage_instructions",
    "include_plugin_usage_instructions",
    "include_apps_usage_instructions",
    "tool_mode",
    "support_verbosity",
    "default_verbosity",
    "supports_image_detail_original",
  ]) {
    assert.ok(
      catalog.includes(`"${capability}"`),
      `missing native capability: ${capability}`,
    );
  }

  assert.match(
    catalog,
    /if\s*\(!cliProxyNativeParity\)\s*delete next\.tool_mode;/,
  );
});

test("CLIProxy strips only ChatGPT private message metadata at compatibility boundary", () => {
  const helperMatch = forwarder.match(
    /function stripInternalChatMessageMetadataPassthrough\(payload\) \{[\s\S]*?\n\}/,
  );

  assert.ok(helperMatch, "metadata compatibility helper is missing");

  const helper = helperMatch[0];

  assert.match(
    helper,
    /internal_chat_message_metadata_passthrough/,
  );

  assert.match(
    helper,
    /delete item\.internal_chat_message_metadata_passthrough/,
  );

  assert.doesNotMatch(helper, /image_generation/);
  assert.doesNotMatch(helper, /\btools\b/);
  assert.doesNotMatch(helper, /\bmessages\b/);
  assert.doesNotMatch(helper, /\breasoning\b/);

  assert.match(
    forwarder,
    /provider\.id\s*===\s*"cliproxy"[\s\S]*?stripInternalChatMessageMetadataPassthrough\(payload\)/,
  );
});
