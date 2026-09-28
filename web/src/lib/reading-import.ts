import { unzipSync } from 'fflate'
import type { ReadingFormat } from '@shared/types'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

export interface ImportedReadingDocument {
  title: string
  format: ReadingFormat
  content: string
}

const TEXT_LIMIT = 2_000_000

function titleFromFile(file: File): string {
  const title = file.name.replace(/\.(?:txt|pdf|epub)$/i, '').trim()
  return title === '' ? '未命名的书' : title.slice(0, 120)
}

function normalizeContent(content: string, label: string): string {
  const normalized = content.replace(/\r\n?/g, '\n').replace(/\u0000/g, '').trim()
  if (normalized === '') throw new Error(`${label} 中没有可阅读的文字`)
  if (normalized.length > TEXT_LIMIT) throw new Error(`${label} 解析后超过 2,000,000 字，请先拆分文件`)
  return normalized
}

async function extractPdf(file: File): Promise<string> {
  /* 动态加载并关闭 worker：正文只在浏览器本机提取，不把 PDF 上传到服务端。 */
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  const document = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
  const pages: string[] = []
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber)
    const text = await page.getTextContent()
    const pageText = text.items
      .map((item) => 'str' in item && typeof item.str === 'string' ? item.str : '')
      .filter((item) => item.trim() !== '')
      .join(' ')
      .trim()
    if (pageText !== '') pages.push(pageText)
  }
  return pages.join('\n\n')
}

function decodeUtf8(data: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(data)
}

function extractHtmlText(source: string): string {
  const document = new DOMParser().parseFromString(source, 'text/html')
  document.querySelectorAll('script,style,noscript,svg').forEach((node) => node.remove())
  const blocks = Array.from(document.body.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,blockquote,pre'))
    .map((node) => (node.textContent ?? '').replace(/\s+/g, ' ').trim())
    .filter((text) => text !== '')
  return blocks.length > 0 ? blocks.join('\n') : (document.body.textContent ?? '')
}

function archivePath(base: string, relative: string): string {
  const decoded = decodeURIComponent(relative.split('#')[0] ?? '')
  const parts = `${base}/${decoded}`.split('/').filter((part) => part !== '' && part !== '.')
  const resolved: string[] = []
  for (const part of parts) {
    if (part === '..') resolved.pop()
    else resolved.push(part)
  }
  return resolved.join('/')
}

async function extractEpub(file: File): Promise<string> {
  const archive = unzipSync(new Uint8Array(await file.arrayBuffer()))
  const entries = Object.keys(archive)
    .filter((name) => /\.(?:xhtml|html?|htm)$/i.test(name) && !/(?:^|\/)(?:nav|toc)\.(?:xhtml|html?)$/i.test(name))
    .sort((left, right) => left.localeCompare(right))
  let orderedEntries = entries
  const container = archive['META-INF/container.xml']
  if (container !== undefined) {
    const containerDoc = new DOMParser().parseFromString(decodeUtf8(container), 'application/xml')
    const opfPath = containerDoc.querySelector('rootfile')?.getAttribute('full-path')
    if (opfPath !== null && opfPath !== undefined && opfPath !== '') {
      const opf = archive[opfPath]
      if (opf !== undefined) {
        const opfDoc = new DOMParser().parseFromString(decodeUtf8(opf), 'application/xml')
        const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : ''
        const manifest = new Map(Array.from(opfDoc.querySelectorAll('manifest > item')).flatMap((item) => {
          const id = item.getAttribute('id')
          const href = item.getAttribute('href')
          return id !== null && href !== null ? [[id, archivePath(base, href)] as const] : []
        }))
        const spineEntries = Array.from(opfDoc.querySelectorAll('spine > itemref'))
          .map((item) => item.getAttribute('idref'))
          .filter((id): id is string => id !== null)
          .map((id) => manifest.get(id))
          .filter((path): path is string => path !== undefined && entries.includes(path))
        if (spineEntries.length > 0) orderedEntries = spineEntries
      }
    }
  }
  const chapters = orderedEntries.map((name) => extractHtmlText(decodeUtf8(archive[name] ?? new Uint8Array()))).filter((text) => text.trim() !== '')
  return chapters.join('\n\n')
}

export async function importReadingDocument(file: File): Promise<ImportedReadingDocument> {
  const lowerName = file.name.toLocaleLowerCase()
  if (lowerName.endsWith('.txt') || file.type === 'text/plain') {
    return { title: titleFromFile(file), format: 'txt', content: normalizeContent(await file.text(), 'TXT 文件') }
  }
  if (lowerName.endsWith('.pdf') || file.type === 'application/pdf') {
    return { title: titleFromFile(file), format: 'pdf', content: normalizeContent(await extractPdf(file), 'PDF 文件') }
  }
  if (lowerName.endsWith('.epub') || file.type === 'application/epub+zip') {
    return { title: titleFromFile(file), format: 'epub', content: normalizeContent(await extractEpub(file), 'EPUB 文件') }
  }
  throw new Error('只支持 TXT、PDF 或 EPUB 文件')
}
