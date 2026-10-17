# 术点牌官方网站

独立的静态官网，源文件和部署文件都在 `dist/`。不依赖框架和第三方前端库，不需要安装 npm 依赖。

## 本地运行

使用 Node.js 运行：

```powershell
cd D:\Godot\project\术点牌\website
npm run dev
```

打开 http://127.0.0.1:4173/ 。也可以双击 `start-editor.cmd` 启动服务并自动打开编辑面板；使用期间保持终端窗口开启，按 `Ctrl+C` 停止。

## 本地文案编辑

服务启动后打开 http://127.0.0.1:4173/editor/ 。

1. 在左侧选择文案分区；玩法、角色、截图和问题可在下拉框中选择。
2. 修改字段，右侧立即预览，支持桌面与手机尺寸。编辑角色技能或玩法版本时会自动切换预览内容。
3. 点击「保存文案」或按 `Ctrl+S`，写入本地文件。关闭页面前会提醒尚未保存的修改。
4. 「撤销 / 重做」支持 `Ctrl+Z` / `Ctrl+Shift+Z`。每个字段和整个分区都可恢复原文；恢复后仍需保存，也可以撤销。

「原文」指首次建立面板时的文案，保存在 `content/original.json`；「放弃未保存修改」回到最近一次保存的内容。多个窗口同时保存时会提示冲突，不会覆盖别的窗口刚保存的文案。

面板和写入接口仅由本地 Node.js 服务提供，绑定 `127.0.0.1`。部署目录 `dist/` 不包含编辑器或写入接口。保存只更新本地文件；需要线上生效时点击「发布上线」。

`npm run check` 检查语法，`npm test` 验证保存、发布、并发冲突及访问边界。

## 在编辑器中发布上线

目标仓库：[YvanLouise/Tactical-Points](https://github.com/YvanLouise/Tactical-Points)，分支 `main`。官网地址：[术点牌官方网站](https://yvanlouise.github.io/Tactical-Points/) 。

1. 双击 `start-editor.cmd`，点击编辑器右上角「发布上线」。
2. 检查登录账号和仓库。首次使用若尚未登录，点击「登录 GitHub」在系统浏览器完成登录；面板复用 Git Credential Manager，不收集或存储 Token。
3. 点击「发布已保存的版本」。有未保存的文案时，按钮为「保存并发布」，校验并保存成功后才发布。
4. 面板显示上传、排队和部署进度。只有指定提交的 GitHub Pages 工作流成功，才会显示「官网已上线」和访问链接。可以关闭面板后再打开，或重启本地服务后检查上次结果。
5. 上传遇到临时网络错误时会自动重试一次。失败时打开「查看 GitHub 部署详情」查看原因，再重试；如果提示远端有新提交，请先同步仓库，发布功能不会强制推送或自动合并。

发布只提交 `dist/` 内的官网内容，不会把其他文件的暂存修改混入发布提交。GitHub Actions 的 `.github/workflows/pages.yml` 也只上传 `dist/` 作为站点产物，游戏本体、本地服务和登录凭据不会成为线上网站的一部分。首次接入已将编辑器源码与工作流作为官网项目代码提交到仓库，之后修改编辑器源码可单独正常提交。

本机需安装 Git 和 Node.js，并对该仓库有写入权限。首次启用 Pages 还需管理仓库 Pages 设置的权限。发布服务会自动将 Pages 来源配置为 GitHub Actions；现有自定义域名保持不变。发布状态保存在忽略提交的 `.cache/publish-state.json`，不含凭据。`GH_TOKEN` / `GITHUB_TOKEN` 环境变量也可用于无交互环境；请勿把令牌写进项目文件。

## 修改内容

- `dist/content.json`：全部 169 个可编辑文案字段与对外链接，是文案的唯一来源。
- `template.html`：页面结构和文案占位符。保存文案或 `npm run build` 时生成 `dist/index.html`，包括静态标题、搜索摘要和正文。
- `dist/styles.css`：字体、颜色、桌面和移动端布局。
- `dist/motion.css`：按钮反馈、滑动选中态、菜单与弹窗动效；顶部变量集中调整速度。
- `dist/motion.js`：内容切换、图片预解码与选中标记的尺寸同步，遵循系统的减少动态效果偏好。
- `dist/data.js`：角色和截图的素材标识、原画裁切参数。
- `editor/`、`content/schema.mjs`、`server.mjs`：本地面板、字段定义与保存服务。
- `deploy/`：GitHub 凭据读取、固定仓库配置与发布任务；`.github/workflows/pages.yml` 为 Pages 工作流。
- `dist/assets/`：从游戏复制的角色和实机截图、官网首屏插画、字体及其授权说明。
- `design/design-system.md`：视觉规范与内容约束。

新增下载或社群入口时，在面板「开发与链接」填写正式 HTTP(S) 链接；留空时隐藏对应入口。有下载链接时自动显示「下载开放后」的回答和状态。保存后点击「发布上线」更新官网。发布平台有变化时，同步更新 `template.html` 中的 canonical 和 Open Graph URL。直接编辑 `dist/content.json` 后运行 `npm run build`，不要手工修改生成的 `dist/index.html`。

## 内容来源

规则依据 `docs/tactical_rules.md`、`docs/kingdom_rules_v1.md` 与实际规则脚本；角色插画、台词与能力依据游戏角色资料。网站明确标注开发中截图、术点事件占位及王国完整版未开放状态。当前没有伪下载入口、预约表单或统计追踪。

`website/.gdignore` 防止 Godot 将官网资源当作游戏素材导入。官网文件不会改变游戏本体。
