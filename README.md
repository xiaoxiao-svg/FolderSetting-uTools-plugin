# 文件夹设置插件

为 Windows 文件夹设置中文别名、自定义图标、备注提示，保留底层英文路径不变。

## 功能

- **中文别名**：让英文文件夹在资源管理器显示中文名，底层路径不变
- **自定义图标**：用 `.ico` / `.exe` / `.dll` 替换文件夹图标
- **备注提示**：鼠标悬停文件夹时显示自定义说明
- **更改颜色**：从预设彩色图标中一键更换文件夹颜色（红/蓝/绿/黄/紫/灰/黑）
- **一键还原**：清除别名/图标/备注/颜色，恢复默认显示
- **放入新建文件夹**：选中文件/文件夹后通过 uTools 匹配快速归入新建文件夹
- **解散文件夹**：选中文件夹后将其内容释放到上一级目录并删除空文件夹
- **历史记录**：自动记住设置过的文件夹，随时回来管理或打开
- **批量处理**：选中或拖入多个文件夹一起设置
- **快速生效**：应用后自动通知系统刷新，无需手动重启资源管理器

## 使用方法

四种进入方式：

1. 资源管理器选中文件夹 → 呼出 uTools → 输入「文件夹设置」
2. 资源管理器选中一个/多个文件夹 → 呼出 uTools → 选「文件夹设置」（批量）
3. 资源管理器选中文件/文件夹 → 呼出 uTools → 选「放入新建文件夹」（无 UI 后台执行）
4. 资源管理器选中文件夹 → 呼出 uTools → 选「解散文件夹」（无 UI 后台执行）
5. 直接呼出 uTools → 输入「文件夹管理」查看历史记录

设置步骤：填写别名 / 选图标 / 写备注 / 选颜色 → 点「应用」，资源管理器即刻更新。

若个别情况未刷新：点「深度刷新」按钮，或在资源管理器按 F5。

## 技术原理

在文件夹内写入 `desktop.ini`（UTF-16 LE 编码）：
- `LocalizedResourceName` → 中文别名
- `IconResource` → 自定义图标
- `InfoTip` → 悬停备注

应用后调用 `SHChangeNotify`（精准通知该目录）让资源管理器即时刷新。
所有 PowerShell 调用改为**异步**执行，不阻塞界面。

## 注意事项

- 设置后会给文件夹加只读属性（Windows 读取 desktop.ini 的必要条件），还原时自动移除
- 系统/受保护文件夹需管理员权限，失败时会提示
- 中文别名仅影响资源管理器显示，命令行/程序仍用原英文路径
- 移动文件夹时 `desktop.ini` 会随之移动，设置不丢失

## 开发

### 技术栈

- **UI 层**：Vite 7 + Vue 3.5 + TypeScript（`<script setup>`）
- **后端**：`public/preload.js`（CommonJS，Node.js + Electron 渲染进程 API）
- **构建产物**：`dist/`，由 `npm run build` 生成
- **开发模式**：`npm run dev` 起 Vite dev server（`http://127.0.0.1:5177`），uTools 开发者工具"接出开发"点 `dist/` 触发 HMR

### 首次启动

```bash
npm install        # 安装依赖
npm run dev        # 起 Vite dev server（保持后台运行）
```

uTools 开发者工具 → "接出开发" → 选 `D:\桌面文件\3.uTools\Folder-Chinese\dist` 目录 → 点运行。

### 目录结构

```
Folder-Chinese/
├── public/                  # 静态资源（Vite 原样拷贝到 dist/）
│   ├── preload.js           # uTools preload（CommonJS，不进 Vite 构建）
│   ├── package.json         # {"type":"commonjs"}，作用域覆盖 preload
│   ├── plugin.json          # 入口配置 + development.main
│   ├── logo.png
│   └── icon/                # 7 色 128×128 PNG 文件夹图标
├── src/                     # Vue 源码
│   ├── main.ts / App.vue
│   ├── style.css
│   ├── types.ts             # Window.utools + Window.services 类型声明
│   ├── composables/useUtools.ts
│   └── components/          # EmptyPanel / FolderCard / HistoryList
├── dist/                    # 构建产物（不要手改）
├── vite.config.ts
├── tsconfig.json
├── package.json
└── CLAUDE.md                # 项目约定（给 AI 看的）
```

### 开发要点

- 改 Vue 文件 → 自动 HMR（无需手动刷新）
- 改 `public/preload.js` → 必须"退出到后台立即结束运行"再重新接出（preload 不能热更新）
- 改 `public/plugin.json` → 同上，uTools 会缓存旧 plugin.json
- 发布前 `npm run build` 生成 `dist/`，uTools 开发者工具"打开"选 `dist/` 即可

### 常见坑

| 错误 | 修复 |
|---|---|
| `require() of ES Module ... preload.js` | `public/package.json` 必须 `{"type":"commonjs"}` |
| `"preload"配置文件不是js文件` | 不要改名为 `.cjs`，保留 `.js` |
| `Port 5177 is already in use` | `netstat -ano \| findstr 5177` + `taskkill //PID ... //F` |
| 历史记录空白 | `dbStorage.getItem` 返回 `{value, _id, _rev}` 需脱壳 |
| 改 plugin.json 不生效 | 退出接出 + 重新接出 |
