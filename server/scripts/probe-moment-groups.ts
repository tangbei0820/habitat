/**
 * 留言板分组 / 历史筛选端到端验收（T-106）。
 * 跑法：启动隔离 DB 的 server 后执行 PROBE_SERVER=http://127.0.0.1:3237 npm run probe:moment-groups
 */
export {}

const SERVER = (process.env.PROBE_SERVER ?? 'http://127.0.0.1:3237').replace(/\/+$/, '')
let passed = 0
let failed = 0

function check(label: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed += 1
    console.log(`  ✓ ${label}${detail === '' ? '' : `  ${detail}`}`)
  } else {
    failed += 1
    console.log(`  ✗ ${label}${detail === '' ? '' : `  ${detail}`}`)
  }
}

async function req(path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { ...((init?.headers as Record<string, string> | undefined) ?? {}) }
  if (init?.body !== undefined) headers['content-type'] = 'application/json'
  const response = await fetch(`${SERVER}${path}`, { ...init, headers })
  const text = await response.text()
  return { status: response.status, body: text === '' ? null : JSON.parse(text) }
}

console.log('\n=== 留言板分组 / 历史筛选 ===')
const createdGroup = await req('/api/moment-groups', { method: 'POST', body: JSON.stringify({ name: '验收分组' }) })
check('创建分组 201', createdGroup.status === 201)
const groupId = createdGroup.body?.id as string
check('分组返回稳定 id', typeof groupId === 'string' && groupId !== '')

const duplicate = await req('/api/moment-groups', { method: 'POST', body: JSON.stringify({ name: '验收分组' }) })
check('重复分组明确失败', duplicate.status === 400)

const createdMoment = await req('/api/moments', { method: 'POST', body: JSON.stringify({ content: '验收·分组留言', groupId }) })
check('创建带分组留言 201', createdMoment.status === 201 && createdMoment.body?.groupId === groupId)
const direct = await req(`/api/moments/${encodeURIComponent(createdMoment.body.id)}`)
check('按 id 读取留言', direct.status === 200 && direct.body?.id === createdMoment.body?.id)
const grouped = await req(`/api/moments?groupId=${encodeURIComponent(groupId)}`)
check('按分组筛选', grouped.status === 200 && grouped.body.items.some((item: any) => item.id === createdMoment.body?.id))

const renamed = await req(`/api/moment-groups/${encodeURIComponent(groupId)}`, { method: 'PATCH', body: JSON.stringify({ name: '验收分组·改名' }) })
check('分组改名', renamed.status === 200 && renamed.body?.name === '验收分组·改名')

const movedOut = await req(`/api/moments/${encodeURIComponent(createdMoment.body.id)}/group`, { method: 'PUT', body: JSON.stringify({ groupId: null }) })
check('留言移出分组', movedOut.status === 200 && movedOut.body?.groupId === null)
const ungrouped = await req('/api/moments?groupId=none')
check('未分组筛选', ungrouped.status === 200 && ungrouped.body.items.some((item: any) => item.id === createdMoment.body?.id))

const second = await req('/api/moments', { method: 'POST', body: JSON.stringify({ content: '验收·删组回退', groupId }) })
const deleted = await req(`/api/moment-groups/${encodeURIComponent(groupId)}`, { method: 'DELETE' })
check('删除分组只回退留言', deleted.status === 200 && deleted.body?.moved === 1)
const afterDelete = await req('/api/moments?groupId=none')
check('删除分组不删除留言', afterDelete.status === 200 && afterDelete.body.items.some((item: any) => item.id === second.body?.id))

const invalid = await req('/api/moments', { method: 'POST', body: JSON.stringify({ content: '验收·非法分组', groupId: 'missing-group' }) })
check('非法分组拒绝写入', invalid.status === 404)
const missing = await req('/api/moments/missing-moment')
check('不存在留言返回 404', missing.status === 404)

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exitCode = 1
