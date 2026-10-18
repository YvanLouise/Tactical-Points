import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { atomicWrite, revisionOf } from "./store.mjs";

export const MAX_README_BYTES = 128 * 1024;
const changed = () => Object.assign(new Error("README 已被其他窗口或编辑器修改。请先复制需要保留的文字，再重新加载。"), { status: 409, code: "readme_changed" });

export function createReadmeStore(root) {
  const filename = path.join(root, "README.md");
  let queue = Promise.resolve();
  async function load() {
    let content = "", exists = true;
    try {
      const info = await lstat(filename);
      if (!info.isFile() || info.isSymbolicLink()) throw Object.assign(new Error("README.md 必须是官网仓库中的普通文件。"), { status: 409, code: "readme_unavailable" });
      content = await readFile(filename, "utf8");
    } catch (error) { if (error.code !== "ENOENT") throw error; exists = false; }
    return { content, revision: revisionOf(content), filename: "README.md", maxBytes: MAX_README_BYTES, exists };
  }
  function enqueue(action) {
    const task = queue.then(action);
    queue = task.catch(() => {});
    return task;
  }
  function save(content, expectedRevision) {
    return enqueue(async () => {
      if (typeof content !== "string" || content.includes("\0")) return { status: 422, error: "README 需要有效的 Markdown 文本。" };
      if (Buffer.byteLength(content, "utf8") > MAX_README_BYTES) return { status: 422, error: "README 不能超过 128 KB。" };
      const current = await load();
      if (current.revision !== expectedRevision) return { status: 409, error: changed().message };
      await atomicWrite(filename, content);
      return { status: 200, content, revision: revisionOf(content) };
    });
  }
  function withSnapshot(expectedRevision, action) {
    return enqueue(async () => {
      const current = await load();
      if (current.revision !== expectedRevision) throw changed();
      return action(current);
    });
  }
  return { load, save, withSnapshot };
}
