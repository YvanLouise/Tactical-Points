import { execFile } from "node:child_process";
import { TARGET } from "./target.mjs";

export class PublishError extends Error {
  constructor(message, status = 400, code = "publish_error") { super(message); this.status = status; this.code = code; }
}

export function command(file, args, { cwd, env = {}, input, timeout = 30000, allowed = [0] } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(file, args, { cwd, env: { ...process.env, ...env }, windowsHide: true, timeout, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = error ? error.code : 0;
      if (allowed.includes(code)) resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() });
      else reject(Object.assign(new Error(`${file} command failed`), { code, stderr }));
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

const quietEnvironment = { GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never", GIT_TRACE: undefined, GIT_TRACE_CURL: undefined, GIT_CURL_VERBOSE: undefined, GCM_TRACE: undefined };
export function git(root, args, { token, ...options } = {}) {
  const env = { ...quietEnvironment, ...options.env };
  if (token) {
    env.GIT_CONFIG_COUNT = "1";
    env.GIT_CONFIG_KEY_0 = "http.https://github.com/.extraheader";
    env.GIT_CONFIG_VALUE_0 = `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
  }
  return command("git", ["-c", "http.sslBackend=openssl", "-c", "credential.interactive=never", ...args], { ...options, cwd: root, env });
}

export async function readCredential(root) {
  if (process.env.GH_TOKEN || process.env.GITHUB_TOKEN) return process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  try {
    const result = await git(root, ["credential", "fill"], { input: `protocol=https\nhost=github.com\npath=${TARGET.owner}/${TARGET.repo}.git\nusername=${TARGET.owner}\n\n`, timeout: 12000 });
    const values = Object.fromEntries(result.stdout.split(/\r?\n/).map((line) => { const index = line.indexOf("="); return [line.slice(0, index), line.slice(index + 1)]; }));
    if (values.password) return values.password;
  } catch { /* The UI offers the system credential manager when no login is available. */ }
  throw new PublishError("尚未连接 GitHub。点击“登录 GitHub”后按浏览器提示完成登录。", 401, "login_required");
}

export class GitHubClient {
  constructor(token, fetcher = fetch) { this.token = token; this.fetcher = fetcher; }
  async request(endpoint, { method = "GET", body, allow404 = false } = {}) {
    let response;
    try {
      response = await this.fetcher(`https://api.github.com${endpoint}`, {
        method, redirect: "error", signal: AbortSignal.timeout(20000),
        headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${this.token}`, "X-GitHub-Api-Version": "2026-03-10", "User-Agent": "Tactical-Points-Local-Editor", ...(body ? { "Content-Type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch { throw new PublishError("暂时无法连接 GitHub，请检查网络后重试。", 502, "network_error"); }
    if (allow404 && response.status === 404) return null;
    if (!response.ok) {
      const messages = {
        401: "GitHub 登录已失效，请重新登录。",
        403: "GitHub 权限不足或请求受限。请检查仓库写入、Actions 和 Pages 权限。",
        404: "找不到指定仓库或工作流，请检查账号对仓库的访问权限。",
        409: "GitHub 仓库当前无法执行此操作，请稍后重试。",
        422: "GitHub 未接受发布配置，请检查仓库 Settings → Pages 是否支持 GitHub Actions。",
      };
      throw new PublishError(messages[response.status] || `GitHub 请求失败（${response.status}），请稍后重试。`, response.status === 401 ? 401 : 502, "github_error");
    }
    if (response.status === 204) return null;
    return response.json();
  }
  repoPath(suffix = "") { return `/repos/${TARGET.owner}/${TARGET.repo}${suffix}`; }
  user() { return this.request("/user"); }
  repository() { return this.request(this.repoPath()); }
  pages() { return this.request(this.repoPath("/pages"), { allow404: true }); }
  async ensurePages() {
    const current = await this.pages();
    if (!current) return this.request(this.repoPath("/pages"), { method: "POST", body: { build_type: "workflow" } });
    if (current.build_type !== "workflow") await this.request(this.repoPath("/pages"), { method: "PUT", body: { build_type: "workflow" } });
    return current;
  }
  async latestRun(sha) {
    const query = new URLSearchParams({ branch: TARGET.branch, head_sha: sha, per_page: "10" });
    const data = await this.request(this.repoPath(`/actions/workflows/${TARGET.workflow}/runs?${query}`), { allow404: true });
    return data?.workflow_runs?.filter((run) => run.head_sha === sha).sort((a, b) => b.id - a.id)[0] || null;
  }
  dispatch() { return this.request(this.repoPath(`/actions/workflows/${TARGET.workflow}/dispatches`), { method: "POST", body: { ref: TARGET.branch } }); }
}

export function loginGitHub(root) {
  return command("git", ["credential-manager", "github", "login", "--url", "https://github.com", "--username", TARGET.owner, "--browser", "--force"], { cwd: root, env: { GCM_INTERACTIVE: "always" }, timeout: 180000 });
}
