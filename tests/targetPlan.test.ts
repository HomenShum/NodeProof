import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/cli";
import { runProofloopTarget, type ProofloopTargetPlan } from "../src/targetPlan";

const tempRoots: string[] = [];
const servers: Server[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "proofloop-target-"));
  tempRoots.push(root);
  return root;
}

function writeAccountingRepo(root: string): void {
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify(
      {
        name: "ledger-room",
        description: "Accounting workflow UI for trial balance, reconciliation, and spreadsheet workbooks.",
        scripts: {
          test: "node -e 0",
          "test:watch": "vitest",
          "benchmark:accounting": "node scripts/run-accounting-benchmark.mjs",
          "test:e2e": "playwright test",
        },
        dependencies: { react: "18.2.0", xlsx: "0.18.5" },
        devDependencies: { "@playwright/test": "1.48.0" },
      },
      null,
      2,
    ),
    "utf8",
  );
  writeFileSync(
    join(root, "README.md"),
    "The app reconciles invoices, journal entries, AR aging, AP aging, and workbook formulas.",
    "utf8",
  );
}

describe("proofloop target planner", () => {
  it("classifies a codebase, finds configured benchmark scripts, and writes a runner plan", async () => {
    const root = tempRoot();
    writeAccountingRepo(root);

    const exit = await runCli(["--dir", root, "target", "--write-runner-plan", "--json"]);
    expect(exit).toBe(0);

    const planPath = join(root, ".proofloop", "target", "latest-target-plan.json");
    const runnerPlanPath = join(root, ".proofloop", "runner", "target.plan.json");
    const reportPath = join(root, ".proofloop", "reports", "latest.md");
    expect(existsSync(planPath)).toBe(true);
    expect(existsSync(runnerPlanPath)).toBe(true);
    expect(existsSync(reportPath)).toBe(true);

    const plan = JSON.parse(readFileSync(planPath, "utf8")) as ProofloopTargetPlan;
    const report = readFileSync(reportPath, "utf8");
    const accounting = plan.recommendations.find((entry) => entry.id === "bankertoolbench");
    const spreadsheet = plan.recommendations.find((entry) => entry.id === "spreadsheetbench-v1");

    expect(plan.target.kind).toBe("codebase");
    expect(report).toContain("# ProofLoop Context Report");
    expect(report).toContain("ledger-room");
    expect(report).toContain("## Not Done / Blocked");
    expect(accounting?.adapterStatus).toBe("configured");
    expect(accounting?.configuredScripts.map((script) => script.name)).toContain("benchmark:accounting");
    expect(accounting?.evidence.join("\n")).toContain("trial balance");
    expect(spreadsheet?.adapterStatus).toBe("candidate");
    expect(plan.summary.officialScoreReady).toBe(false);
    expect(plan.blocked.join("\n")).toContain("Official benchmark scoring is not ready");
    expect(plan.runnerPlan?.tasks.some((task) => task.id === "benchmark.bankertoolbench.benchmark-accounting")).toBe(true);
    expect(plan.runnerPlan?.tasks.some((task) => task.id.includes("watch"))).toBe(false);
  });

  it("fetches a live URL, recommends benchmark families, and records missing browser automation separately", async () => {
    const root = tempRoot();
    const url = await startServer(`
      <html>
        <head><title>NodeRoom Accounting Room</title></head>
        <body>
          <form><input name="email" /><button>Subscribe</button></form>
          <main>Trial balance reconciliation, invoice ledger review, and chat room workflow.</main>
        </body>
      </html>
    `);
    const logs: string[] = [];

    const result = await runProofloopTarget({
      root,
      url,
      writeRunnerPlan: true,
      json: true,
      log: (message) => logs.push(message),
      logError: (message) => logs.push(message),
    });

    expect(result.exitCode).toBe(0);
    expect(existsSync(result.planPath)).toBe(true);
    expect(result.reportPath && existsSync(result.reportPath)).toBe(true);
    expect(result.latestReportPath && existsSync(result.latestReportPath)).toBe(true);
    expect(result.runnerPlanPath && existsSync(result.runnerPlanPath)).toBe(true);
    expect(result.plan.target.kind).toBe("live-url");
    expect(result.plan.target.httpStatus).toBe(200);
    expect(result.plan.summary.liveUrlReachable).toBe(true);
    expect(result.plan.recommendations.some((entry) => entry.id === "bankertoolbench")).toBe(true);
    expect(result.plan.recommendations.some((entry) => entry.id === "live-browser-smoke")).toBe(true);
    expect(result.plan.runnerPlan?.tasks.some((task) => task.id === "target.url-reachable")).toBe(true);
    expect(result.plan.blocked.join("\n")).toContain("no Playwright/Cypress/browser script");
    expect(logs.join("\n")).toContain('"schema": "proofloop-target-plan-v1"');
    expect(readFileSync(result.latestReportPath!, "utf8")).toContain("## Agent Handoff");
  });

  it("can scaffold a Playwright live-smoke adapter for a URL target", async () => {
    const root = tempRoot();
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify(
        {
          name: "live-target-app",
          scripts: { test: "node -e 0" },
          devDependencies: { "@playwright/test": "1.48.0" },
        },
        null,
        2,
      ),
      "utf8",
    );
    const url = await startServer("<html><body><a href='/next'>Open</a><button>Run</button><main>Workflow room</main></body></html>");

    const result = await runProofloopTarget({
      root,
      url,
      writeBrowserSmoke: true,
      writeRunnerPlan: true,
      log: () => {},
      logError: () => {},
    });

    const specPath = join(root, "proofloop", "browser", "live-smoke.spec.ts");
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { scripts: Record<string, string> };
    const browser = result.plan.recommendations.find((entry) => entry.id === "live-browser-smoke");

    expect(existsSync(specPath)).toBe(true);
    expect(result.latestReportPath && existsSync(result.latestReportPath)).toBe(true);
    expect(readFileSync(specPath, "utf8")).toContain(url);
    expect(pkg.scripts["proofloop:live-smoke"]).toBe("playwright test proofloop/browser/live-smoke.spec.ts");
    expect(browser?.adapterStatus).toBe("configured");
    expect(result.plan.generatedFiles.map((file) => file.replace(/\\/g, "/")).join("\n")).toContain("proofloop/browser/live-smoke.spec.ts");
    expect(result.plan.blocked.join("\n")).not.toContain("no Playwright/Cypress/browser script");
    expect(result.plan.runnerPlan?.tasks.some((task) => task.command === "npm run proofloop:live-smoke")).toBe(true);
  });
});

function startServer(html: string): Promise<string> {
  return new Promise((resolve) => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(html);
    });
    servers.push(server);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${address.port}/`);
    });
  });
}
