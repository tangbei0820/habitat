/**
 * UI 换装第 4 批 · 家页换皮验收（设计源 `designs/qixi-habitat/screens-home.jsx`）
 *
 * 家 = 6 格 Bento + 一行全入口（UI_DESIGN.md §5 拍板）。本支盯六件事：
 *   1. 页头是低存在感帽子（日期行 + 问候语），不是旧版的居中大标题；
 *   2. Bento 六格齐全、每格都是**真数据或诚实空态**（铁律：假数据一律不搬）——
 *      先验空库空态，再**真种一条数据**重进，验格子真的吃库（不是写死的占位文案）；
 *   3. 「小栖 · 现在」是真实联网状态（离线时不能显示「在」）；
 *   4. 全入口一行 10 个模块一个不漏（愿望清单、读书不放走），且都是带图标的胶囊链接；
 *   5. 模块子页挂上了与对话页同款的低存在感顶栏（图标返回 + .topbar-title）；
 *   6. 移动端无横向溢出 + 控制台无异常。
 *
 * 前置（与组一相同）：
 *   server/ : node node_modules/tsx/dist/cli.mjs src/index.ts   → :3100
 *   web/    : HABITAT_API_TARGET=http://127.0.0.1:3100 vite --port 5174
 *   任意    : msedge --headless=new --remote-debugging-port=9222
 * 环境：VERIFY_APP（默认 :5174）、VERIFY_CDP（默认 :9222）
 */
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
  await sleep(800) // 等 .rise 播完，抢拍会拍到 opacity:0 的第一帧
  const data = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(`${OUT}/${name}`, Buffer.from(data.data, 'base64'))
}
const go = async (path) => {
  await send('Page.navigate', { url: `${APP}${path}` })
  await sleep(700)
}

await send('Runtime.enable')
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
await sleep(600)
consoleLogs.length = 0

/* ================================================================
   一、空库：Bento 六格 + 诚实空态
   ⚠️ 流水线里 verify-home 会先跑并留下留言/倒数日等数据，所以这里先**清掉
      这四类数据**再造空库场景（顺序无关，单跑也一样）。
   ================================================================ */
await go('/home') // 动态 import 要在应用源上跑，先进门
await waitFor(`document.querySelector('.bento') !== null`, '家页 Bento 挂载')
const wiped = await evaluate(`(async () => {
  const m = await import('/src/db/home.ts')
  for (const x of await m.listMoments()) await m.deleteMoment(x.id)
  for (const x of await m.listCountdowns()) await m.deleteCountdown(x.id)
  for (const x of await m.listBookmarks()) await m.deleteBookmark(x.id)
  for (const x of await m.listMusicTracks()) await m.deleteMusicTrack(x.id)
  return 'ok'
})()`)
check('验收前置清库成功', wiped === 'ok', String(wiped))
await go('/home') // 清库后重进，确保读到的是清完的状态
await waitFor(`document.querySelector('.bento') !== null`, '家页 Bento 再次挂载')

const emptyHome = await evaluate(`(() => {
  const cells = [...document.querySelectorAll('.bento > .bento-cell')]
  const text = document.body.innerText
  return {
    cellCount: cells.length,
    hasPresence: cells.some((c) => c.classList.contains('ai-presence')),
    presenceText: cells.find((c) => c.classList.contains('ai-presence'))?.innerText ?? '',
    hasTopbar: document.querySelector('header .t-h1') !== null,
    boardEmpty: text.includes('还没有留言'),
    countdownEmpty: text.includes('还没定日子'),
    bookmarksEmpty: text.includes('收藏夹还空着'),
    musicEmpty: text.includes('歌单还空着'),
    diaryCell: text.includes('篇 · 本周') && text.includes('去翻翻'),
    chatLink: document.querySelector('.bento a[href="/chat"]') !== null,
  }
})()`)
check('家页页头是低存在感帽子（日期行 + 问候语）', emptyHome.hasTopbar)
check('Bento 有六格，含「小栖 · 现在」特殊卡', emptyHome.cellCount === 6 && emptyHome.hasPresence, `cells=${emptyHome.cellCount}`)
check('空库时留言板 / 倒数日 / 收藏 / 音乐都是诚实空态', emptyHome.boardEmpty && emptyHome.countdownEmpty && emptyHome.bookmarksEmpty && emptyHome.musicEmpty, JSON.stringify(emptyHome))
check('日记格是「N 篇 · 本周 + 去翻翻」', emptyHome.diaryCell)
check('「小栖 · 现在」卡有去聊天的入口', emptyHome.chatLink)
check('离线/在线状态是真实状态（不装心情占位文案）', !emptyHome.presenceText.includes('在窗边听雨'), emptyHome.presenceText.slice(0, 24))

