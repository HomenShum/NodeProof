/**
 * Scenario tests for `proofloop ci install github`. PORTED from the noderoom
 * reference suite, adapted for the package's goal-less gate (`npx proofloop
 * gate`) and its bundled template dir.
 *
 * Persona: a founder adopts Proof Loop in THEIR product repo and wants the
 * gate red/green on every PR. The installer must write the workflow into the
 * TARGET repo only.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { installProofloopGithubCi } from "../src/proofloopCi";

const TEMPLATE_DIR = join(process.cwd(), "templates");

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "proofloop-ci-"));
  tempRoots.push(root);
  return root;
}

describe("proofloop ci install github", () => {
  it("writes the workflow into the target repo and references the package gate command", () => {
    const root = tempRoot();
    const result = installProofloopGithubCi({ root, templateDir: TEMPLATE_DIR });

    expect(result.workflowPath).toBe(join(root, ".github", "workflows", "proofloop-gate.yml"));
    const workflow = readFileSync(result.workflowPath, "utf8");
    // The package gate contract: `npx proofloop gate`, node 20.
    expect(workflow).toContain("npx proofloop gate");
    expect(workflow).toContain("actions/setup-node@v4");
    expect(workflow).toContain("node-version: 20");

    // Idempotent: reinstall overwrites cleanly.
    const again = installProofloopGithubCi({ root, templateDir: TEMPLATE_DIR });
    expect(readFileSync(again.workflowPath, "utf8")).toContain("npx proofloop gate");
  });

  it("reports a missing template clearly and never writes a partial workflow", () => {
    const root = tempRoot();
    expect(() => installProofloopGithubCi({ root, templateDir: join(root, "no-templates-here") })).toThrow(/template not found/);
    expect(existsSync(join(root, ".github", "workflows", "proofloop-gate.yml"))).toBe(false);
  });
});
