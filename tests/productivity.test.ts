import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/cli";
import {
  buildProductivityProofPack,
  formatProductivityDense,
  writeProductivityProofPack,
  type ProductivityLedger,
} from "../src/productivity";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "proofloop-productivity-"));
  tempRoots.push(root);
  return root;
}

function writeFile(root: string, relativePath: string, content: string): void {
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function writeGate(root: string, status: "passed" | "failed" | "no_gate" = "passed"): void {
  writeFile(root, ".proofloop/gate-state.json", JSON.stringify({
    schema: "proofloop-gate-v1",
    status,
    checks: status === "no_gate" ? [] : [{ name: "tests", command: "npm test", pass: status === "passed", ms: 1234, exitCode: status === "passed" ? 0 : 1 }],
    ts: "2026-07-07T00:00:00.000Z",
    source: status === "no_gate" ? "none" : "config-checks",
  }, null, 2));
}

describe("productivity proof pack", () => {
  it("computes confidence-adjusted wage-equivalent value only after a passed proof", () => {
    const root = tempRoot();
    writeFile(root, "package.json", JSON.stringify({ name: "agent-app" }, null, 2));
    writeGate(root, "passed");

    const pack = buildProductivityProofPack({
      root,
      runId: "run-1",
      workflowId: "fix-ui-flow",
      baselineSource: "benchmark",
      devHours: 3,
      qaHours: 1,
      humanReviewHours: 0.4,
      modelCostUsd: 4.2,
      browserCostUsd: 0.5,
      ciCostUsd: 0.1,
      regressionAdded: true,
      liveBrowserVerified: true,
      generatedAt: "2026-07-07T00:00:00.000Z",
    });

    expect(pack.ledger.proof.verdict).toBe("pass");
    expect(pack.ledger.baseline.confidence).toBe(0.75);
    expect(pack.ledger.wageRates.find((rate) => rate.role === "software_developer")?.hourlyUsd).toBeCloseTo(63.98);
    expect(pack.ledger.value.grossWageEquivalentUsd).toBeGreaterThan(240);
    expect(pack.ledger.value.confidenceAdjustedUsd).toBeGreaterThan(150);
    expect(pack.ledger.value.costPerPassedProofUsd).toBeGreaterThan(0);
    expect(pack.ledger.value.evidence[0]?.citation).toContain("bls.gov");
    expect(pack.charts["wage-equivalent-value.vl.json"]?.data.values[0]?.citation).toContain("bls.gov");
    expect(formatProductivityDense(pack)).toContain("confidenceAdjustedUsd=");
  });

  it("blocks productivity value when proof is missing", () => {
    const root = tempRoot();
    const pack = buildProductivityProofPack({
      root,
      runId: "blocked",
      baselineSource: "estimated",
      devHours: 2,
      qaHours: 1,
      generatedAt: "2026-07-07T00:00:00.000Z",
    });

    expect(pack.ledger.proof.verdict).toBe("blocked");
    expect(pack.ledger.value.confidenceAdjustedUsd).toBe(0);
    expect(pack.ledger.value.costPerPassedProofUsd).toBeNull();
    expect(pack.scorecardMarkdown).toContain("No proof means no productivity claim");
  });

  it("writes the full artifact contract and exposes it through the CLI", async () => {
    const root = tempRoot();
    writeGate(root, "passed");

    const exit = await runCli([
      "--dir",
      root,
      "productivity",
      "--write",
      "--run-id",
      "prod-run",
      "--workflow-id",
      "qa-flow",
      "--baseline-source",
      "measured",
      "--dev-hours",
      "1.5",
      "--qa-hours",
      "0.5",
      "--human-review-hours",
      "0.25",
      "--model-cost-usd",
      "1.20",
      "--browser-cost-usd",
      "0.30",
      "--ci-cost-usd",
      "0.10",
      "--regression-added",
      "--live-browser-verified",
      "--json",
    ]);

    const runDir = join(root, ".proofloop", "runs", "prod-run");
    const ledgerPath = join(runDir, "productivity-ledger.json");
    const chartPath = join(runDir, "charts", "cost-per-passed-proof.vl.json");
    const scorecardPath = join(runDir, "productivity-scorecard.md");
    const ledger = JSON.parse(readFileSync(ledgerPath, "utf8")) as ProductivityLedger;

    expect(exit).toBe(0);
    expect(existsSync(ledgerPath)).toBe(true);
    expect(existsSync(join(runDir, "wage-research.json"))).toBe(true);
    expect(existsSync(join(runDir, "baseline-estimates.json"))).toBe(true);
    expect(existsSync(chartPath)).toBe(true);
    expect(existsSync(scorecardPath)).toBe(true);
    expect(ledger.schema).toBe("proofloop-productivity-ledger-v1");
    expect(ledger.proof.liveBrowserVerified).toBe(true);
    expect(readFileSync(chartPath, "utf8")).toContain("sourceFile");

    const direct = writeProductivityProofPack({ root, runId: "direct", devHours: 1, qaHours: 1 });
    expect(existsSync(direct.files.ledger)).toBe(true);
  });

  it("rejects unsupported baseline source labels", async () => {
    const root = tempRoot();
    const exit = await runCli(["--dir", root, "productivity", "--baseline-source", "vibes"]);
    expect(exit).toBe(2);
  });
});
