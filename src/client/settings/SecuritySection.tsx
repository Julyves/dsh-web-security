/**
 * 「安全」设置页（settings.section 贡献组件）。
 *
 * 五区块骨架（M4 Story 1）：警告横幅（有诊断时）/账号管理/通行密钥/
 * 安全策略/审计日志。区块内容由后续纵切逐步填充；本组件只消费
 * inject 面与 owner 股（宿主 SettingsSectionOwnerProps.close）。
 */
import type { FC, ReactNode } from 'react'

/** 注入面（apply 闭包提供；随纵切扩展 api 方法）。 */
export interface SecuritySectionInjected {
  /** 翻译函数（locale 命名空间绑定）。 */
  t: (key: string) => string
}

/** 组件 props（宽松面：owner 股 close + inject 股展开）。 */
export type SecuritySectionProps = Partial<SecuritySectionInjected> & {
  close?: () => void
}

/** 区块卡片容器。 */
function Section({ title, children }: { title: string; children?: ReactNode }): ReactNode {
  return (
    <section data-section="">
      <h3>{title}</h3>
      {children}
    </section>
  )
}

/** 「安全」设置页组件。 */
export const SecuritySection: FC<SecuritySectionProps> = (props) => {
  const t = props.t ?? ((key: string) => key)
  return (
    <div data-security-page="">
      <Section title={t('accountsTitle')} />
      <Section title={t('passkeyTitle')} />
      <Section title={t('policyTitle')} />
      <Section title={t('auditTitle')} />
    </div>
  )
}
