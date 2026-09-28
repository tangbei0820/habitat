/**
 * 会话列表（SPEC §2.1）
 *
 * 三件要同时成立的事：
 * 1. **置顶优先于分组**（SPEC §2.1.2 定）—— 置顶会话统一浮到最上方、脱离原分组显示，
 *    取消置顶后按 `groupId` 回落到它原本的分区（归属字段不因置顶而改写，所以是「显示上的浮动」而非「搬走」）。
 * 2. **未分组区是兜底**（SPEC §2.1.3）—— 任何 `groupId` 为空**或指向已不存在分组**的会话都落在这里。
 *    后者是防御性的：写入侧已经校验目标分组存在，但导入的备份 / 手工改过的库不受我们控制，
 *    宁可让它显示在未分组，也不能让它从列表里凭空消失。
 * 3. **不用分组的人不该看到分组的痕迹** —— 一个分组都没有时不渲染任何分区标题，保持原来的平铺列表。
 *
 * 行内操作（置顶 / 移入移出分组 / 删除）统一收进「⋯」菜单：
 * 会话本身就带标题，行内再并排三个按钮，长标题会被挤成省略号。
 */
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { ChatSession, SessionGroup } from '@shared/types'
import { ActionSheet, type SheetAction } from '../../components/ActionSheet'
import { NameSheet } from '../../components/NameSheet'
import { IconChevronDown, IconChevronRight, IconJournal, IconMore, IconPin, IconPlus, IconSearch } from '../../components/qixi/Icons'
import { ChatHistoryPanel } from '../../features/chat/ChatHistoryPanel'
import {
  SESSION_GROUP_NAME_MAX,
  createSession,
  createSessionGroup,
  deleteSession,
  deleteSessionGroup,
  listSessionGroups,
  listSessions,
  renameSessionGroup,
  reorderSessionGroups,
  setSessionGroup,
  setSessionGroupCollapsed,
  setSessionPinned,
} from '../../db/chat'
import { log } from '../../lib/log'

/** 当前打开的是哪个弹出层（会话行菜单 / 分组菜单 / 移入分组的选组菜单） */
type SheetTarget =
  | { kind: 'session'; id: string }
  | { kind: 'group'; id: string }
  | { kind: 'move'; id: string }

type NameSheetState =
  | { mode: 'create'; /** 从「移入分组 → 新建分组」进来时，建完直接把这条会话放进去 */ moveSessionId?: string }
  | { mode: 'rename'; groupId: string; initialName: string }

/** 二次确认的自动退回时间：确认态不该在列表里长期挂着 */
const CONFIRM_MS = 3000
const TOAST_MS = 2500

