import { reactive } from 'vue';

// 封装 window.utools + window.services 为可复用 composable
// 组件内 import { utools, services, toast } from '@/composables/useUtools' 即可

function getWindow() {
  if (typeof window === 'undefined') {
    throw new Error('useUtools 只能在浏览器/uTools 渲染进程使用');
  }
  return window;
}

export function useUtools() {
  const w = getWindow();
  return {
    utools: w.utools,
    services: w.services,
  };
}

// ---- toast ----
type ToastType = 'success' | 'error' | 'info';
type ToastState = { message: string; type: ToastType; visible: boolean };

const state = reactive<ToastState>({ message: '', type: 'info', visible: false });

let toastTimer: ReturnType<typeof setTimeout> | null = null;

export function useToast() {
  function show(message: string, type: ToastType = 'info', duration = 2600) {
    state.message = message;
    state.type = type;
    state.visible = true;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      state.visible = false;
    }, duration);
  }

  return {
    state,
    show,
    success: (msg: string) => show(msg, 'success'),
    error: (msg: string) => show(msg, 'error'),
    info: (msg: string) => show(msg, 'info'),
  };
}

// 兼容 TS 模块风格
export default useUtools;
