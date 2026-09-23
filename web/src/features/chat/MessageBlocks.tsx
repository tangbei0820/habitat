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
  ImageBlock,
  MessageBlock,
  TextBlock,
  ToolResultBlock,
} from '@shared/types'
import { formatDuration } from '../../lib/format'

/** 已知的块类型（与 `MessageBlock` 联合一一对应；用于拦下「新版本写进来的块」） */
const KNOWN_KINDS: ReadonlySet<string> = new Set<MessageBlock['kind']>([
  'text',
  'html',
  'image',
  'audio',
  'file',
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
      style={{ border: '1px solid var(--color-border)' }}
    />
  )
}

function AudioBlockView({ payload }: { payload: AudioBlock['payload'] }) {
  return (
    <span className="flex flex-col gap-1">
      <span className="flex items-center gap-2">
        {/*
          ⚠️ 播放器给**固定宽度**，别写 `w-full`。
          气泡是 `max-w-[82%]` 的收缩宽度块，而外层 `MessageBlocks` 与这里都是 `items-start` 的伸缩列 ——
          这种上下文里父宽由内容决定，`width: 100%` 解出来是个极小值，
          播放器会被压成一条窄条（截图上看就是气泡里一个 40px 的小方块）。
          百分比在「尺寸待定」的容器里本来就不可靠，这里用固定值最省事。
        */}
        <audio controls src={payload.url} style={{ width: '14rem' }} />
        {payload.durationMs !== undefined && (
          // ⚠️ 用 `opacity` 而不是 `color: var(--color-text-dim)`：
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
      style={{ borderColor: 'var(--color-border)', color: 'inherit' }}
    >
      <span aria-hidden>📄</span>
      <span className="min-w-0 flex-1 truncate">{payload.name}</span>
      {payload.size !== undefined && (
        <span className="shrink-0 opacity-60">{formatBytes(payload.size)}</span>
      )}
    </a>
  )
}

/** 工具结果是「细节可查的次要信息」：默认折叠，展开才给原文 */
function ToolResultBlockView({ payload }: { payload: ToolResultBlock['payload'] }) {
  let detail = ''
  if (payload.result !== undefined) {
    try {
      detail = JSON.stringify(payload.result, null, 2) ?? String(payload.result)
    } catch {
      // 结构里若有循环引用，JSON.stringify 会抛；退化成可读字符串而不是让渲染失败
      detail = String(payload.result)
    }
  }
  return (
    <details
      className="w-full rounded-lg border px-2 py-1.5 text-xs"
      style={{ borderColor: 'var(--color-border)' }}
    >
      <summary className="cursor-pointer select-none">
        <span aria-hidden>{payload.ok ? '✅' : '⚠️'}</span> 工具 {payload.toolName}
        {payload.summary !== undefined && <span className="ml-1 opacity-70">{payload.summary}</span>}
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

/** 渲染不了 / 未启用的块：显示「是什么 + 为什么没渲染」，而不是空白 */
function PlaceholderBlockView({ label, reason }: { label: string; reason: string }) {
  return (
    <span
      className="block rounded-lg border border-dashed px-2 py-1.5 text-xs"
      style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-dim)' }}
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
    case 'tool-result':
      return <ToolResultBlockView payload={block.payload} />
    case 'html':
      // 刻意不渲染：LLM 产出的 HTML 需要沙箱（见 shared/types.ts 的 HtmlBlock 注释）
      return <PlaceholderBlockView label="html" reason="沙箱渲染未接入" />
    case 'widget':
      return <PlaceholderBlockView label="widget" reason="Phase 5 接入" />
    case 'tab-group':
      return <PlaceholderBlockView label="tab-group" reason="Phase 5 接入" />
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
