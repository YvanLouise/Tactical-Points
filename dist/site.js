import { imageFor } from "./media.js";

export const hasText = (value) => typeof value === "string" && Boolean(value.trim());
export function configuredUrl(value) {
  if (!hasText(value) || value !== value.trim()) return null;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
export function optionalText(element, text) {
  if (!element) return;
  element.textContent = hasText(text) ? text : "";
  element.hidden = !hasText(text);
}
export function applySiteContent(copy, images, { about = false } = {}) {
  for (const element of document.querySelectorAll("[data-copy]")) optionalText(element, copy[element.dataset.copy]);
  for (const element of document.querySelectorAll("[data-copy-alt]")) element.alt = copy[element.dataset.copyAlt] || "";
  for (const element of document.querySelectorAll('[data-image-slot="author-avatar"], [data-image-slot="community-qr"], link[data-image-slot="favicon"]')) {
    const asset = imageFor(element.dataset.imageSlot, images);
    if (element.tagName === "LINK") element.href = asset.src;
    else { element.src = asset.src; element.width = asset.width; element.height = asset.height; }
  }
  for (const element of document.querySelectorAll("[data-text-link], #site-nav a, .mobile-nav a, .footer-links a")) element.hidden = !hasText(element.textContent);
  for (const element of document.querySelectorAll("[data-copy-block]")) element.hidden = !hasText(element.textContent);
  const nav = document.querySelector("#site-nav"), toggle = document.querySelector("#menu-toggle");
  if (nav && toggle) { nav.hidden = [...nav.children].every((node) => node.hidden); toggle.hidden = nav.hidden; }
  const bottom = document.querySelector(".mobile-nav");
  if (bottom) bottom.hidden = [...bottom.children].every((node) => node.hidden);
  const profile = document.querySelector("#author-profile");
  if (profile) {
    const url = configuredUrl(copy["author.profileUrl"]);
    profile.hidden = !url || !hasText(copy["author.profileLabel"]);
    if (url) profile.href = url; else profile.removeAttribute("href");
  }
  if (about) {
    document.title = copy["author.pageTitle"];
    document.querySelector('meta[name="description"]').content = copy["author.pageDescription"];
    document.querySelector('meta[property="og:title"]').content = copy["author.pageTitle"];
    document.querySelector('meta[property="og:description"]').content = copy["author.pageDescription"];
  }
  document.querySelector(".site-header .brand")?.setAttribute("aria-label", `${copy["site.brand"] || ""}首页`);
}

export function renderCommunity(copy, images) {
  const section = document.querySelector("#community");
  if (!section) return;
  const url = configuredUrl(copy["release.communityUrl"]);
  const number = copy["community.groupNumber"] || "";
  const qr = imageFor("community-qr", images);
  const ready = Boolean(url || hasText(number) || qr.custom);
  optionalText(document.querySelector("#community-status"), copy[ready ? "community.readyStatus" : "community.status"]);
  optionalText(document.querySelector("#community-note"), copy[ready ? "community.readyNote" : "community.note"]);
  section.classList.toggle("is-ready", ready);
  const join = document.querySelector("#community-join");
  join.hidden = !url || !hasText(copy["release.communityLabel"]);
  if (url) join.href = url; else join.removeAttribute("href");
  document.querySelector("#community-number-row").hidden = !hasText(number);
  optionalText(document.querySelector("#community-number"), number);
  document.querySelector("#community-copy").hidden = !hasText(number) || !hasText(copy["community.copyLabel"]);
  document.querySelector("#community-qr").hidden = !qr.custom;
  document.querySelector("#community-qr-image").href = qr.src;
  document.querySelector("#community-actions").hidden = join.hidden && !hasText(number);
  section.hidden = !hasText(section.textContent) && !qr.custom;
}

export function setupCommunity(getCopy) {
  const button = document.querySelector("#community-copy");
  if (!button) return;
  let sequence = 0;
  button.addEventListener("click", async () => {
    const copy = getCopy(), number = copy["community.groupNumber"], current = ++sequence;
    const result = document.querySelector("#community-copy-result");
    result.textContent = "";
    if (!hasText(number)) return;
    try {
      await navigator.clipboard.writeText(number);
      if (current === sequence) result.textContent = copy["community.copiedLabel"];
    } catch {
      if (current === sequence) result.textContent = copy["community.copyError"];
    }
  });
}

export function setupNavigation() {
  const toggle = document.querySelector("#menu-toggle"), nav = document.querySelector("#site-nav");
  const compact = window.matchMedia("(max-width: 1100px)");
  const sync = () => { nav.inert = compact.matches && !nav.classList.contains("is-open"); };
  function close() {
    nav.classList.remove("is-open");
    toggle.setAttribute("aria-expanded", "false"); toggle.setAttribute("aria-label", "打开导航");
    toggle.querySelector("use").setAttribute("href", "#menu"); sync();
  }
  toggle.addEventListener("click", () => {
    const open = nav.classList.toggle("is-open");
    toggle.setAttribute("aria-expanded", String(open)); toggle.setAttribute("aria-label", open ? "关闭导航" : "打开导航");
    toggle.querySelector("use").setAttribute("href", open ? "#close" : "#menu"); sync();
  });
  compact.addEventListener("change", close); sync();
  nav.addEventListener("click", (event) => { if (event.target.closest("a")) close(); });
  document.addEventListener("click", (event) => { if (!event.target.closest(".site-header")) close(); });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") { close(); toggle.focus(); }
  });
  if (document.body.dataset.page === "about") return;
  const links = [...document.querySelectorAll("#site-nav .nav-link, .mobile-nav a")];
  const sections = [...document.querySelectorAll("main section[id]")];
  function highlight() {
    const line = window.innerHeight * 0.32;
    const active = sections.filter((section) => !section.hidden && section.getBoundingClientRect().top <= line).at(-1)?.id || "intro";
    const shortcut = { faq: "gallery", "author-teaser": "community", development: "community" }[active] || active;
    for (const link of links) {
      const selected = link.hash === `#${link.closest(".mobile-nav") ? shortcut : active}` && !link.pathname.endsWith("about.html");
      link.classList.toggle("is-active", selected);
      if (selected) link.setAttribute("aria-current", "location"); else link.removeAttribute("aria-current");
    }
  }
  let scheduled = false;
  window.addEventListener("scroll", () => {
    if (scheduled) return;
    scheduled = true; requestAnimationFrame(() => { scheduled = false; highlight(); });
  }, { passive: true });
  window.addEventListener("resize", highlight); highlight();
}

