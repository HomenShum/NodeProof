import { type Stats } from "node:fs";
export declare function readBoundedRegularFile(path: string, label: string, expected?: Stats): Buffer;
/** Reject links below the declared evidence root before opening a descriptor. */
export declare function resolveLocalProofFile(path: string, root?: string): string;
export declare function readLocalProofFile(path: string, encoding: "utf8", root?: string): string;
export declare function readLocalProofFile(path: string, encoding?: undefined, root?: string): Buffer;
