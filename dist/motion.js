const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const activeAnimations = new Set();
const elementAnimations = new WeakMap();
const pendingImages = new WeakMap();
const indicators = new WeakMap();
const motionStyle = getComputedStyle(document.documentElement);
const duration = (name, fallback) => Number.parseFloat(motionStyle.getPropertyValue(name)) || fallback;
const contentDuration = duration("--motion-content", 260);
const imageDuration = duration("--motion-image", 320);
const easeOut = motionStyle.getPropertyValue("--ease-paper").trim() || "cubic-bezier(.22, 1, .36, 1)";

function animate(element, frames, options) {
  elementAnimations.get(element)?.cancel();
  if (reducedMotion.matches || !element.animate || !element.isConnected) return;
  const animation = element.animate(frames, { duration: contentDuration, easing: easeOut, ...options });
  elementAnimations.set(element, animation);
  activeAnimations.add(animation);
  const cleanup = () => {
    activeAnimations.delete(animation);
    if (elementAnimations.get(element) === animation) elementAnimations.delete(element);
  };
  animation.finished.then(cleanup, cleanup);
}

reducedMotion.addEventListener("change", () => {
  if (reducedMotion.matches) for (const animation of activeAnimations) animation.cancel();
});

export function revealContent(elements, { direction = 1, stagger = 24 } = {}) {
  elements.filter(Boolean).forEach((element, index) => animate(element, [
    { opacity: 0.25, translate: `${direction * 7}px 5px` },
    { opacity: 1, translate: "0px 0px" },
  ], { delay: index * stagger, fill: "backwards" }));
}

export function swapImage(image, source, { alt = "", direction = 1 } = {}) {
  const absolute = new URL(source, document.baseURI).href;
  const previous = pendingImages.get(image);
  if (previous?.source === absolute) { previous.alt = alt; return; }
  const pending = { source: absolute, alt };
  pendingImages.set(image, pending);
  if (image.src === absolute) {
    image.alt = alt;
    image.removeAttribute("aria-busy");
    pendingImages.delete(image);
    return;
  }
  image.setAttribute("aria-busy", "true");
  const commit = () => {
    // A slower image request must never replace a newer selection.
    if (pendingImages.get(image) !== pending || !image.isConnected) return;
    pendingImages.delete(image);
    image.src = source;
    image.alt = pending.alt;
    image.removeAttribute("aria-busy");
    animate(image, [
      { opacity: 0.35, translate: `${direction * 12}px 3px`, scale: 0.985 },
      { opacity: 1, translate: "0px 0px", scale: 1 },
    ], { duration: imageDuration });
  };
  if (reducedMotion.matches) { commit(); return; }
  const next = new Image();
  next.src = absolute;
  next.decode().then(commit, commit);
}

export function syncIndicator(rail) { indicators.get(rail)?.(); }

export function setupIndicators(rails) {
  for (const rail of rails) {
    let queued = false;
    function update() {
      queued = false;
      const selected = rail.querySelector('[role="tab"][aria-selected="true"]');
      if (!selected) return;
      const container = rail.getBoundingClientRect();
      const target = selected.getBoundingClientRect();
      if (!target.width || !target.height) {
        rail.removeAttribute("data-motion-tabs");
        rail.removeAttribute("data-motion-ready");
        return;
      }
      const picker = rail.classList.contains("character-picker");
      const x = target.left - container.left + rail.scrollLeft - rail.clientLeft;
      const y = target.top - container.top + rail.scrollTop - rail.clientTop;
      rail.style.setProperty("--marker-x", `${picker ? x + (target.width - 35) / 2 : x}px`);
      rail.style.setProperty("--marker-y", `${picker ? y + target.height - 2 : y}px`);
      rail.style.setProperty("--marker-width", `${picker ? 35 : target.width}px`);
      rail.style.setProperty("--marker-height", `${picker ? 2 : target.height}px`);
      if (!rail.hasAttribute("data-motion-tabs")) {
        rail.setAttribute("data-motion-tabs", "");
        requestAnimationFrame(() => rail.setAttribute("data-motion-ready", ""));
      }
    }
    const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(update); } };
    indicators.set(rail, schedule);
    const observer = new ResizeObserver(schedule);
    observer.observe(rail);
    for (const button of rail.querySelectorAll('[role="tab"]')) observer.observe(button);
    document.fonts.ready.then(schedule);
    update();
  }
}
