import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/cli";
import { runProofloopAgentLoop } from "../src/agentLoop";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Codex repair loop", () => {
  it("turns a failed gate into Codex relaunch and repair-prompt artifacts", async () => {
    const root = tempRoot();
    writeFileSync(join(root, "proofloop.config.json"), JSON.stringify({
      app: "generic web app",
      workflow: "test",
      gate: { checks: [{ name: "boom", command: nodeCommand("process.exit(7)") }] },
      immutable: [],
    }, null, 2), "utf8");

    const result = await runProofloopAgentLoop({
      root,
      runId: "loop-test",
      dryRun: true,
      log: () => {},
      logError: () => {},
    });

    expect(result.passed).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(existsSync(join(root, ".proofloop", "runs", "loop-test", "codex-relaunch.json"))).toBe(true);
    expect(readFileSync(join(root, ".proofloop", "runs", "loop-test", "codex-reprompt.md"), "utf8")).toContain("Codex Proof Loop Repair Prompt");

    await expect(Promise.resolve(runCli(["--dir", root, "codex", "reprompt", "loop-test"]))).resolves.toBe(0);
  });

  it("exposes agent setup and provider setup through the CLI", async () => {
    const root = tempRoot();

    await expect(Promise.resolve(runCli(["--dir", root, "agents", "setup", "codex", "--local"]))).resolves.toBe(0);
    expect(existsSync(join(root, ".codex", "hooks.local.json"))).toBe(true);

    await expect(Promise.resolve(runCli(["--dir", root, "providers", "setup", "nebius", "--json"]))).resolves.toBe(1);
    expect(existsSync(join(root, ".proofloop", "setup", "providers", "nebius.json"))).toBe(true);
  });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "proofloop-codex-loop-"));
  tempRoots.push(root);
  return root;
}

function nodeCommand(source: string): string {
  return `${JSON.stringify(process.execPath)} -e ${JSON.stringify(source)}`;
}
