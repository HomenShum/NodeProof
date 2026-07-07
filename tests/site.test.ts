import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const html = readFileSync(join(root, "public", "index.html"), "utf8");
const normalizedHtml = html.replace(/\s+/g, " ");
const script = readFileSync(join(root, "public", "app.js"), "utf8");
const vercelConfig = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8")) as {
  buildCommand?: string;
  outputDirectory?: string;
};

describe("proofloop.live site", () => {
  it("is only a URL/GitHub intake on first load", () => {
    expect(normalizedHtml).toContain("Put your URL or GitHub in");
    expect(normalizedHtml).toContain('data-testid="target-input"');
    expect(normalizedHtml).toContain('data-testid="target-submit"');
    expect(normalizedHtml).toContain("https://your-app.com or https://github.com/org/repo");

    expect(normalizedHtml).not.toContain("The gate decides");
    expect(normalizedHtml).not.toContain("Build a proof loop");
    expect(normalizedHtml).not.toContain("Enter any URL and ProofLoop it with benchmark tasks");
    expect(normalizedHtml).not.toContain("Agent-era maturity");
    expect(normalizedHtml).not.toContain("Verified productivity");
    expect(normalizedHtml).not.toContain("github.com/HomenShum/proofloop");
  });

  it("keeps the GitHub path honest instead of sending github.com to live-browser automation", () => {
    expect(script).toContain("githubRepo");
    expect(script).toContain("git clone");
    expect(script).toContain("npx proofloop init --agent auto --live");
    expect(script).toContain("npx proofloop maturity --target-level 5 --write");
  });

  it("submits live URLs through the hosted API with the existing permission gate", () => {
    expect(script).toContain('fetch("/api/hosted/submit"');
    expect(script).toContain("requestedBenchmarkFamilies");
    expect(script).toContain("live-browser-smoke");
    expect(script).toContain("ownsOrAuthorized");
    expect(script).not.toContain("XMLHttpRequest");
    expect(normalizedHtml).not.toContain("<form");
  });

  it("has all deployable static assets and Vercel output wiring", () => {
    expect(existsSync(join(root, "public", "styles.css"))).toBe(true);
    expect(existsSync(join(root, "public", "app.js"))).toBe(true);
    expect(vercelConfig.buildCommand).toBe("npm run build");
    expect(vercelConfig.outputDirectory).toBe("public");
  });
});
