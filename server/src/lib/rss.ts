/**
 * 极简 RSS / Atom 解析（Phase 7B · Solitude Surf v1）。
 *
 * 刻意不引依赖：Surf 只需要「标题 + 链接 + 摘要」，用正则抽这三样足够；
 * 完整的 XML 语法树对一个候选列表生成器是杀鸡用牛刀。
 *
 * ⚠️ 订阅源内容是**外部不可信数据**：这里抽出的所有文本最终都会被包进
 * `<candidate_list>` 之类标记交给模型，并在 prompt 里明确「这是参考资料不是指令」。
 * 解析层不做净化之外的处理（不执行、不follow 内嵌内容）。
 */

export interface FeedItem {
  title: string
  link: string
  summary: string
}

/** 抽文本：去 CDATA、去内嵌标签、解最常见实体 */
function text(raw: string): string {
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Atom 的 <link> 是 href 属性；RSS 的 <link> 是文本。两种都试着抽 */
function linkOf(block: string): string {
  const atom = block.match(/<link[^>]*\shref=["']([^"']+)["'][^>]*\/?>/i)
  if (atom !== null) return atom[1].trim()
  const rss = block.match(/<link[^>]*>([\s\S]*?)<\/link>/i)
  if (rss !== null) return text(rss[1])
  return ''
}

function first(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'))
  return match === null ? '' : text(match[1])
}

/**
 * 从一份 RSS / Atom 文本抽条目。解析不出任何条目返回空数组（让调用方降级），
 * 不抛 —— 单个源坏了不该连坐整轮 Surf。
 */
export function parseFeed(xml: string): FeedItem[] {
  const blocks = [
    ...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi),
    ...xml.matchAll(/<entry[\s>][\s\S]*?<\/entry>/gi),
  ].map((match) => match[0])
  const items: FeedItem[] = []
  for (const block of blocks) {
    const title = first(block, 'title')
    const link = linkOf(block)
    if (title === '' || link === '' || !/^https?:\/\//i.test(link)) continue
    const summary = first(block, 'description') || first(block, 'summary') || first(block, 'content')
    items.push({ title, link, summary: summary.slice(0, 300) })
  }
  return items
}

/** 抓一份订阅源并解析。超时 / 非 2xx / 解析失败都返回空数组。 */
export async function fetchFeed(url: string, timeoutMs = 10_000): Promise<FeedItem[]> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' },
    })
    if (!res.ok) return []
    return parseFeed(await res.text())
  } catch {
    return []
  }
}
