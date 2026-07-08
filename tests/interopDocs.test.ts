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
});
