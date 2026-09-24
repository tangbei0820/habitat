/**
 * LLM 页面的一张「能力模块卡片」（SPEC §9.1.1）。
 *
 * 一张卡片 = 一个模块 = 一个「应用」：卡内列出小栖在这个模块下会做的事，
 * 有界面的模块整张卡可点进去，没有界面的模块明说「暂无界面」且**不可点** ——
 * 不做假入口。做成假入口的代价是用户点进去发现是空壳，从此不再相信这张卡片上的任何字。
 */
import { Link } from 'react-router-dom'
import type { CapabilitySnapshot } from '@shared/capabilities'
import { IconChevronRight, QixiIcon } from '../../components/qixi/Icons'
import { AUTONOMY_LABELS, type CapabilityModuleMeta } from './capabilityModules'

/** 小状态点：可用 / 不可用。纯装饰，语义由旁边的文字承担（不让颜色独自说话） */
function StatusDot({ enabled }: { enabled: boolean }) {
  return (
    <span
      aria-hidden
      className="mr-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full align-middle"
      style={{ backgroundColor: enabled ? 'var(--color-primary)' : 'var(--color-text-dim)' }}
    />
  )
}

function CapabilityRow({ capability }: { capability: CapabilitySnapshot }) {
  const enabled = capability.enabled
  return (
    <li
      data-testid={`capability-${capability.id}`}
      data-enabled={String(enabled)}
      className="border-t pt-2 first:border-t-0 first:pt-0"
      style={{ borderColor: 'var(--color-border)' }}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
        <span className="font-medium" style={{ color: enabled ? 'var(--color-text)' : 'var(--color-text-dim)' }}>
          <StatusDot enabled={enabled} />
          {capability.label}
        </span>
        <span className="text-xs" style={{ color: 'var(--color-text-dim)' }}>
          {AUTONOMY_LABELS[capability.autonomy]}
        </span>
      </div>
      <p className="mt-0.5 text-xs" style={{ color: 'var(--color-text-dim)' }}>
        {capability.summary}
      </p>
      {/*
        不可用时**必须**给出原因（SPEC §9.1.1 / API.md：enabled=false 时 reason 必填）。
        显示成灰但不说为什么，用户只会以为界面坏了。
      */}
      {!enabled && capability.reason !== undefined && (
        <p data-testid={`capability-reason-${capability.id}`} className="mt-0.5 text-xs" style={{ color: 'var(--color-text-dim)' }}>
          为什么现在用不了：{capability.reason}
        </p>
      )}
      {enabled && capability.toolName !== undefined && (
        <p className="mt-0.5 text-xs" style={{ color: 'var(--color-text-dim)' }}>
          工具：<code>{capability.toolName}</code>
        </p>
      )}
    </li>
  )
}

export function CapabilityModuleCard({
  meta,
  capabilities,
}: {
  meta: CapabilityModuleMeta
  capabilities: readonly CapabilitySnapshot[]
}) {
  const { launch } = meta

  const inner = (
    <>
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <QixiIcon name={meta.icon} size={17} style={{ color: 'var(--color-primary)' }} />
          {meta.name}
        </h2>
        {launch !== null ? (
          <span
            className="flex shrink-0 items-center gap-0.5 text-xs"
            style={{ color: 'var(--color-primary)' }}
          >
            {launch.label}
            <IconChevronRight size={13} />
          </span>
        ) : (
          <span className="shrink-0 text-right text-xs" style={{ color: 'var(--color-text-dim)' }}>
            暂无界面
          </span>
        )}
      </div>
      {launch === null && meta.noPageHint !== undefined && (
        <p className="mt-1 text-xs" style={{ color: 'var(--color-text-dim)' }}>{meta.noPageHint}</p>
      )}
      <ul className="mt-3 grid gap-2">
        {capabilities.map((capability) => (
          <CapabilityRow key={capability.id} capability={capability} />
        ))}
      </ul>
    </>
  )

  const cardStyle = {
    borderColor: 'var(--color-border)',
    backgroundColor: 'var(--color-surface)',
  } as const

  // 不可点的模块用 div：`<a>` 会被读屏与键盘当成可进入的入口
  if (launch === null) {
    return (
      <div
        data-testid={`llm-module-${meta.key}`}
        data-launchable="false"
        className="rounded-lg border p-4"
        style={cardStyle}
      >
        {inner}
      </div>
    )
  }

  return (
    <Link
      to={launch.to}
      data-testid={`llm-module-${meta.key}`}
      data-launchable="true"
      aria-label={`${launch.label}：${meta.name}`}
      className="block rounded-lg border p-4"
      style={cardStyle}
    >
      {inner}
    </Link>
  )
}
