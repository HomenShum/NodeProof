import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs shared with scripts/record-gate-demo.mjs
import { COLS, wrapLine, assertRowsFit } from "../scripts/narrow-wrap.mjs";

/**
 * The scenario: a reader on a phone opens the README, where the narrow gate-demo
 * GIF is shown at about half its pixel width. A row wider than 34 columns would be
 * clipped by the canvas, so the last characters of a real command or verdict would
 * silently go missing from the clip. The recorder wraps every transcript line at
 * 34 columns and must refuse to render if any row, including a whitespace-only or
 * deeply indented one, is wider than that.
 */
const rowsOf = (line: string): string[] => wrapLine(line).map((r: { text: string }) => r.text);

describe("narrow gate-demo wrap: every row fits 34 columns", () => {
  it("accepts transcript-shaped lines: prose, a path, a long unbroken token, a short indent", () => {
    const lines = [
      "$ node dist/cli.js gate   # the gate decides whether \u201cdone\u201d is true",
      "  state: ~/tiny-app\\.proofloop\\gate-state.json",
      "    at Object.<anonymous> (~/tiny-app\\test.js:3:8)",
      "      " + "y".repeat(60),
      "",
      "  ",
    ];
    for (const line of lines) expect(() => assertRowsFit(rowsOf(line), line)).not.toThrow();
  });

  // Negative controls: wrapLine really does return these over-long (so the assertion is
  // load-bearing, not decorative), and assertRowsFit must throw on every one of them.
  it.each([
    ["a whitespace-only line", " ".repeat(40)],
    ["trailing spaces after text", "x".repeat(10) + " ".repeat(40)],
    ["a leading indent wider than a row", " ".repeat(36) + "x".repeat(40)],
  ])("throws on %s", (_name, line) => {
    const rows = rowsOf(line);
    expect(Math.max(...rows.map((r) => r.length))).toBeGreaterThan(COLS);
    expect(() => assertRowsFit(rows, line)).toThrow(/over 34/);
  });

  it("throws on a hand-made over-long row", () => {
    expect(() => assertRowsFit(["x".repeat(COLS + 1)], "synthetic")).toThrow(/35 columns, over 34/);
  });
});
