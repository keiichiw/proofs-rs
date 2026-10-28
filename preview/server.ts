import { createServer } from "node:http";
import { createInterface } from "node:readline";
import { previewPage, renderPreview, type Snapshot } from "./render";
import { draftBanner } from "./draft";

declare const PREVIEW_ASSETS: Record<string, { type: string; content: string }>;
const version = 1;
const draftMode = process.argv[3] === "draft";
const send = (message: object) =>
  process.stdout.write(JSON.stringify({ version, ...message }) + "\n");
const pending = new Map<
  number,
  { resolve: (data: Snapshot) => void; reject: (error: Error) => void }
>();
let nextId = 0;
function snapshot(): Promise<Snapshot> {
  // Coalesce concurrent browser requests; Rust serializes projections.
  if (inflight) return inflight;
  const id = ++nextId;
  inflight = new Promise<Snapshot>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    send({ type: "snapshot", id });
  }).finally(() => {
    inflight = undefined;
  });
  return inflight;
}
let inflight: Promise<Snapshot> | undefined;
const input = createInterface({ input: process.stdin });
input.on("line", (line) => {
  try {
    const response = JSON.parse(line);
    if (response.version !== version)
      throw new Error("Unsupported preview protocol");
    const request = pending.get(response.id);
    if (!request) throw new Error("Unknown preview request");
    pending.delete(response.id);
    if (typeof response.error === "string")
      request.reject(new Error(response.error));
    else request.resolve(response.data);
  } catch (error) {
    fail(error);
  }
});
input.on("close", () => process.exit());
function fail(error: unknown) {
  send({
    type: "error",
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
  server.close();
  input.close();
}
let origin = "";
const server = createServer(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  const reply = (
    status: number,
    content: string,
    type = "text/html; charset=utf-8",
  ) => {
    res.writeHead(status, { "Content-Type": type });
    res.end(req.method === "HEAD" ? undefined : content);
  };
  if (
    req.headers.host !== new URL(origin).host ||
    (req.headers.origin && req.headers.origin !== origin) ||
    req.headers["sec-fetch-site"] === "cross-site"
  ) {
    reply(403, "Forbidden", "text/plain");
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    reply(405, "Method not allowed", "text/plain");
    return;
  }
  try {
    if (!req.url?.startsWith("/") || req.url.startsWith("//")) {
      reply(400, "Invalid path", "text/plain");
      return;
    }
    const path = new URL(req.url, origin).pathname;
    const asset = Object.hasOwn(PREVIEW_ASSETS, path)
      ? PREVIEW_ASSETS[path]
      : undefined;
    if (asset) {
      reply(200, asset.content, asset.type);
      return;
    }
    if (!(
      path === "/" ||
      path === "/report" ||
      /^\/claim\/[^/]+$/.test(path) ||
      /^\/finding\/[^/]+$/.test(path) ||
      /^\/runs\/[^/]+$/.test(path) ||
      /^\/api\/v1\/runs\/[^/]+\/sarif$/.test(path)
    )) {
      reply(
        404,
        previewPage(
          "Not found",
          (draftMode ? draftBanner : "") +
            '<h1>Page not found</h1><a href="/report">Return to report</a>',
          "",
        ),
      );
      return;
    }
    const data = await snapshot();
    if (
      data.mode === "draft" &&
      (path.startsWith("/runs/") || path.startsWith("/api/v1/runs/"))
    ) {
      reply(404, "No recorded run in an unverified draft", "text/plain");
      return;
    }
    if (path.startsWith("/api/v1/runs/")) {
      if (
        path !==
        `/api/v1/runs/${encodeURIComponent(data.report.run_ids[0])}/sarif`
      ) {
        reply(404, "Run not found", "text/plain");
        return;
      }
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="run.sarif.json"',
      );
      reply(200, JSON.stringify(data.sarif), "application/json");
      return;
    }
    const page = renderPreview(data, path);
    reply(page.status, page.html);
  } catch (error) {
    const message = String(
      error instanceof Error ? error.message : error,
    ).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c]!,
    );
    reply(
      500,
      previewPage(
        "Preview error",
        (draftMode ? draftBanner : "") +
          `<h1>Unable to load preview</h1><pre>${message}</pre><p>Correct the input and reload this page.</p>`,
        "",
      ),
    );
  }
});
server.on("error", fail);
server.listen(Number(process.argv[2] ?? 0), "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string")
    return fail(new Error("Missing server address"));
  origin = `http://127.0.0.1:${address.port}`;
  send({ type: "ready", url: origin + "/report" });
});
// The Rust parent owns shutdown and temporary-file cleanup, including Ctrl+C.
process.on("SIGINT", () => {});
