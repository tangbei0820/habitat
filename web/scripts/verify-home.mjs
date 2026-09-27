/**
 * Phase 2 Home 完整验收：八个生活模块 + 主屏 Widget + Dexie v13 持久化 / 备份 v11。
 * 前置：vite + 无头 Edge CDP；用 Node >= 22 运行（需全局 WebSocket）。
 * 请使用隔离的浏览器 profile：验收最后会导入一份空 v1 备份来验兼容性。
 *
 * ⚠️ **本支必须排在流水线最前**（`run-front-verify.sh` 里也是这么排的）。
 * 它是唯一一支开头就 `Storage.clearDataForOrigin` 的脚本 —— 排在后面的话，清库要等本轮末尾才发生，
 * **下一轮**的 verify-chat 就会继承本轮留下的收藏记录，而 chat 里「从原位加入收藏」用的是固定 id
 * （flow-text），撞上重复收藏就等不到「已加入收藏」，直接超时崩掉整支。
 * 这不是推测：verify-home 曾因语法错误整支没执行（parse 错误 → 模块根本不跑 → 清库没发生），
 * 下一轮 chat 就超时在「收藏成功反馈」。
 */
const CDP = process.env.VERIFY_CDP ?? 'http://127.0.0.1:9222'
const APP = process.env.VERIFY_APP ?? 'http://127.0.0.1:5174'
const NAVIGATION_TIMEOUT = 60000
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
  await waitFor(`document.body.innerText.includes(${JSON.stringify(text)})`, `${path} 就绪`, NAVIGATION_TIMEOUT)
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

async function setTextFile(selector, name, content) {
  return evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)})
    if (!(element instanceof HTMLInputElement) || element.type !== 'file') return false
    const transfer = new DataTransfer()
    transfer.items.add(new File([${JSON.stringify(content)}], ${JSON.stringify(name)}, { type: 'text/plain' }))
    element.files = transfer.files
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
// 每轮自建干净前提，避免固定浏览器 profile 残留的 IndexedDB / localStorage 让失败点漂移。
await send('Storage.clearDataForOrigin', { origin: new URL(APP).origin, storageTypes: 'all' })

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
  const stores = ['sessions', 'sessionGroups', 'messages', 'wishlist', 'countdowns',
    'bookmarks', 'bookmarkCategories', 'artworks', 'photos', 'photoCollections',
    'readingNotes', 'musicTracks', 'studyRecords', 'homeWidgets', 'legacyUploads']
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

await navigate('/home/diary', '我的日记')
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

// AI 日记的片段级开放：只把被小栖明确打开的段落下发，锁住的段落仍只显示占位。
// 使用固定 id 保持探针幂等，避免每轮浏览器验收都在服务端堆一篇不可删除的 AI 日记。
await evaluate(`(async () => {
  const item = {
    id: 'verify-diary-fragments',
    title: '验收·片段开放',
    content: '第一段仍然私密。\\n第二段小栖愿意分享。\\n第三段继续锁住。',
    entryDate: '2026-09-27',
    author: 'companion',
    visibility: 'private',
    fragmentVisibilityJson: { 'fragment-1': 'open' },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  const response = await fetch('/api/diary/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ items: [item] }),
  })
  return response.ok
})()`)
await send('Page.reload')
await sleep(500)
await waitFor(`document.querySelector('[data-testid="diary-fragments"]') !== null`, '片段级日记渲染')
const fragmentView = await evaluate(`(() => {
  const item = [...document.querySelectorAll('[data-testid="diary-item"]')]
    .find((node) => node.querySelector('h3')?.textContent?.trim() === '验收·片段开放')
  if (!item) return null
  return {
    open: item.querySelector('[data-testid="diary-fragment-fragment-1"]')?.textContent?.trim() ?? '',
    locked: [0, 2].map((index) => item.querySelector('[data-testid="diary-fragment-fragment-' + index + '"]')?.textContent?.trim() ?? ''),
    summary: item.textContent?.includes('小栖已开放 1 段') === true,
  }
})()`)
check(
  'AI 日记只展示已开放片段，锁住片段保留占位与权限提示',
  fragmentView?.open === '第二段小栖愿意分享。' &&
    fragmentView.locked.every((text) => text === '这一段还没有开放。') &&
    fragmentView.summary === true,
  JSON.stringify(fragmentView),
)

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

