/**
 * 诊断日志**保留策略**验收脚本（**不需要 server**，自带一次性临时库）
 *
 * 用法：npx tsx scripts/probe-diag-retention.ts
 *
 * 为什么要独立一个库：`pruneMcpDiagnostics` 是**真的删行**，而保留策略要验的恰恰是
 * 「删对没有」—— 拿仓库正在用的库跑，等于拿真实记录做实验。这里把 `HABITAT_DB_PATH`
 * 指到一个一次性文件（用「顶层 await + 动态 import」保证它先于 `db/index.js` 求值），
 * 跑完连 WAL 一起删掉，不碰任何既有数据。
 *
 * 覆盖：不足上限不裁 / 超量裁掉最旧的 / 保留条数与「留下的是哪些」都对 / 幂等（再跑不删）/
 *       非法 keep 不碰库。
 * 退出码非 0 表示有断言失败。
 */
import { rmSync } from 'node:fs'
import { resolve } from 'node:path'

const DB_PATH = './data/probe-retention.db'
process.env.HABITAT_DB_PATH = DB_PATH
for (const suffix of ['', '-shm', '-wal']) rmSync(resolve(`${DB_PATH}${suffix}`), { force: true })

const { insertMcpDiagnostic, listMcpDiagnostics, pruneMcpDiagnostics } = await import(
  '../src/db/diagnostics.js'
)
const { closeDb } = await import('../src/db/index.js')

let passed = 0
let failed = 0

function check(label: string, ok: boolean, extra = ''): void {
  const suffix = extra === '' ? '' : `  ${extra}`
  if (ok) {
    passed += 1
    console.log(`  ✓ ${label}${suffix}`)
  } else {
    failed += 1
    console.log(`  ✗ ${label}${suffix}`)
  }
}

/** 插 count 条，`at` 用连续序列，好断言「留下来的到底是哪些」 */
function seed(count: number): void {
  for (let i = 0; i < count; i += 1) {
    insertMcpDiagnostic({
      serverId: 'probe-retention',
      direction: 'out',
      method: 'tools/list',
      httpStatus: 200,
      handshake: false,
      latencyMs: 1,
      error: null,
      at: i,
    })
  }
}

/** 库里现在有多少条 + 最旧 / 最新那条的 at（走真实读路径，不另开连接） */
function snapshot(): { total: number; newest: number | undefined; oldest: number | undefined } {
  const page = listMcpDiagnostics({ limit: 500 })
  return {
    total: page.total,
    newest: page.entries[0]?.at,
    oldest: page.entries[page.entries.length - 1]?.at,
  }
}

console.log('\n=== 1. 不足上限时什么都不裁 ===')
seed(30)
check('先塞 30 条', snapshot().total === 30, `total=${snapshot().total}`)
check('keep=100 > 现有条数 → 删除 0 条', pruneMcpDiagnostics(100) === 0)
check('库未被改动', snapshot().total === 30, `total=${snapshot().total}`)

console.log('\n=== 2. 超量时裁掉最旧的 ===')
check('keep=20 → 删除 10 条', pruneMcpDiagnostics(20) === 10)
const after = snapshot()
check('保留条数精确等于 keep', after.total === 20, `total=${after.total}`)
check('留下的是**最新**的：最新一条 at=29', after.newest === 29, `newest=${after.newest}`)
check('最旧一条 at=10（前 10 条被裁）', after.oldest === 10, `oldest=${after.oldest}`)

console.log('\n=== 3. 幂等：再跑一次不删 ===')
check('keep=20 再跑一次 → 0 条', pruneMcpDiagnostics(20) === 0)
check('库仍是 20 条', snapshot().total === 20)

console.log('\n=== 4. 非法 keep 不碰库 ===')
check('keep=0 → 0 条', pruneMcpDiagnostics(0) === 0)
check('keep=-5 → 0 条', pruneMcpDiagnostics(-5) === 0)
check('keep=1.5（非整数）→ 0 条', pruneMcpDiagnostics(1.5) === 0)
check('库始终没被动过', snapshot().total === 20, `total=${snapshot().total}`)

console.log('\n=== 5. 裁到只剩 1 条 ===')
check('keep=1 → 删除 19 条', pruneMcpDiagnostics(1) === 19)
const last = snapshot()
check('只剩最新那条', last.total === 1 && last.newest === 29, `total=${last.total} newest=${last.newest}`)

console.log(`\n=== 汇总：通过 ${passed} / ${passed + failed} ===`)
if (failed > 0) process.exitCode = 1

// 收尾：关连接 + 删临时库（含 WAL），不给下次运行留残渣
closeDb()
for (const suffix of ['', '-shm', '-wal']) rmSync(resolve(`${DB_PATH}${suffix}`), { force: true })
