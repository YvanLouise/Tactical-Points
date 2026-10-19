import { readFile, writeFile, rename, unlink } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { validateContent } from "./schema.mjs";
import { loadImageConfig, imageTemplateValues } from "./image-config.mjs";
import { withContentDefaults } from "../dist/content-defaults.js";

export const revisionOf = (text) => createHash("sha256").update(text).digest("hex");
export const serialize = (copy) => JSON.stringify(copy, null, 2) + "\n";
const escapeHtml = (text) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

export function renderTemplate(template, copy, images = {}) {
  const values = { ...copy, ...imageTemplateValues(images) };
  return template.replace(/\{\{([\w.]+)\}\}/g, (_, key) => {
    if (!Object.hasOwn(values, key)) throw new Error(`Unknown template field: ${key}`);
    return escapeHtml(values[key]).replace(/\r?\n/g, "&#10;");
  });
}
export async function atomicWrite(filename, text) {
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, text, { flag: "wx" }); await rename(temporary, filename); }
  finally { await unlink(temporary).catch(() => {}); }
}
export function createContentStore(root) {
  const contentFile = path.join(root, "dist/content.json");
  let queue = Promise.resolve();
  async function load() {
    const raw = await readFile(contentFile, "utf8");
    const content = withContentDefaults(JSON.parse(raw));
    const error = validateContent(content);
    if (error) throw new Error(error);
    return { content, revision: revisionOf(raw) };
  }
  async function pageWrites(content) {
    const images = (await loadImageConfig(root)).config;
    const writes = [];
    for (const [templateName, outputName] of [["template.html", "index.html"], ["about.template.html", "about.html"]]) {
      let template;
      try { template = await readFile(path.join(root, templateName), "utf8"); }
      catch (error) { if (templateName === "about.template.html" && error.code === "ENOENT") continue; throw error; }
      writes.push([path.join(root, "dist", outputName), renderTemplate(template, content, images)]);
    }
    return writes;
  }
  async function writeTogether(writes) {
    const completed = [];
    try {
      for (const [filename, text] of writes) {
        let previous;
        try { previous = await readFile(filename); }
        catch (error) { if (error.code !== "ENOENT") throw error; }
        await atomicWrite(filename, text);
        completed.push([filename, previous]);
      }
    } catch (error) {
      // Restore every output if a later page or the content file cannot be written.
      for (const [filename, previous] of completed.reverse()) {
        if (previous === undefined) await unlink(filename);
        else await atomicWrite(filename, previous);
      }
      throw error;
    }
  }
  async function build(content) {
    await writeTogether(await pageWrites(content));
  }
  function save(content, expectedRevision) {
    const task = queue.then(async () => {
      const error = validateContent(content);
      if (error) return { status: 422, error };
      const current = await load();
      if (current.revision !== expectedRevision) return { status: 409, error: "本地文件已被其他窗口修改。请先复制需要保留的文字，再重新加载。" };
      const raw = serialize(content);
      await writeTogether([...await pageWrites(content), [contentFile, raw]]);
      return { status: 200, content, revision: revisionOf(raw) };
    });
    queue = task.catch(() => {});
    return task;
  }
  function withSnapshot(expectedRevision, action) {
    const task = queue.then(async () => {
      const current = await load();
      if (expectedRevision !== undefined && current.revision !== expectedRevision) throw Object.assign(new Error("文案文件已变化，请重新加载后再发布。"), { status: 409, code: "content_changed" });
      return action(current);
    });
    queue = task.catch(() => {});
    return task;
  }
  return { load, build, save, withSnapshot };
}