await navigate('/home/reading', '共读书架')
await setTextFile('[data-testid="reading-import"]', '验收共读.txt', '第一段：我们在黄昏里翻开同一本书。\n第二段：这一句值得停下来，写一点自己的想法。\n第三段：读到这里，先把书签夹好。')
await waitFor(`document.querySelector('[data-testid="reading-reader"]') !== null && document.body.innerText.includes('验收共读')`, 'TXT 书籍进入阅读器')
check('TXT 导入后进入真实阅读器', true)
await setValue('#reading-search', '停下来')
await waitFor(`document.body.innerText.includes('命中 1 段')`, '正文搜索命中')
check('阅读器支持正文搜索', true)
await evaluate(`document.querySelector('[data-testid="reading-paragraph-1"]')?.click()`)
await waitFor(`document.querySelector('[data-testid="reading-progress"]')?.value === '1'`, '阅读进度落盘')
check('点击正文可保存阅读进度', true)
await clickButton('夹书签')
await waitFor(`document.body.innerText.includes('已书签')`, '书签切换')
check('阅读器支持书签', true)
await evaluate(`document.querySelector('[data-testid="reading-paragraph-1"] button')?.click()`)
await setValue('[data-testid="reading-annotation"]', '这句让我想到我们最近的对话。')
await clickButton('保存批注')
await waitFor(`document.body.innerText.includes('你的划线') && document.body.innerText.includes('这句让我想到我们最近的对话。')`, '批注落盘')
check('用户可在正文锚点上划线并批注', true)
await waitFor(`(async () => { const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit' }).format(new Date()); const summary = await fetch('/api/life/month?month=' + month).then((response) => response.ok ? response.json() : null); if (!summary) return false; for (const day of summary.days) { if (!day.eventCount) continue; const detail = await fetch('/api/life/day/' + day.dayKey).then((response) => response.ok ? response.json() : null); if (detail?.events?.some((event) => event.eventType === 'reading.opened' && event.metricsJson.bookTitle === '验收共读')) return true; } return false; })()`, '共读行为投影到 Life')
check('阅读打开行为进入 Life 日期明细', true)
await clickButton('← 回到书架')
await waitFor(`document.querySelector('[data-testid="reading-shelf"]') !== null && document.body.innerText.includes('验收共读')`, '返回书架')
await send('Page.reload'); await sleep(500)
await waitFor(`document.body.innerText.includes('验收共读') && document.body.innerText.includes('2 / 3 段')`, '阅读进度刷新保留')
check('书架与进度 / 批注跨刷新保留', true)
await clickButton('继续阅读')
await waitFor(`document.querySelector('[data-testid="reading-reader-surface"]') !== null`, '重新打开阅读器')
await clickButton('夜间')
await waitFor(`document.querySelector('[data-testid="reading-reader-surface"]')?.style.backgroundColor === 'rgb(28, 27, 26)'`, '夜间阅读样式')
check('阅读器支持夜间模式', true)
await clickButton('大字')
await waitFor(`document.querySelector('[data-testid="reading-paragraph-0"]')?.style.fontSize === '19px'`, '大字样式')
check('阅读器支持字体大小', true)
await clickButton('加入生词')
await setValue('[data-testid="reading-vocabulary"]', '黄昏')
await setValue('input[placeholder="词义或提醒（可选）"]', '一天将暗未暗的时刻')
await clickButton('保存生词')
await waitFor(`document.body.innerText.includes('生词 · 黄昏')`, '生词落盘')
check('阅读器支持段落锚点生词本', true)
await clickButton('← 回到书架')

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

/* ---------- 收藏分类与相册分类（SPEC §3.5.4 / §3.7.3） ---------- */

const clickTestId = (id) => evaluate(`(() => {
  const el = document.querySelector('[data-testid=${JSON.stringify(id)}]')
  if (!el) return false
  el.click()
  return true
})()`)

/** 按名字找分类 chip：分类 id 是随机 UUID，测试里只能按名字定位。返回 chip 原文（带条数） */
const chipText = (name) => evaluate(`(() => {
  const chip = [...document.querySelectorAll('[data-testid^="category-chip-"]')]
    .find((el) => el.innerText.trim().startsWith(${JSON.stringify(name)}))
  return chip === undefined ? null : chip.innerText.trim()
})()`)

const clickChip = (name) => evaluate(`(() => {
  const chip = [...document.querySelectorAll('[data-testid^="category-chip-"]')]
    .find((el) => el.innerText.trim().startsWith(${JSON.stringify(name)}))
  if (chip === undefined) return false
  chip.click()
  return true
})()`)

/** 点管理菜单里某一项（菜单项的 testid 带分类 id，只能按文案点） */
const clickMenuItemByText = (prefix, text) => evaluate(`(() => {
  const item = [...document.querySelectorAll('[data-testid^=${JSON.stringify(prefix)}]')]
    .find((el) => el.innerText.trim().startsWith(${JSON.stringify(text)}))
  if (item === undefined) return false
  item.click()
  return true
})()`)

