<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted } from 'vue';
import EmptyPanel from './components/EmptyPanel.vue';
import FolderCard from './components/FolderCard.vue';
import HistoryList from './components/HistoryList.vue';
import { useUtools, useToast } from './composables/useUtools';
import type { ColorName, FolderItem, HistoryItem, PluginEnterPayload } from './types';
import './style.css';

const { utools, services } = useUtools();
const toast = useToast();

const HISTORY_KEY = 'folder-chinese.history';

const COLORS: ColorName[] = services.getAvailableColors();
const COLOR_DISPLAY: Record<ColorName, string> = {
  '红色': '#e74c3c',
  '蓝色': '#3498db',
  '绿色': '#27ae60',
  '黄色': '#f1c40f',
  '紫色': '#8e44ad',
  '灰色': '#95a5a6',
  '黑色': '#34495e',
};

// 状态
type Tab = 'edit' | 'history';
const currentTab = ref<Tab>('edit');
const isDragOver = ref(false);
const folders = reactive<FolderItem[]>([]);
let historyList = reactive<HistoryItem[]>([]);
let recentEmptyCache = reactive<HistoryItem[]>([]);

// 工具函数（传给子组件）
function escapeHtml(s: string) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c)
  );
}

function switchTab(tab: Tab) {
  currentTab.value = tab;
  if (tab === 'history') loadHistory();
  else refreshFolders();
}

// 历史记录文档结构（utools.db NoSQL 文档，数据库工具里展示为展开形态）
let historyRev: string | undefined;

/**
 * 从 db 文档解析 items 数组
 * 兼容两种形态：
 *   - 迁移后正确形态：doc.items 是数组
 *   - dbStorage 迁移前的"错误"形态：doc.value 是 JSON 字符串（dbStorage 整体被塞进 db 的 value 字段）
 * 返回 needsRewrite：数据来自旧格式 value 字符串时，调用方应原地 put 覆盖为 items 数组形态
 */
function parseDoc(doc: any): { items: HistoryItem[]; needsRewrite: boolean } {
  if (!doc) return { items: [], needsRewrite: false };
  if (Array.isArray(doc.items)) return { items: doc.items, needsRewrite: false };
  if (typeof doc.value === 'string') {
    try {
      const parsed = JSON.parse(doc.value);
      if (Array.isArray(parsed)) return { items: parsed, needsRewrite: true };
      if (Array.isArray(parsed?.value)) return { items: parsed.value, needsRewrite: true };
    } catch { /* 解析失败返回空 */ }
  }
  return { items: [], needsRewrite: false };
}

/**
 * 从 dbStorage 解析旧数据（兼容字符串 / {value} 包壳两种形态）
 */
function parseLegacy(raw: string | null): HistoryItem[] {
  if (!raw) return [];
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray((parsed as any)?.value)) return (parsed as any).value;
  } catch { /* 解析失败返回空 */ }
  return [];
}

async function loadHistory() {
  historyList.splice(0, historyList.length);

  // 1. 先尝试从新 db 读
  const doc = await utools.db.promises.get(HISTORY_KEY);
  let { items, needsRewrite } = parseDoc(doc);
  historyRev = (doc as any)?._rev;

  // 2. 旧格式（value 字符串）→ 原地重写为 {items: [...]}，让数据库查看器能展开
  if (needsRewrite && items.length) {
    const rewriteRes = await utools.db.promises.put({ _id: HISTORY_KEY, _rev: historyRev, items });
    if (rewriteRes.ok) historyRev = rewriteRes.rev;
  }

  // 3. db 为空时，尝试从 dbStorage 迁移旧数据
  //    迁移条件严格：db 空 + dbStorage 有数据 + 写入成功后再次从 db 读到 → 才删旧位
  //    dbStorage 为同步 API（官方文档），统一同步调用 + try/catch 防御
  if (!items.length) {
    let legacy: string | null = null;
    try {
      legacy = utools.dbStorage.getItem(HISTORY_KEY);
    } catch { /* 存储不可用时按无旧数据处理 */ }
    // 过滤缺关键字段的坏条目，避免坏数据永久写入 db
    const legacyItems = parseLegacy(legacy).filter(h => h && typeof h.path === 'string');
    if (legacyItems.length) {
      const res = await utools.db.promises.put({ _id: HISTORY_KEY, _rev: historyRev, items: legacyItems });
      if (res.ok) {
        // 写入成功 → 再次从 db 读，确认数据真实落到 db
        const verify = await utools.db.promises.get(HISTORY_KEY);
        if (Array.isArray((verify as any)?.items) && (verify as any).items.length) {
          items = (verify as any).items;
          historyRev = (verify as any)._rev;
          // 确认验证通过后才删旧位
          try {
            utools.dbStorage.removeItem(HISTORY_KEY);
          } catch { /* 迁移主链路已完成，删除旧位失败不影响 */ }
        }
      }
    }
  }

  historyList.push(...items);
}

