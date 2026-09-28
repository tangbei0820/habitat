/** Chat 关系互动验收：状态、双向申请、到期恢复、事件留痕。 */
import { rmSync } from 'node:fs'
import { resolve } from 'node:path'

const probeDb = resolve('.workbuddy/relationship-probe.db')
rmSync(probeDb, { force: true })
rmSync(`${probeDb}-wal`, { force: true })
rmSync(`${probeDb}-shm`, { force: true })
process.env.HABITAT_DB_PATH = probeDb

const { getRelationshipSnapshot, pauseRelationship, pokeRelationship, requestRelationshipRecovery, decideRelationshipRecovery } = await import('../src/db/relationship.js')
const { listEventLogs } = await import('../src/db/activity.js')
const { CAPABILITY_DEFINITIONS } = await import('../../shared/capabilities.js')
const { executeTool } = await import('../src/capabilities/tools.js')
type ToolRuntime = import('../src/capabilities/tools.js').ToolRuntime
type BoundTool = import('../src/capabilities/tools.js').BoundTool
type CapabilityService = import('../src/capabilities/registry.js').CapabilityService

let passed = 0
let failed = 0
function check(label: string, ok: boolean): void {
  if (ok) { passed += 1; console.log(`  ✓ ${label}`) }
  else { failed += 1; console.log(`  ✗ ${label}`) }
}

console.log('\n=== Chat relationship probe ===')
const start = Date.now()
const paused = pauseRelationship('user', '需要安静一下', 120, start)
check('暂停状态落库', paused.state.status === 'paused' && paused.state.pausedBy === 'user')
check('暂停最长被限制为 60 分钟', paused.state.expiresAt !== null && paused.state.expiresAt - start <= 60 * 60_000)

const firstRequest = requestRelationshipRecovery('user', start + 1_000)
const duplicate = requestRelationshipRecovery('user', start + 2_000)
check('用户恢复申请交给 Companion 决定', firstRequest.decider === 'companion' && firstRequest.status === 'pending')
check('重复申请复用同一待处理记录', duplicate.id === firstRequest.id)
const denied = decideRelationshipRecovery(firstRequest.id, 'companion', false, start + 3_000)
check('Companion 可以拒绝恢复且暂停仍有效', denied.state.status === 'paused' && denied.requests.some((item) => item.id === firstRequest.id && item.status === 'denied'))

const companionRequest = requestRelationshipRecovery('companion', start + 4_000)
const approved = decideRelationshipRecovery(companionRequest.id, 'user', true, start + 5_000)
check('用户可以同意 Companion 的恢复申请', approved.state.status === 'active' && approved.requests.some((item) => item.id === companionRequest.id && item.status === 'approved'))

const pausedAgain = pauseRelationship('companion', null, 1, start + 6_000)
check('Companion 可以发起暂停', pausedAgain.state.pausedBy === 'companion')
const afterExpiry = getRelationshipSnapshot(start + 6_000 + 61_000)
check('到期自动恢复且不再阻断', afterExpiry.state.status === 'active')

const poke = pokeRelationship('user', start + 70_000)
check('拍一拍只留下关系事件、不创建恢复申请', poke.state.status === 'active' && poke.requests.length >= 2)
const events = listEventLogs(50).map((event) => event.eventType)
check('暂停 / 恢复 / 拍一拍均写入事件日志', events.includes('relationship.paused') && events.includes('relationship.auto_resumed') && events.includes('relationship.poked'))

const relationshipDefinitions = CAPABILITY_DEFINITIONS.filter((item) => item.module === 'relationship')
check('能力注册表公开四项关系工具', relationshipDefinitions.length === 4 && relationshipDefinitions.every((item) => item.tool !== undefined))
const fakeCapabilities = { snapshot: async () => [] } as unknown as CapabilityService
const runtime: ToolRuntime = { memory: null, state: null, capabilities: fakeCapabilities }
const bound = (id: string): BoundTool => {
  const definition = relationshipDefinitions.find((item) => item.id === id)
  if (definition === undefined || definition.tool === undefined) throw new Error(`missing capability ${id}`)
  return {
    name: definition.tool.name,
    capabilityId: definition.id,
    label: definition.label,
    source: '关系互动',
    description: definition.tool.description,
    parameters: definition.tool.parameters,
    autonomy: definition.autonomy,
  }
}
const pokeOutcome = await executeTool(bound('relationship.poke'), { id: 'probe-poke', name: 'relationship_poke', arguments: '{}' }, runtime)
check('Companion 拍一拍工具真实执行', pokeOutcome.ok)
const toolPaused = await executeTool(bound('relationship.pause'), { id: 'probe-pause', name: 'relationship_pause', arguments: JSON.stringify({ durationMinutes: 1 }) }, runtime)
check('Companion 暂停工具真实执行', toolPaused.ok && getRelationshipSnapshot().state.status === 'paused')
const toolRequest = await executeTool(bound('relationship.request_recovery'), { id: 'probe-request', name: 'relationship_request_recovery', arguments: '{}' }, runtime)
const pendingRequest = getRelationshipSnapshot().requests.find((item) => item.requestedBy === 'companion' && item.status === 'pending')
check('Companion 恢复申请工具真实执行', toolRequest.ok && pendingRequest !== undefined && pendingRequest.decider === 'user')
if (pendingRequest !== undefined) {
  const userRequest = requestRelationshipRecovery('user', Date.now())
  const decisionOutcome = await executeTool(bound('relationship.decide_recovery'), { id: 'probe-decision', name: 'relationship_decide_recovery', arguments: JSON.stringify({ requestId: userRequest.id, decision: 'approve' }) }, runtime)
  check('Companion 决定用户恢复申请工具真实执行', decisionOutcome.ok && getRelationshipSnapshot().state.status === 'active')
}

console.log(`\n=== Chat relationship probe：${passed} passed / ${failed} failed ===`)
process.exitCode = failed === 0 ? 0 : 1
