/**
 * Public API surface for the proofloop package. The CLI (dist/cli.js) is the
 * primary entry point, but these exports let the core be embedded in other
 * tooling.
 */
export * from "./config";
export * from "./detect";
export * from "./gate";
export * from "./init";
export * from "./doctor";
export * from "./prompt";
export * from "./thisRepo";
export * from "./proofloopHooks";
export * from "./proofloopCi";
export * from "./proofloopToolUse";
export * from "./scaffoldConstants";
export * from "./project";
export * from "./mcp";
export { runCli } from "./cli";
