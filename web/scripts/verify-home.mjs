/**
 * Phase 2 Home 完整验收：十个生活模块 + 主屏 Widget + Dexie v9 持久化 / 备份 v7。
 * 前置：vite + 无头 Edge CDP；用 Node >= 22 运行（需全局 WebSocket）。
 * 请使用隔离的浏览器 profile：验收最后会导入一份空 v1 备份来验兼容性。
 */
const CDP = process.env.VERIFY_CDP ?? 'http://127.0.0.1:9222'
const APP = process.env.VERIFY_APP ?? 'http://127.0.0.1:5174'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const targets = await (await fetch(`${CDP}/json/list`)).json()
const target = targets.find((item) => item.type === 'page')
if (!target) throw new Error('找不到可用的页面 target')

const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  ws.onopen = resolve
  ws.onerror = reject
})

let messageId = 0
const pending = new Map()
const consoleErrors = []
ws.onmessage = (event) => {
  const message = JSON.parse(event.data)
  if (message.id !== undefined) {
    const waiter = pending.get(message.id)
    if (waiter) {
      pending.delete(message.id)
      if (message.error) waiter.reject(new Error(JSON.stringify(message.error)))
      else waiter.resolve(message.result)
    }
    return
  }
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    consoleErrors.push(message.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' '))
  }
  if (message.method === 'Runtime.exceptionThrown') consoleErrors.push(message.params.exceptionDetails.text)
}

function send(method, params = {}) {
  messageId += 1
  const id = messageId
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
  return result.result.value
}

async function waitFor(expression, label, timeout = 30000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    if (await evaluate(expression)) return
    await sleep(120)
  }
  throw new Error(`等待超时：${label}`)
}

async function navigate(path, text) {
  await send('Page.navigate', { url: `${APP}${path}` })
  await sleep(500)
  await waitFor(`document.body.innerText.includes(${JSON.stringify(text)})`, `${path} 就绪`)
}

async function setValue(selector, value) {
  await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)})
    if (!element) return false
    const setter = Object.getOwnPropertyDescriptor(element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set
    setter.call(element, ${JSON.stringify(value)})
    element.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
}

async function setSelect(selector, value) {
  await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)})
    if (!(element instanceof HTMLSelectElement)) return false
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
    setter.call(element, ${JSON.stringify(value)})
    element.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  })()`)
}

async function clickButton(label) {
  return evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === ${JSON.stringify(label)})
    if (!button) return false
    button.click()
    return true
  })()`)
}

const results = []
function check(label, ok, detail = '') {
  results.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  → ${detail}` : ''}`)
}

await send('Runtime.enable')
await send('Page.enable')

/**
 * ⚠️ 开场先清空本地库。
 *
 * 无头浏览器的 profile 是复用的，而脚本只在**正常跑到最后**时才靠导入空备份重置数据 ——
 * 上一轮若中途异常退出（`waitFor` 超时直接抛错），残留就会带到下一轮：
 * 「重复收藏被拒」「初始为空」这类断言会莫名其妙地失败，而且是**代码没改、上一次却是过的**
 * 那种失败，排查时最浪费时间。T-018 已经吃过一次「拿数据残留当断言前提」的亏。
 */
await navigate('/home', '留言板')
await evaluate(`(async () => {
  const stores = ['sessions', 'sessionGroups', 'messages', 'moments', 'wishlist', 'countdowns',
    'diaries', 'bookmarks', 'artworks', 'photos', 'readingNotes', 'musicTracks', 'studyRecords', 'homeWidgets']
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('habitat-db')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  for (const name of stores) {
    if (!db.objectStoreNames.contains(name)) continue
    await new Promise((resolve, reject) => {
      const tx = db.transaction(name, 'readwrite')
      const request = tx.objectStore(name).clear()
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }
  db.close()
  return true
})()`)
await send('Page.reload')
await sleep(800)

await navigate('/home', '留言板')
const homeText = await evaluate('document.body.innerText')
check('首页十个生活入口全部可见', ['留言板', '愿望清单', '倒数日', '日记', '收藏', '作品', '相册', '读书', '音乐', '学习'].every((text) => homeText.includes(text)))

await navigate('/home/board', '留下一句话')
await setValue('#board-draft', '第一条生活留言')
await clickButton('留言')
await waitFor(`document.body.innerText.includes('第一条生活留言')`, '留言落地')
await send('Page.reload')
await sleep(500)
await waitFor(`document.body.innerText.includes('第一条生活留言')`, '留言刷新保留')
check('留言新增并跨刷新保留', true)
await clickButton('删除')
check('留言删除有二次确认', (await evaluate(`document.body.innerText.includes('确认删除？')`)) === true)
await clickButton('确认删除？')
await waitFor(`!document.body.innerText.includes('第一条生活留言')`, '留言删除')

