// This entrypoint is used only by wrangler.local.json. Production imports none
// of the demo authentication or fixture code.
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { app as site } from "../src/worker";
import { hash, random, type App, type Env } from "../src/core";
import { pageLayout } from "../web/page-layout";
import { demoUsers, demoScenarios } from "./scenarios";

const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
function returnTo(value: unknown) {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\r\n]/.test(value)
  )
    return "/__demo";
  const url = new URL(value, "http://local");
  return url.origin === "http://local" && !url.pathname.startsWith("/auth/")
    ? url.pathname + url.search + url.hash
    : "/__demo";
}
const demo = new Hono<App>();
demo.use("*", async (c, next) => {
  const url = new URL(c.req.url);
  if (
    c.env.ENVIRONMENT !== "local-demo" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
  )
    return c.text("Local demo is only available on loopback.", 403);
  await next();
  c.header("Cache-Control", "no-store");
  c.header("X-Robots-Tag", "noindex, nofollow");
  c.header("X-Content-Type-Options", "nosniff");
  c.header(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  );
});
demo.use("/__demo/*", bodyLimit({ maxSize: 4096 }));
demo.get("/__demo", async (c) => {
  const session = await site.fetch(
    new Request(new URL("/api/v1/me", c.req.url), {
      headers: { Cookie: c.req.header("cookie") || "" },
    }),
    c.env,
    c.executionCtx,
  );
  const me = await session.json<{ user: { username: string } | null }>();
  const back = returnTo(c.req.query("return_to"));
  const layouts = await c.env.DB.prepare(
    "SELECT id,create_key FROM reports WHERE create_key IN ('staging-layout-v1-full','staging-layout-v1-minimal','staging-layout-v1-withdrawn')",
  ).all<{ id: number; create_key: string }>();
  const scenarios: readonly (readonly [string, string])[] = [
    ...demoScenarios,
    ...layouts.results.map((r): [string, string] => [
      `Layout · ${r.create_key.replace("staging-layout-v1-", "")}`,
      `/report/${r.id}`,
    ]),
  ];
  return c.html(
    pageLayout(
      "Local demo",
      `<h1>Local UI demo</h1><p role="status"><strong>Synthetic data. No verification was performed.</strong></p><p>Current user: <strong>${escape(me.user?.username || "Logged out")}</strong></p><form method="post" action="/__demo/session"><input type="hidden" name="return_to" value="${escape(back)}"><label>View as <select name="user"><option value="">Logged out</option>${Object.entries(
        demoUsers,
      )
        .map(
          ([key, user]) =>
            `<option value="${key}">${escape(user.label)}</option>`,
        )
        .join(
          "",
        )}</select></label> <button>Switch user</button></form><h2>Scenarios</h2><ul>${scenarios.map(([name, path]) => `<li><a href="${escape(path)}">${escape(name)}</a></li>`).join("")}</ul><p>Edits survive restart. Stop the server and run <code>npm run demo:reset</code> to restore the fixture.</p><p>GitHub OAuth, new crate imports, email, and verification execution are unavailable. External links require a network connection.</p>`,
      "",
      null,
    ),
  );
});
demo.post("/__demo/session", async (c) => {
  if (c.req.header("origin") !== new URL(c.req.url).origin)
    return c.text("Same-origin POST required.", 403);
  const form = await c.req.parseBody();
  const key = String(form.user || "");
  if (key && key !== "author" && key !== "other")
    return c.text("Unknown demo user.", 400);
  const old = getCookie(c, "proofsr_session");
  if (old)
    await c.env.DB.prepare("DELETE FROM sessions WHERE token_hash=?")
      .bind(await hash(old))
      .run();
  deleteCookie(c, "proofsr_session", { path: "/" });
  if (key === "author" || key === "other") {
    const token = random();
    await c.env.DB.prepare(
      "INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES(?,?,?,?)",
    )
      .bind(
        await hash(token),
        demoUsers[key].id,
        random(),
        new Date(Date.now() + 86400000).toISOString(),
      )
      .run();
    setCookie(c, "proofsr_session", token, {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      maxAge: 86400,
    });
  }
  return c.redirect(returnTo(form.return_to), 303);
});
demo.get("/login", (c) =>
  c.redirect(
    `/__demo?return_to=${encodeURIComponent(returnTo(c.req.query("return_to")))}`,
    302,
  ),
);
demo.all("/auth/*", (c) =>
  c.req.path === "/auth/logout"
    ? site.fetch(c.req.raw, c.env, c.executionCtx)
    : c.redirect(
        `/__demo?return_to=${encodeURIComponent(returnTo(c.req.query("return_to")))}`,
        302,
      ),
);
demo.all("/api/v1/publish/prepare", (c) =>
  c.json(
    {
      error: "demo_import_unavailable",
      message: "Use an existing demo release; external imports are disabled.",
    },
    503,
  ),
);
demo.get("/book", (c) => c.redirect("/book/", 302));
demo.get("/book/*", (c) => c.env.ASSETS.fetch(c.req.raw));
demo.all("*", async (c) => {
  const response = await site.fetch(c.req.raw, c.env, c.executionCtx);
  if (!response.headers.get("content-type")?.includes("text/html"))
    return response;
  const back = c.req.path + new URL(c.req.url).search;
  return new HTMLRewriter()
    .on("main", {
      element(el) {
        el.prepend(
          `<p class="meta" data-demo-banner><strong>Local demo · synthetic data</strong> · <a href="/__demo?return_to=${encodeURIComponent(back)}">Scenarios / switch user</a></p>`,
          { html: true },
        );
      },
    })
    .transform(response);
});
export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    // Ignore credentials and deployment settings that might exist in .dev.vars.
    // There is no queue binding, scheduled handler, or external import handler.
    return demo.fetch(
      request,
      {
        ...env,
        EXTERNAL_FETCH_DISABLED: "true",
        EMAIL_DISABLED: "true",
        ADMIN_GITHUB_IDS: "",
        GITHUB_CLIENT_ID: "",
        GITHUB_CLIENT_SECRET: undefined,
      },
      ctx,
    );
  },
};
