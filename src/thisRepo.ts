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
import { proofloopKickoffPrompt } from "./prompt";

export type ThisRepoIo = {
  log?: (line: string) => void;
  logError?: (line: string) => void;
};

/** Exit 0 always (this is a guided setup, not a gate). */
export function runThisRepo(options: { root: string; goal?: string; live?: boolean } & ThisRepoIo): 0 {
  const root = resolve(options.root);
  const log = options.log ?? console.log;

  log("=== proofloop this-repo: wire the local proof loop on THIS repo ===");
  log("(This drives YOUR coding agent through you -- it does not auto-launch or run an autonomous fleet.)");
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

  // 4. What to do next -- honest, no auto-run.
  log("--- Step 4: drive the loop ---");
  log("  1. Paste the prompt above into Claude Code / Codex / your agent and let it do the work.");
  log("  2. Add real proof checks to proofloop.config.json gate.checks if you have not yet.");
  log("  3. Run `proofloop gate` -- it exits 0 only when every check passes. That is your proof.");
  log("  4. Run `proofloop hooks install` so the agent refuses to stop until the gate passes.");
  return 0;
}