await navigate('/home/wishlist', '愿望清单')
await setValue('#wishlist-title', '一起看海')
await clickButton('添加')
await waitFor(`document.body.innerText.includes('一起看海')`, '愿望落地')
await evaluate(`document.querySelector('button[aria-label="标记为已完成"]').click()`)
await waitFor(`document.querySelector('button[aria-label="标记为未完成"]') !== null`, '愿望完成')
await send('Page.reload')
await sleep(500)
await waitFor(`document.querySelector('button[aria-label="标记为未完成"]') !== null`, '愿望状态刷新保留')
check('愿望新增、完成状态并跨刷新保留', true)

await navigate('/home/countdown', '新倒数日')
await setValue('#countdown-title', '未来的约定')
await setValue('input[type="date"]', '2099-12-31')
await clickButton('添加')
await waitFor(`document.body.innerText.includes('未来的约定') && document.body.innerText.includes('2099-12-31')`, '倒数日落地')
await send('Page.reload')
await sleep(500)
await waitFor(`document.body.innerText.includes('未来的约定')`, '倒数日刷新保留')
check('倒数日新增并跨刷新保留', true)

await navigate('/home/diary', '写一篇日记')
await setValue('#diary-title', '施工日记')
await setValue('#diary-content', '今天把共同生活又往前推进了一点。')
await clickButton('保存日记')
await waitFor(`document.body.innerText.includes('施工日记') && document.body.innerText.includes('今天把共同生活又往前推进了一点。')`, '日记落地')
await clickButton('编辑')
await waitFor(`document.body.innerText.includes('编辑日记')`, '进入日记编辑')
await setValue('#diary-content', '今天把共同生活又往前推进了一大步。')
await clickButton('保存修改')
await waitFor(`document.body.innerText.includes('一大步')`, '日记修改落地')
await send('Page.reload')
await sleep(500)
await waitFor(`document.body.innerText.includes('一大步')`, '日记修改刷新保留')
check('日记新增、编辑并跨刷新保留', true)

await navigate('/home/bookmarks', '收藏一个链接')
await setValue('#bookmark-title', '栖息地参考页')
await setValue('#bookmark-url', 'https://example.com/habitat')
await setValue('#bookmark-note', '以后还想回来看看。')
await clickButton('加入收藏')
await waitFor(`document.body.innerText.includes('栖息地参考页') && document.body.innerText.includes('以后还想回来看看。')`, '收藏落地')
await send('Page.reload')
await sleep(500)
await waitFor(`document.querySelector('a[href="https://example.com/habitat"]') !== null`, '收藏刷新保留')
const bookmarkLink = await evaluate(`(() => {
  const link = document.querySelector('a[href="https://example.com/habitat"]')
  return link ? { target: link.target, rel: link.rel } : null
})()`)
check('外部收藏跨刷新保留并安全地新窗打开', bookmarkLink?.target === '_blank' && bookmarkLink?.rel.includes('noreferrer'), JSON.stringify(bookmarkLink))
await setValue('#bookmark-title', '重复收藏')
await setValue('#bookmark-url', 'https://example.com/habitat')
await clickButton('加入收藏')
await waitFor(`document.body.innerText.includes('这个链接已经收藏过了')`, '重复收藏拦截')
check('同一个 targetType + targetId 不会重复收藏', true)

await navigate('/home/works', '登记一件作品')
await setValue('#work-title', '共同生活手册')
await setValue('#work-description', '先写下第一版。')
await setValue('#work-url', 'https://example.com/work')
await clickButton('保存作品')
await waitFor(`document.body.innerText.includes('共同生活手册') && document.body.innerText.includes('先写下第一版。')`, '作品落地')
await clickButton('编辑')
await waitFor(`document.body.innerText.includes('编辑作品')`, '进入作品编辑')
await setValue('#work-description', '已经整理成第二版。')
await clickButton('保存修改')
await waitFor(`document.body.innerText.includes('已经整理成第二版。')`, '作品修改落地')
await send('Page.reload')
await sleep(500)
await waitFor(`document.body.innerText.includes('已经整理成第二版。')`, '作品修改刷新保留')
const artworkLink = await evaluate(`(() => {
  const link = document.querySelector('a[href="https://example.com/work"]')
  return link ? { target: link.target, rel: link.rel } : null
})()`)
check('作品新增、编辑并跨刷新保留，外链安全打开', artworkLink?.target === '_blank' && artworkLink?.rel.includes('noreferrer'), JSON.stringify(artworkLink))

