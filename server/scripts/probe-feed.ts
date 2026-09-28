/**
 * 朋友圈文字动态端到端验收（T-118）。
 * 跑法：启动隔离 DB 的 server 后执行 PROBE_SERVER=http://127.0.0.1:3237 npm run probe:feed
 */
export {}

const SERVER = (process.env.PROBE_SERVER ?? 'http://127.0.0.1:3237').replace(/\/+$/, '')
let passed = 0
let failed = 0

function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { passed += 1; console.log(`  ✓ ${label}${detail === '' ? '' : `  ${detail}`}`) }
  else { failed += 1; console.log(`  ✗ ${label}${detail === '' ? '' : `  ${detail}`}`) }
}

async function req(path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { ...((init?.headers as Record<string, string> | undefined) ?? {}) }
  if (init?.body !== undefined) headers['content-type'] = 'application/json'
  const response = await fetch(`${SERVER}${path}`, { ...init, headers })
  const text = await response.text()
  return { status: response.status, body: text === '' ? null : JSON.parse(text) }
}

console.log('\n=== 朋友圈文字动态 ===')
const board = await req('/api/moments', { method: 'POST', body: JSON.stringify({ content: '验收·留言板', channel: 'board' }) })
check('留言板旧入口仍可创建', board.status === 201 && board.body?.channel === 'board')

const feed = await req('/api/moments', { method: 'POST', body: JSON.stringify({ content: '验收·朋友圈动态', channel: 'feed' }) })
check('朋友圈动态创建 201', feed.status === 201 && feed.body?.channel === 'feed')
const feedId = feed.body?.id as string

const boardList = await req('/api/moments')
check('默认留言板列表不混入朋友圈', boardList.status === 200 && boardList.body.items.some((item: any) => item.id === board.body?.id) && !boardList.body.items.some((item: any) => item.id === feedId))
const feedList = await req('/api/moments?channel=feed')
check('朋友圈列表只返回 feed', feedList.status === 200 && feedList.body.items.some((item: any) => item.id === feedId) && feedList.body.items.every((item: any) => item.channel === 'feed'))

const direct = await req(`/api/moments/${encodeURIComponent(feedId)}`)
check('朋友圈动态可按 id 追溯来源', direct.status === 200 && direct.body?.channel === 'feed')
const updated = await req(`/api/moments/${encodeURIComponent(feedId)}`, { method: 'PATCH', body: JSON.stringify({ content: '验收·朋友圈动态（已编辑）' }) })
check('用户可编辑自己的动态', updated.status === 200 && updated.body?.content.includes('已编辑'))

const invalid = await req('/api/moments', { method: 'POST', body: JSON.stringify({ content: '验收·非法频道', channel: 'unknown' }) })
check('非法频道拒绝写入', invalid.status === 400)
const deleted = await req(`/api/moments/${encodeURIComponent(feedId)}`, { method: 'DELETE' })
check('用户可删除自己的动态', deleted.status === 204)
const afterDelete = await req('/api/moments?channel=feed')
check('删除后朋友圈列表不再返回动态', afterDelete.status === 200 && !afterDelete.body.items.some((item: any) => item.id === feedId))

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exitCode = 1
