/**
 * 消息块渲染（§6.2 可扩展块模型：**渲染器按 kind 分发**）
 *
 * 为什么要分成一层「分发」而不是写死 `<span>{text}</span>`：§5.5 的扩展玩法
 * （图片、语音、工具结果、小部件）都要往这条消息里塞，写死意味着每加一种就得改一遍气泡组件。
 * 这里的形状是「气泡负责排版（左右/颜色/圆角），块只负责内容自己长什么样」。
 *
 * 三条约定：
 * 1. `blocks` 按 `order` 升序渲染 —— 消息体内可能有多块（先文字后图片这种）。
 * 2. **渲染不了的块降级成占位，绝不让整页崩掉**。IndexedDB 不校验结构，
 *    旧版本读写新版本写入的数据是常态；运行时遇到不认识的 kind 必须当数据而不是当异常处理。
 * 3. 未启用的 kind（html / widget / tab-group）也要显式列出并说明原因，
 *    否则下一个人会以为「忘了写」而不是「刻意没做」。
 */
import type {
  AudioBlock,
  FileBlock,
  HtmlBlock,
  ImageBlock,
  LeafMessageBlock,
  MessageBlock,
  TabGroupBlock,
  TextBlock,
  ToolResultBlock,
  WidgetBlock,
  StickerBlock,
} from '@shared/types'
import { useState } from 'react'
import { IconAlert, IconCheck, IconFile } from '../../components/qixi/Icons'
import { formatDuration } from '../../lib/format'
import { EventConfirmCard } from './EventConfirmCard'

/** 已知的块类型（与 `MessageBlock` 联合一一对应；用于拦下「新版本写进来的块」） */
const KNOWN_KINDS: ReadonlySet<string> = new Set<MessageBlock['kind']>([
  'text',
  'html',
  'image',
  'audio',
  'file',
  'sticker',
  'tool-result',
  'widget',
  'tab-group',
])

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function TextBlockView({ payload }: { payload: TextBlock['payload'] }) {
  return <span className="whitespace-pre-wrap break-words">{payload.text}</span>
}

function ImageBlockView({ payload }: { payload: ImageBlock['payload'] }) {
  return (
    <img
      src={payload.url}
      alt={payload.alt ?? ''}
      loading="lazy"
      className="max-h-72 max-w-full rounded-lg object-contain"
      style={{ border: '1px solid var(--border-soft)' }}
    />
  )
}

function AudioBlockView({ payload }: { payload: AudioBlock['payload'] }) {
  return (
    <span className="flex flex-col gap-1">
      <span className="flex items-center gap-2">
        {/*
          ⚠️ 播放器给**固定宽度**，别写 `w-full`。
          气泡是 `max-width: 76%` 的收缩宽度块（设计 §11.2；换装前是 82%），
          而外层 `MessageBlocks` 与这里都是 `items-start` 的伸缩列 ——
          这种上下文里父宽由内容决定，`width: 100%` 解出来是个极小值，
          播放器会被压成一条窄条（截图上看就是气泡里一个 40px 的小方块）。
          百分比在「尺寸待定」的容器里本来就不可靠，这里用固定值最省事。
        */}
        <audio controls src={payload.url} style={{ width: '14rem' }} />
        {payload.durationMs !== undefined && (
          // ⚠️ 用 `opacity` 而不是 `color: var(--text-secondary)`：
          // 块视图现在**两侧气泡都在用**，用户气泡是深色底 + 反白字，
          // 硬编码的「次要文字色」在深底上等于看不见。继承当前文字色 + 降透明度两边都成立
          <span data-testid="audio-duration" className="shrink-0 text-xs opacity-75">
            {formatDuration(payload.durationMs)}
          </span>
        )}
      </span>
      {payload.transcript !== undefined && (
        <span className="text-xs opacity-70">{payload.transcript}</span>
      )}
    </span>
  )
}