await navigate('/home/album', '放进一张照片')
await evaluate(`(async () => {
  const home = await import('/src/db/home.ts')
  await home.createPhoto({
    title: '一像素的纪念', caption: '浏览器内保存的真实图片数据。',
    imageDataUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
    mimeType: 'image/gif', sizeBytes: 42, takenAt: '2026-09-23',
  })
})()`)
await send('Page.reload')
await sleep(500)
await waitFor(`document.body.innerText.includes('一像素的纪念') && document.querySelector('img[alt="一像素的纪念"]') !== null`, '照片刷新保留')
check('相册保存实际图片数据并跨刷新显示', true)

await navigate('/home/reading', '记一页阅读')
await setValue('#reading-title', '人类群星闪耀时')
await setValue('#reading-author', '斯蒂芬·茨威格')
await setValue('#reading-note', '先记下一段初读感受。')
await clickButton('保存笔记')
await waitFor(`document.body.innerText.includes('人类群星闪耀时') && document.body.innerText.includes('先记下一段初读感受。')`, '读书笔记落地')
await clickButton('编辑')
await waitFor(`document.body.innerText.includes('编辑读书笔记')`, '进入读书笔记编辑')
await setSelect('#reading-status', 'finished')
await setValue('#reading-note', '读完后留下完整感受。')
await clickButton('保存修改')
await waitFor(`document.body.innerText.includes('读完') && document.body.innerText.includes('读完后留下完整感受。')`, '读书笔记修改落地')
await send('Page.reload'); await sleep(500)
await waitFor(`document.body.innerText.includes('读完') && document.body.innerText.includes('读完后留下完整感受。')`, '读书笔记刷新保留')
check('读书笔记新增、状态编辑并跨刷新保留', true)

await navigate('/home/music', '收下一首歌')
await setValue('#music-title', '共同生活的歌')
await setValue('#music-artist', '小栖')
await setValue('#music-note', '适合在傍晚一起听。')
await setValue('#music-url', 'https://example.com/music')
await clickButton('保存音乐')
await waitFor(`document.body.innerText.includes('共同生活的歌')`, '音乐记录落地')
await clickButton('编辑')
await waitFor(`document.body.innerText.includes('编辑音乐记录')`, '进入音乐编辑')
await setValue('#music-note', '适合在每个傍晚一起听。')
await clickButton('保存修改')
await waitFor(`document.body.innerText.includes('每个傍晚')`, '音乐记录修改落地')
await send('Page.reload'); await sleep(500)
await waitFor(`document.body.innerText.includes('每个傍晚') && document.querySelector('a[href="https://example.com/music"]') !== null`, '音乐记录刷新保留')
const musicLink = await evaluate(`(() => { const link = document.querySelector('a[href="https://example.com/music"]'); return link ? { target: link.target, rel: link.rel } : null })()`)
check('音乐记录新增、编辑并安全打开外链', musicLink?.target === '_blank' && musicLink?.rel.includes('noreferrer'), JSON.stringify(musicLink))

await navigate('/home/study', '记一次学习')
await setValue('#study-subject', 'TypeScript strict')
await setValue('#study-date', '2026-09-23')
await setValue('#study-duration', '45')
await setValue('#study-note', '把类型边界收紧。')
await clickButton('保存记录')
await waitFor(`document.body.innerText.includes('TypeScript strict') && document.body.innerText.includes('45 分钟')`, '学习记录落地')
await clickButton('编辑')
await waitFor(`document.body.innerText.includes('编辑学习记录')`, '进入学习编辑')
await setValue('#study-duration', '60')
await setValue('#study-note', '把类型与备份边界一起收紧。')
await clickButton('保存修改')
await waitFor(`document.body.innerText.includes('共 60 分钟') && document.body.innerText.includes('备份边界')`, '学习记录修改落地')
await send('Page.reload'); await sleep(500)
await waitFor(`document.body.innerText.includes('共 60 分钟') && document.body.innerText.includes('备份边界')`, '学习记录刷新保留')
check('学习记录新增、编辑、汇总并跨刷新保留', true)

/* ---------- 主屏 Widget（SPEC §1.4 / §3.2.2 / §3.3.2） ---------- */

/** 点某一行里的「上主屏 / 已在主屏」——按钮文案随状态变，所以按行的 testid 找按钮 */
const toggleCountdownHome = (rowText) => evaluate(`(() => {
  const row = [...document.querySelectorAll('li')].find((el) => el.innerText.includes(${JSON.stringify(rowText)}))
  const button = row?.querySelector('[data-testid="countdown-home-toggle"]')
  if (!button) return false
  button.click()
  return true
})()`)

/** ⚠️ 必须按行文本查状态：页面上有多个倒数日，`[data-on-home="false"]` 那种全局选择器
 *  会被「本来就没上主屏」的那一条瞬间命中，等出一个假通过。 */
