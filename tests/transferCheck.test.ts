/**
 * Scenario tests for `proofloop transfer-check` -- the two-layer certification
 * agreement gate.
 *
 * Persona: a release engineer certifies an agentic finance workflow. The
 * capability lane ran ALL benchmark tasks through the live agent harness
 * (cheap, headless); the browser lane replayed a seeded stratified sample
 * through the real production UI. These tests drive the REAL compiled
 * dist/cli.js as a subprocess in mkdtemp dirs -- no in-process shortcuts --
 * and cover happy path, divergence (both directions), starvation (overlap),
 * adversarial cherry-picking, determinism, failure stratification, the
 * runner-ledger reader, and malformed/duplicate input rejection.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { TransferSamplePlan } from "../src/transferCheck";

const REPO_ROOT = join(__dirname, "..");
const CLI_DIST = join(REPO_ROOT, "dist", "cli.js");

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "proofloop-transfer-"));
  tempRoots.push(root);
  return root;
}

function runCli(args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [CLI_DIST, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 60_000,
  });
  return { status: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

type ReceiptRow = Record<string, unknown>;

function writeReceipts(root: string, name: string, rows: ReceiptRow[]): string {
  const path = join(root, name);
  writeFileSync(path, `${JSON.stringify(rows, null, 2)}\n`, "utf8");
  return path;
}

function receipt(taskId: string, pass: boolean, family = "banker", model = "glm-4.7"): ReceiptRow {
  return { taskId, model, family, pass };
}

/**
 * The standard 20-task capability fixture: 2 families x 10 tasks, mixed
 * pass/fail. "banker" has 2 failures (20%); "sheets" has 4 failures (40%).
 */
function capability20(root: string): string {
  const rows: ReceiptRow[] = [];
  for (let i = 1; i <= 10; i++) {
    const id = `b${String(i).padStart(2, "0")}`;
    rows.push(receipt(id, !(i === 7 || i === 8), "banker"));
  }
  for (let i = 1; i <= 10; i++) {
    const id = `s${String(i).padStart(2, "0")}`;
    rows.push(receipt(id, !(i >= 6 && i <= 9), "sheets"));
  }
  return writeReceipts(root, "capability-20.json", rows);
}

describe("transfer-check gate: agreement pass (exit 0)", () => {
  it("has the compiled CLI available (build before test)", () => {
    expect(existsSync(CLI_DIST), "dist/cli.js must be built before running the CLI test (run `npm run build`)").toBe(true);
  });

  it("100% agreement including capability-failures prints the doctrine claim line verbatim and exits 0", () => {
    const root = tempRoot();
    const capability = writeReceipts(root, "capability.json", [
      receipt("t1", true),
      receipt("t2", true),
      receipt("t3", true),
      receipt("t4", true),
      receipt("t5", false),
      receipt("t6", false),
    ]);
    // The browser lane replays the same 6 tasks in the real UI and agrees on
    // every verdict -- including both failures (a failure that transfers is
    // evidence the harness failure was real, not an env artifact).
    const browser = writeReceipts(root, "browser.json", [
      receipt("t1", true),
      receipt("t2", true),
      receipt("t3", true),
      receipt("t4", true),
      receipt("t5", false),
      { ...receipt("t6", false), notes: "flaky selector, retried once" }, // unknown key -> warn, not reject
    ]);

    const result = runCli(["transfer-check", "gate", "--capability", capability, "--browser", browser]);
    expect(result.stderr).toContain('unknown key "notes"');
    expect(result.stdout).toContain("AGREED");
    expect(result.stdout).toContain(
      "Capability verified through the live agent harness; production browser path verified by stratified UI certification " +
        "(agreement 100% on 6 seeded pairs including 2 capability-failures). This is NOT an all-tasks-browser-verified claim.",
    );
    expect(result.status).toBe(0);
  });

  it("passes at exactly the threshold (9/10 agreement at --min-agreement 0.9, no float-noise false fail)", () => {
    const root = tempRoot();
    const capability = writeReceipts(
      root,
      "capability.json",
      Array.from({ length: 10 }, (_, i) => receipt(`c${i + 1}`, i < 8)), // c9, c10 fail
    );
    const browser = writeReceipts(
      root,
      "browser.json",
      Array.from({ length: 10 }, (_, i) => {
        if (i === 9) return receipt("c10", true); // single disagreement: capability-fail / browser-pass
        return receipt(`c${i + 1}`, i < 8);
      }),
    );

    const result = runCli(["transfer-check", "gate", "--capability", capability, "--browser", browser, "--min-agreement", "0.9"]);
    expect(result.stdout).toContain("agreement 90% on 10 seeded pairs including 2 capability-failures");
    expect(result.status).toBe(0);
  });
});

