/**
 * 审计日志区块：追加式查看器（最新在前）。
 *
 * 交互（grill-me Q7-A）：首屏 offset=0 limit=50，「加载更多」推进 offset，
 * hasMore=false 隐藏按钮。所有事件文本经 React 转义渲染为字面文本
 * （L3——actor/detail 是不可信输入）。错误态带重试（Story 13）。
 */
import { useEffect, useState } from 'react'
import type { FC } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { audit, form } from './styles.ts'

/** 审计事件视图（AuthEvent 镜像）。 */
export interface AuditEventView {
  readonly kind: string
  readonly at: number
  readonly actor: string
  readonly ip?: string
  readonly detail?: string
}

/** 审计读取结果。 */
export interface AuditPage {
  readonly events: readonly AuditEventView[]
  readonly hasMore: boolean
}

/** 审计区块注入面。 */
export interface AuditApi {
  readAudit(offset: number, limit: number): Promise<AuditPage>
}

/** 页大小（规格 Story 11 字面量）。 */
const PAGE_SIZE = 50

/** 审计区块 props。 */
export interface AuditBlockProps {
  t: (key: string) => string
  api: AuditApi
}

/** 审计日志区块组件。 */
export const AuditBlock: FC<AuditBlockProps> = ({ t, api }) => {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [events, setEvents] = useState<readonly AuditEventView[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [busy, setBusy] = useState(false)

  async function load(offset: number): Promise<void> {
    if (busy) return
    setBusy(true)
    try {
      const page = await api.readAudit(offset, PAGE_SIZE)
      setEvents(offset === 0 ? page.events : [...events, ...page.events])
      setHasMore(page.hasMore)
      setState('ready')
    } catch {
      setState('error')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void load(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 首载一次；重试经显式按钮。
  }, [api])

  return (
    <div data-block="audit" data-state={state} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {state === 'error'
        ? (
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <p data-error="" style={form.error}>{t('loadFailed')}</p>
              <Button data-action="audit-retry" onClick={() => { void load(0) }}>{t('retry')}</Button>
            </div>
          )
        : state === 'ready'
          ? (
              <>
                <ul style={audit.list}>
                  {events.map((e, i) => {
                    const alt = i % 2 === 1
                    return (
                      <li key={`${e.at}-${i}`} data-audit-item="" style={alt ? { ...audit.row, ...audit.rowAlt } : audit.row}>
                        <span style={audit.kind}>{e.kind}</span>
                        <time style={audit.time}>{new Date(e.at).toLocaleString()}</time>
                        <span style={audit.actor} title={e.actor}>{e.actor}</span>
                        <span style={{ ...audit.actor, color: 'var(--dsw-alias-label-tertiary)', fontSize: '11px' }} title={e.detail ?? e.ip ?? ''}>
                          {e.detail ?? e.ip ?? '—'}
                        </span>
                      </li>
                    )
                  })}
                </ul>
                {events.length === 0 ? <p style={form.hint}>{t('noAuditEvents')}</p> : null}
                {hasMore
                  ? <div><Button data-action="audit-more" disabled={busy} onClick={() => { void load(events.length) }}>{t('loadMore')}</Button></div>
                  : null}
              </>
            )
          : null}
    </div>
  )
}
