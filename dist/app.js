import { CHARACTERS as CHARACTER_ASSETS, SCREENSHOTS as SCREENSHOT_ASSETS } from "./data.js";

const response = await fetch(new URL("./content.json", import.meta.url), { cache: "no-cache" });
if (!response.ok) throw new Error("Unable to load website content");
let copy = await response.json();
let MODES, CHARACTERS, SCREENSHOTS;

function prepareContent(content) {
  copy = content;
  MODES = Object.fromEntries(["tactical", "kingdom"].map((id) => [id, {
    ...Object.fromEntries(["title", "description", "diagram", "caption"].map((key) => [key, copy[`modes.${id}.${key}`]])),
    screenshot: id,
    steps: [1, 2, 3].map((step) => copy[`modes.${id}.step${step}`]),
    versions: Object.fromEntries(["standard", "advanced", "expert", "full"].map((version) => [version, copy[`modes.${id}.versions.${version}`]])),
  }]));
  CHARACTERS = CHARACTER_ASSETS.map((asset) => ({ ...asset,
    ...Object.fromEntries(["name", "english", "quote"].map((key) => [key, copy[`characters.${asset.id}.${key}`]])),
    tactical: [copy[`characters.${asset.id}.tacticalName`], copy[`characters.${asset.id}.tacticalDescription`]],
    kingdom: [copy[`characters.${asset.id}.kingdomName`], copy[`characters.${asset.id}.kingdomDescription`]],
  }));
  SCREENSHOTS = SCREENSHOT_ASSETS.map(({ id }) => ({ id, ...Object.fromEntries(["title", "caption", "alt"].map((key) => [key, copy[`gallery.${id}.${key}`]])) }));
}
prepareContent(copy);

const $ = (selector) => document.querySelector(selector);
const state = { mode: "tactical", version: "standard", character: "warrior", skill: "tactical", screenshot: 1 };
const dialog = $("#screenshot-dialog");
$(".versions").id = "versions";

function selectTabs(list, key, value) {
  for (const tab of list.querySelectorAll('[role="tab"]')) {
    const selected = tab.dataset[key] === value;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }
}

