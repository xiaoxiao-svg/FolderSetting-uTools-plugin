const fs = require('fs');
const path = require('path');
const { exec, execSync } = require('child_process');

// ============ desktop.ini 读写（统一按键值表处理，合并写入不互相覆盖）============

const INI_SECTION = '[.ShellClassInfo]';

/**
 * 解析 desktop.ini，返回 .ShellClassInfo 段下的键值对象
 * @param {string} folderPath
 * @returns {Object} 形如 { LocalizedResourceName, IconResource, InfoTip }
 */
function parseIni(folderPath) {
  const iniPath = path.join(folderPath, 'desktop.ini');
  if (!fs.existsSync(iniPath)) return {};
  try {
    let content = fs.readFileSync(iniPath, 'utf16le');
    // 去掉可能的 BOM
    if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
    const result = {};
    let inSection = false;
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      if (line.startsWith('[')) {
        inSection = line.toLowerCase() === INI_SECTION.toLowerCase();
        continue;
      }
      if (!inSection) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      result[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
    }
    return result;
  } catch (e) {
    return {};
  }
}

/**
 * 把键值对象写回 desktop.ini，并处理属性。
 * 若对象为空则删除 ini 文件。
 * @param {string} folderPath
 * @param {Object} kv
 */
function writeIni(folderPath, kv) {
  const iniPath = path.join(folderPath, 'desktop.ini');
  // 先解除属性，便于覆盖/删除
  if (fs.existsSync(iniPath)) {
    try { execSync(`attrib -r -s -h "${iniPath}"`, { stdio: 'ignore' }); } catch (e) {}
  }

  const keys = Object.keys(kv).filter(k => kv[k] !== undefined && kv[k] !== null && kv[k] !== '');

  if (keys.length === 0) {
    // 无任何配置：删除 ini 并还原文件夹属性
    if (fs.existsSync(iniPath)) fs.unlinkSync(iniPath);
    try { execSync(`attrib -r "${folderPath}"`, { stdio: 'ignore' }); } catch (e) {}
    return;
  }

  let content = INI_SECTION + '\r\n';
  for (const k of keys) content += `${k}=${kv[k]}\r\n`;

  const bom = Buffer.from([0xFF, 0xFE]);
  const finalBuffer = Buffer.concat([bom, Buffer.from(content, 'utf16le')]);
  fs.writeFileSync(iniPath, finalBuffer);

  // desktop.ini：只读 + 系统 + 隐藏
  try { execSync(`attrib +r +s +h "${iniPath}"`, { stdio: 'ignore' }); } catch (e) {}
  // 文件夹设为只读（系统读取 desktop.ini 的必要条件）
  try { execSync(`attrib +r "${folderPath}"`, { stdio: 'ignore' }); } catch (e) {}
}

// ============ 对外的配置读写 ============

/**
 * 一次性读取文件夹的别名 / 图标 / 备注
 * @param {string} folderPath
 * @returns {{ alias: string|null, icon: string|null, infoTip: string|null }}
 */
function getFolderConfig(folderPath) {
  const kv = parseIni(folderPath);
  return {
    alias: kv.LocalizedResourceName || null,
    icon: kv.IconResource ? kv.IconResource.split(',')[0] : null,
    infoTip: kv.InfoTip || null
  };
}

/** 兼容旧接口：只取别名 */
function getFolderChineseName(folderPath) {
  return getFolderConfig(folderPath).alias;
}

/**
 * 设置中文别名（合并写入，保留图标/备注）
 */
