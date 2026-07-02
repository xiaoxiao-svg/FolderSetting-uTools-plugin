let folders = [];
let recentEmptyCache = [];
const HISTORY_KEY = 'folder-chinese.history';
const COLORS = services.getAvailableColors();
const COLOR_DISPLAY = {
  '红色': '#e74c3c', '蓝色': '#3498db', '绿色': '#27ae60', '黄色': '#f1c40f',
  '紫色': '#8e44ad', '灰色': '#95a5a6', '黑色': '#34495e',
};

// ---------- 进入插件 ----------
utools.onPluginEnter(({ code, type, payload }) => {
  if (code === 'folder-settings') {
    switchTab('history');
    return;
  }

  // 独立操作：放入新建文件夹 / 解散文件夹（不涉及编辑 UI）
  if (code === 'folder-merge-to-new') {
    const paths = payload.map(i => i.path);
    const r = services.mergeToNewFolder(paths);
    if (r.success) utools.showNotification(`已创建"${r.folderName}"并移入 ${r.moved} 个项目`);
    else utools.showNotification('操作失败: ' + r.error);
    utools.outPlugin();
    return;
  }
  if (code === 'folder-dissolve') {
    const paths = payload.filter(i => i.isDirectory).map(i => i.path);
    if (!paths.length) { utools.showNotification('请选择文件夹'); utools.outPlugin(); return; }
    const r = services.dissolveFolder(paths);
    if (r.success) utools.showNotification(`已解散 ${r.dissolved.length} 个文件夹`);
    else utools.showNotification(`已解散 ${r.dissolved.length} 个，失败 ${r.errors.length} 个`);
    utools.outPlugin();
    return;
  }

  switchTab('edit');
  if (code === 'folder-chinese') {
    let currentPath = null;
    try { currentPath = utools.readCurrentFolderPath(); } catch (e) {}
    if (currentPath) {
      folders = [makeFolder(currentPath)];
    } else {
      folders = [];
      setTimeout(() => showToast('请在资源管理器中选中文件夹后再呼出，或直接拖入', 'error'), 200);
    }
  } else if (code === 'folder-chinese-batch') {
    folders = payload.filter(i => services.isDirectory(i.path)).map(i => makeFolder(i.path));
  }
  renderFolders();
});

function makeFolder(p) {
  return { path: p, name: services.getFolderName(p) };
}

// ---------- Tab 切换 ----------
function switchTab(name) {
  document.getElementById('tab-edit').classList.toggle('active', name === 'edit');
  document.getElementById('tab-history').classList.toggle('active', name === 'history');
  document.getElementById('view-edit').style.display = name === 'edit' ? '' : 'none';
  document.getElementById('view-history').style.display = name === 'history' ? '' : 'none';
  if (name === 'history') renderHistory();
  else renderFolders();
}

