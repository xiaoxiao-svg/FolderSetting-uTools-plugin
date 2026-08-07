# Folder-Chinese 只读扫描报告

- 扫描时间：2026-08-07
- 扫描范围：src/（App.vue、components/*、composables/useUtools.ts、types.ts、style.css、main.ts）、public/preload.js、public/plugin.json、vite.config.ts、package.json、tsconfig.json、index.html、.gitignore、docs/
- 方法：逐文件阅读 + 官方 API 文档对照（u-tools.cn dbStorage/events）+ Vue 编译器产物验证
- 结论：P1 共 8 条，P2 共 16 条，P0 0 条（未发现数据丢失级或安全漏洞级问题）
- 版本记录：Round 1 产出 R1-R19（19 条）；Round 2 经 reviewer 独立审查，全部 19 条确认，新增 R20-R22（来源：reviewer，均已核实确认）并入本报告；Round 3 新增 R29-R30（来源：reviewer，均已核实确认），补充 R1↔R29 修复联动提醒，更新存疑回应与未知清单

---

## 一、P1 风险（明确缺陷，有确定触发路径）

### R1. src/App.vue:117 — dbStorage.removeItem().catch() 必抛 TypeError（迁移分支 100% 触发）
- 代码：`utools.dbStorage.removeItem(HISTORY_KEY).catch(() => {})`
- 证据：uTools 官方文档 db-storage.html 类型定义 `removeItem(key: string): void`（同步、无返回值）。同步 void 的返回值上调用 `.catch` → `undefined.catch` → TypeError。
- 触发场景：db 中无 HISTORY_KEY 文档 + dbStorage 中有旧数据（老版本用户升级后首次打开）→ 走迁移分支 → L117 必崩。
- 后果：loadHistory 中断（unhandled rejection），onMounted 里 `.then(() => refreshFolders())` 不执行（最近设置缓存不刷新、窗口高度不调整）；旧 dbStorage 数据也未被删除（下次还会重复走迁移）。数据本身已迁移成功（splice 已执行），不丢数据。
- 同根因：src/types.ts:54-58 把 dbStorage 三个方法声明为 Promise 形态，与实际 API 不符，误导调用方（见 R15）。
- 修复方向：`utools.dbStorage.removeItem(HISTORY_KEY)`（去掉 .catch，同步调用放 try/catch），同步修正 types.ts 声明。

### R2. src/components/FolderCard.vue:40,42,44,51（连带 EmptyPanel.vue:32-33、HistoryList.vue:33-34）— escapeHtml 用于 Vue 插值/属性绑定 → 双重转义显示错乱
- 代码：`{{ escapeHtml(folder.name) }}`、`:title="escapeHtml(folder.path)"`、`{{ escapeHtml(cfg.alias) }}` 等
- 证据：Vue 3 模板编译产物验证 —— `{{ escapeHtml("A&B") }}` 编译为 `_toDisplayString(escapeHtml("A&B"))`，toDisplayString 对字符串不做实体转义，最终 textContent 原样写入 → escapeHtml 先转出的 `&amp;` 以字面文本显示。
- 触发场景：文件夹名 / 路径 / 别名 / 备注含 `& ' < > "` 任一字符（如 `Tom & Jerry`、`D:\it's files`）→ 界面显示 `Tom &amp; Jerry`。
- 后果：显示错误（数据无损坏）。项目无 v-html / innerHTML / eval 使用点，XSS 面本身不存在，escapeHtml 属过度防御且用法错误。
- 修复方向：直接 `{{ folder.name }}`（Vue 插值天然安全）；title 属性用 `:title="folder.path"`。若确需函数保留（如将来 v-html），改名并只在 v-html 处使用。

### R3. src/App.vue:291-319 + 321-349 — 清空别名没有任何路径生效
- applySingle：L296 别名空且其他空 → 拦截提示"请至少填写"；L302 `if (alias)` 别名空则跳过 setFolderChineseName → 旧别名残留。
- applyAll：L329 `if (!alias && !icon && !tip) continue;`（全空跳过）；L331 `alias && ...` 短路 → 别名空时同样不调用 → 残留。
- preload 侧 setFolderChineseName 只有"设置"语义，无"删除 LocalizedResourceName"分支；唯一清除途径是"一键还原"（连图标/备注一起清）。
- 触发场景：用户清空别名输入框点"应用"或"全部应用" → 资源管理器仍显示旧别名，且无任何提示。
- 后果：明确功能缺陷（"清除别名"不可达）。备注 InfoTip 有删除语义（L141-142 `else delete kv.InfoTip`），别名没有 → 行为不对称。
- 修复方向：apply 逻辑中 alias 为空时调用"清除别名"服务（如 setFolderChineseName 传空则 delete 该键），或提供单独清除入口。

### R4. public/preload.js:277-281 — mergeToNewFolder 逐项 rename 中途失败无回滚、通知误导
- 代码：for 循环内逐个 `fs.renameSync`，任一失败进 catch → 通知"操作失败: xxx"，但之前已移动的项留在新文件夹。
- 触发场景：选中的多个文件中有被其他程序占用/锁定的文件（正在编辑的文档、正在播放的视频）→ 第 N 项失败。
- 后果：部分文件已移入新文件夹，通知却只说"操作失败"，用户以为全部未动 → 找不到已移动的文件（数据位置变更无感知）。
- 修复方向：先做可移动性预检（尝试打开句柄/按占用分批），或失败时通知中列明"已移入 X 个、失败 Y 个"。

### R5. public/preload.js:306-321 — dissolveFolder 部分失败后通知与事实不符
- 代码：items 逐个 rename 移出，中途失败 → 该文件夹非空 → `fs.rmdirSync(fp)` 抛 ENOTEMPTY → errors 记录 → 通知"已解散 0 个，失败 1 个"，但实际部分文件已移出到上级目录。
- 触发场景：待解散文件夹内有被占用的文件。
- 后果：用户误判操作未发生，实际部分文件已在上级目录，位置变更无感知。
- 修复方向：catch 中统计已移出数量并入通知文案；或失败时回滚已移出的项。

### R6. public/preload.js:56-61（经 resetFolder:153-160 触发）— 一键还原整体 unlink desktop.ini，第三方写入的其他键连坐删除
- 代码：writeIni 收到空对象 → `fs.unlinkSync(iniPath)` 删除整个文件。
- 触发场景：目标文件夹的 desktop.ini 曾被其他工具（自定义文件夹图标/着色工具）或系统写入其他键/段（如 FolderType、其他工具的自定义键）→ 点"还原"。
- 后果：本插件外的桌面配置被整体删除（desktop.ini 配置丢失，可重建但无恢复手段）。
- 修复方向：只删除本插件管理的键（LocalizedResourceName / IconResource / InfoTip），键空后再考虑删除文件；删除前可先读文件确认无其他键。

### R7. src/App.vue:337 — applyAll 中 await saveHistory 无错误兜底，db 写失败中断整批应用
- 代码：`await saveHistory(folder.path, alias)`（L337），saveHistory 内 `await utools.db.promises.put(plain)`（L136）失败即 reject → 冒泡中断 applyAll 循环 → 剩余文件夹不应用、无 toast。
- 对比：applySingle 的 afterChange（L365）和 removeHistory（L144）都有 `.catch` 兜底 → 不一致。
- 触发场景：本地 db 写入异常（db 损坏、磁盘问题）且批量应用 ≥2 个文件夹。
- 后果：批量应用中断且无任何用户反馈，用户以为全部成功（部分应用无提示）。
- 修复方向：applyAll 内 saveHistory 包 try/catch（失败仅记 fail，不中断），或在 saveHistory 内部 catch。

### R29. src/App.vue:115,123 — historyList 重复填充双份（来源：reviewer，已核实确认）
- 路径 a（双入口并发，当前已触发）：onMounted（L457）无条件 loadHistory + folder-settings 进入时 setupFolders → switchTab('history')（L43）再触发一次 loadHistory。两次调用均先 L84 splice 清空后各自 await（db.get 挂起），完成后各自 L123 `historyList.push(...items)` 同源数据 → 双份。非迁移路径（db 已有 items 文档）即触发，不依赖 R1。
- 路径 b（迁移路径单次执行即双份，当前被 R1 掩盖）：L115 `splice(0, len, ...items)` 填充 + L123 再 `push(...items)` 同批数据 → 单次执行即双份；当前因 L117 `removeItem(...).catch` 抛 TypeError 中断 loadHistory（L123 不执行）未显现，**R1 修复后立即激活**（联动详见存疑回应 3 与优先级建议）。
- 证据等级：代码推断（路径 b 为逻辑必然无逃逸分支；路径 a 依赖"双入口必然并发"的事件循环时序——两次 loadHistory 均在首个 await 挂起，onPluginEnter 回调同步触发于窗口加载序列内，先于 db.get 返回）。
- 触发场景：插件首次挂载时以 folder-settings 进入；或 loadHistory 完成前用户点击"历史" tab；HMR 重复挂载（R14）放大窗口。
- 后果：历史列表同条数据重复显示（数据不丢；saveHistory/removeHistory 均按 path filter 去重，不会把双份写回 db，属纯 UI 显示错误）。
- 修复方向：module 级 in-flight flag 防重入（loadHistory 进行中直接复用/跳过）；L115 与 L123 合并为一处填充（删 L115 splice，统一走 L123 push，或反之）。

---

## 二、P2 风险（优化空间 / 防御性改进）

### R8. public/preload.js:51,59,71,73 — attrib 命令路径字符串插值
- `execSync(\`attrib -r -s -h "${iniPath}"\`)` 等 4 处把路径拼进 cmd 命令。
- Windows 文件名禁止 `" < > | &` 等字符 → 命令注入面基本不存在；但 cmd 双引号内 `%VAR%` 仍会展开 → 路径含 `%`（如 `%s` 命名的文件夹）时 attrib 操作错误路径 → 静默失败 → desktop.ini 属性未解除 → 后续写盘失败（有 error 提示）。
- 建议：用参数化方式（attrib 参数无法管道化时可先校验路径不含 %，或改用 fs 属性操作后单独 attrib）。

### R9. public/preload.js:370 — 颜色图标缓存永不失效
- `if (!fs.existsSync(icoPath)) fs.writeFileSync(...)`：只要缓存存在就不重建 → public/icon/*.png 设计更新后，APPDATA 下旧 .ico 继续使用。
- 建议：缓存键加 PNG 的 mtime/hash，或提供清除缓存入口。

### R10. public/preload.js:352-363 — pngToIcoBuffer 无 PNG 合法性校验
- 直接 `png.readUInt32BE(16)` 读宽高，无魔数/尺寸校验；损坏 PNG 会生成坏 ICO 且因 R9 永久缓存。
- 建议：校验 `png.toString('ascii',1,4) === 'PNG'` 与宽高范围；生成失败时不要落缓存。

### R11. public/preload.js:386 — getActiveColor 对 IconResource split(',') 截断
- `cfg.icon.split(',')[0]`：Windows 路径允许逗号 → 路径含逗号时截断 → 颜色误判/自定义图标路径解析错误。
- 建议：从右侧找 `,<数字>` 模式再切分（`/^(.*),(\d+)$/`）。

### R12. public/preload.js:194 — runEncodedPowerShell 无超时
- powershell 进程挂起时 Promise 永不 resolve → 前端 notifyFolderChanged/deepRefresh 的后续逻辑（.then）永不执行。
- 建议：exec 加 timeout 参数并在超时后 resolve({success:false})。

### R13. src/App.vue:421-426 — deepRefresh 忽略服务返回的 success
- 即使 ie4uinit / powershell 失败也 toast"深度刷新完成"（误导）。
- 建议：`services.deepRefresh().then(r => toast.show(r.success ? '完成' : '刷新失败', ...))`。

### R14. src/App.vue:453-458 + 468-473 — HMR 后 onPluginEnter 重复注册（开发态）
- uTools 无注销 onPluginEnter 的 API；onUnmounted 置空 onPluginEnterCb 不影响已注册的原函数引用 → HMR 后新旧两个 setupFolders 并存，每次进入双执行（batch 有去重、单卡 splice 幂等，主要副作用是重复 toast/逻辑）。
- 注：uTools 多次 onPluginEnter 是否叠加未在官方文档确认，此条为代码推断（对生产无影响，仅 dev 体验）。
- 建议：HMR dispose 时用 flag 让旧回调 no-op（如闭包内 `if (import.meta.hot?.data?.disposed) return`）。

### R15. src/types.ts:54-58 — dbStorage 类型声明与实际 API 不符
- 声明为 Promise 形态（getItem → Promise<string|null>、removeItem → Promise<void>），官方文档为同步 `void`/`any`。
- 与 R1 同根因；当前 L102 `await` 同步返回值恰好无害，但类型误导后续调用方。
- 建议：按官方签名修正（getItem: (k) => string|null; setItem: (k,v) => void; removeItem: (k) => void）。

### R16. src/App.vue:149-151, 513-514 + HistoryList.vue:31-47 — 渲染/交互热路径同步磁盘 IO
- App 每次渲染对每个文件夹执行 2 次 readFileSync（getFolderConfig + getActiveColor）；历史列表每条渲染 2 次 statSync（≤100 条）；HistoryList 无缓存。
- 数据量 ≤100 时单次开销可接受，但每次渲染都做；批量列表 + 频繁重渲染（toast 切换等）时累积。
- 建议：结果按 path 做短时缓存（内存 Map），或改异步读取。

### R17. package.json:14 — png-to-ico 依赖未使用 + 依赖全部用 ^ 浮动版本
- preload.js 手写 pngToIcoBuffer（PNG 包 ICO 容器），grep 确认无 `require('png-to-ico')` → 死依赖。
- 全部依赖 `^` 版本（vue ^3.5.13、vite ^7.0.0、png-to-ico ^2.0.1…）违反项目 CLAUDE.md「不使用 ^ / ~」规范。
- 建议：删除 png-to-ico；锁精确版本并更新 lock 文件。

### R18. src/App.vue:15 + src/composables/useUtools.ts:13-18 — 非 uTools 环境白屏
- getWindow 只判 window 存在，不判 utools/services；浏览器直接打开 dev server → `services.getAvailableColors()` TypeError → 整页白屏。
- 建议：useUtools 判空并降级返回空实现（types.ts 注释里本有此意，未实现）。

### R19. src/App.vue:31-32,201-204 — 风格/资源小项
- historyList/recentEmptyCache 用 `let` + reactive（无重赋值场景，应 const）；L201 的 setTimeout(toast) 无清理（组件卸载后仍会执行）。
- 建议：const 化；setTimeout 存句柄在 onUnmounted 清理。

### R20. public/preload.js:14-39,63-68 — writeIni 重写丢弃非 [.ShellClassInfo] 段（来源：reviewer，已核实确认）
- 代码：parseIni 只解析 `[.ShellClassInfo]` 段（L27 `inSection = line.toLowerCase() === INI_SECTION.toLowerCase()`，其余段置 false 跳过）；writeIni 重建时只写 `INI_SECTION + '\r\n'` + 本插件键（L63-64），原文件其他段内容未保留。
- 证据等级：代码推断（逻辑必然，无分支可逃逸；实际发生依赖第三方工具写过其他段，未实测）。
- 触发场景：文件夹的 desktop.ini 被其他工具/系统写过非 .ShellClassInfo 段（如 `[LocalizedFileNames]`、`[ViewState]`、FolderMarker 类工具的自定义段）→ 用户在本插件设置别名/图标/备注任一 → writeIni 全量重写 → 其他段被永久删除。
- 后果：第三方配置丢失（与 R6 一键还原 unlink 同族问题，但这是"只改本插件键也连坐"的隐蔽路径，用户无感知）。
- 建议：writeIni 先 parseIni 全文件（保留原文段结构），只替换 .ShellClassInfo 段内容；或至少写入前读取原文，非本插件段原样回写。

### R21. src/App.vue:333 — applyAll 忽略 setFolderInfoTip 返回值（来源：reviewer，已核实确认）
- 代码：`if (ok) services.setFolderInfoTip(folder.path, tip);` —— 不检查返回值；对比 L331 setFolderChineseName、L332 setFolderIcon 均检查 `.success` 并置 ok=false；applySingle 侧（L310-313）对 setFolderInfoTip 有检查 → 两侧行为不一致，属遗漏。
- 证据等级：代码推断（读源码直接确认）。
- 触发场景：备注写盘失败（desktop.ini 写入异常、磁盘错误）且文件夹别名/图标设置成功 → ok 保持 true → 计入成功数、toast"成功 N 个" → 备注静默丢失。
- 后果：备注设置失败无任何反馈（仅别名/图标失败才有）。
- 建议：补 `.success` 检查，与 L331/L332 一致。

### R22. src/App.vue:90,95,104,107,111,124 — loadHistory 6 处 console.log 进入 dist，违反红线（来源：reviewer，已核实确认）
- 代码：loadHistory 内 6 处 `console.log('[folder-chinese] ...')`（L90 db items、L95 rewrite、L104 legacy items、L107 put result、L111 verify、L124 final）。
- 证据等级：已验证 —— vite.config.ts 无 drop_console/terser 剥离配置（build 仅 target: es2022）；grep 当前 dist/assets/index-DUCCCkGU.js 精确命中全部 6 处 log。
- 触发场景：任何一次 `npm run build` → log 进 dist → uTools 控制台被调试噪音污染（项目 CLAUDE.md 红线：不在 dist/ 留 console.log）。
- 后果：违反项目红线；且 Round 1 报告"红线验证"一节标 ✓ 与事实矛盾（见修正）。
- 建议：删除 6 处 log（或保留 dev-only 条件 `if (import.meta.env.DEV) console.log(...)`，构建自动剥离）。

### R30. src/App.vue:351-359 — resetFolder 成功未清空 folders[i] 三字段，输入框残留旧值（来源：reviewer，已核实确认）
- 代码：resetFolder 成功分支仅 `afterChange(folder.path, '', '已还原为默认显示')`，未同步 `folder.alias / folder.tip / folder.icon = ''`（对比 clearIcon L385 有 `folder.icon = ''`，reset 路径无对应清空）。
- 证据等级：代码推断（读源码直接确认，成功分支无其他赋值，逻辑必然）。
- 触发场景：用户设置别名/备注/图标 → 点"还原"成功 → FolderCard 输入框（v-model 绑定 folder.*，FolderCard.vue 内）仍显示旧值；而实时 badge（:cfg="services.getFolderConfig(path)"，resetFolder 已删配置）显示空 → 输入框与 badge 不一致，用户误以为还原未生效；此时再次点"应用"（applySingle 读 folder.alias.trim() 非空即 setFolderChineseName）会把已还原的旧别名/备注重新写回 → 还原失效。
- 后果：UI 残留误导 + 再应用导致还原被撤销（数据本身为用户此前设置值，无损坏）。
- 修复方向：成功后同步 `folder.alias = folder.tip = folder.icon = ''`，再调 refreshFolders 更新 recent badge。

---

## 三、红线与项目约定验证（1 项违规：console.log 进 dist，见 R22；其余均遵守）

| 约定 | 验证结果 |
|---|---|
| public/preload.js 不进 Vite 构建、内容不受 build 影响 | ✓ publicDir 原样拷贝；dist/preload.js 与 public/preload.js 逐字节一致（git diff 确认） |
| public/plugin.json 的 main 为相对路径 | ✓ `"main": "index.html"`，HMR 用 development.main |
| plugin.json 合法 JSON 且无 BOM | ✓ 内容合法，构建前有 pluginJsonValidator 校验 |
| db.promises.put 不传 Vue Proxy | ✓ saveHistory/removeHistory 均 `.map(...)` 撕壳成字面量（App.vue:135,143） |
| mainHide 模式通知写在 preload 服务内 | ✓ mergeToNewFolder/dissolveFolder 在 preload 内 showNotification + outPlugin（preload.js:281-287,327-329） |
| public/package.json type: commonjs | ✓ 正确配置，非问题 |
| 构建产物无 console.log | ✗ 违规（Round 1 误标 ✓，已修正）：src/App.vue loadHistory 6 处 console.log 未被剥离，vite build 后进入 dist（已验证 grep 命中 dist/assets/index-DUCCCkGU.js，vite.config.ts 无 drop_console 配置），违反红线 → 见 R22 |
| base './'、127.0.0.1 + strictPort | ✓ vite.config.ts |

## 四、误报排除清单（扫描过、确认非问题）

1. **mergeToNewFolder 跨卷 EXDEV**：allSameParent 检查保证新文件夹与源文件同卷 → 不存在跨卷移动。
2. **PowerShell 调用注入**：-EncodedCommand 传 base64 → 规避 shell 转义，设计正确；notifyFolderChanged 的 `'` 转义正确（'' 在 PS 单引号内是合法转义）。
3. **符号链接/junction**：rename 移动的是链接本身，不递归内容；无 rm -rf 式递归删除。
4. **XSS**：全项目无 v-html / innerHTML / eval → 无 XSS 面；escapeHtml 问题为双重转义显示（R2），非安全漏洞。
5. **颜色图标并发**：uTools 插件单实例，无并发写缓存。
6. **dist/ 未提交改动**：b2d0c04 之后 npm run build 的产物漂移（preload.js 增量与 public 一致、index.html 换 hash 文件名、旧 js 删除）→ 正常构建行为，非代码问题；dist/ 由 build 覆盖，建议提交或按约定忽略。
7. **tsconfig 严格度**：strict + noUnusedLocals 等已开；不强制 noUnusedParameters 之上的额外项（非问题）。
8. **plugin.json features**：5 个 feature 的 code/cmds/mainHide/fileType 与 preload/App 分支一一对应（folder-chinese / folder-chinese-batch / folder-settings / folder-merge-to-new / folder-dissolve）✓。

## 五、未知清单（本次无法确认）

1. **uTools onPluginEnter 多次注册的叠加语义**：官方文档未说明重复注册是覆盖还是追加 → R14 证据依赖此行为（标注为代码推断）。
2. **utools.db.promises.put 失败时的 reject 行为**：未实测；R7 依据 Promise 惯例推断。
3. **依赖 CVE 比对**：vite ^7.0.0（7.x 已修复 6.x 的 fs 绕过系列 CVE）、vue 3.5.x、typescript 5.7 未逐一比对漏洞库；建议 `npm audit` 复核。
4. **desktop.ini 非 UTF-16 编码**（第三方工具写 UTF-8/ANSI）时 parseIni 乱码、覆盖写回损坏 → 未实测，属低概率边缘。
5. **preload.js 在 uTools 实际 Node 16.x 环境**：代码只用 fs/path/child_process/os 基础 API，理论兼容；未在真实环境回归。
6. **icon 目录 7 色 PNG 与 getAvailableColors 的中文名映射**：目录文件未逐一核对内容（名称 红色文件夹.png 等与 ColorName 匹配 ✓ 代码层面）。
7. **老版本（dbStorage 时代）真实数据形态**：parseLegacy 兼容两种包壳，未用真实迁移数据验证。
8. **db.promises.put 对 conflict 的确切 reject 行为**（Round 2 新增）：存疑 3 的 conflict 结论依赖此行为，未实测（PouchDB 语义下 conflict 必 reject，未在 uTools 环境验证）。
9. **loadHistory 并发竞态的实际触发**（Round 2 新增）：存疑 2/3 均为代码推断，快速切 tab + onMounted 并发是否实际出现双份/conflict 需在 uTools 实测。
10. **第三方工具写其他段的 desktop.ini 真实样例**（Round 2 新增，R20 相关）：writeIni 丢弃其他段为逻辑必然，但实际用户环境中此类 desktop.ini 的占比与影响未实测。
11. **loadHistory 双入口双份的实际 UI 表现**（Round 3 新增，R29-a 相关）：并发时序为代码推断，需在 uTools 实测（首次挂载以 folder-settings 进入 + 快速切"历史" tab）确认双份显示，以及 saveHistory/removeHistory 按 path 去重后列表收敛行为。
12. **R1 修复后迁移路径双份的实际显现**（Round 3 新增，R29-b 相关）：逻辑必然（L115 填充 + L123 push 控制流走通），当前被 L117 TypeError 掩盖；修 R1 时按"修复联动提醒"同步合并填充点即可规避，无需单独实测。

## 六、审查方存疑清单回应（Round 2，已逐一核实）

1. **App.vue:106 迁移分支 put 是否 conflict**：不成立。当前代码 L106 实为 `put({ _id: HISTORY_KEY, _rev: historyRev, items: legacyItems })` —— 带 `_rev`（reviewer 的"put 无 _rev"描述与当前代码不符，可能基于旧版本）。单次调用：db 无文档 → doc=null → _rev=undefined → 新建成功；db 有文档（items 空/旧格式）→ _rev=doc._rev → 覆盖成功。conflict 只可能来自并发（见存疑 3）。
2. **loadHistory 与快速切 tab 并发双 push 重复显示**：确认存在（代码推断）。loadHistory 入口两处（onMounted L457、switchTab L43），函数内 L84 splice 清空 + L123 push，无防重入。folder-settings 进入时 onMounted 的 loadHistory 未完成 + switchTab('history') 再触发 → 两次 push 同源数据 → 历史列表双份。HMR 重复挂载（R14）放大此窗口。建议：module 级 in-flight flag 防重入，或 push 前按 path+ts 去重。
3. **saveHistory 与 loadHistory 并发 _rev 过期 → conflict**：确认存在（代码推断）。saveHistory L136 用 historyRev put，成功后 L137 更新；loadHistory L89 读旧 _rev 后中途可被 saveHistory 写入新 _rev → loadHistory 迁移/rewrite 分支的 put 用过期 _rev → conflict reject。同理 applyAll（await saveHistory 循环，UI 期间可交互）与 applySingle 的 fire-and-forget saveHistory（L365）并发也会 conflict。后果：后写者 db 未持久化（内存已更新、静默丢弃）。db.promises.put 对 conflict 的确切 reject 行为未实测。建议：写入串行化（promise 链）或 conflict 时重读 _rev 重试一次。
4. **resetFolder 后历史仍显示旧别名**：确认行为存在，属快照语义而非缺陷。resetFolder → afterChange(path, '', ...) → L365 `if (alias)` 为假 → 不写历史；历史列表保留"上次设置值"（db 中同样保留）。editFromHistory 会 makeFolder 重读实时配置 → 显示正确，无错误数据。可选改进：还原时写一条 alias='' 的历史或历史 tab 标注，不升级为 risk。
5. **FolderCard.vue:29 displayIcon 直接 window.services**：确认存在（代码推断）。L29 `return window.services.getColorIconPath(props.activeColor)` 绕过 props 直读全局。App.vue 已传 :active-color，但 getColorIconPath 未走 props。行为正确（preload 必注入 services、函数为纯路径拼接），属架构/可测性小项，并入 R19 同类处理，不单独升级。
6. **applySingle 清空图标输入框不生效**：不成立（代码推断）。FolderCard.vue:94-99 图标输入框是 `readonly` + `:value="displayIcon"`（computed 受控），用户物理上无法在输入框内清空；清空图标唯一途径是"清除"按钮（emit clearIcon → App.vue L379-390 clearFolderColor/clearFolderIcon + folder.icon=''），路径畅通且行为正确。applySingle 的 `if (ok && icon)` 跳过空图标是正确逻辑（无配置即无需写）。

## 七、修复联动提醒（Round 3 新增）

1. **R1 ↔ R29-b（修一个暴露另一个）**：R1 修复（L117 去 `.catch` 或改 try/catch 包住）会让 loadHistory 控制流走通 → L115 splice 填充后 L123 再 push 同批 items → 迁移路径双份立即激活。**修复 R1 必须同步合并 L115/L123 填充点**（删 L115 splice，只保留 L123 push，或反之），否则修好崩溃立刻暴露显示双份。
2. **R29-a ↔ R14（防重入一并解决）**：R29-a 双入口并发（onMounted L457 + switchTab L43）与 R14 HMR 重复挂载是同一类"loadHistory 重入"问题；module 级 in-flight flag 防重入可同时覆盖两个来源。
3. **R29-a 与存疑回应 2（并发 _rev）同源**：loadHistory 防重入同时消除"saveHistory 与 loadHistory 并发拿旧 _rev → conflict"的竞态窗口（存疑回应 2 的分析见下）。

## 八、审查方存疑清单回应（Round 3，已逐一核实）

1. **App.vue:439-443 watch 依赖 historyList.length，saveHistory 等长 splice 替换时长度不变 → 内容变化不触发高度同步**：事实成立（length 不变 → watch 源数组元素不变 → 不触发；saveHistory L132 等长替换是常态），但影响轻微——adjustHeight 当前实现为固定 `setExpendHeight(600)`（L158-162），初次挂载已设置 600，重复调用无增量效果，内容变化不触发不会产生可见高度错误。若未来高度改为动态计算则成隐患。结论：维持存疑（不升级），修复时顺手将 watch 源改为 `[...historyList]` 或直接监听两数组本身。
2. **saveHistory 在 loadHistory 完成前调用（historyRev=undefined 且 db 已有文档 → put 无 _rev → conflict）**：逻辑上成立（undefined _rev + 文档已存在 → PouchDB conflict reject），但实际时序窗口极小：用户从挂载到完成一次"设置并应用"必然经过输入操作（数百 ms 量级），而 loadHistory 的 db.get 是本地毫秒级读取 → historyRev 早已赋值。低概率，且与未知清单 8（conflict reject 行为未实测）绑定。结论：维持存疑，不升级；若做 R29 防重入 flag，本窗口一并消失。
3. **R1 与 R29 联动（修 R1 不同步修 L115/L123 → 迁移路径双份立即激活）**：确认成立（逻辑必然）。当前 L117 TypeError 中断 loadHistory → L123 不执行 → 迁移路径恰好单份（被崩溃掩盖）；R1 任何修复方式（去 .catch 或 try/catch）都让 L123 执行 → 双份。已写入"七、修复联动提醒"，供未来修复轮次执行。

## 九、修复优先级建议

1. 先修 R1（确定崩溃路径，一行改动），**必须与 R29 同轮修**（L115/L123 合并 + 防重入 flag，见"七、修复联动提醒"）——两个风险在同一函数同一位置，合并修成本最低，且防重入同时消除 R29-a 双份与存疑回应 2 的 _rev 竞态。
2. 再修 R2（显示错乱）+ R3（清空别名缺陷）+ R30（还原后清空三字段，3 行）—— 均为前端小改动。
3. 再修 P1-4/P1-5（批量文件操作的通知与回滚，涉及 preload，改动中等）。
4. P2 中优先：R22（console.log 进 dist，红线违规且已污染产物，删 6 行即修）→ R8（attrib 路径）→ R15（类型声明，与 R1 同改）→ R17（死依赖）。
