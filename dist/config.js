"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CONFIG_FILENAME = void 0;
exports.configPath = configPath;
exports.configExists = configExists;
exports.readConfig = readConfig;
exports.normalizeConfig = normalizeConfig;
exports.serializeConfig = serializeConfig;
/**
 * proofloop.config.json read/write for the portable package.
 *
 * Shape:
 *   {
 *     app: "Next.js" | "Vite" | "React" | "FastAPI/Python" | "generic web app" | ...,
 *     workflow: "<one-line intended-workflow hint>",
 *     gate: { checks: [ { name, command } ] },
 *     immutable: [ "<repo-relative path or prefix>" ],
 *     protectedPaths: [ "<repo-relative path or prefix>" ]
 *   }
 *
 * The config is the single source of truth for the local loop. `proofloop
 * gate` reads gate.checks; `proofloop hooks install` reads `immutable` and
 * `protectedPaths` (user ADDITIONS to the guard's default protected set --
 * ".proofloop/", "proofloop.config.json", ".github/workflows/"; the defaults
 * are not removable).
 */
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
exports.CONFIG_FILENAME = "proofloop.config.json";
function configPath(root) {
    return (0, node_path_1.join)((0, node_path_1.resolve)(root), exports.CONFIG_FILENAME);
}
function configExists(root) {
    return (0, node_fs_1.existsSync)(configPath(root));
}
/**
 * Read + normalize the config. Returns undefined when the file is absent.
 * Throws on unparseable JSON so we never silently run on a broken config.
 */
function readConfig(root) {
    const path = configPath(root);
    if (!(0, node_fs_1.existsSync)(path))
        return undefined;
    let parsed;
    try {
        parsed = JSON.parse((0, node_fs_1.readFileSync)(path, "utf8").replace(/^\uFEFF/, ""));
    }
    catch (error) {
        throw new Error(`proofloop.config.json is not valid JSON (${path}): ${error instanceof Error ? error.message : String(error)}`);
    }
    return normalizeConfig(parsed);
}
/** Coerce an arbitrary parsed value into a well-formed ProofloopConfig. */
function normalizeConfig(value) {
    const record = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const app = typeof record.app === "string" && record.app ? record.app : "generic web app";
    const workflow = typeof record.workflow === "string" ? record.workflow : "";
    const gateRecord = record.gate && typeof record.gate === "object" && !Array.isArray(record.gate) ? record.gate : {};
    const rawChecks = Array.isArray(gateRecord.checks) ? gateRecord.checks : [];
    const checks = [];
    for (const entry of rawChecks) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry))
            continue;
        const rec = entry;
        const command = typeof rec.command === "string" ? rec.command.trim() : "";
        if (!command)
            continue;
        const name = typeof rec.name === "string" && rec.name.trim() ? rec.name.trim() : command;
        checks.push({ name, command });
    }
    const immutable = Array.isArray(record.immutable)
        ? record.immutable.filter((entry) => typeof entry === "string" && entry.length > 0)
        : [];
    const protectedPaths = Array.isArray(record.protectedPaths)
        ? record.protectedPaths
            .filter((entry) => typeof entry === "string" && entry.trim().length > 0)
            // Normalize to the guard's repo-relative forward-slash convention.
            .map((entry) => entry.trim().replace(/\\/g, "/").replace(/^\.\//, ""))
        : [];
    return { app, workflow, gate: { checks }, immutable, protectedPaths };
}
function serializeConfig(config) {
    return `${JSON.stringify(config, null, 2)}\n`;
}