const countdownHomeState = (rowText) => evaluate(`(() => {
  const row = [...document.querySelectorAll('li')].find((el) => el.innerText.includes(${JSON.stringify(rowText)}))
  return row?.querySelector('[data-testid="countdown-home-toggle"]')?.getAttribute('data-on-home') ?? null
})()`)

/** 点某一行里的按钮（按文案精确匹配）——两步确认的删除也走它 */
const clickInRow = (rowText, buttonText) => evaluate(`(() => {
  const row = [...document.querySelectorAll('li')].find((el) => el.innerText.includes(${JSON.stringify(rowText)}))
  const button = [...(row?.querySelectorAll('button') ?? [])].find((b) => b.textContent.trim() === ${JSON.stringify(buttonText)})
  if (!button) return false
  button.click()
  return true
})()`)

/** 直接读库里的 Widget 记录：断言「记录真的被清掉」不能只看界面（界面消失可能是渲染层兜底） */
const readHomeWidgets = () => evaluate(`(async () => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('habitat-db')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  const rows = await new Promise((resolve, reject) => {
    const request = db.transaction('homeWidgets').objectStore('homeWidgets').getAll()
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  db.close()
  return rows.map((row) => ({ id: row.id, kind: row.kind, refId: row.refId, createdAt: row.createdAt }))
})()`)

/** 绕过界面直接改库：用来造「导入的备份里带着脏引用」这种只在数据层才出现的状态 */
const writeRawHomeWidget = (op, value) => evaluate(`(async () => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('habitat-db')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  await new Promise((resolve, reject) => {
    const store = db.transaction('homeWidgets', 'readwrite').objectStore('homeWidgets')
    const request = ${JSON.stringify(op)} === 'put' ? store.put(${JSON.stringify(value)}) : store.delete(${JSON.stringify(value)})
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
  db.close()
  return true
})()`)

await navigate('/home', '留言板')
await sleep(400)
check('没有 Widget 时主屏不渲染 Widget 区', (await evaluate(`document.querySelector('[data-testid="home-widgets"]') === null`)) === true)
check('此时库里也没有 Widget 记录', (await readHomeWidgets()).length === 0)

await navigate('/home/countdown', '新倒数日')
await setValue('#countdown-title', '相识纪念日')
await setValue('input[type="date"]', '2030-01-01')
await clickButton('添加')
await waitFor(`document.body.innerText.includes('相识纪念日')`, '倒数日「相识纪念日」落地')
await setValue('#countdown-title', '旅行出发日')
await setValue('input[type="date"]', '2027-06-01')
await clickButton('添加')
await waitFor(`document.body.innerText.includes('旅行出发日')`, '倒数日「旅行出发日」落地')
await toggleCountdownHome('旅行出发日')
await waitFor(`(() => { const row = [...document.querySelectorAll('li')].find((el) => el.innerText.includes('旅行出发日')); return row?.querySelector('[data-testid="countdown-home-toggle"]')?.getAttribute('data-on-home') === 'true' })()`, '「旅行出发日」上主屏')
check('倒数日可发送到主屏', (await countdownHomeState('旅行出发日')) === 'true')

await navigate('/home', '留言板')
await waitFor(`document.querySelector('[data-testid="home-widget-countdown"]') !== null`, '主屏出现倒数日 Widget')
const widgetLayout = await evaluate(`(() => {
  const section = document.querySelector('[data-testid="home-widgets"]')
  const header = document.querySelector('header')
  const entries = document.querySelector('[data-testid="home-entries"]')
  const card = document.querySelector('[data-testid="home-widget-countdown"]')
  if (!section || !header || !entries || !card) return null
  // compareDocumentPosition 的 DOCUMENT_POSITION_FOLLOWING 位：b 是否在 a 之后
  const after = (a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
  return {
    inSection: section.contains(card),
    afterHeader: after(header, section),
    beforeEntries: after(section, entries),
    text: card.innerText,
    href: card.getAttribute('href'),
  }
})()`)
check('主屏 Widget 区在问候语之下、功能入口之上', widgetLayout !== null && widgetLayout.inSection && widgetLayout.afterHeader && widgetLayout.beforeEntries, JSON.stringify(widgetLayout))
check('倒数日 Widget 展示名称 / 日期 / 剩余天数', widgetLayout !== null && widgetLayout.text.includes('旅行出发日') && widgetLayout.text.includes('2027-06-01') && /还有 \d+ 天/.test(widgetLayout.text), JSON.stringify(widgetLayout?.text))
check('倒数日 Widget 指向倒数日模块页', widgetLayout?.href === '/home/countdown', String(widgetLayout?.href))
await evaluate(`document.querySelector('[data-testid="home-widget-countdown"]').click()`)
await waitFor(`location.pathname === '/home/countdown'`, '点 Widget 进入模块页')
check('点 Widget 可快捷进入模块页', true)

