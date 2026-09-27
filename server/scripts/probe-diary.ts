/**
 * Phase 6.5 · 共同生活数据（日记 / 留言板）迁到服务端后的**权限边界**验收。
 *
 * 重点不是「CRUD 跑得通」——那是最容易的部分，也是唯一不重要的部分。
 * 要验的是**边界**：
 * - AI 的私密日记：用户看得到它存在（封面），但拿不到正文
 * - AI 的日记：用户改不了也删不了（返回 404 而非 403，理由见 `routes/diary.ts`）
 * - 用户自己的日记不受这些限制 —— 否则 2026-09-24 的迁移会让北北已写好的日记变成只读
 * - 「拒绝」不能等价于「删掉」：被拒之后那条日记必须还在
 * - 搬迁入口幂等：重复调不产生副本、更不覆盖服务端已有的内容
 *
 * 跑法（需要已起的 server，且 DB 是隔离的）：
 *   PROBE_SERVER=http://127.0.0.1:3100 npx tsx scripts/probe-diary.ts
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

interface DiaryView {
  id: string
  title: string
  content: string | null
  entryDate: string
  author: string
  visibility: string
  readable: boolean
  editable: boolean
}

interface MomentView {
  id: string
  content: string
  author: string
}

async function req(path: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = { ...((init?.headers as Record<string, string> | undefined) ?? {}) }
  // ⚠️ 只在**真的有 body** 时才声明 JSON。DELETE 没有 body，若仍带上
  //    `content-type: application/json`，Fastify 会去解析空 body 并抛错 —— 而那个错
  //    被统一错误处理器兜成 500，看起来像「服务端崩了」，其实只是探针自己发得不对。
  if (init?.body !== undefined) headers['content-type'] = 'application/json'
  const res = await fetch(`${SERVER}${path}`, { ...init, headers })
  const text = await res.text()
  let body: unknown = null
  if (text !== '') {
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
  }
  return { status: res.status, body }
}

function json(value: unknown): RequestInit {
  return { method: 'POST', body: JSON.stringify(value) }
}

const diaryList = async (): Promise<DiaryView[]> => ((await req('/api/diary')).body as { items: DiaryView[] }).items
const getDiary = async (id: string): Promise<DiaryView> => (await req(`/api/diary/${id}`)).body as DiaryView

/* ----------------------------------------------------------- 1. 用户自己的日记 */
console.log('\n=== 1. 用户自己的日记：完整可读写 ===')
const created = await req('/api/diary', json({ title: '验收·我的日记', content: '这是用户自己写的一段。', entryDate: '2026-09-24' }))
const mine = created.body as DiaryView
check('新建返回 201', created.status === 201, `status=${created.status}`)
check('author 由服务端固定为 user', mine.author === 'user', `author=${mine.author}`)
check('visibility 默认 open', mine.visibility === 'open', `visibility=${mine.visibility}`)
check('自己写的读得到正文', mine.readable && mine.content === '这是用户自己写的一段。')
check('自己写的可编辑', mine.editable)

const patched = await req(`/api/diary/${mine.id}`, {
  method: 'PATCH',
  body: JSON.stringify({ title: '验收·改过标题', content: '改过的正文。', entryDate: '2026-09-23' }),
})
check('改自己的日记成功', patched.status === 200 && (patched.body as DiaryView).title === '验收·改过标题', `status=${patched.status}`)

/* ----------------------------------------------------- 2. AI 的私密日记（边界） */
console.log('\n=== 2. AI 的私密日记：看得到存在，读不到正文，改不动 ===')
// 用搬迁入口塞一条 AI 的日记 —— 这是「AI 侧写日记」的既有通道，不需要为验收单开后门
await req('/api/diary/import', json({
  items: [
    { id: 'probe-secret', title: '验收·小栖的私密日记', content: '这段话用户不该看到。', entryDate: '2026-09-22', author: 'companion', visibility: 'private' },
    { id: 'probe-open', title: '验收·小栖公开的日记', content: '这一段小栖同意给你看。', entryDate: '2026-09-21', author: 'companion', visibility: 'open' },
    { id: 'probe-locked', title: '验收·被锁的日记', content: '锁着的内容。', entryDate: '2026-09-20', author: 'companion', visibility: 'locked' },
  ],
}))

const list = await diaryList()
const secret = list.find((item) => item.id === 'probe-secret')
check('私密日记在列表里「存在」——封面可见', secret !== undefined)
check('正文不下发（content 为 null，不是空串）', secret?.content === null, `content=${JSON.stringify(secret?.content)}`)
check('readable 明确为 false', secret?.readable === false)
check('editable 明确为 false', secret?.editable === false)

const secretDetail = await getDiary('probe-secret')
check('单篇接口同样不给正文', secretDetail.content === null && secretDetail.readable === false)
check('单篇接口仍要求它存在（200 而非 404）', (await req('/api/diary/probe-secret')).status === 200)
check('author 原样告知「这是小栖写的」', secretDetail.author === 'companion')

const patchSecret = await req('/api/diary/probe-secret', {
  method: 'PATCH',
  body: JSON.stringify({ title: '篡改', content: '篡改', entryDate: '2026-09-22' }),
})
check('改 AI 的日记被拒（404）', patchSecret.status === 404, `status=${patchSecret.status}`)

const delSecret = await req('/api/diary/probe-secret', { method: 'DELETE' })
check('删 AI 的日记被拒（404）', delSecret.status === 404, `status=${delSecret.status}`)

