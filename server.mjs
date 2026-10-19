import { createServer } from "node:http";
import { readFile, stat, realpath, mkdir } from "node:fs/promises";
import { randomBytes, createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { sections } from "./content/schema.mjs";
import { withContentDefaults } from "./dist/content-defaults.js";
import { createContentStore, atomicWrite } from "./content/store.mjs";
import { createReadmeStore } from "./content/readme-store.mjs";
import { createImageStore } from "./content/image-store.mjs";
import { IMAGE_LIMITS, IMAGE_SLOTS } from "./dist/media.js";
import { createPublisher } from "./deploy/publisher.mjs";
import { createAndroidPublisher } from "./deploy/android-release.mjs";
import { PublishError } from "./deploy/github.mjs";

const projectRoot = fileURLToPath(new URL("./", import.meta.url));
const editorApp = "shudian-local-editor";
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".ttf": "font/ttf", ".txt": "text/plain; charset=utf-8" };

async function editorIdentity(root) {
  const canonical = await realpath(root);
  const workspace = createHash("sha256").update(process.platform === "win32" ? canonical.toLowerCase() : canonical).digest("hex");
  return { app: editorApp, protocol: 3, workspace };
}

export async function createLocalServer({ root = projectRoot, port = Number(process.env.PORT || 4173), publisherFactory = createPublisher, androidFactory = createAndroidPublisher } = {}) {
  const identity = await editorIdentity(root);
  const store = createContentStore(root);
  const readmeStore = createReadmeStore(root);
  const imageStore = createImageStore(root);
  const original = withContentDefaults(JSON.parse(await readFile(path.join(root, "content/original.json"), "utf8")));
  const token = randomBytes(32).toString("hex");
  let publisher, androidPublisher, markReady, markFailed;
  const ready = new Promise((resolve, reject) => { markReady = resolve; markFailed = reject; });
  ready.catch(() => {});
  const server = createServer(async (request, response) => {
    const sendJson = (status, value) => {
      response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }).end(JSON.stringify(value));
    };
    try {
      const hosts = [`127.0.0.1:${server.address().port}`, `localhost:${server.address().port}`];
      if (!hosts.includes(request.headers.host)) return sendJson(403, { error: "仅允许本机访问。" });
      const origin = `http://${request.headers.host}`;
      if (request.headers.origin && request.headers.origin !== origin) return sendJson(403, { error: "不允许跨站访问。" });
      const pathname = decodeURIComponent(new URL(request.url, origin).pathname);
      response.setHeader("Content-Security-Policy", "frame-ancestors 'self'");
      if (pathname === "/api/editor/status") {
        if (request.method === "GET") return sendJson(200, identity);
        response.setHeader("Allow", "GET"); return sendJson(405, { error: "Method not allowed" });
      }
      await ready;
      if (pathname === "/api/editor/images" || pathname.startsWith("/api/editor/images/")) {
        if (pathname === "/api/editor/images" && request.method === "GET") return sendJson(200, await imageStore.load());
        const id = pathname.slice("/api/editor/images/".length);
        if (!IMAGE_SLOTS.some((slot) => slot.id === id)) return sendJson(404, { error: "找不到这个图片位置。" });
        if (!["PUT", "DELETE"].includes(request.method)) { response.setHeader("Allow", "PUT, DELETE"); return sendJson(405, { error: "Method not allowed" }); }
        if (request.headers.origin !== origin || request.headers["x-editor-token"] !== token) return sendJson(403, { error: "编辑凭据已失效，请重新加载面板。" });
        if (androidPublisher.snapshot().busy) return sendJson(409, { error: "安装包更新期间请等待任务完成后再保存图片。" });
        const expected = request.headers["x-image-revision"], mime = request.headers["content-type"]?.split(";")[0];
        if (typeof expected !== "string" || !/^[a-f0-9]{64}$/.test(expected)) return sendJson(400, { error: "请先读取图片列表，再保存图片。" });
        if (request.method === "PUT" && !["image/png", "image/jpeg", "image/webp"].includes(mime)) return sendJson(415, { error: "请选择 PNG、JPG 或 WebP 图片。" });
        const chunks = []; let bytes = 0;
        for await (const chunk of request) { bytes += chunk.length; if (bytes > IMAGE_LIMITS.bytes) return sendJson(413, { error: "单张图片不能超过 12 MB。" }); chunks.push(chunk); }
        if (request.method === "DELETE" && bytes) return sendJson(400, { error: "恢复默认图片时无需上传文件。" });
        const result = await store.withSnapshot(undefined, ({ content }) => imageStore.save(id, request.method === "DELETE" ? null : Buffer.concat(chunks), mime, expected, () => store.build(content)));
        return sendJson(result.status, result);
      }
      if (["/api/editor/publish", "/api/editor/github/login", "/api/editor/android-release"].includes(pathname)) {
        const android = pathname === "/api/editor/android-release";
        if (request.method === "GET" && !pathname.endsWith("login")) return sendJson(200, android ? await androidPublisher.inspect() : await publisher.inspect());
        if (request.method !== "POST") { response.setHeader("Allow", pathname.endsWith("login") ? "POST" : "GET, POST"); return sendJson(405, { error: "Method not allowed" }); }
        if (request.headers.origin !== origin || request.headers["x-editor-token"] !== token) return sendJson(403, { error: "编辑凭据已失效，请重新加载面板。" });
        if (request.headers["content-type"]?.split(";")[0] !== "application/json") return sendJson(415, { error: "需要 JSON 请求。" });
        const chunks = []; let bytes = 0;
        for await (const chunk of request) { bytes += chunk.length; if (bytes > 4096) return sendJson(413, { error: "请求过大。" }); chunks.push(chunk); }
        let payload;
        try { payload = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
        catch { return sendJson(400, { error: "JSON 格式不正确。" }); }
        if (pathname.endsWith("login")) {
          if (androidPublisher.snapshot().busy) return sendJson(409, { error: "安装包更新期间不能切换 GitHub 账号。" });
          return sendJson(202, publisher.signIn());
        }
        if (!payload || typeof payload.revision !== "string" || !/^[a-f0-9]{64}$/.test(payload.revision)) return sendJson(400, { error: "请先保存文案，再发布已保存的版本。" });
        if (payload.readmeRevision !== undefined && (typeof payload.readmeRevision !== "string" || !/^[a-f0-9]{64}$/.test(payload.readmeRevision))) return sendJson(400, { error: "请先读取并保存 README，再发布。" });
        if (payload.imageRevision !== undefined && (typeof payload.imageRevision !== "string" || !/^[a-f0-9]{64}$/.test(payload.imageRevision))) return sendJson(400, { error: "请先读取并保存图片，再发布。" });
        if (android) {
          if (payload.retry !== undefined && typeof payload.retry !== "boolean") return sendJson(400, { error: "无效的重试请求。" });
          return sendJson(202, await androidPublisher.start(payload));
        }
        if (androidPublisher.snapshot().busy) return sendJson(409, { error: "安装包正在构建或发布，请等待任务完成。" });
        const revisions = [payload.revision, payload.readmeRevision];
        if (payload.imageRevision !== undefined) revisions.push(payload.imageRevision);
        return sendJson(202, await publisher.start(...revisions));
      }
      if (["/api/editor/content", "/api/editor/readme"].includes(pathname)) {
        const readme = pathname.endsWith("/readme");
        const documentStore = readme ? readmeStore : store;
        if (request.method === "GET") return sendJson(200, readme ? await readmeStore.load() : { ...await store.load(), original, sections, token });
        if (request.method !== "PUT") { response.setHeader("Allow", "GET, PUT"); return sendJson(405, { error: "Method not allowed" }); }
        if (request.headers.origin !== origin || request.headers["x-editor-token"] !== token) return sendJson(403, { error: "编辑凭据已失效，请重新加载面板。" });
        if (androidPublisher.snapshot().busy) return sendJson(409, { error: "安装包更新期间请等待任务完成后再保存内容。" });
        if (request.headers["content-type"]?.split(";")[0] !== "application/json") return sendJson(415, { error: "需要 JSON 请求。" });
        let bytes = 0;
        const chunks = [];
        for await (const chunk of request) {
          bytes += chunk.length;
          if (bytes > (readme ? 1024 : 256) * 1024) return sendJson(413, { error: "文件过大。" });
          chunks.push(chunk);
        }
        let payload;
        try { payload = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
        catch { return sendJson(400, { error: "JSON 格式不正确。" }); }
        if (!payload || typeof payload !== "object") return sendJson(400, { error: "请求格式不正确。" });
        const result = await documentStore.save(payload.content, payload.revision);
        return sendJson(result.status, result);
      }
      if (!["GET", "HEAD"].includes(request.method)) { response.setHeader("Allow", "GET, HEAD"); return sendJson(405, { error: "Method not allowed" }); }
      const editor = pathname === "/editor" || pathname.startsWith("/editor/");
      const base = path.join(root, editor ? "editor" : "dist");
      const relative = editor ? pathname.slice(7) || "/" : pathname;
      const filename = path.resolve(base, `.${relative.endsWith("/") ? `${relative}index.html` : relative}`);
      const isWithin = (target) => !path.relative(base, target).startsWith("..") && !path.isAbsolute(path.relative(base, target));
      if (!isWithin(filename) || !isWithin(await realpath(filename))) return sendJson(403, { error: "Forbidden" });
      const info = await stat(filename);
      if (!info.isFile()) throw new Error("Not a file");
      const contents = await readFile(filename);
      response.writeHead(200, { "Content-Type": types[path.extname(filename)] || "application/octet-stream", "Content-Length": contents.length, "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff" });
      response.end(request.method === "HEAD" ? undefined : contents);
    } catch (error) {
      if (error instanceof PublishError || ["content_changed", "readme_changed", "readme_unavailable", "invalid_image", "images_changed"].includes(error.code)) sendJson(error.status || 400, { error: error.message });
      else if (["ENOENT", "ENOTDIR", "EISDIR"].includes(error.code) || error instanceof URIError) sendJson(404, { error: "Not found" });
      else { console.error("Local editor:", error.message); sendJson(500, { error: "文件操作失败，请检查终端中的错误；本次修改尚未保存。" }); }
    }
  });
  try {
    // Reserve the port before rebuilding so concurrent launches cannot write the same pages.
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
    publisher = await publisherFactory({ root, store, readmeStore, imageStore });
    androidPublisher = await androidFactory({ root, store, readmeStore, imageStore, publisher });
    await store.build((await store.load()).content);
    markReady();
    return server;
  } catch (error) {
    markFailed(error);
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    throw error;
  }
}

