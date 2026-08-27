/**
 * 设置页词典（settings.security 命名空间）。
 *
 * zh 为主、en 为对照（grill-me Q6-A）。label thunk 让导航文案跟随
 * 宿主 locale 变更（宿主 resolveSlotLabel 约定）。
 */
export type SecurityLocaleKey =
  | 'page'
  | 'bannerTitle'
  | 'statusLoadFailed'
  | 'accountsTitle'
  | 'username'
  | 'password'
  | 'create'
  | 'loadFailed'
  | 'hasPasskey'
  | 'changePassword'
  | 'currentPassword'
  | 'newPassword'
  | 'submit'
  | 'passwordUpdated'
  | 'removeAccount'
  | 'confirmRemove'
  | 'passkeyTitle'
  | 'policyTitle'
  | 'auditTitle'

export const zh: Record<SecurityLocaleKey, string> = {
  page: '安全',
  bannerTitle: '部署警告',
  statusLoadFailed: '状态加载失败',
  accountsTitle: '账号管理',
  username: '用户名',
  password: '密码',
  create: '创建账号',
  loadFailed: '加载失败',
  hasPasskey: '通行密钥',
  changePassword: '改密',
  currentPassword: '当前密码',
  newPassword: '新密码',
  submit: '提交',
  passwordUpdated: '已更新',
  removeAccount: '删除账号',
  confirmRemove: '确认删除该账号？其活跃会话将被撤销。',
  passkeyTitle: '通行密钥',
  policyTitle: '安全策略',
  auditTitle: '审计日志',
}

export const en: Record<SecurityLocaleKey, string> = {
  page: 'Security',
  bannerTitle: 'Deployment warnings',
  statusLoadFailed: 'Failed to load status',
  accountsTitle: 'Accounts',
  username: 'Username',
  password: 'Password',
  create: 'Create account',
  loadFailed: 'Load failed',
  hasPasskey: 'Passkey',
  changePassword: 'Change password',
  currentPassword: 'Current password',
  newPassword: 'New password',
  submit: 'Submit',
  passwordUpdated: 'Updated',
  removeAccount: 'Remove account',
  confirmRemove: 'Remove this account? Its active sessions will be revoked.',
  passkeyTitle: 'Passkeys',
  policyTitle: 'Security policy',
  auditTitle: 'Audit log',
}
