import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const html = readFileSync(join(root, "public", "index.html"), "utf8");
const normalizedHtml = html.replace(/\s+/g, " ");
const script = readFileSync(join(root, "public", "app.js"), "utf8");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  version?: string;
  license?: string;
};
const vercelConfig = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8")) as {
  buildCommand?: string;
  outputDirectory?: string;
};

describe("proofloop.live site", () => {
  it("leads with the real install command, not a fabricated dashboard", () => {
    expect(normalizedHtml).toContain("npx proofloop init");
    expect(normalizedHtml).toContain("npx proofloop gate");
    expect(normalizedHtml).toContain("The gate decides");
  });

  it("states the honesty boundary from the CLI without implying an unbuilt hosted backend", () => {
    expect(normalizedHtml).toContain("product-path proof");
    expect(normalizedHtml).toContain("proxy benchmark proof");
    expect(normalizedHtml).toContain("official scorer output");
    expect(normalizedHtml).toContain("no secrets or credentials collected");
    expect(normalizedHtml).toContain("mailto:hshum2018@gmail.com");
  });

  it("shows the real, current package facts instead of a stale or invented version", () => {
    expect(pkg.version).toBeTruthy();
    expect(normalizedHtml).toContain(`v${pkg.version}`);
    expect(normalizedHtml).toContain(pkg.license || "MIT");
  });

  it("has no client-side network calls or forms that could imply a live backend", () => {
    expect(script).not.toContain("fetch(");
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
