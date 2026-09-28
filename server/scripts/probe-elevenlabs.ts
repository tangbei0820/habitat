/** T-079：ElevenLabs 原生 TTS Adapter 纯逻辑验收。 */
import { ElevenLabsProvider } from '../src/providers/elevenlabs.js'

const requests: Array<{ url: string; method: string; headers: Headers; body: string }> = []
globalThis.fetch = async (input, init) => {
  const url = String(input)
  const method = init?.method ?? 'GET'
  const headers = new Headers(init?.headers)
  const body = typeof init?.body === 'string' ? init.body : ''
  requests.push({ url, method, headers, body })
  if (url.endsWith('/v1/models')) {
    return new Response(JSON.stringify([{ model_id: 'eleven_multilingual_v2' }, { model_id: 'eleven_flash_v2_5' }]), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'audio/mpeg' } })
}

const provider = new ElevenLabsProvider({
  id: 'voice-probe', name: 'Voice probe', provider: 'elevenlabs', baseUrl: 'https://api.elevenlabs.io/v1', keyRef: '',
  modelMap: { tts: 'eleven_multilingual_v2', voice: 'voice-123', voiceSettings: { stability: 0.5, similarityBoost: 0.75, speed: 1.1 } }, isActive: false,
}, 'xi-test')

let passed = 0
let failed = 0
function check(label: string, condition: boolean): void {
  if (condition) { passed += 1; console.log(`  ✓ ${label}`) } else { failed += 1; console.log(`  ✗ ${label}`) }
}

const models = await provider.listModels()
check('原生模型列表可解析 model_id', models.length === 2 && models[0] === 'eleven_multilingual_v2')

const speech = await provider.synthesize('你好，栖息地。')
const speechRequest = requests.find((request) => request.method === 'POST')
check('TTS 请求使用 xi-api-key 与原生路径', speech.audio.byteLength === 3 && speech.mimeType === 'audio/mpeg' && speechRequest?.url.endsWith('/v1/text-to-speech/voice-123') === true && speechRequest.headers.get('xi-api-key') === 'xi-test')

const payload = speechRequest === undefined ? null : JSON.parse(speechRequest.body) as Record<string, unknown>
const voiceSettings = payload?.voice_settings as Record<string, unknown> | undefined
check('TTS 请求携带 model_id、文本与声音参数', payload?.model_id === 'eleven_multilingual_v2' && payload?.text === '你好，栖息地。' && voiceSettings?.stability === 0.5 && voiceSettings?.similarity_boost === 0.75 && voiceSettings?.speed === 1.1)

const noVoice = new ElevenLabsProvider({
  id: 'missing-voice', name: 'Missing voice', provider: 'elevenlabs', baseUrl: 'https://api.elevenlabs.io/v1', keyRef: '',
  modelMap: { tts: 'eleven_multilingual_v2' }, isActive: false,
}, 'xi-test')
let missingVoice = false
try { await noVoice.synthesize('test') } catch (error) { missingVoice = error instanceof Error && error.message.includes('voice ID') }
check('未配置 voice ID 会明确拒绝', missingVoice)

console.log(`probe-elevenlabs: ${passed}/${passed + failed}`)
if (failed > 0) process.exit(1)
