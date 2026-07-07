import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/cli";
import {
  assessAgentEraMaturity,
  formatAgentEraMaturityDense,
  writeAgentEraMaturityReport,
} from "../src/maturity";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "proofloop-maturity-"));
  tempRoots.push(root);
  return root;
}

function writeFile(root: string, relativePath: string, content: string): void {
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function writePackage(root: string, pkg: Record<string, unknown>): void {
  writeFile(root, "package.json", `${JSON.stringify(pkg, null, 2)}\n`);
}

describe("agent-era maturity reporting", () => {
  it("keeps a prompt-era repo at level 0 and names deterministic gates as missing", () => {
    const root = tempRoot();
    writePackage(root, { name: "prompt-demo" });

    const report = assessAgentEraMaturity({ root, generatedAt: "2026-07-07T00:00:00.000Z" });

    expect(report.currentLevel).toBe(0);
    expect(report.currentStage).toBe("Prompt-era demo");
    expect(report.capabilities.find((entry) => entry.id === "deterministic_gates")?.status).toBe("missing");
    expect(report.missing.join("\n")).toContain("Deterministic gates");
    expect(report.reportMarkdown).toContain("```mermaid");
    expect(report.timelineMermaid).toContain("Need proof gate");
  });

  it("classifies a long-running proof-loop repo as level 4 while keeping level 5 benchmark work honest", () => {
    const root = tempRoot();
    writeMatureRepo(root);

    const report = assessAgentEraMaturity({
      root,
      targetLevel: 5,
      generatedAt: "2026-07-07T00:00:00.000Z",
    });

    expect(report.currentLevel).toBe(4);
    expect(report.levelAssessments.find((entry) => entry.level === 5)?.status).toBe("partial");
    expect(report.capabilities.find((entry) => entry.id === "official_benchmark_adapters")?.status).toBe("partial");
    expect(report.capabilities.find((entry) => entry.id === "model_sweep_costing")?.status).toBe("partial");
    expect(report.capabilities.find((entry) => entry.id === "memory_session_mining")?.status).toBe("partial");
    expect(report.missing.join("\n")).toContain("Official benchmark adapters");
    expect(formatAgentEraMaturityDense(report)).toContain("currentLevel=4");
  });

  it("writes Markdown and JSON receipts from the CLI write path", async () => {
    const root = tempRoot();
    writeMatureRepo(root);

    const exit = await runCli(["--dir", root, "maturity", "--target-level", "5", "--write", "--dense"]);
    const markdownPath = join(root, ".proofloop", "reports", "agent-era-maturity.md");
    const jsonPath = join(root, ".proofloop", "reports", "agent-era-maturity.json");

    expect(exit).toBe(0);
    expect(existsSync(markdownPath)).toBe(true);
    expect(existsSync(jsonPath)).toBe(true);
    expect(readFileSync(markdownPath, "utf8")).toContain("Agent-Era Maturity Report");
    expect(readFileSync(markdownPath, "utf8")).toContain("Agent-era maturity projection");
    expect(JSON.parse(readFileSync(jsonPath, "utf8")).schema).toBe("proofloop-agent-era-maturity-v1");

    const direct = writeAgentEraMaturityReport({ root, targetLevel: 4, outPath: ".proofloop/reports/custom.md" });
    expect(existsSync(direct.markdownPath)).toBe(true);
    expect(direct.report.targetLevel).toBe(4);
  });
});

function writeMatureRepo(root: string): void {
  writePackage(root, {
    name: "level-four-proofloop",
    description: "Agent app with WorkstreamBench proxy tasks, hosted worker, modelBudget tracking, and receipts.",
    scripts: {
      build: "tsc -p tsconfig.json",
      test: "vitest run",
      typecheck: "tsc --noEmit",
      "test:e2e": "playwright test",
      "benchmark:workstreambench": "node scripts/run-workstreambench-proxy.mjs",
    },
    devDependencies: {
      "@playwright/test": "1.48.0",
      typescript: "5.7.2",
    },
  });
  writeFile(root, "proofloop.config.json", JSON.stringify({
    gate: { checks: [{ name: "tests", command: "npm test" }] },
    immutable: ["scripts/scorer.mjs"],
    protectedPaths: [".github/workflows/"],
  }, null, 2));
  writeFile(root, ".github/workflows/ci.yml", "name: ci\non: [push]\njobs:\n  proofloop:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npx proofloop gate\n");
  writeFile(root, ".github/workflows/hosted-proofloop.yml", "name: hosted-proofloop\non: workflow_dispatch\njobs:\n  worker:\n    runs-on: ubuntu-latest\n    steps:\n      - run: node scripts/hosted-worker.mjs\n");
  writeFile(root, "docs/agent-os/README.md", "Goals are contracts and workers do not grade their own work.\n");
  writeFile(root, "docs/agent-os/memory.md", "Session mining stores prior failures and turns them into future rules.\n");
  writeFile(root, "api/hosted/status.js", "export default function status(){ return Response.json({ status: 'completed' }); }\n");
  writeFile(root, "api/hosted/submit.js", "export default function submit(){ return Response.json({ runId: 'run' }); }\n");
  writeFile(root, "src/hosted.ts", "export const consent = 'authorized to test with domain permission well-known dns token manual-review';\n");
  writeFile(root, "src/runner.ts", "export const runner = 'append-only resume stale lock budget estimatedCostUsd model route cost/pass';\n");
  writeFile(root, "src/receipts.ts", "export const receipt = 'receipt screenshot video trace scorecard dashboard';\n");
  writeFile(root, "src/proofloopToolUse.ts", "export const toolUse = 'expected-tool-use required forbidden';\n");
  writeFile(root, "src/proofloopHooks.ts", "export const hooks = 'protectedPaths immutable approval';\n");
  writeFile(root, "src/scaffoldConstants.ts", "export const guardrail = 'no self promotion';\n");
  writeFile(root, "scripts/hosted-worker.mjs", "console.log('playwright hosted worker video trace receipt');\n");
  writeFile(root, "playwright.config.ts", "export default {};\n");
  writeFile(root, "public/index.html", "<button data-testid=\"run-agent\">Run</button>\n");
  writeFile(root, "README.md", "WorkstreamBench and SpreadsheetBench proxy benchmark proof exists. Official scorer output is still required before official claims.\n");
}
