import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("interop docs", () => {
  it("ships LangChain/LangSmith/Harbor and local benchmark setup guidance", () => {
    const interop = join(root, "docs", "interoperability.md");
    const benches = join(root, "docs", "local-bench-setup.md");
    expect(existsSync(interop)).toBe(true);
    expect(existsSync(benches)).toBe(true);
    expect(readFileSync(interop, "utf8")).toContain("LangSmith");
    expect(readFileSync(interop, "utf8")).toContain("Harbor");
    expect(readFileSync(benches, "utf8")).toContain("FinAuditing");
    expect(readFileSync(benches, "utf8")).toContain("WorkstreamBench");
  });

  it("ships the Solo Founder authority boundary, install path, and canonical schema", () => {
    const guide = join(root, "docs", "solo-founder-interop.md");
    const schema = join(root, "schemas", "proofloop-solo-interop-v1.schema.json");
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { files: string[] };

    expect(existsSync(guide)).toBe(true);
    expect(existsSync(schema)).toBe(true);
    expect(readFileSync(guide, "utf8")).toContain("Solo verdicts are advisory");
    expect(readFileSync(guide, "utf8")).toContain("team_ready");
    expect(readFileSync(guide, "utf8")).toContain(".agents/skills/solo-founder-nodes");
    expect(pkg.files).toContain("schemas");
  });
});
