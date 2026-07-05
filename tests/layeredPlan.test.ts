import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/cli";
import { writeProofloopLayeredRunnerPlan } from "../src/layeredPlan";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "proofloop-layered-plan-"));
  tempRoots.push(root);
  return root;
}

function writePackage(root: string): void {
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify(
      {
        name: "demo-agent-app",
        scripts: {
          build: "node -e 0",
          test: "vitest run",
          "test:e2e": "playwright test",
          "proofloop:browser": "playwright test e2e/proofloop.spec.ts",
        },
      },
      null,
      2,
    ),
    "utf8",
  );
}

describe("two-layer runner plan", () => {
  it("separates capability checks from browser certification checks", () => {
    const root = tempRoot();
    writePackage(root);

    const result = writeProofloopLayeredRunnerPlan(root, { goal: "proofloop my latest updates" });

    expect(existsSync(result.planPath)).toBe(true);
    expect(result.plan.mode).toBe("two-layer-certification-v1");
    expect(result.plan.goal).toBe("proofloop my latest updates");
    expect(result.plan.summary.browserRequiredForAllCapabilityTasks).toBe(false);
    expect(result.plan.summary.capabilityTasks).toBeGreaterThanOrEqual(3);
    expect(result.plan.summary.browserTasks).toBe(2);
    expect(result.plan.tasks.find((task) => task.id === "capability.build")?.command).toBe("npm run build");
    expect(result.plan.tasks.find((task) => task.id === "capability.test")?.command).toBe("npm run test");
    expect(result.plan.tasks.find((task) => task.id === "capability.gate")?.command).toBe("npx proofloop gate");
    expect(result.plan.tasks.find((task) => task.id === "browser.test-e2e")?.command).toBe("npm run test:e2e");
    expect(result.plan.tasks.find((task) => task.id === "browser.proofloop-browser")?.command).toBe("npm run proofloop:browser");
  });

  it("lets this-repo write the durable plan an external orchestrator can run", async () => {
    const root = tempRoot();
    writePackage(root);

    expect(await runCli(["--dir", root, "this-repo", "--goal", "proofloop my latest updates", "--write-runner-plan"])).toBe(0);

    const planPath = join(root, ".proofloop", "runner", "latest-updates.plan.json");
    expect(existsSync(planPath)).toBe(true);
    const plan = JSON.parse(readFileSync(planPath, "utf8")) as { mode: string; summary: { browserRequiredForAllCapabilityTasks: boolean } };
    expect(plan.mode).toBe("two-layer-certification-v1");
    expect(plan.summary.browserRequiredForAllCapabilityTasks).toBe(false);
  });
});