function setFolderChineseName(folderPath, chineseName) {
  try {
    const kv = parseIni(folderPath);
    kv.LocalizedResourceName = chineseName;
    writeIni(folderPath, kv);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * 设置文件夹图标。iconPath 可为 .ico/.exe/.dll，index 默认 0
 */
function setFolderIcon(folderPath, iconPath, index = 0) {
  try {
    const kv = parseIni(folderPath);
    kv.IconResource = `${iconPath},${index}`;
    writeIni(folderPath, kv);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/** 清除图标，保留别名/备注 */
function clearFolderIcon(folderPath) {
  try {
    const kv = parseIni(folderPath);
    delete kv.IconResource;
    writeIni(folderPath, kv);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/** 设置鼠标悬停备注 */
function setFolderInfoTip(folderPath, text) {
  try {
    const kv = parseIni(folderPath);
    if (text && text.trim()) kv.InfoTip = text.trim();
    else delete kv.InfoTip;
    writeIni(folderPath, kv);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * 一键还原：移除别名/图标/备注，删除 desktop.ini，还原文件夹属性
 */
function resetFolder(folderPath) {
  try {
    writeIni(folderPath, {}); // 空对象 → 删除 ini + 去只读
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/** 兼容旧接口名 */
function removeFolderChineseName(folderPath) {
  return resetFolder(folderPath);
}

// ============ 刷新（异步，不阻塞 UI）============

// SHChangeNotify 事件常量
const SHCNE_UPDATEDIR = 0x00001000;
const SHCNE_ASSOCCHANGED = 0x08000000;
const SHCNF_PATHW = 0x0005;
const SHCNF_IDLIST = 0x0000;

// C# 声明（注意：用 here-string，引号无需转义；通过 -EncodedCommand 传递规避所有 shell 转义）
const CS_TYPE_PATH = [
  'Add-Type @"',
  'using System;using System.Runtime.InteropServices;',
  'public class S{[DllImport("shell32.dll",CharSet=CharSet.Auto)]public static extern void SHChangeNotify(int e,uint f,string p,IntPtr d);}',
  '"@'
].join('\n');

const CS_TYPE_IDLIST = [
  'Add-Type @"',
  'using System;using System.Runtime.InteropServices;',
  'public class S{[DllImport("shell32.dll")]public static extern void SHChangeNotify(int e,uint f,IntPtr a,IntPtr b);}',
  '"@'
].join('\n');

/** 把 PowerShell 脚本编码为 -EncodedCommand 形式执行（异步） */
function runEncodedPowerShell(script) {
  return new Promise((resolve) => {
    const b64 = Buffer.from(script, 'utf16le').toString('base64');
    exec(`powershell -NoProfile -NonInteractive -EncodedCommand ${b64}`, { windowsHide: true }, (err) => {
      if (err) resolve({ success: false, error: err.message });
      else resolve({ success: true });
    });
  });
}

/**
 * 轻量刷新：精准通知某个文件夹已更新（异步，不阻塞、不清图标缓存）
 * @param {string} folderPath
 * @returns {Promise<{success:boolean,error?:string}>}
 */
function notifyFolderChanged(folderPath) {
  const safePath = folderPath.replace(/'/g, "''");
  const script = `${CS_TYPE_PATH}\n[S]::SHChangeNotify(${SHCNE_UPDATEDIR},${SHCNF_PATHW},'${safePath}',[IntPtr]::Zero)`;
  return runEncodedPowerShell(script);
}

/**
 * 深度刷新：全局图标关联刷新 + 清理图标缓存（较慢，兜底用，异步）
 * @returns {Promise<{success:boolean,error?:string}>}
 */
function deepRefresh() {
  const script = `${CS_TYPE_IDLIST}\n[S]::SHChangeNotify(${SHCNE_ASSOCCHANGED},${SHCNF_IDLIST},[IntPtr]::Zero,[IntPtr]::Zero)`;
  return runEncodedPowerShell(script).then(() => new Promise((resolve) => {
    // 清图标缓存（最慢一步，放最后，失败也无所谓）
    exec('ie4uinit.exe -ClearIconCache', { windowsHide: true }, (err) => {
      resolve({ success: !err, error: err ? err.message : undefined });
    });
  }));
}

/** 重启资源管理器（终极兜底，异步） */
function restartExplorer() {
  return new Promise((resolve) => {
    exec('taskkill /f /im explorer.exe', { windowsHide: true }, () => {
      exec('start explorer.exe', { windowsHide: true, shell: true }, (err) => {
        resolve({ success: !err, error: err ? err.message : undefined });
      });
    });
  });
}

// 兼容旧名称（前端仍可调用）
function refreshExplorer() { return deepRefresh(); }
function refreshIconCache() { return deepRefresh(); }

// ============ 工具函数 ============

function isDirectory(filePath) {
  try {
    return fs.statSync(filePath).isDirectory();
  } catch (e) {
    return false;
  }
}

function getFolderName(folderPath) {
  return path.basename(folderPath);
}

// ============ 放入新建文件夹 / 解散到上一级 ============

/**
 * 将选中的文件/文件夹放入新建文件夹
 */
function mergeToNewFolder(filePaths) {
  try {
    if (!filePaths || filePaths.length === 0) return { success: false, error: '没有选择文件' };

    const parentDir = path.dirname(filePaths[0]);
    const allSameParent = filePaths.every(p => path.dirname(p) === parentDir);
    if (!allSameParent) return { success: false, error: '所选项目不在同一目录' };

    let newName = '新建文件夹', counter = 0, newFolderPath;
    do {
      newFolderPath = path.join(parentDir, counter === 0 ? newName : `${newName} (${counter})`);
      counter++;
    } while (fs.existsSync(newFolderPath));

    fs.mkdirSync(newFolderPath, { recursive: true });

    let moved = 0;
    for (const fp of filePaths) {
      fs.renameSync(fp, path.join(newFolderPath, path.basename(fp)));
      moved++;
    }
    utools.showNotification(`已创建"${path.basename(newFolderPath)}"并移入 ${moved} 个项目`);
    setTimeout(() => utools.outPlugin(), 300);
    return { success: true, folderName: path.basename(newFolderPath), moved };
  } catch (e) {
    utools.showNotification(`操作失败: ${e.message}`);
    setTimeout(() => utools.outPlugin(), 300);
    return { success: false, error: e.message };
  }
}

/**
 * 将选中文件夹内的项目解散到上一级目录，然后删除空文件夹
 */
function dissolveFolder(folderPaths) {
  const errors = [];
  const dissolved = [];

  for (const fp of folderPaths) {
    try {
      if (!fs.statSync(fp).isDirectory()) { errors.push({ path: fp, error: '不是文件夹' }); continue; }

      const parent = path.dirname(fp);
      if (parent === fp) { errors.push({ path: fp, error: '不能解散驱动器根目录' }); continue; }

      const items = fs.readdirSync(fp);
      for (const item of items) {
        const src = path.join(fp, item);
        let dest = path.join(parent, item);
        if (fs.existsSync(dest)) {
          const ext = path.extname(item);
          const base = path.basename(item, ext);
          let c = 1;
          do { dest = path.join(parent, `${base}(${c})${ext}`); c++; } while (fs.existsSync(dest));
        }
        fs.renameSync(src, dest);
      }
      fs.rmdirSync(fp);
      dissolved.push(fp);
    } catch (e) {
      errors.push({ path: fp, error: e.message });
    }
  }
  if (dissolved.length || errors.length) {
    const msg = errors.length
      ? `已解散 ${dissolved.length} 个，失败 ${errors.length} 个`
      : `已解散 ${dissolved.length} 个文件夹`;
    utools.showNotification(msg);
  }
  setTimeout(() => utools.outPlugin(), 300);
  return { success: errors.length === 0, dissolved, errors };
}

// ============ 文件夹颜色（PNG 转 ICO 缓存）============

const COLOR_ICON_DIR = path.join(__dirname, 'icon');
const COLOR_CACHE_DIR = path.join(
  process.env.APPDATA || path.join(require('os').homedir(), 'AppData', 'Roaming'),
  'folder-chinese-icons'
);
try { if (!fs.existsSync(COLOR_CACHE_DIR)) fs.mkdirSync(COLOR_CACHE_DIR, { recursive: true }); } catch (e) {}

function getAvailableColors() {
  try {
    if (!fs.existsSync(COLOR_ICON_DIR)) return [];
    return fs.readdirSync(COLOR_ICON_DIR)
      .filter(f => f.endsWith('.png'))
      .map(f => f.replace('文件夹.png', '').replace('.png', ''));
  } catch (e) { return []; }
}

/** PNG 读取 → 直接以 PNG 数据包裹 ICO 容器（有效，Win7+ 支持） */
function pngToIcoBuffer(pngPath) {
  const png = fs.readFileSync(pngPath);
  const w = png.readUInt32BE(16), h = png.readUInt32BE(20);
  const hdr = Buffer.alloc(6);
  hdr.writeUInt16LE(0, 0); hdr.writeUInt16LE(1, 2); hdr.writeUInt16LE(1, 4);
  const ent = Buffer.alloc(16);
  ent.writeUInt8(w >= 256 ? 0 : w, 0); ent.writeUInt8(h >= 256 ? 0 : h, 1);
  ent.writeUInt8(0, 2); ent.writeUInt8(0, 3);
  ent.writeUInt16LE(1, 4); ent.writeUInt16LE(32, 6);
  ent.writeUInt32LE(png.length, 8); ent.writeUInt32LE(22, 12);
  return Buffer.concat([hdr, ent, png]);
}

function setFolderColor(folderPath, colorName) {
  try {
    const pngPath = path.join(COLOR_ICON_DIR, `${colorName}文件夹.png`);
    if (!fs.existsSync(pngPath)) return { success: false, error: `缺少图标:${colorName}` };
    const icoPath = path.join(COLOR_CACHE_DIR, `${colorName}.ico`);
    if (!fs.existsSync(icoPath)) fs.writeFileSync(icoPath, pngToIcoBuffer(pngPath));
    return setFolderIcon(folderPath, icoPath);
  } catch (e) { return { success: false, error: e.message }; }
}

function clearFolderColor(folderPath) { return clearFolderIcon(folderPath); }

/** 返回某颜色对应的缓存 .ico 路径（供前端显示用） */
function getColorIconPath(colorName) {
  return path.join(COLOR_CACHE_DIR, `${colorName}.ico`);
}

function getActiveColor(folderPath) {
  const cfg = getFolderConfig(folderPath);
  if (!cfg.icon) return null;
  // IconResource 格式：path,index — 先去掉 ,index 再取文件名
  const icoPath = cfg.icon.split(',')[0];
  const colorName = path.basename(icoPath, '.ico');
  return getAvailableColors().includes(colorName) ? colorName : null;
}

// 导出给前端使用
window.services = {
  // 配置读写
  getFolderConfig,
  getFolderChineseName,
  setFolderChineseName,
  setFolderIcon,
  clearFolderIcon,
  setFolderInfoTip,
  resetFolder,
  removeFolderChineseName,
  // 刷新
  notifyFolderChanged,
  deepRefresh,
  refreshExplorer,
  refreshIconCache,
  restartExplorer,
  // 工具
  isDirectory,
  getFolderName,
  // 文件操作
  mergeToNewFolder,
  dissolveFolder,
  // 颜色
  getAvailableColors,
  setFolderColor,
  clearFolderColor,
  getActiveColor,
  getColorIconPath
};
