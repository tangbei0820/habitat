/**
 * 分类筛选条（SPEC §3.5.4 / §3.7.3）：收藏与相册共用一套形态。
 *
 * 为什么是**横向筛选条**而不是像会话列表那样纵向分区：
 * 收藏卡片与照片卡片本来就高，纵向分区会把页面拉得很长，而「找某一类」这件事
 * 用筛选一步到位。三个模块的分组交互因此不一致，但这是有意的 ——
 * 会话是「一行一条、短」，收藏/相册是「一块一条、高」，形态跟着内容走。
 *
 * 组件是**自足**的：筛选条本身、管理菜单、重命名弹层、删除确认全在这里，
 * 页面只管传数据与四个回调。两个页面各接一次，行为不可能分叉。
 *
 * 一个分类都没有时**不渲染筛选条**，只留一枚不起眼的「＋ 新建分类」——
 * 不用分类的人看到的界面应该和没有这个功能一样。
 */
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { ActionSheet, type SheetAction } from '../../components/ActionSheet'
import { NameSheet } from '../../components/NameSheet'
import { CATEGORY_NAME_MAX } from '../../db/home'
import type { CategoryCounts, CategoryLike, CategorySelection } from './categories'

type ManageTarget = { kind: 'list' } | { kind: 'item'; id: string }
type NameTarget = { mode: 'create' } | { mode: 'rename'; id: string; initialName: string }

