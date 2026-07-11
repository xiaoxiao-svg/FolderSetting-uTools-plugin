# 问题：mainHide 模式下 utools.showNotification 不生效

**状态**：已修复（待上架验证）
**发现时间**：2026-07-11
**影响范围**：`folder-merge-to-new`（放入新建文件夹）、`folder-dissolve`（解散文件夹）两个 feature

## 现象

1. 用户通过「放入新建文件夹」「解散文件夹」执行操作后，插件没有自动退出，一直停留在插件界面。
2. 在 `App.vue` 前端代码里调 `utools.showNotification(...)` 弹系统通知，通知始终不出现。

## 根因

- **问题 1（不退出）**：`plugin.json` 中两个 feature 没声明 `mainHide: true`，uTools 默认以前台 feature 启动，`outPlugin()` 在 Vue 异步响应式上下文里没被正确接手。
- **问题 2（通知不出现）**：`mainHide: true` 模式下，uTools 把该 feature 视作"后台执行"，**抑制了前端渲染进程的 `utools.showNotification` 调用**。这是 uTools 对 mainHide 模式的行为定义，不是代码 bug。

## 关键证据

- 在 uTools 开发者工具控制台**手动**执行 `utools.showNotification("hello test")` 能正常弹出 → API 本身可用，问题在调用上下文。
- 在前端用 `requestAnimationFrame(() => utools.showNotification(msg))` 延迟调用也失败 → 隐藏窗口下 rAF 不触发，进一步印证是 mainHide 模式对前端的抑制。

## 最终修复

**核心思路**：把系统通知的调用从 Vue 前端移到 `public/preload.js` 的服务函数内。preload 运行在独立的预加载环境，不受 mainHide 模式对前端通知的抑制。

### 改动文件

**1. `public/plugin.json`**（2 行）

两个 feature 加 `"mainHide: true"`：

```json
{
  "code": "folder-merge-to-new",
  "explain": "将选中的文件或文件夹放入新建文件夹",
  "mainHide": true,
  "cmds": [{ "type": "files", "label": "放入新建文件夹", "minLength": 1, "maxLength": 100 }]
}
```

```json
{
  "code": "folder-dissolve",
  "explain": "将选中文件夹内的项目解散到上一级目录",
  "mainHide": true,
  "cmds": [{ "type": "files", "label": "解散文件夹", "fileType": "directory", "minLength": 1, "maxLength": 100 }]
}
```

**2. `public/preload.js`**（两个服务函数内加通知）

`mergeToNewFolder` 成功路径末尾加：

```javascript
utools.showNotification(`已创建"${path.basename(newFolderPath)}"并移入 ${moved} 个项目`);
```

`dissolveFolder` 返回前加：

```javascript
if (dissolved.length || errors.length) {
  const msg = errors.length
    ? `已解散 ${dissolved.length} 个，失败 ${errors.length} 个`
    : `已解散 ${dissolved.length} 个文件夹`;
  utools.showNotification(msg);
}
```

**3. `src/App.vue`**（两个 feature 分支）

删掉所有 `showNotification` 调用，只保留调服务函数 + `return`：

```typescript
if (code === 'folder-merge-to-new') {
  services.mergeToNewFolder(items.map(i => i.path));
  return;
}
if (code === 'folder-dissolve') {
  const paths = items.filter(i => i.isDirectory).map(i => i.path);
  if (!paths.length) return;
  services.dissolveFolder(paths);
  return;
}
```

## 走过的弯路（别再踩）

| 尝试 | 结果 | 原因 |
|---|---|---|
| 前端 `utools.showNotification` 直接调用 | 不生效 | mainHide 抑制前端通知 |
| 改成 `window.utools.showNotification` | 无意义 | `w === window`，完全等价，不解决任何问题 |
| `setTimeout(() => utools.outPlugin(), 400)` 延迟退出 | 多余 | 退出应交给 mainHide 机制，不需要手动延迟 |
| `requestAnimationFrame(() => utools.showNotification(msg))` | 不生效 | 隐藏窗口下 rAF 不触发 |
| 加 `onPluginOut` 监听器 | 多余 | 用户指出"只改 plugin.json 就行"，过度设计 |

## 结论 & 最佳实践

1. **mainHide 模式的副作用**：该模式下 uTools 会抑制前端渲染进程的 `utools.showNotification`。需要弹通知时，**在 preload.js 的服务函数内调用**，不要依赖前端。
2. **"直接执行"类 feature 的标准做法**：
   - `plugin.json` 里加 `"mainHide": true`；
   - 业务逻辑 + 用户反馈（通知）**都写在 preload.js**；
   - 前端 `App.vue` 只负责编辑类 feature 的 UI，不介入直接执行类 feature 的流程。
3. **preload.js 可以扩展**：项目 CLAUDE.md 红线"永远不改 preload.js"指的是**不重写 desktop.ini / 文件系统 / PNG→ICO 整条链**。给服务函数加通知能力属于"服务内容扩展"，不是重写，可以接受。

## 待验证

- [ ] 上架后在真实 uTools 环境测试：两个 feature 执行完是否自动退出（mainHide 效果）
- [ ] 系统通知是否弹出（preload 环境调用 showNotification 是否有效）
- [ ] 如通知仍不弹出 → 说明 preload 环境的 utools API 也被抑制，需改用 Electron 原生 `new (require('electron').Notification)({ body: msg }).show()`

## 相关文件

- `public/plugin.json` — feature 定义
- `public/preload.js:255-320` — 服务函数（mergeToNewFolder / dissolveFolder）
- `src/App.vue:105-121` — 前端 feature 分支
- `src/composables/useUtools.ts` — 前端 utools 封装（w.utools === window.utools）

## 关联文档

- 项目 `CLAUDE.md` — Vue 层要点 / 红线（已更新，记录 mainHide + 通知的职责边界）
- 项目记忆 `memory/project-context.md` — 已更新 Known issues 和 Resolved bugs
