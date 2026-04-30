import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import path from 'node:path'

function manualChunks(id) {
  const normalizedId = String(id || '').replace(/\\/g, '/')
  if (!normalizedId.includes('node_modules')) return undefined

  if (normalizedId.includes('?worker')) return 'worker-runtime'

  if (normalizedId.includes('/@vicons/')) return 'vendor-icons'

  if (
    normalizedId.includes('/vue/') ||
    normalizedId.includes('/vue-router/') ||
    normalizedId.includes('/naive-ui/') ||
    normalizedId.includes('/css-render/') ||
    normalizedId.includes('/@css-render/') ||
    normalizedId.includes('/vooks/') ||
    normalizedId.includes('/treemate/') ||
    normalizedId.includes('/vfonts/')
  ) {
    return 'vendor-ui-core'
  }

  if (normalizedId.includes('/md-editor-v3/')) return 'vendor-md-editor'
  if (normalizedId.includes('/highlight.js/')) return 'vendor-highlight'
  if (normalizedId.includes('/katex/')) return 'vendor-katex'
  if (normalizedId.includes('/@codemirror/') || normalizedId.includes('/codemirror/')) return 'vendor-codemirror'

  if (normalizedId.includes('/pdfjs-dist/')) {
    return normalizedId.includes('/workers/') ? 'worker-pdfjs' : 'vendor-pdfjs'
  }
  if (normalizedId.includes('/mammoth/')) return 'vendor-mammoth'
  if (normalizedId.includes('/xlsx/')) {
    return normalizedId.includes('/workers/') ? 'worker-xlsx' : 'vendor-xlsx'
  }
  if (normalizedId.includes('/jszip/')) return 'vendor-jszip'

  return undefined
}

export default defineConfig({
  plugins: [vue()],
  base: './',
  worker: {
    format: 'es'
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  },
  server: {
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks
      }
    }
  }
})
