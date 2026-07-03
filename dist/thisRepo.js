"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runThisRepo = runThisRepo;
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
const node_path_1 = require("node:path");
const config_1 = require("./config");
const doctor_1 = require("./doctor");
const init_1 = require("./init");
const prompt_1 = require("./prompt");
/** Exit 0 always (this is a guided setup, not a gate). */
function runThisRepo(options) {
    const root = (0, node_path_1.resolve)(options.root);
    const log = options.log ?? console.log;
    log("=== proofloop this-repo: wire the local proof loop on THIS repo ===");
    log("(This drives YOUR coding agent through you -- it does not auto-launch or run an autonomous fleet.)");
    log("");
    // 1. Doctor.
    log("--- Step 1: readiness check ---");
    (0, doctor_1.runDoctor)({ root, log });
    // 2. Ensure config.
    log("--- Step 2: config ---");
    if (!(0, config_1.configExists)(root)) {
        log("No proofloop.config.json found -- running `proofloop init` for you:");
        (0, init_1.runInit)({ root, log, agent: "auto", live: options.live === true });
    }
    else {
        log("proofloop.config.json already present.");
        const config = (0, config_1.readConfig)(root);
        if (config && config.gate.checks.length === 0) {
            log("NOTE: gate.checks is empty. Add real checks so `proofloop gate` proves the app actually works.");
        }
        if (options.live) {
            log("Refreshing live Proof Loop scaffold:");
            (0, init_1.runInit)({ root, log, agent: "auto", live: true });
        }
    }
    log("");
    // 3. Print the kickoff prompt.
    log("--- Step 3: paste this into your coding agent ---");
    if (options.goal) {
        log(`Your goal for this run: ${options.goal}`);
        log("");
    }
    log((0, prompt_1.proofloopKickoffPrompt)());
    log("");
    // 4. What to do next -- honest, no auto-run.
    log("--- Step 4: drive the loop ---");
    log("  1. Paste the prompt above into Claude Code / Codex / your agent and let it do the work.");
    log("  2. Add real proof checks to proofloop.config.json gate.checks if you have not yet.");
    log("  3. Run `proofloop gate` -- it exits 0 only when every check passes. That is your proof.");
    log("  4. Run `proofloop hooks install` so the agent refuses to stop until the gate passes.");
    return 0;
}
