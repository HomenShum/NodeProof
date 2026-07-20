"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NODEKIT_DISCOVERY_SCHEMA = exports.NODEKIT_COMPILED_DEFINITION_SCHEMA = exports.NODEKIT_PROOF_RECEIPT_SCHEMA = void 0;
exports.verifyNodekitProofBinding = verifyNodekitProofBinding;
exports.formatNodekitProofBindingVerification = formatNodekitProofBindingVerification;
exports.runNodekitProofBindingVerify = runNodekitProofBindingVerify;
const node_child_process_1 = require("node:child_process");
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
/**
 * NodeKit's generated applications currently emit `nodekit.proof-receipt/v1`
 * as their local/release proof. That receipt is useful, but it does not carry
 * the candidate commit or compiled application identity itself. This module
 * binds the receipt to the checked-out candidate and the compiler outputs
 * before a ProofLoop program may treat it as a passing arc.
 *
 * This is intentionally local-only. It does not deploy, invoke providers, or
 * create a promotion claim. It verifies bytes already present in the project.
 */
exports.NODEKIT_PROOF_RECEIPT_SCHEMA = "nodekit.proof-receipt/v1";
exports.NODEKIT_COMPILED_DEFINITION_SCHEMA = "nodeagent.resolved/v1";
exports.NODEKIT_DISCOVERY_SCHEMA = "nodeagent.discovery/v1";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const GIT_SHA_PATTERN = /^[a-f0-9]{40,64}$/;
const NODEKIT_SCHEMA_PATTERN = /^nodekit\.[a-z0-9][a-z0-9._-]*\/v\d+$/;
const DEFAULT_DEFINITION_PATH = ".nodeagent/resolved-definition.json";
const DEFAULT_CONFIG_HASH_PATH = ".nodeagent/config-hash.txt";
const DEFAULT_DISCOVERY_PATH = ".nodeagent/discovery.json";
/**
 * Verify a generated NodeKit local/release proof against compiler outputs and
 * the current Git candidate. The result is evidence only; callers decide how
 * it contributes to a larger program verdict.
 */
