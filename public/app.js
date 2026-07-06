(function () {
  document.querySelectorAll("[data-copy]").forEach((btn) => {
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
  });
})();
