import type { NocturneDashboardState } from '@shared/types'
import { fetchJson } from './api'

export const NOCTURNE_DASHBOARD_OPEN_PATH = '/api/nocturne/dashboard/open'

export function getNocturneDashboard(): Promise<NocturneDashboardState> {
  return fetchJson<NocturneDashboardState>('/api/nocturne/dashboard')
}
