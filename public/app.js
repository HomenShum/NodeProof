(function () {
  function bindCopyButton(btn) {
    const original = btn.textContent;
    btn.addEventListener("click", async () => {
      const text = btn.getAttribute("data-copy") || "";
      try {
        if (!navigator.clipboard || !window.isSecureContext) throw new Error("clipboard unavailable");
        await navigator.clipboard.writeText(text);
        btn.textContent = "Copied";
      } catch {
        btn.textContent = "Copy failed";
      }
      setTimeout(() => {
        btn.textContent = original;
      }, 1600);
    });
  }

  document.querySelectorAll("[data-copy]").forEach(bindCopyButton);

  const input = document.querySelector("[data-builder-input]");
  const command = document.querySelector("[data-builder-command]");
  const copy = document.querySelector("[data-builder-copy]");
  const templates = Array.from(document.querySelectorAll("[data-template]"));

  function commandFor(value) {
    const text = value.trim();
    const url = text.match(/https?:\/\/[^\s"']+/i)?.[0];
    if (url) return `npx proofloop target --url ${url} --write-runner-plan`;
    return "npx proofloop target --write-runner-plan";
  }

  function updateBuilder() {
    if (!input || !command || !copy) return;
    const next = commandFor(input.value || "");
    command.textContent = next;
    copy.setAttribute("data-copy", next);
  }

  if (input && command && copy) {
    input.addEventListener("input", updateBuilder);
    templates.forEach((template) => {
      template.addEventListener("click", () => {
        templates.forEach((item) => item.removeAttribute("data-selected"));
        template.setAttribute("data-selected", "true");
        input.value = template.getAttribute("data-template") || "";
        input.focus();
        updateBuilder();
      });
    });
    updateBuilder();
  }

  const hostedUrl = document.querySelector("[data-hosted-target-url]");
  const hostedAppType = document.querySelector("[data-hosted-app-type]");
  const hostedBudget = document.querySelector("[data-hosted-budget]");
  const hostedVisibility = document.querySelector("[data-hosted-visibility]");
  const hostedAuthNotes = document.querySelector("[data-hosted-auth-notes]");
  const hostedConsent = document.querySelector("[data-hosted-consent]");
  const hostedFamilies = Array.from(document.querySelectorAll("[data-hosted-family]"));
  const hostedCommand = document.querySelector("[data-hosted-command]");
  const hostedCopy = document.querySelector("[data-hosted-copy]");
  const hostedSubmit = document.querySelector("[data-hosted-submit]");
  const hostedStatus = document.querySelector("[data-hosted-status]");
  const hostedPacket = document.querySelector("[data-hosted-packet]");
  const hostedDomainProof = document.querySelector("[data-hosted-domain-proof]");
  const allowlistedHosts = new Set(["noderoom.live", "www.noderoom.live", "proofloop.live", "www.proofloop.live"]);

  function shellQuote(value) {
    return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }

  function safeId(value) {
    return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "item";
  }

  function selectedFamilies() {
    return hostedFamilies.filter((item) => item.checked).map((item) => item.value);
  }

  function domainProofFor(rawUrl) {
    try {
      const host = new URL(rawUrl).hostname.toLowerCase();
      const token = `proofloop-domain-${safeId(host)}-verify`;
      if (allowlistedHosts.has(host) || host === "localhost" || host === "127.0.0.1") {
        return `${host} is allowlisted for dogfood or owned-product runs.`;
      }
      return `Before automation: serve /.well-known/proofloop-domain-verification.txt with ${token}, or publish TXT _proofloop.${host}=${token}.`;
    } catch {
      return "Enter a valid https URL to generate the domain verification instruction.";
    }
  }

  function updateHostedIntake() {
    if (!hostedUrl || !hostedAppType || !hostedBudget || !hostedVisibility || !hostedAuthNotes || !hostedConsent || !hostedCommand || !hostedCopy || !hostedPacket || !hostedDomainProof) return;
    const url = hostedUrl.value.trim() || "https://your-app.example";
    const families = selectedFamilies();
    const familyArg = families.length ? ` --families ${shellQuote(families.join(","))}` : "";
    const consentArg = hostedConsent.checked ? " --consent" : "";
    const commandText = [
      "npx proofloop hosted intake",
      `--url ${shellQuote(url)}`,
      `--app-type ${hostedAppType.value}`,
      `--budget-usd ${hostedBudget.value || "0"}`,
      `--visibility ${hostedVisibility.value}`,
      familyArg.trim(),
      consentArg.trim(),
    ].filter(Boolean).join(" ");
    hostedCommand.textContent = commandText;
    hostedCopy.setAttribute("data-copy", commandText);
    hostedDomainProof.textContent = domainProofFor(url);
    hostedPacket.textContent = JSON.stringify(hostedPayload(), null, 2);
  }

  function hostedPayload() {
    const url = hostedUrl.value.trim() || "https://your-app.example";
    const families = selectedFamilies();
    return {
      targetUrl: url,
      appType: hostedAppType.value,
      authMode: hostedAuthNotes.value.trim() ? "manual-login" : "none",
      authNotes: hostedAuthNotes.value.trim(),
      authNotesPolicy: "notes only; no raw passwords, API keys, or production secrets",
      modelBudgetUsd: Number(hostedBudget.value || 0),
      requestedBenchmarkFamilies: families,
      consent: {
        accepted: hostedConsent.checked,
        ownsOrAuthorized: hostedConsent.checked,
        allowBrowserAutomation: hostedConsent.checked,
        allowRecording: hostedConsent.checked,
      },
      visibility: hostedVisibility.value,
      worker: "external-managed-worker",
      artifacts: ["receipt", "screenshot", "video", "trace", "scorecard", "dashboard"],
    };
  }

  function setHostedStatus(kind, message, detail) {
    if (!hostedStatus) return;
    hostedStatus.hidden = false;
    hostedStatus.setAttribute("data-kind", kind);
    const safeDetail = detail ? `<pre>${escapeHtml(JSON.stringify(detail, null, 2))}</pre>` : "";
    hostedStatus.innerHTML = `<strong>${escapeHtml(message)}</strong>${safeDetail}`;
  }

  async function submitHostedRun() {
    if (!hostedSubmit) return;
    hostedSubmit.disabled = true;
    setHostedStatus("pending", "Submitting hosted run...");
    try {
      const response = await fetch("/api/hosted/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(hostedPayload()),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        setHostedStatus("blocked", data.status || data.error || "Run blocked", data);
        return;
      }
      setHostedStatus("queued", `Queued ${data.runId}. Polling worker status...`, data);
      await pollHostedStatus(data.runId, 8);
    } catch (error) {
      setHostedStatus("blocked", "Submit failed", { error: String(error && error.message ? error.message : error) });
    } finally {
      hostedSubmit.disabled = false;
    }
  }

  async function pollHostedStatus(runId, attempts) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 1800 : 5000));
      const response = await fetch(`/api/hosted/status?runId=${encodeURIComponent(runId)}`);
      const data = await response.json();
      if (!response.ok || !data.ok) {
        setHostedStatus("blocked", "Status lookup failed", data);
        return;
      }
      setHostedStatus(data.conclusion || data.status, `Worker status: ${data.status}${data.conclusion ? ` / ${data.conclusion}` : ""}`, data);
      if (data.status === "completed") return;
    }
  }

  function escapeHtml(value) {
    return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  if (hostedUrl) {
    [hostedUrl, hostedAppType, hostedBudget, hostedVisibility, hostedAuthNotes, hostedConsent, ...hostedFamilies].forEach((item) => {
      if (!item) return;
      item.addEventListener("input", updateHostedIntake);
      item.addEventListener("change", updateHostedIntake);
    });
    if (hostedSubmit) hostedSubmit.addEventListener("click", submitHostedRun);
    updateHostedIntake();
  }
})();