/** 读库里的分类表；断言「记录真的被删掉」不能只看界面 */
const readCategories = (store) => evaluate(`(async () => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('habitat-db')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  const rows = await new Promise((resolve, reject) => {
    const request = db.transaction(${JSON.stringify(store)}).objectStore(${JSON.stringify(store)}).getAll()
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  db.close()
  return rows.map((row) => ({ id: row.id, name: row.name }))
})()`)

/** 读内容表里的归属字段，用来验「归属到底写没写进去」（界面上的分区看着对也可能是渲染层兜的） */
const readOwnership = (store, field) => evaluate(`(async () => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('habitat-db')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  const rows = await new Promise((resolve, reject) => {
    const request = db.transaction(${JSON.stringify(store)}).objectStore(${JSON.stringify(store)}).getAll()
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  db.close()
  return rows.map((row) => ({ id: row.id, title: row.title, owner: row[${JSON.stringify(field)}] }))
})()`)

/** 打开「新建分类」弹层：没有分类时入口是那枚独立按钮，有分类时收在「⋯」里 */
async function openCreateCategory(label) {
  const hasBar = await evaluate(`document.querySelector('[data-testid="category-chip-all"]') !== null`)
  if (hasBar) {
    await clickTestId('category-manage')
    await waitFor(`document.querySelector('[data-testid="action-create"]') !== null`, `${label}：管理菜单打开`)
    await clickTestId('action-create')
  } else {
    await clickTestId('create-category')
  }
  await waitFor(`document.querySelector('[data-testid="name-sheet-input"]') !== null`, `${label}：新建弹层打开`)
}

async function createCategory(label, name) {
  await openCreateCategory(label)
  await setValue('[data-testid="name-sheet-input"]', name)
  await clickTestId('name-sheet-save')
  await waitFor(`document.querySelector('[data-testid="name-sheet-input"]') === null`, `${label}：分类创建完成`)
}

/** ⋯ → 点某个分类 → 二级菜单（重命名 / 删除） */
async function openCategoryItem(label, name) {
  await clickTestId('category-manage')
  await waitFor(`document.querySelector('[data-testid="action-create"]') !== null`, `${label}：管理菜单打开`)
  const clicked = await clickMenuItemByText('action-item:', name)
  if (clicked !== true) throw new Error(`${label}：管理菜单里没有「${name}」`)
  await waitFor(`document.querySelector('[data-testid="action-rename"]') !== null`, `${label}：「${name}」二级菜单打开`)
}

await navigate('/home/bookmarks', '收藏一个链接')

check(
  '一个分类都没有时不渲染筛选条，只留一枚「新建分类」',
  (await evaluate(`document.querySelector('[data-testid="category-chip-all"]') === null && document.querySelector('[data-testid="create-category"]') !== null`)) === true,
)

await clickTestId('create-category')
await waitFor(`document.querySelector('[data-testid="name-sheet-input"]') !== null`, '新建分类弹层打开')
check('分类名为空时保存按钮不可用', (await evaluate(`document.querySelector('[data-testid="name-sheet-save"]').disabled`)) === true)
await setValue('[data-testid="name-sheet-input"]', '资料')
await clickTestId('name-sheet-save')
await waitFor(`document.querySelector('[data-testid="category-chip-all"]') !== null`, '分类落库并出现筛选条')
const categoriesAfterCreate = await readCategories('bookmarkCategories')
check(
  '新建的收藏分类已落库',
  categoriesAfterCreate.length === 1 && categoriesAfterCreate[0].name === '资料',
  JSON.stringify(categoriesAfterCreate),
)
check(
  '筛选条三条 chip 的计数都对（全部 1 / 未分类 1 / 资料 0）',
  (await chipText('全部')) === '全部（1）' &&
    (await chipText('未分类')) === '未分类（1）' &&
    (await chipText('资料')) === '资料（0）',
  JSON.stringify({ all: await chipText('全部'), none: await chipText('未分类'), own: await chipText('资料') }),
)

const bookmarkRows = await readOwnership('bookmarks', 'categoryId')
const bookmarkId = bookmarkRows.find((row) => row.title === '栖息地参考页')?.id
if (bookmarkId === undefined) throw new Error('找不到之前建的收藏，无法继续验收')

await clickTestId(`bookmark-menu-${bookmarkId}`)
await waitFor(`document.querySelector('[data-testid="action-move"]') !== null`, '收藏行菜单打开')
check(
  '未分类的收藏有「移入分类」、没有「移出分类」',
  (await evaluate(`document.querySelector('[data-testid="action-unassign"]') === null`)) === true,
)

