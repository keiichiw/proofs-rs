import type { Env } from "./core";
export async function socialImage(
  env: Env,
  request: Request,
): Promise<Response> {
  const match = /^\/og\/report\/([1-9]\d*)\/([1-9]\d*)\.png$/.exec(
    new URL(request.url).pathname,
  );
  if (
    !match ||
    !Number.isSafeInteger(Number(match[1])) ||
    !Number.isSafeInteger(Number(match[2]))
  )
    return new Response("Not found", { status: 404 });
  const item = await env.DB.prepare(
    `SELECT rr.title,p.withdrawn_at,cr.name crate,rel.version,t.name tool FROM reports p JOIN report_revisions rr ON rr.report_id=p.id JOIN releases rel ON rel.id=p.release_id JOIN crates cr ON cr.id=rel.crate_id JOIN tool_versions tv ON tv.id=rr.tool_version_id JOIN tools t ON t.id=tv.tool_id WHERE p.id=? AND rr.revision_no=? AND p.visibility='public'`,
  )
    .bind(Number(match[1]), Number(match[2]))
    .first<any>();
  if (!item)
    return new Response("Not found", {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  return renderSocialImage(env, request, {
    title: item.title,
    label: "Rust API Verification Report",
    corner: `Report #${match[1]} · Revision ${match[2]}`,
    context: `${item.crate} ${item.version}`,
    footer: `${item.withdrawn_at ? "Withdrawn · " : ""}${item.tool}`,
  });
}
export type ImageCard = {
  title: string;
  label: string;
  corner: string;
  context: string;
  footer: string;
  layout?: "home";
};
export async function renderSocialImage(
  env: Env,
  request: Request,
  card: ImageCard,
): Promise<Response> {
  try {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify(["v9", card])),
    );
    const key = new Request(
      new URL(
        "/og-cache/" +
          Array.from(new Uint8Array(digest), (x) =>
            x.toString(16).padStart(2, "0"),
          ).join(""),
        env.APP_ORIGIN,
      ),
    );
    const cache =
      typeof caches === "undefined"
        ? undefined
        : await caches.open("report-og-v1");
    let response = await cache?.match(key);
    if (!response) {
      const font = await env.ASSETS.fetch(
        new Request(new URL("/og-fonts/NotoSansJP.otf", request.url)),
      );
      const brandFont = await env.ASSETS.fetch(
        new Request(new URL("/og-fonts/FiraSans-Medium.ttf", request.url)),
      );
      if (!font.ok || !brandFont.ok) throw new Error("font unavailable");
      const shorten = (value: string, limit: number) => {
        const chars = Array.from(value);
        return chars.length > limit
          ? chars.slice(0, limit - 1).join("") + "…"
          : value;
      };
      const title = shorten(card.title, 90);
      const { ImageResponse } = await import("workers-og");
      // Structured text nodes keep Rust generic syntax literal without HTML entity artifacts.
      const node = (
        style: Record<string, string | number>,
        children: unknown,
      ) => ({
        type: "div",
        props: { style: { display: "flex", ...style }, children },
      });
      const element =
        card.layout === "home"
          ? node(
              {
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                width: 1200,
                height: 630,
                padding: 60,
                background: "white",
                borderTop: "14px solid #3873ad",
                fontFamily: "Noto",
              },
              [
                node(
                  {
                    fontFamily: "Fira Sans",
                    fontWeight: 500,
                    fontSize: 154,
                    letterSpacing: -1.4,
                    color: "#000",
                  },
                  "proofs.rs",
                ),
                node(
                  {
                    fontSize: 32,
                    color: "#3873ad",
                    marginTop: 30,
                    width: 1080,
                    justifyContent: "center",
                    textAlign: "center",
                  },
                  card.label,
                ),
              ],
            )
          : node(
              {
                flexDirection: "column",
                width: 1200,
                height: 630,
                background: "white",
                color: "#182632",
                padding: 60,
                borderTop: "14px solid #3873ad",
                fontFamily: "Noto",
              },
              [
                node(
                  { alignItems: "center", justifyContent: "space-between" },
                  [
                    node(
                      {
                        fontFamily: "Fira Sans",
                        fontWeight: 500,
                        fontSize: 56,
                        letterSpacing: -0.5,
                        color: "#000",
                      },
                      "proofs.rs",
                    ),
                    node({ fontSize: 24, color: "#5d6670" }, card.corner),
                  ],
                ),
                node(
                  { fontSize: 24, color: "#3873ad", marginTop: 18 },
                  card.label,
                ),
                node(
                  { fontSize: 30, marginTop: 20 },
                  shorten(card.context, 60),
                ),
                node(
                  {
                    fontSize: card.title.length > 75 ? 40 : 48,
                    width: 1080,
                    lineHeight: 1.2,
                    marginTop: 25,
                    overflow: "hidden",
                    height: 180,
                    wordBreak: "break-word",
                  },
                  title,
                ),
                node(
                  { fontSize: 26, marginTop: 30, width: 1080 },
                  shorten(card.footer, 72),
                ),
              ],
            );
      response = new ImageResponse(element, {
        width: 1200,
        height: 630,
        fonts: [
          {
            name: "Fira Sans",
            data: await brandFont.arrayBuffer(),
            weight: 500,
            style: "normal",
          },
          {
            name: "Noto",
            data: await font.arrayBuffer(),
            weight: 400,
            style: "normal",
          },
        ],
      });
      response = new Response(await response.arrayBuffer(), {
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "public, max-age=86400",
        },
      });
      await cache?.put(key, response.clone());
    }
    const result = new Response(
      request.method === "HEAD" ? null : response.body,
      response,
    );
    result.headers.set("Cache-Control", "public, max-age=0, must-revalidate");
    return result;
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "report_og_failed",
        message: error instanceof Error ? error.message : String(error),
        path: new URL(request.url).pathname,
      }),
    );
    return new Response("Image temporarily unavailable", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