export function setupLocalPreview(getCopy, update) {
  if (!["localhost", "127.0.0.1"].includes(location.hostname) || window.parent === window || !new URLSearchParams(location.search).has("editor-preview")) return;
  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); window.parent.postMessage({ type: "copy-editor-save" }, location.origin); }
  });
  document.addEventListener("click", (event) => {
    const link = event.target.closest("a[href]");
    if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || link.target === "_blank") return;
    const url = new URL(link.href), base = new URL("./", import.meta.url);
    const aboutPath = new URL("about.html", base).pathname;
    if (url.origin !== location.origin || ![base.pathname, `${base.pathname}index.html`, aboutPath].includes(url.pathname) || url.pathname === location.pathname) return;
    event.preventDefault();
    window.parent.postMessage({ type: "copy-preview-navigate", page: url.pathname === aboutPath ? "about" : "home", anchor: url.hash.slice(1) }, location.origin);
  });
  window.addEventListener("message", (event) => {
    if (event.origin !== location.origin || event.source !== window.parent || event.data?.type !== "copy-preview") return;
    const { content, images, context = {}, focus = false } = event.data;
    if (!content || Object.keys(getCopy()).some((key) => typeof content[key] !== "string")) return;
    update(content, images, context);
    if (focus && context.anchor === "intro") window.scrollTo({ top: 0, behavior: "instant" });
    else if (focus && typeof context.anchor === "string") document.getElementById(context.anchor)?.scrollIntoView({ behavior: "instant", block: "start" });
    window.parent.postMessage({ type: "copy-preview-applied" }, location.origin);
  });
  window.parent.postMessage({ type: "copy-preview-ready", page: document.body.dataset.page === "about" ? "about" : "home" }, location.origin);
}
