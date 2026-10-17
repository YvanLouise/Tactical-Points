# 术点牌官方网站

独立的静态官网，源文件和部署文件都在 `dist/`。不依赖框架和第三方前端库，不需要安装 npm 依赖。

## 本地运行

使用 Node.js 运行：

```powershell
cd D:\Godot\project\术点牌\website
npm run dev
```

打开 http://127.0.0.1:4173/ 。`npm run check` 检查脚本语法。

## 修改内容

- `dist/index.html`：页面结构、SEO、常见问题。
- `dist/styles.css`：字体、颜色、桌面和移动端布局。
- `dist/data.js`：两种玩法、四个版本、十一位角色和截图说明。
- `dist/config.js`：下载链接、社群链接、开发说明。链接留空时自动隐藏对应入口。
- `dist/assets/`：从游戏复制的角色和实机截图、官网首屏插画、字体及其授权说明。
- `design/design-system.md`：视觉规范与内容约束。

新增下载或社群入口时，在 `dist/config.js` 填入正式 HTTP(S) 链接，然后重新部署。发布平台有变化时，同步更新 `index.html` 中的 canonical 和 Open Graph URL。

## 内容来源

规则依据 `docs/tactical_rules.md`、`docs/kingdom_rules_v1.md` 与实际规则脚本；角色插画、台词与能力依据游戏角色资料。网站明确标注开发中截图、术点事件占位及王国完整版未开放状态。当前没有伪下载入口、预约表单或统计追踪。

`website/.gdignore` 防止 Godot 将官网资源当作游戏素材导入。官网文件不会改变游戏本体。
