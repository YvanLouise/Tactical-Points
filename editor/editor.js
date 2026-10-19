import { setupPublishing } from "./publish.js";
import { createReadmeEditor } from "./readme.js";
import { createImageEditor } from "./images.js";
import { IMAGE_SLOTS } from "../media.js";

const $ = (selector) => document.querySelector(selector);
const clone = (value) => structuredClone(value);
let draft, saved, original, sections, revision, token;
let activeSection = "home", activeGroup = {}, activeContext = {}, ready = false, saving = false;
let device = window.matchMedia("(max-width: 900px)").matches ? "mobile" : "desktop";
let history = [], future = [], editKey = "", editAt = 0, fieldDefinitions = [];
let previewPage = "home";
const frame = $("#preview");
const dirtyKeys = () => Object.keys(draft || {}).filter((key) => draft[key] !== saved[key]);
const currentSection = () => sections.find((section) => section.id === activeSection);
const editingReadme = () => activeSection === "readme";
const editingImages = () => activeSection === "images";

function message(text, error = false) {
  $("#editor-error").hidden = !error;
  $("#editor-error").textContent = error ? text : "";
  if (!error && text) $("#save-state").textContent = text;
}
const readme = createReadmeEditor({ getToken: () => token, onChange: () => { if (draft && sections) updateStatus(); }, onError: (text) => message(text, Boolean(text)) });
const images = createImageEditor({ getToken: () => token, onChange: () => { if (draft && sections) { updateStatus(); preview(); } }, onError: (text) => message(text, Boolean(text)), onSelect: (context) => { if (editingImages()) { activeContext = context; preview(true); } } });
function preview(focus = false) {
  if (editingReadme()) return;
  const page = activeContext.page === "about" ? "about" : "home";
  if (page !== previewPage) {
    previewPage = page; ready = false;
    frame.src = page === "about" ? "/about.html?editor-preview=1" : "/?editor-preview=1";
    sizePreview(); return;
  }
  if (ready && draft) frame.contentWindow.postMessage({ type: "copy-preview", content: draft, images: images.state().loaded ? images.overrides() : undefined, context: activeContext, focus }, location.origin);
}
function sizePreview() {
  if (editingReadme()) { $("#preview-state").textContent = "Markdown · 本地实时预览"; return; }
  const stage = $("#preview-stage"), screen = $("#preview-screen");
  if (!stage.clientWidth || !stage.clientHeight) return;
  const width = device === "mobile" ? 390 : 1280;
  const scale = Math.min(1, stage.clientWidth / width);
  screen.style.width = `${width}px`;
  screen.style.height = `${Math.floor(stage.clientHeight / scale)}px`;
  screen.style.transform = `scale(${scale})`;
  screen.style.left = `${Math.max(0, (stage.clientWidth - width * scale) / 2)}px`;
  $("#preview-state").textContent = `${device === "mobile" ? "手机" : "桌面"} ${width}px · ${ready ? "已同步草稿" : "加载中"}`;
}
new ResizeObserver(sizePreview).observe($("#preview-stage"));
window.addEventListener("message", (event) => {
  if (event.source !== frame.contentWindow || event.origin !== location.origin) return;
  if (event.data?.type === "copy-preview-ready" && event.data.page === previewPage) { ready = true; preview(true); sizePreview(); }
  if (event.data?.type === "copy-editor-save") save();
  if (event.data?.type === "copy-preview-navigate") {
    const { page, anchor } = event.data;
    if (!["home", "about"].includes(page)) return;
    const section = page === "about" ? sections.find((item) => item.id === "author") : sections.find((item) => item.anchor === anchor && item.page !== "about");
    selectSection(section?.id || "home");
  }
});
frame.addEventListener("load", () => { if (ready) preview(true); });

