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
  it("publishes an honest managed-service contract for live URL and codebase proof runs", () => {
    expect(normalizedHtml).toContain("proofloop.live");
    expect(normalizedHtml).toContain("Give us a live URL or a codebase");
    expect(normalizedHtml).toContain("Live URL");
    expect(normalizedHtml).toContain("Codebase");
    expect(normalizedHtml).toContain("official benchmark scores");
    expect(normalizedHtml).toContain("product-path proof");
    expect(normalizedHtml).toContain("official scorer output");
    expect(normalizedHtml).toContain("does not collect secrets, tokens, or repository credentials");
  });

  it("uses a static intake request instead of implying an unbuilt hosted backend", () => {
    expect(script).toContain("proofloop-live-intake-v1");
    expect(script).toContain("mailto:hshum2018@gmail.com");
    expect(script).toContain("requestedArtifacts");
    expect(script).not.toContain("fetch(");
    expect(script).not.toContain("XMLHttpRequest");
  });

  it("has all deployable static assets and Vercel output wiring", () => {
    expect(existsSync(join(root, "public", "styles.css"))).toBe(true);
    expect(existsSync(join(root, "public", "proofloop-live-dashboard.svg"))).toBe(true);
    expect(vercelConfig.buildCommand).toBe("npm run build");
    expect(vercelConfig.outputDirectory).toBe("public");
  });
});
