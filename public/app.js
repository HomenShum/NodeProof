(function () {
  const input = document.querySelector("[data-intake-input]");
  const submit = document.querySelector("[data-intake-submit]");
  const githubSso = document.querySelector("[data-github-sso]");
  const status = document.querySelector("[data-intake-status]");
  const detail = document.querySelector("[data-intake-detail]");

  if (!input || !submit || !status || !detail) return;

  function setStatus(kind, message, payload) {
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

  /**
   * Defect D1: the refusal headline used to be `data.status` — the machine enum
   * `"blocked"` minted in api/hosted/submit.js:35 — rendered as the entire
   * user-facing message above a JSON dump. The API's job is to answer a machine;
   * turning that answer into a sentence is this page's job, and this is the one
   * place a machine value becomes copy. Every branch names what happened and how
   * to get out of it (WIG: "No dead ends; always offer next step/recovery").
   */
  function blockedMessage(data) {
    const permission = data.permission || {};
    if (data.status === "dispatch_failed") {
      return "Dispatch failed — the request was accepted but the proof run could not be started. The receipt below has the dispatch error.";
    }
    if (permission.host && permission.token) {
      return `Blocked — nobody has proved they own ${permission.host} yet, so ProofLoop will not point a browser at it. Do either step in the receipt below, then ProofLoop again.`;
    }
    if (data.error) return `Blocked — ${data.error}`;
    return "Blocked — this run cannot start yet. The receipt below lists what has to change first.";
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

  async function loadGithubStatus() {
    if (!githubSso) return;
    try {
      const response = await fetch("/api/auth/github/status", { headers: { accept: "application/json" } });
      const data = await response.json();
      githubSso.setAttribute("data-auth-configured", data.authConfigured ? "true" : "false");
      githubSso.setAttribute("data-authenticated", data.authenticated ? "true" : "false");
      if (data.authenticated && data.user && data.user.login) {
        githubSso.textContent = `GitHub connected: ${data.user.login}`;
        return;
      }
      githubSso.textContent = "Continue with GitHub";
    } catch {
      githubSso.setAttribute("data-auth-configured", "unknown");
    }
  }

  function showRouteStatus() {
    const params = new URLSearchParams(window.location.search);
    if (params.get("github") === "connected") {
      setStatus("github", "GitHub connected. Paste a URL or repo to start a proof run.");
      return;
    }
    const auth = params.get("auth");
    if (auth === "github_unconfigured") {
      setStatus("blocked", "GitHub SSO is not configured on this deployment yet.");
    } else if (auth === "github_state_mismatch") {
      setStatus("blocked", "GitHub sign-in expired. Try Continue with GitHub again.");
    } else if (auth === "github_denied") {
      setStatus("blocked", "GitHub sign-in was cancelled.");
    } else if (auth === "github_failed") {
      setStatus("blocked", "GitHub sign-in failed before a session could be created.");
    }
  }

  async function submitTarget() {
    let target;
    try {
      target = normalizeTarget(input.value);
      new URL(target);
    } catch (error) {
      setStatus("blocked", error.message || "Enter a valid URL or GitHub repo.");
      // WIG Forms: "MUST: Errors inline next to fields; on submit, focus first
      // error". One field, so the first error is always this one.
      input.focus();
      return;
    }

    const repo = githubRepo(target);
    if (repo) {
      setStatus("github", "GitHub repo target ready.", githubCommand(repo));
      return;
    }

    submit.disabled = true;
    setStatus("pending", "Submitting…");
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
        setStatus("blocked", blockedMessage(data), data.permission || data.validation || data);
        return;
      }
      setStatus("queued", `Queued run ${data.runId}. The links below follow it.`, data.urls || data);
    } catch (error) {
      setStatus("blocked", `Blocked — the browser could not reach ProofLoop (${error && error.message ? error.message : String(error)}). Check your connection and ProofLoop again.`);
    } finally {
      submit.disabled = false;
    }
  }

  submit.addEventListener("click", submitTarget);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") submitTarget();
  });
  showRouteStatus();
  loadGithubStatus();
})();