/* ================================================================
   二、全入口：10 个模块一个不漏
   ================================================================ */
const entries = await evaluate(`(() => {
  const links = [...document.querySelectorAll('[data-testid="home-entries"] a')]
  return {
    count: links.length,
    allIconed: links.every((a) => a.querySelector('svg') !== null),
    hrefs: links.map((a) => a.getAttribute('href')),
    text: document.body.innerText,
  }
})()`)
const wantHrefs = ['board', 'countdown', 'wishlist', 'diary', 'bookmarks', 'works', 'album', 'reading', 'music', 'study'].map((k) => `/home/${k}`)
check(
  '全入口 10 个模块一个不漏（愿望清单、读书不放走）且都带图标',
  entries.count === 10 && entries.allIconed && wantHrefs.every((h) => entries.hrefs.includes(h)),
  `count=${entries.count} iconed=${String(entries.allIconed)}`,
)
check('家页没有 emoji 当图标', entries.text.split('').filter((ch) => /\p{Extended_Pictographic}/u.test(ch)).length === 0)
await shot('shot-skin-home-empty.png')

/* ================================================================
   三、真种数据：格子必须吃真库，不是占位文案
   ================================================================ */
const seeded = await evaluate(`(async () => {
  const m = await import('/src/db/home.ts')
  await m.createMoment('Bento 验收留言')
  await m.createCountdown('一起看雪', '2099-01-01')
  await m.createExternalBookmark('把路灯当作月亮', 'https://example.com/poem', '')
  await m.createMusicTrack('Rainy Mood', '小栖的歌单', '', '')
  return 'ok'
})()`)
check('验收数据种成功', seeded === 'ok', String(seeded))

await go('/home')
await waitFor(`document.body.innerText.includes('Bento 验收留言')`, '种数据后家页回填')
const fullHome = await evaluate(`(() => {
  const text = document.body.innerText
  return {
    note: text.includes('Bento 验收留言'),
    countdown: text.includes('距「一起看雪」'),
    bookmark: text.includes('把路灯当作月亮'),
    track: text.includes('Rainy Mood'),
    emptyGone: !text.includes('还没有留言') && !text.includes('还没定日子'),
  }
})()`)
check(
  '留言板 / 倒数日 / 收藏 / 音乐格都吃真库数据',
  fullHome.note && fullHome.countdown && fullHome.bookmark && fullHome.track && fullHome.emptyGone,
  JSON.stringify(fullHome),
)
await shot('shot-skin-home-data.png')

/* ================================================================
   四、模块子页：同款低存在感顶栏
   ================================================================ */
await go('/home/board')
await waitFor(`document.body.innerText.includes('留下一句话')`, '留言板模块挂载')
const moduleSkin = await evaluate(`(() => {
  const top = document.querySelector('.topbar')
  const back = document.querySelector('[data-testid="module-back"]')
  return {
    topbar: top !== null,
    title: top?.querySelector('.topbar-title')?.textContent.trim() ?? '',
    backIsIcon: back !== null && back.tagName === 'A' && back.querySelector('svg') !== null,
    backHref: back?.getAttribute('href') ?? '',
  }
})()`)
check(
  '模块子页挂同款 .topbar（图标返回 + 标题）',
  moduleSkin.topbar && moduleSkin.title === '留言板' && moduleSkin.backIsIcon && moduleSkin.backHref === '/home',
  JSON.stringify(moduleSkin),
)

/* ================================================================
   五、收尾
   ================================================================ */
await go('/home')
check(
  '移动端无横向溢出',
  (await evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth')) === true,
  await evaluate('document.documentElement.scrollWidth + " vs " + document.documentElement.clientWidth'),
)
const errors = consoleLogs.filter((l) => l.startsWith('[error]') || l.startsWith('[exception]'))
check('控制台无异常', errors.length === 0, errors.slice(0, 3).join(' | '))

await send('Emulation.clearDeviceMetricsOverride')
ws.close()

const passed = results.filter((r) => r.ok).length
console.log(`\n家页换皮（第 4 批）：${passed}/${results.length} passed`)
if (passed !== results.length) process.exitCode = 1
