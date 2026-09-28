/**
 * UI 换装第 6 批 · 补未落成功能验收（一起听真播放 / 学习伴学 / 独处空间）
 *
 * 音乐（screens-music.jsx）：
 *   - 播放器是**真的**：`<audio>` 播 `externalUrl`（验收用本脚本临时 HTTP 服务的 3 秒 WAV），
 *     听的秒数累计进 `listenSessions`，「生活 → 生活痕迹」的「一起听」格子读得到；
 *   - 「小栖也在听」这句**不搬**（没有任何机制让小栖真的在听，写上就是假装）；
 *   - 没填链接的曲目不能播 —— 按了要**说人话拒绝**，不装假进度条；
 *   - 「收下一首歌」表单与歌单是 Phase 2 原能力，字段没动（verify-home 依赖）。
 * 学习（screens-study.jsx）：
 *   - 「今天的三件小事」真实存 Dexie（studyTasks，按天归组），可加 / 勾 / 删；
 *   - 「一周节奏」是真 studyRecords 聚合；伴学卡片默认只进入到期队列，并能切到全部 / 已形成间隔查看真实进度。
 * 独处（screens-solo.jsx）：
 *   - /solo 独立页：计时真走、雨声是程序化生成（Web Audio），秒数累计 kind='rain'；
 *   - 「小栖也在听」同样不搬。
 *
 * ⚠️ 本脚本**自带清场**（单跑可重复），且必须在 verify-life-skin **之后**跑：
 *    它会留下听音秒数，会把 life-skin 的「诚实空态」断言弄脏。
 *
 * 前置：与组一相同（server:3100 + vite:5174 + CDP:9222，EDGE 需带
 *   --autoplay-policy=no-user-gesture-required，否则无头下 audio.play() 被策略拒）。
 * 环境：VERIFY_APP（默认 :5174）、VERIFY_CDP（默认 :9222）
 */
import { createServer } from 'node:http'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const CDP = process.env.VERIFY_CDP ?? 'http://127.0.0.1:9222'
const APP = process.env.VERIFY_APP ?? 'http://127.0.0.1:5174'
const OUT = fileURLToPath(new URL('../../.workbuddy', import.meta.url))
mkdirSync(OUT, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === '' ? '' : `  → ${detail}`}`)
}

/** 生成一段 n 秒 440Hz 的 WAV（真音频，能真出声/真走时长） */
function makeWav(seconds = 1) {
  const sampleRate = 8000
  const n = sampleRate * seconds
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8)
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i += 1) {
    const s = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.3
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2)
  }
  return buf
}

/**
 * 临时音频源：db 层 `optionalHttpUrl` 只收 http(s)（防 javascript: 的安全边界，不为验收放松），
 * 所以真音频由本脚本临时起的 HTTP 服务提供；脚本退出即关，不留文件不留端口。
 */
const wavBytes = makeWav(3)
const toneServer = createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': String(wavBytes.length) })
  res.end(wavBytes)
})
await new Promise((resolve) => toneServer.listen(3977, '127.0.0.1', resolve))
const TONE_URL = 'http://127.0.0.1:3977/verify-tone.wav'

const list = await (await fetch(`${CDP}/json/list`)).json()
const target = list.find((t) => t.type === 'page')
if (target === undefined) {
  console.log('找不到可用的页面 target')
  process.exit(1)
}
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  ws.onopen = resolve
  ws.onerror = reject
})

const pending = new Map()
const consoleLogs = []
let msgId = 0
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id !== undefined) {
    const p = pending.get(msg.id)
    if (p !== undefined) {
      pending.delete(msg.id)
      if (msg.error) p.reject(new Error(JSON.stringify(msg.error)))
      else p.resolve(msg.result)
    }
    return
  }
  if (msg.method === 'Runtime.consoleAPICalled') {
    consoleLogs.push(
      `[${msg.params.type}] ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`,
    )
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    consoleLogs.push(`[exception] ${msg.params.exceptionDetails.text}`)
  }
}
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++msgId
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
async function evaluate(expression) {
  const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (res.exceptionDetails !== undefined) {
    throw new Error(`${res.exceptionDetails.text} ${res.exceptionDetails.exception?.description ?? ''}`)
  }
  return res.result.value
}
async function waitFor(expression, label, timeout = 25000) {
  const ok = await evaluate(`(async () => {
    const deadline = Date.now() + ${timeout}
    while (Date.now() < deadline) {
      if (${expression}) return true
      await new Promise((r) => setTimeout(r, 150))
    }
    return false
  })()`)
  if (!ok) throw new Error(`等待超时：${label}`)
}
async function shot(name) {
  await sleep(800)
  const data = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`${OUT}/${name}`, Buffer.from(data.data, 'base64'))
}
const go = async (path) => {
  await send('Page.navigate', { url: `${APP}${path}` })
  await sleep(700)
}
const clickTestId = (tid) =>
  evaluate(`(() => { const el = document.querySelector('[data-testid="${tid}"]'); if (!el) return 'missing'; el.click(); return 'ok' })()`)
const setValue = (sel, value) =>
  evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(sel)})
    if (!el) return 'missing'
    const setter = Object.getOwnPropertyDescriptor(el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set
    setter.call(el, ${JSON.stringify(value)})
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return 'ok'
  })()`)
