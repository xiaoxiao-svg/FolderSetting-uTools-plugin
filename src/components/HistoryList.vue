<script setup lang="ts">
import type { HistoryItem } from '../types';

type Svcs = Window['services'];

defineProps<{
  history: HistoryItem[];
  services: Svcs;
  escapeHtml: (s: string) => string;
}>();

const emit = defineEmits<{
  edit: [index: number];
  open: [index: number];
  remove: [index: number];
}>();
</script>

<template>
  <div id="historyList">
    <template v-if="history.length === 0">
      <div class="empty">
        <div class="icon">🕒</div>
        <div class="title">暂无历史记录</div>
        <div class="desc">设置过的文件夹会出现在这里</div>
      </div>
    </template>
    <template v-else>
      <div v-for="(h, i) in history" :key="h.path" class="card">
        <div class="card-head" style="cursor: default">
          <div class="card-icon">{{ services.isDirectory(h.path) ? '📁' : '❓' }}</div>
          <div class="card-meta">
            <div class="card-name">{{ escapeHtml(h.alias || h.name) }}</div>
            <div class="card-path" :title="escapeHtml(h.path)">{{ escapeHtml(h.path) }}</div>
            <div v-if="!services.isDirectory(h.path)" class="badges">
              <span class="badge">⚠ 路径不存在</span>
            </div>
          </div>
          <div style="display: flex; gap: 6px">
            <button
              v-if="services.isDirectory(h.path)"
              class="btn btn-ghost btn-sm"
              @click="emit('edit', i)"
            >编辑</button>
            <button
              v-if="services.isDirectory(h.path)"
              class="btn btn-ghost btn-sm"
              @click="emit('open', i)"
            >打开</button>
            <button class="btn btn-danger-ghost btn-sm" @click="emit('remove', i)">删除</button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* 样式由全局 src/style.css 提供 */
</style>
