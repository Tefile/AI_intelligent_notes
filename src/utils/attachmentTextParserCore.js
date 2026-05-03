// 附件文本解析核心：负责图片、文档和二进制附件的文本抽取逻辑。
function decodeXmlEntities(text) {
  // PPTX / XML 里的文本要先解实体，不然后续拼接出来会满是 &lt; 这类占位符。
  return String(text || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

export function truncateAttachmentText(text, maxChars) {
  const raw = String(text || '').trim()
  if (!raw) return ''
  if (!maxChars || raw.length <= maxChars) return raw
  return `${raw.slice(0, maxChars)}\n\n(attachment content truncated, total ${raw.length} chars)`
}

export async function parsePdfToText(arrayBuffer) {
  // PDF 优先走 pdf.js 的文本层；没有文本层时，通常就是扫描件或图片型 PDF。
  const pdfjsMod = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const pdfjs = pdfjsMod?.default || pdfjsMod
  const loadingTask = pdfjs.getDocument({
    data: arrayBuffer instanceof Uint8Array ? arrayBuffer : new Uint8Array(arrayBuffer),
    disableWorker: true,
    useSystemFonts: true,
    disableFontFace: true,
    isEvalSupported: false,
    stopAtErrors: false
  })
  const pdf = await loadingTask.promise
  const pages = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    const pageText = (content.items || []).map((item) => item?.str || '').filter(Boolean).join(' ')
    if (pageText.trim()) pages.push(`[Page ${i}]\n${pageText}`)
  }
  const text = pages.join('\n\n').trim()
  if (text) return text
  return 'PDF contains no extractable text. It may be a scanned or image-only PDF, and OCR is not available.'
}

export async function parseDocxToText(arrayBuffer) {
  // Word 文档直接交给 mammoth，它更适合抽正文而不是保留排版。
  const mammothMod = await import('mammoth/mammoth.browser.js')
  const mammoth = mammothMod?.default || mammothMod
  const result = await mammoth.extractRawText({ arrayBuffer })
  return String(result?.value || '').trim()
}

export async function parseXlsxToText(arrayBuffer) {
  // 表格先转 CSV，再按 sheet 分块，方便后续把结果喂给模型或展示。
  const xlsxMod = await import('xlsx')
  const XLSX = xlsxMod?.default || xlsxMod
  const workbook = XLSX.read(arrayBuffer, { type: 'array' })
  const blocks = []

  ;(workbook.SheetNames || []).forEach((name) => {
    const sheet = workbook.Sheets?.[name]
    if (!sheet) return
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false })
    const trimmed = String(csv || '').trim()
    if (!trimmed) return
    blocks.push(`[Sheet: ${name}]\n${trimmed}`)
  })

  return blocks.join('\n\n').trim()
}

export async function parsePptxToText(arrayBuffer) {
  // PPTX 是 zip + XML，直接抓 slide 文本节点比尝试还原整页布局更稳。
  const jszipMod = await import('jszip')
  const JSZip = jszipMod?.default || jszipMod
  const zip = await JSZip.loadAsync(arrayBuffer)
  const slideNames = Object.keys(zip.files || {})
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const na = Number((a.match(/slide(\d+)\.xml$/) || [])[1] || 0)
      const nb = Number((b.match(/slide(\d+)\.xml$/) || [])[1] || 0)
      return na - nb
    })

  const blocks = []
  for (const name of slideNames) {
    const slideXml = await zip.file(name)?.async('string')
    if (!slideXml) continue
    const texts = []
    const regex = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g
    let match
    while ((match = regex.exec(slideXml)) !== null) {
      const value = decodeXmlEntities(match[1]).trim()
      if (value) texts.push(value)
    }
    const joined = texts.join(' ')
    const index = Number((name.match(/slide(\d+)\.xml$/) || [])[1] || 0)
    if (joined.trim()) blocks.push(`[Slide ${index || blocks.length + 1}]\n${joined}`)
  }

  return blocks.join('\n\n').trim()
}

export async function parseAttachmentText(ext, arrayBuffer) {
  // 先按扩展名分派到对应解析器，未知类型则直接报错给上层做降级处理。
  if (ext === 'pdf') return await parsePdfToText(arrayBuffer)
  if (ext === 'docx') return await parseDocxToText(arrayBuffer)
  if (ext === 'xlsx' || ext === 'xls') return await parseXlsxToText(arrayBuffer)
  if (ext === 'pptx') return await parsePptxToText(arrayBuffer)
  throw new Error(`Unsupported attachment type: ${ext || 'unknown'}`)
}
