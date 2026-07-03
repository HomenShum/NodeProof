/**
 * Scenario tests for `proofloop gate` + `proofloop init` -- the config-driven
 * proof gate that the Stop hook calls.
 *
 * Persona: a solo founder points proofloop at a stranger's repo. init detects
 * the app and writes a starter config; the founder adds a check; gate runs it
 * and persists a verdict; the Stop hook later reads that verdict via --check.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runGateCli, gateStatePath, type GateState } from "../src/gate";
import { runInit } from "../src/init";
import { readConfig } from "../src/config";
import { detectApp } from "../src/detect";

const tempRoots: string[] = [];
afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "proofloop-gate-"));
  tempRoots.push(root);
  return root;
}
function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
function readState(root: string): GateState {
  return JSON.parse(readFileSync(gateStatePath(root), "utf8"));
}
const silent = { log: () => {}, logError: () => {} };

describe("detectApp", () => {
  it("recognizes Next.js, Vite, React, Python, and generic repos", () => {
    const next = tempRoot();
    writeJson(join(next, "package.json"), { dependencies: { next: "14", react: "18" } });
    expect(detectApp(next).app).toBe("Next.js");

    const vite = tempRoot();
    writeJson(join(vite, "package.json"), { devDependencies: { vite: "5" }, dependencies: { react: "18" } });
    expect(detectApp(vite).app).toBe("Vite");

    const react = tempRoot();
    writeJson(join(react, "package.json"), { dependencies: { react: "18" } });
    expect(detectApp(react).app).toBe("React");

    const py = tempRoot();
    writeFileSync(join(py, "requirements.txt"), "fastapi\n", "utf8");
    expect(detectApp(py).app).toBe("FastAPI/Python");

    const generic = tempRoot();
    expect(detectApp(generic).app).toBe("generic web app");
  });
});

describe("proofloop init", () => {
  it("writes a starter config from a detected Vite app and is non-destructive on rerun", () => {
    const root = tempRoot();
    writeJson(join(root, "package.json"), { name: "my-app", description: "a spreadsheet app", devDependencies: { vite: "5" }, dependencies: { react: "18" } });

    expect(runInit({ root, ...silent })).toBe(0);
    const config = readConfig(root);
    expect(config?.app).toBe("Vite");
    expect(config?.workflow).toContain("spreadsheet app");
    expect(config?.gate.checks).toEqual([]);
    expect(config?.immutable).toEqual([]);

    // Rerun must NOT overwrite: mutate the config, run init again, expect it preserved.
    writeJson(join(root, "proofloop.config.json"), { ...config, gate: { checks: [{ name: "t", command: "node -e 0" }] } });
    expect(runInit({ root, ...silent })).toBe(0);
    expect(readConfig(root)?.gate.checks).toHaveLength(1);
  });

  it("reads PowerShell UTF-8 BOM JSON config files", () => {
    const root = tempRoot();
    writeFileSync(
      join(root, "proofloop.config.json"),
      `\uFEFF${JSON.stringify({ app: "generic web app", workflow: "", gate: { checks: [] }, immutable: [] }, null, 2)}\n`,
      "utf8",
    );
    expect(readConfig(root)?.app).toBe("generic web app");
  });
});

describe("proofloop gate", () => {
  it("passes when all configured checks exit 0 and persists a passed verdict (exit 0)", () => {
    const root = tempRoot();
    writeJson(join(root, "proofloop.config.json"), {
      app: "generic web app",
      workflow: "",
      gate: { checks: [{ name: "trivial", command: "node -e 0" }] },
      immutable: [],
    });
    const code = runGateCli({ root, ...silent });
    expect(code).toBe(0);
    const state = readState(root);
    expect(state.status).toBe("passed");
    expect(state.checks).toHaveLength(1);
    expect(state.checks[0].pass).toBe(true);
    expect(state.source).toBe("config-checks");
  });

  it("fails when any check exits non-zero and persists a failed verdict (exit 1)", () => {
    const root = tempRoot();
    writeJson(join(root, "proofloop.config.json"), {
      app: "generic web app",
      workflow: "",
      gate: { checks: [{ name: "ok", command: "node -e 0" }, { name: "boom", command: "node -e \"process.exit(3)\"" }] },
      immutable: [],
    });
    const code = runGateCli({ root, ...silent });
    expect(code).toBe(1);
    const state = readState(root);
    expect(state.status).toBe("failed");
    expect(state.checks.find((c) => c.name === "boom")?.pass).toBe(false);
  });

  it("falls back to `npm test` when no checks configured but package.json has a test script", () => {
    const root = tempRoot();
    // A passing test script.
    writeJson(join(root, "package.json"), { name: "x", scripts: { test: "node -e 0" } });
    writeJson(join(root, "proofloop.config.json"), { app: "Node.js app", workflow: "", gate: { checks: [] }, immutable: [] });
    const code = runGateCli({ root, ...silent });
    expect(code).toBe(0);
    expect(readState(root).source).toBe("npm-test-fallback");
  });

  it("reports no_gate (exit 2) when nothing is configured and there is no test script", () => {
    const root = tempRoot();
    writeJson(join(root, "proofloop.config.json"), { app: "generic web app", workflow: "", gate: { checks: [] }, immutable: [] });
    const code = runGateCli({ root, ...silent });
    expect(code).toBe(2);
    expect(readState(root).status).toBe("no_gate");
  });

  it("--check reads the last verdict WITHOUT re-running, and exit 2 when none exists yet", () => {
    const root = tempRoot();
    writeJson(join(root, "proofloop.config.json"), {
      app: "generic web app",
      workflow: "",
      gate: { checks: [{ name: "trivial", command: "node -e 0" }] },
      immutable: [],
    });

    // No state yet: --check is unusable (exit 2), and must not create state.
    expect(runGateCli({ root, check: true, ...silent })).toBe(2);
    expect(existsSync(gateStatePath(root))).toBe(false);

    // Run once, then --check mirrors the persisted verdict.
    expect(runGateCli({ root, ...silent })).toBe(0);
    expect(runGateCli({ root, check: true, ...silent })).toBe(0);

    // Corrupt the config to a failing check: --check still returns the CACHED passed verdict.
    writeJson(join(root, "proofloop.config.json"), {
      app: "generic web app",
      workflow: "",
      gate: { checks: [{ name: "boom", command: "node -e \"process.exit(1)\"" }] },
      immutable: [],
    });
    expect(runGateCli({ root, check: true, ...silent })).toBe(0);
    // A real re-run flips it to failed.
    expect(runGateCli({ root, ...silent })).toBe(1);
  });
});
