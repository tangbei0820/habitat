import { useEffect, useState, type ReactNode } from 'react'
import {
  createBrowserRouter,
  Navigate,
  RouterProvider,
} from 'react-router-dom'
import { AppShell } from './AppShell'
import { hasEntered, WELCOME_PATH } from './entry'
import { hydrateDb } from '../db/db'
import { runLegacyUpload } from '../db/legacy-upload'
import { log } from '../lib/log'
import { ChatListPage } from '../pages/chat/ChatListPage'
import { ChatWindowPage } from '../pages/chat/ChatWindowPage'
import { HomePage } from '../pages/home/HomePage'
import { HomeModulePage } from '../pages/home/HomeModulePage'
import { LifePage } from '../pages/life/LifePage'
import { LlmPage } from '../pages/llm/LlmPage'
import { SettingPage } from '../pages/setting/SettingPage'
import { WelcomePage } from '../pages/welcome/WelcomePage'

/**
 * 根路径分流（SPEC §9.8.2）：本次会话还没进过 → 先看欢迎页；进过了 → 直接到对话。
 *
 * ⚠️ 判断放在**渲染时同步读**（`sessionStorage`），不走 state：
 * 走 state 会先渲染一帧「对话」再跳走，用户看到闪一下。
 */
function EntryRedirect() {
  return <Navigate to={hasEntered() ? '/chat' : WELCOME_PATH} replace />
}

function HydrationGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    hydrateDb()
      .then(() => {
        setState('ready')
        // v11 搬迁（若有）：**不阻塞进入应用** —— 搬不动（离线 / 后端没起）就下次启动再试，
        // 不该因为一件后台的事让人打不开门。搬完之前，日记 / 留言页会是空的，
        // 但数据在旧表和中转表里各有一份，不会丢（见 db/legacy-upload.ts）。
        void runLegacyUpload()
          .then((result) => {
            if (result !== null) log.info('本地日记 / 留言已搬到服务端', result)
          })
          .catch((err: unknown) => log.warn('本地数据搬迁未完成，下次启动会重试', err))
      })
      .catch((err: unknown) => {
        log.error('本地数据水合失败', err)
        setError(err)
        setState('failed')
      })
  }, [])

  if (state === 'loading') {
    return <div className="p-6 text-center" style={{ color: 'var(--text-secondary)' }}>正在唤醒栖息地…</div>
  }
  if (state === 'failed') {
    return (
      <div className="p-6">
        <h1 className="mb-2 text-lg font-semibold" style={{ color: 'var(--danger)' }}>
          本地数据加载失败
        </h1>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          请刷新页面重试。若反复出现，请备份后清理站点数据。
        </p>
        <pre className="mt-4 overflow-auto rounded p-3 text-xs" style={{ backgroundColor: 'var(--bg-subtle)' }}>
          {error instanceof Error ? error.message : String(error)}
        </pre>
      </div>
    )
  }
  return <>{children}</>
}

const router = createBrowserRouter(
  [
    {
      element: (
        <HydrationGate>
          <AppShell />
        </HydrationGate>
      ),
      children: [
        { path: '/', element: <EntryRedirect /> },
        { path: WELCOME_PATH, element: <WelcomePage /> },
        { path: '/chat', element: <ChatListPage /> },
        { path: '/chat/:sessionId', element: <ChatWindowPage /> },
        { path: '/home', element: <HomePage /> },
        { path: '/home/:module', element: <HomeModulePage /> },
        { path: '/llm', element: <LlmPage /> },
        { path: '/life', element: <LifePage /> },
        { path: '/setting', element: <SettingPage /> },
        { path: '*', element: <Navigate to="/chat" replace /> },
      ],
    },
  ],
  // 显式开启 future flags，消掉控制台升级警告（v7 行为与现用法兼容）
  { future: { v7_relativeSplatPath: true } },
)

export function App() {
  return <RouterProvider router={router} future={{ v7_startTransition: true }} />
}
