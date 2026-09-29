/**
 * Core-4 Desire 影子动机层。
 *
 * 这是一个确定性的状态投影器，不是第二套 Agent Runtime：它只接收已发生的结构化事件，
 * 让八个倾向维度缓慢漂移，产出 1..3 个候选意图并写审计。shadow 模式下不会注入 Chat、
 * 不会调用 LLM、不会执行候选行动；真正的 Wake / Solitude / BudgetGuard 仍拥有最终否决权。
 */
import { randomUUID } from 'node:crypto'
import type {
  DesireActionType,
  DesireDimension,
  DesireImpulse,
  DesireSnapshot,
  DesireSource,
} from '@shared/types.js'
import {
  appendDesireAudit,
  DEFAULT_DESIRE_VALUES,
  DESIRE_DIMENSIONS,
  getDesireSnapshot,
  saveDesireSnapshot,
} from '../db/desire.js'
import { appendEventLog } from '../db/activity.js'

const BASELINE = 0.5
const HALF_LIFE_MS = 6 * 60 * 60 * 1000
const IMPULSE_HALF_LIFE_MS = 8 * 60 * 60 * 1000
const CANDIDATE_TTL_MS = 6 * 60 * 60 * 1000

const DIMENSION_LABELS: Record<DesireDimension, string> = {
  attachment: '保持联系',
  curiosity: '了解新东西',
  reflection: '整理自己',
  duty: '把事情照看好',
  social: '留下些什么给北北',
  fatigue: '休息',
  libido: '亲密靠近',
  stress: '缓解紧绷',
}

const ACTION_BY_DIMENSION: Partial<Record<DesireDimension, { action: DesireActionType; reason: string }>> = {
  attachment: { action: 'message', reason: '我有一点想和北北保持联系。' },
  curiosity: { action: 'surf', reason: '我对一个新话题产生了兴趣。' },
  reflection: { action: 'diary', reason: '我想把最近的感受整理下来。' },
  duty: { action: 'messageboard', reason: '我想留下一点值得回看的话。' },
  social: { action: 'messageboard', reason: '我想在共同空间里留下存在感。' },
}

export interface DesireObserveInput {
  source: DesireSource
  /** 只保存归类后的 signal，不把正文写进 Desire 表。 */
  signal?: string
  text?: string
  speaker?: 'user' | 'companion'
  statePayload?: Record<string, unknown>
  refId?: string | null
  at?: number
}

export type DesireSatisfyOutcome = 'completed' | 'failed' | 'cancelled'

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value))
}

function rounded(value: number): number {
  return Math.round(value * 1000) / 1000
}