await clickTestId('action-move')
await waitFor(`document.querySelector('[data-testid="action-move-new-category"]') !== null`, '选分类菜单打开')
check('「移入分类」里列出了刚建的那个分类', (await clickMenuItemByText('action-category:', '资料')) === true)
await waitFor(`document.querySelector('[data-testid="list-toast"]') !== null`, '移入分类反馈')

const afterMove = (await readOwnership('bookmarks', 'categoryId')).find((row) => row.title === '栖息地参考页')
check(
  '归属真的写进了 categoryId（不是只画对了）',
  afterMove !== undefined && afterMove.owner === categoriesAfterCreate[0].id,
  JSON.stringify(afterMove),
)
check(
  '筛选条计数跟着更新（资料 1 / 未分类 0）',
  (await chipText('资料')) === '资料（1）' && (await chipText('未分类')) === '未分类（0）',
  JSON.stringify({ own: await chipText('资料'), none: await chipText('未分类') }),
)

await clickChip('未分类')
await waitFor(`document.querySelector('[data-testid="bookmark-filter-empty"]') !== null`, '「未分类」筛出空态')
check('筛「未分类」时已归类的收藏不再出现', (await evaluate(`document.body.innerText.includes('栖息地参考页')`)) === false)
await clickChip('资料')
await waitFor(`document.body.innerText.includes('栖息地参考页')`, '筛「资料」能看到这条')
check('筛某个分类时只显示该分类下的收藏', (await evaluate(`document.querySelectorAll('[data-testid^="bookmark-row-"]').length`)) === 1)

await clickTestId(`bookmark-menu-${bookmarkId}`)
await waitFor(`document.querySelector('[data-testid="action-unassign"]') !== null`, '已归类的收藏多出「移出分类」')
await clickTestId('action-unassign')
await waitFor(`document.querySelector('[data-testid="list-toast"]') !== null`, '移出分类反馈')
const afterUnassign = (await readOwnership('bookmarks', 'categoryId')).find((row) => row.title === '栖息地参考页')
check(
  '移出分类后回到未分类，分类本身还在',
  afterUnassign?.owner === null && (await readCategories('bookmarkCategories')).length === 1,
  JSON.stringify({ owner: afterUnassign?.owner }),
)

/**
 * ⚠️ 移出之后这条不再属于「资料」，而筛选还停在「资料」上 —— 它就从列表里消失了。
 * 这是**对的行为**（用户正在看这一类），但后续还要在列表上点它，所以得先回到「全部」。
 * 这类「操作改变了当前筛选的可见集合」的坑，只要脚本点过 chip 就可能踩到。
 */
await clickChip('全部')
await waitFor(`document.querySelector('[data-testid="bookmark-menu-${bookmarkId}"]') !== null`, '回到「全部」后这条收藏重新可见')

await createCategory('新建第二个分类', '灵感')
const beforeRename = await readCategories('bookmarkCategories')
await openCategoryItem('重命名分类', '资料')
await clickTestId('action-rename')
await waitFor(`document.querySelector('[data-testid="name-sheet-input"]') !== null`, '重命名弹层打开')
check(
  '重命名弹层预填当前名称',
  (await evaluate(`document.querySelector('[data-testid="name-sheet-input"]').value`)) === '资料',
)
await setValue('[data-testid="name-sheet-input"]', '归档')
await clickTestId('name-sheet-save')
await waitFor(`document.querySelector('[data-testid="name-sheet-input"]') === null`, '重命名完成')
const afterRename = await readCategories('bookmarkCategories')
check(
  '重命名写入库中，且没有多出一个分类',
  afterRename.length === beforeRename.length && afterRename.some((row) => row.name === '归档') && !afterRename.some((row) => row.name === '资料'),
  JSON.stringify(afterRename),
)
check('筛选条上的名字同步更新', (await chipText('归档')) === '归档（0）', String(await chipText('归档')))

// 再把那条收藏移进「归档」，好验「删非空分类」的确认语与后果
await clickTestId(`bookmark-menu-${bookmarkId}`)
await waitFor(`document.querySelector('[data-testid="action-move"]') !== null`, '收藏行菜单打开')
await clickTestId('action-move')
await waitFor(`document.querySelector('[data-testid="action-move-new-category"]') !== null`, '选分类菜单打开')
await clickMenuItemByText('action-category:', '归档')
await waitFor(
  `[...document.querySelectorAll('[data-testid^="category-chip-"]')].some((el) => el.innerText.trim().startsWith('归档（1'))`,
  '归档计数更新为 1',
)

