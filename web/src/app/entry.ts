/**
 * 「本次会话已经进过栖息地」的标记（SPEC §9.8.2）。
 *
 * 用 `sessionStorage` 而不是 `localStorage`：欢迎页的定位是**打开时先看一眼**，
 * 所以「一次冷启动 = 出现一次」。切回后台再回来不算新的打开，不该再拦一次。
 *
 * ⚠️ 隐私模式 / 存储被禁时 sessionStorage 会**抛异常**（不是返回 null）。
 * 这里显式吞掉：拿不到标记的后果只是「这次又看到欢迎页」，不影响任何功能，
 * 而让一个读不到的存储把首页打白屏是不可接受的。
 */
export const ENTERED_KEY = 'habitat.entered'

/** 欢迎页的地址。要用到它的地方（根路由重定向、验收脚本）都从这里取 */
export const WELCOME_PATH = '/welcome'

export function hasEntered(): boolean {
  try {
    return window.sessionStorage.getItem(ENTERED_KEY) === '1'
  } catch {
    return false
  }
}

export function markEntered(): void {
  try {
    window.sessionStorage.setItem(ENTERED_KEY, '1')
  } catch {
    // 存不进去就每次都能看到欢迎页 —— 降级可接受，不报错
  }
}
