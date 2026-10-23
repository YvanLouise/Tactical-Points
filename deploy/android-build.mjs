import { readdir, readFile, writeFile, mkdir, realpath, stat, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PublishError } from './github.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const resourceFolders = ['assets', 'data', 'music', 'scenes', 'scripts', 'shaders', 'tools'];
const exists = file => stat(file).then(() => true, () => false);
const inside = (root, file) => { const relative = path.relative(root, file); return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); };

export async function findGameRoot(websiteRoot) {
  let candidate = path.resolve(websiteRoot);
  while (true) {
    if (await exists(path.join(candidate, 'project.godot')) && await exists(path.join(candidate, 'scenes/ui/MainMenu.tscn'))) return candidate;
    const parent = path.dirname(candidate);
    if (parent === candidate) return null;
    candidate = parent;
  }
}

export async function checkAndroidEnvironment(gameRoot) {
  const local = process.env.LOCALAPPDATA || '';
  const godot = process.env.GODOT_PATH || path.join(gameRoot, 'android_test/.build/godot/Godot_v4.7-stable_win64.exe');
  const sdk = process.env.ANDROID_HOME || path.join(local, 'Android/Sdk');
  const java = process.env.JAVA_HOME || path.join(local, 'Programs/Eclipse Adoptium/jdk-17.0.18.8-hotspot');
  const checks = [[godot, '未找到 Godot 4.7，可通过 GODOT_PATH 指定本机编辑器。'], [path.join(sdk, 'platform-tools/adb.exe'), '未找到 Android SDK，可通过 ANDROID_HOME 指定。'], [path.join(java, 'bin/java.exe'), '未找到 JDK 17，可通过 JAVA_HOME 指定。']];
  for (const [file, reason] of checks) if (!await exists(file)) return { available: false, reason };
  const tools = await readdir(path.join(sdk, 'build-tools'), { withFileTypes: true }).catch(() => []);
  if (!tools.some(entry => entry.isDirectory() && /^\d+\.\d+\.\d+$/.test(entry.name))) return { available: false, reason: 'Android SDK 尚未安装 build-tools。' };
  const templates = [path.join(process.env.APPDATA || '', 'Godot/export_templates/4.7.stable/android_debug.apk'), path.join(gameRoot, 'android_test/.build/godot/editor_data/export_templates/4.7.stable/android_debug.apk')];
  if (!await Promise.all(templates.map(exists)).then(values => values.some(Boolean))) return { available: false, reason: '未找到 Godot 4.7 安卓导出模板。' };
  return { available: true };
}

export function nextAndroidVersion(versions) {
  const parsed = versions.filter(Boolean).map(value => String(value).replace(/^android-test-v/, '').replace(/-android-test.*$/, '')).filter(value => /^\d+(?:\.\d+){1,2}$/.test(value));
  const compare = (a, b) => { const aa = a.split('.').map(Number), bb = b.split('.').map(Number); for (let i = 0; i < 3; i++) if ((aa[i] || 0) !== (bb[i] || 0)) return (aa[i] || 0) - (bb[i] || 0); return 0; };
  const parts = (parsed.sort(compare).at(-1) || '0.00').split('.');
  parts[parts.length - 1] = String(Number(parts.at(-1)) + 1).padStart(parts.at(-1).length, '0');
  const version = parts.join('.');
  const numbers = parts.map(Number);
  const code = numbers[0] * 1000000 + numbers[1] * 1000 + (numbers[2] || 0);
  if (numbers.some(value => value > 999) || !Number.isSafeInteger(code) || code <= 0 || code > 2100000000) throw new PublishError('版本号超出安卓支持范围，请调整原版工程的版本号。');
  return { version, versionCode: code, name: `${version}-android-test`, filename: `shudianpai-${version}-android-test.apk`, tag: `android-test-v${version}` };
}

