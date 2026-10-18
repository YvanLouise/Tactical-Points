import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, copyFile, readFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { request } from "node:http";
import { createLocalServer } from "../server.mjs";
import { fields, validateContent } from "../content/schema.mjs";
import { createContentStore } from "../content/store.mjs";

const source = fileURLToPath(new URL("../", import.meta.url));
async function fixture(t, publisherFactory) {
  const root = await mkdtemp(path.join(tmpdir(), "shudian-editor-"));
  for (const folder of ["dist", "content", "editor"]) await mkdir(path.join(root, folder));
  for (const file of ["dist/content.json", "dist/index.html", "content/original.json", "template.html", "editor/index.html"]) await copyFile(path.join(source, file), path.join(root, file));
  const server = await createLocalServer({ root, port: 0, publisherFactory });
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const state = await (await fetch(`${origin}/api/editor/content`)).json();
  const put = (content, revision = state.revision, headers = {}) => fetch(`${origin}/api/editor/content`, {
    method: "PUT", headers: { Origin: origin, "Content-Type": "application/json", "X-Editor-Token": state.token, ...headers }, body: JSON.stringify({ content, revision }),
  });
  return { root, server, origin, state, put };
}

test("all editable fields are covered and editor remains outside public dist", async (t) => {
  const { root, server, origin, state } = await fixture(t);
  assert.equal(server.address().address, "127.0.0.1");
  assert.equal(fields.length, 169);
  assert.equal(new Set(fields.map((field) => field.key)).size, fields.length);
  assert.equal(validateContent(state.content), null);
  assert.equal(validateContent(state.original), null);
  assert.equal(state.sections.length, 7);
  assert.equal((await fetch(`${origin}/editor/`)).status, 200);
  assert.equal((await fetch(`${origin}/server.mjs`)).status, 404);
  assert.equal((await fetch(`${origin}/content/original.json`)).status, 404);
  assert.ok(!(await readdir(path.join(root, "dist"))).includes("editor"));
});
test("save persists text and regenerates escaped static HTML and metadata", async (t) => {
  const { root, state, put } = await fixture(t);
  const next = { ...state.content, "hero.headingStart": '<img src=x onerror="alert(1)">', "site.title": '测试 & "文案"', "hero.description": "第一行\n第二行" };
  const response = await put(next);
  assert.equal(response.status, 200);
  assert.notEqual((await response.json()).revision, state.revision);
  assert.deepEqual((await createContentStore(root).load()).content, next);
  const html = await readFile(path.join(root, "dist/index.html"), "utf8");
  assert.ok(html.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"));
  assert.ok(html.includes("<title>测试 &amp; &quot;文案&quot;</title>"));
  assert.ok(html.includes("第一行&#10;第二行"));
  assert.ok(!html.includes('<img src=x onerror="alert(1)">'));
  assert.ok(!/\{\{[\w.]+\}\}/.test(html));
  assert.equal(JSON.parse(await readFile(path.join(root, "content/original.json"), "utf8"))["hero.headingStart"], state.content["hero.headingStart"]);
});
test("invalid fields and unsafe links cannot change files", async (t) => {
  const { root, state, put } = await fixture(t);
  const before = await readFile(path.join(root, "dist/content.json"), "utf8");
  const missing = { ...state.content }; delete missing["hero.note"];
  for (const next of [missing, { ...state.content, extra: "value" }, { ...state.content, "hero.note": null }, { ...state.content, "hero.note": 12 }, { ...state.content, "hero.note": "a".repeat(301) }, { ...state.content, "hero.note": "bad\u0000text" }, { ...state.content, "release.downloadUrl": "javascript:alert(1)" }, { ...state.content, "release.communityUrl": "https://user:password@example.com/" }]) {
    assert.equal((await put(next)).status, 422);
  }
  assert.equal(await readFile(path.join(root, "dist/content.json"), "utf8"), before);
});
test("every copy field can be empty, saved, reloaded and restored", async (t) => {
  const { root, origin, state, put } = await fixture(t);
  const empty = Object.fromEntries(fields.map((item) => [item.key, ""]));
  assert.equal(validateContent(empty), null);
  const response = await put(empty);
  assert.equal(response.status, 200);
  const saved = await response.json();
  assert.deepEqual((await fetch(`${origin}/api/editor/content`).then((result) => result.json())).content, empty);
  assert.equal((await createContentStore(root).load()).revision, saved.revision);
  assert.equal((await put(state.content, saved.revision)).status, 200);
  assert.deepEqual((await createContentStore(root).load()).content, state.content);
});
test("stale and simultaneous saves do not overwrite each other", async (t) => {
  const { root, state, put } = await fixture(t);
  const results = await Promise.all([put({ ...state.content, "hero.note": "窗口 A" }), put({ ...state.content, "hero.note": "窗口 B" })]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  const winner = results[0].status === 200 ? "窗口 A" : "窗口 B";
  assert.equal((await createContentStore(root).load()).content["hero.note"], winner);
});
test("write API rejects missing token, foreign origin and forged host", async (t) => {
  const { origin, state, put } = await fixture(t);
  assert.equal((await put(state.content, state.revision, { "X-Editor-Token": "invalid" })).status, 403);
  assert.equal((await put(state.content, state.revision, { Origin: "https://example.com" })).status, 403);
  const forgedHostStatus = await new Promise((resolve, reject) => {
    const req = request(`${origin}/api/editor/content`, { headers: { Host: "example.com" } }, (response) => { response.resume(); resolve(response.statusCode); });
    req.on("error", reject); req.end();
  });
  assert.equal(forgedHostStatus, 403);
  assert.equal((await fetch(`${origin}/api/editor/content`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: "{}" })).status, 403);
});
test("bad JSON, media types and oversized requests fail without writing", async (t) => {
  const { origin, state, put } = await fixture(t);
  assert.equal((await put(state.content, state.revision, { "Content-Type": "text/plain" })).status, 415);
  const headers = { Origin: origin, "X-Editor-Token": state.token, "Content-Type": "application/json" };
  assert.equal((await fetch(`${origin}/api/editor/content`, { method: "PUT", headers, body: "{" })).status, 400);
  assert.equal((await fetch(`${origin}/api/editor/content`, { method: "PUT", headers, body: "a".repeat(270000) })).status, 413);
  assert.equal((await fetch(`${origin}/api/editor/content`, { method: "DELETE" })).status, 405);
});
test("encoded traversal cannot read template or editor internals", async (t) => {
  const { origin } = await fixture(t);
  for (const suffix of ["/%2e%2e%5ctemplate.html", "/editor/%2e%2e%5ccontent%5coriginal.json", "/%ZZ", "/.git/config"]) {
    assert.ok([403, 404].includes((await fetch(`${origin}${suffix}`)).status));
  }
});

test("publish and login endpoints require same-origin editor authorization", async (t) => {
  let starts = 0, logins = 0;
  const publisherFactory = async () => ({
    inspect: async () => ({ phase: "idle", connection: { authenticated: true } }),
    start: async () => { starts++; return { phase: "checking" }; },
    signIn: () => { logins++; return { connection: { signingIn: true } }; },
  });
  const { origin, state } = await fixture(t, publisherFactory);
  assert.equal((await fetch(`${origin}/api/editor/publish`)).status, 200);
  for (const endpoint of ["/api/editor/publish", "/api/editor/github/login"]) {
    assert.equal((await fetch(`${origin}${endpoint}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status, 403);
    assert.equal((await fetch(`${origin}${endpoint}`, { method: "POST", headers: { Origin: "https://example.com", "X-Editor-Token": state.token, "Content-Type": "application/json" }, body: "{}" })).status, 403);
  }
  assert.equal(starts + logins, 0);
  const headers = { Origin: origin, "X-Editor-Token": state.token, "Content-Type": "application/json" };
  assert.equal((await fetch(`${origin}/api/editor/publish`, { method: "POST", headers, body: JSON.stringify({ revision: state.revision }) })).status, 202);
  assert.equal(starts, 1);
  assert.equal((await fetch(`${origin}/api/editor/github/login`, { method: "POST", headers, body: "{}" })).status, 202);
  assert.equal(logins, 1);
});
