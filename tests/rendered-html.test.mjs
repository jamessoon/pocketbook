import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("renders the Pocketbook expense tracker", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );

  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Pocketbook/);
  assert.match(html, /Family expense tracker/i);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/);
});

test("includes a GitHub Pages entry point and deployment workflow", async () => {
  const [html, workflow] = await Promise.all([
    readFile(new URL("../github-pages/index.html", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/deploy-pages.yml", import.meta.url), "utf8"),
  ]);
  assert.match(html, /Pocketbook/);
  assert.match(workflow, /upload-pages-artifact/);
  assert.match(workflow, /dist-pages/);
});
