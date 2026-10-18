import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { atomicWrite } from "../content/store.mjs";
import { createReadmeStore } from "../content/readme-store.mjs";
import { GitHubClient, PublishError, git, readCredential, loginGitHub } from "./github.mjs";
import { TARGET } from "./target.mjs";

const activePhases = ["checking", "building", "pushing", "waiting", "deploying"];
const validSha = (value) => /^[a-f0-9]{40}$/.test(value || "");
const publicError = (error) => error instanceof PublishError || ["content_changed", "readme_changed", "readme_unavailable"].includes(error.code) ? error.message : "本地发布操作失败。请检查 Git 状态、网络和仓库写入权限后重试。";
const safeSiteUrl = (value) => { try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.href : TARGET.siteUrl; } catch { return TARGET.siteUrl; } };

export async function createPublisher({ root, store, readmeStore = createReadmeStore(root), runGit = (args, options) => git(root, args, options), getClient = async () => new GitHubClient(await readCredential(root)), login = () => loginGitHub(root), clock = () => Date.now() }) {
  const stateFile = path.join(root, ".cache/publish-state.json");
  let state = { phase: "idle", message: "尚未发布", commit: null, revision: null, readmeRevision: null, startedAt: null, afterRunId: 0, updatedAt: null, runUrl: null, siteUrl: TARGET.siteUrl, logs: [] };
  try {
    const saved = JSON.parse(await readFile(stateFile, "utf8"));
    if (validSha(saved.commit)) {
      state = { ...state, commit: saved.commit, revision: saved.revision, readmeRevision: saved.readmeRevision || null, startedAt: saved.startedAt, afterRunId: Number(saved.afterRunId) || 0, phase: "waiting", message: "正在检查上次发布结果。" };
    }
  } catch { /* The first launch has no publication state. */ }
  let task = null, starting = false, loginTask = null, client = null, identity = null, connectionAt = 0, refreshAt = 0, refreshing = null;
  let connection = { authenticated: false, login: null, message: "尚未检查 GitHub 登录。", checking: false };
  const snapshot = () => ({ target: TARGET, ...state, busy: starting || Boolean(task) || activePhases.includes(state.phase), connection: { ...connection, signingIn: Boolean(loginTask) } });
  async function transition(phase, message, extra = {}) {
    state = { ...state, ...extra, phase, message, updatedAt: new Date(clock()).toISOString(), logs: [...state.logs.slice(-23), { time: new Date(clock()).toISOString(), message }] };
    await mkdir(path.dirname(stateFile), { recursive: true });
    // Persist only public job metadata; credentials stay in the system credential manager.
    const { commit, revision, readmeRevision, startedAt, afterRunId } = state;
    await atomicWrite(stateFile, JSON.stringify({ commit, revision, readmeRevision, startedAt, afterRunId }) + "\n");
  }
  async function connect(force = false) {
    if (!force && connectionAt && clock() - connectionAt < 15000) return client;
    connectionAt = clock();
    try {
      client = await getClient();
      identity = await client.user();
      connection = { authenticated: true, login: identity.login, message: `已连接 ${identity.login}` };
      return client;
    } catch (error) {
      client = null; identity = null;
      connection = { authenticated: false, login: null, message: publicError(error) };
      return null;
    }
  }
  async function refresh() {
    if (task || !validSha(state.commit) || !activePhases.includes(state.phase)) return;
    if (refreshing) return refreshing;
    if (refreshAt && clock() - refreshAt < 5000) return;
    refreshAt = clock();
    refreshing = (async () => {
      const api = await connect();
      if (!api) return;
      try {
        const run = await api.latestRun(state.commit);
        if (!run || run.id <= state.afterRunId) {
          if (clock() - Date.parse(state.startedAt) > 5 * 60 * 1000) await transition("error", "GitHub 尚未创建发布任务。请打开 Actions 查看工作流是否启用，然后重试。");
          return;
        }
        state.runUrl = `${TARGET.repositoryUrl}/actions/runs/${run.id}`;
        if (run.status === "completed") {
          if (run.conclusion === "success") {
            const pages = await api.pages();
            if (!pages?.html_url) return transition("error", "工作流已结束，但尚未找到 Pages 站点。请检查仓库 Pages 设置。");
            await transition("success", state.readmeRevision ? "官网已上线，README 已同步到 GitHub。" : "官网已上线。", { siteUrl: safeSiteUrl(pages.html_url) });
          } else await transition("error", `GitHub 部署未完成（${run.conclusion || "unknown"}）。请打开发布记录查看原因后重试。`);
        } else if (state.phase !== "deploying") await transition("deploying", run.status === "in_progress" ? "GitHub 正在构建并部署官网…" : "GitHub 发布任务已排队…");
      } catch (error) {
        state.message = `${publicError(error)} 发布结果仍待确认，可稍后刷新。`;
      }
    })().finally(() => { refreshing = null; });
    return refreshing;
  }
  async function inspect() { await connect(); await refresh(); return snapshot(); }
  async function verifyRepository(api) {
    const repo = await api.repository();
    if (!repo.permissions?.push || repo.archived || repo.disabled) throw new PublishError("当前账号无法写入此仓库，请检查仓库权限或归档状态。", 403);
    const top = await runGit(["rev-parse", "--show-toplevel"]);
    if (path.resolve(top.stdout) !== path.resolve(root)) throw new PublishError("请在官网自己的 Git 仓库中启动编辑器。", 409);
    const branch = await runGit(["branch", "--show-current"]);
    if (branch.stdout !== TARGET.branch) throw new PublishError("当前不在 main 分支，请切换到 main 后发布。", 409);
    const remote = await runGit(["remote", "get-url", "origin"], { allowed: [0, 2, 128] });
    if (remote.code) await runGit(["remote", "add", "origin", TARGET.remote]);
    else if (remote.stdout.replace(/\.git\/?$/, "").replace(/\/$/, "").toLowerCase() !== TARGET.repositoryUrl.toLowerCase()) throw new PublishError("origin 指向了其他仓库，请先确认远端配置。", 409);
    const result = await runGit(["ls-remote", "origin", `refs/heads/${TARGET.branch}`], { token: api.token });
    const remoteSha = result.stdout.split(/\s+/)[0];
    if (remoteSha && !validSha(remoteSha)) throw new PublishError("无法确认远端版本，请稍后重试。", 502);
    if (remoteSha) {
      await runGit(["fetch", "--no-tags", "origin", `refs/heads/${TARGET.branch}:refs/remotes/origin/${TARGET.branch}`], { token: api.token });
      const ancestor = await runGit(["merge-base", "--is-ancestor", `origin/${TARGET.branch}`, "HEAD"], { allowed: [0, 1] });
      if (ancestor.code) throw new PublishError("远端 main 有新的提交，请先同步仓库后重试。本地修改不会被覆盖。", 409, "remote_ahead");
    }
    return remoteSha;
  }
  async function perform(expectedRevision, expectedReadmeRevision) {
    const api = await connect(true);
    if (!api) throw new PublishError(connection.message, 401);
    const remoteSha = await verifyRepository(api);
    await transition("building", expectedReadmeRevision ? "正在校验并准备已保存的官网与 README…" : "正在校验并准备已保存的官网内容…");
    const sha = await store.withSnapshot(expectedRevision, async ({ content }) => {
      const capture = async () => {
        await store.build(content);
        const files = expectedReadmeRevision ? ["dist", "README.md"] : ["dist"];
        await runGit(["add", "-A", "--", ...files]);
        const changed = await runGit(["diff", "--cached", "--quiet", "--", ...files], { allowed: [0, 1] });
        if (changed.code) await runGit(["commit", "--only", "-m", `Publish website${expectedReadmeRevision ? " and README" : ""} ${new Date(clock()).toISOString()}`, "--", ...files]);
        const head = (await runGit(["rev-parse", "HEAD"])).stdout;
        if (!validSha(head)) throw new PublishError("无法读取本地提交版本。", 500);
        return head;
      };
      return expectedReadmeRevision ? readmeStore.withSnapshot(expectedReadmeRevision, capture) : capture();
    });
    await transition("pushing", expectedReadmeRevision ? "正在上传官网与 README 到 GitHub…" : "正在上传官网内容到 GitHub…", { commit: null });
    const pushArgs = ["push", "origin", `${sha}:refs/heads/${TARGET.branch}`];
    try { await runGit(pushArgs, { token: api.token, timeout: 120000 }); }
    catch (failure) {
      if (/workflow|non-fast-forward|fetch first|protected branch|GH00[136]/i.test(failure.stderr || "")) throw new PublishError("GitHub 拒绝推送。请检查工作流写入权限、分支规则或远端版本；本地提交已保留。", 409, "push_rejected");
      await transition("pushing", "上传请求未完成，正在自动重试一次…");
      try { await runGit(pushArgs, { token: api.token, timeout: 120000 }); }
      catch { throw new PublishError("上传重试未成功。请检查网络、仓库权限与远端版本；本地提交已保留，可稍后重试。", 502, "push_failed"); }
    }
    await transition("waiting", expectedReadmeRevision ? "官网与 README 已上传，正在配置 GitHub Pages…" : "官网内容已上传，正在配置 GitHub Pages…", { commit: sha });
    const pages = await api.ensurePages();
    if (pages?.html_url) state.siteUrl = safeSiteUrl(pages.html_url);
    const existing = await api.latestRun(sha);
    if (remoteSha === sha && (!existing || (existing.status === "completed" && existing.conclusion !== "success"))) {
      state.afterRunId = existing?.id || 0;
      await api.dispatch();
    }
    await transition("waiting", "已提交到 GitHub，等待 Pages 部署完成…");
  }
  async function start(expectedRevision, expectedReadmeRevision) {
    if (starting || task) throw new PublishError("已有发布任务正在执行，请等待当前任务结束。", 409, "publish_busy");
    starting = true;
    try {
      await refresh();
      if (task || activePhases.includes(state.phase)) throw new PublishError("已有发布任务正在执行，请等待当前任务结束。", 409, "publish_busy");
      if ((await store.load()).revision !== expectedRevision) throw new PublishError("文案文件已变化，请重新加载后再发布。", 409, "content_changed");
      if (expectedReadmeRevision && (await readmeStore.load()).revision !== expectedReadmeRevision) throw new PublishError("README 文件已变化，请重新加载后再发布。", 409, "readme_changed");
      state.logs = [];
      await transition("checking", "正在检查登录状态和仓库版本…", { commit: null, revision: expectedRevision, readmeRevision: expectedReadmeRevision || null, afterRunId: 0, runUrl: null, startedAt: new Date(clock()).toISOString() });
      task = perform(expectedRevision, expectedReadmeRevision).catch(async (error) => { await transition("error", publicError(error)); }).finally(() => { task = null; });
      return snapshot();
    } finally { starting = false; }
  }
  function signIn() {
    if (task || starting || activePhases.includes(state.phase)) throw new PublishError("发布任务进行中，请结束后再切换 GitHub 登录。", 409);
    if (loginTask) return snapshot();
    loginTask = login().then(() => { connectionAt = 0; return connect(true); }).catch(() => {
      connection = { authenticated: false, login: null, message: "GitHub 登录未完成。请重试，或在终端运行 git credential-manager github login。" };
    }).finally(() => { loginTask = null; });
    return snapshot();
  }
  return { inspect, start, signIn, snapshot, waitForIdle: async () => { await task; } };
}
