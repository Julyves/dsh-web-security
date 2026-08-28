/**
 * 「安全」设置页（settings.section 贡献组件）。
 *
 * 五区块（M4）：警告横幅（有诊断时）/账号管理/通行密钥/安全策略/审计日志。
 * 区块内容由纵切逐步填充；本组件只消费 inject 面与 owner 股
 * （宿主 SettingsSectionOwnerProps.close）。状态经 useEffect 拉取
 * （live data 走 inject 回调——宿主 client 规范第 5 条）。
 */
import { useEffect, useState } from 'react'
import type { FC, ReactNode } from 'react'
import { AccountsBlock, type AccountsApi } from './AccountsBlock.tsx'
import { PasskeysBlock, type PasskeysApi } from './PasskeysBlock.tsx'
import { PolicyBlock, type PolicyApi } from './PolicyBlock.tsx'
import { AuditBlock, type AuditApi } from './AuditBlock.tsx'

/** 部署状态（SecurityStatus 的 UI 消费面）。 */
export interface SecurityStatusView {
  readonly enabled: boolean
  readonly diagnostics: readonly string[]
}

/** 注入面（apply 闭包提供；随纵切扩展 api 方法）。 */
export interface SecuritySectionInjected {
  /** 翻译函数（locale 命名空间绑定）。 */
  t: (key: string) => string
  /** 拉取部署状态（remote.security.status）。 */
  loadStatus: () => Promise<SecurityStatusView>
  /** 账号面。 */
  accounts: AccountsApi
  /** 通行密钥面。 */
  passkeys: PasskeysApi
  /** 策略面。 */
  policy: PolicyApi
  /** 审计面。 */
  audit: AuditApi
}

/** 组件 props（宽松面：owner 股 close + inject 股展开）。 */
export type SecuritySectionProps = Partial<SecuritySectionInjected> & {
  close?: () => void
}

import { page, section } from './styles.ts'

/** 区块卡片容器。 */
function Section({ title, children }: { title: string; children?: ReactNode }): ReactNode {
  return (
    <section data-section="" style={section.card}>
      <h3 style={section.title}>{title}</h3>
      <div style={section.divider} />
      {children}
    </section>
  )
}

/** 「安全」设置页组件。 */
export const SecuritySection: FC<SecuritySectionProps> = (props) => {
  const t = props.t ?? ((key: string) => key)
  const [status, setStatus] = useState<SecurityStatusView | undefined>(undefined)
  const [statusError, setStatusError] = useState(false)

  useEffect(() => {
    if (props.loadStatus === undefined) return
    let cancelled = false
    props.loadStatus().then((s) => { if (!cancelled) setStatus(s) })
      .catch(() => { if (!cancelled) setStatusError(true) })
    return () => { cancelled = true }
  }, [props.loadStatus])

  return (
    <div data-security-page="" style={page.container}>
      {statusError
        ? <p data-status-error="" style={page.banner}>{t('statusLoadFailed')}</p>
        : status !== undefined && status.diagnostics.length > 0
          ? (
              <div data-banner="" role="alert" style={page.banner}>
                <strong>{t('bannerTitle')}</strong>
                <ul style={{ margin: '8px 0 0', paddingLeft: '18px' }}>
                  {status.diagnostics.map((d) => <li key={d}>{d}</li>)}
                </ul>
              </div>
            )
          : null}
      <Section title={t('accountsTitle')}>
        {props.accounts !== undefined
          ? <AccountsBlock t={t} api={props.accounts} />
          : null}
      </Section>
      <Section title={t('passkeyTitle')}>
        {props.passkeys !== undefined
          ? <PasskeysBlock t={t} api={props.passkeys} />
          : null}
      </Section>
      <Section title={t('policyTitle')}>
        {props.policy !== undefined
          ? <PolicyBlock t={t} api={props.policy} />
          : null}
      </Section>
      <Section title={t('auditTitle')}>
        {props.audit !== undefined
          ? <AuditBlock t={t} api={props.audit} />
          : null}
      </Section>
    </div>
  )
}
