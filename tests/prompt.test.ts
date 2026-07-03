/**
 * The kickoff prompt (`proofloop prompt`) may reference ONLY commands this
 * package actually implements. This test grep-asserts that every
 * `proofloop <cmd>` mentioned in the prompt is a real command.
 */
import { describe, expect, it } from "vitest";
import { proofloopKickoffPrompt, PACKAGE_COMMANDS } from "../src/prompt";

describe("proofloop prompt honesty", () => {
  it("only references CLI commands the package actually implements", () => {
    const prompt = proofloopKickoffPrompt();
    const known = new Set<string>(PACKAGE_COMMANDS);
    expect(known.size).toBeGreaterThanOrEqual(7);

    const mentioned = [...prompt.matchAll(/proofloop ([a-z-]+)/g)].map((match) => match[1]);
    expect(mentioned.length).toBeGreaterThan(0);
    for (const command of mentioned) {
      expect(known.has(command), `\`proofloop ${command}\` is mentioned in the kickoff prompt but is not a package command`).toBe(true);
    }

    // The core loop contract is spelled out with real package commands.
    expect(prompt).toContain("proofloop init");
    expect(prompt).toContain("proofloop gate");
    expect(prompt).toContain("proofloop hooks install");
    expect(prompt).toContain("proofloop manifest");
    expect(prompt).toContain("proofloop mcp");
    // It must NOT reference the noderoom-only commands this package does not ship.
    expect(prompt).not.toContain("proofloop supervise");
    expect(prompt).not.toContain("proofloop goal");
    expect(prompt).not.toContain("proofloop run ");
    expect(prompt.split("\n").length).toBeLessThanOrEqual(28);
  });
});
