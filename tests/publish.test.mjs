import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, copyFile, readFile, writeFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPublisher } from "../deploy/publisher.mjs";
import { GitHubClient, git } from "../deploy/github.mjs";
import { TARGET } from "../deploy/target.mjs";
import { createContentStore } from "../content/store.mjs";
import { createReadmeStore } from "../content/readme-store.mjs";
import { createImageStore } from "../content/image-store.mjs";

const source = fileURLToPath(new URL("../", import.meta.url));
async function fixture(t) {
  const folder = await mkdtemp(path.join(tmpdir(), "shudian-publish-"));
  const root = path.join(folder, "site"), remote = path.join(folder, "remote.git");
  await mkdir(root);
  for (const name of ["dist", "content"]) await mkdir(path.join(root, name));
  for (const name of ["dist/content.json", "dist/index.html", "template.html", "README.md"]) await copyFile(path.join(source, name), path.join(root, name));
  const run = (args, options) => git(root, args, options);
  await run(["init", "--initial-branch=main"]);
  await run(["config", "user.name", "Publish Test"]);
  await run(["config", "user.email", "publish-test@example.com"]);
  await run(["init", "--bare", remote]);
  await run(["remote", "add", "origin", remote]);
  await writeFile(path.join(root, "editor-note.txt"), "original editor source\n");
  await run(["add", "."]); await run(["commit", "-m", "Initial fixture"]);
  const store = createContentStore(root);
  const readmeStore = createReadmeStore(root);
  const imageStore = createImageStore(root);
  let now = Date.now(), workflow = null, pages = { html_url: TARGET.siteUrl, build_type: "workflow" };
  let dispatches = 0, pushes = 0, failedPushes = 0;
  const api = {
    token: "test-token-must-never-be-exposed", user: async () => ({ login: TARGET.owner }),
    repository: async () => ({ permissions: { push: true }, archived: false, disabled: false }),
    ensurePages: async () => pages, pages: async () => pages,
    latestRun: async () => workflow, dispatch: async () => { dispatches++; },
  };
  const runGit = async (args, options) => {
    if (args[0] === "remote" && args[1] === "get-url") return { code: 0, stdout: TARGET.remote };
    if (args[0] === "push") {
      pushes++;
      if (failedPushes > 0) { failedPushes--; throw Object.assign(new Error("Temporary connection reset"), { stderr: "RPC failed; connection reset by peer" }); }
    }
    return run(args, { ...options, token: undefined });
  };
  const dependencies = { root, store, readmeStore, imageStore, runGit, getClient: async () => api, clock: () => now };
  const publisher = await createPublisher(dependencies);
  t.after(async () => { await publisher.waitForIdle(); await rm(folder, { recursive: true, force: true }); });
  return { root, remote, store, readmeStore, imageStore, run, publisher, dependencies,
    advance: () => { now += 16000; }, setWorkflow: (value) => { workflow = value; }, setPages: (value) => { pages = value; },
    get dispatches() { return dispatches; }, get pushes() { return pushes; },
    failNextPush: () => { failedPushes = 1; },
  };
}

