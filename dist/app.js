import { CHARACTERS as CHARACTER_ASSETS, SCREENSHOTS as SCREENSHOT_ASSETS } from "./data.js";
import { revealContent, setupIndicators, swapImage, syncIndicator } from "./motion.js";
import { imageFor } from "./media.js";
import { withContentDefaults } from "./content-defaults.js";
import { applySiteContent, configuredUrl, renderCommunity, setupCommunity, setupNavigation, setupLocalPreview } from "./site.js";

const [response, imageResponse] = await Promise.all(["./content.json", "./images.json"].map((file) => fetch(new URL(file, import.meta.url), { cache: "no-cache" })));
if (!response.ok || !imageResponse.ok) throw new Error("Unable to load website content");
let copy = withContentDefaults(await response.json()), imageConfig = await imageResponse.json();
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
const hasText = (value) => typeof value === "string" && Boolean(value.trim());
function optionalText(element, text) {
  element.textContent = hasText(text) ? text : "";
  element.hidden = !hasText(text);
}

function syncCopyVisibility() {
  for (const selector of [".hero-actions a", ".scroll-note a", "#site-nav a", ".mode-tabs button", ".skill-tabs button", ".version-tab", ".version-tab > span", ".version-tab > small", "h1", "h2", "h3", "h4", ".hero-description", ".hero-note", ".mode-copy > p", ".versions > p", ".section-description", ".character-footnote", ".development > p", ".development-status", ".english-title", ".site-footer > p"]) {
    for (const element of document.querySelectorAll(selector)) element.hidden = !hasText(element.textContent);
  }
  $(".hero-actions").hidden = [...$(".hero-actions").children].every((element) => element.hidden);
  const emptyNavigation = [...$("#site-nav").children].every((element) => element.hidden);
  $("#site-nav").hidden = emptyNavigation;
  $("#menu-toggle").hidden = emptyNavigation;
  $(".scroll-note").hidden = $(".scroll-note a").hidden;
  $(".ink-underline").hidden = !hasText(copy["hero.headingAccent"]);
  $("#hero-title br").hidden = !hasText(copy["hero.headingStart"]) || !hasText(copy["hero.headingAccent"] + copy["hero.headingEnd"]);
  for (const rail of document.querySelectorAll(".mode-tabs, .skill-tabs, .version-tabs")) {
    const visibleTabs = [...rail.children].filter((element) => !element.hidden);
    rail.hidden = !visibleTabs.length;
    if (visibleTabs.length && !visibleTabs.some((element) => element.tabIndex === 0)) visibleTabs[0].tabIndex = 0;
  }
  for (const item of document.querySelectorAll(".faq-list details")) {
    const summary = item.querySelector("summary"), answer = item.querySelector("p");
    summary.hidden = !hasText(summary.textContent); answer.hidden = !hasText(answer.textContent);
    item.hidden = summary.hidden && answer.hidden;
    if (summary.hidden) item.open = true;
  }
  $("#faq").hidden = !hasText($("#faq").textContent);
}

function selectTabs(list, key, value) {
  for (const tab of list.querySelectorAll('[role="tab"]')) {
    const selected = tab.dataset[key] === value;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }
  syncIndicator(list);
}

