/** Core-4 Desire 影子层验收：事件输入、衰减、候选、阻断、满足审计与正文隔离。 */
import '../src/lib/env.js'

import { rmSync } from 'node:fs'
import { resolve } from 'node:path'

const dbPath = `./data/probe-desire-core4-${process.pid}.db`
process.env.HABITAT_DB_PATH = dbPath
for (const suffix of ['', '-shm', '-wal']) rmSync(resolve(`${dbPath}${suffix}`), { force: true })

const { closeDb } = await import('../src/db/index.js')
const { listDesireAudits } = await import('../src/db/desire.js')
const { DesireEngine } = await import('../src/services/desire.js')

let passed = 0
let failed = 0
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { passed += 1; console.log(`  ✓ ${label}${detail === '' ? '' : `  ${detail}`}`) }
  else { failed += 1; console.log(`  ✗ ${label}${detail === '' ? '' : `  ${detail}`}`) }
}

const engine = new DesireEngine()
const start = Date.parse('2026-09-29T00:00:00.000Z')
try {
  const initial = engine.current(start)
  check('初始状态是 shadow 且八维均有基线', initial.mode === 'shadow' && Object.keys(initial.values).length === 8)

  const warm = engine.observe({ source: 'chat', signal: 'chat.warm', speaker: 'user', text: '这段正文不应进入 Desire 审计', refId: 'chat-probe', at: start })
  check('聊天暖意事件会提高联系倾向', warm.values.attachment > 0.5 && warm.values.social > 0.5)
  check('审计只保存 signal，不保存原始正文', !JSON.stringify(listDesireAudits()).includes('这段正文不应进入 Desire 审计'))

  let curious = warm
  for (let index = 1; index <= 4; index += 1) {
    curious = engine.observe({ source: 'chat', signal: 'chat.question', speaker: 'user', at: start + index * 60_000 })
  }
  const surfCandidate = curious.candidates.find((candidate) => candidate.action === 'surf')
  check('重复问题形成可审计的候选意图', surfCandidate !== undefined && surfCandidate.status === 'candidate')
  if (surfCandidate !== undefined) {
    const skipped = engine.satisfy(surfCandidate.id, 'failed', start + 5 * 60_000)
    check('失败行动不会 satisfy 候选', skipped.candidates.some((candidate) => candidate.id === surfCandidate.id && candidate.status === 'candidate'))
    const satisfied = engine.satisfy(surfCandidate.id, 'completed', start + 6 * 60_000)
    check('只有 completed 才会 satisfy 并留下完成状态', satisfied.candidates.some((candidate) => candidate.id === surfCandidate.id && candidate.status === 'satisfied'))
  }

  const noopBefore = engine.current(start + 7 * 60_000)
  const noopAfter = engine.observe({ source: 'manual', signal: 'noop', at: start + 7 * 60_000 })
  check('没有有效信号时允许 no-op，不凭空增加倾向', JSON.stringify(noopBefore.values) === JSON.stringify(noopAfter.values))

  let strained = noopAfter
  for (let index = 1; index <= 14; index += 1) {
    strained = engine.observe({ source: 'eventide', signal: 'eventide.tick', statePayload: { fatigue: 1, stress: 1 }, at: start + (7 + index) * 60_000 })
  }
  check('Eventide 数值输入会进入 Desire 影子状态', strained.values.fatigue > 0.7 && strained.values.stress > 0.7)
  check('疲劳 / 紧绷会给候选加阻断，而不是强行执行', strained.candidates.every((candidate) => candidate.blockedBy.includes('fatigue') || candidate.blockedBy.includes('stress') || candidate.status !== 'candidate'))

  const future = engine.tick(start + 12 * 60 * 60 * 1000)
  check('长时间 tick 会让倾向向基线衰减', Math.abs(future.values.fatigue - 0.5) < Math.abs(strained.values.fatigue - 0.5))
  check('tick 与候选变化均留下审计记录', listDesireAudits(200).length >= 20)
} finally {
  closeDb()
  for (const suffix of ['', '-shm', '-wal']) rmSync(resolve(`${dbPath}${suffix}`), { force: true })
}

console.log(`\n=== Core-4 Desire shadow：${passed} passed / ${failed} failed ===`)
process.exitCode = failed === 0 ? 0 : 1
