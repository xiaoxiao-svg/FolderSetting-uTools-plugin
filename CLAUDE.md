# Folder-Chinese — 项目约定

uTools 插件：为 Windows 文件夹设置中文别名、图标、备注、颜色。底层保留英文路径。

## 技术栈（2026-07 移植后）

- **UI 层**：Vite 7 + Vue 3.5 + TypeScript（`<script setup>`）
- **后端**：`public/preload.js`（CommonJS，Node.js + Electron 渲染进程 API，**不改**）
- **构建产物**：`dist/`，由 `npm run build`（`vue-tsc --noEmit && vite build`）生成
- **开发模式**：`npm run dev` 起 Vite dev server（`http://127.0.0.1:5177`），uTools 开发者工具"接出开发"点 `dist/` 触发 HMR

## 目录约定

```
Folder-Chinese/
├── public/                  # 静态资源，Vite 原样拷贝到 dist/
│   ├── preload.js           # uTools preload（CommonJS），不进 Vite 构建
│   ├── package.json         # {"type":"commonjs"}，作用域覆盖 preload
│   ├── plugin.json          # 入口配置 + development.main
│   ├── logo.png
│   └── icon/                # 7 色 128×128 PNG
├── src/                     # Vue 源码
│   ├── main.ts              # 应用入口
│   ├── App.vue              # 主框架：folders 状态 + 事件入口
│   ├── style.css            # 样式（全局，270 行）
│   ├── types.ts             # Window.utools + Window.services 类型声明
│   ├── composables/
│   │   └── useUtools.ts     # useUtools() + useToast()
│   └── components/
│       ├── EmptyPanel.vue
│       ├── FolderCard.vue
│       └── HistoryList.vue
├── dist/                    # 构建产物（不要手改，由 build 覆盖）
├── vite.config.ts
├── tsconfig.json
└── package.json             # type: module
```

- **源码唯一来源**：`src/` + `public/`。`dist/` 只由 `npm run build` 生成。
- **静态资源进 `public/`**：任何不想让 Vite 处理的文件（preload.js、plugin.json、icon、logo、secondary package.json）全放这里。

## 红线

- **永远不改 `public/preload.js` 的内容** —— 它是 Node.js 后端，重写等于重做 desktop.ini / 文件系统 / PNG→ICO / PowerShell 整条链路。
- **永远不改 `public/plugin.json` 的 `main` 字段** —— uTools 强制顶层 main 必须为本地 html 相对路径；HMR 用 `development.main`。
- **dist/ 改动无效** —— 每次 build 都会清空重建。想改产物，改 src/ 或 public/。
- **不在 dist/ 留 `console.log`** —— 构建后 log 会污染 uTools 控制台。
- **dbStorage.setItem 必须 await** —— fire-and-forget 会导致历史记录偶发丢失。
- **`public/package.json` 必须 `type: "commonjs"`** —— 否则 electron 用 `require()` 加载 `preload.js` 会报 `require() of ES Module`（根 `package.json` 是 `type: "module"`）。

## Vite 关键配置

- `base: './'` —— uTools 走本地文件协议，绝对路径会 404。
- `publicDir: 'public'` —— 静态资源进 dist/。
- `server.host: '127.0.0.1'` + `hir.host: '127.0.0.1'` —— 避免 Windows 上 localhost 解析到 IPv6（uTools 连不上）。
- `server.strictPort: true` —— 端口被占直接报错；不跳端口让 uTools 找不到。
- **自定义 vite 插件**：
  - `pluginJsonValidator`：构建前校验 public/plugin.json 必须合法 JSON 且无 BOM。
  - `preserveStaticFiles`：构建后 warn 如果 dist/ 缺失关键文件。

## Vue 层要点

- **状态**：`folders = reactive<FolderItem[]>`、`historyList = reactive<HistoryItem[]>`、`currentTab = ref<'edit'|'history'>` —— 不用 pinia（数据量小）。
- **生命周期**：`onMounted` 里先注册 `utools.onPluginEnter`、再立刻 `loadHistory()`（不等切 tab，否则"最近设置"不显示）、`await nextTick()` 后调 `setExpendHeight(600)`。
- **高度同步**：用 `watch(..., { flush: 'post' })` 自动跟踪，不用每处手动 `adjustHeight`。
- **HMR 兜底**：`import.meta.hot?.dispose + accept`（uTools 的 window 理论上不重建，但保底）。
- **dbStorage 返回形态**：`Array.isArray(parsed) ? parsed : parsed?.value`，兼容新旧 uTools 版本。
- **uTools 缓存 plugin.json**：改 plugin.json 后必须"退出到后台立即结束运行"+重新"接出开发"。

## 开发流程

```bash
# 首次/重装修复依赖
npm install

# 开发（HMR）—— 另起一个终端保持后台运行
npm run dev

# 发布产物（本地验 dist）
npm run build
```

uTools 开发者工具操作：
1. "接出开发" → 选 `D:\桌面文件\3.uTools\Folder-Chinese\dist`
2. 点运行 → 5 个 feature 跑一遍
3. 改 Vue 文件 → 自动 HMR；改 preload.js → 退出重进

## 常见坑速查

| 错误 | 原因 | 修复 |
|---|---|---|
| `require() of ES Module ... preload.js` | electron 按 ESM 加载 CJS preload | `public/package.json` 设 `type: "commonjs"` |
| `"preload"配置文件不是js文件` | uTools 强制 `.js` 后缀 | 不改名为 `.cjs`，保留 `.js` |
| `Port 5177 is already in use` | 旧的 dev 进程没退出 | `netstat -ano \| findstr 5177` + `taskkill //PID ... //F` |
| 历史页空白 | `dbStorage.getItem` 返回 `{value, _id, _rev}` 没脱壳 | loadHistory 里兼容解析 |
| 进入后"最近设置"不显示 | 只在切 tab 才加载历史 | `onMounted` 里立刻 `loadHistory` |
| 改 plugin.json 不生效 | uTools 缓存旧 plugin.json | 退出接出 + 重新接出 |