function wireTabs(list, callback) {
  list.addEventListener("click", (event) => {
    const tab = event.target.closest('[role="tab"]');
    if (tab && list.contains(tab)) callback(tab);
  });
  list.addEventListener("keydown", (event) => {
    const tabs = [...list.querySelectorAll('[role="tab"]')].filter((tab) => !tab.hidden);
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
  optionalText($("#version-panel"), MODES[state.mode].versions[state.version]);
  $("#version-panel").setAttribute("aria-labelledby", `version-${state.version}`);
  optionalText($("#version-full small"), copy[state.mode === "kingdom" ? "versions.kingdomFullNote" : "versions.full.note"]);
  syncCopyVisibility();
}

function renderMode(direction = 1) {
  const mode = MODES[state.mode];
  selectTabs($(".mode-tabs"), "mode", state.mode);
  $("#mode-panel").setAttribute("aria-labelledby", `mode-${state.mode}`);
  optionalText($("#mode-title"), mode.title);
  optionalText($("#mode-description"), mode.description);
  optionalText($("#diagram-caption"), mode.diagram);
  optionalText($("#mode-caption"), mode.caption);
  swapImage($("#mode-image"), imageFor(`screen-${mode.screenshot}`, imageConfig).src, { alt: `${state.mode === "tactical" ? "术点" : "王国"}模式实机画面`, direction });
  $("#mode-steps").replaceChildren(...mode.steps.filter(hasText).map((text, index) => {
    const li = document.createElement("li");
    const number = document.createElement("span");
    number.textContent = String(index + 1).padStart(2, "0");
    li.append(number, document.createTextNode(text));
    return li;
  }));
  $("#mode-steps").hidden = !$("#mode-steps").children.length;
  renderVersion();
}

function renderSkill() {
  const role = CHARACTERS.find((character) => character.id === state.character);
  selectTabs($(".skill-tabs"), "skill", state.skill);
  $("#skill-panel").setAttribute("aria-labelledby", `skill-${state.skill}`);
  optionalText($("#skill-name"), role[state.skill][0]);
  optionalText($("#skill-description"), role[state.skill][1]);
  $("#skill-panel").hidden = !role[state.skill].some(hasText);
}

function renderCharacter(direction = 1) {
  const role = CHARACTERS.find((character) => character.id === state.character);
  selectTabs($("#character-picker"), "character", state.character);
  swapImage($("#character-image"), imageFor(`character-${role.id}`, imageConfig).src, { alt: hasText(role.name) ? `${role.name}角色原画` : "角色原画", direction });
  optionalText($("#character-name"), role.name);
  optionalText($("#character-english"), role.english);
  optionalText($("#character-quote"), hasText(role.quote) ? `「${role.quote}」` : "");
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
    image.dataset.imageSlot = `character-${role.id}`;
    image.src = imageFor(image.dataset.imageSlot, imageConfig).src;
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
  wireTabs(picker, (tab) => {
    if (state.character === tab.dataset.character) return;
    const direction = Math.sign(CHARACTERS.findIndex((role) => role.id === tab.dataset.character) - CHARACTERS.findIndex((role) => role.id === state.character));
    state.character = tab.dataset.character;
    renderCharacter(direction);
    revealContent([$("#character-name"), $("#character-english"), $("#character-quote"), $("#skill-panel")], { direction });
  });
  renderCharacter();
}

function showScreenshot(index, animate = false) {
  const previous = state.screenshot;
  const direction = Math.sign(index - previous) || 1;
  state.screenshot = (index + SCREENSHOTS.length) % SCREENSHOTS.length;
  const shot = SCREENSHOTS[state.screenshot];
  const source = imageFor(`screen-${shot.id}`, imageConfig).src;
  swapImage($("#gallery-image"), source, { alt: shot.alt, direction });
  optionalText($("#gallery-caption"), shot.caption);
  $("#gallery-open").setAttribute("aria-label", hasText(shot.title) ? `放大查看：${shot.title}` : "放大查看当前实机截图");
  $("#gallery-count").textContent = `${String(state.screenshot + 1).padStart(2, "0")} / ${String(SCREENSHOTS.length).padStart(2, "0")}`;
  for (const [position, button] of [...$("#gallery-thumbnails").children].entries()) {
    button.setAttribute("aria-pressed", String(position === state.screenshot));
  }
  if (animate && previous !== state.screenshot) revealContent([$("#gallery-caption"), $("#gallery-count")], { direction, stagger: 18 });
  if (dialog.open) renderDialogImage(direction, animate);
}

function renderDialogImage(direction = 1, animate = false) {
  const shot = SCREENSHOTS[state.screenshot];
  swapImage($("#dialog-image"), imageFor(`screen-${shot.id}`, imageConfig).src, { alt: shot.alt, direction });
  optionalText($("#dialog-caption"), shot.caption);
  if (hasText(shot.caption)) { dialog.setAttribute("aria-labelledby", "dialog-caption"); dialog.removeAttribute("aria-label"); }
  else { dialog.removeAttribute("aria-labelledby"); dialog.setAttribute("aria-label", "实机截图预览"); }
  if (animate) revealContent([$("#dialog-caption")], { direction });
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
    image.dataset.imageSlot = `screen-${shot.id}`;
    image.src = imageFor(image.dataset.imageSlot, imageConfig).src;
    image.alt = "";
    image.loading = "lazy";
    image.width = 320;
    image.height = 180;
    const label = document.createElement("span");
    label.textContent = shot.title;
    button.append(image, label);
    button.addEventListener("click", () => showScreenshot(index, true));
    rail.append(button);
  }
  $("#gallery-prev").addEventListener("click", () => showScreenshot(state.screenshot - 1, true));
  $("#gallery-next").addEventListener("click", () => showScreenshot(state.screenshot + 1, true));
  $("#gallery-open").addEventListener("click", () => openScreenshot());
  $("#mode-preview").addEventListener("click", () => openScreenshot(state.mode === "tactical" ? 0 : 1));
  $("#dialog-close").addEventListener("click", () => dialog.close());
  $("#dialog-prev").addEventListener("click", () => showScreenshot(state.screenshot - 1, true));
  $("#dialog-next").addEventListener("click", () => showScreenshot(state.screenshot + 1, true));
  dialog.addEventListener("close", () => { document.body.style.overflow = ""; });
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
  dialog.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    showScreenshot(state.screenshot + (event.key === "ArrowRight" ? 1 : -1), true);
  });
  showScreenshot(state.screenshot);
}