const clickText = (text) =>
  evaluate(`(() => {
    const el = [...document.querySelectorAll('a,button')].find((x) => (x.textContent ?? '').trim() === ${JSON.stringify(text)})
    if (!el) return 'missing'
    el.click()
    return 'ok'
  })()`)

await send('Runtime.enable')
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
await sleep(600)
consoleLogs.length = 0

/* ================================================================
   零、清场：listenSessions / studyTasks / studyCards / 音乐全部清空（单跑可重复）
   ⚠️ 动态 import('/src/db/db.ts') 只有在**应用页面**上才解析得了模块路径，
      所以先导航到 /welcome 再清（根路径会拐弯，别用 /）。
   ================================================================ */
await go('/welcome')
const cleaned = await evaluate(`(async () => {
  const dbm = await import('/src/db/db.ts')
  await dbm.db.listenSessions.clear()
  await dbm.db.studyTasks.clear()
  await dbm.db.studyCards.clear()
  await dbm.db.musicTracks.clear()
  return 'ok'
})()`)
check('清场（listenSessions / studyTasks / studyCards / musicTracks）', cleaned === 'ok')

/* ================================================================
   一、一起听 · 空态与诚实边界
   ================================================================ */
await go('/home/music')
await waitFor(`document.body.innerText.includes('收下一首歌')`, '音乐模块挂载')
const musicEmpty = await evaluate(`(() => {
  const text = document.body.innerText
  return {
    playerGone: document.querySelector('[data-testid="music-player"]') === null,
    emptyText: text.includes('这里还没有音乐'),
    fakeGone: !text.includes('小栖也在听'),
  }
})()`)
check('空歌单不出播放器、空态文案在', musicEmpty.playerGone && musicEmpty.emptyText)
check('「小栖也在听」这句没搬（没人真的在听）', musicEmpty.fakeGone)

/* ================================================================
   二、收两首：一首带真音频（data:URI WAV），一首没链接
   ================================================================ */
/* 歌单按 updatedAt 倒序（新收的在前）：先收无链接的，再收主题曲 —— 播放器默认落在主题曲上 */
{
  const t = await setValue('#music-title', '无链接曲目')
  const s = await clickText('保存音乐')
  check('收第一首（不填链接）', t === 'ok' && s === 'ok', `${t}/${s}`)
}
await waitFor(`document.body.innerText.includes('无链接曲目')`, '第一首落地')
{
  const t = await setValue('#music-title', '验收主题曲')
  const u = await setValue('#music-url', TONE_URL)
  const s = await clickText('保存音乐')
  check('收第二首（带真音频 http 直链）', t === 'ok' && u === 'ok' && s === 'ok', `${t}/${u}/${s}`)
}
await waitFor(`document.body.innerText.includes('验收主题曲')`, '第二首落地')
check('播放器随歌单出现且当前曲目是第一首',
  (await evaluate(`document.querySelector('[data-testid="music-player"]') !== null && document.querySelector('[data-testid="music-player"]').innerText.includes('验收主题曲')`)) === true)
