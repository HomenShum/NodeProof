/**
 * `proofloop this-repo [--goal ...]` -- the hackathon one-shot orchestrator.
 *
 * HONESTY: this does NOT auto-launch coding-agent workers and is NOT an
 * autonomous fleet. It orchestrates the LOCAL loop honestly: runs doctor,
 * ensures a config exists (init if missing), prints the kickoff prompt, and
 * tells the user to paste it into THEIR coding agent and then run
 * `proofloop gate`. The user drives their agent; the package supplies the
 * gate + hooks + contracts + prompt.
 */
import { resolve } from "node:path";
import { configExists, readConfig, type ProofloopConfig } from "./config";
import { runDoctor } from "./doctor";
import { runInit } from "./init";
import { writeProofloopLayeredRunnerPlan } from "./layeredPlan";
import { proofloopKickoffPrompt } from "./prompt";
import { runProofloopRunner } from "./runner";

export type ThisRepoIo = {
  log?: (line: string) => void;
  logError?: (line: string) => void;
};

export type ThisRepoOptions = {
  root: string;
  goal?: string;
  live?: boolean;
  writeRunnerPlan?: boolean;
  run?: boolean;
  budgetUsd?: number;
  maxTasks?: number;
} & ThisRepoIo;

/** Exit 0 unless the optional runner is asked to execute and a task fails. */
export async function runThisRepo(options: ThisRepoOptions): Promise<number> {
  const root = resolve(options.root);
  const log = options.log ?? console.log;
  const logError = options.logError ?? console.error;

  log("=== proofloop this-repo: wire the local proof loop on THIS repo ===");
  log("(Default mode drives YOUR coding agent through you. Add --write-runner-plan or --run to hand off to the local durable runner.)");
  log("");

  // 1. Doctor.
  log("--- Step 1: readiness check ---");
  runDoctor({ root, log });

  // 2. Ensure config.
  log("--- Step 2: config ---");
  if (!configExists(root)) {
    log("No proofloop.config.json found -- running `proofloop init` for you:");
    runInit({ root, log, agent: "auto", live: options.live === true });
  } else {
    log("proofloop.config.json already present.");
    const config: ProofloopConfig | undefined = readConfig(root);
    if (config && config.gate.checks.length === 0) {
      log("NOTE: gate.checks is empty. Add real checks so `proofloop gate` proves the app actually works.");
    }
    if (options.live) {
      log("Refreshing live Proof Loop scaffold:");
      runInit({ root, log, agent: "auto", live: true });
    }
  }
  log("");

  // 3. Print the kickoff prompt.
  log("--- Step 3: paste this into your coding agent ---");
  if (options.goal) {
    log(`Your goal for this run: ${options.goal}`);
    log("");
  }
  log(proofloopKickoffPrompt());
  log("");

  // 4. Optional durable runner handoff for external orchestrators.
  let runnerPlanPath: string | undefined;
  if (options.writeRunnerPlan === true || options.run === true) {
    log("--- Step 4: external runner plan ---");
    const result = writeProofloopLayeredRunnerPlan(root, { ...(options.goal ? { goal: options.goal } : {}) });
    runnerPlanPath = result.planPath;
    log(`proofloop this-repo: wrote ${runnerPlanPath}`);
    log(
      [
        `  mode=${result.plan.mode}`,
        `setup=${result.plan.summary.setupTasks}`,
        `capability=${result.plan.summary.capabilityTasks}`,
        `browser=${result.plan.summary.browserTasks}`,
        `browserRequiredForAllCapabilityTasks=${result.plan.summary.browserRequiredForAllCapabilityTasks}`,
      ].join(" "),
    );
    log("  run with:");
    log(`  npx proofloop runner run --plan "${runnerPlanPath.replace(/"/g, '\\"')}"${options.budgetUsd !== undefined ? ` --budget-usd ${options.budgetUsd}` : ""}`);
    log("");
  }

  if (options.run === true) {
    const planPath = runnerPlanPath ?? writeProofloopLayeredRunnerPlan(root, { ...(options.goal ? { goal: options.goal } : {}) }).planPath;
    const result = await runProofloopRunner({
      root,
      subcommand: "run",
      planPath,
      ...(options.budgetUsd !== undefined ? { budgetUsd: options.budgetUsd } : {}),
      ...(options.maxTasks !== undefined ? { maxTasks: options.maxTasks } : {}),
      log,
      logError,
    });
    return result.exitCode;
  }

  // 5. What to do next -- honest, no auto-run unless requested.
  log(options.writeRunnerPlan === true ? "--- Step 5: drive the loop ---" : "--- Step 4: drive the loop ---");
  log("  1. Paste the prompt above into Claude Code / Codex / your agent and let it do the work.");
  log("  2. Add real proof checks to proofloop.config.json gate.checks if you have not yet.");
  log("  3. Run `proofloop gate` -- it exits 0 only when every check passes. That is your proof.");
  log("  4. Run `proofloop hooks install` so the agent refuses to stop until the gate passes.");
  return 0;
}
