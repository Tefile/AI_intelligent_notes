<template>
  <!-- 被省略的上下文列表：告诉用户哪些消息没有进入当前窗口。 -->
  <div
    v-if="entries.length"
    :class="['chat-context-preview', 'chat-context-preview--omitted', { 'is-dark': theme === 'dark' }]"
  >
    <div class="chat-context-preview__header">
      <div class="chat-context-preview__title">{{ title }}</div>
      <div class="chat-context-preview__meta">{{ summaryText }}</div>
    </div>
    <div class="chat-context-preview__filters">
      <n-button
        v-for="option in filterOptions"
        :key="option.value"
        size="tiny"
        secondary
        :type="resolvedFilter === option.value ? 'primary' : 'default'"
        @click="emit('update:omittedFilter', option.value)"
      >
        {{ option.label }} · {{ option.count }}
      </n-button>
    </div>
    <div v-if="filteredEntries.length" class="chat-context-preview__list">
      <div
        v-for="(entry, index) in filteredEntries"
        :key="entryKey(entry, index, 'omitted')"
        class="chat-context-preview__item chat-context-preview__item--omitted"
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
        <div v-if="entry.reasons && entry.reasons.length" class="chat-context-preview__item-reasons">
          <n-tag
            v-for="reason in entry.reasons"
            :key="`${entry.kind}-${entry.index ?? 'prelude'}-${reason}`"
            size="small"
            :bordered="false"
            :type="helpers.omittedReasonType(reason)"
          >
            {{ helpers.omittedReasonLabel(reason) }}
          </n-tag>
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
      {{ filteredEmptyText }}
    </div>
  </div>
</template>

<script setup>
import { NButton, NTag } from 'naive-ui'

const props = defineProps({
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
  filterOptions: {
    type: Array,
    default: () => []
  },
  resolvedFilter: {
    type: String,
    default: 'all'
  },
  filteredEntries: {
    type: Array,
    default: () => []
  },
  filteredEmptyText: {
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

const emit = defineEmits(['update:omittedFilter'])

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