function cloneValues(values: Record<DesireDimension, number>): Record<DesireDimension, number> {
  return { ...values }
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function signalFromText(text: string, speaker: DesireObserveInput['speaker']): string {
  const value = text.trim().toLowerCase()
  if (value === '') return speaker === 'companion' ? 'chat.companion.empty' : 'chat.user.empty'
  if (/[?？]|为什么|怎么|如何|what|why|how/.test(value)) return 'chat.question'
  if (/喜欢|想你|想念|谢谢|抱抱|爱你|开心|晚安|早安|miss|love|thank/.test(value)) return 'chat.warm'
  if (/累|疲惫|困|焦虑|压力|难受|生气|崩溃|烦/.test(value)) return 'chat.strain'
  if (value.length <= 4) return 'chat.brief'
  return speaker === 'companion' ? 'chat.companion.normal' : 'chat.user.normal'
}

function signalDelta(input: DesireObserveInput, signal: string): Partial<Record<DesireDimension, number>> {
  const delta: Partial<Record<DesireDimension, number>> = {}
  const add = (dimension: DesireDimension, amount: number): void => {
    delta[dimension] = rounded((delta[dimension] ?? 0) + amount)
  }

  if (input.source === 'chat' || input.source === 'call') {
    add('social', input.speaker === 'companion' ? 0.01 : 0.025)
    add('attachment', input.speaker === 'companion' ? 0.008 : 0.018)
  }
  if (signal.includes('question')) add('curiosity', 0.06)
  if (signal.includes('warm')) {
    add('attachment', 0.07)
    add('social', 0.04)
    add('stress', -0.04)
  }
  if (signal.includes('strain')) {
    add('reflection', 0.035)
    add('duty', 0.02)
    add('stress', 0.06)
    add('fatigue', 0.04)
  }
  if (signal.includes('brief')) {
    add('attachment', -0.015)
    add('stress', 0.01)
  }
  if (signal === 'call.started') {
    add('social', 0.04)
    add('attachment', 0.035)
  }
  if (signal === 'call.ended') {
    add('reflection', 0.015)
    add('fatigue', 0.012)
  }
  if (signal.startsWith('eventide')) {
    const payload = input.statePayload ?? {}
    for (const dimension of ['fatigue', 'stress', 'libido'] as const) {
      const value = asFiniteNumber(payload[dimension])
      if (value !== null) add(dimension, clamp(value, 0, 1) * 0.05 - 0.025)
    }
    const energy = asFiniteNumber(payload.energy)
    if (energy !== null) add('fatigue', (0.5 - clamp(energy, 0, 1)) * 0.05)
  }
  return delta
}

function advanceSnapshot(snapshot: DesireSnapshot, now: number): DesireSnapshot {
  const elapsed = Math.max(0, now - snapshot.updatedAt)
  if (elapsed === 0) return snapshot
  const factor = Math.pow(0.5, elapsed / HALF_LIFE_MS)
  const values = cloneValues(snapshot.values)
  for (const dimension of DESIRE_DIMENSIONS) {
    values[dimension] = rounded(BASELINE + (values[dimension] - BASELINE) * factor)
  }
  const impulses = snapshot.impulses
    .map((impulse) => ({
      ...impulse,
      strength: rounded(impulse.strength * Math.pow(0.5, elapsed / IMPULSE_HALF_LIFE_MS)),
    }))
    .filter((impulse) => impulse.expiresAt > now && impulse.strength >= 0.08)
    .map((impulse) => ({
      ...impulse,
      kind: impulse.strength >= 0.7 ? 'longing' as const : 'flash' as const,
    }))
  const candidates = snapshot.candidates.map((candidate) => (
    candidate.status === 'candidate' && candidate.expiresAt <= now
      ? { ...candidate, status: 'expired' as const }
      : candidate
  ))
  return { ...snapshot, values, impulses, candidates, updatedAt: now }
}

function initialSnapshot(now: number): DesireSnapshot {
  return {
    mode: 'shadow',
    values: cloneValues(DEFAULT_DESIRE_VALUES),
    impulses: [],
    candidates: [],
    lastObservedAt: null,
    updatedAt: now,
  }
}

function candidateBlockedBy(values: Record<DesireDimension, number>): string[] {
  const blocked: string[] = []
  if (values.fatigue >= 0.78) blocked.push('fatigue')
  if (values.stress >= 0.9) blocked.push('stress')
  return blocked
}

function refreshCandidates(snapshot: DesireSnapshot, now: number): DesireSnapshot {
  const blockedBy = candidateBlockedBy(snapshot.values)
  const active = snapshot.candidates.filter((candidate) => candidate.status === 'candidate' && candidate.expiresAt > now)
  const candidates = [...active]
  for (const dimension of DESIRE_DIMENSIONS) {
    const mapping = ACTION_BY_DIMENSION[dimension]
    const strength = snapshot.values[dimension]
    if (mapping === undefined || strength < 0.63) continue
    const existing = candidates.find((candidate) => candidate.dimension === dimension && candidate.action === mapping.action)
    if (existing !== undefined) {
      existing.strength = rounded(strength)
      existing.blockedBy = [...blockedBy]
      existing.reason = mapping.reason
      existing.expiresAt = now + CANDIDATE_TTL_MS
      continue
    }
    candidates.push({
      id: `desire-${randomUUID()}`,
      action: mapping.action,
      dimension,
      strength: rounded(strength),
      reason: mapping.reason,
      status: 'candidate',
      blockedBy: [...blockedBy],
      createdAt: now,
      expiresAt: now + CANDIDATE_TTL_MS,
      satisfiedAt: null,
    })
  }
  candidates.sort((a, b) => b.strength - a.strength || a.createdAt - b.createdAt)
  return {
    ...snapshot,
    candidates: candidates.slice(0, 12),
  }
}

function addImpulse(snapshot: DesireSnapshot, dimension: DesireDimension, now: number): DesireSnapshot {
  const existing = snapshot.impulses.find((impulse) => impulse.dimension === dimension)
  const strength = clamp((existing?.strength ?? 0) + 0.08)
  const impulse: DesireImpulse = {
    id: existing?.id ?? `impulse-${randomUUID()}`,
    kind: strength >= 0.7 ? 'longing' : 'flash',
    dimension,
    label: DIMENSION_LABELS[dimension],
    strength: rounded(strength),
    touchedAt: now,
    expiresAt: now + IMPULSE_HALF_LIFE_MS * 3,
  }
  return {
    ...snapshot,
    impulses: [...snapshot.impulses.filter((item) => item.dimension !== dimension), impulse],
  }
}

export class DesireEngine {
  current(now = Date.now()): DesireSnapshot {
    const stored = getDesireSnapshot()
    return stored === null ? initialSnapshot(now) : advanceSnapshot(stored, now)
  }

  observe(input: DesireObserveInput): DesireSnapshot {
    const now = input.at ?? Date.now()
    const before = advanceSnapshot(getDesireSnapshot() ?? initialSnapshot(now), now)
    const signal = input.signal?.trim() || signalFromText(input.text ?? '', input.speaker)
    const delta = signalDelta(input, signal)
    const values = cloneValues(before.values)
    for (const dimension of DESIRE_DIMENSIONS) {
      values[dimension] = rounded(clamp(values[dimension] + (delta[dimension] ?? 0)))
    }
    let next: DesireSnapshot = {
      ...before,
      values,
      lastObservedAt: now,
      updatedAt: now,
    }
    for (const dimension of DESIRE_DIMENSIONS) {
      if ((delta[dimension] ?? 0) >= 0.03) next = addImpulse(next, dimension, now)
    }
    next = refreshCandidates(next, now)
    saveDesireSnapshot(next)
    appendDesireAudit({ source: input.source, signal, delta, values: next.values, refId: input.refId, at: now })
    return next
  }

  tick(now = Date.now()): DesireSnapshot {
    const before = getDesireSnapshot() ?? initialSnapshot(now)
    const next = refreshCandidates(advanceSnapshot(before, now), now)
    saveDesireSnapshot(next)
    appendDesireAudit({ source: 'eventide', signal: 'tick', delta: {}, values: next.values, at: now })
    return next
  }

  satisfy(candidateId: string, outcome: DesireSatisfyOutcome, now = Date.now()): DesireSnapshot {
    const current = refreshCandidates(advanceSnapshot(getDesireSnapshot() ?? initialSnapshot(now), now), now)
    const target = current.candidates.find((candidate) => candidate.id === candidateId && candidate.status === 'candidate')
    if (target === undefined || outcome !== 'completed' || target.blockedBy.length > 0) {
      saveDesireSnapshot(current)
      appendEventLog('desire.satisfy.skipped', {
        candidateId,
        outcome,
        reason: target === undefined ? 'candidate_not_found' : target.blockedBy.length > 0 ? 'blocked' : 'action_not_completed',
      }, candidateId, now)
      return current
    }
    const values = cloneValues(current.values)
    values[target.dimension] = rounded(BASELINE + (values[target.dimension] - BASELINE) * 0.75)
    const next: DesireSnapshot = {
      ...current,
      values,
      candidates: current.candidates.map((candidate) => candidate.id === candidateId
        ? { ...candidate, status: 'satisfied' as const, satisfiedAt: now }
        : candidate),
      updatedAt: now,
    }
    saveDesireSnapshot(next)
    appendEventLog('desire.satisfy.completed', { candidateId, action: target.action, dimension: target.dimension }, candidateId, now)
    return next
  }

  /** 将真实行动结果映射到同类候选；找不到候选也只记 skipped，不凭空满足欲望。 */
  satisfyAction(action: DesireActionType, outcome: DesireSatisfyOutcome, now = Date.now()): DesireSnapshot {
    const candidate = this.current(now).candidates.find((item) => item.status === 'candidate' && item.action === action)
    if (candidate === undefined) {
      appendEventLog('desire.satisfy.skipped', { action, outcome, reason: 'candidate_not_found' }, null, now)
      return this.current(now)
    }
    return this.satisfy(candidate.id, outcome, now)
  }
}

export function desireDimensionLabel(dimension: DesireDimension): string {
  return DIMENSION_LABELS[dimension]
}
