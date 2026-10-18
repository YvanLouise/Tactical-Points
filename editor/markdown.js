const repository = "https://github.com/YvanLouise/Tactical-Points/blob/main/";
const rawFiles = "https://raw.githubusercontent.com/YvanLouise/Tactical-Points/main/";
const node = (tag, text) => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  return element;
};

function safeUrl(value, image = false) {
  try {
    if (/[\u0000-\u001f\u007f]/.test(value)) return null;
    const url = new URL(value, image ? rawFiles : repository);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function inline(text, parent, depth = 0) {
  if (depth > 5) { parent.append(document.createTextNode(text)); return; }
  const pattern = /(`[^`\n]+`|!?\[[^\]\n]*\]\([^\s)]+\)|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|\*[^*\n]+\*|_[^_\n]+_)/g;
  let start = 0;
  for (const match of text.matchAll(pattern)) {
    parent.append(document.createTextNode(text.slice(start, match.index)));
    const token = match[0];
    const link = token.match(/^(!?)\[([^\]]*)\]\(([^\s)]+)\)$/);
    if (link) {
      const url = safeUrl(link[3], Boolean(link[1]));
      if (!url) parent.append(document.createTextNode(token));
      else if (link[1]) {
        const image = node("img");
        image.src = url; image.alt = link[2]; image.loading = "lazy"; image.referrerPolicy = "no-referrer";
        parent.append(image);
      } else {
        const anchor = node("a"); anchor.href = url; anchor.target = "_blank"; anchor.rel = "noopener noreferrer";
        inline(link[2], anchor, depth + 1); parent.append(anchor);
      }
    } else {
      const double = token.startsWith("**") || token.startsWith("__") || token.startsWith("~~");
      const tag = token.startsWith("`") ? "code" : token.startsWith("~~") ? "del" : double ? "strong" : "em";
      const element = node(tag);
      const content = token.slice(double ? 2 : 1, double ? -2 : -1);
      if (tag === "code") element.textContent = content;
      else inline(content, element, depth + 1);
      parent.append(element);
    }
    start = match.index + token.length;
  }
  parent.append(document.createTextNode(text.slice(start)));
}

const listItem = (line) => line.match(/^(\s*)([-+*]|\d+[.)])\s+(.*)$/);
const cells = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
const tableRule = (line = "") => line.includes("|") && cells(line).every((cell) => /^:?-{3,}:?$/.test(cell));
const startsBlock = (line, next) => !line.trim() || /^ {0,3}(#{1,6}\s|`{3,}|~{3,}|>\s?|(?:-\s*){3,}$|(?:\*\s*){3,}$)/.test(line) || listItem(line) || tableRule(next);

function blocks(lines, parent, depth = 0) {
  if (depth > 8) { parent.append(node("p", lines.join("\n"))); return; }
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index++; continue; }
    const fence = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      const code = []; index++;
      while (index < lines.length && !new RegExp(`^ {0,3}${fence[1][0]}{${fence[1].length},}\\s*$`).test(lines[index])) code.push(lines[index++]);
      const pre = node("pre"); pre.append(node("code", code.join("\n"))); parent.append(pre); index++; continue;
    }
    const heading = line.match(/^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) { const title = node(`h${heading[1].length}`); inline(heading[2], title); parent.append(title); index++; continue; }
    if (/^\s*(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/.test(line)) { parent.append(node("hr")); index++; continue; }
    if (/^ {0,3}>/.test(line)) {
      const quote = []; while (index < lines.length && /^ {0,3}>/.test(lines[index])) quote.push(lines[index++].replace(/^ {0,3}>\s?/, ""));
      const element = node("blockquote"); blocks(quote, element, depth + 1); parent.append(element); continue;
    }
    if (index + 1 < lines.length && line.includes("|") && tableRule(lines[index + 1])) {
      const table = node("table"), head = node("thead"), row = node("tr"), body = node("tbody");
      const headers = cells(line);
      for (const text of headers) { const cell = node("th"); inline(text, cell); row.append(cell); }
      head.append(row); index += 2;
      while (index < lines.length && lines[index].trim() && lines[index].includes("|")) {
        const row = node("tr"), values = cells(lines[index++]);
        for (let column = 0; column < headers.length; column++) { const cell = node("td"); inline(values[column] || "", cell); row.append(cell); }
        body.append(row);
      }
      table.append(head, body); const wrapper = node("div"); wrapper.className = "markdown-table"; wrapper.append(table); parent.append(wrapper); continue;
    }
    const first = listItem(line);
    if (first) {
      const ordered = /^\d/.test(first[2]), indent = first[1].length;
      const list = node(ordered ? "ol" : "ul");
      if (ordered) list.start = Number.parseInt(first[2], 10);
      while (index < lines.length) {
        const match = listItem(lines[index]);
        if (!match || match[1].length !== indent || /^\d/.test(match[2]) !== ordered) break;
        const item = node("li"), task = match[3].match(/^\[([ xX])\]\s+(.*)$/);
        if (task) { const box = node("input"); box.type = "checkbox"; box.checked = task[1].toLowerCase() === "x"; box.disabled = true; item.append(box); inline(task[2], item); }
        else inline(match[3], item);
        index++;
        const nested = [];
        while (index < lines.length && lines[index].trim() && /^\s+/.test(lines[index]) && lines[index].match(/^\s*/)[0].length > indent) nested.push(lines[index++].slice(indent + 2));
        if (nested.length) blocks(nested, item, depth + 1);
        list.append(item);
      }
      parent.append(list); continue;
    }
    const paragraph = [line]; index++;
    while (index < lines.length && !startsBlock(lines[index], lines[index + 1])) paragraph.push(lines[index++]);
    const element = node("p"); inline(paragraph.join("\n"), element); parent.append(element);
  }
}

export function renderMarkdown(text, container) {
  // Render authored text through DOM text nodes; raw HTML and active URL schemes stay inert.
  const fragment = document.createDocumentFragment();
  if (text.trim()) blocks(text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n"), fragment);
  else { const empty = node("p", "README 还是空的。从左侧写下项目介绍，预览会显示在这里。"); empty.className = "markdown-empty"; fragment.append(empty); }
  container.replaceChildren(fragment);
}
