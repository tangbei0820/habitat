/**
 * 单会话导出（技术方案 §9 风险7「本地数据损坏/丢失」的数据主权侧对策）。
 *
 * 刻意做成两种形态，各有各的用处，不合并成一种：
 * - **Markdown** —— 给人看、能带走、能贴进别处。图片/语音只写说明，**不写 data URL**
 *   （内联图片是 base64，一份几十条消息的文档能膨胀到几百 MB，那样「能带走」就成了空话）。
 * - **JSON** —— 结构与全量备份同构（`sessions` / `messages` 两栏），日后要支持
 *   「导入单个会话」时可以直接接上，而不必再发明一套格式。
 */
import type { ChatMessage, ChatSession, MessageBlock } from '@shared/types'
import { getSession, listMessages } from '../db/chat'

/** 单会话导出的 JSON 形状；刻意与全量备份的字段名保持一致 */
export interface SessionExport {
  format: 'habitat-session'
  version: 1
  exportedAt: number
  session: ChatSession
  messages: ChatMessage[]
}

/** 本地时间戳 → `2026-09-24 11:30`（导出文档里的时间要人一眼能读，不能用 ISO 串） */
function stamp(ms: number): string {
  const date = new Date(ms)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** Markdown 里要挡住 `#` `*` 这类字符把文档结构顶坏 */
function escapeInline(text: string): string {
  return text.replace(/([\\`*_[\]()#])/g, '\\$1')
}

function renderBlock(block: MessageBlock): string {
  switch (block.kind) {
    case 'text':
      return block.payload.text.trim()
    case 'image':
      return `（图片${block.payload.alt === undefined || block.payload.alt === '' ? '' : `：${block.payload.alt}`}）`
    case 'audio': {
      const seconds = Math.round((block.payload.durationMs ?? 0) / 1000)
      const transcript = block.payload.transcript
      return `（语音 ${seconds} 秒${transcript === undefined || transcript === '' ? '' : `，转写：${transcript}`}）`
    }
    case 'file':
      return `（文件：${block.payload.name}）`
    case 'sticker':
      return `（表情包：${block.payload.name}）`
    case 'html':
      return `\`\`\`html\n${block.payload.html}\n\`\`\``
    case 'tool-result':
      return `（工具调用 ${block.payload.toolName}：${block.payload.ok ? '成功' : '失败'}${block.payload.summary === undefined || block.payload.summary === '' ? '' : ` — ${block.payload.summary}`}）`
    case 'widget':
      return `（组件${block.payload.title === undefined || block.payload.title === '' ? '' : `：${block.payload.title}`}）`
    case 'tab-group':
      return block.payload.tabs
        .map((tab) => `**${escapeInline(tab.label)}**\n\n${tab.blocks.map(renderBlock).join('\n\n')}`)
        .join('\n\n')
  }
}

/**
 * 会话 → Markdown。
 *
 * 一条消息一个二级小节，而不是排成「A: xxx / B: xxx」的流水 —— 后者在手机上看
 * 长回复会糊成一团，看不出谁在说、什么时候说的。
 */
export function sessionMarkdown(session: ChatSession, messages: ChatMessage[]): string {
  const title = session.remark === null || session.remark === '' ? session.title : session.remark
  const lines: string[] = [
    `# ${title}`,
    '',
    `- 导出时间：${stamp(Date.now())}`,
    `- 消息条数：${messages.length}`,
    `- 会话创建：${stamp(session.createdAt)}`,
    '',
    '---',
    '',
  ]

  for (const message of messages) {
    const speaker = message.role === 'user' ? '我' : '小栖'
    lines.push(`**${speaker}** · ${stamp(message.createdAt)}`, '')
    if (message.recalledAt !== null) lines.push('（已撤回）')
    else {
      const body = message.blocks
        .slice()
        .sort((left, right) => left.order - right.order)
        .map(renderBlock)
        .filter((part) => part !== '')
        .join('\n\n')
      lines.push(body === '' ? '（无文字内容）' : body)
    }
    if (message.editedAt !== null) lines.push('', '（这条后来被编辑过）')
    lines.push('', '---', '')
  }

  return lines.join('\n')
}

/** 触发下载（与 `downloadBackup` 同一套做法：先 start 再释放 objectURL） */
function download(filename: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** 文件名里不能出现的字符统一换成 `_`，否则 Windows 上会下载失败 */
function safeName(title: string): string {
  return title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40)
}

export interface SessionExportResult {
  title: string
  messageCount: number
}

async function load(sessionId: string): Promise<{ session: ChatSession; messages: ChatMessage[] }> {
  const session = await getSession(sessionId)
  if (session === null) throw new Error('这个会话已经不在了')
  const messages = await listMessages(sessionId)
  return { session, messages }
}

function displayTitle(session: ChatSession): string {
  return session.remark === null || session.remark === '' ? session.title : session.remark
}

export async function exportSessionMarkdown(sessionId: string): Promise<SessionExportResult> {
  const { session, messages } = await load(sessionId)
  const title = displayTitle(session)
  download(`${safeName(title)}.md`, sessionMarkdown(session, messages), 'text/markdown;charset=utf-8')
  return { title, messageCount: messages.length }
}

export async function exportSessionJson(sessionId: string): Promise<SessionExportResult> {
  const { session, messages } = await load(sessionId)
  const title = displayTitle(session)
  const payload: SessionExport = { format: 'habitat-session', version: 1, exportedAt: Date.now(), session, messages }
  download(`${safeName(title)}.json`, JSON.stringify(payload, null, 2), 'application/json')
  return { title, messageCount: messages.length }
}