function setupReleaseLinks() {
  let available = false;
  for (const [key, id] of [["downloadUrl", "download-link"], ["communityUrl", "community-link"]]) {
    const url = configuredUrl(copy[`release.${key}`]);
    const link = $(`#${id}`);
    const label = copy[`release.${key === "downloadUrl" ? "downloadLabel" : "communityLabel"}`];
    link.hidden = !url || !hasText(label);
    if (link.hidden) { link.removeAttribute("href"); continue; }
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.hidden = false;
    available = true;
  }
  $("#release-links").hidden = !available;
  const ready = Boolean(configuredUrl(copy["release.downloadUrl"]));
  optionalText($("#download-answer"), copy[ready ? "faq.download.readyAnswer" : "faq.download.answer"]);
  $(".development-status").lastChild.textContent = copy[ready ? "release.readyStatus" : "release.status"];
}

function applyImages() {
  for (const element of document.querySelectorAll("[data-image-slot]")) {
    const image = imageFor(element.dataset.imageSlot, imageConfig);
    if (element.tagName === "LINK") element.href = image.src;
    else {
      swapImage(element, image.src, { alt: element.alt });
      element.width = image.width; element.height = image.height;
      element.classList.toggle("is-custom-image", image.custom);
      if (element.parentElement.classList.contains("character-portrait")) element.parentElement.classList.toggle("is-custom-image", image.custom);
    }
  }
  $("meta[property='og:image']").content = new URL(imageFor("screen-kingdom", imageConfig).src, document.baseURI).href;
}

function applyContent(content) {
  prepareContent(content);
  applySiteContent(copy, imageConfig);
  applyImages();
  document.title = copy["site.title"];
  $("meta[name='description']").content = copy["site.description"];
  $("meta[property='og:title']").content = copy["site.shareTitle"];
  $("meta[property='og:description']").content = copy["site.shareDescription"];
  $(".site-header .brand").setAttribute("aria-label", `${copy["site.brand"]}首页`);
  CHARACTERS.forEach((role, index) => {
    const button = $(`#character-${role.id}`);
    optionalText(button.lastChild, role.name);
    button.setAttribute("aria-label", hasText(role.name) ? role.name : `角色 ${index + 1}`);
  });
  SCREENSHOTS.forEach((shot, index) => {
    const button = $("#gallery-thumbnails").children[index];
    button.setAttribute("aria-label", hasText(shot.title) ? `查看${shot.title}实机截图` : `查看第 ${index + 1} 张实机截图`);
    optionalText(button.lastChild, shot.title);
  });
  renderMode();
  renderCharacter();
  showScreenshot(state.screenshot);
  setupReleaseLinks();
  renderCommunity(copy, imageConfig);
  syncCopyVisibility();
}

wireTabs($(".mode-tabs"), (tab) => {
  if (state.mode === tab.dataset.mode) return;
  const direction = tab.dataset.mode === "kingdom" ? 1 : -1;
  state.mode = tab.dataset.mode;
  renderMode(direction);
  revealContent([$("#mode-title"), $("#mode-description"), $("#mode-steps"), $("#diagram-caption"), $("#mode-caption"), $("#version-panel")], { direction, stagger: 18 });
});
wireTabs($(".version-tabs"), (tab) => {
  if (state.version === tab.dataset.version) return;
  const order = ["standard", "advanced", "expert", "full"];
  const direction = Math.sign(order.indexOf(tab.dataset.version) - order.indexOf(state.version));
  state.version = tab.dataset.version;
  renderVersion();
  revealContent([$("#version-panel")], { direction });
});
wireTabs($(".skill-tabs"), (tab) => {
  if (state.skill === tab.dataset.skill) return;
  const direction = tab.dataset.skill === "kingdom" ? 1 : -1;
  state.skill = tab.dataset.skill;
  renderSkill();
  revealContent([$("#skill-panel")], { direction });
});
renderMode();
buildCharacters();
buildGallery();
setupNavigation();
applyContent(copy);
setupIndicators([...document.querySelectorAll('.mode-tabs, .version-tabs, .skill-tabs, #character-picker')]);
setupCommunity(() => copy);
setupLocalPreview(() => copy, (content, images, context) => {
  if (images && typeof images === "object") imageConfig = images;
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
});
