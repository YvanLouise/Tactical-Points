import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, copyFile, readFile, writeFile, rm, symlink, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalServer } from "../server.mjs";
import { createReadmeStore, MAX_README_BYTES } from "../content/readme-store.mjs";

const source = fileURLToPath(new URL("../", import.meta.url));
async function fixture(t, withReadme = true) {
  const root = await mkdtemp(path.join(tmpdir(), "shudian-readme-"));
  for (const folder of ["dist", "content", "editor"]) await mkdir(path.join(root, folder));
  for (const file of ["dist/content.json", "dist/index.html", "content/original.json", "template.html", "editor/index.html"]) await copyFile(path.join(source, file), path.join(root, file));
  if (withReadme) await writeFile(path.join(root, "README.md"), "# Initial README\n");
  const starts = [];
  const server = await createLocalServer({ root, port: 0, publisherFactory: async () => ({ start: async (...args) => { starts.push(args); return { phase: "checking" }; } }) });
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const copy = await fetch(`${origin}/api/editor/content`).then((response) => response.json());
  const initial = await fetch(`${origin}/api/editor/readme`).then((response) => response.json());
  const headers = { Origin: origin, "X-Editor-Token": copy.token, "Content-Type": "application/json" };
  const put = (content, revision = initial.revision, extra = {}) => fetch(`${origin}/api/editor/readme`, { method: "PUT", headers: { ...headers, ...extra }, body: JSON.stringify({ content, revision }) });
  return { root, origin, copy, initial, headers, put, starts };
}

test("README round trips Markdown exactly without changing public website files", async (t) => {
  const f = await fixture(t);
  const before = await readFile(path.join(f.root, "dist/content.json"), "utf8");
  const html = await readFile(path.join(f.root, "dist/index.html"), "utf8");
  const text = '# 术点牌\r\n\r\n**项目介绍** & <script>literal text</script>\r\n\r\n```powershell\r\nnpm run dev\r\n```\r\n';
  const response = await f.put(text);
  assert.equal(response.status, 200);
  const saved = await response.json();
  assert.notEqual(saved.revision, f.initial.revision);
  assert.equal(await readFile(path.join(f.root, "README.md"), "utf8"), text);
  assert.equal((await fetch(`${f.origin}/api/editor/readme`).then((response) => response.json())).content, text);
  assert.equal(await readFile(path.join(f.root, "dist/content.json"), "utf8"), before);
  assert.equal(await readFile(path.join(f.root, "dist/index.html"), "utf8"), html);
  assert.ok(!(await readdir(path.join(f.root, "dist"))).includes("README.md"));
  assert.equal((await fetch(`${f.origin}/README.md`)).status, 404);
});

test("stale and simultaneous README saves cannot overwrite another window", async (t) => {
  const f = await fixture(t);
  const results = await Promise.all([f.put("# Window A\n"), f.put("# Window B\n")]);
  assert.deepEqual(results.map((response) => response.status).sort(), [200, 409]);
  const winner = results[0].status === 200 ? "# Window A\n" : "# Window B\n";
  assert.equal(await readFile(path.join(f.root, "README.md"), "utf8"), winner);
  assert.equal((await f.put("# Old revision\n")).status, 409);
});

test("README API checks authorization, text size and request format before writing", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.put("bad token", undefined, { "X-Editor-Token": "invalid" })).status, 403);
  assert.equal((await f.put("foreign origin", undefined, { Origin: "https://example.com" })).status, 403);
  assert.equal((await f.put("plain text", undefined, { "Content-Type": "text/plain" })).status, 415);
  for (const content of [null, {}, "zero\0byte", "中".repeat(Math.floor(MAX_README_BYTES / 3) + 1)]) assert.equal((await f.put(content)).status, 422);
  assert.equal((await fetch(`${f.origin}/api/editor/readme`, { method: "PUT", headers: f.headers, body: "{" })).status, 400);
  assert.equal((await fetch(`${f.origin}/api/editor/readme`, { method: "PUT", headers: f.headers, body: "x".repeat(1024 * 1024 + 1) })).status, 413);
  assert.equal((await fetch(`${f.origin}/api/editor/readme`, { method: "DELETE" })).status, 405);
  assert.equal(await readFile(path.join(f.root, "README.md"), "utf8"), f.initial.content);
});

test("missing README can be created and save paths remain fixed to README.md", async (t) => {
  const f = await fixture(t, false);
  assert.equal(f.initial.content, ""); assert.equal(f.initial.exists, false);
  const before = await readFile(path.join(f.root, "dist/content.json"), "utf8");
  const response = await fetch(`${f.origin}/api/editor/readme`, { method: "PUT", headers: f.headers, body: JSON.stringify({ content: "# New README\n", revision: f.initial.revision, filename: "dist/content.json" }) });
  assert.equal(response.status, 200);
  assert.equal(await readFile(path.join(f.root, "README.md"), "utf8"), "# New README\n");
  assert.equal(await readFile(path.join(f.root, "dist/content.json"), "utf8"), before);
});

test("README publish requests include its saved revision and reject invalid revisions", async (t) => {
  const f = await fixture(t);
  const publish = (readmeRevision) => fetch(`${f.origin}/api/editor/publish`, { method: "POST", headers: f.headers, body: JSON.stringify({ revision: f.copy.revision, readmeRevision }) });
  assert.equal((await publish("invalid")).status, 400);
  assert.equal((await publish(null)).status, 400);
  assert.equal(f.starts.length, 0);
  assert.equal((await publish(f.initial.revision)).status, 202);
  assert.deepEqual(f.starts, [[f.copy.revision, f.initial.revision]]);
});

test("README saves wait until a publication snapshot has finished", async (t) => {
  const f = await fixture(t), store = createReadmeStore(f.root);
  let release, captured;
  const hold = new Promise((resolve) => { release = resolve; });
  const entered = new Promise((resolve) => { captured = resolve; });
  const snapshot = store.withSnapshot(f.initial.revision, async ({ content }) => { captured(); await hold; assert.equal(content, f.initial.content); assert.equal((await store.load()).content, content); });
  await entered;
  const save = store.save("# Saved after snapshot\n", f.initial.revision);
  release(); await snapshot;
  assert.equal((await save).status, 200);
  assert.equal((await store.load()).content, "# Saved after snapshot\n");
});

test("README symlinks cannot redirect editor reads or writes", async (t) => {
  const f = await fixture(t, false);
  const target = path.join(f.root, "other.md"); await writeFile(target, "unchanged");
  try { await symlink(target, path.join(f.root, "README.md"), "file"); }
  catch (error) { if (["EPERM", "EACCES"].includes(error.code)) { t.skip("Creating symlinks is unavailable on this host."); return; } throw error; }
  assert.equal((await fetch(`${f.origin}/api/editor/readme`)).status, 409);
  assert.equal((await f.put("must not write")).status, 409);
  assert.equal(await readFile(target, "utf8"), "unchanged");
});
