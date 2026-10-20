// Previously shared hash URLs need a browser redirect: fragments never reach the server.
(() => {
  if (location.pathname === "/" && location.hash.startsWith("#/")) {
    const url = new URL(location.hash.slice(1), location.origin);
    if (url.origin === location.origin)
      location.replace(url.pathname + url.search + url.hash);
  }
  for (const button of document.querySelectorAll("button[data-copy-formal]")) {
    button.addEventListener("click", async () => {
      const details = button.closest("details");
      const code = details.querySelector("code");
      const status = details.querySelector("[data-copy-status]");
      try {
        await navigator.clipboard.writeText(code.textContent);
        status.textContent = " Copied";
      } catch {
        const range = document.createRange();
        range.selectNodeContents(code);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        status.textContent = " Selected — use your browser’s Copy command";
      }
    });
  }
  for (const form of document.querySelectorAll("form[data-version-selector]")) {
    form
      .querySelector('select[name="version"]')
      .addEventListener("change", () => {
        form.requestSubmit();
      });
  }
})();
