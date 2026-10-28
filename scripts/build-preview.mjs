import { build } from "esbuild";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assets = {};
for (const name of [
  "style.css",
  "theme-a.css",
  "theme-header.css",
  "fonts.css",
  "theme.js",
  "site.js",
  "favicon.svg",
]) {
  assets["/" + name] = {
    type: name.endsWith(".css")
      ? "text/css; charset=utf-8"
      : name.endsWith(".svg")
        ? "image/svg+xml"
        : "text/javascript; charset=utf-8",
    content: await readFile(path.join(root, "public", name), "utf8"),
  };
}
const fontDirectory = path.join(root, "public/fonts");
const fontFiles = (await readdir(fontDirectory)).sort();
for (const name of fontFiles) {
  const binary = name.endsWith(".woff2");
  assets["/fonts/" + name] = {
    type: binary ? "font/woff2" : "text/plain; charset=utf-8",
    content: (await readFile(path.join(fontDirectory, name))).toString(
      binary ? "base64" : "utf8",
    ),
    ...(binary ? { encoding: "base64" } : {}),
  };
}
const result = await build({
  absWorkingDir: root,
  entryPoints: ["preview/server.ts"],
  bundle: true,
  platform: "node",
  target: "node24",
  format: "cjs",
  write: false,
  minify: true,
  legalComments: "inline",
  metafile: true,
  define: { PREVIEW_ASSETS: JSON.stringify(assets) },
});
// Include license texts for every bundled third-party package, including transitive dependencies.
const packages = new Set();
for (const input of Object.keys(result.metafile.inputs)) {
  if (!input.includes("node_modules/")) continue;
  let directory = path.dirname(path.resolve(root, input));
  while (directory !== root) {
    try {
      const pkg = JSON.parse(
        await readFile(path.join(directory, "package.json"), "utf8"),
      );
      if (pkg.name) {
        packages.add(directory);
        break;
      }
    } catch {}
    directory = path.dirname(directory);
  }
}
let notices = "Third-party packages bundled into the local preview server\n\n";
for (const name of fontFiles.filter((name) => name.includes("LICENSE"))) {
  notices += `\n=== fonts/${name} ===\n`;
  notices += (await readFile(path.join(fontDirectory, name), "utf8")) + "\n";
}
for (const directory of [...packages].sort()) {
  const metadata = JSON.parse(
    await readFile(path.join(directory, "package.json"), "utf8"),
  );
  notices += `\n=== ${metadata.name} ${metadata.version} (${metadata.license ?? "see license below"}) ===\n`;
  const files = (await readdir(directory))
    .filter((n) => /^(licen[sc]e|copying|notice)([.-]|$)/i.test(n))
    .sort();
  if (!files.length) throw new Error(`No license text for ${metadata.name}`);
  for (const name of files)
    notices += (await readFile(path.join(directory, name), "utf8")) + "\n";
}
notices = notices.replace(/[ \t]+$/gm, "").trimEnd() + "\n";
await mkdir(path.join(root, "cli/preview"), { recursive: true });
for (const [name, content] of [
  ["server.cjs", result.outputFiles[0].text],
  ["THIRD_PARTY_NOTICES.txt", notices],
]) {
  const output = path.join(root, "cli/preview", name);
  if (process.argv.includes("--check")) {
    if ((await readFile(output, "utf8")) !== content)
      throw new Error(`${name} is stale; run npm run build:preview`);
  } else await writeFile(output, content);
}
