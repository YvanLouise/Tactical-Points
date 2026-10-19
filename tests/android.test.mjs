import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContentStore } from '../content/store.mjs';
import { createReadmeStore } from '../content/readme-store.mjs';
import { createImageStore } from '../content/image-store.mjs';
import { createLocalServer } from '../server.mjs';
import { nextAndroidVersion, prepareAndroidSnapshot } from '../deploy/android-build.mjs';
import { createAndroidPublisher, uploadAndroidRelease } from '../deploy/android-release.mjs';
import { PublishError } from '../deploy/github.mjs';

const source = fileURLToPath(new URL('../', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function fixture(t) {
  const game = await mkdtemp(path.join(tmpdir(), 'shudian-android-'));
  const root = path.join(game, 'website');
  for (const folder of ['dist', 'content', 'editor']) await mkdir(path.join(root, folder), { recursive: true });
  for (const file of ['dist/content.json', 'dist/index.html', 'content/original.json', 'template.html', 'about.template.html', 'README.md', 'editor/index.html']) await copyFile(path.join(source, file), path.join(root, file));
  await mkdir(path.join(game, 'android_test/.build/keys'), { recursive: true });
  await writeFile(path.join(game, 'android_test/.build/keys/android-test.keystore'), 'fixture key');
  await writeFile(path.join(game, 'project.godot'), '[application]\nconfig/name="Test"\nconfig/version="0.01"\nrun/main_scene="res://scenes/ui/CreatorIntro.tscn"\n[editor_plugins]\nenabled=PackedStringArray("res://addons/editor/plugin.cfg")\n');
  const store = createContentStore(root), readmeStore = createReadmeStore(root), imageStore = createImageStore(root);
  const before = await store.load();
  let builds = 0, uploads = 0, publications = 0, failure = '', releaseState = 'idle', liveUrl = before.content['release.downloadUrl'];
  let buildGate = null;
  const connection = { authenticated: true, message: 'Connected fixture account' };
  const publisher = {
    snapshot: () => ({ phase: releaseState, busy: false }),
    inspect: async () => ({ phase: releaseState, busy: false, commit: 'a'.repeat(40), siteUrl: 'https://yvanlouise.github.io/Tactical-Points/', connection }),
    start: async () => { publications++; releaseState = failure === 'publish' ? 'error' : 'success'; if (releaseState === 'success') liveUrl = (await store.load()).content['release.downloadUrl']; },
    waitForIdle: async () => {},
  };
  const api = { token: 'fixture-token-must-not-persist', repository: async () => ({ permissions: { push: true } }), repoPath: suffix => `/repo${suffix}`, request: async () => [] };
  const dependencies = {
    root, gameRoot: game, store, readmeStore, imageStore, publisher, platform: 'win32', waitMs: 0,
    checkEnvironment: async () => ({ available: true }), getClient: async () => api,
    prepare: async () => ({ sourceDigest: 'b'.repeat(64), capturedAt: new Date().toISOString() }),
    build: async ({ jobRoot, version, onProcess = () => {} }) => {
      onProcess(process.pid); onProcess(null);
      builds++; if (buildGate) await buildGate;
      if (failure === 'build') throw new PublishError('Fixture build failed');
      const output = path.join(jobRoot, 'output'); await mkdir(output, { recursive: true });
      const apk = path.join(output, version.filename), checksum = path.join(output, 'SHA256SUMS.txt'), metadata = path.join(output, 'build-info.json');
      const bytes = Buffer.from('fixture APK payload');
      const info = { version: version.name, version_code: version.versionCode, bytes: bytes.length, sha256: hash(bytes), signature_verified: true, alignment_verified: true, smoke_verified: true };
      await writeFile(apk, bytes); await writeFile(checksum, `${info.sha256}  ${version.filename}\n`); await writeFile(metadata, JSON.stringify(info));
      return { ...info, apk, checksum, metadata };
    },
    upload: async (_api, plan) => { uploads++; if (failure === 'upload') throw new PublishError('Fixture upload failed'); return { id: 2, url: `https://github.com/release/${plan.tag}`, downloadUrl: `https://github.com/download/${plan.tag}/${plan.filename}` }; },
  };
  const manager = await createAndroidPublisher(dependencies);
  const payload = async () => ({ revision: (await store.load()).revision, readmeRevision: (await readmeStore.load()).revision, imageRevision: (await imageStore.load()).revision });
  t.after(async () => { await manager.waitForIdle(); await rm(game, { recursive: true, force: true }); });
  return { root, game, store, manager, api, dependencies, publisher, before, payload, fail: value => { failure = value; }, gate: value => { buildGate = value; }, get builds() { return builds; }, get uploads() { return uploads; }, get publications() { return publications; }, get liveUrl() { return liveUrl; } };
}

test('Android versions advance beyond source and previous releases with increasing versionCode', () => {
  assert.equal(nextAndroidVersion(['0.01']).version, '0.02');
  const next = nextAndroidVersion(['0.01', 'android-test-v0.09', '0.02-android-test']);
  assert.equal(next.version, '0.10'); assert.equal(next.filename, 'shudianpai-0.10-android-test.apk');
  assert.ok(next.versionCode > nextAndroidVersion(['0.08']).versionCode);
  assert.throws(() => nextAndroidVersion(['999.999.999']), /版本号/);
});

test('source snapshot uses the current original project, preserves startup and leaves source and old Android copy untouched', async t => {
  const f = await fixture(t);
  for (const folder of ['scripts/ui', 'scenes/ui', 'assets']) await mkdir(path.join(f.game, folder), { recursive: true });
  await writeFile(path.join(f.game, 'scripts/ui/main_menu.gd'), 'extends Control\nfunc test():\n\tif DisplayServer.get_name() != "headless":\n\t\tpass\n');
  await writeFile(path.join(f.game, 'scripts/ui/menu_settings_view.gd'), 'extends Control\nfunc set_values(settings):\n\t_set_toggle("FullscreenToggle", bool(settings.get("fullscreen", false)))\n');
  await writeFile(path.join(f.game, 'scenes/ui/MainMenu.tscn'), 'latest source scene');
  await writeFile(path.join(f.game, 'assets/latest.txt'), 'current original asset');
  await mkdir(path.join(f.game, 'android_test/project'), { recursive: true });
  await writeFile(path.join(f.game, 'android_test/project/stale.txt'), 'old copy');
  const original = await readFile(path.join(f.game, 'project.godot'));
  const result = await prepareAndroidSnapshot(f.game, path.join(f.game, 'android_test/.build/jobs/snapshot'), nextAndroidVersion(['0.01']));
  const config = await readFile(path.join(result.project, 'project.godot'), 'utf8');
  assert.match(config, /CreatorIntro.tscn/); assert.match(config, /AndroidRuntime=/); assert.match(config, /enabled=PackedStringArray\(\)/);
  assert.match(await readFile(path.join(result.project, 'export_presets.cfg'), 'utf8'), /version\/code=2000/);
  assert.match(await readFile(path.join(result.project, 'scripts/ui/main_menu.gd'), 'utf8'), /not OS.has_feature\("android"\)/);
  assert.equal(await readFile(path.join(result.project, 'assets/latest.txt'), 'utf8'), 'current original asset');
  assert.deepEqual(await readFile(path.join(f.game, 'project.godot')), original);
  assert.equal(await readFile(path.join(f.game, 'android_test/project/stale.txt'), 'utf8'), 'old copy');
  await assert.rejects(prepareAndroidSnapshot(f.game, path.join(f.game, 'outside'), nextAndroidVersion(['0.01'])), /构建目录/);
});

test('failed builds preserve the old download and never upload or publish', async t => {
  const f = await fixture(t); f.fail('build');
  await f.manager.start(await f.payload()); await f.manager.waitForIdle();
  assert.equal(f.manager.snapshot().phase, 'error'); assert.equal(f.uploads, 0); assert.equal(f.publications, 0);
  assert.equal((await f.store.load()).content['release.downloadUrl'], f.before.content['release.downloadUrl']);
  assert.equal(f.liveUrl, f.before.content['release.downloadUrl']);
  await assert.rejects(readFile(path.join(f.game, 'android_test/.build/website-release.lock')), { code: 'ENOENT' });
});

test('failed uploads are resumable without rebuilding and cannot replace the old download early', async t => {
  const f = await fixture(t); f.fail('upload');
  await f.manager.start(await f.payload()); await f.manager.waitForIdle();
  assert.equal(f.manager.snapshot().canRetry, true); assert.equal(f.publications, 0);
  assert.equal((await f.store.load()).content['release.downloadUrl'], f.before.content['release.downloadUrl']);
  f.fail(''); await f.manager.start({ ...await f.payload(), retry: true }); await f.manager.waitForIdle();
  assert.equal(f.manager.snapshot().phase, 'success'); assert.equal(f.builds, 1); assert.equal(f.uploads, 2);
  assert.notEqual(f.liveUrl, f.before.content['release.downloadUrl']);
  const current = await f.store.load();
  assert.match(current.content['release.readyStatus'], /0\.02/);
  assert.match(current.content['faq.download.readyAnswer'], /0\.02/);
  assert.ok(!current.content['modes.footnote'].includes('存在差异'));
  assert.ok(!JSON.stringify(f.manager.snapshot()).includes(f.game));
  assert.ok(!(await readFile(path.join(f.root, '.cache/android-release-state.json'), 'utf8')).includes(f.api.token));
});

test('website deployment failure retries the already uploaded artifact without rebuilding or uploading twice', async t => {
  const f = await fixture(t); f.fail('publish');
  await f.manager.start(await f.payload()); await f.manager.waitForIdle();
  assert.equal(f.manager.snapshot().phase, 'error'); assert.equal(f.liveUrl, f.before.content['release.downloadUrl']);
  f.fail(''); await f.manager.start({ ...await f.payload(), retry: true }); await f.manager.waitForIdle();
  assert.equal(f.manager.snapshot().phase, 'success'); assert.equal(f.builds, 1); assert.equal(f.uploads, 1); assert.equal(f.publications, 2);
});

test('stale saves and concurrent build requests cannot start duplicate builds', async t => {
  const f = await fixture(t);
  await assert.rejects(f.manager.start({ revision: '0'.repeat(64) }), /文案已变化/);
  let release; const gate = new Promise(resolve => { release = resolve; }); f.gate(gate);
  await f.manager.start(await f.payload());
  await assert.rejects(f.manager.start(await f.payload()), /正在进行/);
  release(); await f.manager.waitForIdle(); assert.equal(f.builds, 1);
});

test('a tampered cached APK cannot be resumed', async t => {
  const f = await fixture(t); f.fail('upload');
  await f.manager.start(await f.payload()); await f.manager.waitForIdle();
  const state = JSON.parse(await readFile(path.join(f.root, '.cache/android-release-state.json'), 'utf8'));
  await writeFile(state.artifact.apk, 'changed content');
  await assert.rejects(f.manager.start({ ...await f.payload(), retry: true }), /校验失败/);
  assert.equal(f.uploads, 1); assert.equal(f.publications, 0);
});

test('release upload verifies streamed remote assets before publishing the new release', async t => {
  const f = await fixture(t), plan = nextAndroidVersion(['0.01']);
  const artifact = await f.dependencies.build({ jobRoot: path.join(f.game, 'artifact'), version: plan });
  const release = { id: 7, tag_name: plan.tag, draft: true, assets: [], upload_url: 'https://uploads.github.com/repos/test/releases/7/assets{?name,label}', html_url: 'https://github.com/release/7' };
  const events = [];
  const api = { ...f.api,
    request: async (url, options = {}) => {
      if (url.includes('?per_page')) return events.length ? [release] : [];
      if (options.method === 'POST') { events.push('create'); return release; }
      if (options.method === 'PATCH') { assert.equal(release.assets.length, 3); events.push('publish'); release.draft = false; return release; }
      return release;
    },
    fetcher: async (url, options) => {
      assert.equal(options.redirect, 'error'); assert.equal(options.duplex, 'half');
      const parts = []; for await (const chunk of options.body) parts.push(chunk);
      const bytes = Buffer.concat(parts), name = new URL(url).searchParams.get('name');
      assert.equal(Number(options.headers['Content-Length']), bytes.length);
      const asset = { name, size: bytes.length, state: 'uploaded', digest: `sha256:${hash(bytes)}`, browser_download_url: `https://github.com/download/${plan.tag}/${name}` };
      events.push(name); release.assets.push(asset); return { ok: true, json: async () => asset };
    },
  };
  const result = await uploadAndroidRelease(api, plan, artifact, { sourceDigest: 'a'.repeat(64) });
  assert.ok(result.downloadUrl.endsWith(plan.filename)); assert.equal(events.at(-1), 'publish');
  assert.equal(release.draft, false);
  await writeFile(artifact.checksum, 'bad checksum');
  await assert.rejects(uploadAndroidRelease(api, plan, artifact, {}), /校验文件不一致/);
});

test('Android HTTP actions require origin, editor token and saved revisions, and lock competing saves', async t => {
  const f = await fixture(t); let calls = 0, busy = false;
  const server = await createLocalServer({ root: f.root, port: 0, publisherFactory: async () => f.publisher, androidFactory: async () => ({ snapshot: () => ({ busy }), inspect: async () => ({ available: true, busy, phase: 'idle', connection: { authenticated: true } }), start: async () => { calls++; busy = true; return { phase: 'syncing', busy: true }; } }) });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const state = await fetch(`${origin}/api/editor/content`).then(response => response.json());
  const post = (body, headers = {}) => fetch(`${origin}/api/editor/android-release`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  assert.equal((await post({ revision: state.revision })).status, 403);
  const headers = { Origin: origin, 'X-Editor-Token': state.token };
  assert.equal((await post({ revision: state.revision, retry: 'yes' }, headers)).status, 400);
  assert.equal((await post({ revision: state.revision }, headers)).status, 202); assert.equal(calls, 1);
  const save = await fetch(`${origin}/api/editor/content`, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ content: state.content, revision: state.revision }) });
  assert.equal(save.status, 409);
  const publish = await fetch(`${origin}/api/editor/publish`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: state.revision }) });
  assert.equal(publish.status, 409);
});