function wireTabs(list, callback) {
  list.addEventListener("click", (event) => {
    const tab = event.target.closest('[role="tab"]');
    if (tab && list.contains(tab)) callback(tab);
  });
  list.addEventListener("keydown", (event) => {
    const tabs = [...list.querySelectorAll('[role="tab"]')];
    const current = tabs.indexOf(event.target.closest('[role="tab"]'));
    if (current < 0 || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    tabs[index].focus({ preventScroll: true });
    tabs[index].click();
    if (list.id === "character-picker") tabs[index].scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
  });
}

function renderVersion() {
  selectTabs($(".version-tabs"), "version", state.version);
  $("#version-panel").textContent = MODES[state.mode].versions[state.version];
  $("#version-panel").setAttribute("aria-labelledby", `version-${state.version}`);
  $("#version-full small").textContent = copy[state.mode === "kingdom" ? "versions.kingdomFullNote" : "versions.full.note"];
}

function renderMode() {
  const mode = MODES[state.mode];
  selectTabs($(".mode-tabs"), "mode", state.mode);
  $("#mode-panel").setAttribute("aria-labelledby", `mode-${state.mode}`);
  $("#mode-title").textContent = mode.title;
  $("#mode-description").textContent = mode.description;
  $("#diagram-caption").textContent = mode.diagram;
  $("#mode-caption").textContent = mode.caption;
  $("#mode-image").src = `./assets/screens/${mode.screenshot}.png`;
  $("#mode-image").alt = `${state.mode === "tactical" ? "术点" : "王国"}模式实机画面`;
  $("#mode-steps").replaceChildren(...mode.steps.map((text, index) => {
    const li = document.createElement("li");
    const number = document.createElement("span");
    number.textContent = String(index + 1).padStart(2, "0");
    li.append(number, document.createTextNode(text));
    return li;
  }));
  renderVersion();
}

function renderSkill() {
  const role = CHARACTERS.find((character) => character.id === state.character);
  selectTabs($(".skill-tabs"), "skill", state.skill);
  $("#skill-panel").setAttribute("aria-labelledby", `skill-${state.skill}`);
  $("#skill-name").textContent = role[state.skill][0];
  $("#skill-description").textContent = role[state.skill][1];
}

function renderCharacter() {
  const role = CHARACTERS.find((character) => character.id === state.character);
  selectTabs($("#character-picker"), "character", state.character);
  $("#character-image").src = `./assets/characters/${role.id}.png`;
  $("#character-image").alt = `${role.name}角色原画`;
  $("#character-name").textContent = role.name;
  $("#character-english").textContent = role.english;
  $("#character-quote").textContent = `「${role.quote}」`;
  $(".character-stage").setAttribute("aria-labelledby", `character-${role.id}`);
  renderSkill();
}

function buildCharacters() {
  const picker = $("#character-picker");
  for (const role of CHARACTERS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "character-choice";
    button.id = `character-${role.id}`;
    button.dataset.character = role.id;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-controls", "character-panel");
    const portrait = document.createElement("span");
    portrait.className = "character-portrait";
    portrait.setAttribute("aria-hidden", "true");
    const [x, y, width, height] = role.crop;
    portrait.style.setProperty("--crop-width", `${100 / width}%`);
    portrait.style.setProperty("--crop-left", `${-100 * x / width}%`);
    portrait.style.setProperty("--crop-top", `${-100 * y / height}%`);
    const image = document.createElement("img");
    image.src = `./assets/characters/${role.id}.png`;
    image.alt = "";
    image.loading = "lazy";
    portrait.append(image);
    const label = document.createElement("span");
    label.textContent = role.name;
    button.append(portrait, label);
    picker.append(button);
  }
  $(".character-stage").id = "character-panel";
  $(".character-stage").setAttribute("role", "tabpanel");
  wireTabs(picker, (tab) => { state.character = tab.dataset.character; renderCharacter(); });
  renderCharacter();
}

function showScreenshot(index) {
  state.screenshot = (index + SCREENSHOTS.length) % SCREENSHOTS.length;
  const shot = SCREENSHOTS[state.screenshot];
  const source = `./assets/screens/${shot.id}.png`;
  $("#gallery-image").src = source;
  $("#gallery-image").alt = shot.alt;
  $("#gallery-caption").textContent = shot.caption;
  $("#gallery-open").setAttribute("aria-label", `放大查看：${shot.title}`);
  $("#gallery-count").textContent = `${String(state.screenshot + 1).padStart(2, "0")} / ${String(SCREENSHOTS.length).padStart(2, "0")}`;
  for (const [position, button] of [...$("#gallery-thumbnails").children].entries()) {
    button.setAttribute("aria-pressed", String(position === state.screenshot));
  }
  if (dialog.open) renderDialogImage();
}

function renderDialogImage() {
  const shot = SCREENSHOTS[state.screenshot];
  $("#dialog-image").src = `./assets/screens/${shot.id}.png`;
  $("#dialog-image").alt = shot.alt;
  $("#dialog-caption").textContent = shot.caption;
}

function openScreenshot(index = state.screenshot) {
  showScreenshot(index);
  renderDialogImage();
  if (!dialog.open) {
    dialog.showModal();
    document.body.style.overflow = "hidden";
  }
}

function buildGallery() {
  const rail = $("#gallery-thumbnails");
  for (const [index, shot] of SCREENSHOTS.entries()) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "gallery-thumbnail";
    button.setAttribute("aria-label", `查看${shot.title}实机截图`);
    const image = document.createElement("img");
    image.src = `./assets/screens/${shot.id}.png`;
    image.alt = "";
    image.loading = "lazy";
    image.width = 320;
    image.height = 180;
    button.append(image);
    button.addEventListener("click", () => showScreenshot(index));
    rail.append(button);
  }
  $("#gallery-prev").addEventListener("click", () => showScreenshot(state.screenshot - 1));
  $("#gallery-next").addEventListener("click", () => showScreenshot(state.screenshot + 1));
  $("#gallery-open").addEventListener("click", () => openScreenshot());
  $("#mode-preview").addEventListener("click", () => openScreenshot(state.mode === "tactical" ? 0 : 1));
  $("#dialog-close").addEventListener("click", () => dialog.close());
  $("#dialog-prev").addEventListener("click", () => showScreenshot(state.screenshot - 1));
  $("#dialog-next").addEventListener("click", () => showScreenshot(state.screenshot + 1));
  dialog.addEventListener("close", () => { document.body.style.overflow = ""; });
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
  dialog.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    showScreenshot(state.screenshot + (event.key === "ArrowRight" ? 1 : -1));
  });
  showScreenshot(state.screenshot);
}

