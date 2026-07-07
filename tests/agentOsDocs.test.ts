import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("ProofLoop Agent OS docs pack", () => {
  it("ships the human/agent context doctrine and research notes", () => {
    const readme = join(root, "docs", "agent-os", "README.md");
    const research = join(root, "docs", "agent-os", "research.md");

    expect(existsSync(readme)).toBe(true);
    expect(existsSync(research)).toBe(true);

    expect(readFileSync(readme, "utf8")).toContain("ProofLoop Agent OS Markdown Pack");
    expect(readFileSync(research, "utf8")).toContain("https://arxiv.org/abs/1803.10122");
    expect(readFileSync(research, "utf8")).toContain("https://docs.langchain.com/oss/python/langchain/context-engineering");
    expect(readFileSync(research, "utf8")).toContain("https://www.anthropic.com/engineering/building-effective-agents");
  });
});
