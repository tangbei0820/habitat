import type { FastifyInstance } from 'fastify'
import { ErrorCodes } from '@shared/errors.js'
import type { ListeningPlaybackState, ListeningSessionView, MusicTrack } from '@shared/types.js'
import { RequestError } from '../lib/errors.js'
import { getListeningSession, listListeningHistory, updateListeningSession, type ListeningSessionPatch } from '../db/listening.js'

type TrackSnapshot = Pick<MusicTrack, 'id' | 'title' | 'artist' | 'externalUrl'>

function bodyRecord(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new RequestError(ErrorCodes.BadRequest, '请求体必须是 JSON 对象')
  }
  return raw as Record<string, unknown>
}

function track(raw: unknown): TrackSnapshot | null {
  if (raw === null) return null
  const item = bodyRecord(raw)
  if (typeof item.id !== 'string' || item.id.trim() === '' || item.id.length > 160) throw new RequestError(ErrorCodes.BadRequest, 'track.id 无效')
  if (typeof item.title !== 'string' || item.title.trim() === '' || item.title.length > 160) throw new RequestError(ErrorCodes.BadRequest, 'track.title 无效')
  const artist = item.artist === null || item.artist === undefined ? null : typeof item.artist === 'string' ? item.artist.trim().slice(0, 160) : null
  const externalUrl = item.externalUrl === null || item.externalUrl === undefined ? null : typeof item.externalUrl === 'string' ? item.externalUrl.trim() : null
  if (externalUrl !== null) {
    let parsed: URL
    try { parsed = new URL(externalUrl) } catch { throw new RequestError(ErrorCodes.BadRequest, 'track.externalUrl 不是合法 URL') }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new RequestError(ErrorCodes.BadRequest, 'track.externalUrl 只支持 http / https')
  }
  return { id: item.id.trim(), title: item.title.trim(), artist, externalUrl }
}

function patchOf(raw: unknown): ListeningSessionPatch {
  const body = bodyRecord(raw)
  const state: ListeningPlaybackState = body.state === undefined ? 'paused' : body.state === 'playing' || body.state === 'paused' || body.state === 'idle' ? body.state : (() => { throw new RequestError(ErrorCodes.BadRequest, 'state 必须是 idle / playing / paused') })()
  const positionSeconds = body.positionSeconds === undefined ? 0 : body.positionSeconds
  if (typeof positionSeconds !== 'number' || !Number.isFinite(positionSeconds) || positionSeconds < 0 || positionSeconds > 86_400) {
    throw new RequestError(ErrorCodes.BadRequest, 'positionSeconds 必须是 0–86400 的数字')
  }
  if (!('track' in body)) throw new RequestError(ErrorCodes.BadRequest, 'track 必填，可传 null 清空当前曲目')
  return { track: track(body.track), state, positionSeconds }
}

export function registerListeningRoutes(app: FastifyInstance): void {
  app.get('/api/listening/session', async (): Promise<ListeningSessionView> => getListeningSession())
  app.get('/api/listening/history', async (request) => {
    const raw = (request.query as Record<string, unknown>).limit
    const limit = raw === undefined ? 50 : Number(Array.isArray(raw) ? raw[0] : raw)
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new RequestError(ErrorCodes.BadRequest, 'limit 必须是 1–200 的整数')
    return { items: listListeningHistory(limit) }
  })
  app.put('/api/listening/session', async (request): Promise<ListeningSessionView> => updateListeningSession(patchOf(request.body)))
}
