// Internal preview override; keep ordinary navigation and forms unchanged.
(() => {
  const requested = new URL(location.href).searchParams.get("theme");
  let theme = requested === "base" || requested === "a" ? requested : null;
  try {
    if (theme) sessionStorage.setItem("proofs-theme", theme);
    else theme = sessionStorage.getItem("proofs-theme");
  } catch {
    // Explicit URL selection still works when browser storage is unavailable.
  }
  document.documentElement.dataset.theme = theme === "base" ? "base" : "a";
})();
