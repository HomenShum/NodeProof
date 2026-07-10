"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.installSoloFounderSkill = exports.setupSoloSkill = exports.installSoloFounderNodes = exports.installSoloSkill = exports.SOLO_INSTALL_DEPENDENCIES_COMMAND = exports.SOLO_CONFORMANCE_PACKAGE_SCRIPT = exports.SOLO_SMOKE_PACKAGE_SCRIPT = exports.SOLO_SFN_PACKAGE_SCRIPT = exports.SOLO_SETUP_INTEROP_SCHEMA_RAW_SHA256 = exports.SOLO_SETUP_INTEROP_SCHEMA_DIGEST = exports.SOLO_STOP_GATE_COMMAND = exports.SOLO_STOP_GATE_PATH = exports.SOLO_SETUP_RECEIPT_PATH = exports.SOLO_CLAUDE_WRAPPER_PATH = exports.SOLO_CANONICAL_SKILL_PATH = exports.SOLO_SKILL_NAME = void 0;
exports.setupSolo = setupSolo;
exports.soloSetupReceiptPath = soloSetupReceiptPath;
exports.buildSoloStopGateScript = buildSoloStopGateScript;
const node_child_process_1 = require("node:child_process");
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
exports.SOLO_SKILL_NAME = "solo-founder-nodes";
exports.SOLO_CANONICAL_SKILL_PATH = ".agents/skills/solo-founder-nodes";
exports.SOLO_CLAUDE_WRAPPER_PATH = ".claude/skills/solo-founder-nodes/SKILL.md";
exports.SOLO_SETUP_RECEIPT_PATH = ".proofloop/setup/solo-founder.json";
exports.SOLO_STOP_GATE_PATH = ".proofloop/hooks/solo-stop-gate.cjs";
exports.SOLO_STOP_GATE_COMMAND = `node ${exports.SOLO_STOP_GATE_PATH}`;
/** Stable JSON contract digest, independent of whitespace and line endings. */
exports.SOLO_SETUP_INTEROP_SCHEMA_DIGEST = "15c586031558b7cbc68623dc976c5e01f067a847e0dee2cf64970ede86e27ef9";
/** Raw bytes of the checked-in NodeProof schema, useful only as a local diagnostic. */
exports.SOLO_SETUP_INTEROP_SCHEMA_RAW_SHA256 = "92f6f24a56f6e31e5d521f09b625d8714370ffa68ea094d340710c715fc901f2";
exports.SOLO_SFN_PACKAGE_SCRIPT = `npm --prefix ${exports.SOLO_CANONICAL_SKILL_PATH}/templates run sfn --`;
exports.SOLO_SMOKE_PACKAGE_SCRIPT = `npm --prefix ${exports.SOLO_CANONICAL_SKILL_PATH}/templates run smoke`;
exports.SOLO_CONFORMANCE_PACKAGE_SCRIPT = `node ${exports.SOLO_CANONICAL_SKILL_PATH}/conformance/conformance.mjs --run-smoke`;
exports.SOLO_INSTALL_DEPENDENCIES_COMMAND = `npm --prefix ${exports.SOLO_CANONICAL_SKILL_PATH}/templates install --ignore-scripts --no-audit --no-fund`;
const INTEROP_SCHEMA_FILE = "proofloop-solo-interop-v1.schema.json";
const GITIGNORE_START = "# >>> NodeProof Solo Founder setup >>>";
const GITIGNORE_END = "# <<< NodeProof Solo Founder setup <<<";
const GITIGNORE_BLOCK = [
    GITIGNORE_START,
    `${exports.SOLO_CANONICAL_SKILL_PATH}/templates/node_modules/`,
    `${exports.SOLO_CANONICAL_SKILL_PATH}/templates/package-lock.json`,
    ".solo/",
    ".proofloop/",
    GITIGNORE_END,
].join("\n");
const REQUIRED_SOURCE_FILES = [
    "SKILL.md",
    "MASTER_SKILL.md",
    "templates/package.json",
    "conformance/conformance.mjs",
];
const EXCLUDED_DIRECTORY_NAMES = new Set([
    ".git",
    ".solo",
    ".proofloop",
    ".solo-ledger",
    ".solo-memory",
    ".solo-control",
    "node_modules",
    "spreadsheetbench",
    ".cache",
    "cache",
    "caches",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    ".npm",
    ".pnpm-store",
    ".turbo",
    ".vite",
    ".next",
    ".parcel-cache",
    "coverage",
    "_sb_out",
    "benchmark-output",
    "benchmark-outputs",
    "generated-benchmark-output",
    "generated-benchmark-outputs",
]);
class SourceValidationError extends Error {
}
class SetupConflictError extends Error {
}
/** Install a validated local Solo skill without contacting a model provider. */
function setupSolo(options = {}) {
    const targetRoot = (0, node_path_1.resolve)(options.targetRoot ?? options.root ?? process.cwd());
    (0, node_fs_1.mkdirSync)(targetRoot, { recursive: true });
    const agentsValue = options.agents ?? options.agent ?? "both";
    const agents = isSoloSetupAgents(agentsValue) ? agentsValue : "both";
    const sourcePath = options.sourceDir ? (0, node_path_1.resolve)(options.sourceDir) : null;
    const skillPath = (0, node_path_1.join)(targetRoot, ...exports.SOLO_CANONICAL_SKILL_PATH.split("/"));
    const wrapperPath = (0, node_path_1.join)(targetRoot, ...exports.SOLO_CLAUDE_WRAPPER_PATH.split("/"));
    const stopGatePath = (0, node_path_1.join)(targetRoot, ...exports.SOLO_STOP_GATE_PATH.split("/"));
    const receiptPath = soloSetupReceiptPath(targetRoot);
    const modifiedPaths = [];
    let failedNextCommand;
    let packagePlan;
    const receipt = {
        schema: "nodeproof-solo-setup-v1",
        generatedAt: options.generatedAt ?? (options.now?.() ?? new Date()).toISOString(),
        status: "failed",
        agents,
        sourcePath,
        sourceSkillPath: null,
        sourceManifestDigest: null,
        schemaDigest: exports.SOLO_SETUP_INTEROP_SCHEMA_DIGEST,
        schemaRawSha256: null,
        schemaSource: null,
        installAction: "none",
        installedPaths: [],
        modifiedPaths,
        commandResults: [],
        stopCommand: exports.SOLO_STOP_GATE_COMMAND,
        nextCommands: [],
        message: "Solo setup did not complete.",
    };
    const finish = (status, message) => {
        receipt.status = status;
        receipt.message = message;
        receipt.modifiedPaths = dedupe(modifiedPaths);
        receipt.installedPaths = installedRelativePaths(targetRoot, agents, receiptPath);
        receipt.nextCommands = nextCommandsForSetup({
            status,
            options,
            agents,
            sourcePath,
            failedNextCommand,
            packagePlan,
        });
        writeJsonAtomic(receiptPath, receipt);
        return {
            ...receipt,
            targetRoot,
            skillPath,
            claudeWrapperPath: agents === "codex" ? null : wrapperPath,
            stopGatePath,
            receiptPath,
            command: exports.SOLO_STOP_GATE_COMMAND,
        };
    };
    if (!isSoloSetupAgents(agentsValue)) {
        return finish("failed", `Invalid agents value ${String(agentsValue)}; expected codex, claude-code, or both.`);
    }
    let source;
    let sourceManifest;
    try {
        source = resolveSoloSource(sourcePath);
        receipt.sourceSkillPath = source.skillPath;
        validateRequiredSourceFiles(source.skillPath);
        const schema = validateFrozenInteropSchema(source);
        receipt.schemaRawSha256 = schema.rawSha256;
        receipt.schemaSource = schema.source;
        try {
            sourceManifest = buildManifest(source.skillPath, "Solo source");
        }
        catch (error) {
            throw new SourceValidationError(safeErrorMessage(error));
        }
        receipt.sourceManifestDigest = digestManifest(sourceManifest);
        packagePlan = planPackageScripts(targetRoot);
    }
    catch (error) {
        if (error instanceof SourceValidationError)
            return finish("needs_source", error.message);
        return finish("failed", safeErrorMessage(error));
    }
    const expectedWrapper = claudeWrapperText();
    if (agents !== "codex" && (0, node_fs_1.existsSync)(wrapperPath)) {
        const wrapperEntry = (0, node_fs_1.lstatSync)(wrapperPath);
        if (!wrapperEntry.isFile() || wrapperEntry.isSymbolicLink()) {
            return finish("conflict", `Refusing conflicting Claude wrapper at ${exports.SOLO_CLAUDE_WRAPPER_PATH}.`);
        }
        if ((0, node_fs_1.readFileSync)(wrapperPath, "utf8") !== expectedWrapper && !options.force) {
            return finish("conflict", `Refusing to replace the existing Claude wrapper at ${exports.SOLO_CLAUDE_WRAPPER_PATH} without force.`);
        }
    }
    try {
        if ((0, node_fs_1.existsSync)(skillPath)) {
            const installedEntry = (0, node_fs_1.lstatSync)(skillPath);
            if (!installedEntry.isDirectory() || installedEntry.isSymbolicLink()) {
                throw new SetupConflictError(`Refusing conflicting install at ${exports.SOLO_CANONICAL_SKILL_PATH}.`);
            }
            const installedDigest = digestManifest(buildManifest(skillPath, "installed Solo skill"));
            if (installedDigest === receipt.sourceManifestDigest) {
                receipt.installAction = "unchanged";
            }
            else if (!options.force) {
                throw new SetupConflictError(`Refusing conflicting install at ${exports.SOLO_CANONICAL_SKILL_PATH}; rerun with force to replace it.`);
            }
            else {
                replaceInstalledTree(sourceManifest, receipt.sourceManifestDigest, skillPath);
                receipt.installAction = "updated";
            }
        }
        else {
            replaceInstalledTree(sourceManifest, receipt.sourceManifestDigest, skillPath);
            receipt.installAction = "installed";
        }
    }
    catch (error) {
        if (error instanceof SetupConflictError)
            return finish("conflict", error.message);
        return finish("failed", safeErrorMessage(error));
    }
    try {
        if (agents !== "codex" && writeTextIfChanged(wrapperPath, expectedWrapper)) {
            modifiedPaths.push(exports.SOLO_CLAUDE_WRAPPER_PATH);
        }
        if (writeTextIfChanged(stopGatePath, buildSoloStopGateScript())) {
            modifiedPaths.push(exports.SOLO_STOP_GATE_PATH);
        }
        try {
            (0, node_fs_1.chmodSync)(stopGatePath, 0o755);
        }
        catch {
            // Windows and restrictive filesystems may not expose POSIX modes; Node can still execute the file.
        }
        if (packagePlan.changed && writeTextIfChanged(packagePlan.path, packagePlan.content)) {
            modifiedPaths.push("package.json");
        }
        if (mergeGitignore(targetRoot))
            modifiedPaths.push(".gitignore");
    }
    catch (error) {
        return finish("failed", safeErrorMessage(error));
    }
    const runner = options.commandRunner ?? options.runCommand ?? defaultCommandRunner;
    const commands = commandSpecs({
        installDependencies: options.installDependencies === true,
        verify: options.verify === true,
        skillPath,
        packagePlan,
    });
    for (const spec of commands) {
        const result = executeCommand(runner, spec, targetRoot);
        receipt.commandResults.push(result);
        if (result.status === "failed") {
            failedNextCommand = spec.nextCommand;
            return finish("failed", `${spec.id} failed with exit ${result.exitCode ?? "error"}.`);
        }
    }
    return finish("ready", receipt.installAction === "unchanged"
        ? "Solo skill already matched the trusted source manifest; project setup is ready."
        : "Solo skill setup is ready.");
}
/** Compatibility aliases for callers that describe setup as installation. */
exports.installSoloSkill = setupSolo;
exports.installSoloFounderNodes = setupSolo;
exports.setupSoloSkill = setupSolo;
exports.installSoloFounderSkill = setupSolo;
function soloSetupReceiptPath(root) {
    return (0, node_path_1.join)((0, node_path_1.resolve)(root), ...exports.SOLO_SETUP_RECEIPT_PATH.split("/"));
}
/**
 * One host-neutral Stop command: base NodeProof gate, optional Solo judge, then
 * optional NodeProof interop ingestion and gate. It installs no host settings.
 */
