// Without a saved choice, start open on wide screens (mdBook's 1080px
// breakpoint) and closed otherwise; restore the user's choice on later pages.
(() => {
  const root = document.documentElement;
  root.classList.add("js");
  const checkbox = document.getElementById("sidebar-toggle-anchor");
  let visible = window.innerWidth >= 1080;
  try {
    const saved = localStorage.getItem("mdbook-sidebar");
    if (saved === "visible" || saved === "hidden")
      visible = saved === "visible";
  } catch {}
  function update() {
    checkbox.checked = visible;
    root.classList.toggle("sidebar-visible", visible);
    root.classList.toggle("sidebar-hidden", !visible);
    const sidebar = document.getElementById("sidebar");
    if (sidebar) {
      sidebar.inert = !visible;
      sidebar.setAttribute("aria-hidden", String(!visible));
    }
    document
      .getElementById("sidebar-toggle")
      ?.setAttribute("aria-expanded", String(visible));
  }
  update();
  document.addEventListener("DOMContentLoaded", () => {
    update();
    const toggle = document.getElementById("sidebar-toggle");
    toggle.addEventListener("click", () => {
      visible = !visible;
      update();
      try {
        localStorage.setItem("mdbook-sidebar", visible ? "visible" : "hidden");
      } catch {}
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && visible) {
        visible = false;
        update();
        toggle.focus();
        try {
          localStorage.setItem("mdbook-sidebar", "hidden");
        } catch {}
      }
    });
  });
})();
