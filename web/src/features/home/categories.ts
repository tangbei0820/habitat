/**
 * 分类的筛选与计数（SPEC §3.5.4 / §3.7.3）。
 *
 * 收藏分类与相册是同构的，差别只在被归类的条目类型与归属字段名，
 * 所以这里只写一份纯逻辑，两个页面各自传入「怎么从一个条目读出它的归属」。
 *
 * ⚠️ **未分类是兜底区**：`null` 与「指向已不存在分类的脏引用」都算未分类。
 * 脏引用在写入侧已被校验拦住，但导入的备份 / 手工改过的库不受我们控制 ——
 * 宁可让那条内容显示在未分类里，也不能让它哪个筛选下都看不见（等于凭空消失）。
 */

/** 当前选中的筛选：全部 / 未分类 / 某个分类 */
export type CategorySelection =
  | { kind: 'all' }
  | { kind: 'unassigned' }
  | { kind: 'category'; id: string }

export interface CategoryLike {
  id: string
  name: string
}

export interface CategoryCounts {
  all: number
  unassigned: number
  /** 分类 id → 条数；没有条目的分类不在表里（取的时候用 `?? 0`） */
  byId: Map<string, number>
}

/** 从一个条目读出它的归属；返回 `null` 表示未分类 */
export type CategoryIdOf<T> = (item: T) => string | null

export function countByCategory<T>(
  items: readonly T[],
  categories: readonly CategoryLike[],
  idOf: CategoryIdOf<T>,
): CategoryCounts {
  const known = new Set(categories.map((category) => category.id))
  const byId = new Map<string, number>()
  let unassigned = 0
  for (const item of items) {
    const id = idOf(item)
    if (id === null || !known.has(id)) unassigned += 1
    else byId.set(id, (byId.get(id) ?? 0) + 1)
  }
  return { all: items.length, unassigned, byId }
}

export function filterByCategory<T>(
  items: readonly T[],
  selection: CategorySelection,
  categories: readonly CategoryLike[],
  idOf: CategoryIdOf<T>,
): T[] {
  if (selection.kind === 'all') return [...items]
  if (selection.kind === 'category') {
    // 选中的分类被删掉时（另一处操作删的）退回「全部」而不是给出空列表 ——
    // 空列表看起来像「内容没了」，而这只是筛选条件失效
    if (!categories.some((category) => category.id === selection.id)) return [...items]
    return items.filter((item) => idOf(item) === selection.id)
  }
  const known = new Set(categories.map((category) => category.id))
  return items.filter((item) => {
    const id = idOf(item)
    return id === null || !known.has(id)
  })
}

/**
 * 选中的分类被删掉之后，把筛选态拉回「全部」。
 * 单独一个函数是因为它要在**每次数据刷新后**调用，而不只是在删除的那一刻 ——
 * 分类也可能是被另一处（导入备份）抹掉的。
 */
export function normalizeSelection(
  selection: CategorySelection,
  categories: readonly CategoryLike[],
): CategorySelection {
  if (selection.kind !== 'category') return selection
  return categories.some((category) => category.id === selection.id) ? selection : { kind: 'all' }
}
