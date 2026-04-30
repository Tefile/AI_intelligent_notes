<template>
  <div :class="['chat-context-preview', { 'is-dark': theme === 'dark' }]">
    <div class="chat-context-preview__header">
      <div class="chat-context-preview__title">{{ title }}</div>
      <div class="chat-context-preview__meta">{{ summaryText }}</div>
    </div>
    <div v-if="entries.length" class="chat-context-preview__list">
      <div
        v-for="(entry, index) in entries"
        :key="entryKey(entry, index)"
        class="chat-context-preview__item"
      >
        <div class="chat-context-preview__item-header">
          <n-tag size="small" :bordered="false" :type="helpers.modeType(entry)">
            {{ helpers.modeLabel(entry) }}
          </n-tag>
          <div class="chat-context-preview__item-title">{{ helpers.entryLabel(entry, index) }}</div>
          <div class="chat-context-preview__item-meta">
            {{ entry.messageCount }} 条 · {{ helpers.formatApproxChars(entry.chars) }}
          </div>
        </div>
        <div v-if="helpers.entryNote(entry)" class="chat-context-preview__item-note">
          {{ helpers.entryNote(entry) }}
        </div>
        <div class="chat-context-preview__item-text">
          {{ entry.previewText || '（无预览文本）' }}
        </div>
      </div>
    </div>
    <div v-else class="chat-context-preview__empty">
      {{ emptyText }}
    </div>
  </div>
</template>

<script setup>
import { NTag } from 'naive-ui'

defineProps({
  title: {
    type: String,
    default: ''
  },
  summaryText: {
    type: String,
    default: ''
  },
  entries: {
    type: Array,
    default: () => []
  },
  emptyText: {
    type: String,
    default: ''
  },
  theme: {
    type: String,
    default: 'light'
  },
  helpers: {
    type: Object,
    required: true
  }
})

function entryKey(entry, index, prefix = '') {
  const parts = [
    prefix,
    entry?.kind || 'entry',
    entry?.index ?? 'prelude',
    entry?.mode || 'full',
    index
  ]
  return parts.filter(Boolean).join('-')
}
</script>