// 「拒绝」必须只是拒绝 —— 被拒之后它还得好端端地在
check('拒绝之后日记仍在（拒绝 ≠ 删除）', (await req('/api/diary/probe-secret')).status === 200)
check('拒绝之后内容没被改动', (await getDiary('probe-secret')).title === '验收·小栖的私密日记')

/* ------------------------------------------------- 3. 开放 / 锁定的可见性语义 */
console.log('\n=== 3. 开放与锁定 ===')
const openOne = await getDiary('probe-open')
check('开放的日记能读到正文', openOne.readable && openOne.content === '这一段小栖同意给你看。')
check('但开放 ≠ 归用户 —— 仍然不可编辑', openOne.editable === false)

const locked = await getDiary('probe-locked')
check('锁定的日记同样不给正文', locked.content === null && locked.readable === false)
check('锁定的可见性如实下发（前端据此说「被锁着」）', locked.visibility === 'locked')

/* --------------------------------------------------------- 4. 搬迁入口幂等 */
console.log('\n=== 4. 搬迁入口幂等 ===')
const reimport = await req('/api/diary/import', json({
  items: [{ id: 'probe-secret', title: '覆盖攻击', content: '不该覆盖。', entryDate: '2026-09-22' }],
}))
const reimportBody = reimport.body as { imported: number; skipped: number }
check('重复导入同一 id 被跳过', reimportBody.imported === 0 && reimportBody.skipped === 1, JSON.stringify(reimportBody))
check('已存在的记录不被覆盖', (await getDiary('probe-secret')).title === '验收·小栖的私密日记')

/* ------------------------------------------------------- 5. 排序与输入校验 */
console.log('\n=== 5. 排序与输入校验 ===')
const dates = (await diaryList()).map((item) => item.entryDate)
check('按 entryDate 倒序', dates.every((value, index) => index === 0 || dates[index - 1]! >= value), dates.join(' '))

const badDate = await req('/api/diary', json({ title: 't', content: 'c', entryDate: '2026/09/24' }))
check('entryDate 非 YYYY-MM-DD → 400', badDate.status === 400, `status=${badDate.status}`)
const emptyTitle = await req('/api/diary', json({ title: '   ', content: 'c', entryDate: '2026-09-24' }))
check('空标题 → 400', emptyTitle.status === 400, `status=${emptyTitle.status}`)
const longContent = await req('/api/diary', json({ title: 't', content: 'x'.repeat(10001), entryDate: '2026-09-24' }))
check('正文超 10000 字 → 400', longContent.status === 400, `status=${longContent.status}`)
check('不存在的日记 → 404', (await req('/api/diary/not-exist')).status === 404)

/* ------------------------------------------------------------- 6. 留言板 */
console.log('\n=== 6. 留言板 ===')
const madeMoment = await req('/api/moments', json({ content: '验收留言' }))
const moment = madeMoment.body as MomentView
check('留言创建 201', madeMoment.status === 201, `status=${madeMoment.status}`)
check('author 固定 user', moment.author === 'user')

await req('/api/moments/import', json({
  items: [{ id: 'probe-moment-ai', content: '小栖的留言', author: 'companion', createdAt: Date.now(), updatedAt: Date.now() }],
}))
const moments = ((await req('/api/moments')).body as { items: MomentView[] }).items
const aiMoment = moments.find((item) => item.id === 'probe-moment-ai')
check('列表含 AI 的留言', aiMoment !== undefined && aiMoment.author === 'companion')
check('留言板不做可见性过滤（写出来就是给人看的）', aiMoment?.content === '小栖的留言')

const editedMoment = await req(`/api/moments/${moment.id}`, { method: 'PATCH', body: JSON.stringify({ content: '验收留言·已编辑' }) })
check('用户能编辑自己的留言', editedMoment.status === 200 && (editedMoment.body as MomentView).content === '验收留言·已编辑')
check('编辑不会改变留言作者', (editedMoment.body as MomentView).author === 'user')
check('改 AI 的留言被拒（404）', (await req('/api/moments/probe-moment-ai', { method: 'PATCH', body: JSON.stringify({ content: '越权修改' }) })).status === 404)

check('删 AI 的留言被拒（404）', (await req('/api/moments/probe-moment-ai', { method: 'DELETE' })).status === 404)
check('删自己的留言 → 204', (await req(`/api/moments/${moment.id}`, { method: 'DELETE' })).status === 204)
check('删掉后确实没有了', ((await req('/api/moments')).body as { items: MomentView[] }).items.every((item) => item.id !== moment.id))

const limited = ((await req('/api/moments?limit=1')).body as { items: MomentView[] }).items
check('limit=1 只返回一条', limited.length === 1, `len=${limited.length}`)
check('limit=0 → 400', (await req('/api/moments?limit=0')).status === 400)
check('多条留言按 createdAt 倒序', ((await req('/api/moments')).body as { items: MomentView[] }).items.length >= 1)

/* ------------------------------------------------------------------ 7. 清理 */
console.log('\n=== 7. 清理自己的日记 ===')
check('删自己的日记 → 204', (await req(`/api/diary/${mine.id}`, { method: 'DELETE' })).status === 204)
check('删掉后确实没有了', (await req(`/api/diary/${mine.id}`)).status === 404)

console.log(`\n=== 日记 / 留言板验收：${passed} passed / ${failed} failed ===`)
process.exitCode = failed === 0 ? 0 : 1
