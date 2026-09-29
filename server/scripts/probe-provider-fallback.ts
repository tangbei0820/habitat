/** Provider Center 聊天回退策略探针：兼容 env、顺序持久化、能力校验与删除保护。 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const directory = mkdtempSync(join(tmpdir(), 'habitat-provider-fallback-'))
process.env.HABITAT_DB_PATH = join(directory, 'habitat.db')

let passed = 0
let failed = 0
function check(label: string, ok: boolean): void {
  if (ok) { passed += 1; console.log(`  ✓ ${label}`) }
  else { failed += 1; console.log(`  ✗ ${label}`) }
}

try {
  const { createProfile } = await import('../src/db/profiles.js')
  const { getChatFallbackConfig, saveChatFallbackConfig } = await import('../src/db/provider-fallback.js')
  const { profileBindingReferences } = await import('../src/db/provider-center.js')

  const makeChat = (id: string, active = false) => createProfile({
    name: id,
    provider: 'openai-compat',
    baseUrl: `http://${id}.test/v1`,
    modelMap: { chat: `model-${id}` },
    isActive: active,
  })
  const primary = makeChat('primary', true)
  const first = makeChat('fallback-one')
  const second = makeChat('fallback-two')
  const third = makeChat('fallback-three')
  const fourth = makeChat('fallback-four')
  const voice = createProfile({
    name: 'voice-only', provider: 'elevenlabs', baseUrl: 'https://api.elevenlabs.io/v1',
    modelMap: { tts: 'eleven_multilingual_v2' },
  })

  const fromEnv = getChatFallbackConfig({ HABITAT_CHAT_FALLBACK_PROFILE_ID: first.id })
  check('未保存时兼容读取旧环境变量', fromEnv.source === 'environment' && fromEnv.profileIds[0] === first.id)

  const saved = saveChatFallbackConfig({ enabled: true, profileIds: [second.id, first.id, second.id] })
  check('保存后保留顺序并去重', saved.source === 'saved' && saved.enabled && saved.profileIds.join(',') === `${second.id},${first.id}`)
  const reread = getChatFallbackConfig({ HABITAT_CHAT_FALLBACK_PROFILE_ID: third.id })
  check('保存策略优先于旧环境变量', reread.source === 'saved' && reread.profileIds[0] === second.id)

  let rejectedMedia = false
  try { saveChatFallbackConfig({ enabled: true, profileIds: [voice.id] }) } catch { rejectedMedia = true }
  check('拒绝只能提供语音的连接', rejectedMedia)

  let rejectedTooMany = false
  try { saveChatFallbackConfig({ enabled: true, profileIds: [first.id, second.id, third.id, fourth.id] }) } catch { rejectedTooMany = true }
  check('最多限制三条备用连接', rejectedTooMany)

  const refs = profileBindingReferences(second.id)
  check('备用链引用会阻止误删 Provider', refs.includes('主聊天备用链'))
  const disabled = saveChatFallbackConfig({ enabled: false, profileIds: [] })
  check('可以关闭备用链并清空顺序', !disabled.enabled && disabled.profileIds.length === 0)
  check('关闭后不再阻止备用连接删除', !profileBindingReferences(second.id).includes('主聊天备用链'))
  check('探针主连接仍可识别', primary.id === 'primary')
} finally {
  // better-sqlite3 连接由服务端单例持有，Windows 不能在当前进程内删除数据库文件。
  try { rmSync(directory, { recursive: true, force: true }) } catch { /* 进程退出后由系统临时目录清理 */ }
}

console.log(`\nProvider fallback probe: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exitCode = 1