/**
 * 脏引用兜底：绕过界面往库里塞一条指向不存在分类的收藏。
 * 这种数据只可能来自「导入的备份 / 手工改过的库」—— 它必须落在「未分类」里，
 * 否则那条内容哪个筛选里都不出现，等于从界面上凭空消失（SPEC §3.5.4 兜底区）。
 */
const ghostBookmarkId = 'verify-home-ghost-bookmark'
await evaluate(`(async () => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('habitat-db')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  await new Promise((resolve, reject) => {
    const store = db.transaction('bookmarks', 'readwrite').objectStore('bookmarks')
    const request = store.put({
      id: ${JSON.stringify(ghostBookmarkId)}, type: 'bookmark', targetType: 'external-link',
      targetId: 'https://example.com/ghost', title: '脏引用收藏', note: null,
      categoryId: 'ghost-category', createdAt: Date.now(), updatedAt: Date.now(),
    })
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
  db.close()
  return true
})()`)
await send('Page.reload')
await sleep(600)
await waitFor(`document.querySelector('[data-testid="category-chip-all"]') !== null`, '刷新后筛选条回到「全部」')
check(
  '脏引用的收藏被算进「未分类」，没有从界面上消失（全部 2 / 未分类 1）',
  (await chipText('全部')) === '全部（2）' && (await chipText('未分类')) === '未分类（1）',
  JSON.stringify({ all: await chipText('全部'), none: await chipText('未分类') }),
)
await clickChip('未分类')
await waitFor(`document.body.innerText.includes('脏引用收藏')`, '脏引用在「未分类」里可见')
check('脏引用确实落在「未分类」筛选里', true)
await clickChip('全部')

await openCategoryItem('删除分类', '归档')
await clickTestId('action-delete')
await waitFor(`document.querySelector('[data-testid="action-confirm-delete"]') !== null`, '出现删除确认项')
check(
  '删除非空分类的确认语写清了「几条回到未分类」',
  (await evaluate(`document.querySelector('[data-testid="action-confirm-delete"]').innerText.trim()`)) === '确认删除？（1 条回到未分类）',
  await evaluate(`document.querySelector('[data-testid="action-confirm-delete"]').innerText.trim()`),
)
await clickTestId('action-confirm-delete')
await waitFor(`[...document.querySelectorAll('[data-testid^="category-chip-"]')].every((el) => !el.innerText.trim().startsWith('归档'))`, '归档分类消失')
check(
  '删分类不删收藏：那条收藏仍在，且回到未分类',
  (await readCategories('bookmarkCategories')).every((row) => row.name !== '归档') &&
    (await readOwnership('bookmarks', 'categoryId')).find((row) => row.title === '栖息地参考页')?.owner === null,
  JSON.stringify(await readOwnership('bookmarks', 'categoryId')),
)

await openCategoryItem('删除空分类', '灵感')
await clickTestId('action-delete')
await waitFor(`document.querySelector('[data-testid="action-confirm-delete"]') !== null`, '出现删除确认项')
check(
  '删除空分类的确认语不带条数',
  (await evaluate(`document.querySelector('[data-testid="action-confirm-delete"]').innerText.trim()`)) === '确认删除？',
  await evaluate(`document.querySelector('[data-testid="action-confirm-delete"]').innerText.trim()`),
)
await clickTestId('action-confirm-delete')
await waitFor(`document.querySelector('[data-testid="category-chip-all"]') === null`, '分类删光后筛选条消失')
check(
  '分类删光后回到「只有一枚新建按钮」的形态',
  (await evaluate(`document.querySelector('[data-testid="create-category"]') !== null`)) === true,
)

/* ---------- 相册分类（与收藏同构，重点是「移出 ≠ 删除」） ---------- */

await navigate('/home/album', '放进一张照片')
await createCategory('相册：新建', '旅行')
const collectionsAfterCreate = await readCategories('photoCollections')
check(
  '新建的相册已落库',
  collectionsAfterCreate.length === 1 && collectionsAfterCreate[0].name === '旅行',
  JSON.stringify(collectionsAfterCreate),
)

const photoRows = await readOwnership('photos', 'collectionId')
const photoId = photoRows.find((row) => row.title === '一像素的纪念')?.id
if (photoId === undefined) throw new Error('找不到之前存的照片，无法继续验收')