export function setGodotSetting(text, section, key, value) {
  const lines = text.replaceAll('\r', '').split('\n');
  let start = lines.indexOf(`[${section}]`);
  if (start < 0) { lines.push('', `[${section}]`, '', `${key}=${value}`); return lines.join('\n'); }
  let end = lines.findIndex((line, index) => index > start && /^\[/.test(line));
  if (end < 0) end = lines.length;
  const index = lines.findIndex((line, i) => i > start && i < end && line.startsWith(`${key}=`));
  if (index >= 0) lines[index] = `${key}=${value}`; else lines.splice(end, 0, `${key}=${value}`, '');
  return lines.join('\n');
}

async function sourceFiles(root) {
  const files = [];
  async function walk(folder) {
    for (const entry of await readdir(path.join(root, folder), { withFileTypes: true })) {
      const relative = path.join(folder, entry.name);
      if (entry.isSymbolicLink()) throw new PublishError(`源码包含符号链接，无法创建独立构建副本：${relative}`);
      if (entry.isDirectory()) await walk(relative);
      else if (entry.isFile() && !/\.(tmp|bak)$/.test(entry.name)) files.push(relative);
    }
  }
  for (const folder of resourceFolders) if (await exists(path.join(root, folder))) await walk(folder);
  for (const filename of ['project.godot', 'icon.png', 'icon.png.import', 'icon.svg', 'icon.svg.import']) if (await exists(path.join(root, filename))) files.push(filename);
  return files.sort();
}

export async function prepareAndroidSnapshot(gameRoot, jobRoot, version) {
  gameRoot = await realpath(gameRoot);
  const buildRoot = path.join(gameRoot, 'android_test/.build');
  if (!inside(buildRoot, path.resolve(jobRoot))) throw new PublishError('构建目录必须位于独立安卓目录内。');
  const project = path.join(jobRoot, 'project');
  await mkdir(project, { recursive: true });
  if (!inside(await realpath(buildRoot), await realpath(project))) throw new PublishError('构建目录指向了工程之外。');
  const paths = await sourceFiles(gameRoot);
  const hash = createHash('sha256');
  const fingerprints = [];
  for (const relative of paths) {
    const file = path.join(gameRoot, relative), destination = path.join(project, relative);
    const bytes = await readFile(file);
    const fingerprint = createHash('sha256').update(bytes).digest('hex');
    fingerprints.push([relative, fingerprint]);
    hash.update(relative.replaceAll('\\', '/')).update('\0').update(fingerprint).update('\n');
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
  }
  for (const [relative, fingerprint] of fingerprints) {
    if (createHash('sha256').update(await readFile(path.join(gameRoot, relative))).digest('hex') !== fingerprint) throw new PublishError('同步期间游戏源码发生变化，请在保存工程后重试。');
  }
  let config = await readFile(path.join(project, 'project.godot'), 'utf8');
  const sourceVersion = /config\/version="([^"]*)"/.exec(config)?.[1] || '';
  const settings = {
    application: { 'config/name': '"术点牌 安卓测试版"', 'config/version': JSON.stringify(version.name), 'config/quit_on_go_back': 'false', 'config/features': 'PackedStringArray("4.7", "GL Compatibility")', 'config/icon': '"res://icon.png"', 'run/max_fps.android': '60' },
    autoload: { AndroidRuntime: '"*res://scripts/platform/android_runtime.gd"' },
    display: { 'window/stretch/aspect': '"expand"', 'window/handheld/orientation': '4', 'window/size/mode': '3', 'window/frame_pacing/android/enable_frame_pacing': 'true', 'window/frame_pacing/android/swappy_mode': '0' },
    input_devices: { 'pointing/emulate_mouse_from_touch': 'true', 'pointing/emulate_touch_from_mouse': 'false' },
    editor_plugins: { enabled: 'PackedStringArray()' },
    editor: { 'import/use_multiple_threads': 'false' },
    rendering: { 'renderer/rendering_method': '"gl_compatibility"', 'renderer/rendering_method.mobile': '"gl_compatibility"', 'textures/vram_compression/import_etc2_astc': 'true' },
  };
  for (const [section, fields] of Object.entries(settings)) for (const [key, value] of Object.entries(fields)) config = setGodotSetting(config, section, key, value);
  await writeFile(path.join(project, 'project.godot'), config);
  await mkdir(path.join(project, 'scripts/platform'), { recursive: true });
  await copyFile(path.join(here, 'android-runtime.gd'), path.join(project, 'scripts/platform/android_runtime.gd'));
  const mainFile = path.join(project, 'scripts/ui/main_menu.gd');
  let main = await readFile(mainFile, 'utf8');
  main = main.replace('if DisplayServer.get_name() != "headless":', 'if not OS.has_feature("android") and DisplayServer.get_name() != "headless":');
  await writeFile(mainFile, main);
  const settingsFile = path.join(project, 'scripts/ui/menu_settings_view.gd');
  let view = await readFile(settingsFile, 'utf8');
  const toggle = '\t_set_toggle("FullscreenToggle", bool(settings.get("fullscreen", false)))';
  if (!view.includes(toggle)) throw new PublishError('设置页面结构已变化，请先更新安卓适配。');
  view = view.replace(toggle, '\t_set_toggle("FullscreenToggle", true if OS.has_feature("android") else bool(settings.get("fullscreen", false)))\n\t_controls["FullscreenToggle"].disabled = OS.has_feature("android")');
  await writeFile(settingsFile, view);
  const preset = `[preset.0]\nname="Android Test"\nplatform="Android"\nrunnable=true\nexport_filter="all_resources"\ninclude_filter="data/*.json,data/credits/*.json,data/credits/*.txt,assets/fonts/*OFL.txt,assets/fonts/SOURCES.txt"\nexclude_filter="tools/*,*.md,assets/characters/*.json"\nscript_export_mode=2\n\n[preset.0.options]\ngradle_build/use_gradle_build=false\narchitectures/armeabi-v7a=true\narchitectures/arm64-v8a=true\narchitectures/x86=false\narchitectures/x86_64=true\nversion/code=${version.versionCode}\nversion/name="${version.name}"\npackage/unique_name="com.yvanlouise.shudianpai.androidtest"\npackage/name="术点牌 安卓测试版"\npackage/signed=true\nlauncher_icons/main_192x192="res://icon.png"\nlauncher_icons/adaptive_foreground_432x432="res://icon.png"\nscreen/immersive_mode=true\nscreen/edge_to_edge=true\nscreen/background_color=Color(0.82, 0.82, 0.8, 1)\nuser_data_backup/allow=false\npermissions/internet=false\npermissions/access_network_state=false\npermissions/read_external_storage=false\npermissions/write_external_storage=false\n`;
  await writeFile(path.join(project, 'export_presets.cfg'), preset);
  const info = { sourceVersion, sourceDigest: hash.digest('hex'), sourceFiles: paths.length, capturedAt: new Date().toISOString() };
  await writeFile(path.join(jobRoot, 'source.json'), JSON.stringify(info, null, 2));
  return { project, ...info };
}