function buildSoloStopGateScript() {
    return `#!/usr/bin/env node
"use strict";

// Generated by NodeProof Solo setup. Configure this as the single Stop command;
// do not install separate NodeProof and Solo Stop hooks beside it.
const { spawnSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const { join, resolve } = require("node:path");

const REPO_ROOT = resolve(__dirname, "..", "..");
const SOLO_TEMPLATES = join(REPO_ROOT, ".agents", "skills", "solo-founder-nodes", "templates");
const SOLO_LOOP_STATE = join(REPO_ROOT, ".solo", "loop-state.json");
const SOLO_INTEROP = join(REPO_ROOT, ".solo", "proofloop-interop.json");
const WINDOWS = process.platform === "win32";
const NPM = "npm";
const NPX = "npx";

function tail(value, max = 2000) {
  const text = String(value || "").trim();
  return text.length > max ? text.slice(text.length - max) : text;
}

function run(label, command, args, allowNoGate = false) {
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    shell: WINDOWS,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    timeout: 30 * 60 * 1000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (!result.error && result.status === 0) return;
  // proofloop gate --check uses 2 for a fresh project with no persisted base gate.
  if (!result.error && allowNoGate && result.status === 2) return;
  const detail = tail(result.stderr) || tail(result.stdout) ||
    (result.error ? String(result.error.message || result.error) : "exit " + String(result.status));
  process.stderr.write("NodeProof coordinated Stop gate: " + label + " failed. " + detail + "\\n");
  process.exit(2);
}

// 1. Base NodeProof gate (read the persisted result; do not rerun an expensive suite on Stop).
run("base NodeProof gate", NPX, ["proofloop", "gate", "--check"], true);

// 2. Solo's fresh-context judge is relevant only after a Solo loop exists.
if (existsSync(SOLO_LOOP_STATE)) {
  run("Solo fresh-context judge", NPM, [
    "--prefix", SOLO_TEMPLATES, "run", "sfn", "--",
    "judge", "current", "--project", ".", "--on-stop",
  ]);
}

// 3. The immutable NodeProof interop verifier is relevant only after Solo exports an envelope.
if (existsSync(SOLO_INTEROP)) {
  run("NodeProof Solo ingest", NPX, [
    "proofloop", "solo", "ingest", "--file", ".solo/proofloop-interop.json", "--json",
  ]);
  run("NodeProof Solo gate", NPX, ["proofloop", "solo", "gate", "--json"]);
}
`;
}
function resolveSoloSource(sourcePath) {
    if (!sourcePath)
        throw new SourceValidationError("A trusted local Solo sourceDir is required.");
    if (!(0, node_fs_1.existsSync)(sourcePath))
        throw new SourceValidationError(`Solo source not found: ${sourcePath}`);
    const sourceEntry = (0, node_fs_1.lstatSync)(sourcePath);
    if (!sourceEntry.isDirectory() || sourceEntry.isSymbolicLink()) {
        throw new SourceValidationError(`Solo sourceDir must be a real directory: ${sourcePath}`);
    }
    const nested = (0, node_path_1.join)(sourcePath, "skills", exports.SOLO_SKILL_NAME);
    if (isRealDirectory(nested))
        return { inputPath: sourcePath, skillPath: nested };
    if (isRealDirectory(sourcePath))
        return { inputPath: sourcePath, skillPath: sourcePath };
    throw new SourceValidationError(`Solo source must be either its repository root or the skills/${exports.SOLO_SKILL_NAME} directory.`);
}
function validateRequiredSourceFiles(skillRoot) {
    for (const relativePath of REQUIRED_SOURCE_FILES) {
        const path = (0, node_path_1.join)(skillRoot, ...relativePath.split("/"));
        if (!(0, node_fs_1.existsSync)(path))
            throw new SourceValidationError(`Solo source is missing ${relativePath}.`);
        const entry = (0, node_fs_1.lstatSync)(path);
        if (!entry.isFile() || entry.isSymbolicLink() || entry.size === 0) {
            throw new SourceValidationError(`Solo source has an invalid ${relativePath}.`);
        }
    }
    const skill = (0, node_fs_1.readFileSync)((0, node_path_1.join)(skillRoot, "SKILL.md"), "utf8").replace(/^\uFEFF/, "");
    if (!/^---\s*[\s\S]*?\bname:\s*solo-founder-nodes\b[\s\S]*?---/i.test(skill)) {
        throw new SourceValidationError("Solo SKILL.md does not declare the solo-founder-nodes skill frontmatter.");
    }
    const master = (0, node_fs_1.readFileSync)((0, node_path_1.join)(skillRoot, "MASTER_SKILL.md"), "utf8");
    if (!/held-out/i.test(master) || !/no answer-keys/i.test(master)) {
        throw new SourceValidationError("Solo MASTER_SKILL.md is missing its proof-loop safety directives.");
    }
    const conformance = (0, node_fs_1.readFileSync)((0, node_path_1.join)(skillRoot, "conformance", "conformance.mjs"), "utf8");
    if (!/conformance/i.test(conformance)) {
        throw new SourceValidationError("Solo conformance/conformance.mjs is not a recognizable conformance probe.");
    }
    let templatePackage;
    try {
        templatePackage = JSON.parse((0, node_fs_1.readFileSync)((0, node_path_1.join)(skillRoot, "templates", "package.json"), "utf8").replace(/^\uFEFF/, ""));
    }
    catch {
        throw new SourceValidationError("Solo templates/package.json is not valid JSON.");
    }
    const scripts = asRecord(asRecord(templatePackage)?.scripts);
    if (typeof scripts?.sfn !== "string" || typeof scripts?.smoke !== "string") {
        throw new SourceValidationError("Solo templates/package.json must declare sfn and smoke scripts.");
    }
}
function validateFrozenInteropSchema(source) {
    const sourceCandidates = dedupe([
        (0, node_path_1.join)(source.inputPath, "schemas", INTEROP_SCHEMA_FILE),
        (0, node_path_1.join)(source.skillPath, "schemas", INTEROP_SCHEMA_FILE),
        (0, node_path_1.join)(source.skillPath, "..", "..", "schemas", INTEROP_SCHEMA_FILE),
    ]);
    const bundledSchema = (0, node_path_1.join)(__dirname, "..", "schemas", INTEROP_SCHEMA_FILE);
    const bundledRawSha256 = validateSchemaFile(bundledSchema, false);
    const sourceSchema = sourceCandidates.find((path) => (0, node_fs_1.existsSync)(path));
    if (!sourceSchema)
        return { rawSha256: bundledRawSha256, source: "nodeproof" };
    return { rawSha256: validateSchemaFile(sourceSchema, true), source: "source" };
}
function validateSchemaFile(path, fromSource) {
    const fail = (message) => {
        if (fromSource)
            throw new SourceValidationError(message);
        throw new Error(message);
    };
    if (!(0, node_fs_1.existsSync)(path))
        return fail(`Frozen interop schema not found: ${path}`);
    const entry = (0, node_fs_1.lstatSync)(path);
    if (!entry.isFile() || entry.isSymbolicLink())
        return fail("Frozen interop schema must be a regular file.");
    const raw = (0, node_fs_1.readFileSync)(path);
    let parsed;
    try {
        parsed = JSON.parse(raw.toString("utf8").replace(/^\uFEFF/, ""));
    }
    catch {
        return fail("Frozen interop schema is not valid JSON.");
    }
    const canonicalDigest = sha256(Buffer.from(JSON.stringify(parsed), "utf8"));
    if (canonicalDigest !== exports.SOLO_SETUP_INTEROP_SCHEMA_DIGEST) {
        return fail(`Frozen interop schema canonical digest mismatch: expected ${exports.SOLO_SETUP_INTEROP_SCHEMA_DIGEST}, got ${canonicalDigest}.`);
    }
    return sha256(raw);
}
function buildManifest(root, label) {
    const entries = [];
    const visit = (directory, prefix) => {
        const children = (0, node_fs_1.readdirSync)(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
        for (const child of children) {
            const relativePath = prefix ? `${prefix}/${child.name}` : child.name;
            if (isExcluded(relativePath, child.isDirectory()))
                continue;
            const absolutePath = (0, node_path_1.join)(directory, child.name);
            if (child.isSymbolicLink())
                throw new Error(`${label} contains a symbolic link at ${relativePath}.`);
            if (child.isDirectory()) {
                visit(absolutePath, relativePath);
            }
            else if (child.isFile()) {
                entries.push({ relativePath, absolutePath });
            }
            else {
                throw new Error(`${label} contains an unsupported entry at ${relativePath}.`);
            }
        }
    };
    visit(root, "");
    return entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}
function isExcluded(relativePath, isDirectory) {
    const segments = relativePath.split("/");
    const name = segments[segments.length - 1].toLowerCase();
    if (EXCLUDED_DIRECTORY_NAMES.has(name))
        return true;
    if (isDirectory && /(?:^|[-_.])caches?$/.test(name))
        return true;
    if (isDirectory && /^(?:\.?|generated-)(?:benchmark|bench)[-_]?(?:output|outputs|results|artifacts)$/.test(name))
        return true;
    if (name === "package-lock.json" || name === ".ds_store" || name.endsWith(".pyc"))
        return true;
    if (/^_probe_.*\.py$/i.test(name))
        return true;
    if (/(?:_run|_probe_capture)\.log$/i.test(name))
        return true;
    if (/^results_.*\.json$/i.test(name))
        return true;
    if (/^(?:generated[-_])?(?:benchmark|bench)[-_]?(?:output|outputs|results|artifacts)(?:[-_.].*)?$/i.test(name))
        return true;
    if (/\.db(?:-wal|-shm)?$/i.test(name))
        return true;
    return false;
}
function digestManifest(entries) {
    const hash = (0, node_crypto_1.createHash)("sha256");
    for (const entry of entries) {
        const bytes = (0, node_fs_1.readFileSync)(entry.absolutePath);
        hash.update(entry.relativePath, "utf8");
        hash.update("\0");
        hash.update(String(bytes.length), "utf8");
        hash.update("\0");
        hash.update(bytes);
        hash.update("\0");
    }
    return hash.digest("hex");
}
function replaceInstalledTree(entries, expectedDigest, destination) {
    const parent = (0, node_path_1.dirname)(destination);
    (0, node_fs_1.mkdirSync)(parent, { recursive: true });
    const token = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const staging = (0, node_path_1.join)(parent, `.${exports.SOLO_SKILL_NAME}.staging-${token}`);
    const backup = (0, node_path_1.join)(parent, `.${exports.SOLO_SKILL_NAME}.backup-${token}`);
    (0, node_fs_1.rmSync)(staging, { recursive: true, force: true });
    (0, node_fs_1.rmSync)(backup, { recursive: true, force: true });
    (0, node_fs_1.mkdirSync)(staging, { recursive: true });
    try {
        for (const entry of entries) {
            const target = (0, node_path_1.join)(staging, ...entry.relativePath.split("/"));
            (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(target), { recursive: true });
            (0, node_fs_1.copyFileSync)(entry.absolutePath, target);
        }
        const stagingDigest = digestManifest(buildManifest(staging, "staged Solo skill"));
        if (stagingDigest !== expectedDigest)
            throw new Error("Staged Solo manifest did not match the validated source digest.");
        const hadExisting = (0, node_fs_1.existsSync)(destination);
        if (hadExisting)
            (0, node_fs_1.renameSync)(destination, backup);
        try {
            (0, node_fs_1.renameSync)(staging, destination);
        }
        catch (error) {
            if (hadExisting && (0, node_fs_1.existsSync)(backup) && !(0, node_fs_1.existsSync)(destination))
                (0, node_fs_1.renameSync)(backup, destination);
            throw error;
        }
        if ((0, node_fs_1.existsSync)(backup))
            (0, node_fs_1.rmSync)(backup, { recursive: true, force: true });
    }
    finally {
        if ((0, node_fs_1.existsSync)(staging))
            (0, node_fs_1.rmSync)(staging, { recursive: true, force: true });
    }
}
function planPackageScripts(root) {
    const path = (0, node_path_1.join)(root, "package.json");
    let packageJson = {};
    let original = "";
    if ((0, node_fs_1.existsSync)(path)) {
        const entry = (0, node_fs_1.lstatSync)(path);
        if (!entry.isFile() || entry.isSymbolicLink())
            throw new Error("Target package.json must be a regular file.");
        original = (0, node_fs_1.readFileSync)(path, "utf8");
        let parsed;
        try {
            parsed = JSON.parse(original.replace(/^\uFEFF/, ""));
        }
        catch {
            throw new Error("Target package.json is not valid JSON; refusing to replace it.");
        }
        const record = asRecord(parsed);
        if (!record)
            throw new Error("Target package.json must contain a JSON object.");
        packageJson = { ...record };
    }
    const existingScripts = packageJson.scripts;
    if (existingScripts !== undefined && !asRecord(existingScripts)) {
        throw new Error("Target package.json scripts must be an object; refusing to replace it.");
    }
    const scripts = { ...(asRecord(existingScripts) ?? {}) };
    packageJson.scripts = scripts;
    if (scripts.sfn === undefined) {
        scripts.sfn = exports.SOLO_SFN_PACKAGE_SCRIPT;
    }
    else if (scripts.sfn !== exports.SOLO_SFN_PACKAGE_SCRIPT && scripts["solo:sfn"] === undefined) {
        scripts["solo:sfn"] = exports.SOLO_SFN_PACKAGE_SCRIPT;
    }
    if (scripts["solo:smoke"] === undefined)
        scripts["solo:smoke"] = exports.SOLO_SMOKE_PACKAGE_SCRIPT;
    if (scripts["solo:conformance"] === undefined)
        scripts["solo:conformance"] = exports.SOLO_CONFORMANCE_PACKAGE_SCRIPT;
    const content = `${JSON.stringify(packageJson, null, 2)}\n`;
    return {
        path,
        content,
        changed: original !== content,
        ownsSmokeScript: scripts["solo:smoke"] === exports.SOLO_SMOKE_PACKAGE_SCRIPT,
        ownsConformanceScript: scripts["solo:conformance"] === exports.SOLO_CONFORMANCE_PACKAGE_SCRIPT,
    };
}
function mergeGitignore(root) {
    const path = (0, node_path_1.join)(root, ".gitignore");
    const original = (0, node_fs_1.existsSync)(path) ? (0, node_fs_1.readFileSync)(path, "utf8") : "";
    const start = original.indexOf(GITIGNORE_START);
    const end = start >= 0 ? original.indexOf(GITIGNORE_END, start + GITIGNORE_START.length) : -1;
    let next;
    if (start >= 0 && end >= 0) {
        const after = end + GITIGNORE_END.length;
        next = `${original.slice(0, start)}${GITIGNORE_BLOCK}${original.slice(after)}`;
    }
    else {
        const prefix = original.length === 0 ? "" : original.endsWith("\n") ? original : `${original}\n`;
        next = `${prefix}${prefix.length > 0 ? "\n" : ""}${GITIGNORE_BLOCK}\n`;
    }
    if (!next.endsWith("\n"))
        next += "\n";
    return writeTextIfChanged(path, next);
}
function claudeWrapperText() {
    return `---
name: solo-founder-nodes
description: Compatibility entry for the canonical project-local Solo Founder Nodes skill.
---

# Solo Founder Nodes

Read and follow [the canonical project skill](../../../.agents/skills/solo-founder-nodes/SKILL.md).
Treat that \`.agents\` copy as authoritative and resolve all of its relative links from its own directory.
This wrapper intentionally does not duplicate the skill.
`;
}
function commandSpecs(input) {
    const templatesPath = (0, node_path_1.join)(input.skillPath, "templates");
    const specs = [];
    if (input.installDependencies) {
        specs.push({
            id: "install-dependencies",
            command: "npm",
            args: ["install", "--ignore-scripts", "--no-audit", "--no-fund"],
            cwd: templatesPath,
            display: "npm install --ignore-scripts --no-audit --no-fund",
            nextCommand: exports.SOLO_INSTALL_DEPENDENCIES_COMMAND,
        });
    }
    if (input.verify) {
        specs.push({
            id: "smoke",
            command: "npm",
            args: ["run", "smoke"],
            cwd: templatesPath,
            display: "npm run smoke",
            nextCommand: input.packagePlan.ownsSmokeScript ? "npm run solo:smoke" : exports.SOLO_SMOKE_PACKAGE_SCRIPT,
        });
        specs.push({
            id: "conformance",
            command: "node",
            args: ["conformance/conformance.mjs", "--run-smoke"],
            cwd: input.skillPath,
            display: "node conformance/conformance.mjs --run-smoke",
            nextCommand: input.packagePlan.ownsConformanceScript ? "npm run solo:conformance" : exports.SOLO_CONFORMANCE_PACKAGE_SCRIPT,
        });
    }
    return specs;
}
function executeCommand(runner, spec, targetRoot) {
    let value;
    try {
        value = runner(spec.command, spec.args, { cwd: spec.cwd });
    }
    catch {
        return {
            id: spec.id,
            command: spec.display,
            cwd: relativeToRoot(targetRoot, spec.cwd),
            exitCode: null,
            status: "failed",
            error: "command runner threw",
        };
    }
    let exitCode;
    let error = false;
    if (typeof value === "number") {
        exitCode = value;
    }
    else if (value === undefined) {
        exitCode = 0;
    }
    else {
        const candidate = value.exitCode !== undefined ? value.exitCode : value.status;
        exitCode = candidate === undefined ? (value.error ? null : 0) : candidate;
        error = Boolean(value.error);
    }
    const passed = !error && exitCode === 0;
    return {
        id: spec.id,
        command: spec.display,
        cwd: relativeToRoot(targetRoot, spec.cwd),
        exitCode,
        status: passed ? "passed" : "failed",
        ...(!passed && error ? { error: "command could not start" } : {}),
    };
}
function defaultCommandRunner(command, args, options) {
    const result = (0, node_child_process_1.spawnSync)(command, [...args], {
        cwd: options.cwd,
        shell: process.platform === "win32",
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        timeout: 30 * 60 * 1000,
        maxBuffer: 64 * 1024 * 1024,
    });
    return { status: result.status, error: result.error };
}
function nextCommandsForSetup(input) {
    if (input.status === "needs_source" || input.status === "conflict") {
        const retry = setupRetryCommand(input.sourcePath, input.agents, input.options, input.status === "conflict");
        return [retry];
    }
    if (input.status === "failed") {
        if (input.failedNextCommand) {
            const tail = remainingVerificationCommands(input.failedNextCommand, input.packagePlan);
            return dedupe([input.failedNextCommand, ...tail, exports.SOLO_STOP_GATE_COMMAND]);
        }
        return [setupRetryCommand(input.sourcePath, input.agents, input.options, input.options.force === true)];
    }
    const next = [];
    if (!input.options.installDependencies)
        next.push(exports.SOLO_INSTALL_DEPENDENCIES_COMMAND);
    if (!input.options.verify) {
        next.push(input.packagePlan?.ownsSmokeScript ? "npm run solo:smoke" : exports.SOLO_SMOKE_PACKAGE_SCRIPT);
        next.push(input.packagePlan?.ownsConformanceScript ? "npm run solo:conformance" : exports.SOLO_CONFORMANCE_PACKAGE_SCRIPT);
    }
    next.push(exports.SOLO_STOP_GATE_COMMAND);
    return next;
}
function remainingVerificationCommands(failed, packagePlan) {
    const smoke = packagePlan?.ownsSmokeScript ? "npm run solo:smoke" : exports.SOLO_SMOKE_PACKAGE_SCRIPT;
    const conformance = packagePlan?.ownsConformanceScript ? "npm run solo:conformance" : exports.SOLO_CONFORMANCE_PACKAGE_SCRIPT;
    if (failed === exports.SOLO_INSTALL_DEPENDENCIES_COMMAND)
        return [smoke, conformance];
    if (failed === smoke)
        return [conformance];
    return [];
}
function setupRetryCommand(sourcePath, agents, options, force) {
    const args = ["npx proofloop solo setup"];
    if (sourcePath)
        args.push(`--source ${quoteCommandArgument(sourcePath)}`);
    args.push(`--agent ${agents}`);
    if (force)
        args.push("--force");
    if (options.installDependencies)
        args.push("--install-deps");
    if (options.verify)
        args.push("--verify");
    return args.join(" ");
}
function installedRelativePaths(root, agents, receiptPath) {
    const paths = [];
    const canonical = (0, node_path_1.join)(root, ...exports.SOLO_CANONICAL_SKILL_PATH.split("/"));
    const wrapper = (0, node_path_1.join)(root, ...exports.SOLO_CLAUDE_WRAPPER_PATH.split("/"));
    const stop = (0, node_path_1.join)(root, ...exports.SOLO_STOP_GATE_PATH.split("/"));
    if ((0, node_fs_1.existsSync)(canonical))
        paths.push(exports.SOLO_CANONICAL_SKILL_PATH);
    if (agents !== "codex" && (0, node_fs_1.existsSync)(wrapper))
        paths.push(exports.SOLO_CLAUDE_WRAPPER_PATH);
    if ((0, node_fs_1.existsSync)(stop))
        paths.push(exports.SOLO_STOP_GATE_PATH);
    paths.push(relativeToRoot(root, receiptPath));
    return dedupe(paths);
}
function writeTextIfChanged(path, content) {
    if ((0, node_fs_1.existsSync)(path)) {
        const entry = (0, node_fs_1.lstatSync)(path);
        if (!entry.isFile() || entry.isSymbolicLink())
            throw new Error(`Refusing to replace non-file path ${path}.`);
        if ((0, node_fs_1.readFileSync)(path, "utf8") === content)
            return false;
    }
    (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(path), { recursive: true });
    (0, node_fs_1.writeFileSync)(path, content, "utf8");
    return true;
}
function writeJsonAtomic(path, value) {
    (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(path), { recursive: true });
    const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
    (0, node_fs_1.writeFileSync)(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    (0, node_fs_1.renameSync)(temporary, path);
}
function sha256(value) {
    return (0, node_crypto_1.createHash)("sha256").update(value).digest("hex");
}
function isRealDirectory(path) {
    if (!(0, node_fs_1.existsSync)(path))
        return false;
    const entry = (0, node_fs_1.lstatSync)(path);
    return entry.isDirectory() && !entry.isSymbolicLink();
}
function isSoloSetupAgents(value) {
    return value === "codex" || value === "claude-code" || value === "both";
}
function asRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}
function relativeToRoot(root, path) {
    return (0, node_path_1.relative)(root, path).replace(/\\/g, "/") || ".";
}
function quoteCommandArgument(value) {
    return `"${value.replace(/"/g, '\\"')}"`;
}
function safeErrorMessage(error) {
    if (error instanceof Error && error.message)
        return error.message;
    return "Solo setup failed.";
}
function dedupe(values) {
    return [...new Set(values)];
}