test("publishes public files to the exact commit without committing unrelated staged changes", async (t) => {
  const f = await fixture(t);
  await writeFile(path.join(f.root, "editor-note.txt"), "do not publish this edit\n");
  await f.run(["add", "editor-note.txt"]);
  const initial = await f.store.load();
  const saved = await f.store.save({ ...initial.content, "hero.note": "已保存的新官网文案" }, initial.revision);
  await f.publisher.start(saved.revision); await f.publisher.waitForIdle();
  const pending = f.publisher.snapshot();
  assert.equal(pending.phase, "waiting");
  assert.equal(pending.busy, true);
  assert.equal(pending.revision, saved.revision);
  assert.ok((await f.run(["ls-remote", "origin", "refs/heads/main"])).stdout.startsWith(pending.commit));
  assert.equal((await f.run(["show", `${pending.commit}:editor-note.txt`])).stdout, "original editor source");
  assert.equal((await f.run(["diff", "--cached", "--name-only"])).stdout, "editor-note.txt");
  assert.ok((await f.run(["show", `${pending.commit}:dist/content.json`])).stdout.includes("已保存的新官网文案"));
  assert.ok(!JSON.stringify(pending).includes("test-token"));
  assert.ok(!(await readFile(path.join(f.root, ".cache/publish-state.json"), "utf8")).includes("test-token"));
});
test("only a successful matching workflow and existing Pages URL count as live", async (t) => {
  const f = await fixture(t);
  await f.publisher.start((await f.store.load()).revision); await f.publisher.waitForIdle();
  assert.notEqual(f.publisher.snapshot().phase, "success");
  f.setWorkflow({ id: 123, status: "in_progress", conclusion: null }); f.advance();
  assert.equal((await f.publisher.inspect()).phase, "deploying");
  f.setWorkflow({ id: 123, status: "completed", conclusion: "success" }); f.advance();
  const completed = await f.publisher.inspect();
  assert.equal(completed.phase, "success");
  assert.equal(completed.siteUrl, TARGET.siteUrl);
  assert.equal(completed.runUrl, `${TARGET.repositoryUrl}/actions/runs/123`);
  const restored = await createPublisher(f.dependencies);
  assert.equal((await restored.inspect()).phase, "success");
});
test("publishes README and website together while keeping unrelated staged edits", async (t) => {
  const f = await fixture(t);
  await writeFile(path.join(f.root, "editor-note.txt"), "keep this staged\n"); await f.run(["add", "editor-note.txt"]);
  const copy = await f.store.load(), readme = await f.readmeStore.load();
  const savedCopy = await f.store.save({ ...copy.content, "hero.note": "README 与官网同步发布" }, copy.revision);
  const savedReadme = await f.readmeStore.save("# Repository introduction\n\nNew README content.\n", readme.revision);
  await f.publisher.start(savedCopy.revision, savedReadme.revision); await f.publisher.waitForIdle();
  const state = f.publisher.snapshot();
  assert.equal(state.phase, "waiting"); assert.equal(state.readmeRevision, savedReadme.revision);
  assert.equal((await f.run(["show", `${state.commit}:README.md`])).stdout, savedReadme.content.trim());
  assert.ok((await f.run(["show", `${state.commit}:dist/content.json`])).stdout.includes("README 与官网同步发布"));
  assert.equal((await f.run(["show", `${state.commit}:editor-note.txt`])).stdout, "original editor source");
  assert.equal((await f.run(["diff", "--cached", "--name-only"])).stdout, "editor-note.txt");
  assert.ok((await f.run(["ls-remote", "origin", "refs/heads/main"])).stdout.startsWith(state.commit));
  assert.equal(JSON.parse(await readFile(path.join(f.root, ".cache/publish-state.json"), "utf8")).readmeRevision, savedReadme.revision);
});
test("README-only publication creates and uploads a README commit", async (t) => {
  const f = await fixture(t), copy = await f.store.load(), readme = await f.readmeStore.load();
  const saved = await f.readmeStore.save("# README-only update\n", readme.revision);
  await f.publisher.start(copy.revision, saved.revision); await f.publisher.waitForIdle();
  assert.equal(f.publisher.snapshot().phase, "waiting");
  assert.equal((await f.run(["diff-tree", "--no-commit-id", "--name-only", "-r", f.publisher.snapshot().commit])).stdout, "README.md");
  assert.equal(f.pushes, 1);
});

test("image replacements and their manifest are published in the same immutable commit", async (t) => {
  const f = await fixture(t), before = await f.imageStore.load();
  const png = await readFile(path.join(source, "dist/assets/favicon.png"));
  const saved = await f.imageStore.save("hero", png, "image/png", before.revision);
  const current = await f.store.load();
  await f.publisher.start(current.revision, undefined, saved.revision); await f.publisher.waitForIdle();
  const state = f.publisher.snapshot(); assert.equal(state.phase, "waiting"); assert.equal(state.imageRevision, saved.revision);
  const committed = JSON.parse((await f.run(["show", `${state.commit}:dist/images.json`])).stdout);
  assert.equal(committed.hero.src, saved.config.hero.src);
  assert.ok((await f.run(["ls-tree", "-r", "--name-only", state.commit])).stdout.includes(`dist/${committed.hero.src.slice(2)}`));
  assert.ok((await f.run(["show", `${state.commit}:dist/index.html`])).stdout.includes(`src="${committed.hero.src}"`));
  assert.equal(JSON.parse(await readFile(path.join(f.root, ".cache/publish-state.json"), "utf8")).imageRevision, saved.revision);
});

