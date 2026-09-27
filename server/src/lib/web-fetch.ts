/**
 * 只读网页取回 / 公开搜索（Phase 7B · Solitude Surf 与 V2-B Chat Web Search 共用）。
 *
 * 边界（借自 proactive-web-surf-agent 的安全清单）：
 * - **只读**：只 GET 公开 http(s) 页面，不登录、不带 Cookie、不执行页面内容；
 * - **SSRF 基础防线**：协议白名单 + 拒绝本机 / 私有网段 / 链路本地主机名。
 *   ⚠️ 已知残余风险：不做 DNS rebinding 防护（解析后再查 IP）—— 个人自用、
 *   出网面只有模型给的 URL，接受这个折衷；将来接更广的浏览能力时必须补。
 * - **有界**：10 秒超时、响应体上限 1MB、抽取正文再截断 —— 防止一个巨型页面
 *   把整轮后台任务拖死或撑爆上下文。
 */

export interface FetchedPage {
  title: string
  text: string
}

export interface WebSearchResult {
  title: string
  url: string
  snippet: string
}

const MAX_BYTES = 1_000_000
const TEXT_LIMIT = 4_000

/** 主机名黑名单：本机、内网段、云元数据端点。IPv4 字面量直接判段。 */
function isBlockedHost(host: string): boolean {
  const normalized = host.toLowerCase().replace(/\.$/, '')
  if (normalized === '' || normalized === 'localhost' || normalized.endsWith('.local') || normalized.endsWith('.internal')) return true
  const ipv4 = normalized.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipv4 !== null) {
    const octets = ipv4.slice(1).map(Number)
    if (octets.some((value) => value > 255)) return true
    const [a, b] = octets
    if (a === 0 || a === 10 || a === 127) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    return false
  }
  return false
}

function decodeEntities(input: string): string {
  return input
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}

function stripTags(input: string): string {
  return decodeEntities(input.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function unwrapSearchUrl(raw: string): string | null {
  const decoded = decodeEntities(raw)
  try {
    const candidate = decoded.startsWith('//') ? `https:${decoded}` : decoded
    const url = new URL(candidate)
    // DuckDuckGo wraps result links in /l/?uddg=...; only return the real public URL.
    const target = url.searchParams.get('uddg')
    const value = target === null ? url.toString() : target
    const result = new URL(value)
    if (result.protocol !== 'http:' && result.protocol !== 'https:') return null
    if (isBlockedHost(result.hostname)) return null
    return result.toString()
  } catch {
    return null
  }
}

/**
 * 搜索公开网页（只读）。默认走 DuckDuckGo 的 HTML 结果页；endpoint 仅供本地探针
 * 注入，不从用户输入接收，生产路径始终固定在公开搜索服务上。
 */
export async function searchWeb(query: string, options: { endpoint?: string; timeoutMs?: number } = {}): Promise<WebSearchResult[]> {
  const normalized = query.trim()
  if (normalized === '') return []
  const endpoint = options.endpoint ?? 'https://html.duckduckgo.com/html/'
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    return []
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return []
  if (options.endpoint === undefined && url.hostname !== 'html.duckduckgo.com') return []
  url.searchParams.set('q', normalized.slice(0, 200))

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
      redirect: 'follow',
      headers: { accept: 'text/html' },
    })
    if (!response.ok) return []
    const declared = response.headers.get('content-length')
    if (declared !== null && Number(declared) > 500_000) return []
    const body = await response.text()
    if (body.length > 500_000) return []

    const results: WebSearchResult[] = []
    const itemPattern = /<a[^>]+class=["'][^"']*result__a[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>([\s\S]*?)(?=<a[^>]+class=["'][^"']*result__a|$)/gi
    for (const match of body.matchAll(itemPattern)) {
      const resultUrl = unwrapSearchUrl(match[1])
      if (resultUrl === null) continue
      const title = stripTags(match[2])
      const snippetMatch = match[3].match(/class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i)
      const snippet = snippetMatch === null ? '' : stripTags(snippetMatch[1])
      results.push({ title: title || resultUrl, url: resultUrl, snippet })
      if (results.length >= 5) break
    }
    return results
  } catch {
    return []
  }
}

/** 去脚本/样式 → 抽 <title> → 去标签 → 压空白。抽出来的是「给模型看的正文」，不保真排版 */
function extractHtml(html: string): FetchedPage {
  const withoutNoise = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
  const titleMatch = withoutNoise.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const title = titleMatch === null ? '' : decodeEntities(titleMatch[1]).replace(/\s+/g, ' ').trim()
  const bodyText = decodeEntities(withoutNoise.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
  return { title, text: bodyText.slice(0, TEXT_LIMIT) }
}

/**
 * 取回一个页面。任何失败（协议不允许、黑名单、超时、超限、非 HTML 文本）都返回 `null`
 * 让调用方降级 —— 失败原因是模型需要知道的，由调用方组织文案。
 */
export async function fetchPageText(rawUrl: string, timeoutMs = 10_000): Promise<FetchedPage | null> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (isBlockedHost(url.hostname)) return null
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'follow',
      headers: { accept: 'text/html, application/xhtml+xml, text/plain;q=0.9, */*;q=0.5' },
    })
    if (!res.ok) return null
    // 重定向后最终 URL 也可能被引到内网 —— 对最终响应的 URL 再查一次
    if (isBlockedHost(new URL(res.url).hostname)) return null
    const declared = res.headers.get('content-length')
    if (declared !== null && Number(declared) > MAX_BYTES) return null
    const buffer = await res.arrayBuffer()
    if (buffer.byteLength > MAX_BYTES) return null
    const contentType = res.headers.get('content-type') ?? ''
    const body = new TextDecoder('utf-8', { fatal: false }).decode(buffer)
    if (contentType.includes('json')) {
      return { title: '', text: body.slice(0, TEXT_LIMIT) }
    }
    if (!contentType.includes('html') && !contentType.includes('xml') && !contentType.startsWith('text/')) {
      return null
    }
    return extractHtml(body)
  } catch {
    return null
  }
}
