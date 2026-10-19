import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, copyFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalServer } from "../server.mjs";
import { createContentStore } from "../content/store.mjs";
import { IMAGE_LIMITS } from "../dist/media.js";
import { createImageStore, inspectImage } from "../content/image-store.mjs";

const source = fileURLToPath(new URL("../", import.meta.url));
const tinyJpeg = Buffer.from("/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD8qqKKKAP/2Q==", "base64");
const tinyWebp = Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64");
async function fixture(t, publisherFactory = async () => ({})) {
  const root = await mkdtemp(path.join(tmpdir(), "shudian-images-"));
  for (const folder of ["dist/assets", "content"]) await mkdir(path.join(root, folder), { recursive: true });
  for (const file of ["dist/content.json", "dist/index.html", "content/original.json", "template.html", "about.template.html", "README.md", "dist/assets/hero.png", "dist/assets/favicon.png"]) await copyFile(path.join(source, file), path.join(root, file));
  const server = await createLocalServer({ root, port: 0, publisherFactory });
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const content = await fetch(`${origin}/api/editor/content`).then((response) => response.json());
  const initial = await fetch(`${origin}/api/editor/images`).then((response) => response.json());
  const png = await readFile(path.join(root, "dist/assets/favicon.png"));
  const put = (id = "hero", data = png, revision = initial.revision, headers = {}, method = "PUT") => fetch(`${origin}/api/editor/images/${id}`, {
    method, headers: { Origin: origin, "Content-Type": "image/png", "X-Editor-Token": content.token, "X-Image-Revision": revision, ...headers }, ...(method === "PUT" ? { body: data } : {}),
  });
  return { root, origin, content, initial, png, put };
}

test("image replacement persists exact bytes and updates HTML without changing originals or copy", async (t) => {
  const f = await fixture(t);
  assert.equal(f.initial.images.length, 20);
  const original = await readFile(path.join(f.root, "dist/assets/hero.png"));
  const copy = await readFile(path.join(f.root, "dist/content.json")), readme = await readFile(path.join(f.root, "README.md"));
  const response = await f.put(); assert.equal(response.status, 200);
  const saved = await response.json(), image = saved.images.find((item) => item.id === "hero");
  assert.equal(image.custom, true); assert.equal(image.width, 254); assert.equal(image.height, 254);
  assert.match(image.src, /^\.\/assets\/uploads\/hero-[a-f0-9]{64}\.png$/);
  const published = await fetch(new URL(image.src, `${f.origin}/`));
  assert.equal(published.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await published.arrayBuffer()), f.png);
  const reloaded = await fetch(`${f.origin}/api/editor/images`).then((result) => result.json());
  assert.equal(reloaded.revision, saved.revision); assert.deepEqual(reloaded.config, saved.config);
  assert.ok((await readFile(path.join(f.root, "dist/index.html"), "utf8")).includes(`href="${image.src}" as="image"`));
  const store = createContentStore(f.root), current = await store.load();
  assert.deepEqual(await readFile(path.join(f.root, "dist/content.json")), copy);
  assert.equal((await store.save({ ...current.content, "hero.note": "图片替换后的文案" }, current.revision)).status, 200);
  assert.ok((await readFile(path.join(f.root, "dist/index.html"), "utf8")).includes(`src="${image.src}"`));
  assert.deepEqual(await readFile(path.join(f.root, "dist/assets/hero.png")), original);
  assert.deepEqual(await readFile(path.join(f.root, "README.md")), readme);
});
test("author avatar and group QR uploads rebuild their public pages and can be restored", async (t) => {
  const f = await fixture(t);
  let revision = f.initial.revision;
  for (const id of ["author-avatar", "community-qr"]) {
    const response = await f.put(id, f.png, revision);
    assert.equal(response.status, 200);
    const saved = await response.json(); revision = saved.revision;
    const asset = saved.images.find((item) => item.id === id);
    assert.equal(asset.custom, true);
    assert.ok((await readFile(path.join(f.root, "dist/index.html"), "utf8")).includes(`src="${asset.src}"`));
    if (id === "author-avatar") assert.ok((await readFile(path.join(f.root, "dist/about.html"), "utf8")).includes(`src="${asset.src}"`));
  }
  const restored = await f.put("community-qr", null, revision, {}, "DELETE").then((response) => response.json());
  assert.equal(restored.images.find((item) => item.id === "community-qr").custom, false);
  assert.equal(restored.images.find((item) => item.id === "author-avatar").custom, true);
});