// ---------- 渲染文件夹卡片 ----------
function renderFolders() {
  const list = document.getElementById('folderList');
  const footer = document.getElementById('footer');
  if (folders.length === 0) {
    const recent = loadHistory().filter(h => services.isDirectory(h.path)).slice(0, 5);
    const recentHtml = recent.length ? `
      <div class="recent-block">
        <div class="recent-title">最近设置</div>
        ${recent.map((h, i) => `
          <div class="recent-item" onclick="addFromRecent(${i})">
            <span class="recent-icon">📁</span>
            <span class="recent-name">${escapeHtml(h.alias || h.name)}</span>
            <span class="recent-path">${escapeHtml(h.path)}</span>
            <span class="recent-add">+ 添加</span>
          </div>`).join('')}
      </div>` : '';
    list.innerHTML = `
      <div class="empty-panel">
        <div class="drop-hero" onclick="pickFolders()">
          <div class="drop-hero-icon">📂</div>
          <div class="drop-hero-title">拖拽文件夹到这里</div>
          <div class="drop-hero-desc">或点此选择文件夹 · 也可在资源管理器选中后呼出插件</div>
        </div>
        ${recentHtml}
      </div>`;
    recentEmptyCache = recent;
    footer.style.display = 'none';
    adjustHeight();
    return;
  }
  footer.style.display = 'flex';
  list.innerHTML = folders.map((f, i) => {
    const cfg = services.getFolderConfig(f.path);
    const activeColor = services.getActiveColor(f.path);
    const badges = [];
    if (cfg.alias) badges.push(`<span class="badge green">🏷 ${escapeHtml(cfg.alias)}</span>`);
    if (activeColor) badges.push(`<span class="badge" style="background:${COLOR_DISPLAY[activeColor]};color:#fff">📁 ${activeColor}</span>`);
    else if (cfg.icon) badges.push(`<span class="badge">🎨 图标</span>`);
    if (cfg.infoTip) badges.push(`<span class="badge">💬 ${escapeHtml(cfg.infoTip)}</span>`);
    return `
      <div class="card" id="card-${i}">
        <div class="card-remove" title="从列表移除" onclick="removeFromList(${i}, event)">✕</div>
        <div class="card-head">
          <div class="card-icon">📁</div>
          <div class="card-meta">
            <div class="card-name">${escapeHtml(f.name)}</div>
            <div class="card-path" title="${escapeHtml(f.path)}">${escapeHtml(f.path)}</div>
            ${badges.length ? `<div class="badges">${badges.join('')}</div>` : ''}
          </div>
          <div class="card-colors">
            <span class="color-icon">彩色文件夹：</span>
            ${COLORS.map(c => `<span class="color-dot${activeColor === c ? ' active' : ''}" style="background:${COLOR_DISPLAY[c]}" data-color="${c}" onclick="setColor(${i},this.dataset.color,event)"></span>`).join('')}
            ${activeColor ? `<span class="color-dot clear" onclick="setColor(${i},'',event)" title="清除颜色">✕</span>` : ''}
          </div>
        </div>
        <div class="card-body">
          <div class="field-row">
            <div class="field">
              <label>中文别名</label>
              <input class="input" id="alias-${i}" placeholder="例如：我的项目" value="${escapeAttr(cfg.alias || '')}">
            </div>
            <div class="field">
              <label>备注提示（悬停显示，可选）</label>
              <input class="input" id="tip-${i}" placeholder="例如：归档资料" value="${escapeAttr(cfg.infoTip || '')}">
            </div>
            <div class="field">
              <label>文件夹图标（.ico/.exe/.dll）</label>
              <div class="icon-row">
                <input class="row-input" id="icon-${i}" placeholder="选择图标文件" value="${escapeAttr(cfg.icon || '')}" readonly>
                <button class="btn btn-ghost btn-sm" onclick="pickIcon(${i})">选择</button>
                ${cfg.icon ? `<button class="btn btn-ghost btn-sm" onclick="clearIcon(${i})">清除</button>` : ''}
              </div>
            </div>
          </div>
          <div class="card-actions">
            <button class="btn btn-primary" onclick="applySingle(${i}, this)">应用</button>
            <button class="btn btn-ghost" onclick="openFolder(${i})">打开</button>
            <button class="btn btn-danger-ghost" onclick="resetFolder(${i}, this)">还原</button>
          </div>
        </div>
      </div>`;
  }).join('');
  adjustHeight();
}

function removeFromList(i, e) {
  if (e) e.stopPropagation();
  folders.splice(i, 1);
  renderFolders();
}

function pickFolders() {
  const ret = utools.showOpenDialog({
    title: '选择文件夹',
    properties: ['openDirectory', 'multiSelections']
  });
  if (!ret || !ret.length) return;
  let added = 0;
  ret.forEach(p => {
    if (services.isDirectory(p) && !folders.some(f => f.path === p)) {
      folders.push(makeFolder(p)); added++;
    }
  });
  renderFolders();
  if (added) showToast(`已添加 ${added} 个文件夹`, 'success');
}

function addFromRecent(i) {
  const p = recentEmptyCache[i].path;
  if (!folders.some(f => f.path === p)) folders.push(makeFolder(p));
  renderFolders();
}

