import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildDoctorReport } from "../src/doctor";

/**
 * The scenario: a reviewer clones this repo and asks it whether it can prove its
 * own landing page works in a browser. Before this test existed, the repo's own
 * `npm run demo` answered "no" — it listed "Playwright/browser proof dependency
 * or config" as missing while two committed scripts (scripts/hosted-worker.mjs,
 * scripts/record-gate-demo.mjs) imported playwright at runtime anyway, and no
 * committed script could serve public/ with api/** mounted. Five promotion
 * scorecard rows were UNVERIFIED for exactly that reason.
 *
 * This guards both halves the gate asks for: the producer is committed and
 * runnable from a fresh clone, and its output is committed at the path the
 * scorecard names.
 */
const root = process.cwd();
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
  devDependencies: Record<string, string>;
};
const evidenceDir = join(root, "promotion", "evidence", "browser-proof");

describe("browser proof — the repo can prove its own page in a real browser", () => {
  it("no longer reports a Playwright/browser gap about itself", () => {
    const report = buildDoctorReport(root);
    expect(report.playwright.declared).toBe(true);
    expect(report.missing).not.toContain("Playwright/browser proof dependency or config");
  });

  it("declares the playwright package its own scripts already import", () => {
    // hosted-worker.mjs and record-gate-demo.mjs both `import("playwright")`,
    // not "@playwright/test" — declaring the other one would leave them broken.
    expect(pkg.devDependencies.playwright).toBeTruthy();
    expect(readFileSync(join(root, "scripts", "hosted-worker.mjs"), "utf8")).toContain('import("playwright")');
  });

  it("keeps the producer committed and reachable by name", () => {
    expect(existsSync(join(root, "scripts", "browser-proof.mjs"))).toBe(true);
    expect(pkg.scripts["proofloop:browser-proof"]).toBe("node scripts/browser-proof.mjs");
  });

  it("keeps a passing receipt and its screenshots committed", () => {
    const receipt = JSON.parse(readFileSync(join(evidenceDir, "receipt.json"), "utf8")) as {
      schema: string;
      pass: boolean;
      failures: string[];
      layout: { width: number; overflowPx: number }[];
      journeys: Record<string, unknown>;
    };
    expect(receipt.schema).toBe("proofloop-browser-proof-v1");
    expect(receipt.pass).toBe(true);
    expect(receipt.failures).toEqual([]);
    expect(receipt.layout.every((row) => row.overflowPx <= 0)).toBe(true);
    expect(Object.keys(receipt.journeys)).toEqual(["J4", "J5"]);
    for (const shot of ["j4-02-repo-ready-1280.png", "j5-01-refused-1280.png", "layout-0386px.png", "layout-2560px.png"]) {
      expect(existsSync(join(evidenceDir, shot))).toBe(true);
    }
  });
});