await clickTestId(`photo-menu-${photoId}`)
await waitFor(`document.querySelector('[data-testid="action-move"]') !== null`, '照片行菜单打开')
check(
  '未归类的照片有「移入相册」、没有「移出相册」，删除项写的是「删除照片」',
  (await evaluate(`document.querySelector('[data-testid="action-unassign"]') === null`)) === true &&
    (await evaluate(`document.querySelector('[data-testid="action-delete"]').innerText.trim()`)) === '删除照片',
)
await clickTestId('action-move')
await waitFor(`document.querySelector('[data-testid="action-move-new-collection"]') !== null`, '选相册菜单打开')
await clickMenuItemByText('action-collection:', '旅行')
await waitFor(
  `[...document.querySelectorAll('[data-testid^="category-chip-"]')].some((el) => el.innerText.trim().startsWith('旅行（1'))`,
  '相册计数更新为 1',
)
const photoAfterMove = (await readOwnership('photos', 'collectionId')).find((row) => row.title === '一像素的纪念')
check(
  '照片的归属写进了 collectionId',
  photoAfterMove !== undefined && photoAfterMove.owner === collectionsAfterCreate[0].id,
  JSON.stringify(photoAfterMove),
)

await openCategoryItem('删除相册', '旅行')
await clickTestId('action-delete')
await waitFor(`document.querySelector('[data-testid="action-confirm-delete"]') !== null`, '出现删除确认项')
check(
  '删除非空相册的确认语说的是「几张回到未分类」',
  (await evaluate(`document.querySelector('[data-testid="action-confirm-delete"]').innerText.trim()`)) === '确认删除？（1 张回到未分类）',
  await evaluate(`document.querySelector('[data-testid="action-confirm-delete"]').innerText.trim()`),
)
await clickTestId('action-confirm-delete')
await waitFor(`document.querySelector('[data-testid="category-chip-all"]') === null`, '相册删光后筛选条消失')
const photosAfterDelete = await readOwnership('photos', 'collectionId')
check(
  '删相册不删照片：照片本身还在，只是回到未分类',
  photosAfterDelete.some((row) => row.title === '一像素的纪念' && row.owner === null),
  JSON.stringify(photosAfterDelete),
)
check('删相册之后照片仍然显示在页面上', (await evaluate(`document.querySelector('img[alt="一像素的纪念"]') !== null`)) === true)