async function saveHistory(path: string, alias: string) {
  const list = historyList.filter(h => h.path !== path);
  list.unshift({ path, alias: alias || '', name: services.getFolderName(path), ts: Date.now() });
  if (list.length > 100) list.length = 100;
  // 同步到响应式数组
  historyList.splice(0, historyList.length, ...list);
  // 存 JS 对象（非字符串）：uTools 按 NoSQL 文档展开存储
  // items 必须映射为字面量对象——historyList 是 reactive 数组，元素是 Vue Proxy，Proxy 无法被 structuredClone 克隆会抛 "An object could not be cloned"
  const plain = { _id: HISTORY_KEY, _rev: historyRev, items: list.map(h => ({ path: h.path, alias: h.alias, name: h.name, ts: h.ts })) };
  const res = await utools.db.promises.put(plain);
  if (res.ok) historyRev = res.rev;
}

function removeHistory(path: string) {
  const list = historyList.filter(h => h.path !== path);
  historyList.splice(0, historyList.length, ...list);
  const plain = { _id: HISTORY_KEY, _rev: historyRev, items: list.map(h => ({ path: h.path, alias: h.alias, name: h.name, ts: h.ts })) };
  utools.db.promises.put(plain).then(res => { if (res.ok) historyRev = res.rev; }).catch(() => {});
}

function refreshFolders() {
  recentEmptyCache.splice(0, recentEmptyCache.length);
  const recent = historyList
    .filter(h => services.isDirectory(h.path))
    .slice(0, 5);
  recentEmptyCache.push(...recent);
}

// 处理插件进入事件
let onPluginEnterCb: ((payload: PluginEnterPayload) => void) | null = null;

function setupFolders(payload: PluginEnterPayload) {
  const { code, payload: items } = payload;

  if (code === 'folder-settings') {
    switchTab('history');
    return;
  }

  // 独立操作：放入新建文件夹 / 解散文件夹（不涉及编辑 UI）
  // 系统通知直接在 preload.js 的服务函数内触发，避开 mainHide 对前端通知的抑制
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

  // 编辑类
  switchTab('edit');
  if (code === 'folder-chinese') {
    let currentPath: string | null = null;
    try {
      currentPath = utools.readCurrentFolderPath();
    } catch {
      // ignore
    }
    if (currentPath) {
      folders.splice(0, folders.length, makeFolder(currentPath));
    } else {
      folders.splice(0, folders.length);
      setTimeout(
        () => toast.show('请在资源管理器中选中文件夹后再呼出，或直接拖入', 'error'),
        200
      );
    }
  } else if (code === 'folder-chinese-batch') {
    const list = items
      .filter((it: { path: string }) => services.isDirectory(it.path))
      .map((it: { path: string }) => makeFolder(it.path));
    // 去重
    const exists = new Set(folders.map(f => f.path));
    for (const f of list) if (!exists.has(f.path)) folders.push(f);
  }
  refreshFolders();
}

function makeFolder(p: string): FolderItem {
  const cfg = services.getFolderConfig(p);
  return {
    path: p,
    name: services.getFolderName(p),
    alias: cfg.alias || '',
    icon: cfg.icon || '',
    tip: cfg.infoTip || '',
  };
}

// 文件夹列表操作
function addFolders(paths: string[]) {
  let added = 0;
  for (const p of paths) {
    if (services.isDirectory(p) && !folders.some(fp => fp.path === p)) {
      folders.push(makeFolder(p));
      added++;
    }
  }
  refreshFolders();
  return added;
}

function removeFromList(i: number) {
  folders.splice(i, 1);
  refreshFolders();
}

function addFromRecent(i: number) {
  const p = recentEmptyCache[i]?.path;
  if (p && !folders.some(f => f.path === p)) folders.push(makeFolder(p));
  refreshFolders();
}

function pickFoldersViaDialog() {
  const ret = utools.showOpenDialog({
    title: '选择文件夹',
    properties: ['openDirectory', 'multiSelections'],
  });
  if (!ret || !ret.length) return;
  const added = addFolders(ret);
  if (added) toast.show(`已添加 ${added} 个文件夹`, 'success');
}

function editFromHistory(i: number) {
  const h = historyList[i];
  folders.splice(0, folders.length, makeFolder(h.path));
  switchTab('edit');
}

