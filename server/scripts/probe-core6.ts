import '../src/lib/env.js'

import { rmSync } from 'node:fs'
import { resolve } from 'node:path'
import type { BodyStateSnapshot } from '@shared/types.js'

const dbPath = `./data/probe-core6-${process.pid}.db`
process.env.HABITAT_DB_PATH = dbPath
for (const suffix of ['', '-shm', '-wal']) rmSync(resolve(`${dbPath}${suffix}`), { force: true })

const { closeDb } = await import('../src/db/index.js')
const { createEvent, getEvent, listEvents, revokeEvent } = await import('../src/db/event.js')
const { listNotifications } = await import('../src/db/activity.js')
const { requestToolConfirm } = await import('../src/services/event-inbox.js')
const { describeState } = await import('../../shared/state-summary.js')

let passed = 0
let failed = 0
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) { passed += 1; console.log(`  ✓ ${label}${detail === '' ? '' : `  ${detail}`}`) }
  else { failed += 1; console.log(`  ✗ ${label}${detail === '' ? '' : `  ${detail}`}`) }
}

try {
  const first = requestToolConfirm({
    capabilityId: 'diary.create',
    toolName: 'diary_create',
    args: { title: 'Core-6 probe', content: '确认卡不应在批准前写入。', entryDate: '2026-09-29' },
  })
  check('高风险工具先进入 pending，不产生执行结果', first.ok && first.event.status === 'pending')

  if (first.ok) {
    const duplicate = requestToolConfirm({
      capabilityId: 'diary.create',
      toolName: 'diary_create',
      args: { title: 'Core-6 probe', content: '确认卡不应在批准前写入。', entryDate: '2026-09-29' },
    })
    check('重复提交复用同一待决事件', duplicate.ok && duplicate.event.id === first.event.id)
    const notices = listNotifications(50).filter((item) => item.metadata.eventId === first.event.id)
    check('新确认事件留下站内通知且只留一条', notices.length === 1 && notices[0]?.metadata.route === '/life?view=records&tab=events')

    const revoked = revokeEvent(first.event.id, 'user')
    check('用户撤回后进入终态且保留审计', revoked?.status === 'revoked' && listEvents().some((item) => item.id === first.event.id && item.result !== null))
  }

  const expired = createEvent({
    kind: 'tool_confirm',
    decider: 'user',
    title: 'Core-6 expiry probe',
    payload: { toolName: 'diary_create', args: { title: 'expired', content: 'expired' } },
    expiresInMs: -1,
  })
  check('过期 pending 会被收敛为 expired', getEvent(expired.id)?.status === 'expired')

  const snapshot: BodyStateSnapshot = {
    state: {
      heat: { value: 30, level: '中低', description: '身体有一点热意，但还能很快收住', label: '热度' },
      pressure: { value: 25, level: '中低', description: '有一点没说出口的急，但还不重', label: '压抑感' },
      unknown_nested: { value: { inner: true }, label: '未知状态' },
    },
    stateCard: null,
    payload: {},
    settledAt: Date.now(),
  }
  const summary = describeState(snapshot)
  const rendered = JSON.stringify(summary)
  check('生产 Eventide 字段有生活化标签与数值', summary.fields.some((field) => field.label === '热度' && field.value.includes('30') && field.value.includes('中低')))
  check('未知动态字段安全回退且不出现 [object Object]', summary.fields.some((field) => field.label === '未知状态') && !rendered.includes('[object Object]'))
} finally {
  closeDb()
  for (const suffix of ['', '-shm', '-wal']) rmSync(resolve(`${dbPath}${suffix}`), { force: true })
}

console.log(`\n=== Core-6 Runtime trust probe：${passed} passed / ${failed} failed ===`)
process.exitCode = failed === 0 ? 0 : 1