function fieldError(item) {
  const text = draft[item.key];
  if (!item.optional && !text.trim()) return "请填写文案。";
  if (text.length > item.maxLength) return `最多 ${item.maxLength} 个字符。`;
  if (item.type === "url" && text) {
    try {
      const url = new URL(text);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || text !== text.trim()) throw new Error();
    } catch { return "请填写完整的 HTTP(S) 链接，或留空。"; }
  }
  return "";
}
function updateStatus() {
  const keys = dirtyKeys();
  const readmeState = readme.state(), imageState = images.state(), readmeMode = editingReadme(), imageMode = editingImages(), busy = saving || readmeState.saving || imageState.saving || imageState.processing;
  $("#save").disabled = busy || (readmeMode ? !readmeState.dirty || !readmeState.loaded : imageMode ? !imageState.dirty || !imageState.loaded : !keys.length);
  $("#save").firstChild.textContent = busy ? "处理中… " : readmeMode ? "保存 README " : imageMode ? "保存图片 " : "保存文案 ";
  $("#undo").disabled = busy || (readmeMode ? !readmeState.canUndo : imageMode ? !imageState.canUndo : !history.length);
  $("#redo").disabled = busy || (readmeMode ? !readmeState.canRedo : imageMode ? !imageState.canRedo : !future.length);
  $("#discard").disabled = busy || (readmeMode ? !readmeState.dirty : imageMode ? !imageState.dirty : !keys.length);
  $("#reload").disabled = busy;
  $("#reset-section").disabled = busy || readmeMode || imageMode || !currentSection().groups.some((group) => group.fields.some((item) => draft[item.key] !== original[item.key]));
  $("#save-state").textContent = busy ? imageState.processing ? "正在读取图片…" : "正在写入本地文件…" : readmeMode ? !readmeState.loaded ? "README 尚未加载" : readmeState.dirty ? "README 已修改 · 未保存" : "README 已保存到本地" : imageMode ? !imageState.loaded ? "图片尚未加载" : imageState.dirty ? `${imageState.count} 张图片修改 · 未保存` : "图片已保存到本地" : keys.length ? `${keys.length} 处修改 · 未保存` : "已保存到本地";
  $("#nav-readme").classList.toggle("has-changes", readmeState.dirty);
  $("#nav-images").classList.toggle("has-changes", imageState.dirty);
  if (imageMode) $("#field-count").textContent = `${IMAGE_SLOTS.length} 个图片位置 · 默认素材可随时恢复`;
  for (const section of sections) {
    const changed = section.groups.some((group) => group.fields.some((item) => keys.includes(item.key)));
    $(`#nav-${section.id}`).classList.toggle("has-changes", changed);
  }
  for (const container of document.querySelectorAll(".field")) {
    const item = fieldDefinitions.find((field) => field.key === container.dataset.key);
    const input = container.querySelector("input,textarea");
    if (input.value !== draft[item.key]) input.value = draft[item.key];
    const error = fieldError(item);
    container.classList.toggle("is-changed", draft[item.key] !== saved[item.key]);
    container.querySelector(".counter").textContent = `${draft[item.key].length} / ${item.maxLength}`;
    container.querySelector(".reset-field").disabled = draft[item.key] === original[item.key] || saving;
    container.querySelector(".clear-field").disabled = draft[item.key] === "" || saving;
    container.querySelector(".field-error").textContent = error;
    container.querySelector(".field-error").hidden = !error;
    input.setAttribute("aria-invalid", String(Boolean(error)));
  }
}
function checkpoint(key = "") {
  const now = Date.now();
  if (!key || key !== editKey || now - editAt > 900) {
    history.push(clone(draft));
    if (history.length > 100) history.shift();
  }
  editKey = key; editAt = now; future = [];
}
function changeField(key, value) {
  if (draft[key] === value) return;
  checkpoint(key); draft[key] = value;
  message(""); updateStatus(); preview();
}
function applyDraft(value) { draft = clone(value); editKey = ""; message(""); updateStatus(); preview(); }
function undo() { if (editingReadme()) { readme.undo(); return; } if (editingImages()) { images.undo(); return; } if (!history.length || saving) return; future.push(clone(draft)); applyDraft(history.pop()); }
function redo() { if (editingReadme()) { readme.redo(); return; } if (editingImages()) { images.redo(); return; } if (!future.length || saving) return; history.push(clone(draft)); applyDraft(future.pop()); }
function setContext(group, item) {
  activeContext = { page: currentSection().page || "home", anchor: currentSection().anchor, ...group.context, ...item?.context };
  if (item?.key.includes(".versions.") || item?.key.startsWith("versions.")) activeContext.anchor = "versions";
  preview(true);
}
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function buildField(item, group) {
  const container = element("div", "", "field"); container.dataset.key = item.key;
  const heading = element("div", "", "field-heading");
  const label = element("label", item.label); label.htmlFor = item.key;
  const reset = element("button", "恢复原文", "reset-field"); reset.type = "button";
  reset.setAttribute("aria-label", `恢复${item.label}原文`);
  reset.addEventListener("click", () => { setContext(group, item); checkpoint(); draft[item.key] = original[item.key]; message(""); updateStatus(); preview(); });
  const clear = element("button", "清空", "reset-field clear-field"); clear.type = "button";
  clear.setAttribute("aria-label", `清空${item.label}`);
  clear.addEventListener("click", () => { setContext(group, item); checkpoint(); draft[item.key] = ""; message(""); updateStatus(); preview(); });
  const actions = element("div", "", "field-actions"); actions.append(clear, reset);
  heading.append(label, actions);
  const input = element(item.rows > 1 ? "textarea" : "input");
  input.id = item.key; input.name = item.key; input.value = draft[item.key]; input.maxLength = item.maxLength;
  if (item.rows > 1) input.rows = item.rows;
  else input.type = item.type === "url" ? "url" : "text";
  input.setAttribute("aria-describedby", `${item.key}-hint ${item.key}-error`);
  input.addEventListener("focus", () => setContext(group, item));
  input.addEventListener("input", () => changeField(item.key, input.value));
  const meta = element("div", "", "field-meta");
  const hint = element("span", item.hint ? `${item.hint} 可留空。` : "可留空，清空后不显示对应文字。"); hint.id = `${item.key}-hint`;
  meta.append(hint, element("span", "", "counter"));
  const error = element("p", "", "field-error"); error.id = `${item.key}-error`; error.hidden = true;
  container.append(heading, input, meta, error);
  return container;
}
function renderForm() {
  const section = currentSection();
  const selectable = section.groups.filter((group) => Object.keys(group.context).some((key) => ["mode", "character", "screenshot", "faq"].includes(key)));
  const selected = activeGroup[section.id] || selectable[0]?.label;
  const picker = $("#group-picker"); picker.replaceChildren();
  $("#group-filter").hidden = !selectable.length;
  $("#group-label").textContent = section.id === "characters" ? "选择角色" : "选择内容";
  for (const group of selectable) { const option = element("option", group.label); option.value = group.label; picker.append(option); }
  picker.value = selected || "";
  const form = $("#copy-form"); form.replaceChildren();
  let count = 0;
  for (const group of section.groups) {
    if (selectable.includes(group) && group.label !== selected) continue;
    const fieldset = element("fieldset"); fieldset.append(element("legend", group.label));
    for (const item of group.fields) { fieldset.append(buildField(item, group)); count++; }
    form.append(fieldset);
  }
  $("#field-count").textContent = `当前显示 ${count} 个字段 · 共 ${fieldDefinitions.length} 个可编辑字段`;
  updateStatus();
}
function selectSection(id) {
  activeSection = id;
  const readmeMode = editingReadme(), imageMode = editingImages();
  $("#workspace").dataset.document = readmeMode ? "readme" : imageMode ? "images" : "copy";
  $("#copy-document").hidden = readmeMode || imageMode;
  $("#image-document").hidden = !imageMode;
  $("#readme-document").hidden = !readmeMode;
  $("#reset-section").hidden = readmeMode || imageMode;
  $("#preview-stage").hidden = readmeMode;
  $("#readme-preview").hidden = !readmeMode;
  $("#device-switch").hidden = readmeMode;
  $("#preview-pane").setAttribute("aria-label", readmeMode ? "README 实时预览" : "官网实时预览");
  $("#preview-title").textContent = readmeMode ? "README 预览" : "实时预览";
  $("#preview-caption").textContent = readmeMode ? "支持常用 Markdown、表格和任务列表 · 原始 HTML 显示为文本，最终排版以 GitHub 为准" : "预览支持直接操作 · 修改即时可见，保存后写入文件";
  $("#show-form").textContent = readmeMode ? "编辑 README" : imageMode ? "更换图片" : "编辑文案";
  $("#show-preview").textContent = readmeMode ? "README 预览" : "查看预览";
  for (const button of $("#section-nav").children) button.setAttribute("aria-current", String(button.id === `nav-${id}`));
  if (imageMode) {
    $("#section-title").textContent = "图片素材"; $("#section-number").textContent = `${String(sections.length + 2).padStart(2, "0")} / IMAGES`;
    $("#section-note").textContent = "选择要更换的位置，上传或拖入新图片。支持预览、撤销和恢复默认，保存后可随官网一起发布。";
    $(".form-pane").scrollTop = 0; images.focus(); updateStatus(); sizePreview(); return;
  }
  if (readmeMode) {
    $("#section-title").textContent = "GitHub README";
    $("#section-number").textContent = `${String(sections.length + 1).padStart(2, "0")} / README`;
    $("#section-note").textContent = "编辑仓库首页的项目介绍、使用说明与链接。草稿在本机预览，保存后点击“发布上线”同步到 GitHub。";
    $("#field-count").textContent = "README.md · UTF-8 · 独立保存与撤销历史";
    $(".form-pane").scrollTop = 0; updateStatus(); sizePreview(); return;
  }
  const section = currentSection();
  $("#section-title").textContent = section.label;
  $("#section-number").textContent = `${String(sections.indexOf(section) + 1).padStart(2, "0")} / COPY`;
  $("#section-note").textContent = section.note;
  $(".form-pane").scrollTop = 0;
  renderForm();
  const selected = section.groups.find((group) => group.label === $("#group-picker").value);
  activeContext = { page: section.page || "home", anchor: section.anchor, ...selected?.context };
  preview(true); sizePreview();
}
$("#group-picker").addEventListener("change", (event) => {
  activeGroup[activeSection] = event.target.value;
  const group = currentSection().groups.find((item) => item.label === event.target.value);
  renderForm(); setContext(group);
});
function confirmAction(title, description, label) {
  const dialog = $("#confirm-dialog");
  $("#confirm-title").textContent = title; $("#confirm-description").textContent = description;
  $("#confirm-action").textContent = label; dialog.returnValue = ""; dialog.showModal();
  return new Promise((resolve) => dialog.addEventListener("close", () => resolve(dialog.returnValue === "confirm"), { once: true }));
}
$("#reset-section").addEventListener("click", async () => {
  if (editingImages() || editingReadme()) return;
  const section = currentSection();
  if (!await confirmAction(`恢复“${section.label}”原文？`, "本区全部字段将恢复为面板初次建立时的文案。操作后仍需保存，也可以撤销。", "恢复本区原文")) return;
  checkpoint();
  for (const group of section.groups) for (const item of group.fields) draft[item.key] = original[item.key];
  message(""); updateStatus(); preview();
});
$("#discard").addEventListener("click", async () => {
  if (!await confirmAction("放弃未保存修改？", editingImages() ? "图片将回到上次保存的状态，文案与 README 草稿保留。你仍可以撤销找回本次修改。" : editingReadme() ? "README 将回到上次保存的内容，官网文案草稿保留。你仍可以撤销找回本次修改。" : "官网文案各分区将回到上次保存的内容，图片与 README 草稿保留。你仍可以撤销找回本次修改。", "放弃修改")) return;
  if (editingImages()) { images.discard(); return; }
  if (editingReadme()) { readme.discard(); return; }
  checkpoint(); applyDraft(saved);
});
async function saveCopy() {
  if (saving) return false;
  if (!dirtyKeys().length) return true;
  const invalid = fieldDefinitions.find((item) => fieldError(item));
  if (invalid) {
    const section = sections.find((section) => section.groups.some((group) => group.fields.includes(invalid)));
    const group = section.groups.find((group) => group.fields.includes(invalid));
    activeGroup[section.id] = group.label; selectSection(section.id); document.getElementById(invalid.key).focus();
    message(`“${invalid.label}”：${fieldError(invalid)}`, true); return false;
  }
  saving = true; updateStatus(); message("");
  const submitted = clone(draft);
  try {
    const response = await fetch("/api/editor/content", { method: "PUT", headers: { "Content-Type": "application/json", "X-Editor-Token": token }, body: JSON.stringify({ content: submitted, revision }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "保存失败，请稍后重试。");
    saved = submitted; revision = result.revision;
    return true;
  } catch (error) { message(error.message, true); return false; }
  finally { saving = false; editKey = ""; updateStatus(); }
}
async function save() { return editingReadme() ? readme.save() : editingImages() ? images.save() : saveCopy(); }
async function saveAll() {
  if (!await saveCopy()) return false;
  if (!await readme.save()) { selectSection("readme"); return false; }
  if (!await images.save()) { selectSection("images"); return false; }
  return true;
}
async function load() {
  try {
    const response = await fetch("/api/editor/content");
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "文案加载失败。");
    ({ sections, revision, token, original } = result);
    draft = clone(result.content); saved = clone(result.content); history = []; future = [];
    fieldDefinitions = sections.flatMap((section) => section.groups.flatMap((group) => group.fields));
    $("#section-nav").replaceChildren();
    for (const [index, section] of sections.entries()) {
      const button = element("button"); button.id = `nav-${section.id}`;
      button.append(element("span", String(index + 1).padStart(2, "0"), "nav-number"), element("span", section.label), element("span", "", "nav-dot"));
      button.addEventListener("click", () => selectSection(section.id)); $("#section-nav").append(button);
    }
    const readmeButton = element("button"); readmeButton.id = "nav-readme";
    readmeButton.append(element("span", String(sections.length + 1).padStart(2, "0"), "nav-number"), element("span", "GitHub README"), element("span", "", "nav-dot"));
    readmeButton.addEventListener("click", () => selectSection("readme")); $("#section-nav").append(readmeButton);
    const imageButton = element("button"); imageButton.id = "nav-images";
    imageButton.append(element("span", String(sections.length + 2).padStart(2, "0"), "nav-number"), element("span", "图片素材"), element("span", "", "nav-dot"));
    imageButton.addEventListener("click", () => selectSection("images")); $("#section-nav").append(imageButton);
    message(""); selectSection(activeSection); $("#workspace").setAttribute("aria-busy", "false");
  } catch (error) { message(`读取失败：${error.message} 请保持本地服务运行后，点击“重新加载文件”。`, true); }
}
$("#save").addEventListener("click", save); $("#undo").addEventListener("click", undo); $("#redo").addEventListener("click", redo);
$("#reload").addEventListener("click", async () => {
  if ((editingReadme() ? readme.state().dirty : editingImages() ? images.state().dirty : dirtyKeys().length) && !await confirmAction("重新读取本地文件？", "当前分区未保存的草稿将被本地文件替换，其他类型的草稿保留。", "重新加载")) return;
  if (editingImages()) await images.load();
  else if (editingReadme()) await readme.load();
  else await load();
});
$("#copy-form").addEventListener("submit", (event) => { event.preventDefault(); save(); });
document.addEventListener("keydown", (event) => {
  if (!(event.ctrlKey || event.metaKey) || $("#confirm-dialog").open) return;
  if (event.key.toLowerCase() === "s") { event.preventDefault(); save(); }
  if (event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? redo() : undo(); }
  if (event.key.toLowerCase() === "y") { event.preventDefault(); redo(); }
});
window.addEventListener("beforeunload", (event) => { if (dirtyKeys().length || readme.state().dirty || images.state().dirty || images.state().processing || images.state().saving) { event.preventDefault(); event.returnValue = ""; } });
for (const id of ["desktop", "mobile"]) {
  $(`#${id}`).setAttribute("aria-pressed", String(device === id));
  $(`#${id}`).addEventListener("click", () => {
    device = id;
    for (const type of ["desktop", "mobile"]) $(`#${type}`).setAttribute("aria-pressed", String(type === id));
    sizePreview();
  });
}
for (const id of ["form", "preview"]) $(`#show-${id}`).addEventListener("click", () => {
  $("#workspace").dataset.view = id;
  for (const view of ["form", "preview"]) $(`#show-${view}`).setAttribute("aria-pressed", String(view === id));
  sizePreview();
});
await load();
await readme.load();
await images.load();
setupPublishing({ getRevision: () => revision, getReadmeRevision: () => readme.state().revision, getImageRevision: () => images.state().revision, getToken: () => token, hasUnsavedChanges: () => dirtyKeys().length > 0 || readme.state().dirty || images.state().dirty || images.state().processing, save: saveAll });
