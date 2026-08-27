/**
 * 设置页词典（settings.security 命名空间）。
 *
 * zh 为主、en 为对照（grill-me Q6-A）。label thunk 让导航文案跟随
 * 宿主 locale 变更（宿主 resolveSlotLabel 约定）。
 */
export type SecurityLocaleKey =
  | 'page'
  | 'bannerTitle'
  | 'accountsTitle'
  | 'passkeyTitle'
  | 'policyTitle'
  | 'auditTitle'

export const zh: Record<SecurityLocaleKey, string> = {
  page: '安全',
  bannerTitle: '部署警告',
  accountsTitle: '账号管理',
  passkeyTitle: '通行密钥',
  policyTitle: '安全策略',
  auditTitle: '审计日志',
}

export const en: Record<SecurityLocaleKey, string> = {
  page: 'Security',
  bannerTitle: 'Deployment warnings',
  accountsTitle: 'Accounts',
  passkeyTitle: 'Passkeys',
  policyTitle: 'Security policy',
  auditTitle: 'Audit log',
}
