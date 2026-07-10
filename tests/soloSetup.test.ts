import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/cli";
import {
  SOLO_CANONICAL_SKILL_PATH,
  SOLO_CLAUDE_WRAPPER_PATH,
  SOLO_CONFORMANCE_PACKAGE_SCRIPT,
  SOLO_INSTALL_DEPENDENCIES_COMMAND,
  SOLO_SETUP_INTEROP_SCHEMA_DIGEST,
  SOLO_SETUP_INTEROP_SCHEMA_RAW_SHA256,
  SOLO_SFN_PACKAGE_SCRIPT,
  SOLO_SMOKE_PACKAGE_SCRIPT,
  SOLO_STOP_GATE_COMMAND,
  SOLO_STOP_GATE_PATH,
  setupSolo,
  soloSetupReceiptPath,
  type SoloSetupCommandRunner,
} from "../src/soloSetup";

const tempRoots: string[] = [];
const GENERATED_AT = "2026-07-10T12:00:00.000Z";

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("coordinated Solo skill setup", () => {
  it("records needs_source without partially installing when the local source is missing", () => {
    const target = tempRoot("proofloop-solo-target-");
    writeJson(join(target, "package.json"), { name: "missing-source-app", scripts: { test: "node -e 0" } });

    const result = setupSolo({
      targetRoot: target,
      sourceDir: join(target, "does-not-exist"),
      agents: "codex",
      generatedAt: GENERATED_AT,
    });

    expect(result.status).toBe("needs_source");
    expect(result.installAction).toBe("none");
    expect(result.sourceManifestDigest).toBeNull();
    expect(existsSync(join(target, ...SOLO_CANONICAL_SKILL_PATH.split("/")))).toBe(false);
    expect(readJson(soloSetupReceiptPath(target)).status).toBe("needs_source");
    expect(result.nextCommands[0]).toContain("proofloop solo setup");
    expect(result.nextCommands[0]).toContain("--source ");
    expect(result.nextCommands[0]).toContain("--agent codex");
    expect(result.nextCommands[0]).not.toContain("--source-dir");
  });

  it("installs from a Solo repo root, merges project metadata, and writes a complete receipt", () => {
    const source = makeSoloSource();
    const target = tempRoot("proofloop-solo-target-");
    writeJson(join(target, "package.json"), {
      name: "demo-app",
      private: true,
      custom: { retained: true },
      scripts: { build: "vite build" },
    });
    write(join(target, ".gitignore"), "dist/\n");

    const result = setupSolo({
      targetRoot: target,
      sourceDir: source.repoRoot,
      agents: "codex",
      generatedAt: GENERATED_AT,
    });

    const installed = join(target, ...SOLO_CANONICAL_SKILL_PATH.split("/"));
    expect(result.status).toBe("ready");
    expect(result.installAction).toBe("installed");
    expect(result.sourcePath).toBe(source.repoRoot);
    expect(result.sourceSkillPath).toBe(source.skillRoot);
    expect(result.sourceManifestDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(result.schemaDigest).toBe(SOLO_SETUP_INTEROP_SCHEMA_DIGEST);
    expect(result.schemaRawSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(readFileSync(join(installed, "SKILL.md"), "utf8")).toContain("solo-founder-nodes");
    expect(readFileSync(join(installed, "templates", "keep.txt"), "utf8")).toBe("keep me\n");
    expect(existsSync(join(target, ...SOLO_CLAUDE_WRAPPER_PATH.split("/")))).toBe(false);

    const pkg = readJson(join(target, "package.json"));
    expect(pkg.name).toBe("demo-app");
    expect(pkg.private).toBe(true);
    expect(pkg.custom).toEqual({ retained: true });
    expect(pkg.scripts.build).toBe("vite build");
    expect(pkg.scripts.sfn).toBe(SOLO_SFN_PACKAGE_SCRIPT);
    expect(pkg.scripts["solo:smoke"]).toBe(SOLO_SMOKE_PACKAGE_SCRIPT);
    expect(pkg.scripts["solo:conformance"]).toBe(SOLO_CONFORMANCE_PACKAGE_SCRIPT);

    const gitignore = readFileSync(join(target, ".gitignore"), "utf8");
    expect(gitignore).toContain("dist/\n");
    expect(gitignore).toContain("# >>> NodeProof Solo Founder setup >>>");
    expect(gitignore).toContain(`${SOLO_CANONICAL_SKILL_PATH}/templates/node_modules/`);
    expect(gitignore).toContain(".solo/\n");
    expect(gitignore).toContain(".proofloop/\n");

    const receipt = readJson(result.receiptPath);
    expect(receipt).toMatchObject({
      schema: "nodeproof-solo-setup-v1",
      generatedAt: GENERATED_AT,
      status: "ready",
      agents: "codex",
      sourcePath: source.repoRoot,
      sourceManifestDigest: result.sourceManifestDigest,
      schemaDigest: SOLO_SETUP_INTEROP_SCHEMA_DIGEST,
      commandResults: [],
      stopCommand: SOLO_STOP_GATE_COMMAND,
    });
    expect(receipt.installedPaths).toEqual([
      SOLO_CANONICAL_SKILL_PATH,
      SOLO_STOP_GATE_PATH,
      ".proofloop/setup/solo-founder.json",
    ]);
    expect(receipt.nextCommands).toEqual([
      SOLO_INSTALL_DEPENDENCIES_COMMAND,
      "npm run solo:smoke",
      "npm run solo:conformance",
      SOLO_STOP_GATE_COMMAND,
    ]);
    expect(existsSync(join(target, ".claude", "settings.json"))).toBe(false);
    expect(existsSync(join(target, ".codex", "settings.json"))).toBe(false);
  });

  it("wires the public CLI to both host skill paths and one composed Stop gate per host", async () => {
    const source = makeSoloSource();
    const target = makeTarget();

    expect(await runCli([
      "solo", "setup", "--dir", target,
      "--source", source.repoRoot,
      "--agent", "both",
      "--json",
    ])).toBe(0);

    expect(existsSync(join(target, ...SOLO_CANONICAL_SKILL_PATH.split("/")))).toBe(true);
    expect(existsSync(join(target, ...SOLO_CLAUDE_WRAPPER_PATH.split("/")))).toBe(true);
    const codex = readJson(join(target, ".codex", "hooks.json"));
    const claude = readJson(join(target, ".claude", "settings.json"));
    expect(codex.hooks.filter((hook: any) => hook.event === "Stop")).toHaveLength(1);
    expect(claude.hooks.Stop[0].hooks).toHaveLength(1);
    const hooksConfig = readJson(join(target, ".proofloop", "hooks", "config.json"));
    expect(hooksConfig.gateMode).toBe("command");
    expect(hooksConfig.gateCommand).toBe(SOLO_STOP_GATE_COMMAND);
  });

  it("accepts the same filtered manifest idempotently from the direct skill path", () => {
    const source = makeSoloSource();
    const target = makeTarget();

    const first = setupSolo({ targetRoot: target, sourceDir: source.repoRoot, agents: "both" });
    const packageAfterFirst = readFileSync(join(target, "package.json"), "utf8");
    const second = setupSolo({ targetRoot: target, sourceDir: source.skillRoot, agents: "both" });

    expect(first.status).toBe("ready");
    expect(second.status).toBe("ready");
    expect(second.installAction).toBe("unchanged");
    expect(second.sourceManifestDigest).toBe(first.sourceManifestDigest);
    expect(readFileSync(join(target, "package.json"), "utf8")).toBe(packageAfterFirst);
    const gitignore = readFileSync(join(target, ".gitignore"), "utf8");
    expect(gitignore.match(/>>> NodeProof Solo Founder setup >>>/g)).toHaveLength(1);
  });

  it("refuses a conflicting canonical install without force", () => {
    const source = makeSoloSource();
    const target = makeTarget();
    expect(setupSolo({ targetRoot: target, sourceDir: source.repoRoot, agents: "codex" }).status).toBe("ready");
    const installedSkill = join(target, ...SOLO_CANONICAL_SKILL_PATH.split("/"), "SKILL.md");
    write(installedSkill, "locally changed\n");

    const conflict = setupSolo({ targetRoot: target, sourceDir: source.repoRoot, agents: "codex" });

    expect(conflict.status).toBe("conflict");
    expect(conflict.installAction).toBe("none");
    expect(readFileSync(installedSkill, "utf8")).toBe("locally changed\n");
    expect(conflict.nextCommands).toHaveLength(1);
    expect(conflict.nextCommands[0]).toContain("--force");
    expect(readJson(conflict.receiptPath).status).toBe("conflict");
  });

  it("force-updates a changed install from a clean staged copy", () => {
    const source = makeSoloSource();
    const target = makeTarget();
    setupSolo({ targetRoot: target, sourceDir: source.repoRoot, agents: "codex" });
    const installed = join(target, ...SOLO_CANONICAL_SKILL_PATH.split("/"));
    write(join(installed, "SKILL.md"), "locally changed\n");
    write(join(installed, "untracked-local-edit.txt"), "remove on force\n");

    const updated = setupSolo({
      targetRoot: target,
      sourceDir: source.repoRoot,
      agents: "codex",
      force: true,
    });

    expect(updated.status).toBe("ready");
    expect(updated.installAction).toBe("updated");
    expect(readFileSync(join(installed, "SKILL.md"), "utf8")).toBe(readFileSync(join(source.skillRoot, "SKILL.md"), "utf8"));
    expect(existsSync(join(installed, "untracked-local-edit.txt"))).toBe(false);
  });

  it("preserves user package fields and uses solo:sfn when sfn is occupied", () => {
    const source = makeSoloSource();
    const target = tempRoot("proofloop-solo-target-");
    writeJson(join(target, "package.json"), {
      name: "script-owner",
      version: "7.8.9",
      workspaces: ["packages/*"],
      scripts: {
        build: "user-build",
        test: "user-test",
        sfn: "user-owned-sfn",
      },
    });

    const result = setupSolo({ targetRoot: target, sourceDir: source.skillRoot, agents: "codex" });
    const pkg = readJson(join(target, "package.json"));

    expect(result.status).toBe("ready");
    expect(pkg.name).toBe("script-owner");
    expect(pkg.version).toBe("7.8.9");
    expect(pkg.workspaces).toEqual(["packages/*"]);
    expect(pkg.scripts).toMatchObject({
      build: "user-build",
      test: "user-test",
      sfn: "user-owned-sfn",
      "solo:sfn": SOLO_SFN_PACKAGE_SCRIPT,
      "solo:smoke": SOLO_SMOKE_PACKAGE_SCRIPT,
      "solo:conformance": SOLO_CONFORMANCE_PACKAGE_SCRIPT,
    });
  });

  it("excludes dependencies, local state, caches, SpreadsheetBench, and generated benchmark output", () => {
    const source = makeSoloSource();
    write(join(source.skillRoot, "templates", "node_modules", "dep", "index.js"), "excluded\n");
    write(join(source.skillRoot, "templates", "package-lock.json"), "{}\n");
    write(join(source.skillRoot, ".git", "config"), "excluded\n");
    write(join(source.skillRoot, ".solo", "loop-state.json"), "{}\n");
    write(join(source.skillRoot, ".proofloop", "run.json"), "{}\n");
    write(join(source.skillRoot, "templates", "SpreadsheetBench", "task.json"), "{}\n");
    write(join(source.skillRoot, "templates", ".cache", "cache.bin"), "excluded\n");
    write(join(source.skillRoot, "templates", "benchmark-output", "score.json"), "{}\n");
    write(join(source.skillRoot, "templates", "results_generated.json"), "{}\n");
    write(join(source.skillRoot, "templates", "run", "__pycache__", "probe.pyc"), "excluded\n");
    write(join(source.skillRoot, "templates", "run", "spreadsheetbench.py"), "print('kept')\n");
    const target = makeTarget();

    const result = setupSolo({ targetRoot: target, sourceDir: source.repoRoot, agents: "codex" });
    const installed = join(target, ...SOLO_CANONICAL_SKILL_PATH.split("/"));

    expect(result.status).toBe("ready");
    for (const excluded of [
      "templates/node_modules/dep/index.js",
      "templates/package-lock.json",
      ".git/config",
      ".solo/loop-state.json",
      ".proofloop/run.json",
      "templates/SpreadsheetBench/task.json",
      "templates/.cache/cache.bin",
      "templates/benchmark-output/score.json",
      "templates/results_generated.json",
      "templates/run/__pycache__/probe.pyc",
    ]) {
      expect(existsSync(join(installed, ...excluded.split("/"))), excluded).toBe(false);
    }
    expect(readFileSync(join(installed, "templates", "run", "spreadsheetbench.py"), "utf8")).toContain("kept");
  });

  it("writes only a relative Claude wrapper and does not install competing hook settings", () => {
    const source = makeSoloSource();
    const target = makeTarget();

    const result = setupSolo({ targetRoot: target, sourceDir: source.repoRoot, agents: "both" });
    const wrapperPath = join(target, ...SOLO_CLAUDE_WRAPPER_PATH.split("/"));
    const wrapper = readFileSync(wrapperPath, "utf8");

    expect(result.status).toBe("ready");
    expect(wrapper).toContain("../../../.agents/skills/solo-founder-nodes/SKILL.md");
    expect(wrapper).toContain("does not duplicate the skill");
    expect(wrapper).not.toContain(target);
    expect(existsSync(join(dirname(wrapperPath), "MASTER_SKILL.md"))).toBe(false);
    expect(existsSync(join(target, ".claude", "settings.json"))).toBe(false);
    expect(existsSync(join(target, ".codex", "settings.json"))).toBe(false);
  });

  it("composes one conditional stop script and runs its gates in order", () => {
    const source = makeSoloSource();
    const target = makeTarget();
    const result = setupSolo({ targetRoot: target, sourceDir: source.repoRoot, agents: "both" });
    const scriptPath = join(target, ...SOLO_STOP_GATE_PATH.split("/"));
    const script = readFileSync(scriptPath, "utf8");

    expect(result.command).toBe(SOLO_STOP_GATE_COMMAND);
    const baseIndex = script.indexOf('"proofloop", "gate", "--check"');
    const judgeIndex = script.indexOf('"judge", "current", "--project", ".", "--on-stop"');
    const ingestIndex = script.indexOf('"proofloop", "solo", "ingest"');
    const gateIndex = script.indexOf('"proofloop", "solo", "gate"');
    expect(baseIndex).toBeGreaterThan(0);
    expect(judgeIndex).toBeGreaterThan(baseIndex);
    expect(ingestIndex).toBeGreaterThan(judgeIndex);
    expect(gateIndex).toBeGreaterThan(ingestIndex);
    expect(script).toContain("existsSync(SOLO_LOOP_STATE)");
    expect(script).toContain("existsSync(SOLO_INTEROP)");

    const fakeBin = join(target, "fake-bin");
    const logPath = join(target, "stop-calls.log");
    makeFakeCommand(fakeBin, "npm");
    makeFakeCommand(fakeBin, "npx");
    const env: NodeJS.ProcessEnv = { ...process.env, SOLO_STOP_TEST_LOG: logPath };
    const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
    env[pathKey] = `${fakeBin}${delimiter}${env[pathKey] ?? ""}`;

    const first = spawnSync(process.execPath, [scriptPath], { cwd: target, env, encoding: "utf8" });
    expect(first.status, first.stderr).toBe(0);
    expect(readFileSync(logPath, "utf8").trim()).toBe("npx proofloop gate --check");

    write(join(target, ".solo", "loop-state.json"), "{}\n");
    write(join(target, ".solo", "proofloop-interop.json"), "{}\n");
    write(logPath, "");
    const second = spawnSync(process.execPath, [scriptPath], { cwd: target, env, encoding: "utf8" });
    expect(second.status, second.stderr).toBe(0);
    const calls = readFileSync(logPath, "utf8").trim().split(/\r?\n/);
    expect(calls).toHaveLength(4);
    expect(calls[0]).toBe("npx proofloop gate --check");
    expect(calls[1]).toContain("npm --prefix");
    expect(calls[1]).toContain("run sfn -- judge current --project . --on-stop");
    expect(calls[2]).toBe("npx proofloop solo ingest --file .solo/proofloop-interop.json --json");
    expect(calls[3]).toBe("npx proofloop solo gate --json");
  });

  it("uses the injected runner for install, smoke, and conformance without provider calls", () => {
    const source = makeSoloSource();
    const target = makeTarget();
    const calls: { command: string; args: string[]; cwd: string }[] = [];
    const runner: SoloSetupCommandRunner = (command, args, options) => {
      calls.push({ command, args: [...args], cwd: options.cwd });
      return { status: 0 };
    };

    const result = setupSolo({
      targetRoot: target,
      sourceDir: source.repoRoot,
      agents: "codex",
      installDependencies: true,
      verify: true,
      commandRunner: runner,
    });

    const installed = join(target, ...SOLO_CANONICAL_SKILL_PATH.split("/"));
    expect(result.status).toBe("ready");
    expect(calls).toEqual([
      {
        command: "npm",
        args: ["install", "--ignore-scripts", "--no-audit", "--no-fund"],
        cwd: join(installed, "templates"),
      },
      { command: "npm", args: ["run", "smoke"], cwd: join(installed, "templates") },
      { command: "node", args: ["conformance/conformance.mjs", "--run-smoke"], cwd: installed },
    ]);
    expect(result.commandResults.map((command) => command.status)).toEqual(["passed", "passed", "passed"]);
    expect(result.nextCommands).toEqual([SOLO_STOP_GATE_COMMAND]);
    expect(readJson(result.receiptPath).commandResults).toEqual(result.commandResults);
  });

  it("stops verification and persists failed status when an injected command fails", () => {
    const source = makeSoloSource();
    const target = makeTarget();
    const calls: string[] = [];
    const runner: SoloSetupCommandRunner = (command, args) => {
      calls.push(`${command} ${args.join(" ")}`);
      return { status: 9 };
    };

    const result = setupSolo({
      targetRoot: target,
      sourceDir: source.repoRoot,
      agents: "codex",
      verify: true,
      commandRunner: runner,
    });

    expect(result.status).toBe("failed");
    expect(calls).toEqual(["npm run smoke"]);
    expect(result.commandResults).toEqual([
      {
        id: "smoke",
        command: "npm run smoke",
        cwd: `${SOLO_CANONICAL_SKILL_PATH}/templates`,
        exitCode: 9,
        status: "failed",
      },
    ]);
    expect(result.nextCommands).toEqual(["npm run solo:smoke", "npm run solo:conformance", SOLO_STOP_GATE_COMMAND]);
    expect(readJson(result.receiptPath).status).toBe("failed");
  });

  it("validates the canonical schema digest across CRLF/formatting changes and rejects semantic changes", () => {
    const source = makeSoloSource();
    const schemaPath = join(process.cwd(), "schemas", "proofloop-solo-interop-v1.schema.json");
    const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
    const variant = `${JSON.stringify(schema, null, 4).replace(/\n/g, "\r\n")}\r\n`;
    const sourceSchemaPath = join(source.repoRoot, "schemas", "proofloop-solo-interop-v1.schema.json");
    write(sourceSchemaPath, variant);

    const valid = setupSolo({ targetRoot: makeTarget(), sourceDir: source.repoRoot, agents: "codex" });
    const variantRaw = createHash("sha256").update(Buffer.from(variant, "utf8")).digest("hex");
    expect(valid.status).toBe("ready");
    expect(valid.schemaSource).toBe("source");
    expect(valid.schemaDigest).toBe("15c586031558b7cbc68623dc976c5e01f067a847e0dee2cf64970ede86e27ef9");
    expect(valid.schemaRawSha256).toBe(variantRaw);
    expect(valid.schemaRawSha256).not.toBe(SOLO_SETUP_INTEROP_SCHEMA_RAW_SHA256);

    write(sourceSchemaPath, `${JSON.stringify({ ...schema, title: "semantically changed" }, null, 2)}\n`);
    const invalid = setupSolo({ targetRoot: makeTarget(), sourceDir: source.repoRoot, agents: "codex" });
    expect(invalid.status).toBe("needs_source");
    expect(invalid.message).toContain("canonical digest mismatch");
  });
});

function makeSoloSource(): { repoRoot: string; skillRoot: string } {
  const repoRoot = tempRoot("proofloop-solo-source-");
  const skillRoot = join(repoRoot, "skills", "solo-founder-nodes");
  write(
    join(skillRoot, "SKILL.md"),
    [
      "---",
      "name: solo-founder-nodes",
      "description: Local proof-loop skill fixture.",
      "---",
      "",
      "Read MASTER_SKILL.md.",
      "",
    ].join("\n"),
  );
  write(
    join(skillRoot, "MASTER_SKILL.md"),
    "# Solo Founder Nodes\n\nHELD-OUT fixtures and NO ANSWER-KEYS are mandatory.\n",
  );
  writeJson(join(skillRoot, "templates", "package.json"), {
    name: "solo-founder-local-substrate",
    private: true,
    type: "module",
    scripts: { smoke: "tsx smoke.ts", sfn: "tsx bin/sfn.ts" },
  });
  write(join(skillRoot, "templates", "keep.txt"), "keep me\n");
  write(join(skillRoot, "conformance", "conformance.mjs"), "// Solo conformance probe\nprocess.exit(0);\n");
  return { repoRoot, skillRoot };
}

function makeTarget(): string {
  const target = tempRoot("proofloop-solo-target-");
  writeJson(join(target, "package.json"), { name: "target-app", scripts: { test: "node -e 0" } });
  return target;
}

function makeFakeCommand(binDir: string, name: "npm" | "npx"): void {
  mkdirSync(binDir, { recursive: true });
  if (process.platform === "win32") {
    write(
      join(binDir, `${name}.cmd`),
      `@echo off\r\n>>"%SOLO_STOP_TEST_LOG%" echo ${name} %*\r\nexit /b 0\r\n`,
    );
    return;
  }
  const path = join(binDir, name);
  write(path, `#!/bin/sh\nprintf '${name} %s\\n' "$*" >> "$SOLO_STOP_TEST_LOG"\nexit 0\n`);
  chmodSync(path, 0o755);
}

function tempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function writeJson(path: string, value: unknown): void {
  write(path, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, "utf8"));
}