function setupNavigation() {
  const toggle = $("#menu-toggle");
  const nav = $("#site-nav");
  function closeMenu() {
    nav.classList.remove("is-open");
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "打开导航");
  }
  toggle.addEventListener("click", () => {
    const open = nav.classList.toggle("is-open");
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "关闭导航" : "打开导航");
  });
  nav.addEventListener("click", (event) => { if (event.target.closest("a")) closeMenu(); });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") {
      closeMenu();
      toggle.focus();
    }
  });
  const sections = [...document.querySelectorAll("main section[id]")];
  const observer = new IntersectionObserver((entries) => {
    const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio);
    if (!visible.length) return;
    const active = visible[0].target.id;
    for (const link of nav.querySelectorAll(".nav-link")) {
      const selected = link.hash === `#${active}`;
      link.classList.toggle("is-active", selected);
      if (selected) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    }
  }, { rootMargin: "-15% 0px -45% 0px", threshold: [0, 0.1, 0.3, 0.6] });
  for (const section of sections) observer.observe(section);
}

function configuredUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

function setupReleaseLinks() {
  let available = false;
  for (const [key, id] of [["downloadUrl", "download-link"], ["communityUrl", "community-link"]]) {
    const url = configuredUrl(copy[`release.${key}`]);
    const link = $(`#${id}`);
    link.hidden = !url;
    if (!url) { link.removeAttribute("href"); continue; }
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.hidden = false;
    available = true;
  }
  $("#release-links").hidden = !available;
  const ready = Boolean(configuredUrl(copy["release.downloadUrl"]));
  $("#download-answer").textContent = copy[ready ? "faq.download.readyAnswer" : "faq.download.answer"];
  $(".development-status").lastChild.textContent = copy[ready ? "release.readyStatus" : "release.status"];
}

function applyContent(content) {
  prepareContent(content);
  for (const element of document.querySelectorAll("[data-copy]")) {
    const text = copy[element.dataset.copy];
    if (typeof text === "string") element.textContent = text;
  }
  for (const element of document.querySelectorAll("[data-copy-alt]")) element.alt = copy[element.dataset.copyAlt];
  document.title = copy["site.title"];
  $("meta[name='description']").content = copy["site.description"];
  $("meta[property='og:title']").content = copy["site.shareTitle"];
  $("meta[property='og:description']").content = copy["site.shareDescription"];
  $(".site-header .brand").setAttribute("aria-label", `${copy["site.brand"]}首页`);
  for (const role of CHARACTERS) $(`#character-${role.id}`).lastChild.textContent = role.name;
  SCREENSHOTS.forEach((shot, index) => $("#gallery-thumbnails").children[index].setAttribute("aria-label", `查看${shot.title}实机截图`));
  renderMode();
  renderCharacter();
  showScreenshot(state.screenshot);
  setupReleaseLinks();
}

function setupLocalPreview() {
  if (!["localhost", "127.0.0.1"].includes(location.hostname) || window.parent === window || !new URLSearchParams(location.search).has("editor-preview")) return;
  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      window.parent.postMessage({ type: "copy-editor-save" }, location.origin);
    }
  });
  window.addEventListener("message", (event) => {
    if (event.origin !== location.origin || event.source !== window.parent || event.data?.type !== "copy-preview") return;
    const { content, context = {}, focus = false } = event.data;
    if (!content || Object.keys(copy).some((key) => typeof content[key] !== "string")) return;
    if (["tactical", "kingdom"].includes(context.mode)) state.mode = context.mode;
    if (["standard", "advanced", "expert", "full"].includes(context.version)) state.version = context.version;
    if (CHARACTER_ASSETS.some((role) => role.id === context.character)) state.character = context.character;
    if (["tactical", "kingdom"].includes(context.skill)) state.skill = context.skill;
    if (Number.isInteger(context.screenshot) && context.screenshot >= 0 && context.screenshot < SCREENSHOTS.length) state.screenshot = context.screenshot;
    applyContent(content);
    if (Number.isInteger(context.faq)) {
      const question = document.querySelectorAll(".faq-list details")[context.faq];
      if (question) question.open = true;
    }
    if (focus && context.anchor === "intro") window.scrollTo({ top: 0, behavior: "instant" });
    else if (focus && typeof context.anchor === "string") document.getElementById(context.anchor)?.scrollIntoView({ behavior: "instant", block: "start" });
    window.parent.postMessage({ type: "copy-preview-applied" }, location.origin);
  });
  window.parent.postMessage({ type: "copy-preview-ready" }, location.origin);
}

wireTabs($(".mode-tabs"), (tab) => { state.mode = tab.dataset.mode; renderMode(); });
wireTabs($(".version-tabs"), (tab) => { state.version = tab.dataset.version; renderVersion(); });
wireTabs($(".skill-tabs"), (tab) => { state.skill = tab.dataset.skill; renderSkill(); });
renderMode();
buildCharacters();
buildGallery();
setupNavigation();
applyContent(copy);
setupLocalPreview();