// 拖拽
function handleDrop(e: DragEvent) {
  e.preventDefault();
  e.stopPropagation();
  isDragOver.value = false;
  if (!e.dataTransfer?.files) return;
  const paths = Array.from(e.dataTransfer.files).map(f => (f as any).path as string);
  const added = addFolders(paths);
  if (added) toast.show(`已添加 ${added} 个文件夹`, 'success');
  else toast.show('拖入的不是文件夹或已存在', 'error');
}
function handleDragOver(e: DragEvent) {
  e.preventDefault();
  e.stopPropagation();
  isDragOver.value = true;
}
function handleDragLeave(e: DragEvent) {
  e.preventDefault();
  e.stopPropagation();
  isDragOver.value = false;
}

// 事件处理
function applySingle(i: number) {
  const folder = folders[i];
  const alias = folder.alias.trim();
  const icon = folder.icon.trim();
  const tip = folder.tip.trim();
  if (!alias && !icon && !tip) {
    toast.show('请至少填写别名、图标或备注其中一项', 'error');
    return;
  }
  let ok = true;
  let errMsg = '';
  if (alias) {
    const r = services.setFolderChineseName(folder.path, alias);
    if (!r.success) { ok = false; errMsg = r.error; }
  }
  if (ok && icon) {
    const r = services.setFolderIcon(folder.path, icon);
    if (!r.success) { ok = false; errMsg = r.error; }
  }
  if (ok) {
    const r = services.setFolderInfoTip(folder.path, tip);
    if (!r.success) { ok = false; errMsg = r.error; }
  }
  if (ok) {
    afterChange(folder.path, alias, `已应用：${alias || folder.name}`);
  } else {
    toast.show('设置失败: ' + errMsg, 'error');
  }
}

async function applyAll() {
  let success = 0;
  let fail = 0;
  const paths: string[] = [];
  for (const folder of folders) {
    const alias = folder.alias.trim();
    const icon = folder.icon.trim();
    const tip = folder.tip.trim();
    if (!alias && !icon && !tip) continue;
    let ok = true;
    if (alias && !services.setFolderChineseName(folder.path, alias).success) ok = false;
    if (ok && icon && !services.setFolderIcon(folder.path, icon).success) ok = false;
    if (ok) services.setFolderInfoTip(folder.path, tip);
    if (ok) {
      success++;
      paths.push(folder.path);
      await saveHistory(folder.path, alias);
    } else {
      fail++;
    }
  }
  if (success > 0) {
    Promise.all(paths.map(p => services.notifyFolderChanged(p))).then(() => {});
    toast.show(`成功 ${success} 个${fail ? `，失败 ${fail} 个` : ''}`, fail ? 'error' : 'success');
    refreshFolders();
  } else {
    toast.show('没有需要应用的内容', 'error');
  }
}

function resetFolder(i: number) {
  const folder = folders[i];
  const r = services.resetFolder(folder.path);
  if (r.success) {
    // 同步清空输入框：服务端已重置，前端字段也须清空，避免残留旧值被再次应用
    folder.alias = '';
    folder.tip = '';
    folder.icon = '';
    // 历史记录同步移除：还原 = 放弃设置，旧快照不再保留（含 db）
    removeHistory(folder.path);
    afterChange(folder.path, '', '已还原为默认显示');
  } else {
    toast.show('还原失败: ' + r.error, 'error');
  }
}

function afterChange(path: string, alias: string, msg: string) {
  toast.show(msg, 'success');
  refreshFolders();
  services.notifyFolderChanged(path).then(() => {});
  if (alias) saveHistory(path, alias).catch(() => {});
}

function pickIcon(i: number) {
  const ret = utools.showOpenDialog({
    title: '选择图标文件',
    filters: [{ name: '图标文件', extensions: ['ico', 'exe', 'dll'] }],
    properties: ['openFile'],
  });
  if (ret && ret[0]) {
    folders[i].icon = ret[0];
  }
}

function clearIcon(i: number) {
  const folder = folders[i];
  // 颜色图标由颜色选择器管理，自定义图标由图标清除管理
  const hasColor = services.getActiveColor(folder.path);
  const r = hasColor ? services.clearFolderColor(folder.path) : services.clearFolderIcon(folder.path);
  if (r.success) {
    folder.icon = '';
    afterChange(folder.path, '', '已清除图标');
  } else {
    toast.show('清除失败: ' + r.error, 'error');
  }
}

