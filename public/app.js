(function () {
  const form = document.querySelector("[data-proofloop-intake]");
  const preview = document.querySelector("[data-proofloop-preview]");
  const status = document.querySelector("[data-proofloop-status]");
  const modeLabel = document.querySelector("[data-proofloop-mode]");

  if (!form || !preview || !status || !modeLabel) return;

  function value(name) {
    const field = form.elements.namedItem(name);
    if (!field) return "";
    if (field instanceof RadioNodeList) return field.value;
    return "value" in field ? String(field.value).trim() : "";
  }

  function families() {
    return value("families")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function requestPayload() {
    const budget = Number(value("budget") || "0");
    return {
      schema: "proofloop-live-intake-v1",
      mode: value("mode") || "live-url",
      target: value("target"),
      benchmarkFamilies: families(),
      budgetUsd: Number.isFinite(budget) ? budget : 0,
      contact: value("contact"),
      notes: value("notes"),
      requestedArtifacts: [
        "live-browser-trace",
        "agent-harness-ledger",
        "scorecard",
        "cost-ledger",
        "verifier-receipt",
      ],
      honestyBoundary:
        "Product-path proof, proxy benchmark proof, and official scorer output must be labeled separately.",
    };
  }

  function render() {
    const payload = requestPayload();
    modeLabel.textContent = payload.mode;
    preview.textContent = JSON.stringify(payload, null, 2);
    status.textContent = payload.target
      ? "Request preview ready. Prepare request opens an email draft."
      : "Fill in the target to generate a request.";
    return payload;
  }

  async function copyPayload(text) {
    if (!navigator.clipboard || !window.isSecureContext) return false;
    await navigator.clipboard.writeText(text);
    return true;
  }

  form.addEventListener("input", render);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = render();
    if (!payload.target) {
      status.textContent = "Add a live URL or repository target first.";
      return;
    }

    const text = JSON.stringify(payload, null, 2);
    let copied = false;
    try {
      copied = await copyPayload(text);
    } catch {
      copied = false;
    }

    const subject = encodeURIComponent(`ProofLoop Live run request: ${payload.target}`);
    const body = encodeURIComponent(text);
    status.textContent = copied
      ? "Request copied. Opening email draft."
      : "Opening email draft with the run request.";
    window.location.href = `mailto:hshum2018@gmail.com?subject=${subject}&body=${body}`;
  });

  render();
})();
