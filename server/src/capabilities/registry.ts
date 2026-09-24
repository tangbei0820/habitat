/**
 * Capability Registry · 运行时侧
 *
 * 静态声明在 `shared/capabilities.ts`，这里只回答一件事：**「现在到底能用哪几个」**。
 *
 * 判定顺序只有三条，且不能换：
 *   1. **阶段未实施** → 不可用（写类能力当前都在这条，P1 才落地）
 *   2. **依赖未就绪** → 不可用（Nocturne 没配 / Eventide 没配）
 *   3. 否则 → 可用，按声明里的 `autonomy` 放行
 *
 * 为什么不把「登记了」直接当成「可用」：那样 AI 会被告知自己有能力、真调用时却失败 ——
 * 比一开始就不知道更糟（这正是本 Phase 要修的病）。宁可如实说「暂时没有」。
 */
import type { CapabilityId, CapabilitySnapshot } from '@shared/capabilities.js'
import { CAPABILITY_DEFINITIONS } from '@shared/capabilities.js'
import type { MemoryProvider, StateProvider, ToolGateway } from '@shared/providers.js'

/**
 * 已登记但**本阶段尚未实施**的能力 → 原因。
 *
 * 放在这里而不是运行时探测，是因为这些取决于施工阶段、不取决于环境 ——
 * 不管 Nocturne 通不通，`memory.write` 在写工具接入之前都不存在。
 * **实施后逐条从这里删掉**，删一条就多一个真能力。
 *
 * ⚠️ 2026-09-24（P1）：日记与留言板的七项已从此表**移除** ——
 * 它们依赖的服务端权威存储（T-036）与确认卡协议（T-037）都已落地。
 * 判断「能不能用」重新回到环境探测（Nocturne / Eventide 那两条）。
 */
const NOT_IMPLEMENTED_YET: Partial<Record<CapabilityId, string>> = {
  'memory.write': '本阶段只读接入 Nocturne（实例的写工具 hold 尚未接入）',
}

/** 记忆链路探测结果的缓存时长。`verifyToolFace()` 会实发 MCP 请求，不能每轮都问。 */
const MEMORY_PROBE_TTL_MS = 60_000

interface MemoryProbe {
  at: number
  ready: boolean
  reason: string | null
}

export class CapabilityService {
  private memoryProbe: MemoryProbe | null = null

  constructor(
    private readonly gateway: ToolGateway,
    private readonly memory: MemoryProvider | null,
    private readonly state: StateProvider | null,
  ) {}

  /** 当前能力快照。system context / tool schemas / LLM 页面卡片共用这一份。 */
  async snapshot(now = new Date()): Promise<CapabilitySnapshot[]> {
    const memory = await this.probeMemory(now)
    const stateReady = this.state !== null

    return CAPABILITY_DEFINITIONS.map((def): CapabilitySnapshot => {
      const base = {
        id: def.id,
        module: def.module,
        label: def.label,
        summary: def.summary,
        modelHint: def.modelHint,
      }

      const pending = NOT_IMPLEMENTED_YET[def.id]
      if (pending !== undefined) {
        return { ...base, enabled: false, autonomy: 'unavailable', reason: pending }
      }
      if (def.module === 'memory' && !memory.ready) {
        return {
          ...base,
          enabled: false,
          autonomy: 'unavailable',
          reason: memory.reason ?? '记忆链路未就绪',
        }
      }
      if (def.module === 'state' && !stateReady) {
        return { ...base, enabled: false, autonomy: 'unavailable', reason: 'Eventide 未配置' }
      }
      return {
        ...base,
        enabled: true,
        autonomy: def.autonomy,
        ...(def.tool === undefined ? {} : { toolName: def.tool.name }),
      }
    })
  }

  /**
   * 记忆链路是否真的能用：先看 MCP 连接状态，再看实例是否提供适配层需要的工具。
   *
   * 两步都要 —— 连接 ready 但工具面漂移（实例改名/换血统）一样是「不能用」，
   * 而且那种情况下报出来的原因必须能直接指向排查动作。
   */
  private async probeMemory(now: Date): Promise<MemoryProbe> {
    if (this.memoryProbe !== null && now.getTime() - this.memoryProbe.at < MEMORY_PROBE_TTL_MS) {
      return this.memoryProbe
    }

    const settle = (ready: boolean, reason: string | null): MemoryProbe => {
      const probe: MemoryProbe = { at: now.getTime(), ready, reason }
      this.memoryProbe = probe
      return probe
    }

    if (this.memory === null) return settle(false, 'Nocturne 未配置')

    let state: string | null = null
    try {
      const health = await this.gateway.health()
      state = health.find((item) => item.serverId === 'nocturne')?.state ?? null
    } catch {
      return settle(false, 'MCP 网关不可用')
    }
    if (state !== 'ready') {
      return settle(false, `Nocturne 连接状态为 ${state ?? '未知'}`)
    }

    try {
      const missing = await this.memory.verifyToolFace()
      // 空数组有两种含义：工具面齐了，或压根没问出来（见 verifyToolFace 注释）。
      // 连接已确认 ready，这里按「齐了」处理；真缺工具时下一次调用会以真实错误暴露。
      if (missing.length > 0) {
        return settle(false, `实例缺少记忆工具：${missing.join('、')}`)
      }
    } catch {
      return settle(false, '记忆工具面自检失败')
    }
    return settle(true, null)
  }

  /** 主动作废缓存（换了实例 / 手动刷新 / 测试用）。 */
  invalidate(): void {
    this.memoryProbe = null
  }
}
