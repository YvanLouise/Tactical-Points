const $ = selector => document.querySelector(selector);
const phases = { idle: '准备更新', checking: '检查环境', syncing: '同步最新源码', building: '构建与校验', uploading: '上传安装包', publishing: '更新官网下载', success: '更新完成', error: '更新未完成' };
const order = ['checking', 'syncing', 'building', 'uploading', 'publishing', 'success'];

export function setupAndroidPublishing({ getRevision, getReadmeRevision, getImageRevision, getToken, save, onContentChange, onBusyChange }) {
  const dialog = $('#android-dialog');
  let current = null, polling = null, refreshing = false, submitting = false, synchronized = '';
  const error = text => { $('#android-error').textContent = text || ''; $('#android-error').hidden = !text; };
  async function api(path, body) {
    const response = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Editor-Token': getToken() }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '暂时无法更新安装包，请重试。');
    return result;
  }
  function render() {
    if (!current) return;
    const busy = submitting || current.busy;
    onBusyChange(Boolean(busy));
    $('#android-phase').textContent = phases[current.phase] || current.phase;
    $('#android-phase').dataset.phase = current.phase;
    $('#android-message').textContent = current.message;
    $('#android-environment').textContent = current.reason || '';
    $('#android-account').textContent = current.connection?.message || '正在检查 GitHub 登录…';
    $('#android-start').disabled = busy || !current.available || !current.connection?.authenticated;
    $('#android-start').textContent = busy ? '正在更新…' : '打包最新版并更新网站';
    $('#android-retry').hidden = !current.canRetry;
    $('#android-retry').disabled = busy || !current.available || !current.connection?.authenticated;
    $('#android-login').disabled = busy || current.connection?.signingIn;
    $('#android-login').hidden = Boolean(current.connection?.authenticated);
    $('#android-version').textContent = current.artifact ? `${current.artifact.version} · ${Math.ceil(current.artifact.bytes / 1000000)} MB` : current.plan ? `准备版本 ${current.plan.version}` : '版本号自动递增';
    $('#android-download').hidden = !current.release?.downloadUrl;
    if (current.release?.downloadUrl) $('#android-download').href = current.release.downloadUrl;
    $('#android-site').hidden = current.phase !== 'success';
    $('#android-site').href = current.siteUrl;
    $('#android-run').hidden = !current.runUrl;
    if (current.runUrl) $('#android-run').href = current.runUrl;
    const index = order.indexOf(current.phase === 'error' ? current.failedPhase : current.phase);
    for (const [step, node] of [...$('#android-steps').children].entries()) { node.classList.toggle('is-done', step < index || current.phase === 'success'); node.classList.toggle('is-current', step === index); }
    $('#android-log').replaceChildren();
    for (const entry of current.logs || []) {
      const li = document.createElement('li'), time = document.createElement('time'), text = document.createElement('span');
      time.textContent = new Date(entry.time).toLocaleTimeString('zh-CN', { hour12: false }); text.textContent = entry.message;
      li.append(time, text); $('#android-log').append(li);
    }
  }
  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    try {
      current = { ...current, ...await api('/api/editor/android-release') };
      render(); error('');
      const key = `${current.jobId}:${current.updatedAt}:${current.phase}`;
      if (current.release && ['success', 'error'].includes(current.phase) && key !== synchronized) { await onContentChange(); synchronized = key; }
      if (!dialog.open && !current.busy) { clearInterval(polling); polling = null; }
    } catch (failure) { error(failure.message); }
    finally { refreshing = false; }
  }
  function watch() { if (!polling) polling = setInterval(() => { if (dialog.open || current?.busy) refresh(); }, 1800); }
  $('#android-open').addEventListener('click', async () => { dialog.showModal(); error(''); await refresh(); watch(); });
  $('#android-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { if (!current?.busy) { clearInterval(polling); polling = null; } });
  $('#android-refresh').addEventListener('click', refresh);
  async function start(retry) {
    if (submitting || current?.busy) return;
    submitting = true; render(); error('');
    try {
      // Save first; the server then locks content writes for this job.
      if (!await save()) { dialog.close(); return; }
      const response = await api('/api/editor/android-release', { revision: getRevision(), readmeRevision: getReadmeRevision(), imageRevision: getImageRevision(), retry });
      current = { ...current, ...response }; render(); watch();
    } catch (failure) { error(failure.message); }
    finally { submitting = false; render(); }
  }
  $('#android-start').addEventListener('click', () => start(false));
  $('#android-retry').addEventListener('click', () => start(true));
  $('#android-login').addEventListener('click', async () => { try { await api('/api/editor/github/login', {}); await refresh(); watch(); } catch (failure) { error(failure.message); } });
}
