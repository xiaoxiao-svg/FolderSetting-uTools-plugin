# 开发指南

面向**第一次接手的开发者**——包括未来的你、其他同事、其他 Agent。

读完本文应能：跑起来、改得动、发得出、避得开坑。

---

## 1. 项目是什么

`Folder-Chinese` 是一个 **uTools 原生插件**（不是浏览器网页、不是 Electron 应用）。

它通过写 `desktop.ini` 让 Windows 资源管理器给文件夹显示**中文别名 / 自定义图标 / 备注提示 / 颜色**，底层真实路径保持英文不变。

当前实现（2026-07 移植后）分两层：
- **UI 层**：Vue 3.5 + Vite 7 + TypeScript，源码在 `src/`，产物在 `dist/index.html + assets/`
- **后端**：`public/preload.js`（CommonJS，**不进 Vite 构建**），挂载 `window.services` 到主窗口供 UI 调用

uTools 主进程给页面注入 `window.utools`（dbStorage / showOpenDialog / shellShowItemInFolder 等 API）+ `window.services`。两者都是**在 uTools 沙箱中才有**的全局对象，浏览器里没有。

---

## 2. 首次启动

### 2.1 前置条件

- Windows 10/11（uTools 只支持这两种）
- Node.js ≥ 20.19（Vite 7 要求）
- 已安装 [uTools](https://www.u-tools.cn/)
- 已安装 [pnpm](https://pnpm.io/) 或 npm（npm 即可）

### 2.2 安装依赖

```bash
cd D:\桌面文件\3.uTools\Folder-Chinese
npm install
```

如果报 `ERESOLVE` peer 冲突 `@vitejs/plugin-vue`：
- 保证 `package.json` 里是 `@vitejs/plugin-vue@^6`（Vite 7 配套版本）
- plugin-vue 5 仅与 Vite 5/6 搭配，与 Vite 7 不兼容

### 2.3 起 Vite dev server（另开一个终端，保持后台运行）

```bash
npm run dev
```

期望输出：
```
VITE v7.x.x  ready in xxx ms
➜  Local:   http://127.0.0.1:5177/
➜  Network: use --host to expose
```

注意：
- **必须用 `127.0.0.1`，不能用 `localhost`**（Windows 上 localhost 可能解析到 IPv6 `::1`，Vite 监听的是 IPv4，uTools 窗口连不上）
- 默认端口 5177，`strictPort: true`，被占时直接报错提醒你清理旧进程

### 2.4 接出 uTools 开发模式

1. uTools → 开发者工具（设置 → 开发者工具，或快捷键）
2. 点"接出开发" → 选 `D:\桌面文件\3.uTools\Folder-Chinese\dist`
3. 点"运行"
4. 5 个 feature（文件夹设置 / 文件夹设置(批量) / 文件夹管理 / 放入新建文件夹 / 解散文件夹）都能触发 → 接出成功

---

## 3. 日常开发流程

### 3.1 改 Vue 文件（App.vue / Components / types.ts / style.css）

保存后，HMR 自动热更新，uTools 窗口**自动刷新**。不需要任何手动操作。

### 3.2 改 public/preload.js

必须**重启插件**：uTools 开发者工具 → 设置 → "退出到后台立即结束运行" → 重呼出插件。

原因：uTools 只在插件首次加载时读一次 preload.js 进内存，后续不重读。

### 3.3 改 public/plugin.js 的字段

必须**重新"接出开发"**：uTools 会缓存首份 plugin.json 在内存里。

操作：退出接出 → 重新接出 → 选同一个目录 → 点运行。

---

## 4. 架构

### 4.1 入口

`public/plugin.json`（同 `dist/plugin.json`）声明：
- `main: "index.html"` —— 顶层入口（uTools 强制本地 html）
- `preload: "preload.cjs"` —— CommonJS（加 `.cjs` 让 electron 跳过 ESM 解析）
- `development.main: "http://127.0.0.1:5177/index.html"` —— 仅开发模式用的热更新入口
- 5 个 feature：`folder-chinese` / `folder-chinese-batch` / `folder-settings` / `folder-merge-to-new` / `folder-dissolve`

### 4.2 preload.js 职责

**全部 desktop.ini / 文件系统 / SHChangeNotify / 图标处理的实际代码**。挂载 `window.services` 对象，暴露 21 个方法给 UI 调用：

- 配置读写：getFolderConfig / getFolderChineseName / setFolderChineseName / setFolderIcon / clearFolderIcon / setFolderInfoTip / resetFolder / removeFolderChineseName
- 刷新：notifyFolderChanged / deepRefresh / refreshExplorer / refreshIconCache / restartExplorer
- 工具：isDirectory / getFolderName
- 文件操作：mergeToNewFolder / dissolveFolder
- 颜色：getAvailableColors / setFolderColor / clearFolderColor / getActiveColor

### 4.3 Vue 层结构

- `src/main.ts` —— Vue 应用入口
- `src/App.vue` —— 顶层：onPluginEnter 注册 + folders 响应式状态 + tab 切换 + adjustHeight watchEffect
- `src/composables/useUtools.ts` —— useUtools() 封装 window.utools + window.services + useToast()
- `src/components/EmptyPanel.vue` —— 空列表 + 拖拽 + 最近设置
- `src/components/FolderCard.vue` —— 单卡片：别名/备注/图标 + 颜色选择器
- `src/components/HistoryList.vue` —— 历史记录列表

### 4.4 数据流

```
用户操作 → Vue emit → App.vue handler → window.services.* → preload.js → Node.js/Electron API
                                        ↓
                                   utools.db.promises.* （uTools NoSQL DB，持久化历史记录）
```

> ⚠️ **Proxy 克隆陷阱**：`db.promises.put(doc)` 内部用 `structuredClone` 序列化入参，Vue reactive 对象（Proxy）不可克隆 → 抛 `An object could not be cloned`。`saveHistory` / `removeHistory` 存入前必须经 `.map(h => ({path, alias, name, ts}))` 撕壳。`dbStorage.setItem` 无此限制（内部自行序列化），但项目已迁移到 `db.promises`，不可退回。

---

## 5. 发布

```bash
npm run build
```

产物：`dist/` 含 index.html + preload.js + plugin.json（含 development.main）+ logo.png + icon/ + assets/

uTools 开发者工具 → "打开"选 `dist/` 目录即可运行。`development.main` 字段不影响生产包（uTools 仅在开发模式关注它）。

---

## 6. 常见坑（务必看这块，否则会卡）

### 坑 A：`require() of ES Module ... preload.js`

**触发时机**：uTools 开发者工具点运行，控制台第一句红色报错，`services` 不存在。

**原因**：uTools 用 `require()` 加载 preload.js。根 `package.json` 设了 `"type": "module"`，导致 Node 按 ESM 处理 `.js`，`require()` 不支持 ESM。

**修复**：`public/` 和 `dist/` 各放一个 `package.json`：
```json
{ "type": "commonjs" }
```
electron 加载 `.js` 时往上找最近的 `package.json`，读到 `type: "commonjs"` 就按 CommonJS 处理。

### 坑 B：`"preload"配置文件不是 js 文件`

**原因**：你（或 AI）把 preload 改成了 `.cjs` 想绕过 ESM 问题。uTools 官方强制 `preload` 字段必须 `.js` 结尾。

**修复**：恢复为 `.js`，用坑 A 的方法解决 ESM 问题。

### 坑 C：本地端口连不上 / HMR 失败

**排查顺序**：
1. `netstat -ano | findstr 5177` → 有 LISTEN → dev server 在跑
2. 有 LISTEN 但连不上 → 可能绑到 IPv6 了 → 检查 `vite.config.ts` 里 `host: '127.0.0.1'`
3. 没 LISTEN → dev server 没起来 → `npm run dev` 重新起

### 坑 D：遗留数据格式（历史）

早期版本通过 `dbStorage.setItem` 存历史记录，写入的是一个 JSON 字符串。迁移到 `db.promises` 后，期望的文档形态是 `{ _id, _rev, items: [...] }`（items 是数组）。

如果数据库查看器里看到某个历史文档的 `value` 字段是一串 JSON 字符串而非展开的 `items` 数组——说明该文档还是遗留格式。当前 `loadHistory()` 会自动检测并在首次读到遗留格式时就地 `put` 重写为 `{items: [...]}`，无需手动处理。

`db.promises.put` 要求入参是可被 `structuredClone` 克隆的普通对象。从 Vue `reactive()` 数组过滤出的元素是 Proxy，不能直接塞进 `put` —— 必须先 `.map(h => ({path, alias, name, ts}))` 撕壳，否则抛 `An object could not be cloned`。

### 坑 E：plugin.json 改动不生效

uTools 会缓存首份 plugin.json。改字段后必须：退出接出 → 重新接出 → 点运行。
