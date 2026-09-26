/**
 * 聊天气泡（SPEC §2.3 消息对象操作）
 *
 * 单独成文件的原因：气泡承载的东西已经远超「画个框」—— 长按 / 右键进菜单、内联编辑、
 * 撤回痕迹、多选勾选、版本导航、快捷操作行。留在页面里会让那个文件同时管数据流与交互细节，
 * 谁也改不动。页面只负责「给什么数据、操作落到哪」，气泡只管「长什么样、什么时候回调」。
 *
 * 换装（第 3 批）后结构对齐设计稿：`.msg-row(.from-ai/.from-user)` → `.msg-col`
 * → `.msg-bubble` + `.msg-actions` + `.msg-meta`。
 * ⚠️ 三处**没有**照抄设计，都在 `theme/qixi/components.css` 里写了原因：
 * 操作行必须常显（触屏没有 hover）、消息列宽度不按百分比收缩、进入动画只播一次（虚拟列表）。
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
import { identityName, useChatDisplay } from '../../app/useChatDisplay'
import { IconCheck, IconChevronLeft, IconChevronRight, IconMore } from '../../components/qixi/Icons'
import { MessageAvatar } from './MessageAvatar'
import { MessageBlocks } from './MessageBlocks'
import { ReasoningCard } from './ReasoningCard'

/** 长按判定时长：短了会和「点一下」打架，长了会让人觉得没反应 */
const LONG_PRESS_MS = 450
/** 长按取消的位移阈值：手指抖一下不算滑动，真滑了（列表在滚）必须取消 */
const PRESS_MOVE_TOLERANCE = 10