export function ChatListPage() {
  const navigate = useNavigate()
  const [sessions, setSessions] = useState<ChatSession[] | null>(null)
  const [groups, setGroups] = useState<SessionGroup[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** 两步删除：先进入「待确认」，再点一次才真正删（误触拦得住，不用原生弹窗） */
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [confirmingGroupId, setConfirmingGroupId] = useState<string | null>(null)
  const [sheet, setSheet] = useState<SheetTarget | null>(null)
  const [nameSheet, setNameSheet] = useState<NameSheetState | null>(null)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const confirmTimerRef = useRef<number | null>(null)
  const groupConfirmTimerRef = useRef<number | null>(null)
  const toastTimerRef = useRef<number | null>(null)

  useEffect(() => {
    // 只在挂载时拉一次：之后所有变更都由操作本身触发 `reload()`，避免「列表自己刷自己」造成的竞态
    void reload().catch((err: unknown) => {
      log.error('读取会话列表失败', err)
      setError(err instanceof Error ? err.message : String(err))
    })
  }, [])

  useEffect(
    () => () => {
      for (const ref of [confirmTimerRef, groupConfirmTimerRef, toastTimerRef]) {
        if (ref.current !== null) window.clearTimeout(ref.current)
      }
    },
    [],
  )

  async function reload(): Promise<void> {
    const [nextSessions, nextGroups] = await Promise.all([listSessions(), listSessionGroups()])
    setSessions(nextSessions)
    setGroups(nextGroups)
  }

  function fail(err: unknown, message: string): void {
    log.error(message, err)
    setError(err instanceof Error ? err.message : String(err))
  }

  function showToast(message: string): void {
    setToast(message)
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current)
    toastTimerRef.current = window.setTimeout(() => setToast(null), TOAST_MS)
  }

  function askRemoveSession(id: string): void {
    if (confirmTimerRef.current !== null) window.clearTimeout(confirmTimerRef.current)
    setConfirmingId(id)
    confirmTimerRef.current = window.setTimeout(() => setConfirmingId(null), CONFIRM_MS)
  }

  function askRemoveGroup(id: string): void {
    if (groupConfirmTimerRef.current !== null) window.clearTimeout(groupConfirmTimerRef.current)
    setConfirmingGroupId(id)
    groupConfirmTimerRef.current = window.setTimeout(() => setConfirmingGroupId(null), CONFIRM_MS)
  }

  async function startSession(): Promise<void> {
    const session = await createSession('新的对话')
    navigate(`/chat/${session.id}`)
  }

  async function removeSession(id: string): Promise<void> {
    try {
      await deleteSession(id)
      setSessions((prev) => prev?.filter((s) => s.id !== id) ?? null)
      setError(null)
    } catch (err: unknown) {
      fail(err, '删除会话失败')
    } finally {
      setConfirmingId(null)
    }
  }

  async function togglePin(sessionId: string): Promise<void> {
    const session = sessions?.find((s) => s.id === sessionId)
    if (session === undefined) throw new Error('会话不存在或已被删除')
    const updated = await setSessionPinned(sessionId, session.pinnedAt === null)
    if (updated === null) throw new Error('会话不存在或已被删除')
    await reload()
    setError(null)
    showToast(updated.pinnedAt === null ? '已取消置顶' : '已置顶')
  }

  /** 移入 / 移出分组。`groupId` 传 null 即移出到未分组区。 */
  async function applyMove(sessionId: string, groupId: string | null): Promise<void> {
    const updated = await setSessionGroup(sessionId, groupId)
    if (updated === null) throw new Error('会话不存在或已被删除')
    await reload()
    setError(null)
    const name = groupId === null ? null : ((groups ?? []).find((g) => g.id === groupId)?.name ?? null)
    showToast(name === null ? '已移出分组' : `已移入「${name}」`)
  }

  async function removeGroup(groupId: string): Promise<void> {
    try {
      const moved = await deleteSessionGroup(groupId)
      await reload()
      setError(null)
      showToast(moved === 0 ? '已删除分组' : `已删除分组，${moved} 个会话回到未分组`)
    } catch (err: unknown) {
      fail(err, '删除分组失败')
    } finally {
      setConfirmingGroupId(null)
    }
  }

  async function toggleGroupCollapsed(group: SessionGroup): Promise<void> {
    try {
      const updated = await setSessionGroupCollapsed(group.id, !group.collapsed)
      if (updated === null) throw new Error('分组不存在或已被删除')
      await reload()
      setError(null)
    } catch (err: unknown) {
      fail(err, '切换分组折叠失败')
    }
  }

  async function moveGroup(groupId: string, direction: -1 | 1): Promise<void> {
    const current = groups ?? []
    const index = current.findIndex((group) => group.id === groupId)
    const target = index + direction
    if (index < 0 || target < 0 || target >= current.length) return
    const ids = current.map((group) => group.id)
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    try {
      setGroups(await reorderSessionGroups(ids))
      setError(null)
    } catch (err: unknown) {
      fail(err, '调整分组顺序失败')
    }
  }

  async function submitGroupName(name: string): Promise<void> {
    if (nameSheet === null) return
    setSaving(true)
    try {
      if (nameSheet.mode === 'create') {
        const group = await createSessionGroup(name)
        if (nameSheet.moveSessionId !== undefined) {
          await setSessionGroup(nameSheet.moveSessionId, group.id)
        }
        await reload()
        showToast(
          nameSheet.moveSessionId === undefined
            ? `已创建分组「${group.name}」`
            : `已创建「${group.name}」并移入`,
        )
      } else {
        const group = await renameSessionGroup(nameSheet.groupId, name)
        if (group === null) throw new Error('分组不存在或已被删除')
        await reload()
        showToast(`已重命名为「${group.name}」`)
      }
      setError(null)
      setNameSheet(null)
    } catch (err: unknown) {
      // 名称为空 / 超长等校验失败时**不关闭弹层**，改完再提交即可
      fail(err, '保存分组失败')
    } finally {
      setSaving(false)
    }
  }

  /** 菜单项随对象与状态增减（SPEC §1.3：同一套操作逻辑，两处共用同一个菜单容器） */
  const sheetActions = useMemo<SheetAction[] | null>(() => {
    if (sheet === null) return null

    if (sheet.kind === 'group') {
      const group = (groups ?? []).find((g) => g.id === sheet.id)
      if (group === undefined) return null
      return [
        { id: 'rename-group', label: '重命名分组' },
        { id: 'delete-group', label: '删除分组', danger: true },
      ]
    }

    if (sheet.kind === 'move') {
      const session = (sessions ?? []).find((s) => s.id === sheet.id)
      if (session === undefined) return null
      const current = session.groupId ?? null
      return [
        // 当前所在分组不列出来：点了等于原地不动
        ...(groups ?? [])
          .filter((g) => g.id !== current)
          .map((g) => ({ id: `group:${g.id}`, label: g.name })),
        { id: 'move-new-group', label: '＋ 新建分组' },
        ...(current === null ? [] : [{ id: 'move-none', label: '移出分组' }]),
      ]
    }

    const session = (sessions ?? []).find((s) => s.id === sheet.id)
    if (session === undefined) return null
    return [
      { id: 'pin', label: session.pinnedAt === null ? '置顶会话' : '取消置顶' },
      { id: 'move', label: '移入分组' },
      ...(session.groupId === null ? [] : [{ id: 'ungroup', label: '移出分组' }]),
      { id: 'delete', label: '删除会话', danger: true },
    ]
  }, [sheet, groups, sessions])

  const sheetTitle = useMemo(() => {
    if (sheet === null) return undefined
    if (sheet.kind === 'group') return (groups ?? []).find((g) => g.id === sheet.id)?.name
    const session = (sessions ?? []).find((s) => s.id === sheet.id)
    if (session === undefined) return undefined
    return sheet.kind === 'move' ? `把「${session.title}」移到…` : session.title
  }, [sheet, groups, sessions])

  async function runSheetAction(actionId: string): Promise<void> {
    if (sheet === null) return
    const target = sheet
    setSheet(null)
    try {
      if (target.kind === 'group') {
        const group = (groups ?? []).find((g) => g.id === target.id)
        if (group === undefined) return
        if (actionId === 'rename-group') {
          setNameSheet({ mode: 'rename', groupId: group.id, initialName: group.name })
        } else if (actionId === 'delete-group') {
          askRemoveGroup(group.id)
        }
        return
      }
      if (target.kind === 'move') {
        if (actionId === 'move-new-group') setNameSheet({ mode: 'create', moveSessionId: target.id })
        else if (actionId === 'move-none') await applyMove(target.id, null)
        else if (actionId.startsWith('group:')) await applyMove(target.id, actionId.slice('group:'.length))
        return
      }
      if (actionId === 'pin') await togglePin(target.id)
      else if (actionId === 'move') setSheet({ kind: 'move', id: target.id })
      else if (actionId === 'ungroup') await applyMove(target.id, null)
      else if (actionId === 'delete') askRemoveSession(target.id)
    } catch (err: unknown) {
      fail(err, '会话操作失败')
    }
  }

  /**
   * 列表的分区视图（SPEC §2.1.2 / §2.1.3）
   * - `pinned` 一等公民，不再按分组归位；
   * - `unassigned` 兜住 `groupId` 为空**以及指向不存在分组**的两种会话。
   */
  const view = useMemo(() => {
    const all = sessions ?? []
    const knownGroupIds = new Set((groups ?? []).map((g) => g.id))
    const unpinned = all.filter((s) => s.pinnedAt === null)
    return {
      pinned: all.filter((s) => s.pinnedAt !== null),
      sections: (groups ?? []).map((group) => ({
        group,
        sessions: unpinned.filter((s) => s.groupId === group.id),
      })),
      unassigned: unpinned.filter((s) => s.groupId === null || !knownGroupIds.has(s.groupId)),
      hasGroups: (groups ?? []).length > 0,
    }
  }, [sessions, groups])

  function renderSessionRow(s: ChatSession) {
    const pinned = s.pinnedAt !== null
    return (
      <li
        key={s.id}
        data-testid={`session-row-${s.id}`}
        className="pressable card flex items-center gap-2"
        style={{
          padding: '12px 14px',
          // 置顶的行换一层底色：它已经跨分组浮到最上面，不给点区别就看不出「它为什么在这儿」
          ...(pinned ? { backgroundColor: 'var(--bg-subtle)' } : {}),
        }}
      >
        <Link
          to={`/chat/${s.id}`}
          data-testid={`session-title-${s.id}`}
          className="flex min-w-0 flex-1 items-center gap-2"
          style={{ color: 'var(--text-primary)' }}
        >
          {pinned && <IconPin size={13} className="shrink-0" style={{ color: 'var(--accent-strong)' }} />}
          <span className="truncate">{s.title}</span>
        </Link>
        {confirmingId === s.id ? (
          <button
            type="button"
            data-testid={`session-confirm-${s.id}`}
            className="btn-pill shrink-0"
            style={{
              minHeight: 30,
              padding: '0 12px',
              fontSize: 12,
              backgroundColor: 'transparent',
              border: '1px solid var(--danger)',
              color: 'var(--danger)',
            }}
            onClick={() => void removeSession(s.id)}
          >
            确认删除？
          </button>
        ) : (
          <button
            type="button"
            data-testid={`session-menu-${s.id}`}
            aria-label={`会话操作：${s.title}`}
            className="icon-btn shrink-0"
            style={{ width: 30, height: 30, color: 'var(--text-tertiary)' }}
            onClick={() => setSheet({ kind: 'session', id: s.id })}
          >
            <IconMore size={15} />
          </button>
        )}
      </li>
    )
  }

  const loading = sessions === null || groups === null
  const empty = !loading && (sessions ?? []).length === 0 && (groups ?? []).length === 0

  return (
    <div className="flex flex-col">
      {/* 顶栏沿用设计的 `.topbar`（低存在感）：标题 + 两枚胶囊按钮，不放任何色块横幅 */}
      <div className="topbar">
        <h1 className="topbar-title">对话</h1>
        <span className="topbar-spacer" />
        <button
          type="button"
          data-testid="chat-history-open"
          aria-label="搜索聊天记录"
          onClick={() => setHistoryOpen(true)}
          className="icon-btn"
        >
          <IconSearch size={18} />
        </button>
        <button
          type="button"
          onClick={() => void startSession()}
          className="btn-pill btn-strong"
          style={{ minHeight: 36, padding: '0 16px', fontSize: 13.5 }}
        >
          <IconPlus size={16} />
          新建
        </button>
        <button
          type="button"
          data-testid="create-group"
          onClick={() => setNameSheet({ mode: 'create' })}
          className="btn-pill btn-ghost"
          style={{ minHeight: 36, padding: '0 16px', fontSize: 13.5 }}
        >
          <IconJournal size={16} />
          分组
        </button>
      </div>

      {historyOpen && (
        <ChatHistoryPanel
          scope="all"
          onClose={() => setHistoryOpen(false)}
          onNavigate={(targetSessionId, messageId) => {
            setHistoryOpen(false)
            navigate(`/chat/${targetSessionId}?focus=${encodeURIComponent(messageId)}`)
          }}
        />
      )}

      <div className="flex flex-col" style={{ padding: '0 20px 24px' }}>
        {error !== null && (
          <p className="mb-3 text-sm" style={{ color: 'var(--danger)' }}>
            读取失败：{error}
          </p>
        )}
        {loading && error === null && (
          <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>加载中…</p>
        )}
        {empty && (
          <div
            className="card p-8 text-center text-sm"
            style={{ color: 'var(--text-tertiary)' }}
          >
            还没有对话，点右上角「新建」开始吧
          </div>
        )}

        <ul className="flex flex-col gap-2">
          {/* 置顶区：跨分组浮在最顶，所以只在有分组时才需要一个「置顶」标题来交代它为什么脱离了自己的分组 */}
          {view.pinned.length > 0 && view.hasGroups && (
            <li
              data-testid="pinned-section"
              className="px-1 pt-1 text-xs"
              style={{ color: 'var(--text-tertiary)', letterSpacing: '0.12em' }}
            >
              置顶
            </li>
          )}
          {view.pinned.map((s) => renderSessionRow(s))}

          {view.sections.map(({ group, sessions: groupSessions }) => (
            <Fragment key={group.id}>
              <li
                data-testid={`group-section-${group.id}`}
                className="mt-1 flex items-center gap-2 px-1 text-sm"
              >
                <button
                  type="button"
                  data-testid={`group-toggle-${group.id}`}
                  aria-expanded={!group.collapsed}
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left font-medium"
                  style={{ color: 'var(--text-primary)' }}
                  onClick={() => void toggleGroupCollapsed(group)}
                >
                  {group.collapsed ? (
                    <IconChevronRight size={14} className="shrink-0" />
                  ) : (
                    <IconChevronDown size={14} className="shrink-0" />
                  )}
                  <span data-testid={`group-name-${group.id}`} className="truncate">{group.name}</span>
                  <span
                    data-testid={`group-count-${group.id}`}
                    className="shrink-0 text-xs"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    {groupSessions.length}
                  </span>
                </button>
                {confirmingGroupId === group.id ? (
                  <button
                    type="button"
                    data-testid={`group-confirm-${group.id}`}
                    className="btn-pill shrink-0"
                    style={{
                      minHeight: 30,
                      padding: '0 12px',
                      fontSize: 12,
                      backgroundColor: 'transparent',
                      border: '1px solid var(--danger)',
                      color: 'var(--danger)',
                    }}
                    onClick={() => void removeGroup(group.id)}
                  >
                    {groupSessions.length === 0
                      ? '确认删除？'
                      : `确认删除？（${groupSessions.length} 个会话回到未分组）`}
                  </button>
                ) : (
                  <span className="flex shrink-0 items-center gap-0.5">
                    <button type="button" aria-label={`分组上移：${group.name}`} disabled={groups?.[0]?.id === group.id} onClick={() => void moveGroup(group.id, -1)} className="icon-btn" style={{ width: 28, height: 28, color: 'var(--text-tertiary)' }}>↑</button>
                    <button type="button" aria-label={`分组下移：${group.name}`} disabled={groups?.[groups.length - 1]?.id === group.id} onClick={() => void moveGroup(group.id, 1)} className="icon-btn" style={{ width: 28, height: 28, color: 'var(--text-tertiary)' }}>↓</button>
                    <button
                      type="button"
                      data-testid={`group-menu-${group.id}`}
                      aria-label={`分组操作：${group.name}`}
                      className="icon-btn"
                      style={{ width: 30, height: 30, color: 'var(--text-tertiary)' }}
                      onClick={() => setSheet({ kind: 'group', id: group.id })}
                    >
                      <IconMore size={15} />
                    </button>
                  </span>
                )}
              </li>
              {!group.collapsed && groupSessions.map((s) => renderSessionRow(s))}
            </Fragment>
          ))}

          {/* 未分组兜底区：只有真的存在分组、且这里确实有会话时才出现 */}
          {view.hasGroups && view.unassigned.length > 0 && (
            <li
              data-testid="unassigned-section"
              className="mt-1 px-1 text-xs"
              style={{ color: 'var(--text-tertiary)', letterSpacing: '0.12em' }}
            >
              未分组
            </li>
          )}
          {view.unassigned.map((s) => renderSessionRow(s))}
        </ul>
      </div>

      {toast !== null && (
        <p
          data-testid="list-toast"
          className="chip fixed bottom-24 left-1/2 z-40 -translate-x-1/2"
          style={{ boxShadow: 'var(--shadow-lift)' }}
        >
          {toast}
        </p>
      )}

      <ActionSheet
        actions={sheetActions}
        title={sheetTitle}
        onSelect={(id) => void runSheetAction(id)}
        onClose={() => setSheet(null)}
      />

      {nameSheet !== null && (
        <NameSheet
          title={nameSheet.mode === 'create' ? '新建分组' : '重命名分组'}
          fieldLabel="分组名称"
          hint="删分组不会删除会话，组内会话会回到未分组"
          initialName={nameSheet.mode === 'create' ? '' : nameSheet.initialName}
          maxLength={SESSION_GROUP_NAME_MAX}
          saving={saving}
          onClose={() => setNameSheet(null)}
          onSubmit={submitGroupName}
        />
      )}
    </div>
  )
}