// 换一个倒数日上主屏：应当是「改引用」，而不是多出一张卡片
const widgetsBeforeSwitch = await readHomeWidgets()
await toggleCountdownHome('相识纪念日')
await waitFor(`(() => { const row = [...document.querySelectorAll('li')].find((el) => el.innerText.includes('相识纪念日')); return row?.querySelector('[data-testid="countdown-home-toggle"]')?.getAttribute('data-on-home') === 'true' })()`, '「相识纪念日」上主屏')
await navigate('/home', '留言板')
await waitFor(`document.querySelector('[data-testid="home-widget-countdown"]')?.innerText.includes('相识纪念日') === true`, 'Widget 内容换成新的那个')
const widgetsAfterSwitch = await readHomeWidgets()
check(
  '换一个倒数日上主屏：只有一张卡片，内容跟着换',
  (await evaluate(`document.querySelectorAll('[data-testid="home-widget-countdown"]').length`)) === 1 &&
    widgetsAfterSwitch.length === 1 &&
    widgetsAfterSwitch[0].refId !== widgetsBeforeSwitch[0].refId,
  JSON.stringify({ before: widgetsBeforeSwitch, after: widgetsAfterSwitch }),
)
check(
  '换引用不改上主屏时间（卡片位置不跳）',
  widgetsAfterSwitch[0].createdAt === widgetsBeforeSwitch[0].createdAt,
  `${String(widgetsBeforeSwitch[0].createdAt)} → ${String(widgetsAfterSwitch[0].createdAt)}`,
)

await navigate('/home/board', '留下一句话')
await setValue('#board-draft', '今天也一起吃了饭。')
await clickButton('留言')
await waitFor(`document.body.innerText.includes('今天也一起吃了饭')`, '留言落地')
await evaluate(`document.querySelector('[data-testid="board-home-toggle"]').click()`)
await waitFor(`document.querySelector('[data-testid="board-home-toggle"]')?.getAttribute('data-on-home') === 'true'`, '留言板上主屏')

await navigate('/home', '留言板')
await waitFor(`document.querySelector('[data-testid="home-widget-board"]') !== null`, '主屏出现留言板 Widget')
const twoWidgets = await evaluate(`(() => {
  const section = document.querySelector('[data-testid="home-widgets"]')
  if (!section) return null
  return {
    order: [...section.children].map((el) => el.getAttribute('data-testid')),
    boardText: document.querySelector('[data-testid="home-widget-board"]')?.innerText ?? '',
    boardHref: document.querySelector('[data-testid="home-widget-board"] a')?.getAttribute('href') ?? null,
  }
})()`)
check('两张 Widget 按上主屏的先后排列（先倒数日、后留言板）', twoWidgets !== null && twoWidgets.order.join(',') === 'home-widget-countdown,home-widget-board', JSON.stringify(twoWidgets?.order))
check('留言板 Widget 展示最近留言并带快捷入口', twoWidgets !== null && twoWidgets.boardText.includes('今天也一起吃了饭') && twoWidgets.boardHref === '/home/board', JSON.stringify({ text: twoWidgets?.boardText, href: twoWidgets?.boardHref }))

await send('Page.reload')
await sleep(600)
await waitFor(`document.querySelectorAll('[data-testid="home-widgets"] > *').length === 2`, '刷新后两张 Widget 都在')
check('主屏 Widget 跨刷新保留', true)

// 删掉正被引用的倒数日：卡片要跟着没，而且**记录本身**也要被清掉
await navigate('/home/countdown', '新倒数日')
await clickInRow('相识纪念日', '删除')
await sleep(250)
await clickInRow('相识纪念日', '确认？')
await waitFor(`!document.body.innerText.includes('相识纪念日')`, '「相识纪念日」已删除')
const rowsAfterDelete = await readHomeWidgets()
check('删掉正被引用的倒数日时，指向它的 Widget 记录被一并清掉', rowsAfterDelete.length === 1 && rowsAfterDelete.every((row) => row.kind === 'board'), JSON.stringify(rowsAfterDelete))
await navigate('/home', '留言板')
await waitFor(`document.querySelector('[data-testid="home-widget-board"]') !== null`, '留言板 Widget 仍在')
check('删掉倒数日不影响另一个 Widget', (await evaluate(`document.querySelectorAll('[data-testid="home-widgets"] > *').length`)) === 1)