// ---------- 选择图标 ----------
function pickIcon(i) {
  const ret = utools.showOpenDialog({
    title: '选择图标文件',
    filters: [{ name: '图标文件', extensions: ['ico', 'exe', 'dll'] }],
    properties: ['openFile']
  });
  if (ret && ret[0]) {
    document.getElementById(`icon-${i}`).value = ret[0];
  }
}

function clearIcon(i) {
  const r = services.clearFolderIcon(folders[i].path);
  if (r.success) {
    document.getElementById(`icon-${i}`).value = '';
    afterChange(folders[i].path, '已清除图标');
  } else showToast('清除失败: ' + r.error, 'error');
}

// ---------- 颜色选择 ----------
function setColor(i, colorName, e) {
  if (e) e.stopPropagation();
  const folder = folders[i];
  if (!colorName) {
    const r = services.clearFolderColor(folder.path);
    if (r.success) afterChange(folder.path, '已清除颜色');
    else showToast('清除失败: ' + r.error, 'error');
  } else {
    const r = services.setFolderColor(folder.path, colorName);
    if (r.success) afterChange(folder.path, `已设为${colorName}文件夹`);
    else showToast('设置失败: ' + r.error, 'error');
  }
}

// ---------- 应用单个 ----------
function applySingle(i, btn) {
  const folder = folders[i];
  const alias = document.getElementById(`alias-${i}`).value.trim();
  const icon = document.getElementById(`icon-${i}`).value.trim();
  const tip = document.getElementById(`tip-${i}`).value.trim();

  if (!alias && !icon && !tip) {
    showToast('请至少填写别名、图标或备注其中一项', 'error');
    return;
  }

  btn && btn.classList.add('loading');
  let ok = true, errMsg = '';
  if (alias) { const r = services.setFolderChineseName(folder.path, alias); if (!r.success) { ok = false; errMsg = r.error; } }
  if (ok && icon) { const r = services.setFolderIcon(folder.path, icon); if (!r.success) { ok = false; errMsg = r.error; } }
  if (ok) { const r = services.setFolderInfoTip(folder.path, tip); if (!r.success) { ok = false; errMsg = r.error; } }

  if (ok) {
    saveHistory(folder.path, alias);
    afterChange(folder.path, `已应用：${alias || folder.name}`, () => btn && btn.classList.remove('loading'));
  } else {
    btn && btn.classList.remove('loading');
    showToast('设置失败: ' + errMsg, 'error');
  }
}

// ---------- 全部应用 ----------
function applyAll() {
  let success = 0, fail = 0;
  const paths = [];
  folders.forEach((folder, i) => {
    const alias = document.getElementById(`alias-${i}`).value.trim();
    const icon = document.getElementById(`icon-${i}`).value.trim();
    const tip = document.getElementById(`tip-${i}`).value.trim();
    if (!alias && !icon && !tip) return;
    let ok = true;
    if (alias && !services.setFolderChineseName(folder.path, alias).success) ok = false;
    if (ok && icon && !services.setFolderIcon(folder.path, icon).success) ok = false;
    if (ok) services.setFolderInfoTip(folder.path, tip);
    if (ok) { success++; paths.push(folder.path); saveHistory(folder.path, alias); }
    else fail++;
  });
  if (success > 0) {
    Promise.all(paths.map(p => services.notifyFolderChanged(p))).then(() => {});
    showToast(`成功 ${success} 个${fail ? `，失败 ${fail} 个` : ''}`, fail ? 'error' : 'success');
    renderFolders();
  } else {
    showToast('没有需要应用的内容', 'error');
  }
}

// ---------- 还原 ----------
function resetFolder(i, btn) {
  btn && btn.classList.add('loading');
  const r = services.resetFolder(folders[i].path);
  if (r.success) {
    afterChange(folders[i].path, '已还原为默认显示', () => btn && btn.classList.remove('loading'));
  } else {
    btn && btn.classList.remove('loading');
    showToast('还原失败: ' + r.error, 'error');
  }
}