export interface ChatItem {
  message: ChatMessage
  text: string
  isLast: boolean
  /**
   * 本条之前要不要插一条「日期分隔」。
   * 由页面按相邻两条的**自然日**算出来（跨天才有），气泡自己不判断 ——
   * 虚拟列表只渲染可视窗口，气泡单独看一条无从知道前一条是哪天。
   */
  dayLabel: string | null
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
  ariaLabel,
}: {
  children: ReactNode
  onClick: () => void
  disabled?: boolean
  testId?: string
  /** 内容是图标（没有文字）时补一个可读名 —— 否则读屏里就只剩「按钮」两个字 */
  ariaLabel?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      {...(ariaLabel === undefined ? {} : { 'aria-label': ariaLabel })}
      className="px-0.5 disabled:opacity-30"
      style={{ color: 'var(--text-tertiary)' }}
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
  showCompanionAvatar,
  showUserAvatar,
}: {
  item: ChatItem
  actions: BubbleActions
  /** 是否处于多选勾选态 */
  selected: boolean
  /** 是否正在内联编辑这一条 */
  editing: boolean
  bubbleMode: BubbleMode
  /** 小栖侧头像是否显示 —— **全局显示偏好**（SPEC §9.1.3），不随会话变，由上层读 store 传进来 */
  showCompanionAvatar: boolean
  /** 用户侧头像是否显示 —— 同上，与另一侧互不牵连 */
  showUserAvatar: boolean
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
   * 只有「人」有头像。⚠️ 不能图省事写成 `role="assistant"`：
   * tool / system 消息也走这个组件，给它们画头像会让头像个数与「两条消息两个头像」对不上，
   * 验收里有两条断言是数个数和判左右顺序的，会直接挂。
   */
  const isPerson = message.role === 'user' || message.role === 'assistant'

  /**
   * 昵称显示（SPEC §9.1.3 第三个独立开关，全局偏好）：
   * 开着时在气泡上方挂一条小字称呼；默认关，气泡本身已能区分双方。
   * 撤回痕迹与称呼放一起会很吵，撤回态不显示。
   */
  const showNickname = useChatDisplay((state) => state.showNickname)
  // 订阅总是执行（hook 规则），「这条消息是不是人」在组件内判断
  const nameForRole = useChatDisplay((state) => identityName(state, isUser ? 'user' : 'companion'))
  const nickname = isPerson ? nameForRole : null

  /**
   * 思绪折叠卡（SPEC §2.3.6）：只给 AI 消息、只在确实落了 reasoning 时渲染，
   * 没有就什么壳都不出。reasoning 是「当前展示这版」的过程痕迹，跟随 metadata 走。
   */
  const reasoning =
    !isUser && typeof message.metadata?.reasoning === 'string' && message.metadata.reasoning !== ''
      ? message.metadata.reasoning
      : null

  /**
   * 操作行何时出现：SPEC §2.3 要求双方消息都拥有对象级操作能力。
   * 末条与有多版本的消息把入口直接摆出来（桌面端也要点得到），
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
  /**
   * 撤回态与原生模式仍然走**行内样式**（不是偷懒）：
   * 它们的取值要压过 `.msg-bubble` 在 CSS 里的默认背景/描边，而验收里有一条
   * 直接读 `getComputedStyle(bubble).backgroundColor` 断言「原生态是透明的」——
   * 行内优先级最高，这条才立得住。
   */
  const bubbleStyle = isRecalled
    ? { border: '1px dashed var(--border-soft)' }
    : nativeAssistant
      ? { backgroundColor: 'transparent' }
      : undefined

  const bubbleClass = [
    'msg-bubble',
    isRecalled ? 'is-recalled' : '',
    nativeAssistant ? 'is-native' : '',
    editing ? 'is-editing' : '',
  ]
    .filter((name) => name !== '')
    .join(' ')

  const selectMark = actions.selectMode ? (
    <span
      aria-hidden
      data-testid={`select-mark-${message.id}`}
      className="mt-2 flex h-4 w-4 shrink-0 items-center justify-center rounded text-[10px]"
      style={{
        border: '1px solid var(--border-soft)',
        backgroundColor: selected ? 'var(--accent-strong)' : 'transparent',
        color: 'var(--accent-on-strong)',
      }}
    >
      {selected ? <IconCheck size={11} /> : null}
    </span>
  ) : null

  const body = (
    <div className="msg-col">
      {showNickname && nickname !== null && !isRecalled && (
        <div
          className="msg-nick text-xs"
          data-testid="msg-nick"
          style={{
            color: 'var(--text-tertiary)',
            marginBottom: 2,
            ...(isUser ? { textAlign: 'right' } : {}),
          }}
        >
          {nickname}
        </div>
      )}
      <div
        data-bubble-mode={bubbleMode}
        className={bubbleClass}
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
              className="w-full resize-none rounded-lg px-2 py-1.5 text-sm outline-none"
              style={{
                border: '1px solid var(--border-soft)',
                backgroundColor: 'var(--bg-base)',
                color: 'var(--text-primary)',
              }}
            />
            <div className="flex justify-end gap-2 text-xs">
              <button
                type="button"
                data-testid="edit-save"
                onClick={() => actions.onEditSave(message.id)}
                className="rounded-full px-3 py-1"
                style={{ backgroundColor: 'var(--accent-strong)', color: 'var(--accent-on-strong)' }}
              >
                保存
              </button>
              <button
                type="button"
                data-testid="edit-cancel"
                onClick={actions.onEditCancel}
                className="rounded-full px-3 py-1"
                style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--text-primary)' }}
              >
                取消
              </button>
            </div>
          </div>
        ) : isRecalled ? (
          <span data-testid="recalled" className="text-xs italic" style={{ color: 'var(--text-tertiary)' }}>
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
            {reasoning !== null && <ReasoningCard reasoning={reasoning} />}
            <MessageBlocks blocks={message.blocks} />
            {isStreaming &&
              (text === '' ? (
                // 还没吐出一个字：给三点跳动，比一个孤零零的「…」更像「在想」
                <span className="typing-dots" data-testid="typing-dots">
                  <span />
                  <span />
                  <span />
                </span>
              ) : (
                <span className="ml-0.5 animate-pulse" style={{ opacity: 0.7 }}>
                  ▍
                </span>
              ))}
            {interrupted && (
              <span className="ml-1 text-xs" style={{ opacity: 0.6 }}>
                {message.status === 'aborted' ? '（已停止）' : '（中断）'}
              </span>
            )}
          </>
        )}
      </div>

      {showActions && (
        // ⚠️ `is-on` 不是可选的美化：设计的 `.msg-actions` 默认 `opacity: 0` 靠 hover 显现，
        //    而触屏没有 hover —— 少了这个类，手机上「换一个 / 重发 / 版本 / 更多」全都点不到。
        <div className="msg-actions is-on" data-testid={`msg-actions-${message.id}`}>
          {versionCount > 1 && (
            <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-tertiary)' }}>
              <TinyButton
                testId={`version-prev-${message.id}`}
                ariaLabel="上一个版本"
                disabled={selectedVersion <= 0 || actions.busy}
                onClick={() => actions.onSelectVersion(message.id, selectedVersion - 1)}
              >
                <IconChevronLeft size={14} />
              </TinyButton>
              <span data-testid={`version-count-${message.id}`}>
                {selectedVersion + 1}/{versionCount}
              </span>
              <TinyButton
                testId={`version-next-${message.id}`}
                ariaLabel="下一个版本"
                disabled={selectedVersion >= versionCount - 1 || actions.busy}
                onClick={() => actions.onSelectVersion(message.id, selectedVersion + 1)}
              >
                <IconChevronRight size={14} />
              </TinyButton>
            </span>
          )}
          {edited && (
            <span data-testid="edited-mark" className="text-xs">
              {item.isLast ? '已编辑' : '已编辑 · 其后回复基于旧内容'}
            </span>
          )}
          {canReroll && (
            <TinyButton testId={`reroll-${message.id}`} onClick={() => actions.onReroll(message.id)}>
              换一个
            </TinyButton>
          )}
          {canResend && (
            <TinyButton testId={`resend-${message.id}`} onClick={() => actions.onResend(message.id)}>
              重发
            </TinyButton>
          )}
          <TinyButton onClick={openMenu} testId={`more-${message.id}`} ariaLabel="更多操作">
            <span className="flex h-7 w-7 items-center justify-center">
              <IconMore size={15} />
            </span>
          </TinyButton>
        </div>
      )}

      {/* 时间：设计里就是「每条一行小字」，稀疏、最淡 */}
      {!isRecalled && (
        <div className="msg-meta">
          <span>{clock(message.createdAt)}</span>
        </div>
      )}
    </div>
  )

  return (
    <>
      {item.dayLabel !== null && <div className="day-divider">{item.dayLabel}</div>}
      <div
        className={`msg-row ${isUser ? 'from-user' : 'from-ai'}`}
        data-message-id={message.id}
        data-status={message.status}
        data-selected={actions.selectMode ? String(selected) : undefined}
      >
        {isUser ? (
          <>
            {/* DOM 顺序 = 语义顺序：头像在气泡**外侧**（用户侧在右、即气泡之后）。
                别学原型用 row-reverse 翻转 —— 那会让「DOM 靠前」和「视觉靠右」打架，
                验收按 DOM 顺序断言头像在气泡外侧，翻转就全反了。 */}
            {selectMark}
            {body}
            {showUserAvatar && isPerson && <MessageAvatar role={message.role} />}
          </>
        ) : (
          <>
            {selectMark}
            {showCompanionAvatar && isPerson && <MessageAvatar role={message.role} />}
            {body}
          </>
        )}
      </div>
    </>
  )
}
