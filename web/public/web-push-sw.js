self.addEventListener('push', (event) => {
  let payload = { title: '栖息地', body: '你有一条新通知', url: '/life?tab=notifications' }
  try { payload = { ...payload, ...event.data.json() } } catch { /* 使用安全默认文案 */ }
  event.waitUntil(self.registration.showNotification(payload.title, {
    body: payload.body,
    tag: payload.tag,
    data: { url: payload.url },
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/life?tab=notifications'
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    const openWindow = windows[0]
    if (openWindow) {
      openWindow.navigate(url)
      return openWindow.focus()
    }
    return clients.openWindow(url)
  }))
})
