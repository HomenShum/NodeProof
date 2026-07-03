"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runInit = runInit;
/**
 * `proofloop init` -- detect the app + intended-workflow hint and write a
 * starter proofloop.config.json. Non-destructive: if the config already
 * exists, print it and exit without overwriting.
 */
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const config_1 = require("./config");
const detect_1 = require("./detect");
/** Exit code: 0 always (init is non-destructive; existing config is fine). */
function runInit(options) {
    const root = (0, node_path_1.resolve)(options.root);
    const log = options.log ?? console.log;
    const path = (0, config_1.configPath)(root);
    if ((0, config_1.configExists)(root)) {
        log(`proofloop init: ${path} already exists (non-destructive -- not overwriting). Current config:`);
        const existing = (0, config_1.readConfig)(root);
        log((0, config_1.serializeConfig)(existing ?? { app: "generic web app", workflow: "", gate: { checks: [] }, immutable: [], protectedPaths: [] }));
        log("Next: add checks to gate.checks, then run `proofloop gate`.");
        return 0;
    }
    const app = (0, detect_1.detectApp)(root);
    const workflow = (0, detect_1.detectWorkflowHint)(root);
    const config = {
        app: app.app,
        workflow,
        gate: { checks: [] },
        immutable: [],
        protectedPaths: [],
    };
    (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(path), { recursive: true });
    (0, node_fs_1.writeFileSync)(path, (0, config_1.serializeConfig)(config), "utf8");
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
