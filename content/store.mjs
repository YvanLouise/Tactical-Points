import { readFile, writeFile, rename, unlink } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { validateContent } from "./schema.mjs";

export const revisionOf = (text) => createHash("sha256").update(text).digest("hex");
export const serialize = (copy) => JSON.stringify(copy, null, 2) + "\n";
const escapeHtml = (text) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

export function renderTemplate(template, copy) {
  return template.replace(/\{\{([\w.]+)\}\}/g, (_, key) => {
    if (!Object.hasOwn(copy, key)) throw new Error(`Unknown template field: ${key}`);
    return escapeHtml(copy[key]).replace(/\r?\n/g, "&#10;");
  });
}
export async function atomicWrite(filename, text) {
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, text, { flag: "wx" }); await rename(temporary, filename); }
  finally { await unlink(temporary).catch(() => {}); }
}
export function createContentStore(root) {
  const contentFile = path.join(root, "dist/content.json");
  const htmlFile = path.join(root, "dist/index.html");
  let queue = Promise.resolve();
  async function load() {
    const raw = await readFile(contentFile, "utf8");
    const content = JSON.parse(raw);
    const error = validateContent(content);
    if (error) throw new Error(error);
    return { content, revision: revisionOf(raw) };
  }
  async function build(content) {
    const template = await readFile(path.join(root, "template.html"), "utf8");
    await atomicWrite(htmlFile, renderTemplate(template, content));
  }
  function save(content, expectedRevision) {
    const task = queue.then(async () => {
      const error = validateContent(content);
      if (error) return { status: 422, error };
      const current = await load();
      if (current.revision !== expectedRevision) return { status: 409, error: "本地文件已被其他窗口修改。请先复制需要保留的文字，再重新加载。" };
      const template = await readFile(path.join(root, "template.html"), "utf8");
      const html = renderTemplate(template, content);
      const oldHtml = await readFile(htmlFile, "utf8");
      const raw = serialize(content);
      await atomicWrite(htmlFile, html);
      try { await atomicWrite(contentFile, raw); }
      catch (error) { await atomicWrite(htmlFile, oldHtml); throw error; }
      return { status: 200, content, revision: revisionOf(raw) };
    });
    queue = task.catch(() => {});
    return task;
  }
  function withSnapshot(expectedRevision, action) {
    const task = queue.then(async () => {
      const current = await load();
      if (current.revision !== expectedRevision) throw Object.assign(new Error("文案文件已变化，请重新加载后再发布。"), { status: 409, code: "content_changed" });
      return action(current);
    });
    queue = task.catch(() => {});
    return task;
  }
  return { load, build, save, withSnapshot };
}
