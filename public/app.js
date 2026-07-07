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
})();
