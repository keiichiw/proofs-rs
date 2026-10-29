import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { pageLayout } from "../web/page-layout";
test("social metadata escapes titles and is absent from preview", () => {
  const meta = {
    title: '日本語 <report> & "test"',
    description: "Description & evidence",
    url: "https://proofs.rs/report/1?v=2",
    image: "https://proofs.rs/og/report/1/2.png",
    alt: "Report",
  };
  const doc = new JSDOM(
    pageLayout("Report", "", "", meta.url, undefined, false, meta),
  ).window.document;
  assert.equal(
    doc.querySelector('meta[property="og:title"]')?.getAttribute("content"),
    meta.title,
  );
  assert.equal(
    doc.querySelector('meta[name="description"]')?.getAttribute("content"),
    meta.description,
  );
  assert.equal(
    doc.querySelector('meta[property="og:url"]')?.getAttribute("content"),
    meta.url,
  );
  assert.equal(
    doc.querySelector('meta[name="twitter:card"]')?.getAttribute("content"),
    "summary_large_image",
  );
  assert.equal(
    new JSDOM(
      pageLayout("Preview", "", "", null, undefined, true, meta),
    ).window.document.querySelector('meta[property="og:title"]'),
    null,
  );
});

import {
  resolveSocialCard,
  cardMetadata,
  socialText,
} from "../src/social-card";
test("public cards use page types, strip action parameters and pin revisions", async () => {
  const origin = "https://proofs.rs";
  const home = await resolveSocialCard(
    new URL("/?edit=private", origin),
    async () => assert.fail("static card must not fetch"),
  );
  assert.equal(home!.path, "/");
  assert.equal(cardMetadata(home!, origin).type, "website");
  assert.equal(
    await resolveSocialCard(new URL("/account", origin), async () =>
      assert.fail("private path"),
    ),
    null,
  );
  assert.equal(
    await resolveSocialCard(new URL("/og/page.png", origin), async () =>
      assert.fail("recursive path"),
    ),
    null,
  );
  const claim = await resolveSocialCard(
    new URL("/claim/id?report_revision=2&edit=1", origin),
    async (path) => {
      assert.equal(path, "/claims/id?report_revision=2");
      return {
        title: "A < B & 日本語",
        explanation: "**Proof** of `x` & y",
        report_revision: 2,
        crate: "example",
        version: "1.0",
        tool: "Kani",
        display_path: "example::x",
      };
    },
  );
  assert.equal(claim!.path, "/claim/id?report_revision=2");
  assert.equal(claim!.description, "Proof of x & y");
  assert.equal(claim!.type, "article");
  const crate = await resolveSocialCard(
    new URL("/crate/example?version=1.0&reply=secret", origin),
    async () => ({
      default_version: "2.0",
      items: [{ version: "1.0" }, { version: "2.0" }],
    }),
  );
  assert.equal(crate!.path, "/crate/example?version=1.0");
  assert.equal(
    await resolveSocialCard(
      new URL("/crate/example?version=missing", origin),
      async () => ({ items: [] }),
    ),
    null,
  );
  const finding = await resolveSocialCard(
    new URL("/finding/id?edit=1", origin),
    async () => ({
      title: "Finding",
      body: "**Details**",
      withdrawn_at: "today",
      crate: "example",
      version: "1",
      validity: "confirmed",
      upstream_status: "fix_merged",
    }),
  );
  assert.match(finding!.title, /Withdrawn/);
  assert.match(finding!.footer, /confirmed.*fix merged/);
  assert.equal(socialText("a".repeat(200)).length, 160);
});

import { reportShare } from "../web/report-share";
test("report shares include proofs.rs and pin the shown revision", () => {
  const url = "https://proofs.rs/report/9?v=2";
  const title = "日本語 & ".repeat(40);
  const doc = new JSDOM(reportShare(title, url, false)).window.document;
  const links = [...doc.querySelectorAll<HTMLAnchorElement>("nav a")];
  assert.deepEqual(
    links.map((a) => a.textContent),
    ["X", "Bluesky"],
  );
  const x = new URL(links[0].href);
  const bluesky = new URL(links[1].href);
  assert.equal(x.searchParams.get("url"), url);
  const text = x.searchParams.get("text")!;
  assert.ok(text.endsWith("… · proofs.rs"));
  assert.equal(Array.from(text).length, 162);
  assert.equal(bluesky.searchParams.get("text"), `${text}\n${url}`);
  assert.equal(
    doc.querySelectorAll('img[alt=""][aria-hidden="true"]').length,
    2,
  );
  assert.equal(doc.querySelector("button"), null);
  assert.equal(reportShare(title, url, true), "");
});