check('audio 元素拿到真 src',
  (await evaluate(`document.querySelector('[data-testid="music-player"] audio')?.src.endsWith('/verify-tone.wav') ?? false`)) === true)
check('一起听显示服务端共享会话卡',
  await evaluate(`document.querySelector('[data-testid="music-shared-session"]')?.innerText.includes('共同听 · 当前会话') ?? false`))

/* ================================================================
   三、真播放 → 时长落盘 → 生活痕迹「一起听」格读得到
   ⚠️ 用 3 秒的 WAV、播 2.2 秒后**手动暂停**：1 秒的曲子会和「每秒计数」
      的 interval 打竞速（onEnded 先于首个 tick 时 pending=0，落盘为空）。
   ================================================================ */
await clickTestId('music-play')
await waitFor(`document.querySelector('[data-testid="music-play"]')?.getAttribute('aria-label') === '暂停'`, '进入播放')
await sleep(2200) // interval 至少 tick 2 次，pending ≥ 2 秒
await clickTestId('music-play') // 暂停（onPause 也会 flush）
await waitFor(`document.querySelector('[data-testid="music-play"]')?.getAttribute('aria-label') === '播放'`, '暂停落盘')
await waitFor(`document.querySelector('[data-testid="music-shared-session"]')?.innerText.includes('验收主题曲') ?? false`, '共享曲目同步')
check('播放 / 暂停会把当前曲目同步到服务端会话', true)
await waitFor(`document.querySelector('[data-testid="music-history"]')?.innerText.includes('验收主题曲') ?? false`, '一起听历史落地')
check('一起听页面展示服务端聚合的历史与时长', (await evaluate(`document.querySelector('[data-testid="music-history"]')?.innerText.includes('播放 1 次') ?? false`)) === true)
await go('/life')
await waitFor(`document.querySelector('[data-testid="life-view-switch"]') !== null`, '生活页')
const musicCell = await evaluate(`(() => {
  const cell = document.querySelector('[data-testid="traces-music"]')
  return cell === null ? null : { tag: cell.tagName, href: cell.getAttribute('href'), text: cell.innerText }
})()`)
check('「一起听」格是通向音乐模块的真入口', musicCell !== null && musicCell.tag === 'A' && musicCell.href.endsWith('/home/music'), JSON.stringify(musicCell))
check('播放落的秒数进了生活痕迹（不再是「还没一起听过歌」）',
  musicCell !== null && !musicCell.text.includes('还没一起听过歌'), musicCell?.text.replace(/\n/g, ' / '))

/* ================================================================
   四、没链接的曲目：点了要说人话拒绝
   ================================================================ */
await go('/home/music')
await waitFor(`document.querySelector('[data-testid="music-player"]') !== null`, '播放器挂载')
await clickTestId('music-next') // 切到「无链接曲目」
await waitFor(`document.querySelector('[data-testid="music-player"]').innerText.includes('无链接曲目')`, '切到无链接曲目')
await clickTestId('music-play')
await waitFor(`document.body.innerText.includes('这一条还没有可播的链接')`, '拒绝文案')
check('没链接的曲目播不了且明说原因（不装假进度条）', true)
check('拒绝时没进播放态', (await evaluate(`document.querySelector('[data-testid="music-play"]')?.getAttribute('aria-label')`) ) === '播放')

/* ================================================================
   五、学习 · 今天的三件小事 + 一周节奏
   ================================================================ */
await go('/home/study')
await waitFor(`document.querySelector('[data-testid="study-tasks"]') !== null`, '任务卡挂载')
check('「一周节奏」卡在（真 studyRecords 聚合）', (await evaluate(`document.querySelector('[data-testid="study-week"]') !== null && document.querySelector('[data-testid="study-week"]').innerText.includes('这一周')`)) === true)
check('AI 伴学卡片入口存在（未配置 API 时不伪造卡片）',
  await evaluate(`document.body.innerText.includes('小栖今天给你的卡片') && document.body.innerText.includes('生成一组卡片')`))
check('空任务提示诚实', (await evaluate(`document.body.innerText.includes('还空着')`)) === true)