export function CategoryBar({
  noun,
  unit = '条',
  categories,
  selection,
  counts,
  createToken = 0,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: {
  /** 界面文案里的单数名词：「分类」/「相册」；标题、按钮、确认语都由它拼出来 */
  noun: string
  /** 量词：「条」（收藏）/「张」（照片）。确认语会说「N 张回到未分类」 */
  unit?: string
  categories: readonly CategoryLike[]
  selection: CategorySelection
  counts: CategoryCounts
  /**
   * 外部请求打开「新建」弹层的信号：**值变化**即触发（`0` 是初值，不触发）。
   *
   * 命名弹层的状态在本组件内部，但「新建」也可能由页面发起 ——
   * 典型是条目的「移入分类 → ＋ 新建分类」：那条路径要建完立刻把条目放进去，
   * 而条目属于页面。用一个递增计数而不是布尔量，是为了让「连着来两次」也算两次变化。
   */
  createToken?: number
  onSelect: (selection: CategorySelection) => void
  onCreate: (name: string) => Promise<void>
  onRename: (id: string, name: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const [manage, setManage] = useState<ManageTarget | null>(null)
  /** 删除确认态：菜单不关，原位把「删除」换成「确认删除？（N 条 / 张回到未分类）」 */
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [nameTarget, setNameTarget] = useState<NameTarget | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (createToken > 0) setNameTarget({ mode: 'create' })
  }, [createToken])

  const selectedId = selection.kind === 'category' ? selection.id : null

  const manageActions = useMemo<SheetAction[] | null>(() => {
    if (manage === null) return null
    if (manage.kind === 'list') {
      return [
        ...categories.map((category) => ({
          id: `item:${category.id}`,
          label: `${category.name}（${counts.byId.get(category.id) ?? 0} 条）`,
        })),
        { id: 'create', label: `＋ 新建${noun}` },
      ]
    }
    const category = categories.find((item) => item.id === manage.id)
    if (category === undefined) return null
    if (pendingDeleteId === category.id) {
      const inside = counts.byId.get(category.id) ?? 0
      return [
        {
          id: 'confirm-delete',
          label: inside === 0 ? '确认删除？' : `确认删除？（${inside} ${unit}回到未分类）`,
          danger: true,
        },
      ]
    }
    return [
      { id: 'rename', label: `重命名${noun}` },
      { id: 'delete', label: `删除${noun}`, danger: true },
    ]
  }, [manage, categories, counts, pendingDeleteId, noun, unit])

  const manageTitle = useMemo(() => {
    if (manage === null || manage.kind === 'list') return undefined
    return categories.find((item) => item.id === manage.id)?.name
  }, [manage, categories])

  function closeManage(): void {
    setManage(null)
    setPendingDeleteId(null)
  }

  async function runManageAction(actionId: string): Promise<void> {
    if (manage === null) return
    if (manage.kind === 'list') {
      if (actionId === 'create') {
        closeManage()
        setNameTarget({ mode: 'create' })
        return
      }
      if (actionId.startsWith('item:')) {
        setPendingDeleteId(null)
        setManage({ kind: 'item', id: actionId.slice('item:'.length) })
      }
      return
    }
    const categoryId = manage.id
    const category = categories.find((item) => item.id === categoryId)
    if (actionId === 'rename') {
      if (category === undefined) return
      closeManage()
      setNameTarget({ mode: 'rename', id: category.id, initialName: category.name })
      return
    }
    if (actionId === 'delete') {
      // 不关菜单：把这一项换成一枚确认项，位置不变，视线不用重新找
      setPendingDeleteId(categoryId)
      return
    }
    if (actionId === 'confirm-delete') {
      closeManage()
      setSaving(true)
      try {
        await onDelete(categoryId)
        setError(null)
        // 删的正好是当前筛选项时，把筛选拉回「全部」（页面侧的 normalize 也会兜一次）
        if (selectedId === categoryId) onSelect({ kind: 'all' })
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setSaving(false)
      }
    }
  }

  async function submitName(name: string): Promise<void> {
    if (nameTarget === null) return
    setSaving(true)
    try {
      if (nameTarget.mode === 'create') await onCreate(name)
      else await onRename(nameTarget.id, name)
      setError(null)
      setNameTarget(null)
    } catch (err: unknown) {
      // 名称为空 / 超长等校验失败时**不关闭弹层**，改完再提交即可
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  function chip(active: boolean): string {
    return active
      ? 'shrink-0 rounded-full px-3 py-1 text-xs'
      : 'shrink-0 rounded-full border px-3 py-1 text-xs'
  }

  function chipStyle(active: boolean): CSSProperties {
    return active
      ? { backgroundColor: 'var(--accent-strong)', color: 'var(--accent-on-strong)' }
      : { borderColor: 'var(--border-soft)', color: 'var(--text-secondary)' }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto pb-1">
          {categories.length === 0 ? (
            <button
              type="button"
              data-testid="create-category"
              onClick={() => setNameTarget({ mode: 'create' })}
              className="shrink-0 rounded-full border px-3 py-1 text-xs"
              style={{ borderColor: 'var(--border-soft)', color: 'var(--text-secondary)' }}
            >
              ＋ 新建{noun}
            </button>
          ) : (
            <>
              <button
                type="button"
                data-testid="category-chip-all"
                aria-pressed={selection.kind === 'all'}
                onClick={() => onSelect({ kind: 'all' })}
                className={chip(selection.kind === 'all')}
                style={chipStyle(selection.kind === 'all')}
              >
                全部（{counts.all}）
              </button>
              <button
                type="button"
                data-testid="category-chip-unassigned"
                aria-pressed={selection.kind === 'unassigned'}
                onClick={() => onSelect({ kind: 'unassigned' })}
                className={chip(selection.kind === 'unassigned')}
                style={chipStyle(selection.kind === 'unassigned')}
              >
                未分类（{counts.unassigned}）
              </button>
              {categories.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  data-testid={`category-chip-${category.id}`}
                  aria-pressed={selectedId === category.id}
                  onClick={() => onSelect({ kind: 'category', id: category.id })}
                  className={chip(selectedId === category.id)}
                  style={chipStyle(selectedId === category.id)}
                >
                  {category.name}（{counts.byId.get(category.id) ?? 0}）
                </button>
              ))}
            </>
          )}
        </div>
        <button
          type="button"
          data-testid="category-manage"
          aria-label={`管理${noun}`}
          onClick={() => setManage({ kind: 'list' })}
          className="shrink-0 px-2 text-sm"
          style={{ color: 'var(--text-secondary)' }}
        >
          ⋯
        </button>
      </div>

      {error !== null && (
        <p data-testid="category-error" className="text-xs" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      )}

      <ActionSheet
        actions={manageActions}
        title={manageTitle}
        onSelect={(id) => void runManageAction(id)}
        onClose={closeManage}
      />

      {nameTarget !== null && (
        <NameSheet
          title={nameTarget.mode === 'create' ? `新建${noun}` : `重命名${noun}`}
          fieldLabel={`${noun}名称`}
          hint={`删除${noun}不会删除里面的内容，它们会回到未分类`}
          initialName={nameTarget.mode === 'create' ? '' : nameTarget.initialName}
          maxLength={CATEGORY_NAME_MAX}
          saving={saving}
          onClose={() => setNameTarget(null)}
          onSubmit={submitName}
        />
      )}
    </div>
  )
}
