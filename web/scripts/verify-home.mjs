/**
 * Phase 2 Home 完整验收：十个生活模块 + Dexie v7 持久化。
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

async function waitFor(expression, label, timeout = 15000) {
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
await send('Page.reload'); await sleep(500)
await waitFor(`document.body.innerText.includes('共 60 分钟') && document.body.innerText.includes('备份边界')`, '学习记录刷新保留')
check('学习记录新增、编辑、汇总并跨刷新保留', true)

const backupCheck = await evaluate(`(async () => {
  const backupModule = await import('/src/lib/backup.ts')
  const backup = await backupModule.exportAll()
  const restored = await backupModule.importAll(backup)
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
  }
})()`)
check('备份 v5 覆盖十类 Home 数据并可整体恢复', backupCheck.version === 5 && backupCheck.exportedHome >= 9 && backupCheck.restoredHome === backupCheck.exportedHome, JSON.stringify(backupCheck))
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
check('Dexie 已升到 v7 且十张 Home 表齐全', dbShape.version === 70 && ['moments', 'wishlist', 'countdowns', 'diaries', 'bookmarks', 'artworks', 'photos', 'readingNotes', 'musicTracks', 'studyRecords'].every((name) => dbShape.stores.includes(name)), JSON.stringify(dbShape))
check('控制台无异常', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '))

const passed = results.filter(Boolean).length
console.log(`\n=== 汇总：通过 ${passed} / ${results.length} ===`)
ws.close()
process.exit(passed === results.length ? 0 : 1)
