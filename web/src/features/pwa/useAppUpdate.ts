/**
 * PWA 注册与「有新版本」状态。
 *
 * 刻意用 **prompt 模式**而非 `autoUpdate`：静默更新会在用户正看页面时把资源换掉，
 * 旧页面再去加载已被删除的懒加载 chunk 就会 404。给一条明确提示、让用户挑时机刷新更稳。
 *
 * ⚠️ 开发期不注册（`vite.config.ts` 的 `devOptions.enabled: false`），
 * 所以这里在 dev 下永远拿不到 `needRefresh` —— 这是预期行为，PWA 验收打的是生产构建产物。
 */
import { useRegisterSW } from 'virtual:pwa-register/react'
import { log } from '../../lib/log'

export interface AppUpdateState {
  /** 新版本已下载完成，等用户决定何时切换 */
  needRefresh: boolean
  /** 首次预缓存完成，应用从此可离线打开（提示一次就可以收起） */
  offlineReady: boolean
  applyUpdate: () => void
  dismiss: () => void
}

export function useAppUpdate(): AppUpdateState {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(error) {
      // 注册失败不该静默：否则「离线用不了」会变成一个查不出原因的谜
      log.error('Service Worker 注册失败', error)
    },
  })

  return {
    needRefresh,
    offlineReady,
    applyUpdate: () => {
      // true = 切换后顺带刷新页面，把新版本的资源真正用起来
      void updateServiceWorker(true)
    },
    dismiss: () => {
      setOfflineReady(false)
      setNeedRefresh(false)
    },
  }
}
