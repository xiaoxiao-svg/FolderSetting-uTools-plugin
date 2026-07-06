<script setup lang="ts">
import type { HistoryItem } from '../types';

// 空列表 + 拖拽提示 + 最近设置
defineProps<{
  recent: HistoryItem[];
  escapeHtml: (s: string) => string;
}>();

const emit = defineEmits<{
  pickFolders: [];
  addFromRecent: [index: number];
}>();
</script>

<template>
  <div class="empty-panel">
    <div class="drop-hero" @click="emit('pickFolders')">
      <div class="drop-hero-icon">📂</div>
      <div class="drop-hero-title">拖拽文件夹到这里</div>
      <div class="drop-hero-desc">或点此选择文件夹 · 也可在资源管理器选中后呼出插件</div>
    </div>
    <div v-if="recent.length" class="recent-block">
      <div class="recent-title">最近设置</div>
      <div
        v-for="(h, i) in recent"
        :key="h.path"
        class="recent-item"
        @click="emit('addFromRecent', i)"
      >
        <span class="recent-icon">📁</span>
        <span class="recent-name">{{ escapeHtml(h.alias || h.name) }}</span>
        <span class="recent-path">{{ escapeHtml(h.path) }}</span>
        <span class="recent-add">+ 添加</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 样式由全局 src/style.css 提供 */
</style>