// ---------- 应用后：自动轻量刷新 + 重渲染 ----------
function afterChange(path, msg, done) {
  showToast(msg, 'success');
  renderFolders();
  services.notifyFolderChanged(path).then(() => { done && done(); });
}

function openFolder(i) {
  utools.shellShowItemInFolder(folders[i].path);
}

function deepRefresh(btn) {
  btn.classList.add('loading');
  showToast('正在深度刷新…');
  services.deepRefresh().then(() => {
    btn.classList.remove('loading');
    showToast('深度刷新完成', 'success');
  });
}

function clearFolders() {
  folders = [];
  renderFolders();
  showToast('已清空列表');
}

// ---------- 历史记录 ----------
function loadHistory() {
  return utools.dbStorage.getItem(HISTORY_KEY) || [];
}
function saveHistory(path, alias) {
  let list = loadHistory().filter(h => h.path !== path);
  list.unshift({ path, alias: alias || '', name: services.getFolderName(path), ts: Date.now() });
  if (list.length > 100) list = list.slice(0, 100);
  utools.dbStorage.setItem(HISTORY_KEY, list);
}
function removeHistory(i) {
  const path = historyCache[i].path;
  utools.dbStorage.setItem(HISTORY_KEY, loadHistory().filter(h => h.path !== path));
  renderHistory();
}

let historyCache = [];
function renderHistory() {
  const list = document.getElementById('historyList');
  historyCache = loadHistory();
  if (historyCache.length === 0) {
    list.innerHTML = `
      <div class="empty">
        <div class="icon">🕒</div>
        <div class="title">暂无历史记录</div>
        <div class="desc">设置过的文件夹会出现在这里</div>
      </div>`;
    adjustHeight();
    return;
  }
  list.innerHTML = historyCache.map((h, i) => {
    const exists = services.isDirectory(h.path);
    return `
      <div class="card">
        <div class="card-head" style="cursor:default">
          <div class="card-icon">${exists ? '📁' : '❓'}</div>
          <div class="card-meta">
            <div class="card-name">${escapeHtml(h.alias || h.name)}</div>
            <div class="card-path" title="${escapeHtml(h.path)}">${escapeHtml(h.path)}</div>
            ${!exists ? '<div class="badges"><span class="badge">⚠ 路径不存在</span></div>' : ''}
          </div>
          <div style="display:flex;gap:6px;">
            ${exists ? `<button class="btn btn-ghost btn-sm" onclick="editFromHistory(${i})">编辑</button>` : ''}
            ${exists ? `<button class="btn btn-ghost btn-sm" onclick="openHistory(${i})">打开</button>` : ''}
            <button class="btn btn-danger-ghost btn-sm" onclick="removeHistory(${i})">删除</button>
          </div>
        </div>
      </div>`;
  }).join('');
  adjustHeight();
}

function editFromHistory(i) {
  folders = [makeFolder(historyCache[i].path)];
  switchTab('edit');
}
function openHistory(i) {
  utools.shellShowItemInFolder(historyCache[i].path);
}

// ---------- 拖拽 ----------
function handleDragOver(e) { e.preventDefault(); e.stopPropagation(); document.getElementById('dropZone').classList.add('dragover'); }
function handleDragLeave(e) { e.preventDefault(); e.stopPropagation(); document.getElementById('dropZone').classList.remove('dragover'); }
function handleDrop(e) {
  e.preventDefault(); e.stopPropagation();
  document.getElementById('dropZone').classList.remove('dragover');
  let added = 0;
  for (const file of e.dataTransfer.files) {
    if (services.isDirectory(file.path) && !folders.some(f => f.path === file.path)) {
      folders.push(makeFolder(file.path)); added++;
    }
  }
  renderFolders();
  if (added > 0) showToast(`已添加 ${added} 个文件夹`, 'success');
  else showToast('拖入的不是文件夹或已存在', 'error');
}

// ---------- 工具 ----------
function adjustHeight() {
  try { utools.setExpendHeight(600); } catch (e) {}
}

let toastTimer = null;
function showToast(message, type) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) {
  return String(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// 初次进入
renderFolders();
