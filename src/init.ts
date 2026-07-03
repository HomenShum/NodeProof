/**
 * `proofloop init` -- detect the app + intended-workflow hint and write a
 * starter proofloop.config.json. Non-destructive: if the config already
 * exists, print it and exit without overwriting.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { configExists, configPath, readConfig, serializeConfig, type ProofloopConfig } from "./config";
import { detectApp, detectWorkflowHint } from "./detect";
import {
  syncProofloopPackageScripts,
  writeProofloopAgentDocs,
  writeProofloopLiveScaffold,
  writeProofloopProjectManifest,
  type ProofloopAgentTarget,
} from "./project";

export type InitCliIo = {
  log?: (line: string) => void;
  logError?: (line: string) => void;
};

export type InitOptions = {
  root: string;
  agent?: ProofloopAgentTarget;
  live?: boolean;
  features?: string[];
} & InitCliIo;

/** Exit code: 0 always (init is non-destructive; existing config is fine). */
export function runInit(options: InitOptions): 0 {
  const root = resolve(options.root);
  const log = options.log ?? console.log;
  const path = configPath(root);
  const features = new Set(options.features ?? []);
  if (options.live) features.add("live");
  if (options.agent) features.add("agents");

  if (configExists(root)) {
    log(`proofloop init: ${path} already exists (non-destructive -- not overwriting). Current config:`);
    const existing = readConfig(root);
    log(serializeConfig(existing ?? { app: "generic web app", workflow: "", gate: { checks: [] }, immutable: [], protectedPaths: [] }));
  } else {
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
  }

  if (features.has("agents")) {
    const written = writeProofloopAgentDocs(root, options.agent ?? "auto");
    log(`proofloop init: agent docs ${written.length ? `wrote/updated ${written.join(", ")}` : "unchanged"}.`);
  }
  const scripts = syncProofloopPackageScripts(root);
  if (scripts.path) log(`proofloop init: package scripts ${scripts.changed ? "updated" : "already present"} in ${scripts.path}.`);
  if (features.has("live")) {
    const scaffold = writeProofloopLiveScaffold(root);
    log(`proofloop init: live scaffold ${scaffold.length ? `wrote ${scaffold.length} file(s)` : "already present"}.`);
  }
  const manifestPath = writeProofloopProjectManifest(root);
  log(`proofloop init: wrote ${manifestPath}`);
  log("");
  log("Next steps:");
  log("  1. Add real proof checks to proofloop.config.json gate.checks, e.g.:");
  log('       { "name": "build", "command": "npm run build" }');
  log('       { "name": "tests", "command": "npm test" }');
  log("  2. Run `proofloop doctor` to confirm you're ready.");
  log("  3. Paste `proofloop prompt` into your coding agent, then run `proofloop gate` to prove the work.");
  log("  4. `proofloop hooks install` to make your agent refuse fake \"done\".");
  log("  5. `proofloop resume --dense` shows the next action when the loop stops.");
  return 0;
}