describe("transfer-check gate: divergence (exit 1)", () => {
  it("fails with a per-pair table labeling BOTH disagreement directions distinctly", () => {
    const root = tempRoot();
    const capability = writeReceipts(root, "capability.json", [
      receipt("a1", true),
      receipt("a2", false),
      receipt("a3", true),
      receipt("a4", false),
      receipt("a5", true),
      receipt("a6", false),
    ]);
    const browser = writeReceipts(root, "browser.json", [
      receipt("a1", false), // capability-pass / browser-fail: the harness claimed a pass the product cannot reproduce
      receipt("a2", true), //  capability-fail / browser-pass: the harness under-reports; env gap or harness bug
      receipt("a3", true),
      receipt("a4", false),
      receipt("a5", true),
      receipt("a6", false),
    ]);

    const result = runCli(["transfer-check", "gate", "--capability", capability, "--browser", browser]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("DIVERGED");
    expect(result.stdout).toContain("a1 [glm-4.7 / banker] capability=pass browser=fail -> suspected harness shortcut or product-path break -- capability claim suspect");
    expect(result.stdout).toContain("a2 [glm-4.7 / banker] capability=fail browser=pass -> suspected harness bug or env gap -- capability lane under-reporting");
    // The two directions must be labeled DIFFERENTLY -- they demand different investigations.
    expect(result.stdout).toContain("capability claim suspect");
    expect(result.stdout).toContain("capability lane under-reporting");
    expect(result.stdout).not.toContain("This is NOT an all-tasks-browser-verified claim."); // no claim line on divergence
  });
});

describe("transfer-check gate: unusable evidence (exit 2, fail-closed)", () => {
  it("refuses when paired overlap is below --min-overlap", () => {
    const root = tempRoot();
    const capability = capability20(root);
    const browser = writeReceipts(root, "browser.json", [receipt("b01", true), receipt("b02", true), receipt("b07", false)]);

    const result = runCli(["transfer-check", "gate", "--capability", capability, "--browser", browser]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("paired overlap 3 is below --min-overlap 5");
    expect(result.stderr).toContain("fail-closed");
  });

  it("never exits 0 on zero evidence, even when the caller passes --min-overlap 0", () => {
    const root = tempRoot();
    const capability = writeReceipts(root, "capability.json", [receipt("x1", true), receipt("x2", false)]);
    const browser = writeReceipts(root, "browser.json", [receipt("unrelated-1", true)]); // disjoint: no joinable pairs

    const result = runCli(["transfer-check", "gate", "--capability", capability, "--browser", browser, "--min-overlap", "0"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("zero paired taskId+model verdicts");
  });

  it("refuses unreadable lane input (garbage file) instead of guessing", () => {
    const root = tempRoot();
    const capability = join(root, "garbage.json");
    writeFileSync(capability, "this is not json at all\n", "utf8");
    const browser = writeReceipts(root, "browser.json", [receipt("t1", true)]);

    const result = runCli(["transfer-check", "gate", "--capability", capability, "--browser", browser]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("fail-closed");
  });
});

describe("transfer-check gate: cherry-pick guard (adversarial)", () => {
  // The agent under certification would love a browser sample containing only
  // its passes -- then a memory-mode shortcut in the harness failure path can
  // never be caught. That sample is refused by default.
  function cherryPickFixture(root: string): { capability: string; browser: string } {
    const capability = writeReceipts(root, "capability.json", [
      receipt("t1", true),
      receipt("t2", true),
      receipt("t3", true),
      receipt("t4", true),
      receipt("t5", true),
      receipt("t6", false),
      receipt("t7", false),
    ]);
    const browser = writeReceipts(root, "browser.json", [
      receipt("t1", true),
      receipt("t2", true),
      receipt("t3", true),
      receipt("t4", true),
      receipt("t5", true), // 5 pairs (meets min-overlap) but ZERO capability-failures sampled
    ]);
    return { capability, browser };
  }

  it("refuses (exit 2) when capability has failures but the browser paired set contains none of them", () => {
    const root = tempRoot();
    const { capability, browser } = cherryPickFixture(root);
    const result = runCli(["transfer-check", "gate", "--capability", capability, "--browser", browser]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("cherry-pick guard");
    expect(result.stderr).toContain("ZERO");
  });

  it("proceeds with a loud warning when --allow-no-failure-overlap is passed explicitly", () => {
    const root = tempRoot();
    const { capability, browser } = cherryPickFixture(root);
    const result = runCli([
      "transfer-check", "gate",
      "--capability", capability,
      "--browser", browser,
      "--allow-no-failure-overlap",
    ]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("WARNING: --allow-no-failure-overlap");
    expect(result.stdout).toContain("UNVERIFIED");
    // The claim line stays honest about having certified zero failures.
    expect(result.stdout).toContain("including 0 capability-failures");
  });
});

describe("transfer-check sample: seeded deterministic stratified sampler", () => {
  it("same seed + same input = byte-identical sample JSON; different seed = different sample", () => {
    const root = tempRoot();
    const capability = capability20(root);

    const first = runCli(["transfer-check", "sample", "--capability", capability, "--seed", "sha-alpha-1111"]);
    const second = runCli(["transfer-check", "sample", "--capability", capability, "--seed", "sha-alpha-1111"]);
    expect(first.status).toBe(0);
    expect(second.status).toBe(0);
    expect(second.stdout).toBe(first.stdout); // byte-identical

    const plan = JSON.parse(first.stdout) as TransferSamplePlan;
    expect(plan.schema).toBe("proofloop-transfer-sample-v1");
    expect(plan.seed).toBe("sha-alpha-1111");
    expect(plan.pairs.length).toBe(10); // 5 per family x 2 families

    const other = runCli(["transfer-check", "sample", "--capability", capability, "--seed", "sha-beta-2222"]);
    expect(other.status).toBe(0);
    const otherPlan = JSON.parse(other.stdout) as TransferSamplePlan;
    const firstKeys = new Set(plan.pairs.map((pair) => `${pair.taskId}+${pair.model}`));
    const differing = otherPlan.pairs.filter((pair) => !firstKeys.has(`${pair.taskId}+${pair.model}`));
    expect(differing.length).toBeGreaterThanOrEqual(1); // statistically distinct on the 20-task fixture
  });

  it("requires --seed (a commit SHA) so the agent cannot re-roll the sample until it likes it", () => {
    const root = tempRoot();
    const capability = capability20(root);
    const result = runCli(["transfer-check", "sample", "--capability", capability]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--seed");
    expect(result.stderr).toContain("cherry-picked");
  });

  it("includes at least ceil(N/3) capability-failures per family that has failures (40% failures at N=6 -> >=2 failure slots)", () => {
    const root = tempRoot();
    const capability = capability20(root); // sheets: 4/10 failures; banker: 2/10 failures

    const result = runCli(["transfer-check", "sample", "--capability", capability, "--per-family", "6", "--seed", "42cd067"]);
    expect(result.status).toBe(0);
    const plan = JSON.parse(result.stdout) as TransferSamplePlan;

    const sheets = plan.pairs.filter((pair) => pair.family === "sheets");
    expect(sheets.length).toBe(6);
    expect(sheets.filter((pair) => !pair.capabilityPass).length).toBeGreaterThanOrEqual(2); // ceil(6/3) = 2

    const banker = plan.pairs.filter((pair) => pair.family === "banker");
    expect(banker.length).toBe(6);
    expect(banker.filter((pair) => !pair.capabilityPass).length).toBeGreaterThanOrEqual(2); // both banker failures must be in
  });
});

describe("transfer-check lane readers", () => {
  it("derives per-task verdicts from a real runner events ledger (task_completed data.status; retry last-wins)", () => {
    const root = tempRoot();
    const at = "2026-07-05T00:00:00.000Z";
    const lines = [
      { schema: "proofloop-runner-event-v1", runId: "r1", at, event: "runner_started", data: { subcommand: "run", budgetUsd: 100, maxTasks: null } },
      { schema: "proofloop-runner-event-v1", runId: "r1", at, event: "task_started", taskId: "capability.tests", data: { command: "npm test", cwd: ".", envKeys: [], estimatedCostUsd: 0 } },
      { schema: "proofloop-runner-event-v1", runId: "r1", at, event: "task_completed", taskId: "capability.tests", data: { status: "passed", exitCode: 0, signal: null, stdout: "", stderr: "" } },
      { schema: "proofloop-runner-event-v1", runId: "r1", at, event: "task_completed", taskId: "capability.lint", data: { status: "failed", exitCode: 1, signal: null, stdout: "", stderr: "lint error" } },
      { schema: "proofloop-runner-event-v1", runId: "r1", at, event: "stale_running_requeued", taskId: "capability.lint", data: { previousStartedAt: at } },
      // Resume retried the lint task and it passed: the LAST completed verdict wins.
      { schema: "proofloop-runner-event-v1", runId: "r1", at, event: "task_completed", taskId: "capability.lint", data: { status: "passed", exitCode: 0, signal: null, stdout: "", stderr: "" } },
      { schema: "proofloop-runner-event-v1", runId: "r1", at, event: "task_completed", taskId: "browser.e2e", data: { status: "failed", exitCode: 1, signal: null, stdout: "", stderr: "" } },
      { schema: "proofloop-runner-event-v1", runId: "r1", at, event: "runner_finished", data: { status: "failed", spentEstimatedUsd: 0 } },
    ];
    const ledgerPath = join(root, "ledger.jsonl");
    writeFileSync(ledgerPath, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf8");

    const result = runCli(["transfer-check", "sample", "--capability", ledgerPath, "--seed", "sha-ledger", "--model", "glm-4.7"]);
    expect(result.status).toBe(0);
    const plan = JSON.parse(result.stdout) as TransferSamplePlan;
    const byId = new Map(plan.pairs.map((pair) => [pair.taskId, pair]));

    expect(byId.get("capability.tests")).toMatchObject({ family: "capability", model: "glm-4.7", capabilityPass: true });
    expect(byId.get("capability.lint")).toMatchObject({ family: "capability", model: "glm-4.7", capabilityPass: true }); // retry won
    expect(byId.get("browser.e2e")).toMatchObject({ family: "browser", model: "glm-4.7", capabilityPass: false });
  });

  it("warns loudly when a ledger is read without --model (joins would silently miss)", () => {
    const root = tempRoot();
    const ledgerPath = join(root, "ledger.jsonl");
    const line = {
      schema: "proofloop-runner-event-v1", runId: "r1", at: "2026-07-05T00:00:00.000Z",
      event: "task_completed", taskId: "capability.tests",
      data: { status: "passed", exitCode: 0, signal: null, stdout: "", stderr: "" },
    };
    writeFileSync(ledgerPath, `${JSON.stringify(line)}\n`, "utf8");

    const result = runCli(["transfer-check", "sample", "--capability", ledgerPath, "--seed", "s"]);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('model "unspecified"');
  });

  it("rejects duplicate taskId+model pairs in a receipts file (exit 2) -- two verdicts for one task is untrustworthy input", () => {
    const root = tempRoot();
    const capability = writeReceipts(root, "capability.json", [
      receipt("t1", true),
      receipt("t2", true),
      receipt("t1", false), // same taskId+model, contradictory verdict
    ]);
    const result = runCli(["transfer-check", "sample", "--capability", capability, "--seed", "s"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("duplicate taskId+model");

    const browser = writeReceipts(root, "browser.json", [receipt("t1", true)]);
    const gate = runCli(["transfer-check", "gate", "--capability", capability, "--browser", browser]);
    expect(gate.status).toBe(2);
    expect(gate.stderr).toContain("duplicate taskId+model");
  });

  it("rejects receipts entries with missing required fields instead of coercing", () => {
    const root = tempRoot();
    const capability = writeReceipts(root, "capability.json", [
      { taskId: "t1", model: "glm-4.7", family: "banker", pass: "true" }, // string, not boolean
    ]);
    const result = runCli(["transfer-check", "sample", "--capability", capability, "--seed", "s"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('"pass" (boolean) is required');
  });
});
