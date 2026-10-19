import { CHARACTERS, SCREENSHOTS } from "../dist/data.js";

const field = (key, label, options = {}) => ({ key, label, maxLength: 300, rows: 1, optional: true, ...options });
const paragraph = (key, label, options) => field(key, label, { rows: 3, maxLength: 2000, ...options });
const group = (label, fields, context = {}) => ({ label, fields, context });
const roleNames = ["武士", "学者", "守卫", "冒险家", "特种兵", "魔术师", "巫师", "商人", "铁卫", "困兽", "先知"];
const modeNames = { tactical: "术点模式", kingdom: "王国模式" };
const versionNames = { standard: "普通版", advanced: "进阶版", expert: "高阶版", full: "完整版" };

export const sections = [
  { id: "home", label: "首页首屏", anchor: "intro", note: "标题分为首行、强调词和结尾，保留现有排版。", groups: [group("第一眼的介绍", [
    field("hero.headingStart", "标题 · 首行", { maxLength: 40 }), field("hero.headingAccent", "标题 · 强调词", { maxLength: 20 }), field("hero.headingEnd", "标题 · 结尾", { maxLength: 40 }),
    paragraph("hero.description", "游戏简介", { hint: "回车可换行。" }), field("hero.primaryButton", "主按钮文字"), field("hero.secondaryButton", "次按钮文字"),
    field("hero.note", "简介下方的小字"), field("hero.scroll", "向下浏览提示"), field("hero.imageAlt", "首屏插画的替代文字", { hint: "供读屏软件和图片无法加载时使用。" }),
  ])] },
  { id: "modes", label: "玩法介绍", anchor: "modes", note: "编辑不同玩法或版本时，预览会自动切换到对应内容。", groups: [
    group("版块标题", [field("modes.heading", "标题"), field("modes.versionsHeading", "版本介绍标题"), paragraph("modes.footnote", "开发状态说明")]),
    ...Object.entries(modeNames).map(([mode, name]) => group(name, [
      field(`modes.${mode}.name`, "标签名称"), field(`modes.${mode}.title`, "玩法标题"), paragraph(`modes.${mode}.description`, "玩法说明"),
      ...[1, 2, 3].map((n) => field(`modes.${mode}.step${n}`, `步骤 ${n}`)), field(`modes.${mode}.diagram`, "叠牌示意说明"), field(`modes.${mode}.caption`, "实机图注"),
      ...Object.entries(versionNames).map(([version, label]) => paragraph(`modes.${mode}.versions.${version}`, `${label}说明`, { context: { mode, version } })),
    ], { mode })),
    group("版本标签", [
      ...Object.entries(versionNames).flatMap(([version, label]) => [field(`versions.${version}.name`, `${label} · 名称`, { context: { version } }), field(`versions.${version}.note`, `${label} · 小字`, { context: { version, mode: "tactical" } })]),
      field("versions.kingdomFullNote", "王国完整版 · 小字", { context: { mode: "kingdom", version: "full" } }),
    ]),
  ] },
  { id: "characters", label: "角色图鉴", anchor: "characters", note: "选择角色后调整台词与能力说明，角色原画保持不变。", groups: [
    group("版块介绍", [field("characters.heading", "标题"), paragraph("characters.description", "简介"), field("characters.tacticalLabel", "术点技能标签"), field("characters.kingdomLabel", "王国能力标签"), paragraph("characters.footnote", "规则提示")]),
    ...CHARACTERS.map(({ id }, index) => group(roleNames[index], [
      field(`characters.${id}.name`, "角色名称"), field(`characters.${id}.english`, "英文名称"), field(`characters.${id}.quote`, "角色台词", { hint: "无需输入两侧的引号。" }),
      ...Object.entries(modeNames).flatMap(([skill, name]) => [field(`characters.${id}.${skill}Name`, `${name} · 能力名`, { context: { skill } }), paragraph(`characters.${id}.${skill}Description`, `${name} · 能力说明`, { context: { skill } })]),
    ], { character: id })),
  ] },
  { id: "gallery", label: "实机画面", anchor: "gallery", note: "调整截图名称和说明；实际图片可在“图片素材”更换。", groups: [
    group("版块标题", [field("gallery.heading", "标题")]),
    ...SCREENSHOTS.map(({ id }, screenshot) => group(["术点模式", "王国模式", "角色选择", "交互教程"][screenshot], [field(`gallery.${id}.title`, "截图名称"), field(`gallery.${id}.caption`, "图片说明"), paragraph(`gallery.${id}.alt`, "图片替代文字")], { screenshot })),
  ] },
  { id: "faq", label: "常见问题", anchor: "faq", note: "修改问题和回答，预览中会展开当前编辑的问题。", groups: [
    group("版块标题", [paragraph("faq.heading", "标题", { rows: 2 })]),
    ...[["download", "下载游戏"], ["multiplayer", "联机说明"], ["kingdom", "版本状态"]].map(([id, name], faq) => group(name, [field(`faq.${id}.question`, "问题"), paragraph(`faq.${id}.answer`, "回答")], { faq })),
    group("下载开放后", [paragraph("faq.download.readyAnswer", "已有下载链接时的回答", { hint: "填入下载链接后，自动替换下载问题的回答。", context: { faq: 0 } })]),
  ] },
  { id: "release", label: "开发与链接", anchor: "development", note: "链接留空时隐藏对应入口。只保存到本地，不会自动发布线上。", groups: [
    group("开发进度", [field("release.heading", "标题"), paragraph("release.message", "开发说明"), field("release.status", "开发中的状态文字"), field("release.readyStatus", "已有下载时的状态文字")]),
    group("下载入口", [field("release.downloadUrl", "下载 / 商店链接", { type: "url", maxLength: 2048, optional: true, hint: "尚未准备好时留空。" }), field("release.downloadLabel", "下载按钮文字")]),
  ] },
  { id: "community", label: "游戏交流群", anchor: "community", note: "没有链接、群号或二维码时显示筹备状态。群二维码可在“图片素材”上传。", groups: [
    group("社群介绍", [paragraph("community.heading", "标题", { rows: 2 }), paragraph("community.intro", "介绍"), field("community.groupName", "群名称")]),
    group("入群方式", [field("release.communityUrl", "入群链接", { type: "url", maxLength: 2048, hint: "支持完整的 HTTP(S) 链接，留空时隐藏入群按钮。" }), field("release.communityLabel", "入群按钮文字"), field("community.groupNumber", "群号", { maxLength: 80, hint: "留空时隐藏群号和复制按钮。" }), field("community.numberLabel", "群号前缀"), field("community.qrAlt", "二维码替代文字"), field("community.qrCaption", "二维码下方说明")]),
    group("状态与提示", [field("community.status", "筹备状态"), paragraph("community.note", "筹备提示"), field("community.readyStatus", "已有入群方式时的状态"), paragraph("community.readyNote", "已有入群方式时的提示"), field("community.copyLabel", "复制按钮文字"), field("community.copiedLabel", "复制成功提示"), paragraph("community.copyError", "复制失败提示")]),
  ] },
  { id: "author", label: "关于作者", page: "about", anchor: "author", note: "独立作者页与首页作者简介共用资料。头像可在“图片素材”更换，所有文案均可留空。", groups: [
    group("作者资料", [field("author.name", "作者名称"), paragraph("author.heading", "页面主标题", { rows: 2, maxLength: 160 }), field("author.role", "身份介绍"), paragraph("author.intro", "简介"), field("author.avatarAlt", "头像替代文字")]),
    group("创作与交流", [field("author.storyHeading", "创作介绍标题"), paragraph("author.story", "创作介绍"), field("author.contactHeading", "交流标题"), paragraph("author.contact", "交流说明"), field("author.profileUrl", "个人主页链接", { type: "url", maxLength: 2048 }), field("author.profileLabel", "个人主页按钮"), field("author.communityLabel", "前往社群按钮"), field("author.backLabel", "返回首页文字")]),
    group("首页作者入口", [field("author.teaserHeading", "入口标题"), paragraph("author.teaserText", "入口说明"), field("author.teaserLabel", "入口链接文字")], { page: "home", anchor: "author-teaser" }),
    group("页面信息", [field("author.pageTitle", "浏览器与分享标题"), paragraph("author.pageDescription", "搜索与分享摘要")]),
  ] },
  { id: "site", label: "导航与网站信息", anchor: "intro", note: "浏览器标题和分享摘要也会写入生成的静态页面。", groups: [
    group("网站信息", [field("site.brand", "游戏名称"), field("site.title", "浏览器标题"), paragraph("site.description", "搜索摘要"), field("site.shareTitle", "分享标题"), paragraph("site.shareDescription", "分享摘要")]),
    group("导航文字", Object.entries({ intro: "游戏介绍", modes: "玩法模式", characters: "角色图鉴", gallery: "实机画面", author: "关于作者", community: "游戏交流群", development: "开发进度" }).map(([key, label]) => field(`nav.${key}`, label))),
    group("手机底部导航", Object.entries({ intro: "首页", modes: "玩法", characters: "角色", community: "社群" }).map(([key, label]) => field(`mobile.${key}`, label))),
    group("页脚", [field("footer.english", "英文副标题"), field("footer.credit", "创作署名"), field("footer.copyright", "版权文字")], { anchor: "development" }),
  ] },
];

export const fields = sections.flatMap((section) => section.groups.flatMap((item) => item.fields));
export function validateContent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "文案必须是一个对象。";
  if (Object.keys(value).length !== fields.length) return "文案字段不完整或包含未知字段，请重新加载。";
  for (const item of fields) {
    const text = value[item.key];
    if (typeof text !== "string") return `“${item.label}”必须是文本。`;
    if (!item.optional && !text.trim()) return `“${item.label}”不能为空。`;
    if (text.length > item.maxLength) return `“${item.label}”不能超过 ${item.maxLength} 个字符。`;
    if (/\p{Cc}/u.test(text.replace(/[\r\n\t]/g, ""))) return `“${item.label}”包含无效控制字符。`;
    if (item.type === "url" && text) {
      try {
        const url = new URL(text);
        if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || text !== text.trim()) throw new Error();
      } catch { return `“${item.label}”需要填写完整的 HTTP(S) 链接，或留空。`; }
    }
  }
  return null;
}
