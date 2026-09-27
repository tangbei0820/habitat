/**
 * 不定高虚拟列表（§9 风险8：长聊天性能，Phase 1 就引入）
 *
 * 为什么自己写：聊天消息高度随内容长短变化，市面组件要么要求固定行高（做不到），
 * 要么依赖动测量库；这里的实现只有一件事 —— **测过的高度缓存起来，没测过的先按估值占位**。
 *
 * 高度缓存的键是 **item key 而非下标**：日后向上加载更早一页会把整段下标位移，
 * 用下标做键会让所有缓存错位。
 *
 * 滚动锚定：用户贴底时新内容自动跟随；用户翻看历史时**绝不被拉回去**；
 * 向上加载更早一页时按「锚点项」还原位置（见下方 `prevGeomRef`）。
 */
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

export interface VirtualListProps<T> {
  items: T[]
  /** ⚠️ 必须是稳定引用（useCallback / 模块常量），否则每次渲染都会重算全部偏移 */
  getKey: (item: T, index: number) => string
  renderItem: (item: T, index: number) => ReactNode
  /** 未测量项的估算高度 */
  estimateHeight?: number
  /** 可视区外上下各多渲染几条，减少快滚白屏 */
  overscan?: number
  /** 距底部小于该像素值即视为「贴底」 */
  stickThreshold?: number
  /**
   * 滚到顶部附近时回调（用于向上加载更早一页）。
   * ⚠️ 调用方**必须**自己守卫「加载中 / 没有更多」—— 贴顶时这个回调会被反复触发。
   */
  onReachTop?: () => void
  /** 距顶部小于该像素值即触发 onReachTop */
  reachTopThreshold?: number
  /** 定位到指定项。项出现后只应用一次，仍由虚拟列表负责实际渲染窗口。 */
  scrollToKey?: string | null
  className?: string
}

/** 二分找覆盖 `target` 偏移的项下标（offsets 单调递增，长度为 count+1） */
function findIndexAt(offsets: number[], target: number, count: number): number {
  let lo = 0
  let hi = count - 1
  let result = count - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const end = offsets[mid + 1] ?? Number.POSITIVE_INFINITY
    if (end > target) {
      result = mid
      hi = mid - 1
    } else {
      lo = mid + 1
    }
  }
  return Math.max(0, result)
}

/** 单个可见项：挂上就上报实测高度，并在后续尺寸变化时持续上报 */
function MeasuredItem({
  itemKey,
  onMeasure,
  children,
}: {
  itemKey: string
  onMeasure: (key: string, height: number) => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (el === null) return
    const report = (): void => onMeasure(itemKey, el.offsetHeight)
    report()
    const observer = new ResizeObserver(report)
    observer.observe(el)
    return () => observer.disconnect()
  }, [itemKey, onMeasure])

  return <div ref={ref}>{children}</div>
}

