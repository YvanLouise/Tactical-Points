# Official site design

Source concepts: hero.png, modes.png, characters.png, gallery.png.

## Visual system

- Paper: #f3f0e7. Ink: #343832. Sage: #7b8472. Red: #aa503f.
- Display: the game's ZCOOL KuaiLe. English accents: Patrick Hand. Body: system Chinese sans-serif.
- Content width: 1280px; desktop gutter: 72px; mobile gutter: 22px.
- Thin graphite rules, paper frames, shallow offset shadows; no gradients or full-section card wrappers.
- Hero: left-aligned two-line heading, two links, right-aligned standalone character illustration with transparent edges.
- Section order: introduction, modes, characters, real screenshots, FAQ, development note, footer.
- Native interactions: mode and version tabs, character selector and ability tabs, screenshot navigation and modal, mobile navigation, FAQ disclosure.
- Motion: small opacity/translation changes; disable with prefers-reduced-motion.

## Interaction motion

- Press: 100ms; hover: 180ms; selection plate: 280ms; text reveal: 260ms with 24ms steps; decoded image reveal: 320ms; modal/menu: 180ms.
- Easing: cubic-bezier(.22, 1, .36, 1). Only small translations and scale changes; no bounce loops, page-wide reveals, gradients or pointer trails.
- Mode, version and skill tabs share one sliding indicator. Character selection moves a red ink underline; layout measurement refreshes after fonts and viewport changes.
- Selection state and copy update immediately. Cancelled visual animations cannot delay or overwrite the latest selection. Images keep their previous frame until the next image is decoded; late image loads cannot override a newer choice.
- Keep native keyboard tabs, focus rings, details and dialog behavior. Reduced motion disables both CSS transitions and Web Animations and immediately cancels animations already running.

## Hero copy lock

- 术点牌
- 游戏介绍 / 玩法模式 / 角色图鉴 / 实机画面 / 开发进度
- 纸间落子，点数生变。
- 一场从数字开始的策略对决。
- 叠牌、顺牌、暗置与猜心，把每一手打出新的可能。
- 了解玩法 / 看看实机
- 单人策略卡牌 · 术点 / 王国
- 往下翻，认识这副牌

## Source fidelity

Use actual game screenshots instead of generated approximations of the interface. Preserve all eleven original character artworks instead of generated variants. Do not introduce the ruins or lore improvised by the character concept. Use the source roster's actual character quotes. Download and community links remain unset at the user's request. The site describes development status without a fake download button.
