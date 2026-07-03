/**
 * `proofloop init` -- detect the app + intended-workflow hint and write a
 * starter proofloop.config.json. Non-destructive: if the config already
 * exists, print it and exit without overwriting.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { configExists, configPath, readConfig, serializeConfig, type ProofloopConfig } from "./config";
import { detectApp, detectWorkflowHint } from "./detect";

export type InitCliIo = {
  log?: (line: string) => void;
  logError?: (line: string) => void;
};

/** Exit code: 0 always (init is non-destructive; existing config is fine). */
export function runInit(options: { root: string } & InitCliIo): 0 {
  const root = resolve(options.root);
  const log = options.log ?? console.log;
  const path = configPath(root);

  if (configExists(root)) {
    log(`proofloop init: ${path} already exists (non-destructive -- not overwriting). Current config:`);
    const existing = readConfig(root);
    log(serializeConfig(existing ?? { app: "generic web app", workflow: "", gate: { checks: [] }, immutable: [], protectedPaths: [] }));
    log("Next: add checks to gate.checks, then run `proofloop gate`.");
    return 0;
  }

  const app = detectApp(root);
  const workflow = detectWorkflowHint(root);
  const config: ProofloopConfig = {
    app: app.app,
    workflow,
    gate: { checks: [] },
    immutable: [],
    protectedPaths: [],
  };

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serializeConfig(config), "utf8");

  log(`proofloop init: detected ${app.app} (${app.reason}).`);
  log(`proofloop init: wrote ${path}`);
  log("");
  log("Next steps:");
  log("  1. Add real proof checks to proofloop.config.json gate.checks, e.g.:");
  log('       { "name": "build", "command": "npm run build" }');
  log('       { "name": "tests", "command": "npm test" }');
  log("  2. Run `proofloop doctor` to confirm you're ready.");
  log("  3. Paste `proofloop prompt` into your coding agent, then run `proofloop gate` to prove the work.");
  log("  4. `proofloop hooks install` to make your agent refuse fake \"done\".");
  return 0;
}
