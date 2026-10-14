"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.repairTimeoutMs = repairTimeoutMs;
/** Shared private policy for the launcher, loop and CLI; not a total-loop deadline. */
function repairTimeoutMs(value) {
    if (value === undefined)
        return 30 * 60 * 1000;
    if (!Number.isInteger(value) || value < 1 || value > 2147483647) {
        throw new Error("timeoutMs must be an integer from 1 to 2147483647");
    }
    return value;
}
