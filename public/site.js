// Previously shared hash URLs need a browser redirect: fragments never reach the server.
(() => {
  if (location.pathname === "/" && location.hash.startsWith("#/")) {
    const url = new URL(location.hash.slice(1), location.origin);
    if (url.origin === location.origin)
      location.replace(url.pathname + url.search + url.hash);
  }
  for (const share of document.querySelectorAll("[data-report-share]")) {
    const help = share.querySelector("[data-share-help]");
    const text = share.querySelector("textarea");
    const status = share.querySelector("[data-share-status]");
    share
      .querySelector("[data-share-bluesky]")
      .addEventListener("click", () => {
        help.hidden = false;
      });
    share
      .querySelector("[data-copy-share]")
      .addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(text.value);
          status.textContent = " Copied";
        } catch {
          share.querySelector("[data-share-manual]").hidden = false;
          text.focus();
          text.select();
          status.textContent = " Selected — use your browser’s Copy command";
        }
      });
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
  // Narrow the crate API catalogue in place; without JS every API stays listed.
  for (const form of document.querySelectorAll("form[data-api-filter]")) {
    const text = form.querySelector('input[type="search"]');
    const claimed = form.querySelector('input[name="claimed"]');
    const found = form.querySelector('input[name="found"]');
    const status = form.querySelector('[role="status"]');
    const rows = [...document.querySelectorAll("[data-api-path]")];
    const groups = [
      ...document.querySelectorAll(".api-impl, .api-family, .api-category"),
    ];
    const apply = () => {
      const q = text.value.trim().toLowerCase();
      let shown = 0;
      for (const row of rows) {
        row.hidden =
          (q && !row.dataset.apiPath.toLowerCase().includes(q)) ||
          (claimed.checked && row.dataset.claims === "0") ||
          (found.checked && row.dataset.findings === "0");
        if (!row.hidden) shown++;
      }
      const active = q || claimed.checked || found.checked;
      for (const group of groups)
        group.hidden =
          active && !group.querySelector("[data-api-path]:not([hidden])");
      status.textContent = active ? ` ${shown} of ${rows.length} shown` : "";
    };
    form.addEventListener("submit", (e) => e.preventDefault());
    text.addEventListener("input", apply);
    claimed.addEventListener("change", apply);
    found.addEventListener("change", apply);
    form.hidden = false;
  }
})();
