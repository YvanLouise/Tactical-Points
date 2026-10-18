import { mkdir, readFile, realpath, lstat, readdir, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { IMAGE_SLOTS, IMAGE_LIMITS, imageFor } from "../dist/media.js";
import { loadImageConfig, validateImageConfig } from "./image-config.mjs";
import { atomicWrite, revisionOf, serialize } from "./store.mjs";

const invalid = () => Object.assign(new Error("请选择有效的 PNG、JPG 或 WebP 图片。"), { status: 422, code: "invalid_image" });
export function inspectImage(data, mime) {
  let width, height, extension;
  if (!Buffer.isBuffer(data) || !data.length) throw invalid();
  if (data.length > IMAGE_LIMITS.bytes) throw Object.assign(new Error("单张图片不能超过 12 MB。"), { status: 413, code: "invalid_image" });
  if (mime === "image/png" && data.length >= 45 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    if (data.readUInt32BE(8) !== 13 || data.toString("ascii", 12, 16) !== "IHDR") throw invalid();
    let offset = 8, pixels = false, ended = false;
    while (offset + 12 <= data.length) {
      const length = data.readUInt32BE(offset), type = data.toString("ascii", offset + 4, offset + 8);
      if (offset + length + 12 > data.length) throw invalid();
      if (type === "IDAT" && length) pixels = true;
      offset += length + 12;
      if (type === "IEND") { ended = length === 0 && offset === data.length; break; }
    }
    if (!pixels || !ended) throw invalid();
    width = data.readUInt32BE(16); height = data.readUInt32BE(20); extension = "png";
  } else if (mime === "image/jpeg" && data.length >= 12 && data.readUInt16BE(0) === 0xffd8 && data.readUInt16BE(data.length - 2) === 0xffd9) {
    let offset = 2;
    while (offset + 4 <= data.length) {
      if (data[offset++] !== 0xff) throw invalid();
      while (data[offset] === 0xff) offset++;
      const marker = data[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      const length = data.readUInt16BE(offset);
      if (length < 2 || offset + length > data.length) throw invalid();
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        if (length < 8) throw invalid();
        height = data.readUInt16BE(offset + 3); width = data.readUInt16BE(offset + 5); break;
      }
      offset += length;
    }
    extension = "jpg";
  } else if (mime === "image/webp" && data.length >= 26 && data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP" && data.readUInt32LE(4) + 8 === data.length) {
    const type = data.toString("ascii", 12, 16), size = data.readUInt32LE(16);
    if (size + 20 > data.length) throw invalid();
    if (type === "VP8X" && size >= 10) { width = data.readUIntLE(24, 3) + 1; height = data.readUIntLE(27, 3) + 1; }
    else if (type === "VP8 " && size >= 10 && data.subarray(23, 26).equals(Buffer.from([157, 1, 42]))) { width = data.readUInt16LE(26) & 0x3fff; height = data.readUInt16LE(28) & 0x3fff; }
    else if (type === "VP8L" && size >= 5 && data[20] === 0x2f) { const bits = data.readUInt32LE(21); width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1; }
    extension = "webp";
  }
  if (!extension || !width || !height) throw invalid();
  if (width > IMAGE_LIMITS.edge || height > IMAGE_LIMITS.edge || width * height > IMAGE_LIMITS.pixels) throw Object.assign(new Error("图片最长边不能超过 8192 像素，总像素不能超过 3200 万。"), { status: 422, code: "invalid_image" });
  return { width, height, extension, bytes: data.length };
}

export function createImageStore(root) {
  let queue = Promise.resolve();
  async function archiveUnused(config) {
    const directory = path.join(root, "dist/assets/uploads");
    let files;
    try { files = await readdir(directory, { withFileTypes: true }); }
    catch (error) { if (error.code === "ENOENT") return; throw error; }
    const used = new Set(Object.values(config).map((item) => path.basename(item.src)));
    const managed = new RegExp(`^(${IMAGE_SLOTS.map((slot) => slot.id).join("|")})-[a-f0-9]{64}\\.(png|jpg|webp)$`);
    const unused = files.filter((file) => file.isFile() && managed.test(file.name) && !used.has(file.name));
    if (!unused.length) return;
    const history = path.join(root, ".cache/image-history");
    await mkdir(history, { recursive: true });
    if (await realpath(directory) !== path.join(await realpath(path.join(root, "dist")), "assets/uploads") || await realpath(history) !== path.join(await realpath(root), ".cache/image-history")) throw Object.assign(new Error("图片目录发生变化，请检查本地目录后再发布。"), { status: 409, code: "images_changed" });
    // Preserve unused uploads privately so a discarded picture is never published.
    for (const file of unused) await rename(path.join(directory, file.name), path.join(history, `${randomUUID()}-${file.name}`));
  }
  async function load() {
    const { raw, config } = await loadImageConfig(root);
    return { config, revision: revisionOf(raw), images: IMAGE_SLOTS.map((slot) => imageFor(slot.id, config)), limits: IMAGE_LIMITS };
  }
  function save(id, data, mime, expectedRevision, rebuild = async () => {}) {
    const task = queue.then(async () => {
      if (!IMAGE_SLOTS.some((slot) => slot.id === id)) return { status: 404, error: "找不到这个图片位置。" };
      const current = await load();
      if (current.revision !== expectedRevision) return { status: 409, error: "图片已被其他窗口修改，请重新加载图片后再保存。" };
      const config = structuredClone(current.config);
      if (data === null) delete config[id];
      else {
        const details = inspectImage(data, mime);
        const directory = path.join(root, "dist/assets/uploads");
        await mkdir(directory, { recursive: true });
        const canonical = path.join(await realpath(path.join(root, "dist")), "assets/uploads");
        if (await realpath(directory) !== canonical) throw Object.assign(new Error("图片目录不能是符号链接。"), { status: 409, code: "invalid_image" });
        const filename = `${id}-${revisionOf(data)}.${details.extension}`;
        const target = path.join(directory, filename);
        try {
          if ((await lstat(target)).isSymbolicLink() || revisionOf(await readFile(target)) !== revisionOf(data)) throw new Error("图片文件已在编辑器之外改变。");
        } catch (error) { if (error.code !== "ENOENT") throw error; await atomicWrite(target, data); }
        config[id] = { src: `./assets/uploads/${filename}`, width: details.width, height: details.height, bytes: details.bytes };
      }
      validateImageConfig(config);
      const raw = serialize(config), configFile = path.join(root, "dist/images.json");
      await atomicWrite(configFile, raw);
      try { await rebuild(); }
      catch (error) { await atomicWrite(configFile, serialize(current.config)); throw error; }
      return { status: 200, ...await load() };
    });
    queue = task.catch(() => {});
    return task;
  }
  function withSnapshot(expectedRevision, action) {
    const task = queue.then(async () => {
      const current = await load();
      if (expectedRevision !== undefined && current.revision !== expectedRevision) throw Object.assign(new Error("图片文件已变化，请重新加载后再发布。"), { status: 409, code: "images_changed" });
      for (const item of Object.values(current.config)) {
        const filename = path.resolve(root, "dist", item.src);
        const canonical = path.join(await realpath(path.join(root, "dist")), item.src.slice(2));
        if (await realpath(filename) !== canonical || !item.src.includes(revisionOf(await readFile(filename)))) throw Object.assign(new Error("已保存的图片文件发生变化，请重新选择图片并保存。"), { status: 409, code: "images_changed" });
      }
      await archiveUnused(current.config);
      return action(current);
    });
    queue = task.catch(() => {});
    return task;
  }
  return { load, save, withSnapshot };
}