test("stale image revisions stop publication before pushing", async (t) => {
  const f = await fixture(t), before = await f.imageStore.load();
  await f.imageStore.save("hero", await readFile(path.join(source, "dist/assets/favicon.png")), "image/png", before.revision);
  await assert.rejects(f.publisher.start((await f.store.load()).revision, undefined, before.revision), /图片文件已变化/);
  assert.equal(f.pushes, 0);
});

test("restored or discarded uploads are kept privately and excluded from publication", async (t) => {
  const f = await fixture(t), initial = await f.imageStore.load();
  const png = await readFile(path.join(source, "dist/assets/favicon.png"));
  const saved = await f.imageStore.save("hero", png, "image/png", initial.revision);
  const restored = await f.imageStore.save("hero", null, undefined, saved.revision);
  await f.publisher.start((await f.store.load()).revision, undefined, restored.revision); await f.publisher.waitForIdle();
  const state = f.publisher.snapshot(); assert.equal(state.phase, "waiting");
  const tree = (await f.run(["ls-tree", "-r", "--name-only", state.commit])).stdout;
  assert.ok(!tree.includes("assets/uploads/")); assert.ok(!tree.includes(".cache/"));
  const backups = await readdir(path.join(f.root, ".cache/image-history")); assert.equal(backups.length, 1);
  assert.deepEqual(await readFile(path.join(f.root, ".cache/image-history", backups[0])), png);
});

test("images changed during publication preflight stop the snapshot before a push", async (t) => {
  const f = await fixture(t), initial = await f.imageStore.load(), api = await f.dependencies.getClient();
  const publisher = await createPublisher({ ...f.dependencies, getClient: async () => ({ ...api, repository: async () => {
    await f.imageStore.save("hero", await readFile(path.join(source, "dist/assets/favicon.png")), "image/png", initial.revision);
    return api.repository();
  } }) });
  await publisher.start((await f.store.load()).revision, undefined, initial.revision); await publisher.waitForIdle();
  assert.equal(publisher.snapshot().phase, "error"); assert.match(publisher.snapshot().message, /图片文件已变化/); assert.equal(f.pushes, 0);
});

