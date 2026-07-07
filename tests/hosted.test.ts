import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/cli";
import {
  buildHostedRunBundle,
  buildHostedWorkerPlan,
  createHostedRunRequest,
  validateHostedRunRequest,
  verifyHostedDomainPermission,
  writeHostedRunBundle,
  type HostedWorkerPlan,
} from "../src/hosted";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "proofloop-hosted-"));
  tempRoots.push(root);
  return root;
}

describe("hosted proofloop intake", () => {
  it("requires consent and domain permission before a hosted URL can be automated", () => {
    const request = createHostedRunRequest({
      targetUrl: "https://example.com/app",
      appType: "workflow-agent",
      consentAccepted: false,
      ownsOrAuthorized: false,
      allowBrowserAutomation: false,
      allowRecording: false,
    });

    const permission = verifyHostedDomainPermission(request);
    const validation = validateHostedRunRequest(request);

    expect(permission.status).toBe("pending");
    expect(permission.evidence.join("\n")).toContain(".well-known/proofloop-domain-verification.txt");
    expect(validation.ok).toBe(false);
    expect(validation.blockers).toContain("consent_checkbox_required");
    expect(validation.blockers).toContain("domain_permission_verification_pending");
  });

  it("builds a NodeRoom dogfood contract without relying on memory-mode URLs", () => {
    const bundle = buildHostedRunBundle({
      targetUrl: "https://noderoom.live",
      appType: "agent-app",
      consentAccepted: true,
      ownsOrAuthorized: true,
      allowBrowserAutomation: true,
      allowRecording: true,
      families: ["workstreambench"],
      generatedAt: "2026-07-07T10:00:00.000Z",
    });

    const plan = buildHostedWorkerPlan(bundle, { generatedAt: "2026-07-07T10:01:00.000Z" });

    expect(bundle.permission.status).toBe("verified");
    expect(bundle.contract.success.urlIncludesAny).toContain("?room=");
    expect(bundle.contract.success.visibleTestIdAny).toContain("chat-composer");
    expect(bundle.contract.success.forbiddenUrlIncludes).toContain("mode=memory");
    expect(bundle.contract.benchmarkProxyTasks.some((task) => task.family === "workstreambench")).toBe(true);
    expect(bundle.artifactContract.video).toContain("video.webm");
    expect(plan.status).toBe("ready_for_managed_worker");
    expect(plan.worker.nodeRoomDogfoodCommand).toBe("npm run proofloop -- run agentic-qa-live");
  });

  it("writes a resumable hosted request, queue item, dashboard, and worker plan", async () => {
    const root = tempRoot();
    const result = writeHostedRunBundle({
      root,
      targetUrl: "https://noderoom.live",
      appType: "accounting-agent",
      consentAccepted: true,
      ownsOrAuthorized: true,
      allowBrowserAutomation: true,
      allowRecording: true,
      budgetUsd: 7,
      generatedAt: "2026-07-07T11:00:00.000Z",
    });
    const queuePath = join(root, result.bundle.runner.queuePath);

    expect(result.files.some((file) => file.endsWith("success-contract.json"))).toBe(true);
    expect(existsSync(queuePath)).toBe(true);
    expect(existsSync(join(root, ".proofloop", "hosted", "requests", result.bundle.runId, "dashboard.html"))).toBe(true);

    const runExit = await runCli(["--dir", root, "hosted", "run", "--request", result.bundle.runner.queuePath, "--json"]);
    const workerPlanPath = join(root, result.bundle.runner.artifactRoot, "worker-plan.json");
    const workerPlan = JSON.parse(readFileSync(workerPlanPath, "utf8")) as HostedWorkerPlan;

    expect(runExit).toBe(0);
    expect(workerPlan.status).toBe("ready_for_managed_worker");
    expect(workerPlan.benchmarkProxyTasks.some((task) => task.family === "bankertoolbench")).toBe(true);
    expect(workerPlan.artifactContract.scorecard).toContain("scorecard.md");
  });

  it("keeps arbitrary external URLs blocked unless allowlisted or domain-verified", async () => {
    const root = tempRoot();
    const exit = await runCli([
      "--dir",
      root,
      "hosted",
      "validate",
      "--url",
      "https://example.com",
      "--app-type",
      "chat-agent",
      "--consent",
    ]);

    expect(exit).toBe(1);
  });
});
