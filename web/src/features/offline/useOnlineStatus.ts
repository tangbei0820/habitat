/**
 * 浏览器联网状态。
 *
 * ⚠️ `navigator.onLine === true` 只表示「网卡是通的」，**不代表后端可达**
 * （家里断了路由器上行、服务器挂了、被代理拦住都会是 true）。
 * 所以这个信号只用来做「已经明确离线时提前拦一下、并给出人话说明」，
 * 「连不上后端」仍然要靠请求本身失败来暴露 —— 两者不可互相替代。
 */
import { useEffect, useState } from 'react'

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine)

  useEffect(() => {
    const goOnline = (): void => setOnline(true)
    const goOffline = (): void => setOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    // 补一次同步：从首屏渲染到 effect 执行之间，状态可能已经变过
    setOnline(navigator.onLine)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  return online
}
