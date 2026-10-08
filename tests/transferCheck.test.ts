/**
 * A release engineer compares supplied capability and browser-labelled rows.
 * These synthetic fixtures exercise the real compiled CLI; they do not prove
 * live execution, production UI provenance, or the supplied sample selection.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { TransferSamplePlan } from "../src/transferCheck";

const REPO_ROOT = join(__dirname, "..");
const CLI_DIST = join(REPO_ROOT, "dist", "cli.js");

const tempRoots: string[] = [];
const activeChildren = new Set<ReturnType<typeof spawn>>();

afterEach(() => {
  for (const child of activeChildren) child.kill();
  activeChildren.clear();
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function runCliAsync(args: string[]): Promise<{ status: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_DIST, ...args], { cwd: REPO_ROOT });
    activeChildren.add(child);
    let stdout = "";
    let stderr = "";
    let finished = false;
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error("owned transfer CLI exceeded 20s"));
    }, 20_000);
    function finish(error?: Error, status = -1): void {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      activeChildren.delete(child);
      if (error) reject(error);
      else resolve({ status, stdout, stderr });
    }
    for (const [stream, name] of [[child.stdout, "stdout"], [child.stderr, "stderr"]] as const) {
      stream.on("data", (chunk: Buffer) => {
        if (name === "stdout") stdout += chunk.toString();
        else stderr += chunk.toString();
        if (stdout.length + stderr.length > 64 * 1024) {
          child.kill();
          finish(new Error("owned transfer CLI output exceeded 64KiB"));
        }
      });
    }
    child.on("error", (error) => finish(error));
    child.on("close", (status) => finish(undefined, status ?? -1));
  });
}

const INPUT_MAX = 10 * 1024 * 1024;

function paddedReceipts(bytes: number): Buffer {
  const rows = Buffer.from("\uFEFF" + JSON.stringify([
    { taskId: "unicode-é", model: "fixture", family: "banker", pass: false },
  ]), "utf8");
  return Buffer.concat([rows, Buffer.alloc(bytes - rows.length, " ")]);
}

function paddedLedger(bytes: number): Buffer {
  const row = Buffer.from(JSON.stringify({ schema: "proofloop-runner-event-v1", event: "task_completed", taskId: "banker.retry", data: { status: "failed" } }), "utf8");
  return Buffer.concat([row, Buffer.alloc(bytes - row.length, " ")]);
}

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

  it("100% agreement including failures reports supplied-row agreement without certifying provenance", () => {
    const root = tempRoot();
    const capability = writeReceipts(root, "capability.json", [
      receipt("t1", true),
      receipt("t2", true),
      receipt("t3", true),
      receipt("t4", true),
      receipt("t5", false),
      receipt("t6", false),
    ]);
    // Supplied rows agree on six verdicts, including two failures. The CLI
    // cannot establish where either file came from.
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
      "Agreement of supplied capability and browser-lane rows: 100% on 6 overlapping pairs including 2 capability-failure pairs. " +
        "Row provenance and seeded sample selection are NOT_VERIFIED. This is NOT live-agent or production-browser certification, and NOT an all-tasks-browser-verified claim.",
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
    expect(result.stdout).toContain("90% on 10 overlapping pairs including 2 capability-failure pairs");
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
    expect(result.stdout).not.toContain("Row provenance and seeded sample selection are NOT_VERIFIED."); // no claim line on divergence
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
    // An explicit override still reports zero paired failures.
    expect(result.stdout).toContain("including 0 capability-failure pairs");
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

  it("requires an explicit seed and recommends auditable selection without guaranteeing it", () => {
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

describe("a developer hands supplied results to the compiled transfer CLI", () => {
  it("distinguishes task/model tuples containing NUL instead of certifying false overlap", () => {
    const root = tempRoot();
    const capabilityRows = Array.from({ length: 5 }, (_, index) => receipt(`family.${index}\0alias`, index < 4, "family", "worker"));
    const browserRows = Array.from({ length: 5 }, (_, index) => receipt(`family.${index}`, index < 4, "family", "alias\0worker"));
    const capability = writeReceipts(root, "capability.json", capabilityRows);
    const browser = writeReceipts(root, "browser.json", browserRows);
    const distinct = writeReceipts(root, "distinct.json", [...capabilityRows, ...browserRows]);
    const duplicate = writeReceipts(root, "duplicate.json", [capabilityRows[0], capabilityRows[0]]);
    const cross = runCli(["transfer-check", "gate", "--capability", capability, "--browser", browser]);
    const sample = runCli(["transfer-check", "sample", "--capability", distinct, "--seed", "fixed", "--per-family", "100"]);
    const rejected = runCli(["transfer-check", "sample", "--capability", duplicate, "--seed", "fixed"]);
    console.log(JSON.stringify({ scenario: "distinct-tuple-collision", cross: cross.status, distinct: sample.status, duplicate: rejected.status }));
    expect(cross.status).toBe(2);
    expect(cross.stderr).toContain("zero paired taskId+model verdicts");
    expect(cross.stdout).not.toContain("AGREED");
    expect(sample.status).toBe(0);
    expect(JSON.parse(sample.stdout).pairs).toHaveLength(10);
    expect(rejected.status).toBe(2);
    expect(rejected.stderr).toContain("duplicate taskId+model");
  });

  it("admits exactly 10MiB of UTF-8/BOM input, rejects one extra byte before writing, and recovers", () => {
    const root = tempRoot();
    const bounded = join(root, "boundary.json");
    const oversized = join(root, "oversized.json");
    const output = join(root, "rejected-plan.json");
    writeFileSync(bounded, paddedReceipts(INPUT_MAX));
    writeFileSync(oversized, paddedReceipts(INPUT_MAX + 1));
    const admitted = runCli(["transfer-check", "sample", "--capability", bounded, "--seed", "bounded"]);
    expect(admitted.status).toBe(0);
    expect(JSON.parse(admitted.stdout).pairs[0].taskId).toBe("unicode-é");
    const rejected = runCli(["transfer-check", "sample", "--capability", oversized, "--seed", "bounded", "--out", output]);
    const recovered = runCli(["transfer-check", "sample", "--capability", bounded, "--seed", "bounded"]);
    console.log(JSON.stringify({ scenario: "read-boundary", admitted: admitted.status, oversized: rejected.status, recovered: recovered.status, outputExists: existsSync(output) }));
    expect(rejected.status).toBe(2);
    expect(rejected.stderr).toContain("10485760-byte limit");
    expect(existsSync(output)).toBe(false);
    expect(recovered.status).toBe(0);
    expect(recovered.stdout).toBe(admitted.stdout);
  });

  it("rejects a directory and a native special file without a success artifact", () => {
    const root = tempRoot();
    const output = join(root, "not-written.json");
    const directory = runCli(["transfer-check", "sample", "--capability", root, "--seed", "s", "--out", output]);
    const specialPath = process.platform === "win32" ? "\\\\.\\NUL" : "/dev/null";
    const special = runCli(["transfer-check", "sample", "--capability", specialPath, "--seed", "s", "--out", output]);
    expect(directory.status).toBe(2);
    expect(special.status).toBe(2);
    expect(special.stderr).toContain("fail-closed");
    expect(existsSync(output)).toBe(false);
  });

  it("reports a failed sample write as unusable and emits no successful JSON plan", () => {
    const root = tempRoot();
    const capability = capability20(root);
    const blocker = join(root, "file-blocks-directory");
    writeFileSync(blocker, "owned fixture");
    const failed = runCli(["transfer-check", "sample", "--capability", capability, "--seed", "s", "--out", join(blocker, "plan.json")]);
    expect(failed.status).toBe(2);
    expect(failed.stdout).toBe("");
    expect(failed.stderr).toContain("fail-closed");
  });

  it("keeps family picks independent and imports compiled exports without starting the CLI", () => {
    const root = tempRoot();
    const original = capability20(root);
    const rows = JSON.parse(readFileSync(original, "utf8")) as ReceiptRow[];
    const extended = writeReceipts(root, "extended.json", [...rows, receipt("new-1", false, "new-family"), receipt("new-2", true, "new-family")]);
    const first = runCli(["transfer-check", "sample", "--capability", original, "--seed", "fixed"]);
    const second = runCli(["transfer-check", "sample", "--capability", extended, "--seed", "fixed"]);
    expect(first.status).toBe(0);
    expect(second.status).toBe(0);
    expect(JSON.parse(second.stdout).pairs.filter((pair: { family: string }) => pair.family !== "new-family")).toEqual(JSON.parse(first.stdout).pairs);
    const imported = spawnSync(process.execPath, ["-e", "const api=require('./dist'); if(typeof api.evaluateTransferGate!=='function'||typeof api.runCli!=='function')process.exit(1)"], { cwd: REPO_ROOT, encoding: "utf8", timeout: 10_000 });
    expect(imported.status).toBe(0);
    expect(imported.stdout).toBe("");
    expect(imported.stderr).toBe("");
  });

  it("handles twelve simultaneous, isolated handoffs with agreement, divergence, and unusable inputs", async () => {
    const outcomes = await Promise.all(Array.from({ length: 12 }, async (_, index) => {
      const root = tempRoot();
      const rows = Array.from({ length: 6 }, (_, row) => receipt(`task-${row}`, row < 4, row % 2 === 0 ? "banker" : "sheets"));
      const capability = writeReceipts(root, "capability.json", rows);
      const browser = writeReceipts(root, "browser.json", rows.map((row, position) => ({ ...row, pass: index % 3 === 1 && position === 0 ? false : row.pass })));
      const output = join(root, "sample.json");
      const sample = await runCliAsync(["transfer-check", "sample", "--capability", capability, "--seed", "same-burst", "--out", output]);
      const gate = await runCliAsync(["transfer-check", "gate", "--capability", index % 3 === 2 ? join(root, "missing.json") : capability, "--browser", browser]);
      return { sample, gate, output: readFileSync(output, "utf8") };
    }));
    console.log(JSON.stringify({ scenario: "burst-12", statuses: outcomes.map(({ gate }) => gate.status), activeChildren: activeChildren.size }));
    expect(outcomes.map(({ gate }) => gate.status)).toEqual([0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2]);
    expect(outcomes.every(({ sample, output }) => sample.status === 0 && output === outcomes[0].output)).toBe(true);
    expect(outcomes.filter(({ gate }) => gate.status === 0).every(({ gate }) => gate.stdout.includes("Row provenance and seeded sample selection are NOT_VERIFIED."))).toBe(true);
    expect(activeChildren.size).toBe(0);
  });

  it("repeats real CLI sampling and gate calls for 60s, retains last retry, rejects growth, then recovers", async () => {
    const root = tempRoot();
    const ledger = join(root, "growing-ledger.jsonl");
    const browser = writeReceipts(root, "browser.json", [receipt("banker.retry", false, "banker", "fixture")]);
    const started = Date.now();
    const statuses: number[] = [];
    let iterations = 0;
    let firstSample = "";
    let stable = true;
    let honest = true;
    while (Date.now() - started < 60_000 && iterations < 80) {
      const lines = Array.from({ length: iterations + 1 }, (_, retry) => JSON.stringify({ schema: "proofloop-runner-event-v1", event: "task_completed", taskId: "banker.retry", data: { status: retry === iterations ? "failed" : "passed" } }));
      writeFileSync(ledger, lines.join("\n") + "\n");
      const sample = await runCliAsync(["transfer-check", "sample", "--capability", ledger, "--seed", "sustained", "--model", "fixture"]);
      const gate = await runCliAsync(["transfer-check", "gate", "--capability", ledger, "--browser", browser, "--min-overlap", "1", "--model", "fixture"]);
      statuses.push(sample.status, gate.status);
      if (!firstSample) firstSample = sample.stdout;
      stable = stable && sample.stdout === firstSample;
      honest = honest && gate.stdout.includes("Row provenance and seeded sample selection are NOT_VERIFIED.");
      iterations++;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    const oversized = join(root, "oversized-ledger.jsonl");
    writeFileSync(oversized, paddedLedger(INPUT_MAX + 1));
    const rejected = await runCliAsync(["transfer-check", "sample", "--capability", oversized, "--seed", "sustained"]);
    const recovered = await runCliAsync(["transfer-check", "sample", "--capability", ledger, "--seed", "sustained", "--model", "fixture"]);
    console.log(JSON.stringify({ scenario: "sustained-60s", elapsedMs: Date.now() - started, iterations, calls: statuses.length, successCalls: statuses.filter((status) => status === 0).length, stable, honest, oversized: rejected.status, recovered: recovered.status, activeChildren: activeChildren.size }));
    expect(Date.now() - started).toBeGreaterThanOrEqual(60_000);
    expect(iterations).toBeGreaterThanOrEqual(20);
    expect(statuses.every((status) => status === 0)).toBe(true);
    expect(stable).toBe(true);
    expect(honest).toBe(true);
    expect(rejected.status).toBe(2);
    expect(recovered.status).toBe(0);
    expect(recovered.stdout).toBe(firstSample);
    expect(activeChildren.size).toBe(0);
  }, 85_000);
});
