import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { privateFileIsProtected, protectPrivateFile } from "./file-security.mjs";
import { CODEX_AGENTS_DIR } from "./paths.mjs";

// Canonical Codex++ workforce matrix. Keep role, model and thinking depth in
// one checked-in source so a catalog refresh, reinstall, or second machine
// cannot silently fall back to Codex's generic medium effort.
export const CANONICAL_NAMED_ROLES = Object.freeze([
  Object.freeze({
    fileName: "luna-search.toml",
    name: "luna_search",
    description: "Luna fast exact lookup worker for paths, symbols, strings, small inventories, and narrow logs.",
    model: "cliproxy/gpt-6-luna",
    reasoningEffort: "low",
    sandboxMode: "read-only",
    instructions: [
      "Handle only a short, exact, read-only lookup in the Task Capsule.",
      "Return exact paths, matches, counts, and concise evidence. Do not edit files or infer unsupported facts.",
      "Escalate broad, ambiguous, cross-cutting, or long-context work back to the root instead of stretching this role.",
      "Do not spawn additional agents.",
    ],
  }),
  Object.freeze({
    fileName: "fast-scan.toml",
    name: "fast_scan",
    description: "Luna repository mapper for cross-file ownership, dependency tracing, and bounded evidence.",
    model: "cliproxy/gpt-6-luna",
    reasoningEffort: "medium",
    sandboxMode: "read-only",
    instructions: [
      "Map the assigned repository or subsystem read-only within the Task Capsule scope.",
      "Trace entry points, symbols, dependencies, configuration, tests, boundaries, and material unknowns.",
      "Do not edit, implement, or broaden ownership. Return a concise evidence map to the root.",
      "Do not spawn additional agents.",
    ],
  }),
  Object.freeze({
    fileName: "docs-researcher.toml",
    name: "docs_researcher",
    description: "Luna official-documentation and compatibility researcher for evidence synthesis.",
    model: "cliproxy/gpt-6-luna",
    reasoningEffort: "high",
    sandboxMode: "read-only",
    instructions: [
      "Research official documentation and compatibility evidence read-only for the assigned Task Capsule.",
      "Prefer authoritative pinned references and separate verified facts, assumptions, unknowns, risks, and recommendations.",
      "Do not implement or make architecture, security, database, migration, production, credential, billing, or policy decisions.",
      "Do not spawn additional agents.",
    ],
  }),
  Object.freeze({
    fileName: "test-runner.toml",
    name: "test_runner",
    description: "Luna reproduction and focused deterministic verification worker.",
    model: "cliproxy/gpt-6-luna",
    reasoningEffort: "medium",
    sandboxMode: "workspace-write",
    instructions: [
      "Reproduce the assigned behavior and run only the deterministic checks in the Task Capsule.",
      "Prefer focused local and network-free verification. Test-file edits are allowed only when explicitly owned.",
      "Report commands, pass/fail results, changed test files, unresolved risks, and the verification verdict.",
      "Do not spawn additional agents.",
    ],
  }),
  Object.freeze({
    fileName: "routine-worker.toml",
    name: "routine_worker",
    description: "Sol 6.1 implementation worker for bounded contextual execution and difficult coding work.",
    model: "cliproxy/gpt-6.1-sol",
    reasoningEffort: "high",
    sandboxMode: "workspace-write",
    instructions: [
      "Implement the bounded contextual task assigned by the root and preserve repository compatibility.",
      "Inspect surrounding behavior, keep edits surgical and reversible, and run deterministic verification.",
      "Escalate architecture, security, database, migration, production, credential, billing, policy, or scope decisions.",
      "Do not spawn additional agents.",
    ],
  }),
  Object.freeze({
    fileName: "reviewer.toml",
    name: "reviewer",
    description: "Sol 6.1 independent read-only correctness, regression, and difficult-work reviewer.",
    model: "cliproxy/gpt-6.1-sol",
    reasoningEffort: "xhigh",
    sandboxMode: "read-only",
    instructions: [
      "Review completed work independently and read-only within the supplied evidence scope.",
      "Lead with concrete findings ordered by severity, exact file or symbol references, missing tests, regressions, and unresolved risks.",
      "Do not edit and do not make policy, architecture, security, database, migration, production, credential, billing, or scope decisions.",
      "Do not spawn additional agents.",
    ],
  }),
]);

export const CANONICAL_ROUTED_EFFORTS = Object.freeze({
  "cliproxy/gpt-6-luna": "max",
  "cliproxy/gpt-6.1-sol": "high",
  "cliproxy/gpt-6-astra": "max",
});

export function canonicalRoutedEffort(slug) {
  return CANONICAL_ROUTED_EFFORTS[String(slug || "")];
}

function tomlString(value) {
  return JSON.stringify(String(value));
}

export function canonicalRoleContents(role) {
  return [
    "# Managed by Codex Router canonical role matrix. Edit the source matrix, not this file.",
    `name = ${tomlString(role.name)}`,
    `description = ${tomlString(role.description)}`,
    'model_provider = "codex-router"',
    `model = ${tomlString(role.model)}`,
    `model_reasoning_effort = ${tomlString(role.reasoningEffort)}`,
    `sandbox_mode = ${tomlString(role.sandboxMode)}`,
    "",
    'developer_instructions = """',
    ...role.instructions,
    '"""',
    "",
  ].join("\n");
}

function writePrivateAgent(target, contents) {
  const temporary = `${target}.tmp.${process.pid}`;
  writeFileSync(temporary, contents, { encoding: "utf8", mode: 0o600 });
  protectPrivateFile(temporary);
  renameSync(temporary, target);
  protectPrivateFile(target);
}

export function syncCanonicalCodexRoles(agentsDir = CODEX_AGENTS_DIR) {
  mkdirSync(agentsDir, { recursive: true, mode: 0o700 });
  const previous = new Map();
  for (const role of CANONICAL_NAMED_ROLES) {
    const target = path.join(agentsDir, role.fileName);
    previous.set(target, existsSync(target) ? readFileSync(target, "utf8") : null);
  }
  const written = [];
  try {
    for (const role of CANONICAL_NAMED_ROLES) {
      const target = path.join(agentsDir, role.fileName);
      writePrivateAgent(target, canonicalRoleContents(role));
      written.push({ role: role.name, effort: role.reasoningEffort, path: target });
    }
    return { written };
  } catch (error) {
    for (const [target, contents] of previous) {
      try {
        if (contents === null) unlinkSync(target);
        else writePrivateAgent(target, contents);
      } catch {
        // Preserve the original failure; status/doctor will expose any drift.
      }
    }
    throw error;
  }
}

export function canonicalCodexRoleStatus(agentsDir = CODEX_AGENTS_DIR) {
  const missing = [];
  const stale = [];
  const unprotected = [];
  for (const role of CANONICAL_NAMED_ROLES) {
    const target = path.join(agentsDir, role.fileName);
    if (!existsSync(target)) {
      missing.push(role.name);
      continue;
    }
    if (readFileSync(target, "utf8") !== canonicalRoleContents(role)) {
      stale.push(role.name);
      continue;
    }
    if (!privateFileIsProtected(target)) unprotected.push(role.name);
  }
  return {
    expected: CANONICAL_NAMED_ROLES.length,
    current: CANONICAL_NAMED_ROLES.length - missing.length - stale.length - unprotected.length,
    missing,
    stale,
    unprotected,
    ok: missing.length === 0 && stale.length === 0 && unprotected.length === 0,
  };
}
