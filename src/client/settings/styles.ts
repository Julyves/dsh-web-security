/**
 * 安全页共享样式常量（使用宿主 --dsw-alias-* 语义变量，明暗自适应）。
 *
 * 未引入 CSS Modules 构建链前，以 JS 对象形式提供，避免 esbuild 额外配置。
 * 变量参考宿主 ui-settings-plugins / ui-theme 的规范值。
 */
export const page = {
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '24px',
    maxWidth: '760px',
    color: 'var(--dsw-alias-label-primary)',
    fontSize: '13px',
    lineHeight: '20px',
  },
  banner: {
    padding: '12px 16px',
    borderRadius: '8px',
    border: '1px solid var(--dsw-alias-border-critical, #ff6b6b)',
    background: 'var(--dsw-alias-bg-critical, rgba(255,107,107,0.08))',
    color: 'var(--dsw-alias-label-critical, #d14343)',
    fontSize: '13px',
    lineHeight: '18px',
  },
} as const

export const section = {
  card: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '14px',
    padding: '16px',
    borderRadius: '10px',
    border: '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,0.08))',
    background: 'var(--dsw-alias-bg-elevated, rgba(255,255,255,0.04))',
  },
  title: {
    margin: 0,
    fontSize: '14px',
    fontWeight: 600,
    color: 'var(--dsw-alias-label-primary)',
    letterSpacing: '0.02em',
  },
  divider: {
    height: '1px',
    background: 'var(--dsw-alias-border-l2, rgba(255,255,255,0.08))',
    margin: '2px 0',
  },
} as const

export const list = {
  ul: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '8px',
    margin: 0,
    padding: 0,
    listStyle: 'none',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '8px 12px',
    borderRadius: '8px',
    border: '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,0.08))',
    background: 'var(--dsw-alias-bg-app, transparent)',
    flexWrap: 'wrap' as const,
  },
  name: {
    fontWeight: 500,
    minWidth: '88px',
  },
  actions: {
    display: 'flex',
    gap: '6px',
    marginLeft: 'auto',
    flexWrap: 'wrap' as const,
  },
} as const

export const form = {
  row: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap' as const,
    alignItems: 'flex-end',
  },
  field: {
    flex: '1 1 160px',
    minWidth: '140px',
  },
  error: {
    color: 'var(--dsw-alias-label-critical, #ff6b6b)',
    fontSize: '12px',
    margin: '4px 0 0',
  },
  hint: {
    color: 'var(--dsw-alias-label-tertiary)',
    fontSize: '12px',
  },
} as const

export const policy = {
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: '12px 16px',
    alignItems: 'end',
  },
  toggleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 0',
  },
  label: {
    flex: '1 1 auto',
    fontSize: '13px',
  },
  numberField: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '4px',
  },
} as const

export const audit = {
  list: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '6px',
    margin: 0,
    padding: 0,
    listStyle: 'none',
    maxHeight: '420px',
    overflowY: 'auto' as const,
    borderRadius: '8px',
    border: '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,0.08))',
    paddingInline: '4px' as unknown as string,
  },
  row: {
    display: 'grid',
    gridTemplateColumns: '110px 170px 1fr 110px',
    gap: '8px',
    alignItems: 'center',
    padding: '6px 8px',
    borderRadius: '6px',
    fontSize: '12px',
    lineHeight: '16px',
  },
  rowAlt: {
    background: 'var(--dsw-alias-bg-subtle, rgba(255,255,255,0.03))',
  },
  kind: {
    justifySelf: 'start' as const,
    padding: '1px 6px',
    borderRadius: '999px',
    fontSize: '11px',
    fontWeight: 500,
    background: 'var(--dsw-alias-bg-accent-subtle, rgba(82,52,140,0.15))',
    color: 'var(--dsw-alias-label-accent, #7a5bd8)',
    whiteSpace: 'nowrap' as const,
  },
  time: {
    color: 'var(--dsw-alias-label-tertiary)',
    fontVariantNumeric: 'tabular-nums' as const,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '11px',
    whiteSpace: 'nowrap' as const,
  },
  actor: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    color: 'var(--dsw-alias-label-secondary)',
  },
}
