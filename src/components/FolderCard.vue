<script setup lang="ts">
import { computed } from 'vue';
import type { ColorName, FolderConfig, FolderItem } from '../types';

const props = defineProps<{
  folder: FolderItem;
  index: number;
  cfg: FolderConfig;
  activeColor: ColorName | null;
  colors: ColorName[];
  colorDisplay: Record<ColorName, string>;
  escapeHtml: (s: string) => string;
}>();

const emit = defineEmits<{
  apply: [index: number];
  reset: [index: number];
  open: [index: number];
  remove: [index: number];
  pickIcon: [index: number];
  clearIcon: [index: number];
  setColor: [index: number, colorName: ColorName | ''];
  stop: [event: Event];
}>();

// 图标输入框显示值：用户已选图标优先，否则回退到颜色对应的图标路径
const displayIcon = computed(() => {
  if (props.folder.icon) return props.folder.icon;
  if (props.activeColor) return window.services.getColorIconPath(props.activeColor);
  return '';
});
</script>

<template>
  <div class="card" :id="`card-${index}`">
    <div class="card-remove" title="从列表移除" @click="emit('remove', index)">✕</div>
    <div class="card-head">
      <div class="card-icon">📁</div>
      <div class="card-meta">
        <div class="card-name">{{ escapeHtml(folder.name) }}</div>
        <div class="card-meta-row">
          <span class="card-path" :title="escapeHtml(folder.path)">{{ escapeHtml(folder.path) }}</span>
          <span v-if="cfg.alias || activeColor || cfg.icon || cfg.infoTip" class="badges">
            <span v-if="cfg.alias" class="badge green">🏷 {{ escapeHtml(cfg.alias) }}</span>
            <span
              v-if="activeColor"
              class="badge"
              :style="{ background: colorDisplay[activeColor], color: '#fff' }"
            >📁 {{ activeColor }}</span>
            <span v-else-if="cfg.icon" class="badge">🎨 图标</span>
            <span v-if="cfg.infoTip" class="badge">💬 {{ escapeHtml(cfg.infoTip) }}</span>
          </span>
        </div>
      </div>
      <div class="card-colors">
        <span class="color-icon">彩色文件夹：</span>
        <span
          v-for="c in colors"
          :key="c"
          class="color-dot"
          :class="{ active: activeColor === c }"
          :style="{ background: colorDisplay[c] }"
          @click="emit('setColor', index, c)"
        ></span>
        <span
          v-if="activeColor"
          class="color-dot clear"
          title="清除颜色"
          @click="emit('setColor', index, '')"
        >✕</span>
      </div>
    </div>
    <div class="card-body">
      <div class="field-row">
        <div class="field">
          <label>中文别名</label>
          <input
            class="input"
            placeholder="例如：我的项目"
            v-model="folder.alias"
          />
        </div>
        <div class="field">
          <label>备注提示（悬停显示，可选）</label>
          <input
            class="input"
            placeholder="例如：归档资料"
            v-model="folder.tip"
          />
        </div>
        <div class="field">
          <label>文件夹图标（.ico/.exe/.dll）</label>
          <div class="icon-row">
            <input
              class="row-input"
              placeholder="选择图标文件"
              readonly
              :value="displayIcon"
            />
            <button class="btn btn-ghost btn-sm" @click="emit('pickIcon', index)">选择</button>
            <button
              v-if="folder.icon || activeColor"
              class="btn btn-ghost btn-sm"
              @click="emit('clearIcon', index)"
            >清除</button>
          </div>
        </div>
      </div>
      <div class="card-actions">
        <button class="btn btn-primary" @click="emit('apply', index)">应用</button>
        <button class="btn btn-ghost" @click="emit('open', index)">打开</button>
        <button class="btn btn-danger-ghost" @click="emit('reset', index)">还原</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 样式由全局 src/style.css 提供 */
</style>