test("restoring default images resets the manifest and static preload", async (t) => {
  const f = await fixture(t), saved = await f.put().then((result) => result.json());
  const response = await f.put("hero", null, saved.revision, {}, "DELETE"); assert.equal(response.status, 200);
  const restored = await response.json(); assert.deepEqual(restored.config, {});
  assert.equal(restored.images.find((item) => item.id === "hero").src, "./assets/hero.png");
  assert.ok((await readFile(path.join(f.root, "dist/index.html"), "utf8")).includes('href="./assets/hero.png" as="image"'));
});

test("JPEG and WebP uploads retain their original formats and correct response types", async (t) => {
  const f = await fixture(t);
  let revision = f.initial.revision;
  for (const [mime, extension, data] of [["image/jpeg", "jpg", tinyJpeg], ["image/webp", "webp", tinyWebp]]) {
    assert.equal(inspectImage(data, mime).width, 1);
    const response = await f.put("screen-kingdom", data, revision, { "Content-Type": mime }); assert.equal(response.status, 200);
    const saved = await response.json(); revision = saved.revision;
    assert.ok(saved.config["screen-kingdom"].src.endsWith(`.${extension}`));
    const file = await fetch(new URL(saved.config["screen-kingdom"].src, `${f.origin}/`));
    assert.equal(file.headers.get("content-type"), mime); assert.deepEqual(Buffer.from(await file.arrayBuffer()), data);
    assert.ok((await readFile(path.join(f.root, "dist/index.html"), "utf8")).includes(new URL(saved.config["screen-kingdom"].src, "https://yvanlouise.github.io/Tactical-Points/").href));
  }
});

test("failed HTML rebuild restores the previous image configuration", async (t) => {
  const f = await fixture(t), images = createImageStore(f.root);
  const html = await readFile(path.join(f.root, "dist/index.html"));
  await assert.rejects(images.save("hero", f.png, "image/png", f.initial.revision, async () => { throw new Error("Rebuild failed"); }), /Rebuild failed/);
  const current = await images.load(); assert.deepEqual(current.config, {}); assert.equal(current.revision, f.initial.revision);
  assert.deepEqual(await readFile(path.join(f.root, "dist/index.html")), html);
});

test("stale image saves and concurrent windows cannot overwrite another replacement", async (t) => {
  const f = await fixture(t);
  const responses = await Promise.all([f.put(), f.put("screen-tactical")]);
  assert.deepEqual(responses.map((result) => result.status).sort(), [200, 409]);
  assert.equal((await f.put("faq")).status, 409);
  const saved = await fetch(`${f.origin}/api/editor/images`).then((result) => result.json());
  assert.equal(Object.keys(saved.config).length, 1);
});

test("image writes validate authorization, target, media type, dimensions and bytes", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.put("hero", f.png, f.initial.revision, { "X-Editor-Token": "wrong" })).status, 403);
  assert.equal((await f.put("hero", f.png, f.initial.revision, { Origin: "https://example.com" })).status, 403);
  assert.equal((await f.put("unknown")).status, 404);
  assert.equal((await f.put("hero", f.png, "wrong")).status, 400);
  assert.equal((await f.put("hero", f.png, f.initial.revision, { "Content-Type": "image/svg+xml" })).status, 415);
  for (const data of [Buffer.from("not an image"), f.png.subarray(0, 32), Buffer.from("<svg onload='alert(1)'/>")]) assert.equal((await f.put("hero", data)).status, 422);
  const oversized = Buffer.from(f.png); oversized.writeUInt32BE(IMAGE_LIMITS.edge + 1, 16);
  assert.equal((await f.put("hero", oversized)).status, 422);
  assert.equal((await f.put("hero", Buffer.alloc(IMAGE_LIMITS.bytes + 1))).status, 413);
  const current = await fetch(`${f.origin}/api/editor/images`).then((result) => result.json());
  assert.equal(current.revision, f.initial.revision); assert.deepEqual(current.config, {});
});

test("image-aware publication carries and validates the saved image revision", async (t) => {
  let received;
  const f = await fixture(t, async () => ({ start: async (...values) => { received = values; return { phase: "waiting" }; } }));
  const publish = (imageRevision) => fetch(`${f.origin}/api/editor/publish`, { method: "POST", headers: { Origin: f.origin, "Content-Type": "application/json", "X-Editor-Token": f.content.token }, body: JSON.stringify({ revision: f.content.revision, imageRevision }) });
  assert.equal((await publish("invalid")).status, 400);
  assert.equal((await publish(f.initial.revision)).status, 202);
  assert.equal(received[2], f.initial.revision);
});
