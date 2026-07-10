/**
 * Proof Loop CI installer -- `proofloop ci install github`.
 *
 * PORTED from the noderoom reference implementation (src/eval/proofloopCi.ts).
 * Writes a GitHub Actions workflow into a TARGET repo (--dir) that runs the
 * package gate (`npx proofloop gate`) and fails the job when the gate is not
 * passing.
 *
 * PACKAGE ADAPTATION: noderoom rendered a goal-id placeholder into a workflow
 * that ran `npx tsx scripts/proofloop-cli.ts gate --goal <id>`. This package
 * has no goals -- the gate is the config-driven `npx proofloop gate` -- so the
 * template is copied verbatim (no placeholder substitution). The template
 * ships inside the package (templates/github-proofloop-gate.yml) and is located
 * relative to this compiled file, so the installer works from `npx proofloop`
 * anywhere.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const PROOFLOOP_CI_TEMPLATE_FILENAME = "github-proofloop-gate.yml";
export const PROOFLOOP_CI_WORKFLOW_RELPATH = ".github/workflows/proofloop-gate.yml";
export const PROOFLOOP_CI_VERSION_TOKEN = "__PROOFLOOP_VERSION__";

export type ProofloopCiInstallOptions = {
  /** Target repo root the workflow is written into. Default: cwd. */
  root?: string;
  /**
   * Directory that contains the shipped template. Default: the package's
   * `templates/` dir, located relative to this compiled module.
   */
  templateDir?: string;
  /** Exact CLI version rendered into the workflow. Defaults to this package version. */
  packageVersion?: string;
};

export type ProofloopCiInstallResult = {
  root: string;
  templatePath: string;
  workflowPath: string;
  packageVersion: string;
};

/**
 * Resolve the package's bundled templates/ directory. This file compiles to
 * dist/proofloopCi.js (CommonJS), so __dirname is dist/ and templates/ is one
 * level up.
 */
export function defaultTemplateDir(): string {
  return join(__dirname, "..", "templates");
}

export function installedPackageVersion(): string {
  const packagePath = join(__dirname, "..", "package.json");
  const parsed = JSON.parse(readFileSync(packagePath, "utf8")) as { version?: unknown };
  if (typeof parsed.version !== "string" || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(parsed.version)) {
    throw new Error(`Proof Loop package version is invalid in ${packagePath}.`);
  }
  return parsed.version;
}

export function installProofloopGithubCi(options: ProofloopCiInstallOptions = {}): ProofloopCiInstallResult {
  const root = resolve(options.root ?? process.cwd());
  const templateDir = resolve(options.templateDir ?? defaultTemplateDir());
  const templatePath = join(templateDir, PROOFLOOP_CI_TEMPLATE_FILENAME);
  if (!existsSync(templatePath)) {
    throw new Error(`Proof Loop CI template not found at ${templatePath}.`);
  }
  const template = readFileSync(templatePath, "utf8");
  const packageVersion = options.packageVersion ?? installedPackageVersion();
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(packageVersion)) {
    throw new Error(`Proof Loop CI package version is invalid: ${packageVersion}.`);
  }
  if (!template.includes(PROOFLOOP_CI_VERSION_TOKEN)) {
    throw new Error(`Proof Loop CI template is missing ${PROOFLOOP_CI_VERSION_TOKEN}.`);
  }
  const rendered = template.replaceAll(PROOFLOOP_CI_VERSION_TOKEN, packageVersion);

  const workflowPath = join(root, ...PROOFLOOP_CI_WORKFLOW_RELPATH.split("/"));
  mkdirSync(dirname(workflowPath), { recursive: true });
  writeFileSync(workflowPath, rendered, "utf8");

  return { root, templatePath, workflowPath, packageVersion };
}