export async function buildAndroidArtifact({ gameRoot, jobRoot, version, onLine = () => {}, onProcess = () => {}, spawnProcess = spawn }) {
  const output = path.join(jobRoot, 'output');
  await mkdir(output, { recursive: true });
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(here, 'build-android.ps1'), '-WorkspaceRoot', gameRoot, '-ProjectRoot', path.join(jobRoot, 'project'), '-OutputRoot', output, '-Version', version.name, '-VersionCode', String(version.versionCode), '-ApkFileName', version.filename];
  const log = [];
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawnProcess('powershell.exe', args, { cwd: gameRoot, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    onProcess(child.pid);
    const streams = [];
    const record = line => { log.push(line); if (log.length > 80) log.shift(); onLine(line); };
    for (const stream of [child.stdout, child.stderr]) {
      const state = { decoder: new StringDecoder('utf8'), pending: '' };
      streams.push(state);
      stream.on('data', bytes => {
        state.pending += state.decoder.write(bytes);
        const lines = state.pending.split(/\r?\n/); state.pending = lines.pop(); lines.forEach(record);
      });
    }
    child.once('error', reject);
    child.once('close', code => { for (const stream of streams) { const remaining = stream.pending + stream.decoder.end(); if (remaining) record(remaining); } onProcess(null); resolve(code); });
  });
  await writeFile(path.join(output, 'build-console.log'), log.join('\n') + '\n');
  if (exitCode !== 0) {
    const diagnostic = await readFile(path.join(output, 'build-error.json'), 'utf8').then(JSON.parse).catch(() => null);
    const labels = { import: '资源导入', export: '安装包导出', signature: '签名与版本校验', smoke: '包内导航校验', checksum: '校验记录生成' };
    const phase = labels[diagnostic?.stage] || '构建或校验';
    const code = Number.isInteger(diagnostic?.exitCode) && diagnostic.exitCode !== 0 ? `（Godot 退出码 0x${(diagnostic.exitCode >>> 0).toString(16).toUpperCase().padStart(8, '0')}）` : '';
    const summary = diagnostic?.message ? ` ${diagnostic.message}` : '';
    throw new PublishError(`安卓${phase}未通过${code}。${summary} 本次任务日志：${path.relative(gameRoot, path.join(output, 'build-console.log')).replaceAll('\\', '/')}`, 500, 'android_build_failed');
  }
  const info = JSON.parse(await readFile(path.join(output, 'build-info.json'), 'utf8'));
  const apk = path.join(output, version.filename);
  const infoFile = await stat(apk);
  const hash = createHash('sha256');
  const { createReadStream } = await import('node:fs');
  for await (const chunk of createReadStream(apk)) hash.update(chunk);
  if (info.version !== version.name || info.version_code !== version.versionCode || info.bytes !== infoFile.size || info.sha256 !== hash.digest('hex') || !info.signature_verified || !info.alignment_verified || !info.smoke_verified) throw new PublishError('构建产物的版本、签名或校验记录不一致。', 500);
  return { ...info, apk, checksum: path.join(output, 'SHA256SUMS.txt'), metadata: path.join(output, 'build-info.json') };
}
