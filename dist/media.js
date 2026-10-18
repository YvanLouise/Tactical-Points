import { CHARACTERS, SCREENSHOTS } from "./data.js";

const names = ["武士", "学者", "守卫", "冒险家", "特种兵", "魔术师", "巫师", "商人", "铁卫", "困兽", "先知"];
const screens = [["术点模式", 910, 447], ["王国模式", 1672, 941], ["角色选择", 1280, 720], ["交互教程", 1280, 720]];
export const IMAGE_LIMITS = { bytes: 12 * 1024 * 1024, edge: 8192, pixels: 32 * 1024 * 1024 };
export const IMAGE_SLOTS = [
  { id: "hero", label: "首屏插画", group: "首屏与装饰", src: "./assets/hero.png", width: 1358, height: 1159, context: { anchor: "intro" } },
  { id: "faq", label: "常见问题装饰图", group: "首屏与装饰", src: "./assets/cat.svg", width: 150, height: 100, context: { anchor: "faq" } },
  ...CHARACTERS.map((role, index) => ({ id: `character-${role.id}`, label: names[index], group: "角色立绘", src: `./assets/characters/${role.id}.png`, width: 1086, height: 1448, context: { anchor: "characters", character: role.id } })),
  ...SCREENSHOTS.map((shot, index) => ({ id: `screen-${shot.id}`, label: screens[index][0], group: "实机截图", src: `./assets/screens/${shot.id}.png`, width: screens[index][1], height: screens[index][2], context: { anchor: "gallery", screenshot: index } })),
  { id: "favicon", label: "浏览器图标", group: "站点图标", src: "./assets/favicon.png", width: 254, height: 254, context: { anchor: "intro" } },
];

export function imageFor(id, overrides = {}) {
  const slot = IMAGE_SLOTS.find((item) => item.id === id);
  return { ...slot, ...overrides[id], custom: Boolean(overrides[id]) };
}
