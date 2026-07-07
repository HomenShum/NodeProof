import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/cli";
import { runGateCli } from "../src/gate";
import {
  buildProofloopProjectManifest,
  buildResume,
  discoverUiContracts,
  formatProofloopProjectManifestDense,
  writeProofloopCharts,
} from "../src/project";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "proofloop-project-"));
  tempRoots.push(root);
  return root;
}

function write(path: string, content: string): void {
  writeFileSync(path, content, "utf8");
}

describe("agent-friendly project setup", () => {
  it("init --agent all --live writes docs, manifest, package aliases, and live scaffold", () => {
    const root = tempRoot();
    write(
      join(root, "package.json"),
      JSON.stringify({ name: "demo-app", scripts: { build: "node -e 0", test: "node -e 0" }, devDependencies: { vite: "5", "@playwright/test": "1" }, dependencies: { react: "18" } }, null, 2),
    );

    expect(runCli(["--dir", root, "init", "--agent", "all", "--live"])).toBe(0);

    expect(existsSync(join(root, "AGENTS.md"))).toBe(true);
    expect(existsSync(join(root, "CLAUDE.md"))).toBe(true);
    expect(existsSync(join(root, ".cursor", "rules", "proofloop.mdc"))).toBe(true);
    expect(existsSync(join(root, ".windsurf", "rules", "proofloop.md"))).toBe(true);
    expect(existsSync(join(root, ".proofloop", "manifest.json"))).toBe(true);
    expect(existsSync(join(root, "proofloop", "workflows", "primary.workflow.yaml"))).toBe(true);

    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts["proofloop:init"]).toBe("npx proofloop init --agent auto --live");
    expect(pkg.scripts["proofloop:target"]).toBe("npx proofloop target --write-runner-plan");
    expect(pkg.scripts["proofloop:charts"]).toBe("npx proofloop charts latest");
    expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toContain(".proofloop/reports/latest.md");

    const manifest = buildProofloopProjectManifest(root);
    expect(manifest.repo.stack).toContain("Vite");
    expect(formatProofloopProjectManifestDense(manifest)).toContain("repo=demo-app");
  });

  it("discovers UI contracts and can write report charts from a gate receipt", () => {
    const root = tempRoot();
    write(join(root, "package.json"), JSON.stringify({ name: "ui-app", scripts: { test: "node -e 0" } }, null, 2));
    expect(runCli(["--dir", root, "init", "--agent", "auto", "--live"])).toBe(0);
    const srcDir = join(root, "src");
    mkdirSync(srcDir);
    writeFileSync(join(srcDir, "ui-sample.tsx"), '<button data-testid="chat-send">Send</button>', "utf8");

    const contracts = discoverUiContracts(root);
    expect(contracts.find((contract) => contract.id === "chat-send")?.actions).toContain("click");

    expect(runGateCli({ root, log: () => {}, logError: () => {} })).toBe(0);
    const resume = buildResume(root);
    expect(resume.dense).toContain("status=passed");
    const charts = writeProofloopCharts(root);
    expect(existsSync(charts.jsonPath)).toBe(true);
    expect(readFileSync(charts.svgPath, "utf8")).toContain("<svg");
  });
});
