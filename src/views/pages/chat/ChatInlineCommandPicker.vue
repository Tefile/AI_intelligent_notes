<template>
  <div class="chat-inline-agent-picker">
    <div class="chat-inline-agent-picker__header">
      <span>{{ title }}</span>
      <span class="chat-inline-agent-picker__query">{{ headerText }}</span>
    </div>

    <div ref="listRef" class="chat-inline-agent-list">
      <button
        v-for="(item, index) in suggestions"
        :key="`${mode}-${type}-${item.value}`"
        type="button"
        class="chat-inline-agent-item"
        :data-inline-picker-index="index"
        :class="{
          'is-active': index === activeIndex,
          'is-selected': item.selected,
          'is-disabled': item.disabled
        }"
        :disabled="item.disabled"
        :title="item.title || ''"
        @mousedown.prevent="emit('apply', item)"
      >
        <div class="chat-inline-command-item__body">
          <div class="chat-inline-agent-item__main">
            <span class="chat-inline-agent-item__name">{{ item.label }}</span>
            <span v-if="item.id && item.id !== item.label" class="chat-inline-agent-item__id">{{ item.id }}</span>
          </div>
          <div v-if="item.description" class="chat-inline-command-item__description">{{ item.description }}</div>
        </div>

        <div class="chat-inline-agent-item__meta">
          <span v-if="item.meta">{{ item.meta }}</span>
          <span v-if="item.selected && item.selectedTag" class="chat-inline-agent-item__tag">{{ item.selectedTag }}</span>
        </div>
      </button>
    </div>
  </div>
</template>

<script setup>
import { nextTick, ref, watch } from 'vue'

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
  }
})

const emit = defineEmits(['apply'])
const listRef = ref(null)

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

