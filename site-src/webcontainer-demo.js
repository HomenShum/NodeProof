import { WebContainer } from "@webcontainer/api";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";

const FIXTURE_FILES = {
  "package.json": {
    file: {
      contents: JSON.stringify(
        {
          name: "proofloop-demo-app",
          version: "0.0.0",
          private: true,
          type: "module",
          scripts: {
            build: "node build.js",
            test: "node test.js",
          },
        },
        null,
        2,
      ),
    },
  },
  "build.js": { file: { contents: "console.log('build ok');\n" } },
  "test.js": { file: { contents: "console.log('tests ok');\nprocess.exit(0);\n" } },
  "proofloop.config.json": {
    file: {
      contents: JSON.stringify(
        {
          app: "Node",
          workflow: "demo app builds and its tests pass",
          gate: {
            checks: [
              { name: "build", command: "npm run build" },
              { name: "tests", command: "npm test" },
            ],
          },
        },
        null,
        2,
      ),
    },
  },
};

function crossOriginIsolationSupported() {
  return (
    typeof SharedArrayBuffer !== "undefined" &&
    typeof window !== "undefined" &&
    window.crossOriginIsolated === true
  );
}

async function pipeToTerminal(process, term) {
  await process.output.pipeTo(
    new WritableStream({
      write(chunk) {
        term.write(chunk);
      },
    }),
  );
}

async function runDemo(term, setStatus) {
  setStatus("booting sandbox...");
  const webcontainer = await WebContainer.boot();
  await webcontainer.mount(FIXTURE_FILES);

  setStatus("installing proofloop from npm...");
  term.writeln("$ npm install proofloop --no-audit --no-fund");
  const install = await webcontainer.spawn("npm", ["install", "proofloop", "--no-audit", "--no-fund"]);
  const installPipe = pipeToTerminal(install, term);
  const installExit = await install.exit;
  await installPipe;
  if (installExit !== 0) {
    setStatus("install failed");
    term.writeln("\r\n[install failed - showing recorded transcript instead]");
    return;
  }

  setStatus("running npx proofloop init...");
  term.writeln("\r\n$ npx proofloop init");
  const init = await webcontainer.spawn("npx", ["proofloop", "init"]);
  const initPipe = pipeToTerminal(init, term);
  await init.exit;
  await initPipe;

  setStatus("running npx proofloop gate...");
  term.writeln("\r\n$ npx proofloop gate");
  const gate = await webcontainer.spawn("npx", ["proofloop", "gate"]);
  const gatePipe = pipeToTerminal(gate, term);
  const gateExit = await gate.exit;
  await gatePipe;

  setStatus(gateExit === 0 ? "gate: passed (real run against npm proofloop package)" : "gate: failed");
}

function init() {
  const runButton = document.querySelector("[data-run-real]");
  const staticBody = document.querySelector("[data-static-terminal]");
  const liveHost = document.querySelector("[data-live-terminal]");
  const statusEl = document.querySelector("[data-run-status]");

  if (!runButton || !staticBody || !liveHost || !statusEl) return;
  if (!crossOriginIsolationSupported()) return;

  runButton.hidden = false;

  let started = false;
  runButton.addEventListener("click", async () => {
    if (started) return;
    started = true;
    runButton.disabled = true;
    runButton.textContent = "Running...";

    staticBody.hidden = true;
    liveHost.hidden = false;

    const term = new Terminal({
      convertEol: true,
      fontFamily: "'JetBrains Mono', ui-monospace, monospace",
      fontSize: 12,
      theme: { background: "#131417", foreground: "#c9c7bf", cursor: "#d97757" },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(liveHost);
    fitAddon.fit();
    window.addEventListener("resize", () => fitAddon.fit());

    const setStatus = (text) => {
      statusEl.textContent = text;
    };

    try {
      await runDemo(term, setStatus);
    } catch (err) {
      setStatus("sandbox unavailable - showing recorded transcript instead");
      term.writeln(`\r\n[${err && err.message ? err.message : "boot failed"}]`);
      liveHost.hidden = true;
      staticBody.hidden = false;
    } finally {
      runButton.textContent = "Ran in sandbox";
    }
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
