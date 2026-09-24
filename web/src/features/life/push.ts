import { deletePushSubscription, savePushSubscription } from './api'

function vapidKey(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.padEnd(value.length + (4 - value.length % 4) % 4, '=')
  const binary = atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

export function browserPushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

/**
 * 取承载推送处理器的 Service Worker。
 *
 * ⚠️ Phase 6 起**不再自己注册** `/web-push-sw.js`：同一个作用域只能有一个 SW，
 * 而 PWA 生成的 SW 已用 `importScripts` 把那个文件的推送处理器并了进来（见 `vite.config.ts`）。
 * 两处各注册一次会互相顶掉，表现为「推送时有时无」。
 *
 * 拿不到时返回 `null`，**不用** `navigator.serviceWorker.ready` 硬等 ——
 * 开发期不注册 SW，`ready` 会永远挂起，把「读一下当前订阅状态」这种只读动作一起拖死。
 */
async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!browserPushSupported()) return null
  const existing = await navigator.serviceWorker.getRegistration('/')
  if (existing === undefined) return null
  // 已有注册再等 activation 是安全的：ready 一定会解析，不会永久挂起
  if (existing.active === null) return navigator.serviceWorker.ready
  return existing
}

export async function currentPushSubscription(): Promise<PushSubscription | null> {
  const serviceWorker = await registration()
  if (serviceWorker === null) return null
  return serviceWorker.pushManager.getSubscription()
}

export async function enablePush(publicKey: string): Promise<void> {
  if (!browserPushSupported()) throw new Error('当前浏览器不支持 Web Push')
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('通知权限未获允许')
  const serviceWorker = await registration()
  if (serviceWorker === null) throw new Error('离线能力尚未就绪，暂时无法启用推送')
  const existing = await serviceWorker.pushManager.getSubscription()
  const subscription = existing ?? await serviceWorker.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: vapidKey(publicKey),
  })
  await savePushSubscription(subscription.toJSON())
}

export async function disablePush(): Promise<void> {
  const subscription = await currentPushSubscription()
  if (subscription === null) return
  await deletePushSubscription(subscription.endpoint)
  await subscription.unsubscribe()
}
