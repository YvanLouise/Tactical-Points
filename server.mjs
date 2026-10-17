import { createServer } from "node:http";
import { readFile, stat, realpath } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { sections } from "./content/schema.mjs";
import { createContentStore } from "./content/store.mjs";
import { createPublisher } from "./deploy/publisher.mjs";
import { PublishError } from "./deploy/github.mjs";

const projectRoot = fileURLToPath(new URL("./", import.meta.url));
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".ttf": "font/ttf", ".txt": "text/plain; charset=utf-8" };

export async function createLocalServer({ root = projectRoot, port = Number(process.env.PORT || 4173), publisherFactory = createPublisher } = {}) {
  const store = createContentStore(root);
  await store.build((await store.load()).content);
  const original = JSON.parse(await readFile(path.join(root, "content/original.json"), "utf8"));
  const token = randomBytes(32).toString("hex");
  const publisher = await publisherFactory({ root, store });
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
      if (["/api/editor/publish", "/api/editor/github/login"].includes(pathname)) {
        if (request.method === "GET" && pathname === "/api/editor/publish") return sendJson(200, await publisher.inspect());
        if (request.method !== "POST") { response.setHeader("Allow", pathname.endsWith("login") ? "POST" : "GET, POST"); return sendJson(405, { error: "Method not allowed" }); }
        if (request.headers.origin !== origin || request.headers["x-editor-token"] !== token) return sendJson(403, { error: "编辑凭据已失效，请重新加载面板。" });
        if (request.headers["content-type"]?.split(";")[0] !== "application/json") return sendJson(415, { error: "需要 JSON 请求。" });
        const chunks = []; let bytes = 0;
        for await (const chunk of request) { bytes += chunk.length; if (bytes > 4096) return sendJson(413, { error: "请求过大。" }); chunks.push(chunk); }
        let payload;
        try { payload = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
        catch { return sendJson(400, { error: "JSON 格式不正确。" }); }
        if (pathname.endsWith("login")) return sendJson(202, publisher.signIn());
        if (!payload || typeof payload.revision !== "string" || !/^[a-f0-9]{64}$/.test(payload.revision)) return sendJson(400, { error: "请先保存文案，再发布已保存的版本。" });
        return sendJson(202, await publisher.start(payload.revision));
      }
      if (pathname === "/api/editor/content") {
        if (request.method === "GET") return sendJson(200, { ...await store.load(), original, sections, token });
        if (request.method !== "PUT") { response.setHeader("Allow", "GET, PUT"); return sendJson(405, { error: "Method not allowed" }); }
        if (request.headers.origin !== origin || request.headers["x-editor-token"] !== token) return sendJson(403, { error: "编辑凭据已失效，请重新加载面板。" });
        if (request.headers["content-type"]?.split(";")[0] !== "application/json") return sendJson(415, { error: "需要 JSON 请求。" });
        let bytes = 0;
        const chunks = [];
        for await (const chunk of request) {
          bytes += chunk.length;
          if (bytes > 256 * 1024) return sendJson(413, { error: "文案文件过大。" });
          chunks.push(chunk);
        }
        let payload;
        try { payload = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
        catch { return sendJson(400, { error: "JSON 格式不正确。" }); }
        if (!payload || typeof payload !== "object") return sendJson(400, { error: "请求格式不正确。" });
        const result = await store.save(payload.content, payload.revision);
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
      if (error instanceof PublishError || error.code === "content_changed") sendJson(error.status || 400, { error: error.message });
      else if (["ENOENT", "ENOTDIR", "EISDIR"].includes(error.code) || error instanceof URIError) sendJson(404, { error: "Not found" });
      else { console.error("Local editor:", error.message); sendJson(500, { error: "文件操作失败，请检查终端中的错误；本次修改尚未保存。" }); }
    }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  return server;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const server = await createLocalServer();
  const origin = `http://127.0.0.1:${server.address().port}`;
  console.log(`Website: ${origin}/\nCopy editor: ${origin}/editor/\nPress Ctrl+C to stop.`);
  if (process.platform === "win32" && process.argv.includes("--open-editor")) {
    execFile("cmd.exe", ["/d", "/c", "start", '""', `${origin}/editor/`], { windowsHide: true, windowsVerbatimArguments: true }, (error) => {
      if (error) console.log(`Open the editor manually: ${origin}/editor/`);
    });
  }
}
