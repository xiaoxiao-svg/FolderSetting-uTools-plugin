# 问题：mainHide 插件不退出 + 彩色文件夹图标输入框为空

**状态**：已修复（待上架验证退出行为）
**发现时间**：2026-07-20
**影响范围**：
- `folder-merge-to-new`（放入新建文件夹）
- `folder-dissolve`（解散文件夹）
- `folder-chinese`（文件夹设置的彩色文件夹切换）

## 现象

1. 用户通过「放入新建文件夹」「解散文件夹」执行操作后，插件没有自动退出，一直停留在插件界面。
2. 文件夹设置页切换彩色文件夹时，图标输入框显示空白，看不见当前颜色的图标路径。

## 根因

- **问题 1（不退出）**：`issue-plugin-notification.md` 已记录 mainHide 模式下通知需写在 preload.js，文档里曾假设"mainHide 会自动退出"但实际未发生，缺少主动退出步骤。
- **问题 2（图标空白）**：`setFolderColor` 写磁盘成功后，前端的 `folder.icon` 是 stale 值（`setColor` 只调 `refreshFolders` 没更新 `folder.icon`），FolderCard 输入框绑定 `folder.icon` 所以空白。badge 用的是 `getActiveColor()` 每次从磁盘读，所以 badge 能正确显示，形成反差。

## 最终修复

### 改动文件

**1. `public/preload.js`**

- 新增 `getColorIconPath(colorName)` 工具函数，返回 `path.join(COLOR_CACHE_DIR, \`${colorName}.ico\`)`
- `mergeToNewFolder` / `dissolveFolder` 的通知后加 `setTimeout(() => utools.outPlugin(), 300)` —— 300ms 是保守值，让通知有机会渲染再退出
- `window.services` 末尾新增 `getColorIconPath`

**2. `src/types.ts`**

services 类型加 `getColorIconPath: (colorName: ColorName) => string`

**3. `src/App.vue`**

- `clearIcon` 函数：先 `getActiveColor` 判断，有颜色调 `clearFolderColor`，否则调 `clearFolderIcon`
- `setColor` 成功分支：同步 `folder.icon = colorName ? services.getColorIconPath(colorName) : ''`，让 FolderCard 的 displayIcon 走首分支

**4. `src/components/FolderCard.vue`**

- 新增 `displayIcon` computed：`folder.icon` 优先 → `getColorIconPath(activeColor)` 回退 → 空串
- 图标输入框 `v-model="folder.icon"` 改为 `:value="displayIcon"` 单向绑定（readonly 无需双向）
- 清除按钮 `v-if="folder.icon"` 改为 `v-if="folder.icon || activeColor"`（颜色激活时也显示清除）

**5. `.gitignore`**

加 `.codegraph/`（代码图谱工具私有数据）

### 关键设计决策

- **outPlugin 位置**：放在 preload.js 服务函数内，遵守"mainHide 的 feature，业务逻辑 + 用户反馈全部写在 preload.js"的约定。调用路径：服务函数内 `utools.showNotification()` 已有先例，`utools.outPlugin()` 同理可用。
- **300ms 延迟**：showNotification 可能 fire-and-forget，立即退出可能吞通知。保守延迟，需真机验证。
- **displayIcon 优先级**：`folder.icon` 优先于颜色回退，保证用户在颜色激活时手动选图标能立刻看到。
- **setColor 同步 folder.icon**：绕过 `activeColor` prop 非响应式问题（它是父组件 render 时一次性传入，setColor 不触发父组件重渲染）。

## 走过的弯路（别再踩）

| 尝试 | 结果 | 原因 |
|---|---|---|
| 在前端 App.vue 调 `utools.outPlugin()` | 违反约定 | CLAUDE.md 红线：mainHide 的 feature 业务逻辑全部写在 preload.js，前端只调服务函数 + return |
| clearIcon 只调 clearFolderIcon | 图标激活时清除路径后输入框仍显示颜色路径 | `displayIcon` computed 在 folder.icon 为空时回退到 activeColor，而 activeColor prop 仍过期（旧颜色） |
| v-model="displayIcon" | Vue 警告 | computed 无 setter，readonly 输入框应该用 :value 单向绑定 |
| pickIcon 后额外加 activeColor 归零逻辑 | 不需要 | Apply 时 setFolderIcon() 写磁盘覆盖颜色路径，getActiveColor() 从磁盘读回 null，badge 自然同步 |

## 结论 & 最佳实践

1. **mainHide 退出需主动调用**：mainHide 模式抑制前端 API，但**不自动退出插件**。任务完成后应在 preload.js 服务函数内主动调 `utools.outPlugin()`。
2. **preload.js 内的 utools API 可用性**：`utools.showNotification()` 和 `utools.outPlugin()` 在 preload 层都可用（服务函数内直接访问 `utools` 全局）。
3. **前端 prop 非响应式的绕过**：父组件 render 时一次性传入的 prop（如 `activeColor`）在子组件操作后不会自动刷新；真相源应从磁盘重读，或者在操作成功分支同步更新前端状态。
4. **readonly 输入框用 :value 单向绑定**：避免 v-model 对 computed 无 setter 触发警告。

## 待验证

- [ ] 上架后在真实 uTools 环境测试：放入新建文件夹 / 解散文件夹执行完是否 300ms 后自动退出
- [ ] 系统通知是否在退出前成功弹出（验证 300ms 是否足够；若吞通知需评估更长延迟）
- [ ] 彩色文件夹切换：应用颜色 → 输入框立即显示颜色图标路径
- [ ] 彩色文件夹切换：清除颜色 → 输入框立即清空
- [ ] 颜色激活时手动选图标 → 输入框立即显示自定义路径（验证 folder.icon 优先级）
- [ ] 颜色激活时点清除 → 颜色和输入框都清空

## 相关文件

- `public/preload.js` — 服务函数 + getColorIconPath + outPlugin
- `src/App.vue:383-410` — clearIcon 分支 + setColor 同步 folder.icon
- `src/components/FolderCard.vue:27-31, 92-105` — displayIcon computed + 输入框 :value + 清除按钮 v-if
- `src/types.ts:101` — getColorIconPath 类型声明

## 关联文档

- `docs/issue-plugin-notification.md` — mainHide 通知问题的上游修复（本修复是它的续章）
- `docs/development-guide.md` — §4.2 服务列表（已更新 getColorIconPath）
- 项目 `CLAUDE.md` — mainHide 职责边界红线
