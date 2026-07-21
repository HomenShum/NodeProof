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
export * from "./runner";
export * from "./program";
export * from "./layeredPlan";
export * from "./targetPlan";
export * from "./hosted";
export * from "./maturity";
export * from "./productivity";
export * from "./contextReport";
export * from "./receipts";
export * from "./proofReceipt";
export * from "./nodekitProof";
export * from "./easeProof";
export * from "./agentAdapters";
export * from "./agentLoop";
export * from "./codexRelaunch";
export * from "./providerSetup";
export * from "./soloInterop";
export * from "./soloSetup";
export * from "./soloTrust";
export { runCli } from "./cli";
