"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROOFLOOP_CI_WORKFLOW_RELPATH = exports.PROOFLOOP_CI_TEMPLATE_FILENAME = void 0;
exports.defaultTemplateDir = defaultTemplateDir;
exports.installProofloopGithubCi = installProofloopGithubCi;
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
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
exports.PROOFLOOP_CI_TEMPLATE_FILENAME = "github-proofloop-gate.yml";
exports.PROOFLOOP_CI_WORKFLOW_RELPATH = ".github/workflows/proofloop-gate.yml";
/**
 * Resolve the package's bundled templates/ directory. This file compiles to
 * dist/proofloopCi.js (CommonJS), so __dirname is dist/ and templates/ is one
 * level up.
 */
function defaultTemplateDir() {
    return (0, node_path_1.join)(__dirname, "..", "templates");
}
function installProofloopGithubCi(options = {}) {
    const root = (0, node_path_1.resolve)(options.root ?? process.cwd());
    const templateDir = (0, node_path_1.resolve)(options.templateDir ?? defaultTemplateDir());
    const templatePath = (0, node_path_1.join)(templateDir, exports.PROOFLOOP_CI_TEMPLATE_FILENAME);
    if (!(0, node_fs_1.existsSync)(templatePath)) {
        throw new Error(`Proof Loop CI template not found at ${templatePath}.`);
    }
    const template = (0, node_fs_1.readFileSync)(templatePath, "utf8");
    const workflowPath = (0, node_path_1.join)(root, ...exports.PROOFLOOP_CI_WORKFLOW_RELPATH.split("/"));
    (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(workflowPath), { recursive: true });
    (0, node_fs_1.writeFileSync)(workflowPath, template, "utf8");
    return { root, templatePath, workflowPath };
}
