"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runCli = void 0;
/**
 * Public API surface for the proofloop package. The CLI (dist/cli.js) is the
 * primary entry point, but these exports let the core be embedded in other
 * tooling.
 */
__exportStar(require("./config"), exports);
__exportStar(require("./detect"), exports);
__exportStar(require("./gate"), exports);
__exportStar(require("./init"), exports);
__exportStar(require("./doctor"), exports);
__exportStar(require("./prompt"), exports);
__exportStar(require("./thisRepo"), exports);
__exportStar(require("./proofloopHooks"), exports);
__exportStar(require("./proofloopCi"), exports);
__exportStar(require("./proofloopToolUse"), exports);
__exportStar(require("./scaffoldConstants"), exports);
__exportStar(require("./project"), exports);
__exportStar(require("./mcp"), exports);
__exportStar(require("./runner"), exports);
__exportStar(require("./layeredPlan"), exports);
var cli_1 = require("./cli");
Object.defineProperty(exports, "runCli", { enumerable: true, get: function () { return cli_1.runCli; } });