await evaluate(`(async () => {
  const dbm = await import('/src/db/db.ts')
  const now = Date.now()
  await dbm.db.studyCards.bulkPut([
    { id: 'study-card-t071-due', type: 'study-card', subject: '英语', front: 'due card', back: '到期卡', example: null, hint: null, source: 'ai', dueOn: '2000-01-01', intervalDays: 1, ease: 2.5, repetitions: 0, lastReviewedAt: null, createdAt: now, updatedAt: now },
    { id: 'study-card-t071-future', type: 'study-card', subject: '英语', front: 'future card', back: '未来卡', example: null, hint: null, source: 'ai', dueOn: '2099-01-01', intervalDays: 1, ease: 2.5, repetitions: 0, lastReviewedAt: null, createdAt: now + 1, updatedAt: now + 1 },
    { id: 'study-card-t071-mature', type: 'study-card', subject: '英语', front: 'mature card', back: '成熟卡', example: null, hint: null, source: 'ai', dueOn: '2000-01-01', intervalDays: 7, ease: 2.8, repetitions: 3, lastReviewedAt: null, createdAt: now + 2, updatedAt: now + 2 },
  ])
  return 'ok'
})()`)
await go('/home/study')
await waitFor(`document.querySelector('[data-testid="study-card-summary"]')?.innerText.includes('待复习 2')`, '到期卡统计')
check('伴学默认进入到期复习队列', (await evaluate(`document.querySelector('[data-testid="study-card-filter-due"]')?.getAttribute('aria-pressed') === 'true' && document.body.innerText.includes('到期卡')`)) === true)
await clickTestId('study-card-filter-all')
await waitFor(`document.querySelector('[data-testid="study-card-filter-all"]')?.getAttribute('aria-pressed') === 'true'`, '全部卡片筛选')
check('切到全部后能看到未来卡片与完整数量', (await evaluate(`document.querySelector('[data-testid="study-card-summary"]')?.innerText.includes('共 3 张') && document.body.innerText.includes('到期卡')`)) === true)
await clickTestId('study-card-filter-mature')
await waitFor(`document.querySelector('[data-testid="study-card-filter-mature"]')?.getAttribute('aria-pressed') === 'true'`, '成熟卡片筛选')
check('已形成间隔筛选只展示成熟卡片', (await evaluate(`document.body.innerText.includes('成熟卡') && !document.body.innerText.includes('未来卡')`)) === true)

await setValue('[data-testid="study-task-input"]', '读完一章')
await clickText('添加')
await waitFor(`document.querySelector('[data-testid="study-tasks-count"]')?.textContent === '0 / 1'`, '任务加入')
const taskRow = await evaluate(`(() => {
  const rows = [...document.querySelectorAll('[role="checkbox"]')]
  return rows.length === 1 ? { id: rows[0].dataset.testid, checked: rows[0].getAttribute('aria-checked') } : null
})()`)
check('任务以 checkbox 呈现且未勾', taskRow !== null && taskRow.checked === 'false', JSON.stringify(taskRow))
await clickTestId(taskRow.id)
await waitFor(`document.querySelector('[data-testid="study-tasks-count"]')?.textContent === '1 / 1'`, '任务勾选')
check('勾选后计数 1 / 1 且 aria-checked 翻转',
  (await evaluate(`document.querySelector('[role="checkbox"]')?.getAttribute('aria-checked') === 'true'`)) === true)
await evaluate(`(() => { const rows = [...document.querySelectorAll('[role="checkbox"]')]; rows[0].parentElement.querySelector('button').click(); return 'ok' })()`)
await waitFor(`document.body.innerText.includes('确认删除')`, '两击删除第一击')
await evaluate(`(() => { const rows = [...document.querySelectorAll('[role="checkbox"]')]; rows[0].parentElement.querySelector('button').click(); return 'ok' })()`)
await waitFor(`document.querySelector('[data-testid="study-tasks-count"]')?.textContent === '0 / 0'`, '删除落地')
check('任务可两击删除（误触保护）', true)
await shot('shot-skin-batch6-study.png')

/* ================================================================
   六、独处空间 /solo
   ================================================================ */
