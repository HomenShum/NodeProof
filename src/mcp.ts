import { Buffer } from "node:buffer";
import { resolve } from "node:path";
import { buildDoctorReport, formatDoctorReport } from "./doctor";
import {
  buildProofloopProjectManifest,
  buildResume,
  discoverUiContracts,
  formatProofloopProjectManifestDense,
  formatUiContractsDense,
  listProofloopTemplates,
} from "./project";

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

type McpTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

const TOOLS: McpTool[] = [
  {
    name: "proofloop_manifest",
    description: "Return the compact Proof Loop project manifest.",
    inputSchema: objectSchema({ root: stringSchema("Repo root; defaults to the server cwd."), dense: booleanSchema("Return dense text instead of JSON.") }),
  },
  {
    name: "proofloop_doctor",
    description: "Return setup/readiness checks and exact fix commands.",
    inputSchema: objectSchema({ root: stringSchema("Repo root; defaults to the server cwd."), dense: booleanSchema("Return text instead of JSON.") }),
  },
  {
    name: "proofloop_ui_contract",
    description: "Return stable data-testid/data-proofloop UI contracts.",
    inputSchema: objectSchema({ root: stringSchema("Repo root; defaults to the server cwd."), dense: booleanSchema("Return dense text instead of JSON.") }),
  },
  {
    name: "proofloop_resume",
    description: "Return the next Proof Loop action from the latest gate receipt.",
    inputSchema: objectSchema({ root: stringSchema("Repo root; defaults to the server cwd."), dense: booleanSchema("Return dense text instead of JSON.") }),
  },
  {
    name: "proofloop_templates",
    description: "List starter Proof Loop templates.",
    inputSchema: objectSchema({}),
  },
];

export function startMcpServer(options: { root: string }): void {
  const serverRoot = resolve(options.root);
  let buffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    const parsed = drainMessages(buffer);
    buffer = parsed.remainder;
    for (const body of parsed.messages) handleBody(body, serverRoot);
  });
  process.stdin.on("end", () => process.exit(0));
}

function handleBody(body: string, serverRoot: string): void {
  let request: JsonRpcRequest;
  try {
    request = JSON.parse(body) as JsonRpcRequest;
  } catch {
    send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    return;
  }
  if (request.id === undefined || request.id === null) return;
  try {
    send({ jsonrpc: "2.0", id: request.id, result: handleRequest(request, serverRoot) });
  } catch (error) {
    send({
      jsonrpc: "2.0",
      id: request.id,
      error: { code: -32603, message: error instanceof Error ? error.message : String(error) },
    });
  }
}

function handleRequest(request: JsonRpcRequest, serverRoot: string): JsonValue {
  switch (request.method) {
    case "initialize":
      return {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "proofloop", version: "0.3.0" },
      };
    case "ping":
      return {};
    case "tools/list":
      return { tools: TOOLS as unknown as JsonValue };
    case "tools/call":
      return callTool(request.params ?? {}, serverRoot);
    default:
      throw new Error(`Unsupported MCP method: ${request.method ?? "(missing)"}`);
  }
}

function callTool(params: Record<string, unknown>, serverRoot: string): JsonValue {
  const name = typeof params.name === "string" ? params.name : "";
  const args = params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments)
    ? params.arguments as Record<string, unknown>
    : {};
  const root = typeof args.root === "string" && args.root.trim() ? resolve(args.root) : serverRoot;
  const dense = args.dense === true;
  switch (name) {
    case "proofloop_manifest": {
      const manifest = buildProofloopProjectManifest(root);
      return toolText(dense ? formatProofloopProjectManifestDense(manifest) : JSON.stringify(manifest, null, 2));
    }
    case "proofloop_doctor": {
      const report = buildDoctorReport(root);
      return toolText(dense ? formatDoctorReport(report) : JSON.stringify(report, null, 2));
    }
    case "proofloop_ui_contract": {
      const contracts = discoverUiContracts(root);
      return toolText(dense ? formatUiContractsDense(contracts) : JSON.stringify(contracts, null, 2));
    }
    case "proofloop_resume": {
      const resume = buildResume(root);
      return toolText(dense ? resume.dense : JSON.stringify(resume.json, null, 2));
    }
    case "proofloop_templates":
      return toolText(JSON.stringify(listProofloopTemplates(), null, 2));
    default:
      throw new Error(`Unknown Proof Loop MCP tool: ${name}`);
  }
}

function toolText(text: string): JsonValue {
  return { content: [{ type: "text", text }] };
}

function send(message: JsonValue): void {
  const body = JSON.stringify(message);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
}

function drainMessages(input: string): { messages: string[]; remainder: string } {
  let buffer = input;
  const messages: string[] = [];
  while (buffer.length > 0) {
    buffer = buffer.replace(/^\s+/, "");
    if (buffer.length === 0) break;
    const headerMatch = /^Content-Length:\s*(\d+)\s*(?:\r\n|\n)/i.exec(buffer);
    if (headerMatch) {
      const headerEnd = buffer.indexOf("\r\n\r\n") >= 0 ? buffer.indexOf("\r\n\r\n") + 4 : buffer.indexOf("\n\n") >= 0 ? buffer.indexOf("\n\n") + 2 : -1;
      if (headerEnd < 0) break;
      const length = Number(headerMatch[1]);
      const bodyStart = headerEnd;
      if (buffer.length < bodyStart + length) break;
      messages.push(buffer.slice(bodyStart, bodyStart + length));
      buffer = buffer.slice(bodyStart + length);
      continue;
    }
    const newline = buffer.indexOf("\n");
    if (newline < 0) break;
    const line = buffer.slice(0, newline).trim();
    if (line.length > 0) messages.push(line);
    buffer = buffer.slice(newline + 1);
  }
  return { messages, remainder: buffer };
}

function objectSchema(properties: Record<string, Record<string, unknown>>): Record<string, unknown> {
  return { type: "object", properties, additionalProperties: false };
}

function stringSchema(description: string): Record<string, unknown> {
  return { type: "string", description };
}

function booleanSchema(description: string): Record<string, unknown> {
  return { type: "boolean", description };
}
