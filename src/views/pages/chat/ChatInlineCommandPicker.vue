<template>
  <div :class="['chat-inline-command-picker', { 'is-dark': isDark }]">
    <div class="chat-inline-command-picker__header">
      <span>{{ title }}</span>
      <span class="chat-inline-command-picker__query">{{ headerText }}</span>
    </div>

    <div ref="listRef" class="chat-inline-command-list">
      <button
        v-for="(item, index) in suggestions"
        :key="`${mode}-${type}-${item.value}`"
        type="button"
        class="chat-inline-command-item"
        :class="{
          'is-active': index === activeIndex,
          'is-selected': item.selected,
          'is-disabled': item.disabled
        }"
        :data-inline-picker-index="index"
        :disabled="item.disabled"
        :title="item.title || item.description || ''"
        @mousedown.prevent="emit('apply', item)"
      >
        <div class="chat-inline-command-item__main">
          <span class="chat-inline-command-item__name">{{ item.label }}</span>
          <span v-if="item.id && item.id !== item.label" class="chat-inline-command-item__id">{{ item.id }}</span>
        </div>

        <div class="chat-inline-command-item__meta">
          <span v-if="item.description" class="chat-inline-command-item__description">{{ item.description }}</span>
          <span v-if="item.shortType || item.meta">{{ item.shortType || item.meta }}</span>
          <span v-if="item.selected && item.selectedTag" class="chat-inline-command-item__tag">{{ item.selectedTag }}</span>
        </div>
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'

const props = defineProps({
  title: {
    type: String,
    default: ''
  },
  headerText: {
    type: String,
    default: ''
  },
  suggestions: {
    type: Array,
    required: true
  },
  activeIndex: {
    type: Number,
    default: 0
  },
  mode: {
    type: String,
    default: ''
  },
  type: {
    type: String,
    default: ''
  },
  theme: {
    type: String,
    default: 'light'
  }
})

const emit = defineEmits(['apply'])
const listRef = ref(null)
const isDark = computed(() => String(props.theme || '').trim().toLowerCase() === 'dark')

function scrollActiveItemIntoView(index) {
  if (index < 0) return
  const item = listRef.value?.querySelector?.(`[data-inline-picker-index="${index}"]`)
  if (!item) return
  item.scrollIntoView({ block: 'nearest' })
}

watch(
  () => [props.activeIndex, props.suggestions.length],
  () => nextTick(() => scrollActiveItemIntoView(props.activeIndex)),
  { flush: 'post' }
)
</script>

<style scoped>
.chat-inline-command-picker {
  padding: 6px 8px;
  border-radius: 9px;
  border: 1px solid rgba(32, 128, 240, 0.16);
  background: rgba(32, 128, 240, 0.06);
}

.chat-inline-command-picker.is-dark {
  border-color: rgba(64, 169, 255, 0.26);
  background: rgba(64, 169, 255, 0.12);
}

.chat-inline-command-picker__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  margin-bottom: 4px;
  font-size: 10px;
  font-weight: 600;
}

.chat-inline-command-picker__query {
  opacity: 0.68;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chat-inline-command-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
  max-height: 220px;
  overflow-y: auto;
  padding-right: 2px;
}

.chat-inline-command-item {
  width: 100%;
  padding: 5px 8px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.72);
  appearance: none;
  -webkit-appearance: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  text-align: left;
  cursor: pointer;
  color: inherit;
  font: inherit;
  transition: border-color 120ms ease, background-color 120ms ease, transform 120ms ease;
}

.chat-inline-command-item:hover,
.chat-inline-command-item.is-active {
  border-color: rgba(32, 128, 240, 0.45);
  background: rgba(255, 255, 255, 0.96);
  transform: translateY(-1px);
}

.chat-inline-command-item.is-selected {
  border-color: rgba(24, 160, 88, 0.35);
}

.chat-inline-command-item.is-disabled,
.chat-inline-command-item:disabled {
  opacity: 0.56;
  cursor: not-allowed;
  transform: none;
}

.chat-inline-command-item.is-disabled:hover,
.chat-inline-command-item:disabled:hover {
  border-color: rgba(0, 0, 0, 0.08);
  background: rgba(255, 255, 255, 0.72);
  transform: none;
}

.chat-inline-command-picker.is-dark .chat-inline-command-item {
  border-color: rgba(255, 255, 255, 0.12);
  background: rgba(24, 24, 28, 0.72);
  color: inherit;
}

.chat-inline-command-picker.is-dark .chat-inline-command-item:hover,
.chat-inline-command-picker.is-dark .chat-inline-command-item.is-active {
  border-color: rgba(64, 169, 255, 0.52);
  background: rgba(32, 32, 36, 0.96);
}

.chat-inline-command-picker.is-dark .chat-inline-command-item.is-disabled,
.chat-inline-command-picker.is-dark .chat-inline-command-item:disabled {
  border-color: rgba(255, 255, 255, 0.12);
  background: rgba(24, 24, 28, 0.72);
}

.chat-inline-command-picker.is-dark .chat-inline-command-item.is-disabled:hover,
.chat-inline-command-picker.is-dark .chat-inline-command-item:disabled:hover {
  border-color: rgba(255, 255, 255, 0.12);
  background: rgba(24, 24, 28, 0.72);
}

.chat-inline-command-item__main,
.chat-inline-command-item__meta {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex-wrap: nowrap;
}

.chat-inline-command-item__main {
  flex: 1;
  overflow: hidden;
}

.chat-inline-command-item__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 600;
}

.chat-inline-command-item__id,
.chat-inline-command-item__description {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10px;
  opacity: 0.72;
}

.chat-inline-command-item__description {
  opacity: 0.68;
  flex: 1;
}

.chat-inline-command-item__tag {
  padding: 1px 7px;
  border-radius: 999px;
  background: rgba(24, 160, 88, 0.14);
  color: #208050;
  opacity: 1;
  font-size: 10px;
  flex: 0 0 auto;
}

.chat-inline-command-picker.is-dark .chat-inline-command-item__tag {
  background: rgba(24, 160, 88, 0.22);
  color: #8ee6b0;
}
</style>
