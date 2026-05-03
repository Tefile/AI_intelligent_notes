<template>
  <!-- 懒加载 Markdown 预览：统一走同一套运行时和样式。 -->
  <MarkdownPreviewRenderer v-bind="props" />
</template>

<script setup>
import { defineAsyncComponent } from 'vue'
import { ensureMarkdownPreviewRuntime } from '@/utils/mdEditorRuntime'

const MarkdownPreviewRenderer = defineAsyncComponent({
  loader: async () => {
    await ensureMarkdownPreviewRuntime()
    return import('./MarkdownPreviewRenderer.vue')
  },
  suspensible: false
})

const props = defineProps({
  editorId: {
    type: String,
    default: ''
  },
  modelValue: {
    type: String,
    default: ''
  },
  filePath: {
    type: String,
    default: ''
  },
  previewTheme: {
    type: String,
    default: 'github'
  },
  theme: {
    type: String,
    default: 'light'
  },
  codeTheme: {
    type: String,
    default: ''
  },
  codeFoldable: {
    type: Boolean,
    default: true
  },
  autoFoldThreshold: {
    type: Number,
    default: 30
  },
  streaming: {
    type: Boolean,
    default: false
  },
  streamThrottleMs: {
    type: Number,
    default: 0
  }
})
</script>
