import { readFile, writeFile, mkdir, open, unlink, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { GitHubClient, PublishError, readCredential } from './github.mjs';
import { atomicWrite } from '../content/store.mjs';
import { TARGET } from './target.mjs';
import { findGameRoot, nextAndroidVersion, prepareAndroidSnapshot, buildAndroidArtifact, checkAndroidEnvironment } from './android-build.mjs';

const active = new Set(['checking', 'syncing', 'building', 'uploading', 'publishing']);
const publicFailure = error => error instanceof PublishError ? error.message : '安装包更新未完成，请查看本机构建记录后重试。';
const exists = file => stat(file).then(() => true, () => false);
const sha256 = async file => { const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest('hex'); };
const alive = pid => { if (!Number.isInteger(pid) || pid <= 0) return false; try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };

export function androidDownloadCopy(content, artifact, url) {
  const version = artifact.version.replace(/-android-test.*$/, '');
  const mb = Math.ceil(artifact.bytes / 1000000);
  const answer = `安卓测试版 ${version} 已开放下载，支持 Android 7.0 及以上，需要 OpenGL ES 3.0，安装包约 ${mb} MB。下载 APK 后打开安装，按系统提示允许该来源安装应用。本包由构建时的最新原版源码生成，使用同一测试签名，可覆盖升级。`;
  return { ...content, 'release.downloadUrl': url, 'release.readyStatus': `Android 测试版 ${version}`, 'release.message': `Android 测试版 ${version} 已更新，包含本次构建时的最新游戏源码及安卓适配。安装包约 ${mb} MB，支持 Android 7.0 及以上。\n游戏仍在开发中，欢迎体验并反馈问题；历史安装包保留在 GitHub 发布记录中。`, 'faq.download.answer': answer, 'faq.download.readyAnswer': answer, 'modes.footnote': content['modes.footnote'].replace(/页面展示最新开发版内容，与当前可下载的安卓[^。]*。/g, '').trim() };
}

export async function uploadAndroidRelease(api, plan, artifact, source, onProgress = () => {}) {
  if (await sha256(artifact.apk) !== artifact.sha256 || (await stat(artifact.apk)).size !== artifact.bytes) throw new PublishError('安装包在校验后发生变化，请重新打包。', 400);
  if ((await readFile(artifact.checksum, 'utf8')).trim() !== `${artifact.sha256}  ${plan.filename}`) throw new PublishError('安装包校验文件不一致，请重新打包。', 400);
  const metadata = JSON.parse(await readFile(artifact.metadata, 'utf8'));
  if (metadata.sha256 !== artifact.sha256 || metadata.version !== plan.name || metadata.version_code !== plan.versionCode || !metadata.signature_verified || !metadata.smoke_verified || !metadata.alignment_verified) throw new PublishError('安装包构建记录不一致，请重新打包。', 400);
  const repository = await api.repository();
  if (!repository.permissions?.push || repository.archived || repository.disabled) throw new PublishError('当前 GitHub 账号没有此仓库的安装包发布权限。', 403);
  const releases = await api.request(api.repoPath('/releases?per_page=100'));
  let release = releases.find(item => item.tag_name === plan.tag);
  const notes = `安卓测试版 ${plan.version}\n\n基于管理页构建时的原版游戏源码，包含横屏、触控与安卓返回键适配。\n\n- Android 7.0+ / OpenGL ES 3.0\n- ARMv7、ARM64、x86_64\n- versionCode: ${plan.versionCode}\n- 源码指纹: ${source.sourceDigest}\n\n已校验签名、启动清单、16 KB 对齐与 APK 内资源导航。尚需安卓设备性能及触摸体验实测。`;
  if (!release) release = await api.request(api.repoPath('/releases'), { method: 'POST', body: { tag_name: plan.tag, name: `术点牌 Android 测试版 ${plan.version}`, draft: true, prerelease: true, body: notes } });
  for (const file of [artifact.apk, artifact.checksum, artifact.metadata]) {
    const name = path.basename(file), info = await stat(file), digest = await sha256(file);
    let asset = release.assets.find(item => item.name === name);
    if (!asset) {
      const url = new URL(release.upload_url.split('{')[0]); url.searchParams.set('name', name);
      let sent = 0;
      async function* body() { for await (const chunk of createReadStream(file)) { sent += chunk.length; onProgress(name, sent, info.size); yield chunk; } }
      const response = await api.fetcher(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15 * 60 * 1000), duplex: 'half', headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${api.token}`, 'X-GitHub-Api-Version': '2026-03-10', 'Content-Type': name.endsWith('.apk') ? 'application/vnd.android.package-archive' : 'application/octet-stream', 'Content-Length': String(info.size) }, body: body() });
      if (!response.ok) throw new PublishError(`安装包上传失败（HTTP ${response.status}），可重试上次发布。`, 502);
      asset = await response.json();
    }
    if (asset.state !== 'uploaded' || asset.size !== info.size || asset.digest !== `sha256:${digest}`) throw new PublishError(`远端文件校验不一致：${name}。旧版本下载入口保留。`, 502);
  }
  if (release.draft) await api.request(api.repoPath(`/releases/${release.id}`), { method: 'PATCH', body: { draft: false, prerelease: true, make_latest: 'false', body: notes } });
  release = await api.request(api.repoPath(`/releases/${release.id}`));
  const apk = release.assets.find(item => item.name === plan.filename);
  if (release.draft || !apk?.browser_download_url || apk.browser_download_url.includes('/untagged-')) throw new PublishError('安装包发布地址尚未就绪，请重试上次发布。', 502);
  return { id: release.id, url: release.html_url, downloadUrl: apk.browser_download_url };
}

export async function createAndroidPublisher({ root, store, publisher, readmeStore, imageStore, gameRoot: suppliedRoot, platform = process.platform, getClient = async () => new GitHubClient(await readCredential(root)), prepare = prepareAndroidSnapshot, build = buildAndroidArtifact, upload = uploadAndroidRelease, checkEnvironment = checkAndroidEnvironment, waitMs = 4000 }) {
  const gameRoot = suppliedRoot || await findGameRoot(root);
  const stateFile = path.join(root, '.cache/android-release-state.json');
  const lockFile = gameRoot && path.join(gameRoot, 'android_test/.build/website-release.lock');
  let state = { phase: 'idle', message: '从原版源码打包并更新官网安卓下载。', jobId: null, logs: [], artifact: null, plan: null, source: null, release: null };
  try { state = { ...state, ...JSON.parse(await readFile(stateFile, 'utf8')) }; if (active.has(state.phase)) { state.phase = 'error'; state.message = '本地服务曾中断。若已有通过校验的安装包，可重试上次发布。'; } } catch {}
  let task = null, starting = false, ownedLock = false, lockWrites = Promise.resolve();
  async function transition(phase, message, extra = {}) {
    state = { ...state, ...extra, phase, message, updatedAt: new Date().toISOString(), logs: [...state.logs.slice(-35), { time: new Date().toISOString(), message }] };
    await mkdir(path.dirname(stateFile), { recursive: true });
    await atomicWrite(stateFile, JSON.stringify(state, null, 2) + '\n');
  }
  async function availability() {
    if (platform !== 'win32') return { available: false, reason: '请在 Windows 本地管理页使用安装包构建功能。' };
    if (!gameRoot) return { available: false, reason: '未找到完整原版游戏工程，请从游戏目录下的 website 启动管理页。' };
    if (!await exists(path.join(gameRoot, 'android_test/.build/keys/android-test.keystore'))) return { available: false, reason: '缺少原安卓测试签名，请先恢复 android_test/.build/keys/android-test.keystore，以便覆盖升级。' };
    const environment = await checkEnvironment(gameRoot);
    if (!environment.available) return environment;
    return { available: true, reason: '使用原版源码与原测试签名，成功后自动更新官网的下载入口。' };
  }
  function snapshot() { return { ...state, artifact: state.artifact && { version: state.artifact.version, bytes: state.artifact.bytes, sha256: state.artifact.sha256 }, source: state.source && { sourceDigest: state.source.sourceDigest, capturedAt: state.source.capturedAt }, busy: starting || Boolean(task), canRetry: !task && state.phase === 'error' && Boolean(state.artifact), siteUrl: TARGET.siteUrl }; }
  async function inspect() { return { ...snapshot(), ...await availability(), connection: (await publisher.inspect()).connection }; }
  async function acquire() {
    await mkdir(path.dirname(lockFile), { recursive: true });
    try { const file = await open(lockFile, 'wx'); await file.writeFile(JSON.stringify({ pid: process.pid, jobId: state.jobId })); await file.close(); ownedLock = true; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const lock = await readFile(lockFile, 'utf8').then(JSON.parse).catch(() => null);
      if (!lock || alive(lock.pid) || alive(lock.childPid)) throw new PublishError('已有安装包构建进程正在运行，请等待其完成。', 409);
      await unlink(lockFile); await acquire();
    }
  }
  async function publishWebsite() {
    const before = await store.load();
    const saved = await store.save(androidDownloadCopy(before.content, state.artifact, state.release.downloadUrl), before.revision);
    if (saved.status !== 200) throw new PublishError(saved.error, saved.status);
    const readme = state.readmeRevision ? await readmeStore.load() : null;
    const images = await imageStore.load();
    if (readme && readme.revision !== state.readmeRevision) throw new PublishError('README 在打包期间发生变化，请保存后重试上次发布。', 409);
    await publisher.start(saved.revision, readme?.revision, images.revision);
    await publisher.waitForIdle();
    for (let attempt = 0; attempt < 150; attempt++) {
      const website = await publisher.inspect();
      if (website.phase === 'error') throw new PublishError('安装包已上传，但官网部署未完成。可重试上次发布；线上旧入口仍可使用。', 502);
      if (website.phase === 'success') return website;
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }
    throw new PublishError('安装包已上传，GitHub Pages 仍在部署。可刷新发布面板或重试上次发布。', 502);
  }
  async function perform(retry) {
    const api = await getClient();
    const repository = await api.repository();
    if (!repository.permissions?.push || repository.archived || repository.disabled) throw new PublishError('GitHub 账号没有安装包发布权限。', 403);
    await acquire();
    try {
      if (!retry) {
        const releases = await api.request(api.repoPath('/releases?per_page=100'));
        const copy = await store.load();
        const config = await readFile(path.join(gameRoot, 'project.godot'), 'utf8');
        const published = /android-test-v([\d.]+)/.exec(copy.content['release.downloadUrl'])?.[1];
        const plan = nextAndroidVersion([published, /config\/version="([^"]+)"/.exec(config)?.[1], ...releases.map(item => item.tag_name).filter(tag => tag.startsWith('android-test-v'))]);
        const jobRoot = path.join(gameRoot, 'android_test/.build/website-jobs', state.jobId);
        await transition('syncing', `正在同步原版源码，准备安卓 ${plan.version}…`, { plan });
        const source = await prepare(gameRoot, jobRoot, plan);
        await transition('building', '正在导入资源、构建 APK，并校验签名、对齐及包内导航…', { source });
        const artifact = await build({ gameRoot, jobRoot, version: plan, onLine: () => {}, onProcess: childPid => { lockWrites = lockWrites.then(() => writeFile(lockFile, JSON.stringify({ pid: process.pid, childPid, jobId: state.jobId }))).catch(() => {}); } });
        await transition('uploading', '安装包校验通过，正在上传新版本…', { artifact });
      }
      if (!state.release) {
        await transition('uploading', '正在上传并核对远端安装包与 SHA-256…');
        let progressAt = 0;
        const release = await upload(api, state.plan, state.artifact, state.source, (_name, sent, total) => { if (Date.now() - progressAt > 2000 && total > 1000000) { progressAt = Date.now(); state.message = `正在上传安装包：${Math.floor(sent / total * 100)}%`; } });
        await transition('publishing', '安装包已上传，正在替换官网下载入口并部署网站…', { release });
      }
      await transition('publishing', '正在更新并部署官网的安装包下载入口…');
      const website = await publishWebsite();
      await transition('success', '新安装包与官网下载入口均已更新。', { commit: website.commit, runUrl: website.runUrl });
    } finally { if (ownedLock) { await lockWrites.catch(() => {}); await unlink(lockFile).catch(() => {}); ownedLock = false; } }
  }
  async function start(payload) {
    if (task || starting || publisher.snapshot().busy) throw new PublishError('已有构建或官网发布正在进行，请等待完成。', 409);
    starting = true;
    try {
      const available = await availability();
      if (!available.available) throw new PublishError(available.reason, 400);
      if ((await store.load()).revision !== payload.revision) throw new PublishError('官网文案已变化，请先保存并重新读取。', 409);
      if (payload.readmeRevision && (await readmeStore.load()).revision !== payload.readmeRevision) throw new PublishError('README 已变化，请先保存后重试。', 409);
      if (payload.imageRevision && (await imageStore.load()).revision !== payload.imageRevision) throw new PublishError('图片已变化，请先保存后重试。', 409);
      if (payload.retry && (!state.artifact || !await exists(state.artifact.apk) || await sha256(state.artifact.apk) !== state.artifact.sha256)) throw new PublishError('上次安装包不存在或校验失败，请重新打包。', 400);
      if (!payload.retry) state = { phase: 'idle', jobId: randomUUID(), logs: [], artifact: null, plan: null, source: null, release: null };
      await transition('checking', '正在检查构建环境与 GitHub 发布条件…', { readmeRevision: payload.readmeRevision });
      task = perform(Boolean(payload.retry)).catch(error => transition('error', publicFailure(error), { failedPhase: state.phase })).finally(() => { task = null; });
      return snapshot();
    } finally { starting = false; }
  }
  return { inspect, snapshot, start, waitForIdle: async () => { await task; } };
}