export function VirtualList<T>({
  items,
  getKey,
  renderItem,
  estimateHeight = 72,
  overscan = 6,
  stickThreshold = 48,
  onReachTop,
  reachTopThreshold = 24,
  scrollToKey = null,
  className,
}: VirtualListProps<T>) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const heightsRef = useRef(new Map<string, number>())
  const stickRef = useRef(true)
  const rafRef = useRef(0)
  const scrollTargetAppliedRef = useRef<string | null>(null)
  /** 回调放 ref：塞进 handleScroll 的依赖会让 onScroll 每次渲染都换新函数 */
  const onReachTopRef = useRef(onReachTop)

  const [revision, setRevision] = useState(0)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)

  const count = items.length

  const keys = useMemo(() => items.map((item, index) => getKey(item, index)), [items, getKey])

  const offsets = useMemo(() => {
    const list: number[] = new Array<number>(count + 1)
    let acc = 0
    for (let i = 0; i < count; i += 1) {
      list[i] = acc
      acc += heightsRef.current.get(keys[i] ?? '') ?? estimateHeight
    }
    list[count] = acc
    return list
    // revision 是必须的依赖：高度缓存在 ref 里，ref 变化不产生依赖，靠它触发重算
  }, [keys, count, estimateHeight, revision])

  const totalHeight = offsets[count] ?? 0

  /** 测量上报：小于 1px 的抖动忽略，否则亚像素变化会来回触发重渲染 */
  const handleMeasure = useCallback((key: string, height: number) => {
    if (height <= 0) return
    const previous = heightsRef.current.get(key)
    if (previous !== undefined && Math.abs(previous - height) < 1) return
    heightsRef.current.set(key, height)
    setRevision((value) => value + 1)
  }, [])

  /** 容器自身尺寸变化（旋屏、键盘弹出） */
  useLayoutEffect(() => {
    const el = containerRef.current
    if (el === null) return
    setViewportHeight(el.clientHeight)
    const observer = new ResizeObserver(() => setViewportHeight(el.clientHeight))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  /**
   * 滚动位置维护。三种情况分得很清楚：
   * 1. 用户贴底 → 跟在最新内容上；
   * 2. 用户在看历史、而**首项换了人** → 多半是向上加载了更早一页，必须按锚点项把位置还原
   *    （否则新插进来的那截高度会把用户顶走 —— 就是清单里那条「prepend 后跳位」）；
   * 3. 其余不动 —— 用户没贴底就是在读历史，谁也别去拽他。
   *
   * 锚点用「item key」不用下标：插入会让整段下标位移，只有 key 是不动的那个参照物。
   */
  const prevGeomRef = useRef<{
    offsets: number[]
    keys: string[]
    firstKey: string | null
    count: number
  } | null>(null)

  useLayoutEffect(() => {
    const el = containerRef.current
    if (el === null) return
    const firstKey = keys[0] ?? null
    const prev = prevGeomRef.current

    if (
      !stickRef.current &&
      prev !== null &&
      prev.firstKey !== null &&
      firstKey !== null &&
      prev.firstKey !== firstKey
    ) {
      // 上一帧里「盖住视口顶部」的那一项 = 锚点；记下视口顶部在它内部的偏移，还原时照搬
      const prevIndex = findIndexAt(prev.offsets, el.scrollTop, prev.count)
      const anchorKey = prev.keys[prevIndex]
      const anchorIndex = anchorKey === undefined ? -1 : keys.indexOf(anchorKey)
      if (anchorIndex >= 0) {
        const delta = el.scrollTop - (prev.offsets[prevIndex] ?? 0)
        el.scrollTop = (offsets[anchorIndex] ?? 0) + delta
        setScrollTop(el.scrollTop)
      }
    }

    prevGeomRef.current = { offsets, keys, firstKey, count }
  }, [keys, offsets, count])

  // 贴底跟随单独一段：流式改文字这类「内容变了但还没重新测量」的变化不会换 offsets 引用，
  // 只靠上面那段会漏掉
  useLayoutEffect(() => {
    const el = containerRef.current
    if (el === null || !stickRef.current) return
    el.scrollTop = el.scrollHeight
  }, [items, offsets])

  const handleScroll = useCallback(() => {
    const el = containerRef.current
    if (el === null) return
    // 贴底判定要同步做，不能等 rAF —— 否则用户刚往上滚一点就被认成「仍在底部」
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= stickThreshold
    if (el.scrollTop <= reachTopThreshold) onReachTopRef.current?.()
    if (rafRef.current !== 0) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0
      const node = containerRef.current
      if (node !== null) setScrollTop(node.scrollTop)
    })
  }, [stickThreshold, reachTopThreshold])

  useLayoutEffect(() => {
    onReachTopRef.current = onReachTop
  }, [onReachTop])

  useLayoutEffect(() => {
    if (scrollToKey === null) {
      scrollTargetAppliedRef.current = null
      return
    }
    if (scrollTargetAppliedRef.current === scrollToKey) return
    const index = keys.indexOf(scrollToKey)
    const el = containerRef.current
    if (index < 0 || el === null) return
    stickRef.current = false
    el.scrollTop = offsets[index] ?? 0
    setScrollTop(el.scrollTop)
    scrollTargetAppliedRef.current = scrollToKey
  }, [keys, offsets, scrollToKey])

  const overscanPx = overscan * estimateHeight
  // 首帧容器还没测到高度（clientHeight = 0），先按估值铺满，避免只渲染一条
  const effectiveHeight = viewportHeight > 0 ? viewportHeight : estimateHeight * 8
  const startIndex = count === 0 ? 0 : findIndexAt(offsets, Math.max(0, scrollTop - overscanPx), count)
  const endIndex = count === 0 ? -1 : findIndexAt(offsets, scrollTop + effectiveHeight + overscanPx, count)

  const rendered: ReactNode[] = []
  for (let i = startIndex; i <= endIndex; i += 1) {
    const item = items[i]
    if (item === undefined) continue
    const key = getKey(item, i)
    rendered.push(
      <div
        key={key}
        style={{ position: 'absolute', top: offsets[i] ?? 0, left: 0, right: 0 }}
      >
        <MeasuredItem itemKey={key} onMeasure={handleMeasure}>
          {renderItem(item, i)}
        </MeasuredItem>
      </div>,
    )
  }

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className={className}
      // 浏览器自带的滚动锚定会和我们的贴底逻辑打架，关掉
      style={{ overflowY: 'auto', overflowAnchor: 'none', position: 'relative' }}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>{rendered}</div>
    </div>
  )
}