function verifyNodekitProofBinding(options) {
    const root = (0, node_path_1.resolve)(options.root);
    const minimumLevel = options.minimumLevel ?? "local-ready";
    const errors = [];
    const gateReceipts = [];
    const releaseProofPath = displayPath(options.releaseProofPath);
    if (!GIT_SHA_PATTERN.test(options.candidateCommit)) {
        errors.push("candidateCommit must be a lowercase 40-64 character Git SHA");
    }
    if (minimumLevel !== "local-ready" && minimumLevel !== "release-ready") {
        errors.push("minimumLevel must be local-ready or release-ready");
    }
    const observedCandidateCommit = readCurrentCommit(root, errors);
    if (observedCandidateCommit && observedCandidateCommit !== options.candidateCommit) {
        errors.push(`candidate commit mismatch: expected ${options.candidateCommit}, observed ${observedCandidateCommit}`);
    }
    const releasePath = resolveRegularFile(root, options.releaseProofPath, "NodeKit release proof", errors);
    const definitionPath = resolveRegularFile(root, options.compiledDefinitionPath ?? DEFAULT_DEFINITION_PATH, "NodeKit compiled definition", errors);
    const configPath = resolveRegularFile(root, options.configHashPath ?? DEFAULT_CONFIG_HASH_PATH, "NodeKit config hash", errors);
    const discoveryPath = resolveRegularFile(root, options.discoveryPath ?? DEFAULT_DISCOVERY_PATH, "NodeKit discovery", errors);
    const compiled = definitionPath ? readCompiledDefinition(definitionPath, errors) : undefined;
    const configHash = configPath ? readConfigHash(configPath, errors) : undefined;
    const discovery = discoveryPath ? readDiscovery(discoveryPath, errors) : undefined;
    const releaseProof = releasePath ? readJsonRecord(releasePath, "NodeKit release proof", errors) : undefined;
    let identity;
    if (compiled && configHash && discovery && discoveryPath) {
        if (compiled.configHash !== configHash) {
            errors.push("compiled definition configHash does not match .nodeagent/config-hash.txt");
        }
        if (compiled.fileCount !== discovery.files.length) {
            errors.push(`compiled definition fileCount ${compiled.fileCount} does not match discovery file count ${discovery.files.length}`);
        }
        verifyManifestDigest(root, compiled.manifestDigest, options.candidateCommit, errors);
        verifyDiscoveryFiles(root, discovery.files, options.candidateCommit, errors);
        identity = {
            configHash: compiled.configHash,
            manifestDigest: compiled.manifestDigest,
            discoveryDigest: sha256((0, node_fs_1.readFileSync)(discoveryPath)),
            fileCount: compiled.fileCount,
            candidateCommit: options.candidateCommit,
            ...(observedCandidateCommit ? { observedCandidateCommit } : {}),
        };
    }
    if (releaseProof && releasePath) {
        verifyReleaseProof({
            root,
            releasePath,
            releaseProof,
            minimumLevel,
            compiledConfigHash: compiled?.configHash,
            candidateCommit: options.candidateCommit,
            errors,
            gateReceipts,
        });
    }
    return {
        schema: "proofloop-nodekit-proof-binding-v1",
        ok: errors.length === 0 && gateReceipts.every((receipt) => receipt.ok),
        releaseProofPath,
        candidateCommit: options.candidateCommit,
        minimumLevel,
        errors,
        gateReceipts,
        ...(identity ? { identity } : {}),
    };
}
function formatNodekitProofBindingVerification(result) {
    const lines = [
        `schema=${result.schema}`,
        `status=${result.ok ? "passed" : "failed"}`,
        `releaseProof=${result.releaseProofPath}`,
        `candidateCommit=${result.candidateCommit}`,
        `minimumLevel=${result.minimumLevel}`,
    ];
    if (result.identity) {
        lines.push(`configHash=${result.identity.configHash}`);
        lines.push(`discoveryDigest=${result.identity.discoveryDigest}`);
        lines.push(`fileCount=${result.identity.fileCount}`);
    }
    lines.push("gateReceipts:");
    for (const receipt of result.gateReceipts) {
        lines.push(`- ${receipt.ok ? "PASS" : "FAIL"} ${receipt.id} ${receipt.path}${receipt.sha256 ? ` sha256=${receipt.sha256}` : ""}`);
        for (const error of receipt.errors)
            lines.push(`  - ${error}`);
    }
    if (result.errors.length === 0)
        lines.push("errors: none");
    else {
        lines.push("errors:");
        for (const error of result.errors)
            lines.push(`- ${error}`);
    }
    return `${lines.join("\n")}\n`;
}
function runNodekitProofBindingVerify(options) {
    const result = verifyNodekitProofBinding(options);
    const output = options.json === true
        ? JSON.stringify(result, null, 2)
        : formatNodekitProofBindingVerification(result);
    const log = options.log ?? console.log;
    const logError = options.logError ?? console.error;
    if (result.ok)
        log(output);
    else
        logError(output);
    return result.ok ? 0 : 1;
}
function verifyReleaseProof(args) {
    const { releaseProof, minimumLevel, errors } = args;
    if (releaseProof.schemaVersion !== exports.NODEKIT_PROOF_RECEIPT_SCHEMA) {
        errors.push(`NodeKit release proof schemaVersion must be ${exports.NODEKIT_PROOF_RECEIPT_SCHEMA}`);
    }
    if (releaseProof.passed !== true)
        errors.push("NodeKit release proof must have passed=true");
    if (typeof releaseProof.configHash !== "string" || !SHA256_PATTERN.test(releaseProof.configHash)) {
        errors.push("NodeKit release proof configHash must be a SHA-256 digest");
    }
    else if (args.compiledConfigHash !== undefined && releaseProof.configHash !== args.compiledConfigHash) {
        errors.push("NodeKit release proof configHash does not match the compiled NodeKit configHash");
    }
    if (releaseProof.applicationHash !== undefined && releaseProof.applicationHash !== releaseProof.configHash) {
        errors.push("NodeKit release proof applicationHash must match configHash when present");
    }
    verifyReleaseReceiptVerification(releaseProof, args.compiledConfigHash, args.candidateCommit, errors);
    const checks = asRecord(releaseProof.checks);
    if (!checks) {
        errors.push("NodeKit release proof checks must be an object");
        return;
    }
    for (const id of ["deterministicDemo", "deterministicEvaluation", "secretFree"]) {
        if (checks[id] !== true)
            errors.push(`NodeKit release proof checks.${id} must be true`);
    }
    const level = releaseProof.level;
    const releaseReady = releaseProof.releaseReady;
    if (level !== "local-ready" && level !== "release-ready") {
        errors.push("NodeKit release proof level must be local-ready or release-ready");
    }
    if (typeof releaseReady !== "boolean") {
        errors.push("NodeKit release proof releaseReady must be boolean");
    }
    else if ((level === "release-ready") !== releaseReady) {
        errors.push("NodeKit release proof level and releaseReady disagree");
    }
    if (minimumLevel === "release-ready" && level !== "release-ready") {
        errors.push("NodeKit release proof does not meet required release-ready level");
    }
    const proofDirectory = (0, node_path_1.dirname)(args.releasePath);
    const demo = verifyJsonGate({
        root: args.root,
        path: joinRelative(args.root, proofDirectory, "demo-receipt.json"),
        id: "demo",
        requireNodekitSchema: true,
        configHash: args.compiledConfigHash,
        candidateCommit: args.candidateCommit,
        requirePassed: false,
    });
    const evaluation = verifyJsonGate({
        root: args.root,
        path: joinRelative(args.root, proofDirectory, "eval-receipt.json"),
        id: "evaluation",
        requireNodekitSchema: true,
        requirePassed: true,
        configHash: args.compiledConfigHash,
        candidateCommit: args.candidateCommit,
    });
    args.gateReceipts.push(demo, evaluation);
    const optionalGateSpecs = [
        { id: "live", check: "livePi", filename: "pi-live-receipt.json", requireNodekitSchema: true, requirePassed: true, acceptedStatus: "pass" },
        { id: "browser", check: "browserQa", filename: "browser-proof.json", expectedSchema: "nodekit.browser-proof/v1", requirePassed: true },
        { id: "deployment", check: "deployment", filename: "deployment-receipt.json", requireNodekitSchema: true, requirePassed: true, acceptedStatus: "pass" },
    ];
    for (const spec of optionalGateSpecs) {
        const mustVerify = minimumLevel === "release-ready" || checks[spec.check] === true;
        if (!mustVerify)
            continue;
        const receipt = verifyJsonGate({
            root: args.root,
            path: joinRelative(args.root, proofDirectory, spec.filename),
            id: spec.id,
            ...(spec.expectedSchema ? { expectedSchema: spec.expectedSchema } : {}),
            ...(spec.requireNodekitSchema ? { requireNodekitSchema: true } : {}),
            configHash: args.compiledConfigHash,
            candidateCommit: args.candidateCommit,
            requirePassed: spec.requirePassed === true,
            ...(spec.acceptedStatus ? { acceptedStatus: spec.acceptedStatus } : {}),
        });
        args.gateReceipts.push(receipt);
        if (checks[spec.check] !== true) {
            errors.push(`NodeKit release proof checks.${spec.check} must be true when ${spec.id} is required`);
        }
    }
}
function verifyJsonGate(args) {
    const errors = [];
    const file = resolveRegularFile(args.root, args.path, `${args.id} gate receipt`, errors);
    const display = displayPath(args.path);
    if (!file)
        return { id: args.id, path: display, ok: false, errors };
    const value = readJsonRecord(file, `${args.id} gate receipt`, errors);
    if (!value)
        return { id: args.id, path: display, sha256: sha256((0, node_fs_1.readFileSync)(file)), ok: false, errors };
    if (args.expectedSchema && value.schemaVersion !== args.expectedSchema) {
        errors.push(`${args.id} gate receipt schemaVersion must be ${args.expectedSchema}`);
    }
    if (args.requireNodekitSchema && (typeof value.schemaVersion !== "string" || !NODEKIT_SCHEMA_PATTERN.test(value.schemaVersion))) {
        errors.push(`${args.id} gate receipt schemaVersion must be a NodeKit v1+ schema`);
    }
    if (args.configHash !== undefined && value.configHash !== args.configHash) {
        errors.push(`${args.id} gate receipt configHash does not match the compiled NodeKit configHash`);
    }
    verifyGateIdentityAndDigest(value, args, errors);
    if (args.requirePassed && value.passed !== true && value.status !== args.acceptedStatus) {
        errors.push(`${args.id} gate receipt must have passed=true${args.acceptedStatus ? ` or status=${args.acceptedStatus}` : ""}`);
    }
    return { id: args.id, path: display, sha256: sha256((0, node_fs_1.readFileSync)(file)), ok: errors.length === 0, errors };
}
function verifyReleaseReceiptVerification(releaseProof, configHash, candidateCommit, errors) {
    const verification = asRecord(releaseProof.receiptVerification);
    if (!verification)
        return;
    if (verification.passed !== true)
        errors.push("NodeKit release proof receiptVerification must have passed=true when present");
    if (configHash !== undefined && verification.applicationHash !== undefined && verification.applicationHash !== configHash) {
        errors.push("NodeKit release proof receiptVerification applicationHash does not match compiled NodeKit configHash");
    }
    if (verification.candidateCommit !== undefined && verification.candidateCommit !== candidateCommit) {
        errors.push("NodeKit release proof receiptVerification candidateCommit does not match the requested candidate");
    }
}
function verifyGateIdentityAndDigest(value, args, errors) {
    if (args.configHash !== undefined && value.applicationHash !== undefined && value.applicationHash !== args.configHash) {
        errors.push(`${args.id} gate receipt applicationHash does not match the compiled NodeKit configHash`);
    }
    const candidate = asRecord(value.candidate);
    if (candidate && args.candidateCommit !== undefined) {
        if (candidate.commit !== args.candidateCommit || candidate.dirty !== false) {
            errors.push(`${args.id} gate receipt is not bound to the clean requested candidate commit`);
        }
    }
    if (value.receiptDigest === undefined)
        return;
    if (typeof value.receiptDigest !== "string" || !SHA256_PATTERN.test(value.receiptDigest)) {
        errors.push(`${args.id} gate receipt receiptDigest must be a SHA-256 digest when present`);
        return;
    }
    const clone = { ...value };
    delete clone.receiptDigest;
    if (sha256(JSON.stringify(clone)) !== value.receiptDigest) {
        errors.push(`${args.id} gate receipt receiptDigest does not match content`);
    }
}
function readCompiledDefinition(path, errors) {
    const value = readJsonRecord(path, "NodeKit compiled definition", errors);
    if (!value)
        return undefined;
    if (value.schemaVersion !== exports.NODEKIT_COMPILED_DEFINITION_SCHEMA) {
        errors.push(`NodeKit compiled definition schemaVersion must be ${exports.NODEKIT_COMPILED_DEFINITION_SCHEMA}`);
    }
    if (typeof value.configHash !== "string" || !SHA256_PATTERN.test(value.configHash)) {
        errors.push("NodeKit compiled definition configHash must be a SHA-256 digest");
    }
    if (typeof value.manifestDigest !== "string" || !SHA256_PATTERN.test(value.manifestDigest)) {
        errors.push("NodeKit compiled definition manifestDigest must be a SHA-256 digest");
    }
    if (typeof value.fileCount !== "number" || !Number.isInteger(value.fileCount) || value.fileCount < 0) {
        errors.push("NodeKit compiled definition fileCount must be a non-negative integer");
    }
    if (typeof value.configHash !== "string" || typeof value.manifestDigest !== "string" || typeof value.fileCount !== "number")
        return undefined;
    return {
        schemaVersion: value.schemaVersion,
        configHash: value.configHash,
        manifestDigest: value.manifestDigest,
        fileCount: value.fileCount,
    };
}
function readConfigHash(path, errors) {
    const value = (0, node_fs_1.readFileSync)(path, "utf8").trim();
    if (!SHA256_PATTERN.test(value)) {
        errors.push("NodeKit config hash file must contain exactly one SHA-256 digest");
        return undefined;
    }
    return value;
}
function readDiscovery(path, errors) {
    const value = readJsonRecord(path, "NodeKit discovery", errors);
    if (!value)
        return undefined;
    if (value.schemaVersion !== exports.NODEKIT_DISCOVERY_SCHEMA) {
        errors.push(`NodeKit discovery schemaVersion must be ${exports.NODEKIT_DISCOVERY_SCHEMA}`);
    }
    if (!Array.isArray(value.files)) {
        errors.push("NodeKit discovery files must be an array");
        return undefined;
    }
    const seen = new Set();
    const files = [];
    for (const [index, entry] of value.files.entries()) {
        if (!asRecord(entry)) {
            errors.push(`NodeKit discovery files[${index}] must be an object`);
            continue;
        }
        const record = entry;
        if (!safeRepoRelativePath(record.path)) {
            errors.push(`NodeKit discovery files[${index}].path must be a safe repo-relative path`);
            continue;
        }
        if (seen.has(record.path)) {
            errors.push(`NodeKit discovery contains duplicate path ${record.path}`);
            continue;
        }
        seen.add(record.path);
        if (typeof record.digest !== "string" || !SHA256_PATTERN.test(record.digest)) {
            errors.push(`NodeKit discovery files[${index}].digest must be a SHA-256 digest`);
            continue;
        }
        if (typeof record.bytes !== "number" || !Number.isInteger(record.bytes) || record.bytes < 0) {
            errors.push(`NodeKit discovery files[${index}].bytes must be a non-negative integer`);
            continue;
        }
        files.push({ path: record.path, digest: record.digest, bytes: record.bytes });
    }
    const sorted = [...files].sort((left, right) => left.path.localeCompare(right.path));
    if (!files.every((entry, index) => entry.path === sorted[index]?.path)) {
        errors.push("NodeKit discovery files must be sorted by path");
    }
    return { files };
}
function verifyManifestDigest(root, expected, candidateCommit, errors) {
    const manifestPath = resolveRegularFile(root, "nodeagent.yaml", "NodeKit manifest", errors);
    if (!manifestPath)
        return;
    if (sha256((0, node_fs_1.readFileSync)(manifestPath)) !== expected) {
        errors.push("nodeagent.yaml bytes do not match compiled definition manifestDigest");
    }
    verifyCandidateFileBytes(root, candidateCommit, "nodeagent.yaml", "NodeKit manifest", errors);
}
function verifyDiscoveryFiles(root, files, candidateCommit, errors) {
    for (const file of files) {
        const path = resolveRegularFile(root, file.path, `NodeKit discovered file ${file.path}`, errors);
        if (!path)
            continue;
        const bytes = (0, node_fs_1.readFileSync)(path);
        if (bytes.byteLength !== file.bytes) {
            errors.push(`NodeKit discovered file ${file.path} byte count changed`);
        }
        if (sha256(bytes) !== file.digest) {
            errors.push(`NodeKit discovered file ${file.path} digest changed`);
        }
        verifyCandidateFileBytes(root, candidateCommit, file.path, `NodeKit discovered file ${file.path}`, errors);
    }
}
function verifyCandidateFileBytes(root, candidateCommit, repoPath, label, errors) {
    if (!GIT_SHA_PATTERN.test(candidateCommit))
        return;
    try {
        (0, node_child_process_1.execFileSync)("git", ["cat-file", "-e", `${candidateCommit}:${repoPath}`], {
            cwd: root,
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
        });
    }
    catch {
        errors.push(`${label} is not present in candidate commit ${candidateCommit}`);
        return;
    }
    try {
        // `git diff <tree> -- <path>` honors Git's clean/smudge filters. That
        // keeps a normal CRLF checkout equivalent to its LF blob while our
        // discovery digest separately binds the exact local bytes the compiler
        // actually observed.
        (0, node_child_process_1.execFileSync)("git", ["diff", "--quiet", candidateCommit, "--", repoPath], {
            cwd: root,
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
        });
    }
    catch {
        errors.push(`${label} bytes do not match candidate commit ${candidateCommit}`);
    }
}
function readCurrentCommit(root, errors) {
    try {
        const commit = (0, node_child_process_1.execFileSync)("git", ["rev-parse", "HEAD"], {
            cwd: root,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
        }).trim().toLowerCase();
        if (!GIT_SHA_PATTERN.test(commit)) {
            errors.push("git rev-parse HEAD did not produce a valid Git SHA");
            return undefined;
        }
        return commit;
    }
    catch {
        errors.push("candidate commit cannot be verified because git rev-parse HEAD failed");
        return undefined;
    }
}
function resolveRegularFile(rootInput, pathInput, label, errors) {
    if (!safeRepoRelativePath(pathInput)) {
        errors.push(`${label} must be a safe repo-relative path`);
        return undefined;
    }
    const root = realPathOrResolved(rootInput);
    const candidate = (0, node_path_1.resolve)(rootInput, pathInput);
    if (!(0, node_fs_1.existsSync)(candidate)) {
        errors.push(`${label} is missing: ${pathInput}`);
        return undefined;
    }
    try {
        if ((0, node_fs_1.lstatSync)(candidate).isSymbolicLink()) {
            errors.push(`${label} must not be a symbolic link: ${pathInput}`);
            return undefined;
        }
        const real = realPathOrResolved(candidate);
        const escaped = (0, node_path_1.relative)(root, real);
        if (escaped === ".." || escaped.startsWith(`..${node_path_1.sep}`) || (0, node_path_1.isAbsolute)(escaped)) {
            errors.push(`${label} escapes the repository root: ${pathInput}`);
            return undefined;
        }
        if (!(0, node_fs_1.statSync)(real).isFile()) {
            errors.push(`${label} is not a regular file: ${pathInput}`);
            return undefined;
        }
        return real;
    }
    catch (error) {
        errors.push(`${label} cannot be read: ${error instanceof Error ? error.message : String(error)}`);
        return undefined;
    }
}
function readJsonRecord(path, label, errors) {
    try {
        const value = JSON.parse((0, node_fs_1.readFileSync)(path, "utf8"));
        if (!asRecord(value)) {
            errors.push(`${label} must be a JSON object`);
            return undefined;
        }
        return value;
    }
    catch (error) {
        errors.push(`${label} must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
        return undefined;
    }
}
function joinRelative(root, directory, filename) {
    const target = (0, node_path_1.resolve)(directory, filename);
    const value = (0, node_path_1.relative)((0, node_path_1.resolve)(root), target).split(node_path_1.sep).join("/");
    return value || filename;
}
function displayPath(pathInput) {
    if (!safeRepoRelativePath(pathInput))
        return pathInput;
    return pathInput.split(/[\\/]/).join("/");
}
function realPathOrResolved(pathInput) {
    try {
        return (0, node_path_1.resolve)((0, node_fs_1.realpathSync)(pathInput));
    }
    catch {
        return (0, node_path_1.resolve)(pathInput);
    }
}
function safeRepoRelativePath(value) {
    if (typeof value !== "string" || value.length === 0 || (0, node_path_1.isAbsolute)(value) || /^[A-Za-z]:/.test(value))
        return false;
    return !value.split(/[\\/]/).some((segment) => segment === ".." || segment.length === 0 || segment.includes(":"));
}
function asRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}
function sha256(value) {
    return (0, node_crypto_1.createHash)("sha256").update(value).digest("hex");
}
