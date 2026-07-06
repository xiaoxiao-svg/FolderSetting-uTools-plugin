import { defineConfig, type Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';
import fs from 'node:fs';
import path from 'node:path';

const DIST_DIR = 'dist';
const PUBLIC_DIR = 'public';

// 校验 public/plugin.json：必须是合法 JSON 且无 BOM（uTools 解析严格）
function validatePluginJson(): void {
  const p = path.resolve(process.cwd(), PUBLIC_DIR, 'plugin.json');
  const buf = fs.readFileSync(p);
  if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
    throw new Error('plugin.json 含 BOM，uTools 会解析失败');
  }
  try {
    JSON.parse(buf.toString('utf8'));
  } catch (e) {
    throw new Error(`plugin.json 不是合法 JSON：${e}`);
  }
}

// vite 插件：构建开始前校验一次
const pluginJsonValidator = (): Plugin => ({
  name: 'validate-plugin-json',
  enforce: 'pre',
  buildStart() {
    validatePluginJson();
  },
});

// vite 插件：构建结束后确保 dist/preload.js / dist/plugin.json / dist/package.json 存在
const preserveStaticFiles = (): Plugin => ({
  name: 'preserve-static-files',
  enforce: 'post',
  writeBundle(options) {
    const outDir = options.dir || DIST_DIR;
    const required = ['preload.js', 'plugin.json', 'package.json', 'logo.png'];
    for (const f of required) {
      const fp = path.join(outDir, f);
      if (!fs.existsSync(fp)) {
        this.warn(`缺少构建产物 ${f}，public/ 拷贝可能失败`);
      }
    }
  },
});

export default defineConfig({
  plugins: [vue(), pluginJsonValidator(), preserveStaticFiles()],
  base: './',
  publicDir: PUBLIC_DIR,
  build: {
    outDir: DIST_DIR,
    emptyOutDir: true,
    target: 'es2022',
  },
  server: {
    host: '127.0.0.1',
    port: 5177,
    strictPort: true,
    hmr: {
      host: '127.0.0.1',
    },
  },
});