await navigate('/home/bookmarks', '收藏一个链接')
await clickTestId(`bookmark-menu-${ghostBookmarkId}`)
await waitFor(`document.querySelector('[data-testid="action-delete"]') !== null`, '脏引用收藏的菜单打开')
await clickTestId('action-delete')
await waitFor(`document.querySelector('[data-testid="bookmark-confirm-${ghostBookmarkId}"]') !== null`, '出现二次确认')
await clickTestId(`bookmark-confirm-${ghostBookmarkId}`)
await waitFor(`document.body.innerText.includes('脏引用收藏') === false`, '脏引用收藏已被清理')
check('验收过程中造出来的脏引用数据已被清掉', true)

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
  // 备份验收要盯住「最近新增的那部分内容」：会话分组（v6）、主屏 Widget（v7）、
  // 收藏分类与相册（v8）都先在库里造出来再导出。分类与归属走**仓储层**造 ——
  // 手写对象得自己凑齐字段，漏一个就变成「备份没带走」的假失败。
  const homeModule = await import('/src/db/home.ts')
  const backupCategory = await homeModule.createBookmarkCategory('备份验收分类')
  const backupCollection = await homeModule.createPhotoCollection('备份验收相册')
  const backupBookmarkRow = (await homeModule.listBookmarks()).find((row) => row.title === '栖息地参考页')
  const backupPhotoRow = (await homeModule.listPhotos()).find((row) => row.title === '一像素的纪念')
  if (backupBookmarkRow === undefined || backupPhotoRow === undefined) {
    throw new Error('备份验收缺少前置数据：收藏或照片不在库里')
  }
  await homeModule.setBookmarkCategory(backupBookmarkRow.id, backupCategory.id)
  await homeModule.setPhotoCollection(backupPhotoRow.id, backupCollection.id)

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
  const restoredCategoryRow = await readBack('bookmarkCategories', backupCategory.id)
  const restoredCollectionRow = await readBack('photoCollections', backupCollection.id)
  const restoredBookmarkRow = await readBack('bookmarks', backupBookmarkRow.id)
  const restoredPhotoRow = await readBack('photos', backupPhotoRow.id)
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
  // v7 时期的收藏没有 categoryId 字段：导入后必须补成 null（落进「未分类」）。
  // 留成 undefined 的话，这批旧数据在筛选条里哪个都不出现 —— 等于凭空消失
  const legacyV7 = await backupModule.importAll({
    format: 'habitat-backup', version: 7, exportedAt: Date.now(),
    sessions: [], sessionGroups: [], messages: [], moments: [], wishlist: [], countdowns: [],
    diaries: [], bookmarks: [{
      id: 'legacy-v7-bookmark', type: 'bookmark', targetType: 'external-link',
      targetId: 'https://example.com/legacy', title: 'v7 时期的收藏', note: null,
      createdAt: Date.now(), updatedAt: Date.now(),
    }],
    artworks: [], photos: [], readingNotes: [], musicTracks: [], studyRecords: [], homeWidgets: [],
  })
  const legacyV7Bookmark = await readBack('bookmarks', 'legacy-v7-bookmark')

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
    exportedHome: backup.wishlist.length + backup.countdowns.length + backup.bookmarks.length + backup.artworks.length + backup.photos.length + backup.readingNotes.length + backup.musicTracks.length + backup.studyRecords.length,
    restoredHome: restored.wishlist + restored.countdowns + restored.bookmarks + restored.artworks + restored.photos + restored.readingNotes + restored.musicTracks + restored.studyRecords,
    unsafeBookmarkRejected,
    unsafePhotoRejected,
    unsafeMusicRejected,
    legacyV4NewTables: legacyV4.readingNotes + legacyV4.musicTracks + legacyV4.studyRecords,
    legacyV3NewTables: legacyV3.artworks + legacyV3.photos,
    // v9 起日记 / 留言板归服务端：旧备份里的它们不再落 Dexie，而是转存进中转表 ——
    // 计数语义随之从 diaries 改为 legacyDiaries（含义仍是「这批数据有没有被接住」）
    legacyV2NewTables: legacyV2.legacyDiaries + legacyV2.bookmarks,
    legacyV1Home: legacyV1.legacyMoments + legacyV1.wishlist + legacyV1.countdowns + legacyV1.legacyDiaries + legacyV1.bookmarks + legacyV1.artworks + legacyV1.photos + legacyV1.readingNotes + legacyV1.musicTracks + legacyV1.studyRecords,
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
    backupCategoryId: backupCategory.id,
    backupCollectionId: backupCollection.id,
    exportedCategories: backup.bookmarkCategories.length,
    restoredCategories: restored.bookmarkCategories,
    restoredCategoryName: restoredCategoryRow?.name,
    restoredBookmarkCategoryId: restoredBookmarkRow?.categoryId,
    exportedCollections: backup.photoCollections.length,
    restoredCollections: restored.photoCollections,
    restoredCollectionName: restoredCollectionRow?.name,
    restoredPhotoCollectionId: restoredPhotoRow?.collectionId,
    legacyV7Categories: legacyV7.bookmarkCategories,
    legacyV7Collections: legacyV7.photoCollections,
    legacyV7BookmarkFound: legacyV7Bookmark !== undefined,
    legacyV7BookmarkCategoryId: legacyV7Bookmark === undefined ? 'no-row' : legacyV7Bookmark.categoryId,
  }
})()`)
check('备份 v11 覆盖本地 Home 数据并可整体恢复（日记 / 留言板已归服务端）', backupCheck.version === 11 && backupCheck.exportedHome >= 7 && backupCheck.restoredHome === backupCheck.exportedHome, JSON.stringify(backupCheck))
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
check(
  '备份 v8 带走收藏分类与相册，以及条目的归属',
  backupCheck.exportedCategories === 1 &&
    backupCheck.restoredCategories === 1 &&
    backupCheck.restoredCategoryName === '备份验收分类' &&
    backupCheck.restoredBookmarkCategoryId === backupCheck.backupCategoryId &&
    backupCheck.exportedCollections === 1 &&
    backupCheck.restoredCollections === 1 &&
    backupCheck.restoredCollectionName === '备份验收相册' &&
    backupCheck.restoredPhotoCollectionId === backupCheck.backupCollectionId,
  JSON.stringify({
    categories: [backupCheck.exportedCategories, backupCheck.restoredCategories],
    categoryName: backupCheck.restoredCategoryName,
    bookmarkCategoryId: backupCheck.restoredBookmarkCategoryId,
    collections: [backupCheck.exportedCollections, backupCheck.restoredCollections],
    collectionName: backupCheck.restoredCollectionName,
    photoCollectionId: backupCheck.restoredPhotoCollectionId,
  }),
)
check(
  '旧 v7 备份仍可导入：分类按空处理，条目的归属补成「未分类」',
  backupCheck.legacyV7Categories === 0 &&
    backupCheck.legacyV7Collections === 0 &&
    backupCheck.legacyV7BookmarkFound === true &&
    backupCheck.legacyV7BookmarkCategoryId === null,
  JSON.stringify({
    categories: backupCheck.legacyV7Categories,
    collections: backupCheck.legacyV7Collections,
    bookmarkFound: backupCheck.legacyV7BookmarkFound,
    categoryId: backupCheck.legacyV7BookmarkCategoryId,
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

/* ---------- v11 启动期搬迁：旧表里剩余的行必须被搬走 + 清空 ---------- */
// 旧表壳删不掉（Dexie 的 stores() 跨版本累加，省略不等于删除，见 db.ts 类注释 v11 条），
// 所以「搬迁到底成没成」不能靠「表在不在」判断，只能靠数据本身证明。
// 这里主动往旧表塞两行（模拟 v10 时代留下的数据）→ 重新进应用触发启动期搬迁 →
// 三条都要成立：服务端收下了、旧表空了、中转表空了。
const strayTitle = '搬迁探针-' + Date.now()
const strayMoment = '搬迁前的本地留言-' + Date.now()
await evaluate(`(async () => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('habitat-db')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  const put = (store, rows) => new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    rows.forEach((row) => tx.objectStore(store).put(row))
    tx.oncomplete = () => resolve('ok')
    tx.onerror = () => reject(tx.error)
  })
  const now = Date.now()
  await put('diaries', [{ id: 'stray-diary', type: 'diary', title: '${strayTitle}', content: '搬迁前的本地日记', entryDate: '2026-09-24', createdAt: now, updatedAt: now }])
  await put('moments', [{ id: 'stray-moment', type: 'moment', content: '${strayMoment}', author: 'user', createdAt: now, updatedAt: now }])
  db.close()
  return 'ok'
})()`)
// 重新进应用 = 触发启动期搬迁。用 /api 回读来确认「服务端真的收下了」，而不是只看本地删没删。
await navigate('/home', '留言板')
let migrated = true
try {
  await waitFor(
    `(async () => {
      const [diary, moments] = await Promise.all([
        fetch('/api/diary').then((r) => r.json()),
        fetch('/api/moments').then((r) => r.json()),
      ])
      return diary.items.some((item) => item.title === ${JSON.stringify(strayTitle)}) &&
        moments.items.some((item) => item.content === ${JSON.stringify(strayMoment)})
    })()`,
    '启动期搬迁把旧表数据送到服务端',
    20000,
  )
} catch {
  migrated = false
}
check('启动期搬迁：旧表里的日记与留言都被送到服务端', migrated)

// 清源发生在「服务端回包之后」的下一拍：回读命中不代表本地已经删完，稍等一拍再数。
await sleep(400)
const dbShape = await evaluate(`(async () => {
  const request = indexedDB.open('habitat-db')
  const db = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
  const count = (name) => db.objectStoreNames.contains(name)
    ? new Promise((resolve, reject) => {
        const r = db.transaction(name).objectStore(name).count()
        r.onsuccess = () => resolve(r.result)
        r.onerror = () => reject(r.error)
      })
    : -1
  const value = {
    version: db.version,
    stores: [...db.objectStoreNames],
    strayDiaries: await count('diaries'),
    strayMoments: await count('moments'),
    pending: await count('legacyUploads'),
  }
  db.close()
  return value
})()`)
check('Dexie 已升到 v13：v12 全部表 + AI 伴学卡片', dbShape.version === 130 && ['wishlist', 'countdowns', 'bookmarks', 'bookmarkCategories', 'artworks', 'photos', 'photoCollections', 'readingNotes', 'musicTracks', 'studyRecords', 'homeWidgets', 'legacyUploads', 'listenSessions', 'studyTasks', 'studyCards'].every((name) => dbShape.stores.includes(name)), JSON.stringify(dbShape))
// 旧表壳**删不掉**（Dexie 的 stores() 跨版本累加，省略 ≠ 删除，见 db.ts 类注释 v11 条），
// 所以这里验的是「搬走了」而不是「表没了」：旧表清空 + 中转表清空。
// 两者都为 0 才有意义 —— 中转表清空的前置是「服务端已确认」（见 legacy-upload.ts 的三条纪律）。
check('日记 / 留言板旧表已搬空，中转表也没有残留', dbShape.strayDiaries === 0 && dbShape.strayMoments === 0 && dbShape.pending === 0, JSON.stringify(dbShape))
check('控制台无异常', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '))

const passed = results.filter(Boolean).length
console.log(`\n=== 汇总：通过 ${passed} / ${results.length} ===`)
ws.close()
process.exit(passed === results.length ? 0 : 1)