test("image saves wait until the publication snapshot has finished", async (t) => {
  const f = await fixture(t), initial = await f.imageStore.load();
  let release, captured;
  const ready = new Promise((resolve) => { captured = resolve; });
  const snapshot = f.imageStore.withSnapshot(initial.revision, async () => { captured(); await new Promise((resolve) => { release = resolve; }); });
  await ready;
  let finished = false;
  const saving = f.imageStore.save("hero", await readFile(path.join(source, "dist/assets/favicon.png")), "image/png", initial.revision).then((result) => { finished = true; return result; });
  await new Promise((resolve) => setTimeout(resolve, 25)); assert.equal(finished, false);
  release(); await snapshot; assert.equal((await saving).status, 200);
});
test("stale README revisions stop publication before a push", async (t) => {
  const f = await fixture(t), copy = await f.store.load(), readme = await f.readmeStore.load();
  await f.readmeStore.save("# Preserve the newer README\n", readme.revision);
  await assert.rejects(f.publisher.start(copy.revision, readme.revision), (error) => error.code === "readme_changed" && error.status === 409);
  assert.equal(f.pushes, 0);
  assert.equal((await f.readmeStore.load()).content, "# Preserve the newer README\n");
});
test("README changes during preflight stop the snapshot without committing or pushing", async (t) => {
  const f = await fixture(t), copy = await f.store.load(), readme = await f.readmeStore.load();
  const head = (await f.run(["rev-parse", "HEAD"])).stdout;
  const publisher = await createPublisher({ ...f.dependencies, runGit: async (args, options) => {
    if (args[0] === "ls-remote") await f.readmeStore.save("# Changed during preflight\n", readme.revision);
    return f.dependencies.runGit(args, options);
  } });
  await publisher.start(copy.revision, readme.revision); await publisher.waitForIdle();
  assert.equal(publisher.snapshot().phase, "error"); assert.match(publisher.snapshot().message, /README/);
  assert.equal((await f.run(["rev-parse", "HEAD"])).stdout, head); assert.equal(f.pushes, 0);
});
test("failed workflow remains a failure and unchanged retry dispatches a new run", async (t) => {
  const f = await fixture(t);
  const { revision } = await f.store.load();
  await f.publisher.start(revision); await f.publisher.waitForIdle();
  f.setWorkflow({ id: 50, status: "completed", conclusion: "failure" }); f.advance();
  assert.equal((await f.publisher.inspect()).phase, "error");
  await f.publisher.start(revision); await f.publisher.waitForIdle();
  assert.equal(f.dispatches, 1);
  assert.equal(f.publisher.snapshot().phase, "waiting");
  f.advance();
  assert.equal((await f.publisher.inspect()).phase, "waiting", "retry must wait for a new run instead of reusing the old failure");
});
test("concurrent clicks create one push and stale copy revisions are rejected", async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.publisher.start("0".repeat(64)), (error) => error.status === 409);
  assert.equal(f.pushes, 0);
  const revision = (await f.store.load()).revision;
  const attempts = await Promise.allSettled([f.publisher.start(revision), f.publisher.start(revision)]);
  assert.equal(attempts.filter((attempt) => attempt.status === "fulfilled").length, 1);
  await f.publisher.waitForIdle();
  assert.equal(f.pushes, 1);
});
test("remote commits ahead of this checkout stop publication without force or local data loss", async (t) => {
  const f = await fixture(t);
  const base = (await f.run(["rev-parse", "HEAD"])).stdout;
  const tree = (await f.run(["rev-parse", "HEAD^{tree}"])).stdout;
  const newer = (await f.run(["commit-tree", tree, "-p", base, "-m", "Remote-only commit"])).stdout;
  await f.run(["push", "origin", `${newer}:refs/heads/main`]);
  const before = await readFile(path.join(f.root, "dist/content.json"), "utf8");
  await f.publisher.start((await f.store.load()).revision); await f.publisher.waitForIdle();
  assert.equal(f.publisher.snapshot().phase, "error");
  assert.match(f.publisher.snapshot().message, /远端 main/);
  assert.equal(f.pushes, 0);
  assert.equal((await f.run(["rev-parse", "HEAD"])).stdout, base);
  assert.equal(await readFile(path.join(f.root, "dist/content.json"), "utf8"), before);
});
test("GitHub success without a Pages site does not report a live website", async (t) => {
  const f = await fixture(t);
  await f.publisher.start((await f.store.load()).revision); await f.publisher.waitForIdle();
  f.setWorkflow({ id: 51, status: "completed", conclusion: "success" }); f.setPages(null); f.advance();
  assert.equal((await f.publisher.inspect()).phase, "error");
});
test("copy saves wait while publication captures a consistent snapshot", async (t) => {
  const f = await fixture(t);
  const initial = await f.store.load();
  let release;
  const hold = new Promise((resolve) => { release = resolve; });
  const snapshot = f.store.withSnapshot(initial.revision, async (value) => { await hold; assert.equal((await f.store.load()).revision, value.revision); });
  const saved = f.store.save({ ...initial.content, "hero.note": "等待发布快照结束后保存" }, initial.revision);
  release(); await snapshot;
  assert.equal((await saved).status, 200);
});

test("a temporary push failure retries once using the same immutable commit", async (t) => {
  const f = await fixture(t); f.failNextPush();
  await f.publisher.start((await f.store.load()).revision); await f.publisher.waitForIdle();
  assert.equal(f.pushes, 2);
  assert.equal(f.publisher.snapshot().phase, "waiting");
  assert.ok((await f.run(["ls-remote", "origin", "refs/heads/main"])).stdout.startsWith(f.publisher.snapshot().commit));
  assert.ok(f.publisher.snapshot().logs.some((entry) => entry.message.includes("自动重试")));
});
test("GitHub client ignores unrelated commit runs and enables Pages with the workflow API", async () => {
  const sha = "a".repeat(40), calls = [];
  const client = new GitHubClient("in-memory-token", async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/pages") && options.method === "GET") return new Response("{}", { status: 404 });
    if (url.endsWith("/pages") && options.method === "POST") return Response.json({ html_url: TARGET.siteUrl, build_type: "workflow" }, { status: 201 });
    return Response.json({ workflow_runs: [{ id: 99, head_sha: "b".repeat(40) }, { id: 98, head_sha: sha }] });
  });
  await client.ensurePages();
  assert.deepEqual(JSON.parse(calls[1].options.body), { build_type: "workflow" });
  assert.equal((await client.latestRun(sha)).id, 98);
  assert.ok(calls[2].url.includes(`head_sha=${sha}`));
  const workflow = await readFile(path.join(source, ".github/workflows/pages.yml"), "utf8");
  assert.match(workflow, /path: dist/);
  assert.match(workflow, /pages: write/);
  assert.match(workflow, /id-token: write/);
});
