<template>
  <!-- 上下文预算面板：展示窗口占用、阈值和风险提示。 -->
  <div
    v-if="budgetStatus?.level && budgetStatus.level !== 'safe'"
    :class="['chat-context-budget-callout', `is-${budgetStatus.level}`, { 'is-dark': theme === 'dark' }]"
  >
    {{ budgetStatus.text }}
  </div>

  <div :class="['chat-context-budget', { 'is-dark': theme === 'dark' }]">
    <div class="chat-context-budget__header">
      <div class="chat-context-budget__title">预算占用</div>
      <div class="chat-context-budget__meta">{{ budgetSummaryText }}</div>
    </div>
    <div class="chat-context-budget__list">
      <div
        v-for="item in budgetItems"
        :key="item.key"
        class="chat-context-budget__item"
      >
        <div class="chat-context-budget__row">
          <div class="chat-context-budget__label">{{ item.label }}</div>
          <div class="chat-context-budget__value">{{ item.usedLabel }} / {{ item.maxLabel }}</div>
        </div>
        <div class="chat-context-budget__track">
          <div
            class="chat-context-budget__fill"
            :class="`is-${item.tone}`"
            :style="{ width: `${item.percent}%` }"
          />
        </div>
        <div v-if="item.hint" class="chat-context-budget__hint">{{ item.hint }}</div>
      </div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  budgetStatus: {
    type: Object,
    default: () => ({ level: 'safe', text: '' })
  },
  budgetSummaryText: {
    type: String,
    default: ''
  },
  budgetItems: {
    type: Array,
    default: () => []
  },
  theme: {
    type: String,
    default: 'light'
  }
})
</script>
