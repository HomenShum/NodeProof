import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync, type Stats } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

// Shared with transfer-check: larger local inputs are unsupported, not evidence.
const MAX_LOCAL_PROOF_BYTES = 10 * 1024 * 1024;

export function readBoundedRegularFile(path: string, label: string, expected?: Stats): Buffer {
  const flags = constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | (expected ? (constants.O_NOFOLLOW ?? 0) : 0);
  const fd = openSync(path, flags);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new Error(`${label} must be a regular file: ${path}`);
    if (expected && (stat.dev !== expected.dev || stat.ino !== expected.ino)) throw new Error(`${label} changed before opening: ${path}`);
    if (stat.size > MAX_LOCAL_PROOF_BYTES) throw new Error(`${label} exceeds ${MAX_LOCAL_PROOF_BYTES}-byte limit: ${path}`);
    // One extra byte detects growth after fstat without an unbounded read.
    const buffer = Buffer.alloc(MAX_LOCAL_PROOF_BYTES + 1);
    let bytes = 0;
    while (bytes < buffer.length) {
      const count = readSync(fd, buffer, bytes, buffer.length - bytes, null);
      if (count === 0) break;
      bytes += count;
    }
    if (bytes > MAX_LOCAL_PROOF_BYTES) throw new Error(`${label} exceeds ${MAX_LOCAL_PROOF_BYTES}-byte limit: ${path}`);
    return buffer.subarray(0, bytes);
  } finally {
    closeSync(fd);
  }
}

/** Reject links below the declared evidence root before opening a descriptor. */
export function resolveLocalProofFile(path: string, root?: string): string {
  const candidate = resolve(path);
  if (root !== undefined) {
    const rootPath = resolve(root);
    const within = relative(rootPath, candidate);
    if (within === ".." || within.startsWith(`..${sep}`) || isAbsolute(within)) throw new Error(`local proof input escapes its root: ${path}`);
    let cursor = rootPath;
    for (const segment of within.split(sep).filter(Boolean)) {
      cursor = resolve(cursor, segment);
      if (lstatSync(cursor).isSymbolicLink()) throw new Error(`local proof input must not traverse a symbolic link or junction: ${path}`);
    }
    const physicalRoot = realpathSync(rootPath);
    const physicalPath = realpathSync(candidate);
    const physicalWithin = relative(physicalRoot, physicalPath);
    if (physicalWithin === ".." || physicalWithin.startsWith(`..${sep}`) || isAbsolute(physicalWithin)) throw new Error(`local proof input escapes its physical root: ${path}`);
  }
  const stat = lstatSync(candidate);
  if (stat.isSymbolicLink()) throw new Error(`local proof input must not be a symbolic link or junction: ${path}`);
  if (!stat.isFile()) throw new Error(`local proof input must be a regular file: ${path}`);
  if (stat.size > MAX_LOCAL_PROOF_BYTES) throw new Error(`local proof input exceeds ${MAX_LOCAL_PROOF_BYTES}-byte limit: ${path}`);
  return candidate;
}

export function readLocalProofFile(path: string, encoding: "utf8", root?: string): string;
export function readLocalProofFile(path: string, encoding?: undefined, root?: string): Buffer;
export function readLocalProofFile(path: string, encoding?: "utf8", root?: string): string | Buffer {
  const candidate = resolveLocalProofFile(path, root);
  const bytes = readBoundedRegularFile(candidate, "local proof input", lstatSync(candidate));
  return encoding === "utf8" ? bytes.toString("utf8") : bytes;
}