await go('/solo')
await waitFor(`document.querySelector('[data-testid="solo-circle"]') !== null`, '独处页挂载')
const soloInit = await evaluate(`(() => ({
  clock: document.querySelector('[data-testid="solo-clock"]')?.textContent,
  quote: document.querySelector('[data-testid="solo-quote"]')?.textContent,
  chips: [...document.querySelectorAll('.chip')].map((c) => c.textContent.trim()),
  breathing: document.querySelector('[data-testid="solo-circle"]').classList.contains('breathing'),
}))()`)
check('默认 10 分钟待命、呼吸圆没在动', soloInit.clock === '10:00' && soloInit.breathing === false, JSON.stringify(soloInit.clock))
check('独处页是沉浸式（无胶囊底栏 —— 「不生产、不回应」的地方不拽人回任务模式）',
  (await evaluate(`document.querySelector('.bottom-nav') === null`)) === true)
check('待命短句不是假状态', soloInit.quote === '「点开始，雨声就来了」', soloInit.quote)
check('时长三档可选（5/10/15）', soloInit.chips.some((c) => c === '5 分钟') && soloInit.chips.some((c) => c === '15 分钟'), JSON.stringify(soloInit.chips))

await clickText('5 分钟')
check('选 5 分钟 → 表盘跟着变', (await evaluate(`document.querySelector('[data-testid="solo-clock"]')?.textContent`)) === '05:00')
await clickTestId('solo-toggle')
await waitFor(`document.querySelector('[data-testid="solo-circle"]').classList.contains('breathing')`, '开始独处')
await sleep(2300)
const soloRunning = await evaluate(`(() => ({
  clock: document.querySelector('[data-testid="solo-clock"]')?.textContent,
  quote: document.querySelector('[data-testid="solo-quote"]')?.textContent,
}))()`)
check('计时真的在走（2 秒后不再是 05:00）', soloRunning.clock !== '05:00' && soloRunning.clock !== undefined, soloRunning.clock)
check('运行中短句轮换（不再是待命句）', soloRunning.quote !== '「点开始，雨声就来了」', soloRunning.quote)
await clickTestId('solo-toggle')
await waitFor(`!document.querySelector('[data-testid="solo-circle"]').classList.contains('breathing')`, '提前结束')
check('提前结束回到待命、表盘复位', (await evaluate(`document.querySelector('[data-testid="solo-clock"]')?.textContent`)) === '05:00')
await shot('shot-skin-solo.png')

/* ================================================================
   七、听雨秒数落盘 → 生活痕迹「雨」格读得到
   ================================================================ */
await go('/life')
await waitFor(`document.querySelector('[data-testid="life-view-switch"]') !== null`, '生活页')
const rainCell = await evaluate(`(() => {
  const cell = document.querySelector('[data-testid="traces-rain"]')
  return cell === null ? null : { tag: cell.tagName, href: cell.getAttribute('href'), text: cell.innerText }
})()`)
check('「雨」格是通向独处空间的真入口', rainCell !== null && rainCell.tag === 'A' && rainCell.href.endsWith('/solo'), JSON.stringify(rainCell))
check('听雨秒数落盘（不再是「还没听过雨声」）', rainCell !== null && !rainCell.text.includes('还没听过雨声'), rainCell?.text.replace(/\n/g, ' / '))
const stillHonest = await evaluate(`(() => {
  const text = document.body.innerText
  return text.includes('还没有心情记录') && text.includes('还没有睡眠记录') && text.includes('数据只记录，不评判')
})()`)
check('心情 / 睡眠仍诚实空态（这批没有给它们造来源）', stillHonest === true)

/* ================================================================
   八、收尾
   ================================================================ */
await go('/solo')
check(
  '移动端无横向溢出',
  (await evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth')) === true,
  await evaluate('document.documentElement.scrollWidth + " vs " + document.documentElement.clientWidth'),
)
const errors = consoleLogs.filter((l) => l.startsWith('[error]') || l.startsWith('[exception]'))
check('控制台无异常', errors.length === 0, errors.slice(0, 3).join(' | '))

await send('Emulation.clearDeviceMetricsOverride')
ws.close()
toneServer.close()

const passed = results.filter((r) => r.ok).length
console.log(`\n第 6 批（一起听真播放 / 学习伴学 / 独处空间）：${passed}/${results.length} passed`)
if (passed !== results.length) process.exitCode = 1