// 脏引用：库里留着一条指向不存在倒数日的 Widget（导入的备份会带来这种状态）
await writeRawHomeWidget('put', {
  id: 'dirty-widget', type: 'home-widget', kind: 'countdown', refId: 'no-such-countdown',
  createdAt: Date.now(), updatedAt: Date.now(),
})
await navigate('/home', '留言板')
await waitFor(`document.querySelector('[data-testid="home-widget-board"]') !== null`, '主屏渲染完成')
const rowsWithDirty = await readHomeWidgets()
check(
  '指向不存在实体的脏引用不渲染，也不影响别的 Widget',
  (await evaluate(`document.querySelectorAll('[data-testid="home-widget-countdown"]').length`)) === 0 &&
    rowsWithDirty.some((row) => row.id === 'dirty-widget'),
  JSON.stringify(rowsWithDirty),
)
await writeRawHomeWidget('delete', 'dirty-widget')

// 撤下之后再放回来，验证删除 / 撤下不会把这条路堵死
await navigate('/home/countdown', '新倒数日')
await toggleCountdownHome('旅行出发日')
await waitFor(`(() => { const row = [...document.querySelectorAll('li')].find((el) => el.innerText.includes('旅行出发日')); return row?.querySelector('[data-testid="countdown-home-toggle"]')?.getAttribute('data-on-home') === 'true' })()`, '「旅行出发日」重新上主屏')
await navigate('/home', '留言板')
await waitFor(`document.querySelectorAll('[data-testid="home-widgets"] > *').length === 2`, '删掉之后仍可重新上主屏')
check('删掉倒数日之后仍可重新上主屏', true)

await navigate('/home/board', '留下一句话')
await evaluate(`document.querySelector('[data-testid="board-home-toggle"]').click()`)
await waitFor(`document.querySelector('[data-testid="board-home-toggle"]')?.getAttribute('data-on-home') === 'false'`, '留言板已撤下')
await navigate('/home', '留言板')
await waitFor(`document.querySelectorAll('[data-testid="home-widgets"] > *').length === 1`, '只剩倒数日 Widget')
check('撤下一张 Widget 不影响另一张', (await evaluate(`document.querySelector('[data-testid="home-widget-board"]') === null`)) === true)

await navigate('/home/countdown', '新倒数日')
await toggleCountdownHome('旅行出发日')
await waitFor(`(() => { const row = [...document.querySelectorAll('li')].find((el) => el.innerText.includes('旅行出发日')); return row?.querySelector('[data-testid="countdown-home-toggle"]')?.getAttribute('data-on-home') === 'false' })()`, '倒数日已撤下')
await navigate('/home', '留言板')
await sleep(400)
check('全部撤下后主屏 Widget 区消失', (await evaluate(`document.querySelector('[data-testid="home-widgets"]') === null`)) === true)
check('主屏 Widget 记录已被清空', (await readHomeWidgets()).length === 0)

