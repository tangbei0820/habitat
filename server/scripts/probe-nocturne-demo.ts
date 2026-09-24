/**
 * ⛔ 已废弃（2026-09-24）—— 保留文件只为留痕，没有任何实现。
 *
 * 原用途：打 **Nocturne 官方只读 Demo**（`https://misaligned.top/mcp`，来自 `.env.example`），
 * 按该 Demo 的工具名 `read_memory` / `search_memory` 验收「我们的客户端代码对不对」——
 * 理由是「Demo 服务端物理只读，不会写坏数据」。
 *
 * 为什么废弃：2026-09-24 实测北北**自部署的实例**，真实工具面是
 *   `breath` / `trace` / `hold` / `wander` / `wander_mark` / `drive` /
 *   `undercurrent` / `trail_delta` / `trail_family`
 * 与本文档假设的 `read_memory` / `search_memory` **0/2 命中**。
 * 也就是说「按官方 Demo 的工具名写适配层」这个前提本身就是错的 ——
 * 本脚本全部断言都建立在一个不存在的工具面上，跑它只会得到无意义的失败。
 *
 * 替代品（现在该跑什么）：
 *   `scripts/probe-memory.ts`        只读链路端到端验收（mock / 真机都适用）
 *   `scripts/probe-nocturne-live.ts` 打自部署实例：反代 / Token / Namespace / 工具面 / 只读纪律
 *   `scripts/probe-nocturne-tools*`  工具面事实采集（漂移检测，绝不调用工具）
 *
 * 为什么把实现整段删掉而不是留着：留着就是 240 行**写错了血统**的代码，
 * 下次有人翻到会以为它是可用的验收脚本。历史留在本注释和 git 记录里就够了。
 * 若确认不再需要，北北可以整份删除本文件。
 */

console.log('⛔ probe-nocturne-demo.ts 已废弃（2026-09-24）')
console.log('   它验收的工具面（read_memory / search_memory）与自部署实例的真实工具面')
console.log('   （breath / trace）对不上，跑它只会得到无意义的失败，故已清空实现。')
console.log('')
console.log('   要跑的话：')
console.log('     cd server && npx tsx scripts/probe-memory.ts         # 只读链路端到端验收')
console.log('     cd server && npx tsx scripts/probe-nocturne-live.ts  # 打自部署实例的部署链路')
console.log('     cd server && npx tsx scripts/probe-nocturne-tools.ts # 工具面漂移检测')

process.exitCode = 1
