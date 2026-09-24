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

async function registration(): Promise<ServiceWorkerRegistration> {
  if (!browserPushSupported()) throw new Error('当前浏览器不支持 Web Push')
  return navigator.serviceWorker.register('/web-push-sw.js')
}

export async function currentPushSubscription(): Promise<PushSubscription | null> {
  if (!browserPushSupported()) return null
  return (await registration()).pushManager.getSubscription()
}

export async function enablePush(publicKey: string): Promise<void> {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('通知权限未获允许')
  const serviceWorker = await registration()
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