const backupCheck = await evaluate(`(async () => {
  const backupModule = await import('/src/lib/backup.ts')
  const readBack = (store, id) => new Promise((resolve, reject) => {
    const request = indexedDB.open('habitat-db')
    request.onsuccess = () => {
      const db = request.result
      const get = db.transaction(store).objectStore(store).get(id)
      get.onsuccess = () => { const value = get.result; db.close(); resolve(value) }
      get.onerror = () => { db.close(); reject(get.error) }
    }
    request.onerror = () => reject(request.error)
  })
  // 备份验收要盯住「最近新增的那部分内容」：会话分组（v6）与主屏 Widget（v7）都先在库里造出来再导出
  await new Promise((resolve, reject) => {
    const request = indexedDB.open('habitat-db')
    request.onsuccess = () => {
      const db = request.result
      const tx = db.transaction(['sessions', 'sessionGroups', 'homeWidgets'], 'readwrite')
      tx.objectStore('sessionGroups').put({
        id: 'verify-home-group', type: 'session-group', name: '备份验收分组',
        collapsed: true, createdAt: Date.now(), updatedAt: Date.now(),
      })
      tx.objectStore('sessions').put({
        id: 'verify-home-session', type: 'chat-session', title: '备份验收会话', pinnedAt: null,
        groupId: 'verify-home-group', remark: null, background: null, bubbleMode: 'chat',
        archivedAt: null, createdAt: Date.now(), updatedAt: Date.now(),
      })
      tx.objectStore('homeWidgets').put({
        id: 'verify-home-widget', type: 'home-widget', kind: 'board', refId: null,
        createdAt: Date.now(), updatedAt: Date.now(),
      })
      tx.oncomplete = () => { db.close(); resolve('ok') }
      tx.onerror = () => { db.close(); reject(tx.error) }
    }
    request.onerror = () => reject(request.error)
  })

  const backup = await backupModule.exportAll()
  const restored = await backupModule.importAll(backup)
  const restoredGroupRow = await readBack('sessionGroups', 'verify-home-group')
  const restoredSessionRow = await readBack('sessions', 'verify-home-session')
  const restoredWidgetRow = await readBack('homeWidgets', 'verify-home-widget')
  let unsafeBookmarkRejected = false
  let unsafePhotoRejected = false
  let unsafeMusicRejected = false
  try {
    await backupModule.importAll({
      ...backup,
      bookmarks: [{
        id: 'unsafe', type: 'bookmark', targetType: 'external-link', targetId: 'javascript:alert(1)',
        title: 'unsafe', note: null, createdAt: Date.now(), updatedAt: Date.now(),
      }],
    })
  } catch {
    unsafeBookmarkRejected = true
  }
  try {
    await backupModule.importAll({
      ...backup,
      photos: [{
        id: 'unsafe-photo', type: 'photo', title: 'unsafe', caption: null,
        imageDataUrl: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', mimeType: 'image/svg+xml',
        sizeBytes: 16, takenAt: '2026-09-23', createdAt: Date.now(), updatedAt: Date.now(),
      }],
    })
  } catch {
    unsafePhotoRejected = true
  }
  try {
    await backupModule.importAll({
      ...backup,
      musicTracks: [{
        id: 'unsafe-music', type: 'music-track', title: 'unsafe', artist: null, note: null,
        externalUrl: 'javascript:alert(1)', createdAt: Date.now(), updatedAt: Date.now(),
      }],
    })
  } catch {
    unsafeMusicRejected = true
  }
  const legacyV6 = await backupModule.importAll({
    format: 'habitat-backup', version: 6, exportedAt: Date.now(),
    sessions: [], sessionGroups: [], messages: [], moments: [], wishlist: [], countdowns: [],
    diaries: [], bookmarks: [], artworks: [], photos: [], readingNotes: [], musicTracks: [], studyRecords: [],
  })
  const legacyV5 = await backupModule.importAll({
    format: 'habitat-backup', version: 5, exportedAt: Date.now(),
    sessions: [{
      id: 'legacy-v5-session', type: 'chat-session', title: 'v5 时期的会话', pinnedAt: null,
      remark: null, background: null, bubbleMode: 'chat', archivedAt: null,
      createdAt: Date.now(), updatedAt: Date.now(),
    }],
    messages: [], moments: [], wishlist: [], countdowns: [], diaries: [], bookmarks: [],
    artworks: [], photos: [], readingNotes: [], musicTracks: [], studyRecords: [],
  })
  const legacyV5Session = await readBack('sessions', 'legacy-v5-session')
  const legacyV4 = await backupModule.importAll({
    format: 'habitat-backup', version: 4, exportedAt: Date.now(), sessions: [], messages: [],
    moments: [], wishlist: [], countdowns: [], diaries: [], bookmarks: [], artworks: [], photos: [],
  })
  const legacyV3 = await backupModule.importAll({
    format: 'habitat-backup',
    version: 3,
    exportedAt: Date.now(),
    sessions: [], messages: [], moments: [], wishlist: [], countdowns: [], diaries: [], bookmarks: [],
  })
  const legacyV2 = await backupModule.importAll({
    format: 'habitat-backup',
    version: 2,
    exportedAt: Date.now(),
    sessions: [],
    messages: [],
    moments: [],
    wishlist: [],
    countdowns: [],
  })
  const legacyV1 = await backupModule.importAll({
    format: 'habitat-backup',
    version: 1,
    exportedAt: Date.now(),
    sessions: [],
    messages: [],
  })
  return {
    version: backup.version,
    exportedHome: backup.moments.length + backup.wishlist.length + backup.countdowns.length + backup.diaries.length + backup.bookmarks.length + backup.artworks.length + backup.photos.length + backup.readingNotes.length + backup.musicTracks.length + backup.studyRecords.length,
    restoredHome: restored.moments + restored.wishlist + restored.countdowns + restored.diaries + restored.bookmarks + restored.artworks + restored.photos + restored.readingNotes + restored.musicTracks + restored.studyRecords,
    unsafeBookmarkRejected,
    unsafePhotoRejected,
    unsafeMusicRejected,
    legacyV4NewTables: legacyV4.readingNotes + legacyV4.musicTracks + legacyV4.studyRecords,
    legacyV3NewTables: legacyV3.artworks + legacyV3.photos,
    legacyV2NewTables: legacyV2.diaries + legacyV2.bookmarks,
    legacyV1Home: legacyV1.moments + legacyV1.wishlist + legacyV1.countdowns + legacyV1.diaries + legacyV1.bookmarks + legacyV1.artworks + legacyV1.photos + legacyV1.readingNotes + legacyV1.musicTracks + legacyV1.studyRecords,
    exportedGroups: backup.sessionGroups.length,
    restoredGroups: restored.sessionGroups,
    restoredGroupName: restoredGroupRow?.name,
    restoredGroupCollapsed: restoredGroupRow?.collapsed,
    restoredSessionGroupId: restoredSessionRow?.groupId,
    legacyV5Groups: legacyV5.sessionGroups,
    legacyV5SessionFound: legacyV5Session !== undefined,
    legacyV5SessionGroupId: legacyV5Session === undefined ? 'no-session' : legacyV5Session.groupId,
    exportedWidgets: backup.homeWidgets.length,
    restoredWidgets: restored.homeWidgets,
    // ⚠️ 不能写成 restoredWidgetRow?.refId ?? 'missing' —— board Widget 的 refId 本来就是 null，
    //    那个 ?? 会把要验的 null 一起吞掉，断言再也不可能失败
    restoredWidgetFound: restoredWidgetRow !== undefined,
    restoredWidgetKind: restoredWidgetRow === undefined ? 'no-row' : restoredWidgetRow.kind,
    restoredWidgetRefId: restoredWidgetRow === undefined ? 'no-row' : restoredWidgetRow.refId,
    legacyV6Widgets: legacyV6.homeWidgets,
  }
})()`)
check('备份 v7 覆盖十类 Home 数据并可整体恢复', backupCheck.version === 7 && backupCheck.exportedHome >= 9 && backupCheck.restoredHome === backupCheck.exportedHome, JSON.stringify(backupCheck))
check(
  '备份 v7 带走会话分组与归属（含折叠状态）',
  backupCheck.exportedGroups === 1 &&
    backupCheck.restoredGroups === 1 &&
    backupCheck.restoredGroupName === '备份验收分组' &&
    backupCheck.restoredGroupCollapsed === true &&
    backupCheck.restoredSessionGroupId === 'verify-home-group',
  JSON.stringify({
    exportedGroups: backupCheck.exportedGroups,
    restoredGroups: backupCheck.restoredGroups,
    name: backupCheck.restoredGroupName,
    collapsed: backupCheck.restoredGroupCollapsed,
    sessionGroupId: backupCheck.restoredSessionGroupId,
  }),
)
check(
  '备份 v7 带走主屏 Widget（引用原样保留）',
  backupCheck.exportedWidgets === 1 &&
    backupCheck.restoredWidgets === 1 &&
    backupCheck.restoredWidgetFound === true &&
    backupCheck.restoredWidgetKind === 'board' &&
    backupCheck.restoredWidgetRefId === null,
  JSON.stringify({
    exported: backupCheck.exportedWidgets,
    restored: backupCheck.restoredWidgets,
    found: backupCheck.restoredWidgetFound,
    kind: backupCheck.restoredWidgetKind,
    refId: backupCheck.restoredWidgetRefId,
  }),
)
check(
  '旧 v5 备份仍可导入：分组为空，会话补成未分组',
  backupCheck.legacyV5Groups === 0 &&
    backupCheck.legacyV5SessionFound === true &&
    backupCheck.legacyV5SessionGroupId === null,
  JSON.stringify({
    groups: backupCheck.legacyV5Groups,
    sessionFound: backupCheck.legacyV5SessionFound,
    sessionGroupId: backupCheck.legacyV5SessionGroupId,
  }),
)
check('旧 v6 备份仍可导入：主屏回到「一张 Widget 都没有」', backupCheck.legacyV6Widgets === 0, String(backupCheck.legacyV6Widgets))
check('备份导入拒绝非 HTTP(S) 的外部收藏', backupCheck.unsafeBookmarkRejected === true)
check('备份导入拒绝 SVG 等非白名单图片', backupCheck.unsafePhotoRejected === true)
check('备份导入拒绝音乐记录中的危险协议', backupCheck.unsafeMusicRejected === true)
check('旧 v4 备份仍可导入，末批三表按空处理', backupCheck.legacyV4NewTables === 0)
check('旧 v3 备份仍可导入，作品与相册按空处理', backupCheck.legacyV3NewTables === 0)
check('旧 v2 备份仍可导入，新增两表按空处理', backupCheck.legacyV2NewTables === 0)
check('旧 v1 聊天备份仍可导入', backupCheck.legacyV1Home === 0)

const dbShape = await evaluate(`(async () => {
  const request = indexedDB.open('habitat-db')
  const db = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
  const value = { version: db.version, stores: [...db.objectStoreNames] }
  db.close()
  return value
})()`)
check('Dexie 已升到 v9，十张 Home 表 + 主屏 Widget 表齐全', dbShape.version === 90 && ['moments', 'wishlist', 'countdowns', 'diaries', 'bookmarks', 'artworks', 'photos', 'readingNotes', 'musicTracks', 'studyRecords', 'homeWidgets'].every((name) => dbShape.stores.includes(name)), JSON.stringify(dbShape))
check('控制台无异常', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '))

const passed = results.filter(Boolean).length
console.log(`\n=== 汇总：通过 ${passed} / ${results.length} ===`)
ws.close()
process.exit(passed === results.length ? 0 : 1)
