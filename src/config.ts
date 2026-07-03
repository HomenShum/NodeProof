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
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const CONFIG_FILENAME = "proofloop.config.json";

export type ProofloopGateCheck = {
  name: string;
  command: string;
};

export type ProofloopConfig = {
  app: string;
  workflow: string;
  gate: { checks: ProofloopGateCheck[] };
  immutable: string[];
  /** User ADDITIONS to the guard's default protected paths (never replaces them). */
  protectedPaths: string[];
};

export function configPath(root: string): string {
  return join(resolve(root), CONFIG_FILENAME);
}

export function configExists(root: string): boolean {
  return existsSync(configPath(root));
}

/**
 * Read + normalize the config. Returns undefined when the file is absent.
 * Throws on unparseable JSON so we never silently run on a broken config.
 */
export function readConfig(root: string): ProofloopConfig | undefined {
  const path = configPath(root);
  if (!existsSync(path)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new Error(`proofloop.config.json is not valid JSON (${path}): ${error instanceof Error ? error.message : String(error)}`);
  }
  return normalizeConfig(parsed);
}

/** Coerce an arbitrary parsed value into a well-formed ProofloopConfig. */
export function normalizeConfig(value: unknown): ProofloopConfig {
  const record = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const app = typeof record.app === "string" && record.app ? record.app : "generic web app";
  const workflow = typeof record.workflow === "string" ? record.workflow : "";
  const gateRecord = record.gate && typeof record.gate === "object" && !Array.isArray(record.gate) ? (record.gate as Record<string, unknown>) : {};
  const rawChecks = Array.isArray(gateRecord.checks) ? gateRecord.checks : [];
  const checks: ProofloopGateCheck[] = [];
  for (const entry of rawChecks) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const rec = entry as Record<string, unknown>;
    const command = typeof rec.command === "string" ? rec.command.trim() : "";
    if (!command) continue;
    const name = typeof rec.name === "string" && rec.name.trim() ? rec.name.trim() : command;
    checks.push({ name, command });
  }
  const immutable = Array.isArray(record.immutable)
    ? record.immutable.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    : [];
  const protectedPaths = Array.isArray(record.protectedPaths)
    ? record.protectedPaths
        .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
        // Normalize to the guard's repo-relative forward-slash convention.
        .map((entry) => entry.trim().replace(/\\/g, "/").replace(/^\.\//, ""))
    : [];
  return { app, workflow, gate: { checks }, immutable, protectedPaths };
}

export function serializeConfig(config: ProofloopConfig): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}
