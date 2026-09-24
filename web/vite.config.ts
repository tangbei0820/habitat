import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const apiTarget = process.env.HABITAT_API_TARGET ?? 'http://localhost:3000'
const sharedDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../shared')
/** 与 index.html 的 theme-color、CSS Token --color-bg 保持一致 */
const THEME_COLOR = '#f6f4f1'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      /**
       * 由应用自己注册（`src/features/pwa/useAppUpdate.ts`），这样才能弹「有新版本」提示，
       * 而不是静默换掉用户正在看的页面。所以这里不注入注册代码。
       */
      registerType: 'prompt',
      injectRegister: null,
      includeAssets: ['apple-touch-icon.png'],
      manifest: {
        name: '栖息地',
        short_name: '栖息地',
        description: '北北与小栖的个人 AI 数字空间',
        lang: 'zh-CN',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: THEME_COLOR,
        theme_color: THEME_COLOR,
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          // maskable 单独出一张：图形已缩到中心安全区，被系统裁成圆形/异形也不会切掉叶子
          { src: 'pwa-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // app shell 预缓存：断网时仍能打开应用外壳，数据再走本机 IndexedDB
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff,woff2}'],
        /** Web Push 处理器由下面的 importScripts 并入本 SW，不必再单独预缓存一份 */
        globIgnores: ['**/web-push-sw.js'],
        /**
         * ⚠️ 同一个作用域只能有一个 Service Worker。Phase 4 的推送处理器是手写的
         * `public/web-push-sw.js`，若让它自己 `register()` 就会与本 SW 互相顶掉。
         * 这里把它作为附加脚本并入 —— 推送与离线共用一个 SW，两个能力都在。
         */
        importScripts: ['/web-push-sw.js'],
        // SPA 深链离线可用
        navigateFallback: 'index.html',
        /** ⚠️ `/api/` 绝不能落到 index.html 兜底上，否则断网时会拿到一页 HTML 当接口响应 */
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
      },
      /** 开发期不启 SW：否则改代码不生效，排查起来很费劲。PWA 验收打的是生产构建产物 */
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: {
      '@shared': sharedDir,
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
})
