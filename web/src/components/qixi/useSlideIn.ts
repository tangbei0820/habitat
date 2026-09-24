import { useNavigationType } from 'react-router-dom'

/**
 * 子页面进场动画的类名（SPEC §9.8.3）。
 *
 * 只在**导航进入**（PUSH）时返回 `slide-in` —— 直接打开网址、刷新、后退
 * 落到这里是 POP / REPLACE，那不叫「新开了一层」，播动画反而像页面自己抽了一下。
 *
 * ⚠️ 动画与网址是**两件事**：`/home/diary` 依然是真地址，
 * 刷新、后退、加书签、分享链接全部照常。这里只加一个 class，不动路由。
 */
export function useSlideIn(): string {
  return useNavigationType() === 'PUSH' ? 'slide-in' : ''
}
