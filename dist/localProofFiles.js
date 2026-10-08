"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readBoundedRegularFile = readBoundedRegularFile;
exports.resolveLocalProofFile = resolveLocalProofFile;
exports.readLocalProofFile = readLocalProofFile;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
// Shared with transfer-check: larger local inputs are unsupported, not evidence.
const MAX_LOCAL_PROOF_BYTES = 10 * 1024 * 1024;
function readBoundedRegularFile(path, label, expected) {
    const flags = node_fs_1.constants.O_RDONLY | (node_fs_1.constants.O_NONBLOCK ?? 0) | (expected ? (node_fs_1.constants.O_NOFOLLOW ?? 0) : 0);
    const fd = (0, node_fs_1.openSync)(path, flags);
    try {
        const stat = (0, node_fs_1.fstatSync)(fd);
        if (!stat.isFile())
            throw new Error(`${label} must be a regular file: ${path}`);
        if (expected && (stat.dev !== expected.dev || stat.ino !== expected.ino))
            throw new Error(`${label} changed before opening: ${path}`);
        if (stat.size > MAX_LOCAL_PROOF_BYTES)
            throw new Error(`${label} exceeds ${MAX_LOCAL_PROOF_BYTES}-byte limit: ${path}`);
        // One extra byte detects growth after fstat without an unbounded read.
        const buffer = Buffer.alloc(MAX_LOCAL_PROOF_BYTES + 1);
        let bytes = 0;
        while (bytes < buffer.length) {
            const count = (0, node_fs_1.readSync)(fd, buffer, bytes, buffer.length - bytes, null);
            if (count === 0)
                break;
            bytes += count;
        }
        if (bytes > MAX_LOCAL_PROOF_BYTES)
            throw new Error(`${label} exceeds ${MAX_LOCAL_PROOF_BYTES}-byte limit: ${path}`);
        return buffer.subarray(0, bytes);
    }
    finally {
        (0, node_fs_1.closeSync)(fd);
    }
}
/** Reject links below the declared evidence root before opening a descriptor. */
function resolveLocalProofFile(path, root) {
    const candidate = (0, node_path_1.resolve)(path);
    if (root !== undefined) {
        const rootPath = (0, node_path_1.resolve)(root);
        const within = (0, node_path_1.relative)(rootPath, candidate);
        if (within === ".." || within.startsWith(`..${node_path_1.sep}`) || (0, node_path_1.isAbsolute)(within))
            throw new Error(`local proof input escapes its root: ${path}`);
        let cursor = rootPath;
        for (const segment of within.split(node_path_1.sep).filter(Boolean)) {
            cursor = (0, node_path_1.resolve)(cursor, segment);
            if ((0, node_fs_1.lstatSync)(cursor).isSymbolicLink())
                throw new Error(`local proof input must not traverse a symbolic link or junction: ${path}`);
        }
        const physicalRoot = (0, node_fs_1.realpathSync)(rootPath);
        const physicalPath = (0, node_fs_1.realpathSync)(candidate);
        const physicalWithin = (0, node_path_1.relative)(physicalRoot, physicalPath);
        if (physicalWithin === ".." || physicalWithin.startsWith(`..${node_path_1.sep}`) || (0, node_path_1.isAbsolute)(physicalWithin))
            throw new Error(`local proof input escapes its physical root: ${path}`);
    }
    const stat = (0, node_fs_1.lstatSync)(candidate);
    if (stat.isSymbolicLink())
        throw new Error(`local proof input must not be a symbolic link or junction: ${path}`);
    if (!stat.isFile())
        throw new Error(`local proof input must be a regular file: ${path}`);
    if (stat.size > MAX_LOCAL_PROOF_BYTES)
        throw new Error(`local proof input exceeds ${MAX_LOCAL_PROOF_BYTES}-byte limit: ${path}`);
    return candidate;
}
function readLocalProofFile(path, encoding, root) {
    const candidate = resolveLocalProofFile(path, root);
    const bytes = readBoundedRegularFile(candidate, "local proof input", (0, node_fs_1.lstatSync)(candidate));
    return encoding === "utf8" ? bytes.toString("utf8") : bytes;
}
