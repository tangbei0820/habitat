/**
 * 聊天气泡（SPEC §2.3 消息对象操作）
 *
 * 单独成文件的原因：气泡承载的东西已经远超「画个框」—— 长按 / 右键进菜单、内联编辑、
 * 撤回痕迹、多选勾选、版本导航、快捷操作行。留在页面里会让那个文件同时管数据流与交互细节，
 * 谁也改不动。页面只负责「给什么数据、操作落到哪」，气泡只管「长什么样、什么时候回调」。
 */
import {
  useCallback,
  useEffect,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import type { BubbleMode, ChatMessage } from '@shared/types'
import { IconCheck } from '../../components/qixi/Icons'
import { MessageAvatar } from './MessageAvatar'
import { MessageBlocks } from './MessageBlocks'

/** 长按判定时长：短了会和「点一下」打架，长了会让人觉得没反应 */
const LONG_PRESS_MS = 450
/** 长按取消的位移阈值：手指抖一下不算滑动，真滑了（列表在滚）必须取消 */
const PRESS_MOVE_TOLERANCE = 10

export interface ChatItem {
  message: ChatMessage
  text: string
  isLast: boolean
}

export function itemKey(item: ChatItem): string {
  return item.message.id
}

/** 撤回痕迹只显示到分钟：秒级精度对「曾存在过」这件事没有信息量 */
function clock(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export interface BubbleActions {
  busy: boolean
  selectMode: boolean
  editDraft: string
  onReroll: (id: string) => void
  onResend: (id: string) => void
  onSelectVersion: (id: string, index: number) => void
  onOpenMenu: (id: string) => void
  onToggleSelect: (id: string) => void
  onEditDraftChange: (text: string) => void
  onEditSave: (id: string) => void
  onEditCancel: () => void
}

/** 气泡下方的小字操作钮 */
function TinyButton({
  children,
  onClick,
  disabled = false,
  testId,
}: {
  children: ReactNode
  onClick: () => void
  disabled?: boolean
  testId?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className="px-0.5 disabled:opacity-30"
    >
      {children}
    </button>
  )
}

export function ChatBubble({
  item,
  actions,
  selected,
  editing,
  bubbleMode,
  showAvatars,
}: {
  item: ChatItem
  actions: BubbleActions
  /** 是否处于多选勾选态 */
  selected: boolean
  /** 是否正在内联编辑这一条 */
  editing: boolean
  bubbleMode: BubbleMode
  /** 是否显示两侧头像 —— **全局显示偏好**（SPEC §9.1.3），不随会话变，所以由上层读 store 传进来 */
  showAvatars: boolean
}) {
  const { message, text } = item
  const isUser = message.role === 'user'
  const isRecalled = message.recalledAt !== null
  const isStreaming = message.status === 'streaming' || message.status === 'pending'
  const interrupted = message.status === 'aborted' || message.status === 'error'
  const versionCount = message.candidates.length
  /** 当前展示的是第几个版本（`‹ n/N ›` 的下标）；与多选的 `selected` 是两回事，别混 */
  const selectedVersion = message.candidates.findIndex((candidate) => candidate.selected)
  const edited = message.editedAt !== null

  // 「换一个」只给最后一条 AI 回复：改中间那条，后面已经发生的对话就与它脱节了
  const canReroll = !isUser && item.isLast && text !== '' && !actions.busy && !isStreaming && !isRecalled
  // 「重发」出现在「最后一条是用户消息」时 —— 意味着这一轮压根没拿到回复（失败 / 停在首字之前）
  const canResend = isUser && item.isLast && !actions.busy && !isRecalled

  /**
   * 操作行何时出现：SPEC §2.3 要求双方消息都拥有对象级操作能力。
   * 末条与有多版本的消息把 `···` 直接摆出来（桌面端也要点得到），
   * 中间的普通消息则靠**长按**（移动端）或**右键**（桌面）进入同一个菜单 —— 见下面的指针处理。
   * 刻意**不给每条消息都挂一行**：60 条消息各加一行会把列表撑高一截，视觉上也吵。
   */
  const showActions =
    !isStreaming &&
    !actions.busy &&
    (isRecalled || versionCount > 1 || canReroll || canResend || item.isLast)

  /* ---------- 长按 / 右键 打开同一个菜单 ---------- */
  const pressRef = useRef<{ timer: number; x: number; y: number } | null>(null)

  const cancelPress = useCallback((): void => {
    if (pressRef.current !== null) {
      window.clearTimeout(pressRef.current.timer)
      pressRef.current = null
    }
  }, [])

  // 卸载时清掉未触发的计时器，避免菜单在组件已消失之后才弹出来
  useEffect(() => cancelPress, [cancelPress])

  function openMenu(): void {
    cancelPress()
    actions.onOpenMenu(message.id)
  }

  function startPress(e: ReactPointerEvent<HTMLDivElement>): void {
    // 多选态下点气泡是「勾选」，编辑态整块都是输入区 —— 都不该再弹菜单
    if (actions.selectMode || editing) return
    cancelPress()
    const { clientX: x, clientY: y } = e
    pressRef.current = {
      x,
      y,
      timer: window.setTimeout(() => {
        pressRef.current = null
        actions.onOpenMenu(message.id)
      }, LONG_PRESS_MS),
    }
  }

  function movePress(e: ReactPointerEvent<HTMLDivElement>): void {
    const press = pressRef.current
    if (press === null) return
    if (
      Math.abs(e.clientX - press.x) > PRESS_MOVE_TOLERANCE ||
      Math.abs(e.clientY - press.y) > PRESS_MOVE_TOLERANCE
    ) {
      cancelPress()
    }
  }

  function onContextMenu(e: ReactMouseEvent<HTMLDivElement>): void {
    e.preventDefault()
    openMenu()
  }

  function onBubbleClick(): void {
    if (actions.selectMode) actions.onToggleSelect(message.id)
  }

  const nativeAssistant = bubbleMode === 'native' && !isUser && !isRecalled
  const bubbleStyle = isRecalled
    ? {
        backgroundColor: 'transparent',
        color: 'var(--color-text-dim)',
        border: '1px dashed var(--color-border)',
      }
    : {
        backgroundColor: isUser ? 'var(--color-primary)' : nativeAssistant ? 'transparent' : 'var(--color-surface)',
        color: isUser ? 'var(--color-primary-contrast)' : 'var(--color-text)',
        border: isUser || nativeAssistant ? 'none' : '1px solid var(--color-border)',
      }

  return (
    <div
      className="flex flex-col px-4 py-1.5"
      data-message-id={message.id}
      data-selected={actions.selectMode ? String(selected) : undefined}
    >
      <div className="flex w-full items-start gap-2">
        {actions.selectMode && (
          <span
            aria-hidden
            data-testid={`select-mark-${message.id}`}
            className="mt-2 flex h-4 w-4 shrink-0 items-center justify-center rounded text-[10px]"
            style={{
              border: '1px solid var(--color-border)',
              backgroundColor: selected ? 'var(--color-primary)' : 'transparent',
              color: 'var(--color-primary-contrast)',
            }}
          >
            {selected ? <IconCheck size={11} /> : null}
          </span>
        )}
        {/*
          头像放在气泡的**外侧**（用户侧在右、小栖侧在左），与主流聊天 App 一致：
          放内侧会把气泡挤离屏幕边缘，整列看起来像塌了。
          `MessageAvatar` 对 tool / system 消息返回 null，所以两处都写也不会多出空占位。
        */}
        {showAvatars && !isUser && <MessageAvatar role={message.role} />}
        <div className={`flex min-w-0 flex-1 ${isUser ? 'justify-end' : 'justify-start'}`}>
          <div
            data-bubble-mode={bubbleMode}
            className={`break-words rounded-2xl px-3 py-2 text-sm ${editing ? 'w-full' : nativeAssistant ? 'max-w-full' : 'max-w-[82%]'}`}
            style={bubbleStyle}
            onPointerDown={startPress}
            onPointerMove={movePress}
            onPointerUp={cancelPress}
            onPointerCancel={cancelPress}
            onPointerLeave={cancelPress}
            onContextMenu={onContextMenu}
            onClick={onBubbleClick}
          >
            {editing ? (
              <div className="flex w-full flex-col gap-2" data-testid="edit-box">
                <textarea
                  data-testid="edit-textarea"
                  value={actions.editDraft}
                  onChange={(e) => actions.onEditDraftChange(e.target.value)}
                  rows={Math.min(8, Math.max(2, actions.editDraft.split('\n').length))}
                  className="w-full resize-none rounded-lg border px-2 py-1.5 text-sm outline-none"
                  style={{
                    borderColor: 'var(--color-border)',
                    backgroundColor: 'var(--color-bg)',
                    color: 'var(--color-text)',
                  }}
                />
                <div className="flex justify-end gap-2 text-xs">
                  <button
                    type="button"
                    data-testid="edit-save"
                    onClick={() => actions.onEditSave(message.id)}
                    className="rounded px-2 py-1"
                    style={{
                      backgroundColor: 'var(--color-primary)',
                      color: 'var(--color-primary-contrast)',
                    }}
                  >
                    保存
                  </button>
                  <button
                    type="button"
                    data-testid="edit-cancel"
                    onClick={actions.onEditCancel}
                    className="rounded px-2 py-1"
                    style={{
                      backgroundColor: 'var(--color-surface-alt)',
                      color: 'var(--color-text)',
                    }}
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : isRecalled ? (
              <span data-testid="recalled" className="text-xs italic">
                {isUser ? '你撤回了一条消息' : '小栖撤回了一条消息'}
                {message.recalledAt !== null && ` · ${clock(message.recalledAt)}`}
              </span>
            ) : (
              <>
                {/*
                  两侧**都走块分发**（§6.2）。
                  原先用户侧是 `<span>{messageText(message)}</span>` —— 那等于「用户只能发纯文本」这条
                  假设被写死在渲染里：语音条（`audio` 块）与图片会被画成**空气泡**，
                  数据明明在库里、上下文里也有占位描述，界面上却什么都没显示。
                  `TextBlockView` 本身就是 `whitespace-pre-wrap break-words`，
                  比原来的 `whitespace-pre-wrap` 只多一个断词，所以这不是「能力补齐」，是**把分叉去掉**。
                */}
                <MessageBlocks blocks={message.blocks} />
                {isStreaming && (
                  <span className="ml-0.5 animate-pulse" style={{ opacity: 0.7 }}>
                    {text === '' ? '…' : '▍'}
                  </span>
                )}
                {interrupted && (
                  <span className="ml-1 text-xs opacity-60">
                    {message.status === 'aborted' ? '（已停止）' : '（中断）'}
                  </span>
                )}
              </>
            )}
          </div>
        </div>
        {showAvatars && isUser && <MessageAvatar role={message.role} />}
      </div>

      {showActions && (
        <div
          className={`mt-0.5 flex items-center gap-2 text-xs ${isUser ? 'pr-1' : 'pl-1'}`}
          style={{
            color: 'var(--color-text-dim)',
            justifyContent: isUser ? 'flex-end' : 'flex-start',
          }}
        >
          {versionCount > 1 && (
            <span className="flex items-center gap-1">
              <TinyButton
                disabled={selectedVersion <= 0 || actions.busy}
                onClick={() => actions.onSelectVersion(message.id, selectedVersion - 1)}
              >
                ‹
              </TinyButton>
              <span>
                {selectedVersion + 1}/{versionCount}
              </span>
              <TinyButton
                disabled={selectedVersion >= versionCount - 1 || actions.busy}
                onClick={() => actions.onSelectVersion(message.id, selectedVersion + 1)}
              >
                ›
              </TinyButton>
            </span>
          )}
          {edited && (
            <span data-testid="edited-mark">
              {item.isLast ? '已编辑' : '已编辑 · 其后回复基于旧内容'}
            </span>
          )}
          {canReroll && <TinyButton onClick={() => actions.onReroll(message.id)}>换一个</TinyButton>}
          {canResend && <TinyButton onClick={() => actions.onResend(message.id)}>重发</TinyButton>}
          <TinyButton onClick={() => actions.onOpenMenu(message.id)} testId={`more-${message.id}`}>
            ···
          </TinyButton>
        </div>
      )}
    </div>
  )
}
