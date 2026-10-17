const $ = (selector) => document.querySelector(selector);
const phases = { idle: "准备发布", checking: "检查发布条件", building: "准备官网内容", pushing: "上传到 GitHub", waiting: "等待部署", deploying: "GitHub 正在部署", success: "官网已上线", error: "发布未完成" };

export function setupPublishing({ getRevision, getToken, hasUnsavedChanges, save }) {
  const dialog = $("#publish-dialog");
  let current = null, polling = null, requesting = false, submitting = false;
  function error(message) { $("#publish-error").textContent = message || ""; $("#publish-error").hidden = !message; }
  function render() {
    if (!current) return;
    const connection = current.connection;
    $("#publish-phase").textContent = phases[current.phase] || current.phase;
    $("#publish-phase").dataset.phase = current.phase;
    $("#publish-message").textContent = current.message;
    $("#publish-account").textContent = connection.signingIn ? "请在浏览器中完成 GitHub 登录…" : connection.message;
    $("#publish-login").hidden = false;
    $("#publish-login").textContent = connection.authenticated ? "重新登录" : "登录 GitHub";
    $("#publish-login").disabled = connection.signingIn || submitting || current.busy;
    $("#publish-start").disabled = requesting || submitting || current.busy || !connection.authenticated;
    $("#publish-start").textContent = current.busy ? "发布中…" : hasUnsavedChanges() ? "保存并发布" : current.phase === "error" ? "重试发布" : "发布已保存的版本";
    const savedAfterStart = current.revision && current.revision !== getRevision();
    $("#publish-unsaved").hidden = !hasUnsavedChanges() && !savedAfterStart;
    $("#publish-unsaved").textContent = hasUnsavedChanges() ? "还有未保存的文案，发布时会先保存当前修改。" : "当前保存的文案与本次发布版本不同，需要再次发布才会在线上生效。";
    $("#publish-commit").textContent = current.commit ? `版本 ${current.commit.slice(0, 7)}` : "首次发布会创建官网站点";
    $("#publish-open").hidden = current.phase !== "success";
    if (current.phase === "success") $("#publish-open").href = current.siteUrl;
    $("#publish-run").hidden = !current.runUrl;
    if (current.runUrl) $("#publish-run").href = current.runUrl;
    const steps = $("#publish-log"); steps.replaceChildren();
    for (const entry of current.logs || []) {
      const item = document.createElement("li");
      const time = document.createElement("time"); time.textContent = new Date(entry.time).toLocaleTimeString("zh-CN", { hour12: false });
      const text = document.createElement("span"); text.textContent = entry.message;
      item.append(time, text); steps.append(item);
    }
  }
  async function api(path, body) {
    const response = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json", "X-Editor-Token": getToken() }, body: JSON.stringify(body) });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || "无法完成发布操作，请重试。");
    return value;
  }
  async function refresh() {
    if (requesting) return;
    requesting = true;
    render();
    try { current = await api("/api/editor/publish"); render(); error(""); }
    catch (failure) { error(failure.message); }
    finally { requesting = false; render(); }
  }
  $("#publish").addEventListener("click", async () => {
    error(""); dialog.showModal(); render();
    $("#publish-phase").textContent = "正在连接 GitHub…";
    await refresh();
    if (!polling) polling = setInterval(() => { if (dialog.open && (current?.busy || current?.connection.signingIn)) refresh(); }, 6000);
  });
  dialog.addEventListener("close", () => { clearInterval(polling); polling = null; });
  $("#publish-close").addEventListener("click", () => dialog.close());
  $("#publish-refresh").addEventListener("click", refresh);
  $("#publish-start").addEventListener("click", async () => {
    if (submitting || current?.busy) return;
    submitting = true; render(); error("");
    try {
      if (hasUnsavedChanges() && !await save()) { dialog.close(); return; }
      current = await api("/api/editor/publish", { revision: getRevision() }); render();
    } catch (failure) { error(failure.message); }
    finally { submitting = false; render(); }
  });
  $("#publish-login").addEventListener("click", async () => {
    submitting = true; render(); error("");
    try { current = await api("/api/editor/github/login", {}); render(); }
    catch (failure) { error(failure.message); }
    finally { submitting = false; render(); }
  });
}