function FileBlockView({ payload }: { payload: FileBlock['payload'] }) {
  return (
    <a
      href={payload.url}
      download={payload.name}
      className="flex w-full max-w-xs items-center gap-2 rounded-lg border px-2 py-1.5 text-xs no-underline"
      style={{ borderColor: 'var(--border-soft)', color: 'inherit' }}
    >
      <span className="shrink-0" style={{ color: 'var(--text-secondary)' }}>
        <IconFile size={15} />
      </span>
      <span className="min-w-0 flex-1 truncate">{payload.name}</span>
      {payload.size !== undefined && (
        <span className="shrink-0 opacity-60">{formatBytes(payload.size)}</span>
      )}
    </a>
  )
}

function StickerBlockView({ payload }: { payload: StickerBlock['payload'] }) {
  return (
    <figure className="m-0 flex max-w-[12rem] flex-col items-start gap-1">
      <img
        src={payload.imageDataUrl}
        alt={payload.name}
        loading="lazy"
        className="max-h-44 max-w-full rounded-xl object-contain"
        style={{ border: '1px solid var(--border-soft)' }}
      />
      <figcaption className="text-xs opacity-70">{payload.name}</figcaption>
    </figure>
  )
}

/** 工具结果是「细节可查的次要信息」：默认折叠，展开才给原文 */
function ToolResultBlockView({ payload }: { payload: ToolResultBlock['payload'] }) {
  // `confirm` 级工具的挂起（Phase 6.5 P1）：这不是「结果」，而是一件**等着北北点按钮**的事 ——
  // 所以走确认卡，而不是折叠起来的结果条。折叠会把唯一需要行动的东西藏进一个要展开的框里。
  if (payload.eventId !== undefined) {
    return <EventConfirmCard eventId={payload.eventId} fallbackTitle={payload.summary ?? '小栖在等你确认一件事'} />
  }
  let detail = ''
  if (payload.result !== undefined) {
    // 字符串已经是给用户读的文本（服务端裁剪过），直接显示 ——
    // 再走一遍 JSON.stringify 会把它包成带引号的 `"……"`，纯属自找难看
    if (typeof payload.result === 'string') detail = payload.result
    else {
      try {
        detail = JSON.stringify(payload.result, null, 2) ?? String(payload.result)
      } catch {
        // 结构里若有循环引用，JSON.stringify 会抛；退化成可读字符串而不是让渲染失败
        detail = String(payload.result)
      }
    }
  }
  // 优先显示「来源 · 动作」（如 Nocturne · 搜索记忆）；没有元数据时退回内部工具名
  const title =
    payload.source !== undefined && payload.label !== undefined
      ? `${payload.source} · ${payload.label}`
      : `工具 ${payload.toolName}`
  return (
    <details
      className="w-full rounded-lg border px-2 py-1.5 text-xs"
      style={{ borderColor: 'var(--border-soft)' }}
    >
      <summary className="flex cursor-pointer select-none items-center gap-1">
        {payload.ok ? (
          <IconCheck size={14} style={{ color: 'var(--accent-strong)' }} />
        ) : (
          <IconAlert size={14} style={{ color: 'var(--danger)' }} />
        )}
        <span>{title}</span>
        <span className="opacity-70">{payload.ok ? '已完成' : '未完成'}</span>
        {payload.summary !== undefined && <span className="opacity-70">· {payload.summary}</span>}
        {payload.occurredAt !== undefined && (
          <time className="opacity-50" dateTime={new Date(payload.occurredAt).toISOString()}>
            · {new Date(payload.occurredAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </time>
        )}
      </summary>
      {detail !== '' && (
        <pre
          className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all"
          style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
        >
          {detail}
        </pre>
      )}
    </details>
  )
}

function HtmlBlockView({ payload }: { payload: HtmlBlock['payload'] }) {
  const srcDoc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; form-action 'none'; base-uri 'none'"><style>html{color-scheme:light dark}body{margin:8px;font:14px/1.5 system-ui;overflow-wrap:anywhere}</style></head><body>${payload.html}</body></html>`
  return (
    <iframe
      title="富内容预览"
      sandbox=""
      srcDoc={srcDoc}
      className="h-48 w-full min-w-[16rem] rounded-lg border bg-white"
      style={{ borderColor: 'var(--border-soft)' }}
    />
  )
}

function WidgetBlockView({ payload }: { payload: WidgetBlock['payload'] }) {
  return (
    <span className="flex min-w-[12rem] flex-col rounded-lg border px-3 py-2" style={{ borderColor: 'var(--border-soft)' }}>
      <strong>{payload.title?.trim() || '小组件'}</strong>
      {payload.source !== undefined && <span className="mt-1 text-xs opacity-65">来源：{payload.source}</span>}
    </span>
  )
}

function LeafBlockView({ block }: { block: LeafMessageBlock }) {
  switch (block.kind) {
    case 'text': return <TextBlockView payload={block.payload} />
    case 'html': return <HtmlBlockView payload={block.payload} />
    case 'image': return <ImageBlockView payload={block.payload} />
    case 'audio': return <AudioBlockView payload={block.payload} />
    case 'file': return <FileBlockView payload={block.payload} />
    case 'tool-result': return <ToolResultBlockView payload={block.payload} />
    case 'widget': return <WidgetBlockView payload={block.payload} />
  }
}

function TabGroupBlockView({ payload }: { payload: TabGroupBlock['payload'] }) {
  const [selected, setSelected] = useState(0)
  const tab = payload.tabs[selected]
  if (tab === undefined) return <PlaceholderBlockView label="tab-group" reason="没有可显示的标签页" />
  return (
    <span className="flex w-full min-w-[16rem] flex-col rounded-lg border" style={{ borderColor: 'var(--border-soft)' }}>
      <span className="flex gap-1 overflow-x-auto border-b p-1" style={{ borderColor: 'var(--border-soft)' }}>
        {payload.tabs.map((item, index) => (
          <button key={`${item.label}:${index}`} type="button" onClick={() => setSelected(index)} className="rounded px-2 py-1 text-xs" style={{ backgroundColor: index === selected ? 'var(--bg-subtle)' : 'transparent' }}>
            {item.label || `标签 ${index + 1}`}
          </button>
        ))}
      </span>
      <span className="flex flex-col items-start gap-2 p-2">
        {[...tab.blocks].sort((a, b) => a.order - b.order).map((block, index) => (
          <LeafBlockView key={`${block.kind}:${block.order}:${index}`} block={block} />
        ))}
      </span>
    </span>
  )
}

/** 渲染不了 / 未启用的块：显示「是什么 + 为什么没渲染」，而不是空白 */
function PlaceholderBlockView({ label, reason }: { label: string; reason: string }) {
  return (
    <span
      className="block rounded-lg border border-dashed px-2 py-1.5 text-xs"
      style={{ borderColor: 'var(--border-soft)', color: 'var(--text-secondary)' }}
    >
      [{label}] {reason}
    </span>
  )
}

function MessageBlockView({ block }: { block: MessageBlock }) {
  // 运行时兜底：数据可能来自「写了新块类型」的版本，此时 block.kind 不在联合里。
  // 先于 switch 拦住它，保证渲染路径不会因为未知数据抛异常。
  if (!KNOWN_KINDS.has((block as { kind: string }).kind)) {
    return <PlaceholderBlockView label={String((block as { kind: string }).kind)} reason="暂不支持渲染" />
  }

  switch (block.kind) {
    case 'text':
      return <TextBlockView payload={block.payload} />
    case 'image':
      return <ImageBlockView payload={block.payload} />
    case 'audio':
      return <AudioBlockView payload={block.payload} />
    case 'file':
      return <FileBlockView payload={block.payload} />
    case 'sticker':
      return <StickerBlockView payload={block.payload} />
    case 'tool-result':
      return <ToolResultBlockView payload={block.payload} />
    case 'html':
      return <HtmlBlockView payload={block.payload} />
    case 'widget':
      return <WidgetBlockView payload={block.payload} />
    case 'tab-group':
      return <TabGroupBlockView payload={block.payload} />
  }
}

export function MessageBlocks({ blocks }: { blocks: MessageBlock[] }) {
  const ordered = [...blocks].sort((a, b) => a.order - b.order)
  return (
    <span className="flex flex-col items-start gap-2">
      {ordered.map((block, index) => (
        <MessageBlockView key={`${block.kind}:${String(block.order)}:${String(index)}`} block={block} />
      ))}
    </span>
  )
}
