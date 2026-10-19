import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, copyFile, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchLocalEditor } from "../server.mjs";

const source = fileURLToPath(new URL("../", import.meta.url));
const publisherFactory = async () => ({});
const listen = (server) => new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
const close = (server) => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "shudian-launcher-"));
  for (const folder of ["dist", "content", "editor"]) await mkdir(path.join(root, folder));
  for (const name of ["dist/content.json", "dist/index.html", "content/original.json", "template.html", "about.template.html", "editor/index.html"]) await copyFile(path.join(source, name), path.join(root, name));
  const servers = new Set();
  t.after(async () => { for (const server of servers) await close(server); await rm(root, { recursive: true, force: true }); });
  const launch = async (port, options = {}) => {
    const result = await launchLocalEditor({ root, port, publisherFactory, ...options });
    if (result.server) servers.add(result.server);
    return result;
  };
  return { root, launch };
}

test("repeated startup reuses this workspace without rebuilding files or replacing editor credentials", async (t) => {
  const f = await fixture(t), first = await f.launch(0);
  const before = await fetch(`${first.origin}/api/editor/content`).then((response) => response.json());
  const identity = await fetch(`${first.origin}/api/editor/status`).then((response) => response.json());
  assert.equal(identity.app, "shudian-local-editor");
  assert.match(identity.workspace, /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(identity).includes(f.root));
  await writeFile(path.join(f.root, "dist/index.html"), "keep the running editor output");
  const second = await f.launch(first.port, { publisherFactory: async () => { throw new Error("Must not initialize twice"); } });
  assert.equal(second.reused, true); assert.equal(second.server, null); assert.equal(second.url, first.url);
  assert.equal(await readFile(path.join(f.root, "dist/index.html"), "utf8"), "keep the running editor output");
  const after = await fetch(`${second.origin}/api/editor/content`).then((response) => response.json());
  assert.equal(after.token, before.token);
});

test("an unrelated occupied port gets an available fallback which is reused on the next launch", async (t) => {
  const f = await fixture(t);
  const other = createServer((request, response) => response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ app: "another-application" })));
  await listen(other); t.after(() => close(other));
  const occupied = other.address().port;
  const first = await f.launch(occupied);
  assert.equal(first.reused, false); assert.notEqual(first.port, occupied);
  const cached = JSON.parse(await readFile(path.join(f.root, ".cache/editor-instance.json"), "utf8"));
  assert.equal(cached.port, first.port);
  const second = await f.launch(occupied);
  assert.equal(second.reused, true); assert.equal(second.url, first.url);
  assert.equal((await fetch(`http://127.0.0.1:${occupied}/`)).status, 200);
});

test("another copy of the project is not mistaken for the requested workspace", async (t) => {
  const firstProject = await fixture(t), secondProject = await fixture(t);
  const first = await firstProject.launch(0), second = await secondProject.launch(first.port);
  assert.equal(second.reused, false); assert.notEqual(second.port, first.port);
  const identities = await Promise.all([first, second].map((item) => fetch(`${item.origin}/api/editor/status`).then((response) => response.json())));
  assert.notEqual(identities[0].workspace, identities[1].workspace);
});

test("stale cached ports do not prevent a fresh editor from starting", async (t) => {
  const f = await fixture(t), reservation = createServer();
  await listen(reservation);
  const port = reservation.address().port;
  await close(reservation);
  await mkdir(path.join(f.root, ".cache"));
  await writeFile(path.join(f.root, ".cache/editor-instance.json"), JSON.stringify({ port }));
  const result = await f.launch(port);
  assert.equal(result.reused, false); assert.equal(result.port, port);
  assert.equal((await fetch(result.url)).status, 200);
});

test("simultaneous launches on a free port share one running editor", async (t) => {
  const f = await fixture(t), reservation = createServer();
  await listen(reservation);
  const port = reservation.address().port;
  await close(reservation);
  const results = await Promise.all([f.launch(port), f.launch(port)]);
  assert.deepEqual(results.map((item) => item.reused).sort(), [false, true]);
  assert.equal(results[0].url, results[1].url);
});

test("simultaneous launches also share one fallback when the preferred port is occupied", async (t) => {
  const f = await fixture(t), other = createServer((request, response) => response.writeHead(404).end());
  await listen(other); t.after(() => close(other));
  const results = await Promise.all([f.launch(other.address().port), f.launch(other.address().port)]);
  assert.deepEqual(results.map((item) => item.reused).sort(), [false, true]);
  assert.equal(results[0].url, results[1].url);
});

test("failed initialization releases its reserved port", async (t) => {
  const f = await fixture(t), reservation = createServer();
  await listen(reservation);
  const port = reservation.address().port;
  await close(reservation);
  await assert.rejects(f.launch(port, { publisherFactory: async () => { throw new Error("Initialization failed"); } }), /Initialization failed/);
  const replacement = createServer();
  await new Promise((resolve, reject) => { replacement.once("error", reject); replacement.listen(port, "127.0.0.1", resolve); });
  await close(replacement);
});

test("invalid ports fail with a concise error before changing website files", async (t) => {
  const f = await fixture(t), before = await readFile(path.join(f.root, "dist/index.html"));
  for (const port of [-1, 1.5, 65536, NaN]) await assert.rejects(f.launch(port), /PORT must be an integer/);
  assert.deepEqual(await readFile(path.join(f.root, "dist/index.html")), before);
});

test("a running editor with an older API protocol is not reused after an upgrade", async (t) => {
  const f = await fixture(t), first = await f.launch(0);
  const identity = await fetch(`${first.origin}/api/editor/status`).then(response => response.json());
  await close(first.server);
  const old = createServer((request, response) => response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ...identity, protocol: identity.protocol - 1 })));
  await listen(old); t.after(() => close(old));
  const upgraded = await f.launch(old.address().port);
  assert.equal(upgraded.reused, false);
  assert.notEqual(upgraded.port, old.address().port);
  assert.equal((await fetch(`${upgraded.origin}/api/editor/status`).then(response => response.json())).protocol, identity.protocol);
});
