/** Nocturne 原生 Dashboard 入口。
 *
 * Habitat 不复制 Nocturne 前端，也不把 MCP token 传给浏览器。浏览器只拿到
 * “是否已配置”的状态，真正打开时由服务端 302 到部署方指定的受保护页面。
 */
import type { FastifyInstance } from 'fastify'
import { ErrorCodes } from '@shared/errors'
import type { NocturneDashboardState } from '@shared/types'
import { RequestError } from '../lib/errors.js'

interface DashboardConfig {
  url: string | null
  error: string | null
}

function dashboardConfig(): DashboardConfig {
  const raw = process.env.NOCTURNE_DASHBOARD_URL?.trim() ?? ''
  if (raw === '') return { url: null, error: null }
  try {
    const parsed = new URL(raw)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { url: null, error: 'Dashboard URL 只支持 http / https' }
    }
    // Dashboard 入口不应把账号密码或 query token 变成浏览器可见 URL。
    if (parsed.username !== '' || parsed.password !== '' || parsed.searchParams.has('token')) {
      return { url: null, error: 'Dashboard URL 不允许携带账号、密码或 token' }
    }
    return { url: parsed.toString(), error: null }
  } catch {
    return { url: null, error: 'Dashboard URL 不是合法 URL' }
  }
}

export function registerNocturneDashboardRoutes(app: FastifyInstance): void {
  app.get('/api/nocturne/dashboard', async (): Promise<NocturneDashboardState> => {
    const config = dashboardConfig()
    return { configured: config.url !== null, error: config.error }
  })

  app.get('/api/nocturne/dashboard/open', async (_request, reply) => {
    const config = dashboardConfig()
    if (config.url === null) {
      throw new RequestError(
        config.error === null ? ErrorCodes.ProviderNotConfigured : ErrorCodes.BadRequest,
        config.error ?? 'Nocturne Dashboard 尚未配置',
      )
    }
    return reply.redirect(config.url, 302)
  })
}
