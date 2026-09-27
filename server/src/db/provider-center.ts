/** Provider Center：四通道当前绑定与命名方案。 */
import { randomUUID } from 'node:crypto'
import { asc, eq, ne } from 'drizzle-orm'
import type {
  ApiProfile,
  ProviderBindingSnapshot,
  ProviderCapability,
  ProviderCapabilityBinding,
  ProviderScheme,
  ProviderSchemeBindings,
} from '@shared/types'
import { db } from './index.js'
import {
  apiProfile,
  providerCapabilityBinding,
  providerScheme,
  type ProviderCapabilityBindingRow,
  type ProviderSchemeRow,
} from './schema.js'

const CAPABILITIES: readonly ProviderCapability[] = ['chat', 'voice', 'vision', 'image']

function toBinding(row: ProviderCapabilityBindingRow): ProviderCapabilityBinding {
  return {
    capability: row.capability,
    profileId: row.profileId,
    model: row.model,
    secondaryModel: row.secondaryModel ?? null,
    lastTestedAt: row.lastTestedAt ?? null,
    lastLatencyMs: row.lastLatencyMs ?? null,
    lastError: row.lastError ?? null,
    updatedAt: row.updatedAt,
  }
}

function toScheme(row: ProviderSchemeRow): ProviderScheme {
  return {
    id: row.id,
    name: row.name,
    bindings: row.bindings,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function listCapabilityBindings(): ProviderCapabilityBinding[] {
  return db.select().from(providerCapabilityBinding).orderBy(asc(providerCapabilityBinding.capability)).all().map(toBinding)
}

export function getCapabilityBinding(capability: ProviderCapability): ProviderCapabilityBinding | null {
  const row = db.select().from(providerCapabilityBinding)
    .where(eq(providerCapabilityBinding.capability, capability)).get()
  return row === undefined ? null : toBinding(row)
}

/** 老版本只有一个 active profile；首次升级时只为真实配置过模型的能力补绑定。 */
export function seedCapabilityBindings(profile: ApiProfile | null): void {
  if (profile === null) return
  const candidates: Array<[ProviderCapability, string | undefined, string | null]> = [
    ['chat', profile.modelMap.chat, null],
    ['voice', profile.modelMap.tts, profile.modelMap.transcription ?? null],
    ['vision', profile.modelMap.vision, null],
    ['image', profile.modelMap.image, null],
  ]
  const now = Date.now()
  for (const [capability, model, secondaryModel] of candidates) {
    if (model === undefined || model.trim() === '' || getCapabilityBinding(capability) !== null) continue
    db.insert(providerCapabilityBinding).values({
      capability,
      profileId: profile.id,
      model,
      secondaryModel,
      lastTestedAt: null,
      lastLatencyMs: null,
      lastError: null,
      updatedAt: now,
    }).run()
  }
}

export interface SaveCapabilityBindingInput extends ProviderBindingSnapshot {
  capability: ProviderCapability
  lastTestedAt?: number | null
  lastLatencyMs?: number | null
  lastError?: string | null
}

export function saveCapabilityBinding(input: SaveCapabilityBindingInput): ProviderCapabilityBinding {
  const now = Date.now()
  const values = {
    capability: input.capability,
    profileId: input.profileId,
    model: input.model,
    secondaryModel: input.secondaryModel,
    lastTestedAt: input.lastTestedAt ?? null,
    lastLatencyMs: input.lastLatencyMs ?? null,
    lastError: input.lastError ?? null,
    updatedAt: now,
  }
  db.transaction((tx) => {
    tx.insert(providerCapabilityBinding).values(values).onConflictDoUpdate({
      target: providerCapabilityBinding.capability,
      set: values,
    }).run()
    // 手工改一张卡后，当前状态已不再等于任何已命名方案。
    tx.update(providerScheme).set({ isActive: false }).run()
  })
  const saved = getCapabilityBinding(input.capability)
  if (saved === null) throw new Error(`能力绑定 '${input.capability}' 保存后读回失败`)
  return saved
}

export function listProviderSchemes(): ProviderScheme[] {
  return db.select().from(providerScheme).orderBy(asc(providerScheme.createdAt)).all().map(toScheme)
}

function currentSnapshot(): ProviderSchemeBindings {
  return Object.fromEntries(listCapabilityBindings().map((binding) => [
    binding.capability,
    { profileId: binding.profileId, model: binding.model, secondaryModel: binding.secondaryModel },
  ])) as ProviderSchemeBindings
}

function requireComplete(bindings: ProviderSchemeBindings): void {
  const missing = CAPABILITIES.filter((capability) => bindings[capability] === undefined)
  if (missing.length > 0) throw new Error(`四个能力尚未全部保存：${missing.join(', ')}`)
}

function requireProfiles(bindings: ProviderSchemeBindings): void {
  for (const capability of CAPABILITIES) {
    const binding = bindings[capability]
    if (binding === undefined) continue
    const exists = db.select({ id: apiProfile.id }).from(apiProfile).where(eq(apiProfile.id, binding.profileId)).get()
    if (exists === undefined) throw new Error(`方案的 ${capability} 引用了已不存在的连接 '${binding.profileId}'`)
  }
}

export function createProviderScheme(name: string): ProviderScheme {
  const bindings = currentSnapshot()
  requireComplete(bindings)
  requireProfiles(bindings)
  const now = Date.now()
  const id = randomUUID()
  db.transaction((tx) => {
    tx.update(providerScheme).set({ isActive: false }).run()
    tx.insert(providerScheme).values({ id, name, bindings, isActive: true, createdAt: now, updatedAt: now }).run()
  })
  const row = db.select().from(providerScheme).where(eq(providerScheme.id, id)).get()
  if (row === undefined) throw new Error('Provider 方案保存后读回失败')
  return toScheme(row)
}

export function renameProviderScheme(id: string, name: string): ProviderScheme | null {
  const existing = db.select().from(providerScheme).where(eq(providerScheme.id, id)).get()
  if (existing === undefined) return null
  db.update(providerScheme).set({ name, updatedAt: Date.now() }).where(eq(providerScheme.id, id)).run()
  const row = db.select().from(providerScheme).where(eq(providerScheme.id, id)).get()
  return row === undefined ? null : toScheme(row)
}

export function copyProviderScheme(id: string, name: string): ProviderScheme | null {
  const source = db.select().from(providerScheme).where(eq(providerScheme.id, id)).get()
  if (source === undefined) return null
  requireProfiles(source.bindings)
  const now = Date.now()
  const copyId = randomUUID()
  db.insert(providerScheme).values({
    id: copyId,
    name,
    bindings: source.bindings,
    isActive: false,
    createdAt: now,
    updatedAt: now,
  }).run()
  const row = db.select().from(providerScheme).where(eq(providerScheme.id, copyId)).get()
  return row === undefined ? null : toScheme(row)
}

export function activateProviderScheme(id: string): ProviderScheme | null {
  const scheme = db.select().from(providerScheme).where(eq(providerScheme.id, id)).get()
  if (scheme === undefined) return null
  requireComplete(scheme.bindings)
  requireProfiles(scheme.bindings)
  const now = Date.now()
  db.transaction((tx) => {
    tx.delete(providerCapabilityBinding).run()
    for (const capability of CAPABILITIES) {
      const binding = scheme.bindings[capability]
      if (binding === undefined) throw new Error(`方案缺少 ${capability}`)
      tx.insert(providerCapabilityBinding).values({
        capability,
        profileId: binding.profileId,
        model: binding.model,
        secondaryModel: binding.secondaryModel,
        lastTestedAt: null,
        lastLatencyMs: null,
        lastError: null,
        updatedAt: now,
      }).run()
    }
    tx.update(providerScheme).set({ isActive: false }).where(ne(providerScheme.id, id)).run()
    tx.update(providerScheme).set({ isActive: true, updatedAt: now }).where(eq(providerScheme.id, id)).run()
  })
  const activated = db.select().from(providerScheme).where(eq(providerScheme.id, id)).get()
  return activated === undefined ? null : toScheme(activated)
}

export function deleteProviderScheme(id: string): boolean {
  return db.delete(providerScheme).where(eq(providerScheme.id, id)).run().changes > 0
}

export function profileBindingReferences(profileId: string): string[] {
  const direct = listCapabilityBindings()
    .filter((binding) => binding.profileId === profileId)
    .map((binding) => `当前${binding.capability}绑定`)
  const schemes = listProviderSchemes()
    .filter((scheme) => Object.values(scheme.bindings).some((binding) => binding?.profileId === profileId))
    .map((scheme) => `方案「${scheme.name}」`)
  return [...direct, ...schemes]
}
