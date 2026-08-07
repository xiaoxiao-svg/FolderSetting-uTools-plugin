// uTools 插件的全局类型声明
// 仅覆盖当前项目实际调用的 API，不在 uTools 环境时全部返回空实现
// 来源：
//   - utools: preload 注入 + feature 回调注入
//   - services: preload.js 通过 window.services 挂载

export type Result<T = unknown> = { success: true; value?: T } | { success: false; error: string };

export type FolderConfig = {
  alias: string | null;
  icon: string | null;
  infoTip: string | null;
};

export type FolderItem = {
  path: string;
  name: string;
  // 以下三项由前端临时持有（应用/写入时同步到 services）
  alias: string;
  icon: string;
  tip: string;
};

export type HistoryItem = {
  path: string;
  alias: string;
  name: string;
  ts: number;
};

export type ColorName = '红色' | '蓝色' | '绿色' | '黄色' | '紫色' | '灰色' | '黑色';

export type PluginEnterPayload = {
  code: string;
  type: string;
  payload: Array<{ path: string; isDirectory?: boolean; name?: string }>;
  optional?: { filePaths?: string[] };
};

declare global {
  interface Window {
    utools: {
      onPluginEnter: (cb: (payload: PluginEnterPayload) => void) => void;
      readCurrentFolderPath: () => string | null;
      showOpenDialog: (opts: {
        title?: string;
        filters?: Array<{ name: string; extensions: string[] }>;
        properties?: Array<'openFile' | 'openDirectory' | 'multiSelections'>;
      }) => string[] | null;
      shellShowItemInFolder: (p: string) => void;
      showNotification: (msg: string) => void;
      setExpendHeight: (n: number) => void;
      outPlugin: () => void;
      dbStorage: {
        // uTools dbStorage 为同步 API（localStorage 语义），不返回 Promise
        getItem: (k: string) => string | null;
        setItem: (k: string, v: string) => void;
        removeItem: (k: string) => void;
      };
      db: {
        promises: {
          get: (id: string) => Promise<any>;
          put: (doc: any) => Promise<{ ok: boolean; rev?: string }>;
          remove: (doc: any) => Promise<{ ok: boolean }>;
        };
      };
    };

    services: {
      // 配置读写
      getFolderConfig: (folderPath: string) => FolderConfig;
      getFolderChineseName: (folderPath: string) => string | null;
      setFolderChineseName: (folderPath: string, alias: string) => Result;
      setFolderIcon: (folderPath: string, icoPath: string) => Result;
      clearFolderIcon: (folderPath: string) => Result;
      setFolderInfoTip: (folderPath: string, text: string) => Result;
      resetFolder: (folderPath: string) => Result;
      removeFolderChineseName: (folderPath: string) => Result;

      // 刷新（多为异步）
      notifyFolderChanged: (folderPath: string) => Promise<Result>;
      deepRefresh: () => Promise<Result>;
      refreshExplorer: () => Promise<Result>;
      refreshIconCache: () => Promise<Result>;
      restartExplorer: () => Promise<Result>;

      // 工具
      isDirectory: (p: string) => boolean;
      getFolderName: (p: string) => string;

      // 文件操作
      mergeToNewFolder: (paths: string[]) => Result<{ folderName: string; moved: number }>;
      dissolveFolder: (
        paths: string[]
      ) => Result<{ dissolved: string[]; errors: { path: string; error: string }[] }>;

      // 颜色
      getAvailableColors: () => ColorName[];
      setFolderColor: (folderPath: string, colorName: ColorName) => Result;
      clearFolderColor: (folderPath: string) => Result;
      getActiveColor: (folderPath: string) => ColorName | null;
      getColorIconPath: (colorName: ColorName) => string;
    };
  }
}

// 让 import 触发 TS 模块解析
export {};
