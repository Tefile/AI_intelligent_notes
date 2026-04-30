<template>
  <div class="chat-inline-agent-picker">
    <div class="chat-inline-agent-picker__header">
      <span>智能体</span>
      <span class="chat-inline-agent-picker__query">{{ headerText }}</span>
    </div>

    <div ref="listRef" class="chat-inline-agent-list">
      <button
        v-for="(agent, index) in suggestions"
        :key="agent.value"
        type="button"
        class="chat-inline-agent-item"
        :data-inline-picker-index="index"
        :class="{
          'is-active': index === activeIndex,
          'is-selected': agent.value === selectedAgentId
        }"
        :title="[agent.label, agent.name && agent.name !== agent.id ? `@${agent.id}` : '', agent.providerLabel, agent.model].filter(Boolean).join('\n')"
        @mousedown.prevent="emit('apply', agent.value)"
      >
        <div class="chat-inline-agent-item__main">
          <span class="chat-inline-agent-item__name">{{ agent.label }}</span>
          <span v-if="agent.name && agent.name !== agent.id" class="chat-inline-agent-item__id">@{{ agent.id }}</span>
        </div>
        <div class="chat-inline-agent-item__meta">
          <span v-if="agent.providerLabel">{{ agent.providerLabel }}</span>
          <span v-if="agent.model">{{ agent.model }}</span>
          <span v-if="agent.value === selectedAgentId" class="chat-inline-agent-item__tag">已选中</span>
        </div>
      </button>
    </div>
  </div>
</template>

<script setup>
import { nextTick, ref, watch } from 'vue'

const props = defineProps({
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
  selectedAgentId: {
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

