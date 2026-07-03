/**
 * Adversarial tests for the guard's PROTECTED-PATH defaults -- the goalpost
 * layer. These exist because every entry here is a way a reward-hacking agent
 * could fake a PASS without doing the work:
 *
 *   1. Forge the verdict:   Write .proofloop/gate-state.json {"status":"passed"}
 *                           -- the Stop hook trusts that file in check-only mode.
 *   2. Move the goalpost:   edit proofloop.config.json gate.checks down to a
 *                           no-op (or empty the immutable/protectedPaths lists).
 *   3. Disarm the backstop: edit .github/workflows/ so CI stops re-verifying.
 *
 * All three MUST exit 2 (blocked) from the generated pretooluse-guard.mjs,
 * exercised as a real subprocess with the documented Claude Code hook stdin.
 * Also covers the user-configurable `protectedPaths` additions and the
 * verifier-weakening content check applying under protected/guarded paths.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { installProofloopHooks, buildHooksConfig } from "../src/proofloopHooks";
import { DEFAULT_PROTECTED_EXTRA_PATHS } from "../src/scaffoldConstants";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "proofloop-protected-"));
  tempRoots.push(root);
  return root;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

type HookRun = { status: number; stdout: string; stderr: string };

function guard(root: string, toolName: string, toolInput: Record<string, unknown>): HookRun {
  const result = spawnSync(process.execPath, [join(root, ".proofloop", "hooks", "pretooluse-guard.mjs")], {
    cwd: root,
    input: JSON.stringify({ session_id: "s1", tool_name: toolName, tool_input: toolInput }),
    encoding: "utf8",
    timeout: 60_000,
  });
  return { status: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

describe("protected-path defaults (the goalpost layer)", () => {
  it("FORGERY: blocks a Write of a fake passed verdict to .proofloop/gate-state.json", () => {
    const root = tempRoot();
    installProofloopHooks({ root });

    // The exact reward-hack: one Write and the check-only Stop hook would
    // read "passed" and allow the stop without any work being proven.
    const forged = guard(root, "Write", {
      file_path: join(root, ".proofloop", "gate-state.json"),
      content: JSON.stringify({ schema: "proofloop-gate-v1", status: "passed", checks: [], ts: "2026-07-03T00:00:00.000Z", source: "config-checks" }),
    });
    expect(forged.status).toBe(2);
    expect(forged.stderr).toContain(".proofloop/gate-state.json");

    // Relative and traversal spellings of the same file are equally blocked.
    expect(guard(root, "Write", { file_path: ".proofloop/gate-state.json", content: "{}" }).status).toBe(2);
    expect(guard(root, "Edit", { file_path: "src/../.proofloop/gate-state.json", old_string: "failed", new_string: "passed" }).status).toBe(2);
  });

  it("GOALPOST: blocks edits to proofloop.config.json (the gate definition) in every spelling", () => {
    const root = tempRoot();
    writeJson(join(root, "proofloop.config.json"), {
      app: "generic web app",
      workflow: "",
      gate: { checks: [{ name: "tests", command: "npm test" }] },
      immutable: [],
    });
    installProofloopHooks({ root });

    // Downgrading the gate to a no-op check must be refused at edit time.
    const noop = guard(root, "Edit", {
      file_path: join(root, "proofloop.config.json"),
      old_string: '"command": "npm test"',
      new_string: '"command": "node -e 0"',
    });
    expect(noop.status).toBe(2);
    expect(noop.stderr).toContain("proofloop.config.json");

    expect(guard(root, "Write", { file_path: "proofloop.config.json", content: "{}" }).status).toBe(2);
    // MultiEdit and NotebookEdit paths go through the same normalization.
    expect(
      guard(root, "MultiEdit", {
        file_path: "proofloop.config.json",
        edits: [{ old_string: "npm test", new_string: "true" }],
      }).status,
    ).toBe(2);
  });

  it("BACKSTOP: blocks edits to ANY workflow under .github/workflows/, not just the proofloop gate", () => {
    const root = tempRoot();
    installProofloopHooks({ root });

    expect(guard(root, "Write", { file_path: ".github/workflows/proofloop-gate.yml", content: "x" }).status).toBe(2);
    // The CI backstop is a prefix: renaming or adding a neutered workflow is
    // the same disarm move.
    expect(guard(root, "Write", { file_path: ".github/workflows/totally-unrelated.yml", content: "x" }).status).toBe(2);
    expect(guard(root, "Edit", { file_path: join(root, ".github", "workflows", "ci.yml"), old_string: "a", new_string: "b" }).status).toBe(2);

    // But .github/ itself outside workflows/ stays editable (e.g. PR templates).
    expect(guard(root, "Write", { file_path: ".github/PULL_REQUEST_TEMPLATE.md", content: "hi" }).status).toBe(0);
  });

  it("USER ADDITIONS: proofloop.config.json protectedPaths extends the guard, and defaults are not removable", () => {
    const root = tempRoot();
    writeJson(join(root, "proofloop.config.json"), {
      app: "generic web app",
      workflow: "",
      gate: { checks: [] },
      immutable: [],
      // The founder protects their seed data and a verify script.
      protectedPaths: ["data/golden/", "scripts/verify.sh"],
    });
    installProofloopHooks({ root });

    expect(guard(root, "Write", { file_path: "data/golden/cases.json", content: "[]" }).status).toBe(2);
    expect(guard(root, "Edit", { file_path: join(root, "scripts", "verify.sh"), old_string: "a", new_string: "b" }).status).toBe(2);
    // Unrelated neighbors stay editable.
    expect(guard(root, "Write", { file_path: "data/scratch/tmp.json", content: "[]" }).status).toBe(0);

    // Even with user additions present, the defaults still apply.
    expect(guard(root, "Write", { file_path: ".proofloop/gate-state.json", content: "{}" }).status).toBe(2);
    expect(guard(root, "Write", { file_path: "proofloop.config.json", content: "{}" }).status).toBe(2);
  });

  it("config snapshot: defaults + user additions land in protectedExtraPaths, and the content check covers protected paths", () => {
    const root = tempRoot();
    writeJson(join(root, "proofloop.config.json"), {
      app: "generic web app",
      workflow: "",
      gate: { checks: [] },
      immutable: [],
      protectedPaths: ["data/golden/"],
    });
    const config = buildHooksConfig({ root });
    for (const entry of DEFAULT_PROTECTED_EXTRA_PATHS) {
      expect(config.protectedExtraPaths).toContain(entry);
    }
    expect(config.protectedExtraPaths).toContain("data/golden/");
    // "keep the VERIFIER_WEAKENING_PATTERNS content-check for edits under
    // those paths": every protected path is also a guarded-content prefix.
    for (const entry of config.protectedExtraPaths) {
      expect(config.guardedContentPathPrefixes).toContain(entry);
    }
  });

  it("FAIL-CLOSED INSTALL: an unparseable proofloop.config.json refuses to install hooks instead of dropping protections", () => {
    const root = tempRoot();
    writeFileSync(join(root, "proofloop.config.json"), "{ this is not json", "utf8");
    expect(() => installProofloopHooks({ root })).toThrow(/not valid JSON/);
  });
});
