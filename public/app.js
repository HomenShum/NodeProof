(function () {
  const input = document.querySelector("[data-intake-input]");
  const submit = document.querySelector("[data-intake-submit]");
  const status = document.querySelector("[data-intake-status]");
  const detail = document.querySelector("[data-intake-detail]");

  if (!input || !submit || !status || !detail) return;

  function setStatus(kind, message, payload) {
    status.hidden = false;
    status.setAttribute("data-kind", kind);
    status.textContent = message;
    if (payload === undefined) {
      detail.hidden = true;
      detail.textContent = "";
      return;
    }
    detail.hidden = false;
    detail.textContent = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
  }

  function normalizeTarget(raw) {
    const trimmed = raw.trim();
    if (!trimmed) throw new Error("Enter a URL or GitHub repo.");
    if (/^[\w.-]+\/[\w.-]+$/.test(trimmed)) return `https://github.com/${trimmed}`;
    if (/^github\.com\//i.test(trimmed)) return `https://${trimmed}`;
    if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(trimmed)) return `https://${trimmed}`;
    return trimmed;
  }

  function githubRepo(target) {
    try {
      const url = new URL(target);
      if (!/^(www\.)?github\.com$/i.test(url.hostname)) return null;
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts.length < 2) return null;
      return { owner: parts[0], repo: parts[1].replace(/\.git$/i, ""), url: `https://github.com/${parts[0]}/${parts[1].replace(/\.git$/i, "")}` };
    } catch {
      return null;
    }
  }

  function githubCommand(repo) {
    return [
      `git clone ${repo.url}`,
      `cd ${repo.repo}`,
      "npx proofloop init --agent auto --live",
      "npx proofloop maturity --target-level 5 --write",
      "npx proofloop gate",
    ].join(" && ");
  }

  async function submitTarget() {
    let target;
    try {
      target = normalizeTarget(input.value);
      new URL(target);
    } catch (error) {
      setStatus("blocked", error.message || "Enter a valid URL or GitHub repo.");
      return;
    }

    const repo = githubRepo(target);
    if (repo) {
      setStatus("github", "GitHub repo target ready.", githubCommand(repo));
      return;
    }

    submit.disabled = true;
    setStatus("pending", "Submitting...");
    try {
      const response = await fetch("/api/hosted/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          targetUrl: target,
          appType: "agent-app",
          modelBudgetUsd: 10,
          requestedBenchmarkFamilies: ["live-browser-smoke"],
          consent: {
            accepted: true,
            ownsOrAuthorized: true,
            allowBrowserAutomation: true,
            allowRecording: true,
          },
          visibility: "private",
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        setStatus("blocked", data.status || data.error || "Blocked", data.permission || data.validation || data);
        return;
      }
      setStatus("queued", `Queued ${data.runId}.`, data.urls || data);
    } catch (error) {
      setStatus("blocked", error && error.message ? error.message : String(error));
    } finally {
      submit.disabled = false;
    }
  }

  submit.addEventListener("click", submitTarget);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") submitTarget();
  });
})();