function setColor(i: number, colorName: ColorName | '') {
  const folder = folders[i];
  let r;
  if (!colorName) {
    r = services.clearFolderColor(folder.path);
  } else {
    r = services.setFolderColor(folder.path, colorName);
  }
  if (r.success) {
    // 同步 folder.icon，让 FolderCard 的 displayIcon 走 folder.icon 优先分支，不依赖过期的 activeColor prop
    folder.icon = colorName ? services.getColorIconPath(colorName) : '';
    refreshFolders();
    services.notifyFolderChanged(folder.path);
    services.deepRefresh();
    if (colorName) toast.show(`已设为${colorName}文件夹`, 'success');
    else toast.show('已清除颜色', 'success');
  } else {
    toast.show('操作失败: ' + r.error, 'error');
  }
}

function openFolder(i: number) {
  utools.shellShowItemInFolder(folders[i].path);
}

function openHistory(i: number) {
  utools.shellShowItemInFolder(historyList[i].path);
}

function deepRefresh() {
  toast.show('正在深度刷新…', 'info');
  services.deepRefresh().then(() => {
    toast.show('深度刷新完成', 'success');
  });
}

function clearFolders() {
  folders.splice(0, folders.length);
  refreshFolders();
  toast.show('已清空列表', 'info');
}

function stopPropagation(e: Event) {
  e.stopPropagation();
}

// 生命周期 / HMR 支持
onUnmounted(() => {
  if (onPluginEnterCb) {
    // uTools 不提供移除回调的 API；HMR 场景下 dispose 里会重置
    onPluginEnterCb = null;
  }
});

onMounted(() => {
  onPluginEnterCb = setupFolders;
  utools.onPluginEnter(onPluginEnterCb);
  // 进入插件立刻加载历史，不等切 tab
  loadHistory().then(() => refreshFolders());
});

// HMR 重注册：uTools 的 window 上下文不被 vite 重建，但回调可能丢失
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    // 下一个实例挂载时会重新注册
  });
  import.meta.hot.accept();
}
</script>

<template>
  <div class="topbar">
    <div class="topbar-title">
      <div class="logo">📁</div>
      <div>
        <h1>文件夹设置</h1>
        <p>中文别名 · 自定义图标 · 备注提示</p>
      </div>
    </div>
    <div class="tabs">
      <div class="tab" :class="{ active: currentTab === 'edit' }" @click="switchTab('edit')">设置</div>
      <div class="tab" :class="{ active: currentTab === 'history' }" @click="switchTab('history')">历史</div>
    </div>
  </div>

  <div v-show="currentTab === 'edit'">
    <div
      class="drop-zone"
      :class="{ dragover: isDragOver }"
      @drop="handleDrop"
      @dragover="handleDragOver"
      @dragleave="handleDragLeave"
    >
      <template v-if="folders.length === 0">
        <EmptyPanel
          :recent="recentEmptyCache"
          :escape-html="escapeHtml"
          @pick-folders="pickFoldersViaDialog"
          @add-from-recent="addFromRecent"
        />
      </template>
      <template v-else>
        <FolderCard
          v-for="(folder, i) in folders"
          :key="folder.path"
          :folder="folder"
          :index="i"
          :cfg="services.getFolderConfig(folder.path)"
          :active-color="services.getActiveColor(folder.path)"
          :colors="COLORS"
          :color-display="COLOR_DISPLAY"
          :escape-html="escapeHtml"
          @apply="applySingle"
          @reset="resetFolder"
          @open="openFolder"
          @remove="removeFromList"
          @pick-icon="pickIcon"
          @clear-icon="clearIcon"
          @set-color="setColor"
          @stop="stopPropagation"
        />
      </template>
    </div>
    <div class="card-footer">
      <div class="footer" v-show="folders.length > 0">
        <button class="btn btn-primary" @click="applyAll">全部应用</button>
        <button class="btn btn-ghost" @click="deepRefresh">深度刷新</button>
        <button class="btn btn-ghost" @click="clearFolders">清空列表</button>
      </div>
    </div>
    <div class="hint">应用后会自动通知系统刷新；若资源管理器未更新，点"深度刷新"或按 F5</div>
  </div>

  <div v-show="currentTab === 'history'">
    <HistoryList
      :history="historyList"
      :services="services"
      :escape-html="escapeHtml"
      @edit="editFromHistory"
      @open="openHistory"
      @remove="(i: number) => removeHistory(historyList[i].path)"
    />
  </div>

  <div class="toast" :class="{ show: toast.state.visible, success: toast.state.type === 'success', error: toast.state.type === 'error' }">{{ toast.state.message }}</div>
</template>

<style scoped>
/* App.vue 不保留样式，全部由 src/style.css 全局提供 */
</style>
