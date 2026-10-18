import { renderMarkdown } from "./markdown.js";

const $ = (selector) => document.querySelector(selector);
const bytesOf = (text) => new TextEncoder().encode(text).length;

export function createReadmeEditor({ getToken, onChange, onError }) {
  const source = $("#readme-source");
  let draft = "", saved = "", revision = null, maxBytes = 128 * 1024, loaded = false, saving = false, exists = false;
  let history = [], future = [], editedAt = 0, previewQueued = false;
  const state = () => ({ dirty: draft !== saved, loaded, saving, revision, canUndo: history.length > 0, canRedo: future.length > 0 });
  function update() {
    const bytes = bytesOf(draft);
    if (source.value !== draft) source.value = draft;
    source.disabled = !loaded;
    source.setAttribute("aria-invalid", String(bytes > maxBytes));
    $("#readme-metrics").textContent = `${draft.length.toLocaleString("zh-CN")} 字符 · ${(bytes / 1024).toFixed(1)} / ${maxBytes / 1024} KB`;
    $("#readme-metrics").classList.toggle("is-invalid", bytes > maxBytes);
    for (const button of $("#readme-format").querySelectorAll("button")) button.disabled = !loaded;
    $("#readme-clear").disabled = !loaded || !draft || saving;
    if (!previewQueued) {
      previewQueued = true;
      requestAnimationFrame(() => { previewQueued = false; renderMarkdown(draft, $("#readme-preview")); });
    }
    onChange();
  }
  function checkpoint(typing = false) {
    const now = Date.now();
    if (!typing || !editedAt || now - editedAt > 900) { history.push(draft); if (history.length > 100) history.shift(); }
    editedAt = typing ? now : 0; future = [];
  }
  function change(value, typing = false) {
    if (value === draft) return;
    checkpoint(typing); draft = value; onError(""); update();
  }
  source.addEventListener("input", () => change(source.value, true));
  $("#readme-clear").addEventListener("click", () => { if (loaded && !saving) change(""); });
  source.addEventListener("blur", () => { editedAt = 0; });
  $("#readme-format").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-format]");
    if (!button || !loaded) return;
    const start = source.selectionStart, end = source.selectionEnd;
    const selected = draft.slice(start, end);
    const formats = { heading: ["## ", "", "小标题"], bold: ["**", "**", "重点内容"], list: ["- ", "", "列表内容"], link: ["[", "](https://)", "链接文字"], code: ["```\n", "\n```", "代码或命令"] };
    let [before, after, placeholder] = formats[button.dataset.format];
    if (["heading", "list", "code"].includes(button.dataset.format) && start && draft[start - 1] !== "\n") before = "\n" + before;
    if (["heading", "list", "code"].includes(button.dataset.format) && end < draft.length && draft[end] !== "\n") after += "\n";
    const text = selected || placeholder;
    change(draft.slice(0, start) + before + text + after + draft.slice(end));
    source.focus(); source.setSelectionRange(start + before.length, start + before.length + text.length);
  });
  function undo() {
    if (!history.length || saving) return;
    future.push(draft); draft = history.pop(); editedAt = 0; onError(""); update();
  }
  function redo() {
    if (!future.length || saving) return;
    history.push(draft); draft = future.pop(); editedAt = 0; onError(""); update();
  }
  function discard() { if (draft !== saved) change(saved); }
  async function load() {
    try {
      const response = await fetch("/api/editor/readme");
      const result = await response.json();
      if (response.status === 404) throw new Error("当前服务仍是旧版本。请关闭原来的编辑器终端，重新双击 start-editor.cmd，再刷新页面。");
      if (!response.ok) throw new Error(result.error || "README 读取失败。");
      draft = saved = result.content; revision = result.revision; maxBytes = result.maxBytes;
      exists = result.exists;
      loaded = true; history = []; future = []; editedAt = 0; onError(""); update(); return true;
    } catch (error) { onError(error.message); return false; }
  }
  async function save() {
    if (saving) return false;
    if (!loaded) { onError("README 尚未读取成功，请先重新加载文件。"); return false; }
    if (bytesOf(draft) > maxBytes) { onError("README 不能超过 128 KB，请缩短内容后再保存。"); return false; }
    if (draft === saved && exists) return true;
    saving = true; update(); onError("");
    const submitted = draft;
    try {
      const response = await fetch("/api/editor/readme", { method: "PUT", headers: { "Content-Type": "application/json", "X-Editor-Token": getToken() }, body: JSON.stringify({ content: submitted, revision }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "README 保存失败。");
      saved = submitted; revision = result.revision; exists = true; return true;
    } catch (error) { onError(error.message); return false; }
    finally { saving = false; editedAt = 0; update(); }
  }
  return { state, load, save, undo, redo, discard };
}
