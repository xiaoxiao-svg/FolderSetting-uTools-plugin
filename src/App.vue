<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted, nextTick, watch } from 'vue';
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

async function loadHistory() {
  const raw = await utools.dbStorage.getItem(HISTORY_KEY);
  historyList.splice(0, historyList.length);
  if (raw) {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    // utools.dbStorage 返回形态：
    //   1. 直接数组（自动脱壳后）
    //   2. { value: [...], _id, _rev }（数据库文档原始形态）
    //   3. 数组 JSON 字符串
    let list: HistoryItem[] = [];
    if (Array.isArray(parsed)) {
      list = parsed;
    } else if (Array.isArray((parsed as any)?.value)) {
      list = (parsed as any).value;
    }
    historyList.push(...list);
  }
}

async function saveHistory(path: string, alias: string) {
  const list = historyList.filter(h => h.path !== path);
  list.unshift({ path, alias: alias || '', name: services.getFolderName(path), ts: Date.now() });
  if (list.length > 100) list.length = 100;
  // 同步到响应式数组
  historyList.splice(0, historyList.length, ...list);
  await utools.dbStorage.setItem(HISTORY_KEY, JSON.stringify(list));
}

function removeHistory(path: string) {
  const list = historyList.filter(h => h.path !== path);
  historyList.splice(0, historyList.length, ...list);
  utools.dbStorage.setItem(HISTORY_KEY, JSON.stringify(list)).catch(() => {});
}

function refreshFolders() {
  recentEmptyCache.splice(0, recentEmptyCache.length);
  const recent = historyList
    .filter(h => services.isDirectory(h.path))
    .slice(0, 5);
  recentEmptyCache.push(...recent);
  adjustHeight();
}

function adjustHeight() {
  try {
    utools.setExpendHeight(600);
  } catch {
    // dev 环境无 utools 时忽略
  }
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
  if (code === 'folder-merge-to-new') {
    const paths = items.map(i => i.path);
    const r = services.mergeToNewFolder(paths);
    if (r.success) {
      utools.showNotification(`已创建"${r.value!.folderName}"并移入 ${r.value!.moved} 个项目`);
    } else {
      utools.showNotification('操作失败: ' + r.error);
    }
    utools.outPlugin();
    return;
  }
  if (code === 'folder-dissolve') {
    const paths = items.filter(i => i.isDirectory).map(i => i.path);
    if (!paths.length) {
      utools.showNotification('请选择文件夹');
      utools.outPlugin();
      return;
    }
    const r = services.dissolveFolder(paths);
    if (r.success) {
      const v = r.value!;
      if (!v.errors.length) utools.showNotification(`已解散 ${v.dissolved.length} 个文件夹`);
      else utools.showNotification(`已解散 ${v.dissolved.length} 个，失败 ${v.errors.length} 个`);
    } else {
      utools.showNotification('操作失败: ' + r.error);
    }
    utools.outPlugin();
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
  const r = services.clearFolderIcon(folder.path);
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

// 高度调整：每次数据变化后自动同步
watch(
  () => [currentTab.value, folders.length, historyList.length],
  () => nextTick(adjustHeight),
  { flush: 'post' }
);

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

// 首次注册后确保高度正确
watch(
  () => currentTab.value,
  () => nextTick(adjustHeight),
  { immediate: true, flush: 'post' }
);

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
