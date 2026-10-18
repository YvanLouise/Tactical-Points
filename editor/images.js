import { IMAGE_SLOTS, IMAGE_LIMITS, imageFor } from "../media.js";

const $ = (selector) => document.querySelector(selector);
const bytesLabel = (bytes) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
const absolute = (source) => new URL(source, `${location.origin}/`).href;

export function createImageEditor({ getToken, onChange, onError, onSelect }) {
  let saved = {}, draft = {}, revision = null, loaded = false, saving = false, processing = false;
  let selected = "hero", category = IMAGE_SLOTS[0].group, past = [], future = [], sequence = 0;
  const urls = new Set();
  const state = () => ({ loaded, saving, processing, dirty: Boolean(Object.keys(draft).length), count: Object.keys(draft).length, revision, canUndo: Boolean(past.length), canRedo: Boolean(future.length) });
  function overrides() {
    const result = { ...saved };
    for (const [id, entry] of Object.entries(draft)) {
      if (entry === null) delete result[id];
      else result[id] = { src: entry.url, width: entry.width, height: entry.height, bytes: entry.file.size };
    }
    return result;
  }
  function releaseUnused() {
    const used = new Set([draft, ...past, ...future].flatMap((value) => Object.values(value).filter(Boolean).map((entry) => entry.url)));
    for (const url of urls) if (!used.has(url)) { URL.revokeObjectURL(url); urls.delete(url); }
  }
  function render() {
    const current = imageFor(selected, overrides()), busy = !loaded || saving || processing;
    const list = $("#image-list");
    if (list.dataset.category !== category) { list.replaceChildren(); list.dataset.category = category; }
    for (const slot of IMAGE_SLOTS.filter((item) => item.group === category)) {
      const item = imageFor(slot.id, overrides());
      let button = list.querySelector(`#image-choice-${slot.id}`);
      if (!button) {
        button = document.createElement("button"); button.id = `image-choice-${slot.id}`; button.type = "button"; button.className = "image-choice";
        const image = document.createElement("img"); image.alt = ""; image.loading = "lazy";
        const title = document.createElement("span"); title.textContent = slot.label;
        button.append(image, title, document.createElement("small")); button.addEventListener("click", () => select(slot.id)); list.append(button);
      }
      button.disabled = saving || processing;
      button.setAttribute("aria-label", `选择图片：${slot.label}`); button.setAttribute("aria-pressed", String(selected === slot.id));
      const thumbnail = button.querySelector("img"); if (thumbnail.src !== absolute(item.src)) thumbnail.src = absolute(item.src);
      button.querySelector("small").textContent = Object.hasOwn(draft, slot.id) ? "待保存" : item.custom ? "已替换" : "默认";
    }
    $("#image-category").value = category; $("#image-category").disabled = saving || processing;
    $("#image-title").textContent = current.label;
    if ($("#image-current-preview").src !== absolute(current.src)) $("#image-current-preview").src = absolute(current.src);
    $("#image-current-preview").alt = `${current.label}图片预览`;
    $("#image-dimensions").textContent = `${current.width} × ${current.height} px${current.bytes ? ` · ${bytesLabel(current.bytes)}` : ""}`;
    const pending = draft[selected];
    $("#image-origin").textContent = Object.hasOwn(draft, selected) ? pending ? `${pending.file.name} · 尚未保存` : "恢复默认 · 尚未保存" : current.custom ? "已保存的替换图片" : "默认图片";
    $("#image-open").href = absolute(current.src);
    $("#image-choose").disabled = busy; $("#image-file").disabled = busy;
    $("#image-restore").disabled = busy || !current.custom;
    $("#image-progress").textContent = saving ? "正在保存图片…" : processing ? "正在读取图片…" : "";
  }
  function notify() { render(); onChange(); }
  function select(id) { selected = id; category = IMAGE_SLOTS.find((item) => item.id === id).group; render(); onSelect(IMAGE_SLOTS.find((item) => item.id === id).context); }
  function checkpoint() { past.push({ ...draft }); if (past.length > 30) past.shift(); future = []; }
  async function choose(file) {
    if (!file || !loaded || saving || processing) return;
    const mime = file.type || ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" })[file.name.split(".").at(-1).toLowerCase()];
    if (!["image/png", "image/jpeg", "image/webp"].includes(mime)) { onError("请选择 PNG、JPG 或 WebP 图片。"); return; }
    if (file.size > IMAGE_LIMITS.bytes || !file.size) { onError("请选择不超过 12 MB 的图片。"); return; }
    const url = URL.createObjectURL(file), attempt = ++sequence, id = selected;
    processing = true; onError(""); notify();
    try {
      const image = new Image(); image.src = url; await image.decode();
      const width = image.naturalWidth, height = image.naturalHeight;
      if (width > IMAGE_LIMITS.edge || height > IMAGE_LIMITS.edge || width * height > IMAGE_LIMITS.pixels) throw new Error("图片最长边不能超过 8192 像素，总像素不能超过 3200 万。");
      if (attempt !== sequence) { URL.revokeObjectURL(url); return; }
      checkpoint(); urls.add(url); draft = { ...draft, [id]: { file, mime, url, width, height } };
      releaseUnused(); onSelect(IMAGE_SLOTS.find((item) => item.id === id).context);
    } catch (error) { URL.revokeObjectURL(url); onError(error instanceof DOMException ? "无法读取这张图片，请换一张有效图片。" : error.message); }
    finally { processing = false; notify(); }
  }
  async function load() {
    if (saving || processing) return false;
    try {
      const response = await fetch("/api/editor/images"), result = await response.json();
      if (!response.ok) throw new Error(result.error || "图片列表读取失败。");
      saved = result.config; revision = result.revision; loaded = true; draft = {}; past = []; future = []; releaseUnused(); onError(""); notify(); return true;
    } catch (error) { onError(error.message); return false; }
  }
  async function save() {
    if (!loaded || saving || processing) { onError("请等待图片读取完成后再保存。"); return false; }
    if (!state().dirty) return true;
    const submitted = Object.entries(draft); saving = true; onError(""); notify();
    try {
      for (const [id, entry] of submitted) {
        const response = await fetch(`/api/editor/images/${id}`, { method: entry ? "PUT" : "DELETE", headers: { "X-Editor-Token": getToken(), "X-Image-Revision": revision, ...(entry ? { "Content-Type": entry.mime } : {}) }, ...(entry ? { body: entry.file } : {}) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "图片保存失败。");
        saved = result.config; revision = result.revision; delete draft[id]; past = []; future = [];
        notify();
      }
      return true;
    } catch (error) { onError(error.message); return false; }
    finally { saving = false; releaseUnused(); notify(); }
  }
  $("#image-category").replaceChildren(...[...new Set(IMAGE_SLOTS.map((item) => item.group))].map((group) => { const option = document.createElement("option"); option.value = group; option.textContent = group; return option; }));
  $("#image-category").addEventListener("change", (event) => select(IMAGE_SLOTS.find((item) => item.group === event.target.value).id));
  $("#image-choose").addEventListener("click", () => $("#image-file").click());
  $("#image-file").addEventListener("change", (event) => { const file = event.target.files[0]; event.target.value = ""; choose(file); });
  $("#image-restore").addEventListener("click", () => {
    if (saving || processing) return;
    checkpoint(); draft = { ...draft }; if (saved[selected]) draft[selected] = null; else delete draft[selected];
    onError(""); releaseUnused(); notify(); onSelect(IMAGE_SLOTS.find((item) => item.id === selected).context);
  });
  const drop = $("#image-dropzone");
  drop.addEventListener("dragover", (event) => { event.preventDefault(); if (loaded && !saving && !processing) drop.classList.add("is-dragging"); });
  drop.addEventListener("dragleave", (event) => { if (!drop.contains(event.relatedTarget)) drop.classList.remove("is-dragging"); });
  drop.addEventListener("drop", (event) => { event.preventDefault(); drop.classList.remove("is-dragging"); if (event.dataTransfer.files.length > 1) onError("请一次为当前位置选择一张图片。"); else choose(event.dataTransfer.files[0]); });
  return {
    state, load, save, overrides, focus: () => select(selected),
    undo() { if (!past.length || saving || processing) return; future.push({ ...draft }); draft = past.pop(); onError(""); releaseUnused(); notify(); },
    redo() { if (!future.length || saving || processing) return; past.push({ ...draft }); draft = future.pop(); onError(""); releaseUnused(); notify(); },
    discard() { if (saving || processing) return; checkpoint(); draft = {}; onError(""); releaseUnused(); notify(); },
  };
}
