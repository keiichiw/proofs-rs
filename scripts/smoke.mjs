const origin = process.argv[2];
const environment = process.argv[3] || "staging";
if (!origin?.startsWith("https://")) throw Error("Expected HTTPS URL");
for (const path of [
  "/",
  "/api/docs",
  "/tools",
  "/tool/aeneas",
  "/book/aeneas.html",
  "/book/review-a-dependency.html",
  "/openapi.json",
  "/api/v1/health",
  "/api/v1/home",
  "/api/v1/reports",
  "/api/v1/crates",
  "/api/v1/tools",
  "/api/v1/me",
  "/api/v1/config",
]) {
  let r;
  for (let attempt = 0; attempt < 6; attempt++) {
    r = await fetch(origin + path);
    if (r.ok || ![404, 502, 503, 504].includes(r.status)) break;
    if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  if (!r.ok) throw Error(path + " returned " + r.status);
  if (
    environment === "staging" &&
    !r.headers.get("x-robots-tag")?.includes("noindex")
  )
    throw Error("Missing staging noindex header");
  if (path === "/api/v1/tools") {
    const catalogue = await r.json();
    if (
      !catalogue.items.some((t) => t.id === "aeneas") ||
      !catalogue.versions.some(
        (v) =>
          v.tool_id === "aeneas" &&
          /^[a-f0-9]{40}$/.test(v.version) &&
          v.limitations,
      )
    )
      throw Error("Aeneas tool or registered pinned revision missing");
  }
  if (path === "/tool/aeneas") {
    const html = await r.text();
    if (!html.includes('href="/book/aeneas.html"'))
      throw Error("Aeneas tool setup guide link missing");
  }
  if (path === "/book/aeneas.html") {
    const html = await r.text();
    if (
      !html.includes("Publish Aeneas Lean proofs") ||
      !html.includes("tool.proofs")
    )
      throw Error("Aeneas tutorial heading or proof configuration missing");
  }
  if (path === "/book/review-a-dependency.html") {
    const html = await r.text();
    if (
      !html.includes("Review a dependency") ||
      !html.includes('href="publish-a-report.html"')
    )
      throw Error("Dependency tutorial heading or publishing link missing");
  }
  if (path === "/openapi.json" && (await r.json()).openapi !== "3.1.0")
    throw Error("Invalid OpenAPI document");
  if (path === "/api/v1/config") {
    const config = await r.json();
    if (config.environment !== environment)
      throw Error("Wrong deployment environment");
    if (
      environment === "production" &&
      origin === "https://proofs.rs" &&
      !config.oauth_configured
    )
      throw Error("Production OAuth is unavailable");
    console.log(
      "Integration configuration: OAuth=" +
        config.oauth_configured +
        ", email=" +
        config.email_configured,
    );
  }
  console.log("OK " + path);
}
