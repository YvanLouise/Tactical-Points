import { readFile, lstat } from "node:fs/promises";
import path from "node:path";
import { IMAGE_SLOTS, IMAGE_LIMITS, imageFor } from "../dist/media.js";

export function validateImageConfig(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("图片配置格式不正确。");
  for (const [id, item] of Object.entries(config)) {
    if (!IMAGE_SLOTS.some((slot) => slot.id === id) || !item || typeof item !== "object") throw new Error("图片位置不正确。");
    if (!new RegExp(`^\\./assets/uploads/${id}-[a-f0-9]{64}\\.(png|jpg|webp)$`).test(item.src)) throw new Error("图片路径不正确。");
    if (![item.width, item.height].every((value) => Number.isInteger(value) && value > 0 && value <= IMAGE_LIMITS.edge) || item.width * item.height > IMAGE_LIMITS.pixels) throw new Error("图片尺寸不正确。");
    if (!Number.isInteger(item.bytes) || item.bytes <= 0 || item.bytes > IMAGE_LIMITS.bytes) throw new Error("图片大小不正确。");
    if (Object.keys(item).some((key) => !["src", "width", "height", "bytes"].includes(key))) throw new Error("图片配置包含未知字段。");
  }
  return config;
}

export async function loadImageConfig(root) {
  const filename = path.join(root, "dist/images.json");
  let raw = "{}\n";
  try {
    if ((await lstat(filename)).isSymbolicLink()) throw new Error("图片配置不能是符号链接。");
    raw = await readFile(filename, "utf8");
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  return { raw, config: validateImageConfig(JSON.parse(raw)) };
}

export function imageTemplateValues(config = {}) {
  const hero = imageFor("hero", config);
  return {
    "image.hero": hero.src, "image.heroWidth": String(hero.width), "image.heroHeight": String(hero.height),
    "image.faq": imageFor("faq", config).src, "image.favicon": imageFor("favicon", config).src,
    "image.author": imageFor("author-avatar", config).src,
    "image.community": imageFor("community-qr", config).src,
    "image.share": new URL(imageFor("screen-kingdom", config).src, "https://yvanlouise.github.io/Tactical-Points/").href,
  };
}