export async function launchLocalEditor({ root = projectRoot, port = Number(process.env.PORT || 4173), publisherFactory = createPublisher } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("PORT must be an integer between 0 and 65535.");
  const identity = await editorIdentity(root);
  const recordFile = path.join(root, ".cache/editor-instance.json");
  const cached = await readFile(recordFile, "utf8").then(JSON.parse).catch(() => null);
  const validPort = (value) => Number.isInteger(value) && value > 0 && value <= 65535;
  async function inspect(candidate) {
    try {
      const response = await fetch(`http://127.0.0.1:${candidate}/api/editor/status`, { redirect: "error", signal: AbortSignal.timeout(1200) });
      const status = response.ok ? await response.json().catch(() => null) : null;
      await response.body?.cancel().catch(() => {});
      return { occupied: true, matches: status?.app === identity.app && status.protocol === identity.protocol && status.workspace === identity.workspace };
    } catch (error) {
      return { occupied: error.cause?.code !== "ECONNREFUSED", matches: false };
    }
  }
  const result = (actualPort, server = null) => ({ server, reused: !server, port: actualPort, origin: `http://127.0.0.1:${actualPort}`, url: `http://127.0.0.1:${actualPort}/editor/` });
  let occupied = false;
  // Verify the workspace over loopback before reusing even a cached instance.
  for (const candidate of port === 0 ? [] : new Set([port, cached?.port].filter(validPort))) {
    const status = await inspect(candidate);
    if (status.matches) return result(candidate);
    if (candidate === port) occupied = status.occupied;
  }
  let server, candidate = occupied ? port + 1 : port;
  for (let attempt = 0; attempt < 20; attempt++) {
    if (candidate > 65535) candidate = 4173;
    if (candidate !== port) {
      const status = await inspect(candidate);
      if (status.matches) return result(candidate);
      if (status.occupied) { candidate++; continue; }
    }
    try { server = await createLocalServer({ root, port: candidate, publisherFactory }); break; }
    catch (error) {
      if (error.code !== "EADDRINUSE") throw error;
      const status = await inspect(candidate);
      if (status.matches) return result(candidate);
      candidate++;
    }
  }
  if (!server) throw new Error("No available local editor port was found. Set PORT to another port and try again.");
  const started = result(server.address().port, server);
  try {
    await mkdir(path.dirname(recordFile), { recursive: true });
    await atomicWrite(recordFile, JSON.stringify({ ...identity, port: started.port }) + "\n");
  } catch (error) {
    await new Promise((resolve) => server.close(resolve));
    throw error;
  }
  return started;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const editor = await launchLocalEditor();
    if (editor.reused) console.log(`Local editor is already running: ${editor.url}`);
    else {
      const preferred = Number(process.env.PORT || 4173);
      if (preferred && editor.port !== preferred) console.log(`Port ${preferred} is in use. Using port ${editor.port}.`);
      console.log(`Website: ${editor.origin}/\nCopy editor: ${editor.url}\nPress Ctrl+C to stop.`);
    }
    if (process.platform === "win32" && process.argv.includes("--open-editor")) {
      execFile("cmd.exe", ["/d", "/c", "start", '""', editor.url], { windowsHide: true, windowsVerbatimArguments: true }, (error) => {
        if (error) console.log(`Open the editor manually: ${editor.url}`);
      });
    }
  } catch (error) {
    console.error(`Cannot start local editor: ${error.message}`);
    process.exitCode = 1;
  }
}
